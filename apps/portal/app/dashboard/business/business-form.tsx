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
  website: 'https://acmedental.com',
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

    setIsDirty(readFormSignature(formRef.current) !== baselineSignature);
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
            <label htmlFor="businessPhone">Business phone</label>
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
              <h2 className="panel-title">Business hours</h2>
              <p className="panel-subtitle">
                Weekly hours used across the tenant&apos;s shared profile.
              </p>
            </div>
          </div>

          <div className="hours-grid">
            {businessHoursDays.map((day) => {
              const dayValues = values.businessHours[day.key];

              return (
                <div key={day.key} className="hours-row">
                  <div className="hours-day">{day.label}</div>
                  <label className="hours-toggle">
                    <input
                      defaultChecked={dayValues.closed}
                      disabled={!canEdit || isPending}
                      name={`businessHours.${day.key}.closed`}
                      type="checkbox"
                    />
                    <span>Closed</span>
                  </label>
                  <div className="hours-inputs">
                    <input
                      defaultValue={dayValues.open ?? ''}
                      disabled={!canEdit || isPending}
                      name={`businessHours.${day.key}.open`}
                      type="time"
                    />
                    <span className="hours-separator">to</span>
                    <input
                      defaultValue={dayValues.close ?? ''}
                      disabled={!canEdit || isPending}
                      name={`businessHours.${day.key}.close`}
                      type="time"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {state.status === 'error' && state.message ? (
          <div className="notice notice-danger">{state.message}</div>
        ) : null}

        {canEdit ? (
          <button
            className="button"
            disabled={!isDirty || isPending}
            type="submit"
          >
            {isPending ? 'Saving...' : 'Save configuration'}
          </button>
        ) : (
          <div className="notice">
            You have read-only access. Owners and admins may edit this shared
            configuration.
          </div>
        )}
      </form>

      {scrapeOutcome?.kind === 'success' ? (
        <ScrapedDraftPreview
          draft={scrapeOutcome.draft}
          onDismiss={() => setScrapeOutcome(null)}
        />
      ) : null}
    </>
  );
}
