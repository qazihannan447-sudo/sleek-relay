'use client';

import { useActionState } from 'react';

import {
  businessHoursDays,
  type BusinessConfigurationValues,
} from '../../../lib/business-configuration/schema';
import {
  initialBusinessConfigurationActionState,
  type BusinessConfigurationActionState,
} from '../../../lib/business-configuration/validation';
import { saveBusinessConfiguration } from './actions';

type BusinessFormProps = {
  canEdit: boolean;
  defaultValues: BusinessConfigurationValues;
};

function getFieldValue(
  state: BusinessConfigurationActionState,
  fallback: BusinessConfigurationValues,
): BusinessConfigurationValues {
  return state.values ?? fallback;
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

  return (
    <form action={formAction} className="business-form">
      <div className="business-form-grid">
        <div className="field">
          <label htmlFor="businessName">Business name</label>
          <input
            defaultValue={values.businessName}
            disabled={!canEdit || isPending}
            id="businessName"
            name="businessName"
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
            placeholder="https://example.com"
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
            type="email"
          />
        </div>

        <div className="field">
          <label htmlFor="timezone">Timezone</label>
          <input
            defaultValue={values.timezone}
            disabled={!canEdit || isPending}
            id="timezone"
            name="timezone"
            placeholder="America/Toronto"
            type="text"
          />
        </div>
      </div>

      <section className="hours-panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Business hours</h2>
            <p className="panel-subtitle">
              Weekly hours stored in the current demo schema.
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

      <div className="notice">
        The current database does not yet store address or notification settings,
        so those fields remain out of scope for this phase. Closed days ignore
        any entered times when the form is saved.
      </div>

      {state.message ? (
        <div
          className={
            state.status === 'success'
              ? 'notice notice-success'
              : 'notice notice-danger'
          }
        >
          {state.message}
        </div>
      ) : null}

      {canEdit ? (
        <button className="button" disabled={isPending} type="submit">
          {isPending ? 'Saving...' : 'Save configuration'}
        </button>
      ) : (
        <div className="notice">
          You have read-only access. Owners and admins may edit this shared
          configuration.
        </div>
      )}
    </form>
  );
}
