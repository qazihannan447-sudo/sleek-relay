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
import { EyeIcon, SaveIcon } from '../../../components/icons';
import {
  clearSavedBusinessKnowledge,
  persistScrapedBusinessDataForAgents,
  saveBusinessConfiguration,
  saveBusinessKnowledgeToggleStates,
  scrapeBusinessWebsiteEnrich,
  scrapeBusinessWebsiteQuick,
} from './actions';
import { CustomSelect } from '../agents/custom-select';
import { TimezoneCombobox } from './timezone-combobox';

const handoffDestinationOptions = [
  { label: 'None', value: 'none' },
  { label: 'Callback request', value: 'callback' },
  { label: 'Share a phone number', value: 'phone_info' },
  { label: 'Share an email address', value: 'email_info' },
] as const;

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

const websiteAssistedFieldKeys = [
  'category',
  'businessPhone',
  'contactEmail',
] as const;

const fieldPlaceholders = {
  businessName: 'Acme Dental Care',
  businessPhone: '+1 (555) 123-4567',
  category: 'Family dental clinic',
  contactEmail: 'hello@acmedental.com',
  contactName: 'Taylor Morgan',
  website: 'acmedental.com',
} as const;

const SUPPRESSED_ENRICH_NOTICES = new Set([
  'Enrich web scraping couldn’t be completed, but the structural information has been collected.',
  'Enrich web scraping couldn’t be done because the LLM credits ended, but the structural information has been collected.',
  'Enrich web scraping couldnâ€™t be completed, but the structural information has been collected.',
  'Enrich web scraping couldnâ€™t be done because the LLM credits ended, but the structural information has been collected.',
]);

function shouldShowEnrichError(message: string | null): message is string {
  if (!message) {
    return false;
  }

  return !SUPPRESSED_ENRICH_NOTICES.has(message.trim());
}

function createSignature(values: BusinessConfigurationValues): string {
  // Notification WhatsApp is deferred and no longer edited in the form.
  return JSON.stringify({ ...values, notificationWhatsapp: '' });
}

