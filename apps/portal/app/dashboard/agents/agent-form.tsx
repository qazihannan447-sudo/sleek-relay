'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import { CustomSelect } from './custom-select';
import { ToneSelector } from './tone-selector';
import { saveAgent } from './actions';
import {
  appointmentFieldOptions,
  leadFieldOptions,
  messageFieldOptions,
  type AppointmentField,
  type LeadField,
  type MessageField,
} from '../../../lib/agents/capabilities';
import { type AgentStatus, type AgentValues } from '../../../lib/agents/schema';
import {
  initialAgentActionState,
  type AgentActionState,
} from '../../../lib/agents/validation';
import type { HandoffDestinationType } from '../../../lib/business-configuration/schema';

const roleSelectOptions = [
  { label: 'Receptionist', value: 'Receptionist' },
  { label: 'Customer Support', value: 'Customer Support' },
  { label: 'Sales Assistant', value: 'Sales Assistant' },
  { label: 'Appointment Assistant', value: 'Appointment Assistant' },
  { label: 'Lead Qualification', value: 'Lead Qualification' },
  { label: 'General Assistant', value: 'General Assistant' },
] as const;

const languageSelectOptions = [
  { label: 'English', value: 'en' },
  { label: 'English (US)', value: 'en-us' },
  { label: 'English (UK)', value: 'en-gb' },
] as const;

type AgentFormProps = {
  agentId: string | null;
  canEdit: boolean;
  defaultValues: AgentValues;
  handoffDestinationType?: HandoffDestinationType;
};

function getFieldValues(
  state: AgentActionState,
  fallback: AgentValues,
): AgentValues {
  return state.values ?? fallback;
}

function formatFieldLabel(field: string): string {
  return field.replaceAll('_', ' ');
}

type CapabilityToggleProps<T extends string> = {
  canEdit: boolean;
  checked: boolean;
  disabled: boolean;
  fieldInputName: string;
  fieldOptions: readonly T[];
  fields: T[];
  help: string;
  id: string;
  label: string;
  name: string;
  onCheckedChange: (_checked: boolean) => void;
  onFieldsChange: (_fields: T[]) => void;
  requiredFields?: readonly T[];
};

