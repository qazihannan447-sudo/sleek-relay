'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';

import {
  businessHoursDays,
  type BusinessConfigurationValues,
} from '../../../lib/business-configuration/schema';
import {
  extractBusinessConfigurationValues,
  initialBusinessConfigurationActionState,
  type BusinessConfigurationActionState,
} from '../../../lib/business-configuration/validation';
import { saveBusinessConfiguration } from './actions';
import { TimezoneCombobox } from './timezone-combobox';

// ---------------------------------------------------------------------------
// Scraped draft types
// ---------------------------------------------------------------------------

type ScrapedFaq = {
  answer: string;
  question: string;
};

type ScrapedBusinessDraft = {
  about?: string;
  businessName?: string;
  email?: string;
  faqs?: ScrapedFaq[];
  hours?: string;
  phone?: string;
  policies?: string[];
  services?: string[];
};

type ScrapeOutcome =
  | { draft: ScrapedBusinessDraft; kind: 'success' }
  | { kind: 'error'; message: string };

// ---------------------------------------------------------------------------
// ScrapedDraftPreview component
// ---------------------------------------------------------------------------

function ScrapedDraftPreview({
  draft,
  onDismiss,
}: {
  draft: ScrapedBusinessDraft;
  onDismiss: () => void;
}) {
  const simpleFields: Array<{ label: string; value: string | undefined }> = [
    { label: 'Business name', value: draft.businessName },
    { label: 'Phone', value: draft.phone },
    { label: 'Email', value: draft.email },
    { label: 'Business hours', value: draft.hours },
    { label: 'About / Description', value: draft.about },
  ];

  const hasContent =
    simpleFields.some((f) => f.value) ||
    (draft.services?.length ?? 0) > 0 ||
    (draft.faqs?.length ?? 0) > 0 ||
    (draft.policies?.length ?? 0) > 0;

  if (!hasContent) {
    return null;
  }

  return (
    <div className="scrape-draft">
      <div className="scrape-draft-header">
        <div className="scrape-draft-header-left">
          <span className="scrape-draft-title">Scraped draft</span>
          <span className="status-pill status-pill-draft">
            <span className="status-dot" />
            Draft
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
        These values were extracted from your website. Nothing is saved yet.
        Review each item and apply values manually where appropriate.
      </p>

      {simpleFields.some((f) => f.value) ? (
        <div className="scrape-draft-fields">
          {simpleFields.map((f) =>
            f.value ? (
              <div key={f.label} className="scrape-draft-field">
                <span className="scrape-draft-label">{f.label}</span>
                <span className="scrape-draft-value">{f.value}</span>
              </div>
            ) : null,
          )}
        </div>
      ) : null}

      {draft.services && draft.services.length > 0 ? (
        <div className="scrape-draft-section">
          <div className="scrape-draft-section-title">
            Services ({draft.services.length})
          </div>
          <ul className="scrape-draft-list">
            {draft.services.map((service) => (
              <li key={service}>{service}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {draft.faqs && draft.faqs.length > 0 ? (
        <div className="scrape-draft-section">
          <div className="scrape-draft-section-title">
            FAQs ({draft.faqs.length})
          </div>
          {draft.faqs.map((faq) => (
            <div key={faq.question} className="scrape-draft-faq">
              <div className="scrape-draft-faq-q">{faq.question}</div>
              <div className="scrape-draft-faq-a">{faq.answer}</div>
            </div>
          ))}
        </div>
      ) : null}

      {draft.policies && draft.policies.length > 0 ? (
        <div className="scrape-draft-section">
          <div className="scrape-draft-section-title">
            Policies ({draft.policies.length})
          </div>
          <ul className="scrape-draft-list">
            {draft.policies.map((policy) => (
              <li key={policy}>{policy}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BusinessConfigurationForm
// ---------------------------------------------------------------------------

type BusinessFormProps = {
  canEdit: boolean;
  defaultValues: BusinessConfigurationValues;
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
  const values = getFieldValue(state, defaultValues);
  const formRef = useRef<HTMLFormElement | null>(null);
  const successTimerRef = useRef<number | null>(null);
  const [baselineSignature, setBaselineSignature] = useState(() =>
    createSignature(defaultValues),
  );
  const [isDirty, setIsDirty] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const formKey = useMemo(() => baselineSignature, [baselineSignature]);
  const [websiteUrl, setWebsiteUrl] = useState(values.website ?? '');
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeOutcome, setScrapeOutcome] = useState<ScrapeOutcome | null>(null);
  const [hoursState, setHoursState] = useState<HoursState>(() => {
    const initial: HoursState = {};
    for (const day of businessHoursDays) {
      initial[day.key] = {
        close: values.businessHours[day.key].close ?? '17:00',
        closed: values.businessHours[day.key].closed,
        open: values.businessHours[day.key].open ?? '09:00',
      };
    }
    return initial;
  });

  const [isHoursModalOpen, setIsHoursModalOpen] = useState(false);
  const [draftHours, setDraftHours] = useState<HoursState>(hoursState);
  const [selectedTimezone, setSelectedTimezone] = useState(values.timezone ?? 'America/Toronto');

  const hoursSummary = useMemo(
    () => buildBusinessHoursSummary(hoursState),
    [hoursState],
  );

  useEffect(() => {
    if (state.status !== 'success' || !state.message) {
      return;
    }

    const nextSignature = createSignature(values);
    setBaselineSignature(nextSignature);
    setIsDirty(false);
    setToastMessage(state.message);

    if (successTimerRef.current !== null) {
      window.clearTimeout(successTimerRef.current);
    }

    successTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      successTimerRef.current = null;
    }, 2600);
  }, [state.message, state.status, values]);

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
    const initialHours: HoursState = {};
    for (const day of businessHoursDays) {
      initialHours[day.key] = {
        close: values.businessHours[day.key].close ?? '17:00',
        closed: values.businessHours[day.key].closed,
        open: values.businessHours[day.key].open ?? '09:00',
      };
    }
    setHoursState(initialHours);
    setWebsiteUrl(values.website ?? '');
    setSelectedTimezone(values.timezone ?? 'America/Toronto');
    setIsDirty(false);
  }

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
        key={formKey}
        onChange={updateDirtyState}
        onInput={updateDirtyState}
        ref={formRef}
      >
        <div className="business-form-grid">
          <div className="field">
            <label htmlFor="businessName">Business name</label>
            <input
              defaultValue={values.businessName}
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
              defaultValue={values.category}
              disabled={!canEdit || isPending}
              id="category"
              name="category"
              placeholder={fieldPlaceholders.category}
              type="text"
            />
          </div>

          <div className="field">
            <label htmlFor="website">Website</label>
            <div className="field-input-row">
              <input
                defaultValue={values.website}
                disabled={!canEdit || isPending}
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
                    setIsScraping(true);
                    setScrapeOutcome(null);
                    // Scraping not yet implemented.
                    // Future: call a server action with websiteUrl, await the
                    // response, then call setScrapeOutcome with the result.
                    setTimeout(() => {
                      setIsScraping(false);
                      setScrapeOutcome({
                        draft: {
                          about:
                            'A business serving the local community with quality products and friendly service.',
                          businessName: 'Example Business Name',
                          email: 'hello@example.com',
                          faqs: [
                            {
                              answer:
                                'Walk-ins are welcome subject to same-day availability.',
                              question: 'Do you accept walk-ins?',
                            },
                            {
                              answer:
                                'Yes, gift cards are available in-store and online.',
                              question: 'Do you sell gift cards?',
                            },
                          ],
                          hours:
                            'Mon–Fri 9:00 am – 6:00 pm · Sat 10:00 am – 4:00 pm · Sun Closed',
                          phone: '+1 (555) 000-1234',
                          policies: [
                            'Returns accepted within 30 days with original receipt.',
                            'All prices include applicable taxes.',
                          ],
                          services: [
                            'In-store consultations',
                            'Online ordering and delivery',
                            'Gift wrapping',
                            'Loyalty rewards programme',
                          ],
                        },
                        kind: 'success',
                      });
                    }, 0);
                  }}
                  type="button"
                >
                  {isScraping ? 'Scraping…' : 'Scrape website info'}
                </button>
              ) : null}
            </div>
            {scrapeOutcome?.kind === 'error' ? (
              <div className="notice notice-danger">{scrapeOutcome.message}</div>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="businessPhone">Phone</label>
            <input
              defaultValue={values.businessPhone}
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
              defaultValue={values.contactName}
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
              defaultValue={values.contactEmail}
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
              value={values.timezone}
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
            className="hours-modal-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
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
                className="hours-modal-close"
                onClick={() => setIsHoursModalOpen(false)}
                type="button"
                aria-label="Close"
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
                          type="button"
                          className={`hours-segmented-btn ${!isClosed ? 'is-active' : ''}`}
                          onClick={() =>
                            setDraftHours((prev) => ({
                              ...prev,
                              [day.key]: { ...prev[day.key], closed: false },
                            }))
                          }
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          className={`hours-segmented-btn ${isClosed ? 'is-active-closed' : ''}`}
                          onClick={() =>
                            setDraftHours((prev) => ({
                              ...prev,
                              [day.key]: { ...prev[day.key], closed: true },
                            }))
                          }
                        >
                          Closed
                        </button>
                      </div>
                    </div>

                    {!isClosed ? (
                      <>
                        <div className="hours-modal-time-row">
                          <input
                            type="time"
                            value={dayData.open}
                            onChange={(e) =>
                              setDraftHours((prev) => ({
                                ...prev,
                                [day.key]: { ...prev[day.key], open: e.target.value },
                              }))
                            }
                            className="hours-time-input"
                          />
                          <span className="hours-modal-to">to</span>
                          <input
                            type="time"
                            value={dayData.close}
                            onChange={(e) =>
                              setDraftHours((prev) => ({
                                ...prev,
                                [day.key]: { ...prev[day.key], close: e.target.value },
                              }))
                            }
                            className="hours-time-input"
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
                                  key={target.key}
                                  type="button"
                                  className="hours-batch-btn"
                                  onClick={() => applyDayHoursToTarget(day.key, target.key)}
                                >
                                  {target.label.slice(0, 3)}
                                </button>
                              ))}
                            <button
                              type="button"
                              className="hours-batch-btn hours-batch-btn-all"
                              onClick={() => applyDayHoursToAllOther(day.key)}
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

      {scrapeOutcome?.kind === 'success' ? (
        <ScrapedDraftPreview
          draft={scrapeOutcome.draft}
          onDismiss={() => setScrapeOutcome(null)}
        />
      ) : null}
    </>
  );
}
