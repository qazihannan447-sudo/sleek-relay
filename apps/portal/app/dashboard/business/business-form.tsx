'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import {
  businessHoursDays,
  type BusinessConfigurationValues,
  type BusinessHours,
} from '../../../lib/business-configuration/schema';
import {
  extractBusinessConfigurationValues,
  initialBusinessConfigurationActionState,
  type BusinessConfigurationActionState,
} from '../../../lib/business-configuration/validation';
import {
  applyExtractionPatchToValues,
  draftHasApplicableProfileFields,
  type ApplyExtractionPatchMode,
  type WebsiteExtractionDraftView,
} from '../../../lib/business-configuration/website-extraction';
import {
  draftToKnowledgeCandidates,
  type WebsiteKnowledgeCandidate,
} from '../../../lib/business-configuration/website-knowledge';
import type { BusinessKnowledgeListItem } from '../../../lib/knowledge/schema';
import { formatTimestamp } from '../../../lib/format-timestamp';
import {
  approveDraftBusinessKnowledge,
  persistScrapedBusinessDataForAgents,
  saveBusinessConfiguration,
  scrapeBusinessWebsiteEnrich,
  scrapeBusinessWebsiteQuick,
} from './actions';
import { TimezoneCombobox } from './timezone-combobox';

type ScrapePhase = 'idle' | 'quick' | 'enrich' | 'ready' | 'saving';

type SingleDayHours = {
  close: string;
  closed: boolean;
  open: string;
};

type HoursState = Record<string, SingleDayHours>;

type DayHoursSummary = {
  hours: string;
  label: string;
};

const fieldPlaceholders = {
  businessName: 'Acme Dental Care',
  businessPhone: '+1 (555) 123-4567',
  category: 'Family dental clinic',
  contactEmail: 'hello@acmedental.com',
  contactName: 'Taylor Morgan',
  timezone: 'America/Toronto',
  website: 'acmedental.com',
} as const;

function getFieldValue(
  state: BusinessConfigurationActionState,
  fallback: BusinessConfigurationValues,
): BusinessConfigurationValues {
  return state.values ?? fallback;
}

function createSignature(values: BusinessConfigurationValues): string {
  return JSON.stringify(values);
}