function CapabilityToggle<T extends string>({
  canEdit,
  checked,
  disabled,
  fieldInputName,
  fieldOptions,
  fields,
  help,
  id,
  label,
  name,
  onCheckedChange,
  onFieldsChange,
  requiredFields = [],
}: CapabilityToggleProps<T>) {
  const requiredSet = new Set<string>(requiredFields);

  return (
    <div
      className={`capability-card${checked ? ' is-enabled' : ''}${
        disabled ? ' is-disabled' : ''
      }`}
    >
      <div className="capability-card-header">
        <div className="capability-card-copy">
          <div className="capability-card-title-row">
            <h3 className="capability-card-title">
              <label htmlFor={id}>{label}</label>
            </h3>
            {checked ? (
              <span className="capability-status-pill">On</span>
            ) : (
              <span className="capability-status-pill is-off">Off</span>
            )}
          </div>
          <p className="capability-card-help">{help}</p>
        </div>
        <label className="toggle-switch capability-card-toggle" htmlFor={id}>
          <input
            checked={checked}
            disabled={!canEdit || disabled}
            id={id}
            name={name}
            onChange={(event) => onCheckedChange(event.target.checked)}
            type="checkbox"
            value="on"
          />
          <span className="toggle-slider" />
        </label>
      </div>

      {checked ? (
        <div className="capability-fields">
          <div className="capability-fields-label-row">
            <p className="capability-fields-label">Collect these fields</p>
            <p className="capability-fields-hint">
              {requiredFields.length > 0
                ? 'Required fields stay selected while this capability is on.'
                : 'Choose what the agent should ask for.'}
            </p>
          </div>
          <div
            aria-label={`${label} fields`}
            className="capability-field-pills"
            role="group"
          >
            {fieldOptions.map((field) => {
              const fieldId = `${id}-${field}`;
              const isRequired = requiredSet.has(field);
              const isChecked = fields.includes(field) || isRequired;
              return (
                <label
                  className={`capability-field-pill${
                    isChecked ? ' is-selected' : ''
                  }${isRequired ? ' is-required' : ''}`}
                  htmlFor={fieldId}
                  key={field}
                >
                  <input
                    checked={isChecked}
                    disabled={!canEdit || disabled}
                    id={fieldId}
                    name={fieldInputName}
                    onChange={(event) => {
                      if (isRequired) {
                        if (!fields.includes(field)) {
                          onFieldsChange([...fields, field]);
                        }
                        return;
                      }
                      if (event.target.checked) {
                        onFieldsChange([...fields, field]);
                      } else {
                        onFieldsChange(fields.filter((entry) => entry !== field));
                      }
                    }}
                    type="checkbox"
                    value={field}
                  />
                  <span className="capability-field-pill-label">
                    {formatFieldLabel(field)}
                  </span>
                  {isRequired ? (
                    <span className="capability-field-required">Required</span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AgentForm({
  agentId,
  canEdit,
  defaultValues,
  handoffDestinationType = 'none',
}: AgentFormProps) {
  const [state, formAction, isPending] = useActionState<AgentActionState, FormData>(
    saveAgent,
    initialAgentActionState(defaultValues),
  );
  const values = getFieldValues(state, defaultValues);

  const [status, setStatus] = useState<AgentStatus>(values.status ?? 'draft');
  const [captureLeads, setCaptureLeads] = useState(
    values.capabilities.captureLeads,
  );
  const [captureMessages, setCaptureMessages] = useState(
    values.capabilities.captureMessages,
  );
  const [captureAppointments, setCaptureAppointments] = useState(
    values.capabilities.captureAppointments,
  );
  const [offerHandoff, setOfferHandoff] = useState(
    values.capabilities.offerHandoff,
  );
  const [leadFields, setLeadFields] = useState<LeadField[]>(
    values.capabilities.leadFields,
  );
  const [messageFields, setMessageFields] = useState<MessageField[]>(
    values.capabilities.messageFields,
  );
  const [appointmentFields, setAppointmentFields] = useState<AppointmentField[]>(
    values.capabilities.appointmentFields,
  );

  const ensureRequiredFields = <T extends string>(
    nextFields: T[],
    required: readonly T[],
  ): T[] => {
    const merged = [...nextFields];
    for (const field of required) {
      if (!merged.includes(field)) {
        merged.push(field);
      }
    }
    return merged;
  };

  const handleCaptureLeadsChange = (checked: boolean) => {
    setCaptureLeads(checked);
    if (checked) {
      setLeadFields((current) => ensureRequiredFields(current, ['name']));
    }
  };

  const handleCaptureMessagesChange = (checked: boolean) => {
    setCaptureMessages(checked);
    if (checked) {
      setMessageFields((current) => ensureRequiredFields(current, ['message']));
    }
  };

  const handleCaptureAppointmentsChange = (checked: boolean) => {
    setCaptureAppointments(checked);
    if (checked) {
      setAppointmentFields((current) =>
        ensureRequiredFields(current, ['preferred_time']),
      );
    }
  };

  const formKey = `${agentId || 'new'}-${values.name}-${values.greeting}-${values.tone}-${values.specialInstructions}-${values.fallbackMessage}`;

  return (
    <form action={formAction} className="business-form" key={formKey}>
      <input name="agentId" type="hidden" value={agentId ?? ''} />

      {/* Section 1: Agent Identity */}
      <section className="panel" style={{ marginBottom: '24px' }}>
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Agent Identity</h2>
            <p className="panel-subtitle">
              Basic information customers will experience.
            </p>
          </div>

          <div className="agent-status-toggle-wrapper">
            <span className={`status-pill status-pill-${status}`}>
              <span className="status-dot" />
              {status === 'active' ? 'Active' : 'Draft'}
            </span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={status === 'active'}
                disabled={!canEdit || isPending}
                onChange={(e) => setStatus(e.target.checked ? 'active' : 'draft')}
              />
              <span className="toggle-slider" />
            </label>
            <input type="hidden" name="status" value={status} />
          </div>
        </div>

        <div className="business-form-grid-3">
          <div className="field">
            <label htmlFor="name">Agent name</label>
            <input
              defaultValue={values.name}
              disabled={!canEdit || isPending}
              id="name"
              name="name"
              placeholder="e.g. Habiba's Agent"
              required
              type="text"
            />
          </div>

          <div className="field">
            <label htmlFor="role">Role</label>
            <CustomSelect
              disabled={!canEdit || isPending}
              id="role"
              name="role"
              options={roleSelectOptions}
              value={values.role || 'Receptionist'}
            />
          </div>

          <div className="field">
            <label htmlFor="language">Language</label>
            <CustomSelect
              disabled={!canEdit || isPending}
              id="language"
              name="language"
              options={languageSelectOptions}
              value={values.language || 'en'}
            />
          </div>
        </div>
      </section>

      {/* Section 2: Voice Settings */}
      <section className="panel" style={{ marginBottom: '24px' }}>
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Voice Settings</h2>
            <p className="panel-subtitle">
              Configure the speech voice and tone for this agent.
            </p>
          </div>
        </div>

        <div className="agent-settings-stack">
          <div className="agent-settings-group">
            <h3 className="agent-settings-group-title">Voice configuration</h3>
            <div className="business-form-grid agent-voice-grid">
              <div className="field">
                <div className="field-label-row">
                  <label htmlFor="voiceId">Voice ID</label>
                  <span className="field-help-inline">
                    Prefer a Cartesia Emotive voice so tone guidance sounds natural.
                    Leave blank to use the default system voice.
                  </span>
                </div>
                <input
                  defaultValue={values.voiceId}
                  disabled={!canEdit || isPending}
                  id="voiceId"
                  name="voiceId"
                  placeholder="Paste Cartesia Voice ID"
                  type="text"
                />
              </div>

              <div className="field">
                <label id="tone-label">Tone</label>
                <ToneSelector
                  defaultValue={values.tone}
                  disabled={!canEdit || isPending}
                  name="tone"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Agent Behavior */}
      <section className="panel" style={{ marginBottom: '24px' }}>
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Agent Behavior</h2>
            <p className="panel-subtitle">
              Configure greetings, operational instructions, and fallback messages.
            </p>
          </div>
        </div>

        <div className="field">
          <label htmlFor="greeting">Greeting</label>
          <textarea
            defaultValue={values.greeting}
            disabled={!canEdit || isPending}
            id="greeting"
            name="greeting"
            placeholder="The initial phrase your agent speaks when starting a conversation. Save the agent before testing so this greeting is used on Connect."
            rows={3}
          />
        </div>

        <div className="field" style={{ marginTop: '20px' }}>
          <label htmlFor="specialInstructions">Special instructions</label>
          <p className="hint-text" style={{ fontSize: '0.85rem', margin: '-4px 0 4px 0' }}>
            Tell the agent anything specific about how it should behave.
          </p>
          <textarea
            defaultValue={values.specialInstructions}
            disabled={!canEdit || isPending}
            id="specialInstructions"
            name="specialInstructions"
            placeholder="Be friendly and concise. Ask customers one question at a time. Never promise appointment availability."
            rows={4}
          />
        </div>

        <div className="field" style={{ marginTop: '20px' }}>
          <label htmlFor="fallbackMessage">Fallback message</label>
          <p className="hint-text" style={{ fontSize: '0.85rem', margin: '-4px 0 4px 0' }}>
            What should the agent say when it cannot answer?
          </p>
          <textarea
            defaultValue={values.fallbackMessage}
            disabled={!canEdit || isPending}
            id="fallbackMessage"
            name="fallbackMessage"
            placeholder="I'm sorry, I don't have confirmed information about that. I can take a message for the team instead."
            rows={3}
          />
        </div>

        <input name="interruptionEnabled" type="hidden" value="on" />
      </section>

      {/* Section 4: Capabilities */}
      <section className="panel" style={{ marginBottom: '24px' }}>
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Capabilities</h2>
            <p className="panel-subtitle">
              Turn on the workflows this agent may run, then choose which fields
              to collect. Appointment captures stay requests only — never
              confirmed bookings.
            </p>
          </div>
        </div>

        <div className="capability-stack">
          <CapabilityToggle
            canEdit={canEdit}
            checked={captureLeads}
            disabled={isPending}
            fieldInputName="capabilities.leadFields"
            fieldOptions={leadFieldOptions}
            fields={leadFields}
            help="Save caller contact details when someone wants a follow-up."
            id="capabilities-capture-leads"
            label="Lead capture"
            name="capabilities.captureLeads"
            onCheckedChange={handleCaptureLeadsChange}
            onFieldsChange={(next) =>
              setLeadFields(ensureRequiredFields(next, ['name']))
            }
            requiredFields={['name']}
          />

          <CapabilityToggle
            canEdit={canEdit}
            checked={captureMessages}
            disabled={isPending}
            fieldInputName="capabilities.messageFields"
            fieldOptions={messageFieldOptions}
            fields={messageFields}
            help="Take a message for the business team when the agent cannot resolve the request."
            id="capabilities-capture-messages"
            label="Message capture"
            name="capabilities.captureMessages"
            onCheckedChange={handleCaptureMessagesChange}
            onFieldsChange={(next) =>
              setMessageFields(ensureRequiredFields(next, ['message']))
            }
            requiredFields={['message']}
          />

          <CapabilityToggle
            canEdit={canEdit}
            checked={captureAppointments}
            disabled={isPending}
            fieldInputName="capabilities.appointmentFields"
            fieldOptions={appointmentFieldOptions}
            fields={appointmentFields}
            help="Create appointment requests for staff to confirm later."
            id="capabilities-capture-appointments"
            label="Appointment requests"
            name="capabilities.captureAppointments"
            onCheckedChange={handleCaptureAppointmentsChange}
            onFieldsChange={(next) =>
              setAppointmentFields(
                ensureRequiredFields(next, ['preferred_time']),
              )
            }
            requiredFields={['preferred_time']}
          />

          <div
            className={`capability-card${offerHandoff ? ' is-enabled' : ''}${
              isPending ? ' is-disabled' : ''
            }`}
          >
            <div className="capability-card-header">
              <div className="capability-card-copy">
                <div className="capability-card-title-row">
                  <h3 className="capability-card-title">
                    <label htmlFor="capabilities-offer-handoff">
                      Human handoff / callback
                    </label>
                  </h3>
                  {offerHandoff ? (
                    <span className="capability-status-pill">On</span>
                  ) : (
                    <span className="capability-status-pill is-off">Off</span>
                  )}
                </div>
                <p className="capability-card-help">
                  Offer the soft handoff or callback path configured under
                  Business Configuration. This is not a live transfer.
                </p>
              </div>
              <label
                className="toggle-switch capability-card-toggle"
                htmlFor="capabilities-offer-handoff"
              >
                <input
                  checked={offerHandoff}
                  disabled={!canEdit || isPending}
                  id="capabilities-offer-handoff"
                  name="capabilities.offerHandoff"
                  onChange={(event) => setOfferHandoff(event.target.checked)}
                  type="checkbox"
                  value="on"
                />
                <span className="toggle-slider" />
              </label>
            </div>

            {offerHandoff ? (
              <div className="capability-fields">
                {handoffDestinationType === 'none' ? (
                  <div className="notice notice-warning capability-inline-notice">
                    Handoff is on for this agent, but Business Configuration has
                    no destination yet. The soft-handoff tool stays unavailable
                    until you set one under{' '}
                    <Link href="/dashboard/business">Business Configuration</Link>
                    .
                  </div>
                ) : (
                  <p className="capability-handoff-ready">
                    Using the business handoff destination (
                    <span className="capability-handoff-type">
                      {handoffDestinationType.replaceAll('_', ' ')}
                    </span>
                    ).
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {state.message ? (
        <div
          className={
            state.status === 'success'
              ? 'notice notice-success'
              : 'notice notice-danger'
          }
          style={{ marginBottom: '20px' }}
        >
          {state.message}
        </div>
      ) : null}

      {canEdit ? (
        <button className="button" disabled={isPending} type="submit">
          {isPending ? 'Saving...' : agentId ? 'Save agent' : 'Create agent'}
        </button>
      ) : (
        <div className="notice">
          You have read-only access. Owners and admins may create or edit agents.
        </div>
      )}
    </form>
  );
}
