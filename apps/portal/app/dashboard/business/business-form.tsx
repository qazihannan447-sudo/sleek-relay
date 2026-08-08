'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';

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
  draftHasReviewContent,
  filterDraftFormPatch,
  formatWebsiteDisplayLabel,
  formatWebsiteScrapeFailureMessage,
  isDifferentWebsiteHost,
  listDraftProfileFieldKeys,
  mergeWebsiteExtractionDrafts,
  profileScrapeFieldKeys,
  type ApplyExtractionPatchMode,
  type WebsiteExtractionDraftView,
} from '../../../lib/business-configuration/website-extraction';
import {
  draftHasKnowledgeContent,
  draftToKnowledgeCandidates,
  type WebsiteKnowledgeCandidate,
} from '../../../lib/business-configuration/website-knowledge';
import type { BusinessKnowledgeListItem } from '../../../lib/knowledge/schema';
import { formatTimestamp } from '../../../lib/format-timestamp';
import {
  persistScrapedBusinessDataForAgents,
  saveBusinessConfiguration,
  saveBusinessKnowledgeToggleStates,
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
  website: 'acmedental.com',
} as const;

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

function formatDraftProfileValue(
  draft: WebsiteExtractionDraftView,
  key: string,
): string {
  if (key === 'businessHours') {
    return draft.fields.hours?.display ?? 'Hours found';
  }
  const value = draft.formPatch[key as keyof BusinessConfigurationValues];
  if (typeof value === 'string') {
    return value;
  }
  return '';
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
  enrichError,
  knowledgeItems,
  onToggleSavedItem,
  phase,
  scrapeError,
  websiteLabel,
}: {
  canManageKnowledge: boolean;
  enrichError: string | null;
  knowledgeItems: BusinessKnowledgeListItem[];
  onToggleSavedItem: (_item: BusinessKnowledgeListItem, _enabled: boolean) => void;
  phase: ScrapePhase;
  scrapeError: string | null;
  websiteLabel: string;
}) {
  const isLoadingKnowledge = phase === 'quick' || phase === 'enrich';
  const isReviewing = phase === 'ready' || phase === 'saving';
  const showLive = !isLoadingKnowledge;

  return (
    <section className="website-knowledge-panel">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">Knowledge for agents</h2>
          <p className="panel-subtitle">
            Saved knowledge for this business. Only rows marked “agents can use”
            are included in the agent prompt.
          </p>
        </div>
      </div>

      {isLoadingKnowledge ? (
        <div className="website-knowledge-status" role="status">
          {phase === 'quick'
            ? 'Reading the website…'
            : 'Still reading for services, FAQs, and policies…'}
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

      {isReviewing ? (
        <div className="notice">
          New scrape results are in the review panel above. The list below is what
          agents currently use until you Apply &amp; save.
        </div>
      ) : null}

      {scrapeError && phase === 'idle' ? (
        <div className="notice notice-danger" style={{ marginBottom: '12px' }}>
          Scrape did not update knowledge. Previously saved knowledge below is
          unchanged.
        </div>
      ) : null}

      {showLive ? (
        knowledgeItems.length > 0 ? (
          <>
            <p className="scrape-draft-notice">
              Saved knowledge
              {websiteLabel ? (
                <>
                  {' '}
                  <span className="scrape-source-chip">Profile site: {websiteLabel}</span>
                </>
              ) : null}
              . Toggle Use to control agent access.
            </p>
            <div className="website-knowledge-rows" role="list">
              {knowledgeItems.map((item) => {
                const enabled = item.status === 'approved';
                return (
                  <div
                    className={`website-knowledge-row${enabled ? ' is-enabled' : ''}`}
                    key={item.id}
                    role="listitem"
                  >
                    <div className="website-knowledge-row-main">
                      <div className="website-knowledge-row-meta">
                        <span className="knowledge-card-kind">
                          {formatKindBadge(item.kind)}
                        </span>
                        <span
                          className={`status-pill status-pill-${enabled ? 'approved' : 'disabled'}`}
                        >
                          <span className="status-dot" />
                          {enabled ? 'agents can use' : 'off for agents'}
                        </span>
                        <span className="website-knowledge-row-updated">
                          {formatTimestamp(item.lastUpdated)}
                        </span>
                      </div>
                      <h3 className="website-knowledge-row-title">{item.title}</h3>
                      {item.content ? (
                        <p className="website-knowledge-row-content">{item.content}</p>
                      ) : null}
                    </div>
                    <label className="website-knowledge-toggle">
                      <input
                        checked={enabled}
                        disabled={!canManageKnowledge || phase === 'saving'}
                        onChange={() => onToggleSavedItem(item, !enabled)}
                        type="checkbox"
                      />
                      <span className="website-knowledge-toggle-track" aria-hidden="true" />
                      <span className="website-knowledge-toggle-label">
                        {enabled ? 'Use' : 'Off'}
                      </span>
                    </label>
                  </div>
                );
              })}
            </div>
          </>
        ) : !isLoadingKnowledge ? (
          <div className="empty-state">
            <div className="notice">
              No saved website knowledge yet. Scrape your site, review the results
              above, then Apply &amp; save for agents.
            </div>
          </div>
        ) : null
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
  const [lastPersistedValues, setLastPersistedValues] = useState(defaultValues);
  const [formValues, setFormValues] = useState(defaultValues);
  const [formRevision, setFormRevision] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const successTimerRef = useRef<number | null>(null);
  const handledFormSuccessKeyRef = useRef<string | null>(null);
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
  const [scrapeDraft, setScrapeDraft] = useState<WebsiteExtractionDraftView | null>(
    null,
  );
  const [scrapeSourceLabel, setScrapeSourceLabel] = useState('');
  const [applyMode, setApplyMode] = useState<ApplyExtractionPatchMode>('fillEmpty');
  const [selectedProfileKeys, setSelectedProfileKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [draftAppliedToForm, setDraftAppliedToForm] = useState(false);
  const [scrapeIsDifferentHost, setScrapeIsDifferentHost] = useState(false);
  const [knowledgeCandidates, setKnowledgeCandidates] = useState<
    WebsiteKnowledgeCandidate[]
  >([]);
  const [selectedKnowledgeKeys, setSelectedKnowledgeKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [savedKnowledgeItems, setSavedKnowledgeItems] = useState(knowledgeItems);
  const [baselineKnowledgeItems, setBaselineKnowledgeItems] =
    useState(knowledgeItems);
  const [hoursState, setHoursState] = useState<HoursState>(() =>
    hoursStateFromBusinessHours(formValues.businessHours),
  );

  const [isHoursModalOpen, setIsHoursModalOpen] = useState(false);
  const [draftHours, setDraftHours] = useState<HoursState>(hoursState);
  const [selectedTimezone, setSelectedTimezone] = useState(
    formValues.timezone ?? 'America/Toronto',
  );

  const knowledgeDirty = useMemo(() => {
    if (baselineKnowledgeItems.length !== savedKnowledgeItems.length) {
      return true;
    }
    const baselineStatus = new Map(
      baselineKnowledgeItems.map((item) => [item.id, item.status]),
    );
    return savedKnowledgeItems.some(
      (item) => baselineStatus.get(item.id) !== item.status,
    );
  }, [baselineKnowledgeItems, savedKnowledgeItems]);
  const knowledgeDirtyRef = useRef(knowledgeDirty);
  knowledgeDirtyRef.current = knowledgeDirty;

  const hasDraftReview =
    scrapeDraft != null &&
    (scrapePhase === 'ready' || scrapePhase === 'saving');
  const hasUnsavedChanges =
    isDirty || knowledgeDirty || scrapeDraft != null || knowledgeCandidates.length > 0;

  const hoursSummary = useMemo(
    () => buildBusinessHoursSummary(hoursState),
    [hoursState],
  );
  const isScraping =
    scrapePhase === 'quick' || scrapePhase === 'enrich' || scrapePhase === 'saving';
  const scrapeSourceUrl = scrapeDraft?.normalizedUrl || websiteUrl.trim();
  const savedWebsiteLabel = formatWebsiteDisplayLabel(lastPersistedValues.website ?? '');
  const profileFieldKeys = scrapeDraft ? listDraftProfileFieldKeys(scrapeDraft) : [];
  const selectedProfileCount = profileFieldKeys.filter((key) =>
    selectedProfileKeys.has(key),
  ).length;
  const selectedKnowledgeCount = knowledgeCandidates.filter((item) =>
    selectedKnowledgeKeys.has(item.key),
  ).length;
  const canApplyDraftSelection =
    selectedProfileCount > 0 || selectedKnowledgeCount > 0;

  useEffect(() => {
    if (knowledgeDirtyRef.current) {
      setSavedKnowledgeItems((prev) => {
        const prevIds = new Set(prev.map((item) => item.id));
        const extras = knowledgeItems.filter((item) => !prevIds.has(item.id));
        return extras.length > 0 ? [...prev, ...extras] : prev;
      });
      return;
    }

    setBaselineKnowledgeItems(knowledgeItems);
    setSavedKnowledgeItems((prev) => {
      if (prev.length === 0) {
        return knowledgeItems;
      }

      const byId = new Map(knowledgeItems.map((item) => [item.id, item]));
      const preserved = prev
        .map((item) => byId.get(item.id))
        .filter((item): item is BusinessKnowledgeListItem => item != null);
      const preservedIds = new Set(preserved.map((item) => item.id));
      const extras = knowledgeItems.filter((item) => !preservedIds.has(item.id));
      return [...preserved, ...extras];
    });
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

  function applySelectedProfileToForm(
    draft: WebsiteExtractionDraftView,
    mode: ApplyExtractionPatchMode,
  ): { appliedKeys: string[]; next: BusinessConfigurationValues; skippedKeys: string[] } {
    const currentRaw =
      formRef.current != null
        ? extractBusinessConfigurationValues(new FormData(formRef.current))
        : formValues;
    const patch = filterDraftFormPatch(draft, selectedProfileKeys);

    if (Object.keys(patch).length === 0) {
      return { appliedKeys: [], next: currentRaw, skippedKeys: [] };
    }

    // Replace/fillEmpty only affects selected patch keys — never wipe unchecked fields.
    const { appliedKeys, next, skippedKeys } = applyExtractionPatchToValues(
      currentRaw,
      patch,
      mode,
    );

    if (appliedKeys.length === 0) {
      return { appliedKeys, next: currentRaw, skippedKeys };
    }

    setFormValues(next);
    setHoursState(hoursStateFromBusinessHours(next.businessHours));
    setWebsiteUrl(next.website ?? '');
    setSelectedTimezone(next.timezone ?? 'America/Toronto');
    setFormRevision((value) => value + 1);
    setIsDirty(createSignature(next) !== baselineSignature);
    setDraftAppliedToForm(true);
    return { appliedKeys, next, skippedKeys };
  }

  async function persistForAgents(args: {
    approveKnowledge?: boolean;
    candidates: WebsiteKnowledgeCandidate[];
    values: BusinessConfigurationValues;
  }) {
    setScrapePhase('saving');
    const targetWebsite = args.values.website || scrapeSourceUrl;
    const differentHost = isDifferentWebsiteHost(
      lastPersistedValues.website ?? '',
      targetWebsite,
    );
    // New host: replace (or clear) prior-site knowledge so agents cannot mix sites.
    // Same host: append/dedupe so a partial selection does not delete other facts.
    const shouldReplaceKnowledge = differentHost || scrapeIsDifferentHost;
    const shouldClearKnowledge =
      shouldReplaceKnowledge && args.candidates.length === 0;

    const result = await persistScrapedBusinessDataForAgents({
      approveKnowledge: args.approveKnowledge !== false,
      clearKnowledge: shouldClearKnowledge,
      knowledgeItems: args.candidates.map((item) => ({
        content: item.content,
        kind: item.kind,
        title: item.title,
      })),
      replaceExistingKnowledge: shouldReplaceKnowledge,
      values: args.values,
    });

    if (result.kind === 'error') {
      setEnrichError(result.message);
      setKnowledgeCandidates(args.candidates);
      setSelectedKnowledgeKeys(new Set(args.candidates.map((item) => item.key)));
      setScrapePhase(scrapeDraft || args.candidates.length > 0 ? 'ready' : 'idle');
      if (result.values) {
        // Profile may already be persisted — advance cancel baseline to match DB.
        setFormValues(result.values);
        setHoursState(hoursStateFromBusinessHours(result.values.businessHours));
        setWebsiteUrl(result.values.website ?? '');
        setSelectedTimezone(result.values.timezone ?? 'America/Toronto');
        setLastPersistedValues(result.values);
        setBaselineSignature(createSignature(result.values));
        setFormRevision((value) => value + 1);
        setIsDirty(false);
      }
      return false;
    }

    setFormValues(result.values);
    setHoursState(hoursStateFromBusinessHours(result.values.businessHours));
    setWebsiteUrl(result.values.website ?? '');
    setSelectedTimezone(result.values.timezone ?? 'America/Toronto');
    setLastPersistedValues(result.values);
    setBaselineSignature(createSignature(result.values));
    setIsDirty(false);
    setFormRevision((value) => value + 1);

    if (result.replacedExistingKnowledge || result.knowledgeSavedCount > 0) {
      setSavedKnowledgeItems(result.knowledgeItems);
      setBaselineKnowledgeItems(result.knowledgeItems);
    } else if (shouldClearKnowledge) {
      setSavedKnowledgeItems([]);
      setBaselineKnowledgeItems([]);
    }

    setScrapeDraft(null);
    setDraftAppliedToForm(false);
    setScrapeIsDifferentHost(false);
    setSelectedProfileKeys(new Set());
    setKnowledgeCandidates([]);
    setSelectedKnowledgeKeys(new Set());
    setEnrichError(null);
    setScrapeError(null);
    setScrapePhase('idle');
    showToast(result.message || 'Saved.');
    return true;
  }

  useEffect(() => {
    if (state.status !== 'success' || !state.message || !state.values) {
      return;
    }

    const successKey = `${state.message}:${createSignature(state.values)}`;
    if (handledFormSuccessKeyRef.current === successKey) {
      return;
    }
    handledFormSuccessKeyRef.current = successKey;

    setFormValues(state.values);
    setHoursState(hoursStateFromBusinessHours(state.values.businessHours));
    setWebsiteUrl(state.values.website ?? '');
    setSelectedTimezone(state.values.timezone ?? 'America/Toronto');
    setLastPersistedValues(state.values);
    setBaselineSignature(createSignature(state.values));
    setIsDirty(false);
    showToast(state.message);
  }, [state]);

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
    const nextHours = draftHours;
    setHoursState(nextHours);
    setIsHoursModalOpen(false);
    const current =
      formRef.current != null
        ? extractBusinessConfigurationValues(new FormData(formRef.current))
        : formValues;
    const nextValues: BusinessConfigurationValues = {
      ...current,
      businessHours: Object.fromEntries(
        businessHoursDays.map((day) => {
          const dayVal = nextHours[day.key];
          return [
            day.key,
            {
              close: dayVal?.closed ? null : (dayVal?.close ?? null),
              closed: dayVal?.closed ?? true,
              open: dayVal?.closed ? null : (dayVal?.open ?? null),
            },
          ];
        }),
      ) as BusinessConfigurationValues['businessHours'],
    };
    setIsDirty(createSignature(nextValues) !== baselineSignature);
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

  function clearScrapeDraftState() {
    setScrapeDraft(null);
    setDraftAppliedToForm(false);
    setScrapeIsDifferentHost(false);
    setSelectedProfileKeys(new Set());
    setKnowledgeCandidates([]);
    setSelectedKnowledgeKeys(new Set());
    setEnrichError(null);
    setScrapePhase('idle');
  }

  function handleCancel() {
    if (formRef.current) {
      formRef.current.reset();
    }
    setFormValues(lastPersistedValues);
    setHoursState(hoursStateFromBusinessHours(lastPersistedValues.businessHours));
    setWebsiteUrl(lastPersistedValues.website ?? '');
    setSelectedTimezone(lastPersistedValues.timezone ?? 'America/Toronto');
    setFormRevision((value) => value + 1);
    setSavedKnowledgeItems(baselineKnowledgeItems);
    setBaselineSignature(createSignature(lastPersistedValues));
    setIsDirty(false);
    clearScrapeDraftState();
    setScrapeError(null);
    setEnrichError(null);
  }

  function handleDismissDraft() {
    if (draftAppliedToForm) {
      setFormValues(lastPersistedValues);
      setHoursState(hoursStateFromBusinessHours(lastPersistedValues.businessHours));
      setWebsiteUrl(lastPersistedValues.website ?? '');
      setSelectedTimezone(lastPersistedValues.timezone ?? 'America/Toronto');
      setFormRevision((value) => value + 1);
      setIsDirty(false);
    }
    clearScrapeDraftState();
  }

  /** Keep in-progress edits; only clear scrape review state and show the error. */
  function handleScrapeFailure(attemptedUrl: string, message: string) {
    setScrapePhase('idle');
    setScrapeDraft(null);
    setDraftAppliedToForm(false);
    setScrapeIsDifferentHost(false);
    setSelectedProfileKeys(new Set());
    setKnowledgeCandidates([]);
    setSelectedKnowledgeKeys(new Set());
    setWebsiteUrl(attemptedUrl.trim() || websiteUrl);
    setScrapeError(message);
  }

  function presentScrapeDraft(
    draft: WebsiteExtractionDraftView,
    attemptedUrl: string,
    differentHost: boolean,
  ) {
    const candidates = draftToKnowledgeCandidates(draft);
    const keys = listDraftProfileFieldKeys(draft);
    setScrapeDraft(draft);
    setScrapeSourceLabel(
      formatWebsiteDisplayLabel(draft.normalizedUrl || attemptedUrl),
    );
    setScrapeIsDifferentHost(differentHost);
    setSelectedProfileKeys(new Set(keys));
    setKnowledgeCandidates(candidates);
    setSelectedKnowledgeKeys(new Set(candidates.map((item) => item.key)));
    setDraftAppliedToForm(false);
    setScrapePhase('ready');
  }

  async function handleScrapeWebsite() {
    const attemptedUrl = websiteUrl;
    const differentHost = isDifferentWebsiteHost(
      lastPersistedValues.website ?? '',
      attemptedUrl,
    );
    const nextApplyMode: ApplyExtractionPatchMode = differentHost
      ? 'replace'
      : 'fillEmpty';

    setApplyMode(nextApplyMode);
    setScrapeIsDifferentHost(differentHost);
    setScrapePhase('quick');
    setScrapeError(null);
    setEnrichError(null);
    setScrapeDraft(null);
    setDraftAppliedToForm(false);
    setSelectedProfileKeys(new Set());
    setKnowledgeCandidates([]);
    setSelectedKnowledgeKeys(new Set());
    setScrapeSourceLabel(formatWebsiteDisplayLabel(attemptedUrl));

    try {
      const quickResult = await scrapeBusinessWebsiteQuick(attemptedUrl);
      if (quickResult.kind === 'error') {
        handleScrapeFailure(attemptedUrl, quickResult.message);
        return;
      }

      let latestDraft = quickResult.draft;
      setScrapePhase('enrich');

      const enrichUrl = quickResult.draft.normalizedUrl || attemptedUrl;
      const enrichResult = await scrapeBusinessWebsiteEnrich(enrichUrl);
      if (enrichResult.kind === 'error') {
        setEnrichError(
          `${enrichResult.message} Review what was found so far, then apply when ready.`,
        );
      } else {
        latestDraft = mergeWebsiteExtractionDrafts(quickResult.draft, enrichResult.draft);
      }

      if (
        !draftHasReviewContent(latestDraft) &&
        !draftHasKnowledgeContent(latestDraft)
      ) {
        handleScrapeFailure(
          attemptedUrl,
          formatWebsiteScrapeFailureMessage(undefined, attemptedUrl),
        );
        return;
      }

      presentScrapeDraft(latestDraft, attemptedUrl, differentHost);
      showToast('Review what we found, then apply to the form when ready.');
    } catch (error) {
      handleScrapeFailure(
        attemptedUrl,
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

  function handleToggleProfileKey(key: string) {
    if (!(profileScrapeFieldKeys as readonly string[]).includes(key)) {
      return;
    }
    setSelectedProfileKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleApplyToForm() {
    if (!scrapeDraft) {
      return;
    }
    if (selectedProfileCount === 0) {
      showToast('Select at least one profile field to apply to the form.');
      return;
    }

    const { appliedKeys, skippedKeys } = applySelectedProfileToForm(
      scrapeDraft,
      applyMode,
    );
    if (appliedKeys.length === 0) {
      showToast(
        skippedKeys.length > 0
          ? 'No fields changed — existing values were kept (fill empty only).'
          : 'No profile fields were applied.',
      );
      return;
    }

    showToast(
      'Applied to the form. Not saved for agents yet — use Apply & save for agents when ready.',
    );
  }

  async function handleApplyAndSaveForAgents() {
    if (!scrapeDraft) {
      return;
    }

    const selected = knowledgeCandidates.filter((item) =>
      selectedKnowledgeKeys.has(item.key),
    );

    if (selected.length === 0 && selectedProfileCount === 0) {
      showToast('Select at least one profile field or knowledge item to save.');
      setScrapePhase('ready');
      return;
    }

    const currentRaw =
      formRef.current != null
        ? extractBusinessConfigurationValues(new FormData(formRef.current))
        : formValues;
    const { next } =
      selectedProfileCount > 0
        ? applySelectedProfileToForm(scrapeDraft, applyMode)
        : { next: currentRaw };

    await persistForAgents({
      approveKnowledge: true,
      candidates: selected,
      values: next,
    });
  }

  function handleToggleSavedKnowledge(
    item: BusinessKnowledgeListItem,
    enabled: boolean,
  ) {
    setEnrichError(null);
    setSavedKnowledgeItems((prev) =>
      prev.map((row) =>
        row.id === item.id
          ? {
              ...row,
              status: enabled ? ('approved' as const) : ('disabled' as const),
            }
          : row,
      ),
    );
  }

  async function persistPendingKnowledgeToggles(): Promise<boolean> {
    const baselineStatus = new Map(
      baselineKnowledgeItems.map((item) => [item.id, item.status]),
    );
    const updates = savedKnowledgeItems
      .filter((item) => baselineStatus.get(item.id) !== item.status)
      .map((item) => ({
        enabled: item.status === 'approved',
        knowledgeId: item.id,
      }));

    if (updates.length === 0) {
      return true;
    }

    setScrapePhase('saving');
    const result = await saveBusinessKnowledgeToggleStates({ updates });
    if (result.kind === 'error') {
      setEnrichError(result.message);
      setScrapePhase(scrapeDraft ? 'ready' : 'idle');
      return false;
    }

    const updatedById = new Map(result.items.map((item) => [item.id, item]));
    setSavedKnowledgeItems((prev) =>
      prev.map((item) => updatedById.get(item.id) ?? item),
    );
    setBaselineKnowledgeItems((prev) =>
      prev.map((item) => updatedById.get(item.id) ?? item),
    );
    setScrapePhase(scrapeDraft ? 'ready' : 'idle');
    return true;
  }

  async function handleSaveProfileAndKnowledge() {
    if (scrapeDraft && scrapePhase === 'ready') {
      if (!canApplyDraftSelection) {
        showToast('Select at least one profile field or knowledge item to save.');
        return;
      }
      await handleApplyAndSaveForAgents();
      return;
    }

    const current =
      formRef.current != null
        ? extractBusinessConfigurationValues(new FormData(formRef.current))
        : formValues;
    const selected = knowledgeCandidates.filter((item) =>
      selectedKnowledgeKeys.has(item.key),
    );

    if (selected.length > 0) {
      await persistForAgents({
        approveKnowledge: true,
        candidates: selected,
        values: current,
      });
      return;
    }

    if (knowledgeCandidates.length > 0) {
      showToast('Select at least one knowledge item to save for agents.');
      return;
    }

    const togglesSaved = await persistPendingKnowledgeToggles();
    if (!togglesSaved) {
      return;
    }

    if (isDirty && formRef.current) {
      formRef.current.requestSubmit();
      return;
    }

    showToast('Knowledge toggles saved.');
  }

  const showReviewPanel =
    hasDraftReview &&
    scrapeDraft != null &&
    (profileFieldKeys.length > 0 || knowledgeCandidates.length > 0);

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
            Paste your website, scrape, then review what we found before applying
            it to the form or saving it for agents.
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
        <section className="business-form-section">
          <div className="business-form-section-heading">
            <h3 className="business-form-section-title">Website scrape</h3>
            <p className="business-form-section-text">
              Results stay in review until you apply them. Saving a different
              website replaces prior website knowledge for agents. Same-site
              re-scrapes add or update selected knowledge without wiping the rest.
            </p>
          </div>
          <div className="business-form-grid">
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
            </div>
          </div>

          {showReviewPanel && scrapeDraft ? (
            <div
              className={`scrape-draft${draftAppliedToForm ? ' is-applied' : ''}`}
            >
              <div className="scrape-draft-header">
                <div className="scrape-draft-header-left">
                  <span className="scrape-draft-title">Found from this website</span>
                  <span className="scrape-source-chip">
                    From {scrapeSourceLabel || 'website'}
                  </span>
                  <span className="status-pill status-pill-draft">
                    <span className="status-dot" />
                    {draftAppliedToForm ? 'Applied to form' : 'Review'}
                  </span>
                </div>
                <button
                  className="scrape-draft-dismiss"
                  disabled={scrapePhase === 'saving'}
                  onClick={handleDismissDraft}
                  type="button"
                >
                  Dismiss
                </button>
              </div>

              {scrapeSourceUrl ? (
                <p className="scrape-draft-notice">
                  Source:{' '}
                  <a href={scrapeSourceUrl} rel="noreferrer" target="_blank">
                    {scrapeSourceUrl}
                  </a>
                </p>
              ) : null}

              <div className="scrape-apply-mode" role="radiogroup" aria-label="Apply mode">
                <label>
                  <input
                    checked={applyMode === 'replace'}
                    disabled={scrapePhase === 'saving'}
                    name="scrape-apply-mode"
                    onChange={() => setApplyMode('replace')}
                    type="radio"
                    value="replace"
                  />
                  Replace selected fields
                </label>
                <label>
                  <input
                    checked={applyMode === 'fillEmpty'}
                    disabled={scrapePhase === 'saving'}
                    name="scrape-apply-mode"
                    onChange={() => setApplyMode('fillEmpty')}
                    type="radio"
                    value="fillEmpty"
                  />
                  Fill empty only
                </label>
              </div>
              {scrapeIsDifferentHost ? (
                <p className="scrape-draft-notice">
                  This looks like a different website. Saving for agents will replace
                  previous website knowledge so agents do not mix old and new sites.
                </p>
              ) : null}

              {scrapeDraft.fields.businessName?.value ? (
                <p className="scrape-draft-notice">
                  Detected business name:{' '}
                  <strong>{scrapeDraft.fields.businessName.value}</strong>
                  {' '}(edit Business name above yourself — scrape does not overwrite it)
                </p>
              ) : null}

              {profileFieldKeys.length > 0 ? (
                <div className="scrape-draft-section">
                  <h4 className="scrape-draft-section-title">Profile fields</h4>
                  <div className="scrape-draft-fields">
                    {profileFieldKeys.map((key) => {
                      const checked = selectedProfileKeys.has(key);
                      return (
                        <label className="scrape-draft-field" key={key}>
                          <div className="scrape-draft-field-meta">
                            <span className="scrape-draft-label">
                              <input
                                checked={checked}
                                disabled={scrapePhase === 'saving'}
                                onChange={() => handleToggleProfileKey(key)}
                                type="checkbox"
                              />{' '}
                              {formatProfileFieldLabel(key)}
                            </span>
                          </div>
                          <span className="scrape-draft-value">
                            {formatDraftProfileValue(scrapeDraft, key)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {knowledgeCandidates.length > 0 ? (
                <div className="scrape-draft-section">
                  <h4 className="scrape-draft-section-title">
                    Knowledge candidates ({selectedKnowledgeCount} selected)
                  </h4>
                  <div className="website-knowledge-candidates">
                    {knowledgeCandidates.map((item) => {
                      const checked = selectedKnowledgeKeys.has(item.key);
                      return (
                        <label
                          className={`website-knowledge-candidate${checked ? ' is-selected' : ''}`}
                          key={item.key}
                        >
                          <input
                            checked={checked}
                            disabled={scrapePhase === 'saving'}
                            onChange={() => handleToggleCandidate(item.key)}
                            type="checkbox"
                          />
                          <span className="website-knowledge-candidate-body">
                            <span className="website-knowledge-candidate-meta">
                              <span className="knowledge-card-kind">
                                {formatKindBadge(item.kind)}
                              </span>
                              <ProvenanceBadges
                                confidence={item.confidence}
                                source={item.source}
                              />
                            </span>
                            <span className="website-knowledge-candidate-title">
                              {item.title}
                            </span>
                            <span className="website-knowledge-candidate-content">
                              {item.content}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="scrape-draft-actions">
                <button
                  className="button-secondary"
                  disabled={scrapePhase === 'saving' || selectedProfileCount === 0}
                  onClick={handleApplyToForm}
                  type="button"
                >
                  Apply to form
                </button>
                {canManageKnowledge ? (
                  <button
                    className="button"
                    disabled={scrapePhase === 'saving' || !canApplyDraftSelection}
                    onClick={() => {
                      void handleApplyAndSaveForAgents();
                    }}
                    type="button"
                  >
                    {scrapePhase === 'saving'
                      ? 'Saving…'
                      : 'Apply & save for agents'}
                  </button>
                ) : (
                  <p className="scrape-draft-hint">
                    Only owners and admins can save website knowledge for agents.
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </section>

        <section className="business-form-section">
          <div className="business-form-section-heading">
            <h3 className="business-form-section-title">Required from you</h3>
            <p className="business-form-section-text">
              These identify your business and are not filled by website scrape.
            </p>
          </div>
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

            <div className="field field-span-2">
              <label htmlFor="timezone">Timezone</label>
              <TimezoneCombobox
                disabled={!canEdit || isPending}
                name="timezone"
                onValueChange={updateDirtyState}
                value={formValues.timezone}
              />
            </div>
          </div>
        </section>

        <section className="business-form-section">
          <div className="business-form-section-heading">
            <h3 className="business-form-section-title">Website-assisted fields</h3>
            <p className="business-form-section-text">
              Edit these manually, or apply selected values from a scrape review.
            </p>
          </div>
          <div className="business-form-grid">
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

            <div className="field field-span-2">
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
          </div>
        </section>

        <section className="hours-panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Business Hours</h2>
              <p className="panel-subtitle">
                Set manually or apply hours from a scrape review.
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
        enrichError={enrichError}
        knowledgeItems={savedKnowledgeItems}
        onToggleSavedItem={(item, enabled) => {
          handleToggleSavedKnowledge(item, enabled);
        }}
        phase={scrapePhase}
        scrapeError={scrapeError}
        websiteLabel={
          savedWebsiteLabel && savedWebsiteLabel !== 'that website'
            ? savedWebsiteLabel
            : ''
        }
      />

      {canEdit ? (
        <div className="sticky-action-bar">
          <div className="sticky-action-bar-inner">
            <div
              className={`sticky-action-bar-status${hasUnsavedChanges ? ' is-dirty' : ''}`}
            >
              {hasUnsavedChanges ? 'Unsaved changes' : 'All changes saved'}
            </div>
            <div className="sticky-action-bar-actions">
              <button
                className="button-secondary"
                disabled={!hasUnsavedChanges || isPending || scrapePhase === 'saving'}
                onClick={handleCancel}
                type="button"
              >
                Cancel
              </button>
              <button
                className="button"
                disabled={
                  !hasUnsavedChanges ||
                  isPending ||
                  scrapePhase === 'saving' ||
                  (Boolean(scrapeDraft) &&
                    scrapePhase === 'ready' &&
                    !canApplyDraftSelection)
                }
                form="business-configuration-form"
                onClick={(event) => {
                  if (
                    scrapeDraft != null ||
                    knowledgeCandidates.length > 0 ||
                    knowledgeDirty
                  ) {
                    event.preventDefault();
                    void handleSaveProfileAndKnowledge();
                  }
                }}
                type="submit"
              >
                {isPending || scrapePhase === 'saving'
                  ? 'Saving...'
                  : scrapeDraft != null || knowledgeCandidates.length > 0
                    ? 'Save for agents'
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