function clearMissingWebsiteAssistedFields(
  values: BusinessConfigurationValues,
  draft: WebsiteExtractionDraftView,
): BusinessConfigurationValues {
  let next = values;

  for (const key of websiteAssistedFieldKeys) {
    if (draft.formPatch[key] === undefined && next[key]) {
      if (next === values) {
        next = { ...values };
      }
      next[key] = '';
    }
  }

  return next;
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
  hasSavedKnowledge,
  isClearingKnowledge,
  knowledgeItems,
  onOpenReview,
  onRequestClearKnowledge,
  onToggleSavedItem,
  phase,
  scrapeError,
  websiteLabel,
}: {
  canManageKnowledge: boolean;
  enrichError: string | null;
  hasSavedKnowledge: boolean;
  isClearingKnowledge: boolean;
  knowledgeItems: BusinessKnowledgeListItem[];
  onOpenReview: () => void;
  onRequestClearKnowledge: () => void;
  onToggleSavedItem: (_item: BusinessKnowledgeListItem, _enabled: boolean) => void;
  phase: ScrapePhase;
  scrapeError: string | null;
  websiteLabel: string;
}) {
  const isLoadingKnowledge = phase === 'quick' || phase === 'enrich';
  const isReviewing = phase === 'ready' || phase === 'saving';
  const showLive = !isLoadingKnowledge;
  const canClearSavedKnowledge =
    canManageKnowledge &&
    knowledgeItems.length > 0 &&
    !isLoadingKnowledge &&
    phase !== 'saving' &&
    !isClearingKnowledge;

  return (
    <section className="website-knowledge-panel" id="knowledge-for-agents">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">Knowledge for agents</h2>
          <p className="panel-subtitle">
            Saved knowledge for this business. Only rows marked “agents can use”
            are included in the agent prompt.
          </p>
        </div>
        {canManageKnowledge && knowledgeItems.length > 0 && !isLoadingKnowledge ? (
          <div className="website-knowledge-panel-header-actions">
            <button
              className="button-secondary website-knowledge-clear-button"
              disabled={!canClearSavedKnowledge}
              onClick={onRequestClearKnowledge}
              type="button"
            >
              {isClearingKnowledge ? 'Clearing…' : 'Clear saved knowledge'}
            </button>
          </div>
        ) : null}
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
        <div className="scrape-enrich-banner" role="status">
          <p className="scrape-enrich-banner-title">Website enrich incomplete</p>
          <p className="scrape-enrich-banner-text">{enrichError}</p>
        </div>
      ) : null}

      {isReviewing ? (
        <button
          className="website-knowledge-review-card"
          disabled={phase === 'saving'}
          onClick={onOpenReview}
          type="button"
        >
          <span className="website-knowledge-review-icon" aria-hidden="true">
            <EyeIcon />
          </span>
          <div>
            <p className="website-knowledge-review-title">
              New scrape results are ready to review
            </p>
            <p className="website-knowledge-review-text">
              The list below is what agents currently use until you save changes
              from the review drawer.
            </p>
          </div>
        </button>
      ) : null}

      {scrapeError && phase === 'idle' && hasSavedKnowledge ? (
        <div
          className="notice notice-danger notice-full"
          style={{ marginBottom: '12px' }}
        >
          Scrape did not update knowledge. Previously saved knowledge below is
          unchanged.
        </div>
      ) : null}

      {showLive ? (
        knowledgeItems.length > 0 ? (
          <>
            <p className="website-knowledge-summary">
              <span className="website-knowledge-summary-label">Saved knowledge</span>
              {websiteLabel ? (
                <>
                  <span className="scrape-source-chip website-knowledge-site-chip">
                    Profile site: {websiteLabel}
                  </span>
                </>
              ) : null}
              <span className="website-knowledge-summary-text">
                Toggle Use to control agent access.
              </span>
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
                        disabled={
                          !canManageKnowledge ||
                          phase === 'saving' ||
                          isClearingKnowledge
                        }
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
  const [failedScrapeWebsite, setFailedScrapeWebsite] = useState<string | null>(
    null,
  );
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [scrapeDraft, setScrapeDraft] = useState<WebsiteExtractionDraftView | null>(
    null,
  );
  const [scrapeSourceLabel, setScrapeSourceLabel] = useState('');
  const [isScrapeModalOpen, setIsScrapeModalOpen] = useState(false);
  const [applyMode, setApplyMode] = useState<ApplyExtractionPatchMode>('replace');
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
  const [isClearKnowledgeModalOpen, setIsClearKnowledgeModalOpen] =
    useState(false);
  const [isClearingKnowledge, setIsClearingKnowledge] = useState(false);

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
  const visibleEnrichError = shouldShowEnrichError(enrichError)
    ? enrichError
    : null;
  const hasUnsavedChanges =
    isDirty || knowledgeDirty || scrapeDraft != null || knowledgeCandidates.length > 0;
  const isFailedScrapeWebsiteActive =
    Boolean(failedScrapeWebsite?.trim()) &&
    Boolean(websiteUrl.trim()) &&
    !isDifferentWebsiteHost(failedScrapeWebsite ?? '', websiteUrl);

  const hoursSummary = useMemo(
    () => buildBusinessHoursSummary(hoursState),
    [hoursState],
  );
  const isScraping =
    scrapePhase === 'quick' || scrapePhase === 'enrich' || scrapePhase === 'saving';
  const scrapeBusy = isScraping || isClearingKnowledge;
  const scrapeSourceUrl = scrapeDraft?.normalizedUrl || websiteUrl.trim();
  const savedWebsiteLabel = formatWebsiteDisplayLabel(lastPersistedValues.website ?? '');
  const profileSiteLabelForKnowledge = (() => {
    const persistedWebsite = lastPersistedValues.website ?? '';
    if (!persistedWebsite.trim()) {
      return '';
    }

    const currentWebsite = websiteUrl.trim();
    // Don't advertise a profile site that has been cleared or replaced in the form.
    if (!currentWebsite || isDifferentWebsiteHost(persistedWebsite, currentWebsite)) {
      return '';
    }

    return savedWebsiteLabel && savedWebsiteLabel !== 'that website'
      ? savedWebsiteLabel
      : '';
  })();
  const profileFieldKeys = scrapeDraft ? listDraftProfileFieldKeys(scrapeDraft) : [];
  const selectedProfileCount = profileFieldKeys.filter((key) =>
    selectedProfileKeys.has(key),
  ).length;
  const selectedKnowledgeCount = knowledgeCandidates.filter((item) =>
    selectedKnowledgeKeys.has(item.key),
  ).length;
  const canApplyDraftSelection =
    selectedProfileCount > 0 || selectedKnowledgeCount > 0;
  const canSaveConfiguration =
    hasUnsavedChanges &&
    !isPending &&
    scrapePhase !== 'saving' &&
    !isClearingKnowledge &&
    !isFailedScrapeWebsiteActive &&
    !(Boolean(scrapeDraft) && scrapePhase === 'ready' && !canApplyDraftSelection);

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
    replaceKnowledge?: boolean;
    values: BusinessConfigurationValues;
  }) {
    setScrapePhase('saving');
    const targetWebsite = args.values.website || scrapeSourceUrl;
    const differentHost = isDifferentWebsiteHost(
      lastPersistedValues.website ?? '',
      targetWebsite,
    );
    // Review drawer saves replace current website knowledge with the selected results.
    const shouldReplaceKnowledge =
      args.replaceKnowledge === true || differentHost || scrapeIsDifferentHost;
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
    setFailedScrapeWebsite(null);
    setScrapePhase('idle');
    setIsScrapeModalOpen(false);
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
    setScrapeError(null);
    setFailedScrapeWebsite(null);
    showToast(state.message);
  }, [state]);

  useEffect(() => {
    return () => {
      if (successTimerRef.current !== null) {
        window.clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isClearKnowledgeModalOpen) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isClearingKnowledge) {
        setIsClearKnowledgeModalOpen(false);
      }
    }

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isClearKnowledgeModalOpen, isClearingKnowledge]);

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
    setIsScrapeModalOpen(false);
  }

  /** Hide the popup without discarding the reviewed draft, so it can be reopened. */
  function handleCloseScrapeModal() {
    setIsScrapeModalOpen(false);
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
    // Keep failedScrapeWebsite so Cancel → re-enter the same bad URL still blocks save.
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

  /** Keep other in-progress edits; restore website to the last saved profile site. */
  function revertWebsiteFieldToLastPersisted() {
    const restoredWebsite = lastPersistedValues.website ?? '';
    applyWebsiteFieldValue(restoredWebsite);
  }

  function applyWebsiteFieldValue(nextWebsite: string) {
    const current =
      formRef.current != null
        ? extractBusinessConfigurationValues(new FormData(formRef.current))
        : formValues;
    const next: BusinessConfigurationValues = {
      ...current,
      website: nextWebsite,
    };
    setFormValues(next);
    setWebsiteUrl(nextWebsite);
    setFormRevision((value) => value + 1);
    setIsDirty(createSignature(next) !== baselineSignature);
  }

  /** Keep in-progress edits; only clear scrape review state and show the error. */
  function handleScrapeFailure(attemptedUrl: string, message: string) {
    const attempted = attemptedUrl.trim();
    setScrapePhase('idle');
    setScrapeDraft(null);
    setDraftAppliedToForm(false);
    setScrapeIsDifferentHost(false);
    setSelectedProfileKeys(new Set());
    setKnowledgeCandidates([]);
    setSelectedKnowledgeKeys(new Set());
    setFailedScrapeWebsite(attempted || null);
    setIsScrapeModalOpen(false);

    const failedMatchesPersistedSite =
      Boolean(attempted) &&
      Boolean(lastPersistedValues.website?.trim()) &&
      !isDifferentWebsiteHost(lastPersistedValues.website ?? '', attempted);

    if (failedMatchesPersistedSite) {
      // Persisted profile site itself failed — clear it from the form so Save
      // can remove the bad "Profile site" label instead of keeping it.
      applyWebsiteFieldValue('');
      const clearedHint =
        'The website field was cleared — save the profile to remove it, or enter a working site.';
      setScrapeError(
        /Profile below is unchanged\.?/i.test(message)
          ? message.replace(/Profile below is unchanged\.?/i, clearedHint)
          : `${message} ${clearedHint}`,
      );
    } else {
      revertWebsiteFieldToLastPersisted();
      setScrapeError(message);
    }
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
    setScrapeError(null);
    setFailedScrapeWebsite(null);
    setScrapePhase('ready');
    setIsScrapeModalOpen(true);
  }

  async function handleScrapeWebsite() {
    const attemptedUrl = websiteUrl;
    const differentHost = isDifferentWebsiteHost(
      lastPersistedValues.website ?? '',
      attemptedUrl,
    );
    const nextApplyMode: ApplyExtractionPatchMode = 'replace';

    setApplyMode(nextApplyMode);
    setScrapeIsDifferentHost(differentHost);
    setScrapePhase('quick');
    setScrapeError(null);
    setFailedScrapeWebsite(null);
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
        if (enrichResult.enrichNotice) {
          setEnrichError(enrichResult.enrichNotice);
        }
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
    const nextWithSelectedProfile =
      selectedProfileCount > 0
        ? applySelectedProfileToForm(scrapeDraft, applyMode).next
        : currentRaw;
    const next = clearMissingWebsiteAssistedFields(
      nextWithSelectedProfile,
      scrapeDraft,
    );

    await persistForAgents({
      approveKnowledge: true,
      candidates: selected,
      replaceKnowledge: true,
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

  function handleRequestClearSavedKnowledge() {
    if (
      !canManageKnowledge ||
      savedKnowledgeItems.length === 0 ||
      isClearingKnowledge ||
      scrapePhase === 'saving' ||
      scrapePhase === 'quick' ||
      scrapePhase === 'enrich'
    ) {
      return;
    }
    setEnrichError(null);
    setIsClearKnowledgeModalOpen(true);
  }

  async function handleConfirmClearSavedKnowledge() {
    if (!canManageKnowledge || isClearingKnowledge || scrapePhase === 'saving') {
      return;
    }

    setIsClearingKnowledge(true);
    const result = await clearSavedBusinessKnowledge();

    if (result.kind === 'error') {
      setEnrichError(result.message);
      setIsClearingKnowledge(false);
      setIsClearKnowledgeModalOpen(false);
      return;
    }

    setSavedKnowledgeItems([]);
    setBaselineKnowledgeItems([]);
    setEnrichError(null);
    setIsClearingKnowledge(false);
    setIsClearKnowledgeModalOpen(false);
    showToast(result.message);
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
    if (isFailedScrapeWebsiteActive) {
      showToast(
        'That website could not be scraped. Change the website or scrape a valid site before saving.',
      );
      return;
    }

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

      <form
        action={formAction}
        className="business-form"
        id="business-configuration-form"
        key={formKey}
        onChange={updateDirtyState}
        onInput={updateDirtyState}
        onSubmit={(event) => {
          if (isFailedScrapeWebsiteActive) {
            event.preventDefault();
            showToast(
              'That website could not be scraped. Change the website or scrape a valid site before saving.',
            );
          }
        }}
        ref={formRef}
      >
        <section className="business-form-section" id="website-scrape">
          <div className="business-form-section-heading">
            <h3 className="business-form-section-title">Website scrape</h3>
            <p className="business-form-section-text">
              Results stay in review until you save changes. Saving changes
              replaces prior website knowledge for agents with your selected
              results.
            </p>
          </div>
          <div className="business-form-grid">
            <div className="field field-span-2">
              <label htmlFor="website">Website</label>
              <div className="field-input-row website-scrape-row">
                <input
                  defaultValue={formValues.website}
                  disabled={!canEdit || isPending || scrapeBusy}
                  id="website"
                  name="website"
                  onChange={(e) => {
                    const nextWebsite = e.target.value;
                    setWebsiteUrl(nextWebsite);
                    if (
                      failedScrapeWebsite &&
                      isDifferentWebsiteHost(failedScrapeWebsite, nextWebsite)
                    ) {
                      setScrapeError(null);
                    }
                  }}
                  placeholder={fieldPlaceholders.website}
                  type="text"
                />
                {canEdit ? (
                  <button
                    className="button-secondary"
                    disabled={!websiteUrl.trim() || scrapeBusy || isPending}
                    onClick={(e) => {
                      e.preventDefault();
                      void handleScrapeWebsite();
                    }}
                    type="button"
                  >
                    {isScraping ? 'Scraping…' : 'Scrape website info'}
                  </button>
                ) : null}
                {showReviewPanel && scrapeDraft ? (
                  <button
                    className="button website-scrape-review-button"
                    disabled={scrapePhase === 'saving'}
                    onClick={(e) => {
                      e.preventDefault();
                      setIsScrapeModalOpen(true);
                    }}
                    type="button"
                  >
                    <EyeIcon />
                    <span>Review</span>
                    <span className="website-scrape-review-count">
                      {profileFieldKeys.length + knowledgeCandidates.length}
                    </span>
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
                <div className="notice notice-danger notice-full">{scrapeError}</div>
              ) : null}
      {visibleEnrichError ? (
        <div className="scrape-enrich-banner" role="status">
          <p className="scrape-enrich-banner-title">Website enrich incomplete</p>
          <p className="scrape-enrich-banner-text">{visibleEnrichError}</p>
        </div>
      ) : null}
              {isFailedScrapeWebsiteActive && !scrapeError ? (
                <div className="notice notice-danger notice-full">
                  “{formatWebsiteDisplayLabel(websiteUrl)}” failed scraping.
                  Change the website or scrape a valid site before saving it to
                  the profile.
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="business-form-section" id="required-from-you">
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

        <section className="business-form-section" id="contact-details">
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

        <section className="hours-panel" id="business-hours">
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

        <section className="business-form-section">
          <div className="business-form-section-heading">
            <h3 className="business-form-section-title">
              Handoff and appointments
            </h3>
            <p className="business-form-section-text">
              Shared business policy and destinations used by enabled agent
              workflows. Appointments stay requests until staff confirm them.
            </p>
          </div>

          <div className="field">
            <label htmlFor="appointmentPolicy">Appointment policy</label>
            <textarea
              defaultValue={formValues.appointmentPolicy}
              disabled={!canEdit || isPending}
              id="appointmentPolicy"
              name="appointmentPolicy"
              onChange={updateDirtyState}
              placeholder="We accept appointment requests only. A team member will confirm availability."
              rows={3}
            />
          </div>

          <div className="business-form-grid" style={{ marginTop: '20px' }}>
            <div className="field">
              <label htmlFor="handoffDestinationType">Handoff destination</label>
              <CustomSelect
                disabled={!canEdit || isPending}
                id="handoffDestinationType"
                name="handoffDestinationType"
                onChange={updateDirtyState}
                options={handoffDestinationOptions}
                value={formValues.handoffDestinationType}
              />
            </div>

            <div className="field">
              <label htmlFor="handoffDestinationValue">
                Destination phone or email
              </label>
              <input
                defaultValue={formValues.handoffDestinationValue}
                disabled={!canEdit || isPending}
                id="handoffDestinationValue"
                name="handoffDestinationValue"
                onChange={updateDirtyState}
                placeholder="+1 (555) 123-4567 or owner@business.com"
                type="text"
              />
            </div>

            <div className="field field-span-2">
              <label htmlFor="handoffScript">Handoff script</label>
              <textarea
                defaultValue={formValues.handoffScript}
                disabled={!canEdit || isPending}
                id="handoffScript"
                name="handoffScript"
                onChange={updateDirtyState}
                placeholder="I can have someone from the team call you back. I've noted your request."
                rows={3}
              />
            </div>

            <div className="field field-span-2">
              <label htmlFor="notificationEmail">Notification email</label>
              <p
                className="hint-text"
                style={{ fontSize: '0.85rem', margin: '-4px 0 4px 0' }}
              >
                Post-call close-off emails are sent to this address via Resend.
                If empty, the Contact email above is used. Delivery status
                appears in Notifications.
              </p>
              <input
                defaultValue={formValues.notificationEmail}
                disabled={!canEdit || isPending}
                id="notificationEmail"
                name="notificationEmail"
                onChange={updateDirtyState}
                placeholder="alerts@business.com"
                type="email"
              />
            </div>
          </div>
        </section>

        {state.status === 'error' && state.message ? (
          <div className="notice notice-danger notice-full">{state.message}</div>
        ) : null}
      </form>

      <WebsiteKnowledgePanel
        canManageKnowledge={canManageKnowledge}
        enrichError={enrichError}
        hasSavedKnowledge={savedKnowledgeItems.length > 0}
        isClearingKnowledge={isClearingKnowledge}
        knowledgeItems={savedKnowledgeItems}
        onOpenReview={() => {
          setIsScrapeModalOpen(true);
        }}
        onRequestClearKnowledge={handleRequestClearSavedKnowledge}
        onToggleSavedItem={(item, enabled) => {
          handleToggleSavedKnowledge(item, enabled);
        }}
        phase={scrapePhase}
        scrapeError={scrapeError}
        websiteLabel={profileSiteLabelForKnowledge}
      />

      {canEdit ? (
        <div className="sticky-action-bar">
          <div className="sticky-action-bar-inner">
            <div
              className={`sticky-action-bar-status${hasUnsavedChanges || isFailedScrapeWebsiteActive ? ' is-dirty' : ''}`}
            >
              {isFailedScrapeWebsiteActive
                ? 'Website scrape failed — fix before saving'
                : hasUnsavedChanges
                  ? 'Unsaved changes'
                  : 'All changes saved'}
            </div>
            <div className="sticky-action-bar-actions">
              <button
                className="button-secondary"
                disabled={
                  (!hasUnsavedChanges && !isFailedScrapeWebsiteActive) ||
                  isPending ||
                  scrapePhase === 'saving' ||
                  isClearingKnowledge
                }
                onClick={handleCancel}
                type="button"
              >
                Cancel
              </button>
              <button
                className="button"
                disabled={!canSaveConfiguration}
                form="business-configuration-form"
                onClick={(event) => {
                  if (isFailedScrapeWebsiteActive) {
                    event.preventDefault();
                    showToast(
                      'That website could not be scraped. Change the website or scrape a valid site before saving.',
                    );
                    return;
                  }
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
                  : isClearingKnowledge
                    ? 'Clearing...'
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

      {isScrapeModalOpen && scrapeDraft ? (
        <div className="scrape-modal-overlay" onClick={handleCloseScrapeModal}>
          <div className="scrape-modal-backdrop" />
          <div
            aria-modal="true"
            className="scrape-modal-dialog"
            aria-labelledby="scrape-review-title"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
          >
            <div className="scrape-modal-header">
              <div>
                <span className="eyebrow">Website scrape review</span>
                <h2 className="scrape-modal-title" id="scrape-review-title">
                  New information found
                </h2>
                <p className="scrape-modal-subtitle">
                  Review what we found on {scrapeSourceLabel || 'your website'},
                  then save the selected changes for agents.
                </p>
                <span className="status-pill status-pill-draft">
                  <span className="status-dot" />
                  {draftAppliedToForm ? 'Applied to form' : 'Review'}
                </span>
              </div>
              <button
                aria-label="Close panel"
                className="scrape-modal-close"
                onClick={handleCloseScrapeModal}
                type="button"
              >
                ✕
              </button>
            </div>

            <div className="scrape-modal-body">
              {scrapeSourceUrl ? (
                <p className="scrape-draft-notice">
                  Source:{' '}
                  <a href={scrapeSourceUrl} rel="noreferrer" target="_blank">
                    {scrapeSourceUrl}
                  </a>
                </p>
              ) : null}

              {visibleEnrichError ? (
                <div className="scrape-enrich-banner" role="status">
                  <p className="scrape-enrich-banner-title">Website enrich incomplete</p>
                  <p className="scrape-enrich-banner-text">{visibleEnrichError}</p>
                </div>
              ) : null}

              <div
                className="scrape-apply-mode"
                role="radiogroup"
                aria-label="Apply mode"
              >
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
                  This looks like a different website. Saving for agents will
                  replace previous website knowledge so agents do not mix old
                  and new sites.
                </p>
              ) : null}

              {scrapeDraft.fields.businessName?.value ? (
                <p className="scrape-draft-notice">
                  Detected business name:{' '}
                  <strong>{scrapeDraft.fields.businessName.value}</strong>
                  {' '}(edit Business name above yourself — scrape does not
                  overwrite it)
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
            </div>

            <div className="scrape-modal-footer">
              <button
                className="scrape-draft-dismiss"
                disabled={scrapePhase === 'saving'}
                onClick={handleDismissDraft}
                type="button"
              >
                Dismiss
              </button>
              <div className="scrape-modal-footer-actions">
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
                      : (
                        <>
                          <SaveIcon />
                          Apply & save for agents
                        </>
                      )}
                  </button>
                ) : (
                  <p className="scrape-draft-hint">
                    Only owners and admins can save website knowledge for
                    agents.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isClearKnowledgeModalOpen ? (
        <div
          className="confirm-modal-overlay"
          onClick={() => {
            if (!isClearingKnowledge) {
              setIsClearKnowledgeModalOpen(false);
            }
          }}
        >
          <div className="confirm-modal-backdrop" />
          <div
            aria-describedby="clear-knowledge-description"
            aria-labelledby="clear-knowledge-title"
            aria-modal="true"
            className="confirm-modal-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="confirm-modal-header">
              <h2 className="confirm-modal-title" id="clear-knowledge-title">
                Clear saved knowledge?
              </h2>
              <p
                className="confirm-modal-subtitle"
                id="clear-knowledge-description"
              >
                This removes{' '}
                {savedKnowledgeItems.length === 1
                  ? '1 saved knowledge item'
                  : `${savedKnowledgeItems.length} saved knowledge items`}{' '}
                from agents. Business profile fields above are not changed.
                You can scrape and save again later.
              </p>
            </div>
            <div className="confirm-modal-footer">
              <button
                autoFocus
                className="button-secondary"
                disabled={isClearingKnowledge}
                onClick={() => setIsClearKnowledgeModalOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="button confirm-modal-danger-button"
                disabled={isClearingKnowledge}
                onClick={() => {
                  void handleConfirmClearSavedKnowledge();
                }}
                type="button"
              >
                {isClearingKnowledge ? 'Clearing…' : 'Clear knowledge'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