function formatTime12h(timeStr: string | null | undefined): string {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10);
  if (isNaN(h)) return timeStr;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${ampm}`;
}

function hoursStateFromBusinessHours(hours: BusinessHours): HoursState {
  const next: HoursState = {};
  for (const day of businessHoursDays) {
    next[day.key] = {
      close: hours[day.key].close ?? '17:00',
      closed: hours[day.key].closed,
      open: hours[day.key].open ?? '09:00',
    };
  }
  return next;
}

function buildBusinessHoursSummary(hours: HoursState): DayHoursSummary[] {
  const dayItems = businessHoursDays.map((day) => {
    const dh = hours[day.key];
    const isClosed = dh?.closed ?? false;
    const text = isClosed
      ? 'Closed'
      : dh?.open && dh?.close
        ? `${formatTime12h(dh.open)} – ${formatTime12h(dh.close)}`
        : 'Closed';
    return { key: day.key, label: day.label, shortLabel: day.label.slice(0, 3), text };
  });

  const groups: DayHoursSummary[] = [];
  let currentGroup: { days: typeof dayItems; text: string } | null = null;

  for (const item of dayItems) {
    if (!currentGroup) {
      currentGroup = { days: [item], text: item.text };
    } else if (currentGroup.text === item.text) {
      currentGroup.days.push(item);
    } else {
      const first = currentGroup.days[0];
      const last = currentGroup.days[currentGroup.days.length - 1];
      if (currentGroup.days.length === 2 && first.key === 'sat' && last.key === 'sun') {
        groups.push({ hours: currentGroup.text, label: 'Saturday' });
        groups.push({ hours: currentGroup.text, label: 'Sunday' });
      } else {
        const label =
          currentGroup.days.length === 1
            ? first.label
            : `${first.shortLabel}–${last.shortLabel}`;
        groups.push({ hours: currentGroup.text, label });
      }
      currentGroup = { days: [item], text: item.text };
    }
  }

  if (currentGroup) {
    const first = currentGroup.days[0];
    const last = currentGroup.days[currentGroup.days.length - 1];
    if (currentGroup.days.length === 2 && first.key === 'sat' && last.key === 'sun') {
      groups.push({ hours: currentGroup.text, label: 'Saturday' });
      groups.push({ hours: currentGroup.text, label: 'Sunday' });
    } else {
      const label =
        currentGroup.days.length === 1
          ? first.label
          : `${first.shortLabel}–${last.shortLabel}`;
      groups.push({ hours: currentGroup.text, label });
    }
  }

  return groups;
}

function readFormSignature(form: HTMLFormElement): string {
  return createSignature(extractBusinessConfigurationValues(new FormData(form)));
}

function formatSourceLabel(source: string): string {
  switch (source) {
    case 'structured_data':
      return 'Structured data';
    case 'page_text':
      return 'Page text';
    case 'llm_inferred':
      return 'AI inferred';
    default:
      return source;
  }
}

function formatKindBadge(kind: string): string {
  switch (kind) {
    case 'faq':
      return 'FAQ';
    case 'service_information':
      return 'Service';
    case 'policy':
      return 'Policy';
    case 'business_fact':
      return 'Business Fact';
    default:
      return kind.replaceAll('_', ' ');
  }
}

function formatProfileFieldLabel(key: string): string {
  switch (key) {
    case 'businessName':
      return 'Business name';
    case 'businessPhone':
      return 'Phone';
    case 'businessHours':
      return 'Business hours';
    case 'contactEmail':
      return 'Contact email';
    case 'category':
      return 'Category';
    case 'website':
      return 'Website';
    default:
      return key;
  }
}

function ProvenanceBadges({
  confidence,
  source,
}: {
  confidence: string;
  source: string;
}) {
  return (
    <span className="scrape-provenance">
      <span className={`scrape-confidence scrape-confidence-${confidence}`}>
        {confidence}
      </span>
      <span className="scrape-source">{formatSourceLabel(source)}</span>
    </span>
  );
}

function WebsiteKnowledgePanel({
  canManageKnowledge,
  candidates,
  enrichError,
  knowledgeItems,
  onApproveDraftItems,
  onApproveSelected,
  onDismissDraft,
  onSaveDrafts,
  onToggleCandidate,
  phase,
  selectedKeys,
}: {
  canManageKnowledge: boolean;
  candidates: WebsiteKnowledgeCandidate[];
  enrichError: string | null;
  knowledgeItems: BusinessKnowledgeListItem[];
  onApproveDraftItems: () => void;
  onApproveSelected: () => void;
  onDismissDraft: () => void;
  onSaveDrafts: () => void;
  onToggleCandidate: (_key: string) => void;
  phase: ScrapePhase;
  selectedKeys: Set<string>;
}) {
  const isLoadingKnowledge = phase === 'quick' || phase === 'enrich';
  const showDraft = candidates.length > 0 && (phase === 'ready' || phase === 'saving');
  const selectedCount = candidates.filter((item) => selectedKeys.has(item.key)).length;
  const draftSavedCount = knowledgeItems.filter(
    (item) => item.status === 'draft',
  ).length;

  return (
    <section className="website-knowledge-panel">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">Website knowledge</h2>
          <p className="panel-subtitle">
            Scraped FAQs, services, projects, and partners must be approved
            before agents can use them. Drafts stay offline until then.
          </p>
        </div>
        {canManageKnowledge ? (
          <div className="website-knowledge-panel-header-actions">
            {draftSavedCount > 0 ? (
              <button
                className="button"
                disabled={phase === 'saving'}
                onClick={onApproveDraftItems}
                type="button"
              >
                {phase === 'saving'
                  ? 'Approving…'
                  : `Approve drafts for agents (${draftSavedCount})`}
              </button>
            ) : null}
            <Link className="button-secondary" href="/dashboard/knowledge">
              Manage in Knowledge
            </Link>
          </div>
        ) : null}
      </div>

      {isLoadingKnowledge ? (
        <div className="website-knowledge-status" role="status">
          {phase === 'quick'
            ? 'Fetching contact details from the page…'
            : 'Contact details ready. Still reading the site for services, FAQs, and policies…'}
          <div className="website-knowledge-skeletons" aria-hidden="true">
            <div className="website-knowledge-skeleton" />
            <div className="website-knowledge-skeleton" />
            <div className="website-knowledge-skeleton" />
          </div>
        </div>
      ) : null}

      {enrichError ? (
        <div className="notice notice-danger">{enrichError}</div>
      ) : null}

      {showDraft ? (
        <div className="scrape-draft">
          <div className="scrape-draft-header">
            <div className="scrape-draft-header-left">
              <span className="scrape-draft-title">Draft from website</span>
              <span className="status-pill status-pill-draft">
                <span className="status-dot" />
                Review
              </span>
            </div>
            <button
              className="scrape-draft-dismiss"
              onClick={onDismissDraft}
              type="button"
            >
              Dismiss
            </button>
          </div>

          <p className="scrape-draft-notice">
            Uncheck anything you do not want. Nothing is saved until you choose
            an action below. Re-scrapes skip titles you already have.
          </p>

          <div className="website-knowledge-candidates">
            {candidates.map((item) => {
              const checked = selectedKeys.has(item.key);
              return (
                <label
                  className={`website-knowledge-candidate${checked ? ' is-selected' : ''}`}
                  key={item.key}
                >
                  <input
                    checked={checked}
                    disabled={phase === 'saving'}
                    onChange={() => onToggleCandidate(item.key)}
                    type="checkbox"
                  />
                  <div className="website-knowledge-candidate-body">
                    <div className="website-knowledge-candidate-meta">
                      <span className="knowledge-card-kind">
                        {formatKindBadge(item.kind)}
                      </span>
                      <ProvenanceBadges
                        confidence={item.confidence}
                        source={item.source}
                      />
                    </div>
                    <h3 className="website-knowledge-candidate-title">
                      {item.title}
                    </h3>
                    <p className="website-knowledge-candidate-content">
                      {item.content}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="scrape-draft-actions">
            {canManageKnowledge ? (
              <>
                <button
                  className="button-secondary"
                  disabled={selectedCount === 0 || phase === 'saving'}
                  onClick={onSaveDrafts}
                  type="button"
                >
                  {phase === 'saving'
                    ? 'Saving…'
                    : `Save as drafts (${selectedCount})`}
                </button>
                <button
                  className="button"
                  disabled={selectedCount === 0 || phase === 'saving'}
                  onClick={onApproveSelected}
                  type="button"
                >
                  {phase === 'saving'
                    ? 'Saving…'
                    : `Approve for agents (${selectedCount})`}
                </button>
              </>
            ) : (
              <p className="scrape-draft-hint">
                Only owners and admins can save website knowledge.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {!isLoadingKnowledge && !showDraft ? (
        knowledgeItems.length > 0 ? (
          <div className="knowledge-cards-grid">
            {knowledgeItems.map((item) => (
              <div className="knowledge-card" key={item.id}>
                <div>
                  <div className="knowledge-card-header">
                    <span className="knowledge-card-kind">
                      {formatKindBadge(item.kind)}
                    </span>
                    <span className={`status-pill status-pill-${item.status}`}>
                      <span className="status-dot" />
                      {item.status}
                    </span>
                  </div>
                  <div className="knowledge-card-body">
                    <h3 className="knowledge-card-title">
                      <Link href={`/dashboard/knowledge/${item.id}`} prefetch={true}>
                        {item.title}
                      </Link>
                    </h3>
                    {item.content ? (
                      <p className="knowledge-card-text">{item.content}</p>
                    ) : null}
                  </div>
                </div>
                <div className="knowledge-card-footer">
                  <span className="knowledge-card-meta">
                    {formatTimestamp(item.lastUpdated)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="notice">
              Scrape your website, review the draft items, then save. Approved
              items become available to your agents.
            </div>
          </div>
        )
      ) : null}
    </section>
  );
}

type BusinessFormProps = {
  canEdit: boolean;
  canManageKnowledge: boolean;
  defaultValues: BusinessConfigurationValues;
  knowledgeItems: BusinessKnowledgeListItem[];
};

export function BusinessConfigurationForm({
  canEdit,
  canManageKnowledge,
  defaultValues,
  knowledgeItems,
}: BusinessFormProps) {
  const [state, formAction, isPending] = useActionState<
    BusinessConfigurationActionState,
    FormData
  >(
    saveBusinessConfiguration,
    initialBusinessConfigurationActionState(defaultValues),
  );
  const savedValues = getFieldValue(state, defaultValues);
  const [formValues, setFormValues] = useState(savedValues);
  const [formRevision, setFormRevision] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const successTimerRef = useRef<number | null>(null);
  const [baselineSignature, setBaselineSignature] = useState(() =>
    createSignature(defaultValues),
  );
  const [isDirty, setIsDirty] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const formKey = useMemo(
    () => `${createSignature(formValues)}:${formRevision}`,
    [formRevision, formValues],
  );
  const [websiteUrl, setWebsiteUrl] = useState(formValues.website ?? '');
  const [scrapePhase, setScrapePhase] = useState<ScrapePhase>('idle');
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [knowledgeCandidates, setKnowledgeCandidates] = useState<
    WebsiteKnowledgeCandidate[]
  >([]);
  const [selectedKnowledgeKeys, setSelectedKnowledgeKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [savedKnowledgeItems, setSavedKnowledgeItems] = useState(knowledgeItems);
  const [pendingProfilePatch, setPendingProfilePatch] = useState<Partial<BusinessConfigurationValues> | null>(
    null,
  );
  const [skippedProfileFields, setSkippedProfileFields] = useState<string[]>([]);
  const [appliedProfileFields, setAppliedProfileFields] = useState<string[]>([]);
  const [hoursState, setHoursState] = useState<HoursState>(() =>
    hoursStateFromBusinessHours(formValues.businessHours),
  );

  const [isHoursModalOpen, setIsHoursModalOpen] = useState(false);
  const [draftHours, setDraftHours] = useState<HoursState>(hoursState);
  const [selectedTimezone, setSelectedTimezone] = useState(
    formValues.timezone ?? 'America/Toronto',
  );

  const hoursSummary = useMemo(
    () => buildBusinessHoursSummary(hoursState),
    [hoursState],
  );
  const isScraping =
    scrapePhase === 'quick' || scrapePhase === 'enrich' || scrapePhase === 'saving';

  useEffect(() => {
    setSavedKnowledgeItems(knowledgeItems);
  }, [knowledgeItems]);

  function showToast(message: string) {
    setToastMessage(message);
    if (successTimerRef.current !== null) {
      window.clearTimeout(successTimerRef.current);
    }
    successTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      successTimerRef.current = null;
    }, 2600);
  }

  function applyProfileDraft(
    draft: WebsiteExtractionDraftView,
    mode: ApplyExtractionPatchMode = 'fillEmpty',
  ): BusinessConfigurationValues {
    const current =
      formRef.current != null
        ? extractBusinessConfigurationValues(new FormData(formRef.current))
        : formValues;

    if (!draftHasApplicableProfileFields(draft)) {
      setPendingProfilePatch(null);
      setSkippedProfileFields([]);
      setAppliedProfileFields([]);
      return current;
    }

    const { appliedKeys, next, skippedKeys } = applyExtractionPatchToValues(
      current,
      draft.formPatch,
      mode,
    );

    setPendingProfilePatch(draft.formPatch);
    setAppliedProfileFields(appliedKeys);
    setSkippedProfileFields(skippedKeys);
    setFormValues(next);
    setHoursState(hoursStateFromBusinessHours(next.businessHours));
    setWebsiteUrl(next.website ?? '');
    setSelectedTimezone(next.timezone ?? 'America/Toronto');
    setFormRevision((value) => value + 1);
    setIsDirty(createSignature(next) !== baselineSignature);
    return next;
  }

  function applySkippedProfileFields() {
    if (!pendingProfilePatch || skippedProfileFields.length === 0) {
      return;
    }

    const current =
      formRef.current != null
        ? extractBusinessConfigurationValues(new FormData(formRef.current))
        : formValues;
    const { appliedKeys, next } = applyExtractionPatchToValues(
      current,
      pendingProfilePatch,
      'replace',
    );
    setAppliedProfileFields(appliedKeys);
    setSkippedProfileFields([]);
    setFormValues(next);
    setHoursState(hoursStateFromBusinessHours(next.businessHours));
    setWebsiteUrl(next.website ?? '');
    setFormRevision((value) => value + 1);
    setIsDirty(createSignature(next) !== baselineSignature);
    showToast('Replaced existing profile fields with scraped values.');
  }

  async function persistForAgents(args: {
    approveKnowledge?: boolean;
    candidates: WebsiteKnowledgeCandidate[];
    values: BusinessConfigurationValues;
  }) {
    setScrapePhase('saving');
    const result = await persistScrapedBusinessDataForAgents({
      approveKnowledge: args.approveKnowledge !== false,
      knowledgeItems: args.candidates.map((item) => ({
        content: item.content,
        kind: item.kind,
        title: item.title,
      })),
      values: args.values,
    });

    if (result.kind === 'error') {
      setEnrichError(result.message);
      setKnowledgeCandidates(args.candidates);
      setSelectedKnowledgeKeys(new Set(args.candidates.map((item) => item.key)));
      setScrapePhase(args.candidates.length > 0 ? 'ready' : 'idle');
      if (result.values) {
        setFormValues(result.values);
        setHoursState(hoursStateFromBusinessHours(result.values.businessHours));
        setWebsiteUrl(result.values.website ?? '');
        setFormRevision((value) => value + 1);
      }
      return false;
    }

    setFormValues(result.values);
    setHoursState(hoursStateFromBusinessHours(result.values.businessHours));
    setWebsiteUrl(result.values.website ?? '');
    setSelectedTimezone(result.values.timezone ?? 'America/Toronto');
    setBaselineSignature(createSignature(result.values));
    setIsDirty(false);
    setFormRevision((value) => value + 1);

    if (result.knowledgeItems.length > 0) {
      setSavedKnowledgeItems((prev) => {
        const byId = new Map(prev.map((item) => [item.id, item]));
        for (const item of result.knowledgeItems) {
          byId.set(item.id, item);
        }
        return [...byId.values()].sort((a, b) =>
          b.lastUpdated.localeCompare(a.lastUpdated),
        );
      });
    }

    setKnowledgeCandidates([]);
    setSelectedKnowledgeKeys(new Set());
    setPendingProfilePatch(null);
    setSkippedProfileFields([]);
    setAppliedProfileFields([]);
    setEnrichError(null);
    setScrapePhase('idle');
    showToast(result.message || 'Saved.');
    return true;
  }

  useEffect(() => {
    if (state.status !== 'success' || !state.message) {
      return;
    }

    const nextValues = getFieldValue(state, defaultValues);
    setFormValues(nextValues);
    setHoursState(hoursStateFromBusinessHours(nextValues.businessHours));
    setWebsiteUrl(nextValues.website ?? '');
    setSelectedTimezone(nextValues.timezone ?? 'America/Toronto');
    setBaselineSignature(createSignature(nextValues));
    setIsDirty(false);
    showToast(state.message);
  }, [defaultValues, state]);

  useEffect(() => {
    return () => {
      if (successTimerRef.current !== null) {
        window.clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  function updateDirtyState() {
    if (!formRef.current) {
      return;
    }

    const formData = new FormData(formRef.current);
    const tz = formData.get('timezone');
    if (typeof tz === 'string' && tz) {
      setSelectedTimezone(tz);
    }

    setIsDirty(readFormSignature(formRef.current) !== baselineSignature);
  }

  function handleOpenHoursModal() {
    setDraftHours(JSON.parse(JSON.stringify(hoursState)));
    setIsHoursModalOpen(true);
  }

  function handleSaveHoursFromModal() {
    setHoursState(draftHours);
    setIsHoursModalOpen(false);
    setTimeout(updateDirtyState, 0);
  }

  function applyDayHoursToTarget(sourceKey: string, targetKey: string) {
    setDraftHours((prev) => ({
      ...prev,
      [targetKey]: { ...prev[sourceKey] },
    }));
  }

  function applyDayHoursToAllOther(sourceKey: string) {
    setDraftHours((prev) => {
      const next = { ...prev };
      const source = prev[sourceKey];
      for (const d of businessHoursDays) {
        if (d.key !== sourceKey) {
          next[d.key] = { ...source };
        }
      }
      return next;
    });
  }

  function handleCancel() {
    if (formRef.current) {
      formRef.current.reset();
    }
    setFormValues(savedValues);
    setHoursState(hoursStateFromBusinessHours(savedValues.businessHours));
    setWebsiteUrl(savedValues.website ?? '');
    setSelectedTimezone(savedValues.timezone ?? 'America/Toronto');
    setFormRevision((value) => value + 1);
    setIsDirty(false);
  }

  function resetKnowledgeDraft() {
    setKnowledgeCandidates([]);
    setSelectedKnowledgeKeys(new Set());
    setEnrichError(null);
    setPendingProfilePatch(null);
    setSkippedProfileFields([]);
    setAppliedProfileFields([]);
    setScrapePhase('idle');
  }

  async function handleScrapeWebsite() {
    setScrapePhase('quick');
    setScrapeError(null);
    setEnrichError(null);
    setKnowledgeCandidates([]);
    setSelectedKnowledgeKeys(new Set());
    setPendingProfilePatch(null);
    setSkippedProfileFields([]);
    setAppliedProfileFields([]);

    try {
      const quickResult = await scrapeBusinessWebsiteQuick(websiteUrl);
      if (quickResult.kind === 'error') {
        setScrapePhase('idle');
        setScrapeError(quickResult.message);
        return;
      }

      let latestValues = applyProfileDraft(quickResult.draft, 'fillEmpty');
      let candidates = draftToKnowledgeCandidates(quickResult.draft);
      if (candidates.length > 0) {
        setKnowledgeCandidates(candidates);
        setSelectedKnowledgeKeys(new Set(candidates.map((item) => item.key)));
      }
      showToast(
        draftHasApplicableProfileFields(quickResult.draft)
          ? 'Empty profile fields filled. Still reading the site…'
          : 'Found some site details. Still reading for more…',
      );
      setScrapePhase('enrich');

      const enrichUrl = quickResult.draft.normalizedUrl || websiteUrl;
      const enrichResult = await scrapeBusinessWebsiteEnrich(enrichUrl);
      if (enrichResult.kind === 'error') {
        setEnrichError(
          `${enrichResult.message} Review and save anything already listed below.`,
        );
      } else {
        latestValues = applyProfileDraft(enrichResult.draft, 'fillEmpty');
        candidates = draftToKnowledgeCandidates(enrichResult.draft);
        setKnowledgeCandidates(candidates);
        setSelectedKnowledgeKeys(new Set(candidates.map((item) => item.key)));
      }

      if (candidates.length === 0 && !draftHasApplicableProfileFields(quickResult.draft)) {
        setScrapePhase('idle');
        setScrapeError(
          'No usable profile or knowledge details were found. You can fill the form manually.',
        );
        return;
      }

      // Persist profile + scraped extras as approved so agents can use projects,
      // partners, FAQs, etc. without a separate Knowledge approval step.
      if (candidates.length > 0 || draftHasApplicableProfileFields(quickResult.draft)) {
        const saved = await persistForAgents({
          approveKnowledge: true,
          candidates,
          values: latestValues,
        });
        if (!saved && candidates.length > 0) {
          setScrapePhase('ready');
          showToast(
            'Profile/knowledge could not be auto-saved. Review the checklist and approve below.',
          );
          return;
        }
        return;
      }

      setScrapePhase('idle');
      showToast('Empty profile fields were filled. Save the profile when you are ready.');
    } catch (error) {
      setScrapePhase('idle');
      setScrapeError(
        error instanceof Error
          ? error.message
          : 'Unable to scrape that website right now.',
      );
    }
  }

  function handleToggleCandidate(key: string) {
    setSelectedKnowledgeKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function handleSaveSelectedKnowledge(approveKnowledge: boolean) {
    const selected = knowledgeCandidates.filter((item) =>
      selectedKnowledgeKeys.has(item.key),
    );
    if (selected.length === 0) {
      return;
    }

    const current =
      formRef.current != null
        ? extractBusinessConfigurationValues(new FormData(formRef.current))
        : formValues;

    await persistForAgents({
      approveKnowledge,
      candidates: selected,
      values: current,
    });
  }

  async function handleApproveSavedDrafts() {
    setScrapePhase('saving');
    const result = await approveDraftBusinessKnowledge();
    if (result.kind === 'error') {
      setEnrichError(result.message);
      setScrapePhase('idle');
      return;
    }

    if (result.items.length > 0) {
      const approvedIds = new Set(result.items.map((item) => item.id));
      setSavedKnowledgeItems((prev) =>
        prev.map((item) =>
          approvedIds.has(item.id)
            ? { ...item, status: 'approved' as const }
            : item,
        ),
      );
    }
    setScrapePhase('idle');
    showToast(result.message);
  }

  async function handleSaveProfileAndKnowledge() {
    const current =
      formRef.current != null
        ? extractBusinessConfigurationValues(new FormData(formRef.current))
        : formValues;
    const selected = knowledgeCandidates.filter((item) =>
      selectedKnowledgeKeys.has(item.key),
    );

    if (selected.length > 0 || knowledgeCandidates.length > 0) {
      await persistForAgents({
        approveKnowledge: true,
        candidates: selected,
        values: current,
      });
      return;
    }

    const draftSavedCount = savedKnowledgeItems.filter(
      (item) => item.status === 'draft',
    ).length;
    if (draftSavedCount > 0 && !isDirty) {
      await handleApproveSavedDrafts();
      return;
    }

    if (formRef.current) {
      formRef.current.requestSubmit();
    }
  }

  return (
    <>
      {toastMessage ? (
        <div aria-live="polite" className="dashboard-toast dashboard-toast-success">
          {toastMessage}
        </div>
      ) : null}

      <div className="business-website-assist">
        <div className="business-website-assist-copy">
          <h3 className="business-website-assist-title">Website assist</h3>
          <p className="business-website-assist-text">
            Paste your business website. We fill empty profile fields and draft
            knowledge for you to review before anything is saved for agents.
          </p>
        </div>
      </div>

      <form
        action={formAction}
        className="business-form"
        id="business-configuration-form"
        key={formKey}
        onChange={updateDirtyState}
        onInput={updateDirtyState}
        ref={formRef}
      >
        <div className="business-form-grid">
          <div className="field">
            <label htmlFor="businessName">Business name</label>
            <input
              defaultValue={formValues.businessName}
              disabled={!canEdit || isPending}
              id="businessName"
              name="businessName"
              placeholder={fieldPlaceholders.businessName}
              required
              type="text"
            />
          </div>

          <div className="field">
            <label htmlFor="category">Category</label>
            <input
              defaultValue={formValues.category}
              disabled={!canEdit || isPending}
              id="category"
              name="category"
              placeholder={fieldPlaceholders.category}
              type="text"
            />
          </div>

          <div className="field field-span-2">
            <label htmlFor="website">Website</label>
            <div className="field-input-row">
              <input
                defaultValue={formValues.website}
                disabled={!canEdit || isPending || isScraping}
                id="website"
                name="website"
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder={fieldPlaceholders.website}
                type="text"
              />
              {canEdit ? (
                <button
                  className="button-secondary"
                  disabled={!websiteUrl.trim() || isScraping || isPending}
                  onClick={(e) => {
                    e.preventDefault();
                    void handleScrapeWebsite();
                  }}
                  type="button"
                >
                  {isScraping ? 'Scraping…' : 'Scrape website info'}
                </button>
              ) : null}
            </div>
            {isScraping ? (
              <div className="scrape-progress" role="status">
                {scrapePhase === 'quick'
                  ? 'Fetching contact details…'
                  : scrapePhase === 'enrich'
                    ? 'Contact details ready. Reading services, FAQs, and policies…'
                    : 'Saving your reviewed selection…'}
              </div>
            ) : null}
            {scrapeError ? (
              <div className="notice notice-danger">{scrapeError}</div>
            ) : null}
            {appliedProfileFields.length > 0 || skippedProfileFields.length > 0 ? (
              <div className="notice" style={{ marginTop: '10px' }}>
                {appliedProfileFields.length > 0 ? (
                  <p>
                    Filled empty fields:{' '}
                    {appliedProfileFields
                      .map((key) => formatProfileFieldLabel(key))
                      .join(', ')}
                    .
                  </p>
                ) : null}
                {skippedProfileFields.length > 0 ? (
                  <p>
                    Left existing values unchanged:{' '}
                    {skippedProfileFields
                      .map((key) => formatProfileFieldLabel(key))
                      .join(', ')}
                    .{' '}
                    <button
                      className="button-secondary"
                      disabled={isScraping || isPending}
                      onClick={applySkippedProfileFields}
                      type="button"
                    >
                      Replace with scraped values
                    </button>
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="businessPhone">Phone</label>
            <input
              defaultValue={formValues.businessPhone}
              disabled={!canEdit || isPending}
              id="businessPhone"
              name="businessPhone"
              placeholder={fieldPlaceholders.businessPhone}
              type="text"
            />
          </div>

          <div className="field">
            <label htmlFor="contactName">Contact name</label>
            <input
              defaultValue={formValues.contactName}
              disabled={!canEdit || isPending}
              id="contactName"
              name="contactName"
              placeholder={fieldPlaceholders.contactName}
              type="text"
            />
          </div>

          <div className="field">
            <label htmlFor="contactEmail">Contact email</label>
            <input
              defaultValue={formValues.contactEmail}
              disabled={!canEdit || isPending}
              id="contactEmail"
              name="contactEmail"
              placeholder={fieldPlaceholders.contactEmail}
              type="email"
            />
          </div>

          <div className="field">
            <label htmlFor="timezone">Timezone</label>
            <TimezoneCombobox
              disabled={!canEdit || isPending}
              name="timezone"
              onValueChange={updateDirtyState}
              placeholder={fieldPlaceholders.timezone}
              value={formValues.timezone}
            />
          </div>
        </div>

        <section className="hours-panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Business Hours</h2>
              <p className="panel-subtitle">
                Set the weekly hours your agents use.
              </p>
            </div>
            {canEdit ? (
              <button
                className="button-secondary"
                onClick={handleOpenHoursModal}
                type="button"
              >
                Edit hours
              </button>
            ) : null}
          </div>

          <div className="hours-summary-box">
            {hoursSummary.map((item, idx) => (
              <div className="hours-summary-row" key={`${item.label}-${idx}`}>
                <span className="hours-summary-day">{item.label}</span>
                <span className="hours-summary-val">{item.hours}</span>
              </div>
            ))}
          </div>

          {businessHoursDays.map((day) => {
            const dayVal = hoursState[day.key];
            return (
              <div key={day.key} style={{ display: 'none' }}>
                {dayVal?.closed ? (
                  <input
                    name={`businessHours.${day.key}.closed`}
                    type="hidden"
                    value="on"
                  />
                ) : null}
                <input
                  name={`businessHours.${day.key}.open`}
                  type="hidden"
                  value={dayVal?.closed ? '' : (dayVal?.open ?? '')}
                />
                <input
                  name={`businessHours.${day.key}.close`}
                  type="hidden"
                  value={dayVal?.closed ? '' : (dayVal?.close ?? '')}
                />
              </div>
            );
          })}
        </section>

        {state.status === 'error' && state.message ? (
          <div className="notice notice-danger">{state.message}</div>
        ) : null}
      </form>

      <WebsiteKnowledgePanel
        canManageKnowledge={canManageKnowledge}
        candidates={knowledgeCandidates}
        enrichError={enrichError}
        knowledgeItems={savedKnowledgeItems}
        onApproveDraftItems={() => {
          void handleApproveSavedDrafts();
        }}
        onApproveSelected={() => {
          void handleSaveSelectedKnowledge(true);
        }}
        onDismissDraft={resetKnowledgeDraft}
        onSaveDrafts={() => {
          void handleSaveSelectedKnowledge(false);
        }}
        onToggleCandidate={handleToggleCandidate}
        phase={scrapePhase}
        selectedKeys={selectedKnowledgeKeys}
      />

      {canEdit ? (
        <div className="sticky-action-bar">
          <div className="sticky-action-bar-inner">
            <div className={`sticky-action-bar-status${isDirty ? ' is-dirty' : ''}`}>
              {isDirty
                ? 'Unsaved changes'
                : savedKnowledgeItems.some((item) => item.status === 'draft')
                  ? 'Draft knowledge waiting for agent approval'
                  : 'All changes saved'}
            </div>
            <div className="sticky-action-bar-actions">
              <button
                className="button-secondary"
                disabled={!isDirty || isPending}
                onClick={handleCancel}
                type="button"
              >
                Cancel
              </button>
              <button
                className="button"
                disabled={
                  (!isDirty &&
                    knowledgeCandidates.length === 0 &&
                    !savedKnowledgeItems.some((item) => item.status === 'draft')) ||
                  isPending ||
                  scrapePhase === 'saving'
                }
                form="business-configuration-form"
                onClick={(event) => {
                  if (
                    knowledgeCandidates.length > 0 ||
                    savedKnowledgeItems.some((item) => item.status === 'draft')
                  ) {
                    event.preventDefault();
                    void handleSaveProfileAndKnowledge();
                  }
                }}
                type="submit"
              >
                {isPending || scrapePhase === 'saving'
                  ? 'Saving...'
                  : knowledgeCandidates.length > 0
                    ? 'Save for agents'
                    : savedKnowledgeItems.some((item) => item.status === 'draft')
                      ? 'Approve drafts for agents'
                      : 'Save profile'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="notice">
          You have read-only access. Owners and admins may edit this shared
          configuration.
        </div>
      )}

      {isHoursModalOpen ? (
        <div className="hours-modal-overlay" onClick={() => setIsHoursModalOpen(false)}>
          <div className="hours-modal-backdrop" />
          <div
            aria-modal="true"
            className="hours-modal-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
          >
            <div className="hours-modal-header">
              <div>
                <h2 className="hours-modal-title">Edit Business Hours</h2>
                <p className="hours-modal-subtitle">
                  Set the weekly hours your agents use.
                </p>
                <span className="hours-modal-meta">
                  Timezone: {selectedTimezone || 'America/Toronto'}
                </span>
              </div>
              <button
                aria-label="Close"
                className="hours-modal-close"
                onClick={() => setIsHoursModalOpen(false)}
                type="button"
              >
                ✕
              </button>
            </div>

            <div className="hours-modal-body">
              {businessHoursDays.map((day, idx) => {
                const dayData = draftHours[day.key] ?? {
                  closed: false,
                  open: '09:00',
                  close: '17:00',
                };
                const isClosed = dayData.closed;

                return (
                  <div key={day.key} className="hours-modal-day-block">
                    {idx > 0 && <hr className="hours-modal-divider" />}

                    <div className="hours-modal-day-header">
                      <span className="hours-modal-day-name">{day.label}</span>
                      <div className="hours-segmented-control">
                        <button
                          className={`hours-segmented-btn ${!isClosed ? 'is-active' : ''}`}
                          onClick={() =>
                            setDraftHours((prev) => ({
                              ...prev,
                              [day.key]: { ...prev[day.key], closed: false },
                            }))
                          }
                          type="button"
                        >
                          Open
                        </button>
                        <button
                          className={`hours-segmented-btn ${isClosed ? 'is-active-closed' : ''}`}
                          onClick={() =>
                            setDraftHours((prev) => ({
                              ...prev,
                              [day.key]: { ...prev[day.key], closed: true },
                            }))
                          }
                          type="button"
                        >
                          Closed
                        </button>
                      </div>
                    </div>

                    {!isClosed ? (
                      <>
                        <div className="hours-modal-time-row">
                          <input
                            className="hours-time-input"
                            onChange={(e) =>
                              setDraftHours((prev) => ({
                                ...prev,
                                [day.key]: { ...prev[day.key], open: e.target.value },
                              }))
                            }
                            type="time"
                            value={dayData.open}
                          />
                          <span className="hours-modal-to">to</span>
                          <input
                            className="hours-time-input"
                            onChange={(e) =>
                              setDraftHours((prev) => ({
                                ...prev,
                                [day.key]: { ...prev[day.key], close: e.target.value },
                              }))
                            }
                            type="time"
                            value={dayData.close}
                          />
                        </div>

                        <div className="hours-apply-batch">
                          <span className="hours-apply-label">
                            Apply {day.label} hours to:
                          </span>
                          <div className="hours-apply-buttons">
                            {businessHoursDays
                              .filter((d) => d.key !== day.key)
                              .map((target) => (
                                <button
                                  className="hours-batch-btn"
                                  key={target.key}
                                  onClick={() => applyDayHoursToTarget(day.key, target.key)}
                                  type="button"
                                >
                                  {target.label.slice(0, 3)}
                                </button>
                              ))}
                            <button
                              className="hours-batch-btn hours-batch-btn-all"
                              onClick={() => applyDayHoursToAllOther(day.key)}
                              type="button"
                            >
                              All other days
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="hours-modal-closed-banner">Closed all day</div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="hours-modal-footer">
              <button
                className="button-secondary"
                onClick={() => setIsHoursModalOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="button"
                onClick={handleSaveHoursFromModal}
                type="button"
              >
                Save hours
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
