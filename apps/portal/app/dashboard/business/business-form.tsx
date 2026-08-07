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
  draftHasApplicableProfileFields,
  type WebsiteExtractionDraftView,
} from '../../../lib/business-configuration/website-extraction';
import { saveBusinessConfiguration, scrapeBusinessWebsite } from './actions';
import { TimezoneCombobox } from './timezone-combobox';

type ScrapeOutcome =
  | { draft: WebsiteExtractionDraftView; kind: 'success' }
  | { kind: 'error'; message: string };

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

function ScrapedDraftPreview({
  draft,
  isApplied,
  onApply,
  onDismiss,
}: {
  draft: WebsiteExtractionDraftView;
  isApplied: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const { fields } = draft;
  const canApply = draftHasApplicableProfileFields(draft);

  const profileRows: Array<{
    confidence: string;
    label: string;
    source: string;
    value: string;
  }> = [];

  if (fields.businessName) {
    profileRows.push({
      confidence: fields.businessName.confidence,
      label: 'Business name',
      source: fields.businessName.source,
      value: fields.businessName.value,
    });
  }
  if (fields.category) {
    profileRows.push({
      confidence: fields.category.confidence,
      label: 'Category',
      source: fields.category.source,
      value: fields.category.value,
    });
  }
  if (fields.website) {
    profileRows.push({
      confidence: fields.website.confidence,
      label: 'Website',
      source: fields.website.source,
      value: fields.website.value,
    });
  }
  if (fields.phone) {
    profileRows.push({
      confidence: fields.phone.confidence,
      label: 'Phone',
      source: fields.phone.source,
      value: fields.phone.value,
    });
  }
  if (fields.contactEmail) {
    profileRows.push({
      confidence: fields.contactEmail.confidence,
      label: 'Contact email',
      source: fields.contactEmail.source,
      value: fields.contactEmail.value,
    });
  }
  if (fields.hours) {
    profileRows.push({
      confidence: fields.hours.confidence,
      label: 'Business hours',
      source: fields.hours.source,
      value: fields.hours.display,
    });
  }

  return (
    <div className={`scrape-draft${isApplied ? ' is-applied' : ''}`}>
      <div className="scrape-draft-header">
        <div className="scrape-draft-header-left">
          <span className="scrape-draft-title">Website extraction draft</span>
          <span className={`status-pill ${isApplied ? 'status-pill-approved' : 'status-pill-draft'}`}>
            <span className="status-dot" />
            {isApplied ? 'Applied to form' : 'Draft'}
          </span>
        </div>
        <button
          className="scrape-draft-dismiss"
          onClick={onDismiss}
          type="button"
        >
          Dismiss
        </button>
      </div>

      <p className="scrape-draft-notice">
        Extracted from{' '}
        <a href={draft.normalizedUrl} rel="noreferrer" target="_blank">
          {draft.normalizedUrl}
        </a>
        . Nothing is saved until you review, apply values to the form, and click
        Save changes.
      </p>

      {profileRows.length > 0 ? (
        <div className="scrape-draft-fields">
          {profileRows.map((row) => (
            <div key={row.label} className="scrape-draft-field">
              <div className="scrape-draft-field-meta">
                <span className="scrape-draft-label">{row.label}</span>
                <ProvenanceBadges
                  confidence={row.confidence}
                  source={row.source}
                />
              </div>
              <span className="scrape-draft-value">{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}

      {fields.address ? (
        <div className="scrape-draft-section">
          <div className="scrape-draft-section-title">
            Address
            <ProvenanceBadges
              confidence={fields.address.confidence}
              source={fields.address.source}
            />
          </div>
          <p className="scrape-draft-extra">{fields.address.value}</p>
          <p className="scrape-draft-hint">
            Address is shown for review only. Add it to Business Knowledge if
            agents should use it.
          </p>
        </div>
      ) : null}

      {fields.socialLinks && fields.socialLinks.value.length > 0 ? (
        <div className="scrape-draft-section">
          <div className="scrape-draft-section-title">
            Social links
            <ProvenanceBadges
              confidence={fields.socialLinks.confidence}
              source={fields.socialLinks.source}
            />
          </div>
          <ul className="scrape-draft-list">
            {fields.socialLinks.value.map((link) => (
              <li key={link}>
                <a href={link} rel="noreferrer" target="_blank">
                  {link}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {fields.faqs && fields.faqs.value.length > 0 ? (
        <div className="scrape-draft-section">
          <div className="scrape-draft-section-title">
            FAQs ({fields.faqs.value.length})
            <ProvenanceBadges
              confidence={fields.faqs.confidence}
              source={fields.faqs.source}
            />
          </div>
          {fields.faqs.value.map((faq) => (
            <div key={faq.question} className="scrape-draft-faq">
              <div className="scrape-draft-faq-q">{faq.question}</div>
              <div className="scrape-draft-faq-a">{faq.answer}</div>
            </div>
          ))}
          <p className="scrape-draft-hint">
            FAQs are not written to the live profile automatically. Add approved
            items under Business Knowledge.
          </p>
        </div>
      ) : null}

      <div className="scrape-draft-actions">
        {canApply ? (
          <button
            className="button"
            disabled={isApplied}
            onClick={onApply}
            type="button"
          >
            {isApplied ? 'Applied to form' : 'Apply to profile form'}
          </button>
        ) : (
          <p className="scrape-draft-hint">
            No profile fields were found to apply. Review the extras above or
            fill the form manually.
          </p>
        )}
      </div>
    </div>
  );
}

type BusinessFormProps = {
  canEdit: boolean;
  defaultValues: BusinessConfigurationValues;
};

export function BusinessConfigurationForm({
  canEdit,
  defaultValues,
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
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeOutcome, setScrapeOutcome] = useState<ScrapeOutcome | null>(null);
  const [draftApplied, setDraftApplied] = useState(false);
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
    setDraftApplied(false);
    setScrapeOutcome(null);
    setToastMessage(state.message);

    if (successTimerRef.current !== null) {
      window.clearTimeout(successTimerRef.current);
    }

    successTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      successTimerRef.current = null;
    }, 2600);
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
    setDraftApplied(false);
  }

  async function handleScrapeWebsite() {
    setIsScraping(true);
    setScrapeOutcome(null);
    setDraftApplied(false);

    try {
      const result = await scrapeBusinessWebsite(websiteUrl);
      setScrapeOutcome(result);
    } catch (error) {
      setScrapeOutcome({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to scrape that website right now.',
      });
    } finally {
      setIsScraping(false);
    }
  }

  function handleApplyDraft(draft: WebsiteExtractionDraftView) {
    const current =
      formRef.current != null
        ? extractBusinessConfigurationValues(new FormData(formRef.current))
        : formValues;
    const next = applyExtractionPatchToValues(current, draft.formPatch);

    setFormValues(next);
    setHoursState(hoursStateFromBusinessHours(next.businessHours));
    setWebsiteUrl(next.website ?? '');
    setSelectedTimezone(next.timezone ?? 'America/Toronto');
    setFormRevision((value) => value + 1);
    setDraftApplied(true);
    setIsDirty(createSignature(next) !== baselineSignature);
    setToastMessage('Draft values applied to the form. Review and save when ready.');

    if (successTimerRef.current !== null) {
      window.clearTimeout(successTimerRef.current);
    }
    successTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      successTimerRef.current = null;
    }, 2600);
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
            Paste your business website, scrape a draft profile, review source
            and confidence for each field, then apply only what looks right.
          </p>
        </div>
      </div>

      <form
        action={formAction}
        className="business-form"
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
                type="url"
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
                Fetching the page and drafting business details. This can take up
                to about 15 seconds.
              </div>
            ) : null}
            {scrapeOutcome?.kind === 'error' ? (
              <div className="notice notice-danger">{scrapeOutcome.message}</div>
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

        {scrapeOutcome?.kind === 'success' ? (
          <ScrapedDraftPreview
            draft={scrapeOutcome.draft}
            isApplied={draftApplied}
            onApply={() => handleApplyDraft(scrapeOutcome.draft)}
            onDismiss={() => {
              setScrapeOutcome(null);
              setDraftApplied(false);
            }}
          />
        ) : null}

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

        {canEdit ? (
          <div className="sticky-action-bar">
            <div className="sticky-action-bar-inner">
              <div className={`sticky-action-bar-status${isDirty ? ' is-dirty' : ''}`}>
                {isDirty ? 'Unsaved changes' : 'All changes saved'}
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
                  disabled={!isDirty || isPending}
                  type="submit"
                >
                  {isPending ? 'Saving...' : 'Save changes'}
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
      </form>

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
