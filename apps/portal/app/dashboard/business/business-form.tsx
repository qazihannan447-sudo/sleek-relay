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
            <input
              defaultValue={values.website}
              disabled={!canEdit || isPending}
              id="website"
              name="website"
              placeholder={fieldPlaceholders.website}
              type="url"
            />
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
    </>
  );
}
