'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';

import { ToastNotification } from '../../../components/toast-notification';
import { VoiceAvatar } from '../../../components/voice-avatar';
import { useAgentEditorState } from './agent-editor-state';
import { BehaviorTextField } from './behavior-text-field';
import { CustomSelect } from './custom-select';
import { VoiceConfigDrawer } from './voice-config-drawer';
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
  DEFAULT_AGENT_TONE,
  resolveKnownAgentTones,
  type AgentToneOption,
} from '../../../lib/agents/tones';
import {
  initialAgentActionState,
  type AgentActionState,
} from '../../../lib/agents/validation';
import { refreshBrowserVoiceWarmupAfterAgentChange } from '../../../lib/voice/warm-connect';
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

type AgentFormSnapshot = {
  appointmentFields: AppointmentField[];
  captureAppointments: boolean;
  captureLeads: boolean;
  captureMessages: boolean;
  fallbackMessage: string;
  greeting: string;
  interruptionEnabled: boolean;
  language: string;
  leadFields: LeadField[];
  messageFields: MessageField[];
  name: string;
  offerHandoff: boolean;
  role: string;
  specialInstructions: string;
  status: AgentStatus;
  tone: string;
  voiceId: string;
};

function sortedFields<T extends string>(fields: readonly T[]): T[] {
  return [...fields].sort();
}

function createAgentSignature(snapshot: AgentFormSnapshot): string {
  return JSON.stringify({
    appointmentFields: sortedFields(snapshot.appointmentFields),
    captureAppointments: snapshot.captureAppointments,
    captureLeads: snapshot.captureLeads,
    captureMessages: snapshot.captureMessages,
    fallbackMessage: snapshot.fallbackMessage,
    greeting: snapshot.greeting,
    interruptionEnabled: snapshot.interruptionEnabled,
    language: snapshot.language,
    leadFields: sortedFields(snapshot.leadFields),
    messageFields: sortedFields(snapshot.messageFields),
    name: snapshot.name,
    offerHandoff: snapshot.offerHandoff,
    role: snapshot.role,
    specialInstructions: snapshot.specialInstructions,
    status: snapshot.status,
    tone: snapshot.tone,
    voiceId: snapshot.voiceId,
  });
}

function snapshotFromValues(values: AgentValues): AgentFormSnapshot {
  const tones = values.tone ? resolveKnownAgentTones(values.tone) : [];
  return {
    appointmentFields: values.capabilities.appointmentFields,
    captureAppointments: values.capabilities.captureAppointments,
    captureLeads: values.capabilities.captureLeads,
    captureMessages: values.capabilities.captureMessages,
    fallbackMessage: values.fallbackMessage,
    greeting: values.greeting,
    interruptionEnabled: values.interruptionEnabled,
    language: values.language || 'en',
    leadFields: values.capabilities.leadFields,
    messageFields: values.capabilities.messageFields,
    name: values.name,
    offerHandoff: values.capabilities.offerHandoff,
    role: values.role || 'Receptionist',
    specialInstructions: values.specialInstructions,
    status: values.status ?? 'draft',
    tone: tones.join(', '),
    voiceId: values.voiceId,
  };
}

function readTextField(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  return typeof value === 'string' ? value : '';
}

type AgentFormProps = {
  agentId: string | null;
  canEdit: boolean;
  defaultValues: AgentValues;
  handoffDestinationType?: HandoffDestinationType;
  initialVoiceName?: string | null;
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
      className={`capability-card${disabled ? ' is-disabled' : ''}`}
    >
      <div className="capability-card-header">
        <div className="capability-card-copy">
          <h3 className="capability-card-title">
            <label htmlFor={id}>{label}</label>
          </h3>
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
          <div className="capability-fields-row">
            <span className="capability-fields-label">Collect fields</span>
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
                    title={
                      isRequired
                        ? 'Required while this capability is on'
                        : undefined
                    }
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
                          onFieldsChange(
                            fields.filter((entry) => entry !== field),
                          );
                        }
                      }}
                      type="checkbox"
                      value={field}
                    />
                    {isRequired ? (
                      <span aria-hidden="true" className="capability-field-lock">
                        <svg
                          fill="none"
                          height="11"
                          viewBox="0 0 24 24"
                          width="11"
                        >
                          <path
                            d="M7 11V8a5 5 0 0 1 10 0v3"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeWidth="2"
                          />
                          <rect
                            height="10"
                            rx="2"
                            stroke="currentColor"
                            strokeWidth="2"
                            width="14"
                            x="5"
                            y="11"
                          />
                        </svg>
                      </span>
                    ) : isChecked ? (
                      <span aria-hidden="true" className="capability-field-mark">
                        ✓
                      </span>
                    ) : null}
                    <span className="capability-field-pill-label">
                      {formatFieldLabel(field)}
                      {isRequired ? (
                        <span className="capability-field-required-mark">*</span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
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
  initialVoiceName = null,
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
  const [interruptionEnabled, setInterruptionEnabled] = useState(
    values.interruptionEnabled,
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
  const [selectedVoiceId, setSelectedVoiceId] = useState(values.voiceId);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string | null>(
    initialVoiceName,
  );
  const [selectedTones, setSelectedTones] = useState<AgentToneOption[]>(() =>
    values.tone ? resolveKnownAgentTones(values.tone) : [],
  );
  const [isVoiceDrawerOpen, setIsVoiceDrawerOpen] = useState(false);
  const [successToast, setSuccessToast] = useState<{
    id: number;
    message: string;
  } | null>(null);
  const handledSuccessStateRef = useRef<AgentActionState | null>(null);
  const toastIdRef = useRef(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const editorState = useAgentEditorState();
  const [baselineSignature, setBaselineSignature] = useState(() =>
    createAgentSignature(snapshotFromValues(defaultValues)),
  );
  const [isDirty, setIsDirty] = useState(false);

  function buildCurrentSnapshot(): AgentFormSnapshot {
    const form = formRef.current;
    return {
      appointmentFields,
      captureAppointments,
      captureLeads,
      captureMessages,
      fallbackMessage: form
        ? readTextField(form, 'fallbackMessage')
        : values.fallbackMessage,
      greeting: form ? readTextField(form, 'greeting') : values.greeting,
      interruptionEnabled,
      language: form
        ? readTextField(form, 'language') || 'en'
        : values.language || 'en',
      leadFields,
      messageFields,
      name: form ? readTextField(form, 'name') : values.name,
      offerHandoff,
      role: form
        ? readTextField(form, 'role') || 'Receptionist'
        : values.role || 'Receptionist',
      specialInstructions: form
        ? readTextField(form, 'specialInstructions')
        : values.specialInstructions,
      status,
      tone: selectedTones.join(', '),
      voiceId: selectedVoiceId,
    };
  }

  function updateDirtyState() {
    setIsDirty(
      createAgentSignature(buildCurrentSnapshot()) !== baselineSignature,
    );
  }

  useEffect(() => {
    // Controlled fields that are not always reflected through native form events.
    updateDirtyState();
  }, [
    appointmentFields,
    baselineSignature,
    captureAppointments,
    captureLeads,
    captureMessages,
    interruptionEnabled,
    leadFields,
    messageFields,
    offerHandoff,
    selectedTones,
    selectedVoiceId,
    status,
  ]);

  useEffect(() => {
    editorState?.setDirty(isDirty);
  }, [editorState, isDirty]);

  useEffect(() => {
    editorState?.setPending(isPending);
  }, [editorState, isPending]);

  useEffect(() => {
    if (state.status !== 'success' || !state.message) {
      return;
    }

    if (handledSuccessStateRef.current === state) {
      return;
    }

    handledSuccessStateRef.current = state;
    toastIdRef.current += 1;
    setSuccessToast({ id: toastIdRef.current, message: state.message });

    const saved = state.values;
    setStatus(saved.status ?? 'draft');
    setCaptureLeads(saved.capabilities.captureLeads);
    setCaptureMessages(saved.capabilities.captureMessages);
    setCaptureAppointments(saved.capabilities.captureAppointments);
    setOfferHandoff(saved.capabilities.offerHandoff);
    setInterruptionEnabled(saved.interruptionEnabled);
    setLeadFields(saved.capabilities.leadFields);
    setMessageFields(saved.capabilities.messageFields);
    setAppointmentFields(saved.capabilities.appointmentFields);
    setSelectedVoiceId(saved.voiceId);
    setSelectedTones(
      saved.tone ? resolveKnownAgentTones(saved.tone) : [],
    );
    setBaselineSignature(createAgentSignature(snapshotFromValues(saved)));
    setIsDirty(false);

    // Rebuild warm Connect caches so the next session embeds the saved voice
    // (and other runtime settings) instead of a stale prebootstrap package.
    if (agentId) {
      void refreshBrowserVoiceWarmupAfterAgentChange({ agentId });
    }
  }, [agentId, state]);

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
        ensureRequiredFields(current, ['name', 'preferred_time']),
      );
    }
  };

  const formKey = `${agentId || 'new'}-${values.name}-${values.greeting}-${values.tone}-${values.specialInstructions}-${values.fallbackMessage}`;
  const saveDisabled = !isDirty || isPending;

  return (
    <>
    {successToast ? (
      <ToastNotification key={successToast.id} message={successToast.message} />
    ) : null}
    <form
      action={formAction}
      className="business-form"
      id="agent-configuration-form"
      key={formKey}
      onChange={updateDirtyState}
      onInput={updateDirtyState}
      ref={formRef}
    >
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
              onChange={updateDirtyState}
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
              onChange={updateDirtyState}
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

        <input name="voiceId" type="hidden" value={selectedVoiceId} />
        <input name="tone" type="hidden" value={selectedTones.join(', ')} />

        <div className="voice-summary">
          <div className="voice-summary-details">
            {selectedVoiceId ? (
              <div className="voice-summary-voice">
                <VoiceAvatar name={selectedVoiceName ?? selectedVoiceId} seed={selectedVoiceId} size={40} />
                <div>
                  <p className="voice-summary-voice-name">
                    {selectedVoiceName ?? selectedVoiceId}
                  </p>
                  <p className="voice-summary-voice-id">{selectedVoiceId}</p>
                </div>
              </div>
            ) : (
              <p className="voice-summary-voice-name">
                No voice selected — the default system voice will be used.
              </p>
            )}
            {selectedTones.length > 0 ? (
              <div className="tone-pills-grid" aria-label="Selected tones" role="group">
                {selectedTones.map((tone) => (
                  <span className="tone-pill-btn is-selected tone-pill-static" key={tone}>
                    {tone}
                  </span>
                ))}
              </div>
            ) : (
              <p className="voice-summary-voice-name">
                No tone selected — {DEFAULT_AGENT_TONE} will be used by default.
              </p>
            )}
          </div>
          <button
            className="button-secondary"
            disabled={!canEdit || isPending}
            onClick={() => setIsVoiceDrawerOpen(true)}
            type="button"
          >
            Configure voice
          </button>
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

        <div className="behavior-panel-body">
          <BehaviorTextField
            canEdit={canEdit}
            defaultValue={values.greeting}
            disabled={isPending}
            help="Spoken first when a conversation starts. Keep it short and natural."
            id="greeting"
            label="Greeting"
            maxLength={500}
            minHeight={84}
            name="greeting"
            onValueChange={updateDirtyState}
            placeholder="Thanks for calling {Business Name}. How can I help you today?"
            variables={[
              { label: '{Business Name}', token: '{Business Name}' },
              { label: '{Agent Name}', token: '{Agent Name}' },
            ]}
          />

          <BehaviorTextField
            canEdit={canEdit}
            defaultValue={values.specialInstructions}
            disabled={isPending}
            help="Tell the agent anything specific about how it should behave. Caller name is not available at session start, so use business/agent tokens only."
            id="specialInstructions"
            label="Special instructions"
            maxLength={2000}
            minHeight={148}
            name="specialInstructions"
            onValueChange={updateDirtyState}
            placeholder="Be friendly and concise. Ask customers one question at a time. Never promise appointment availability."
            variables={[
              { label: '{Business Name}', token: '{Business Name}' },
              { label: '{Agent Name}', token: '{Agent Name}' },
            ]}
          />

          <BehaviorTextField
            canEdit={canEdit}
            defaultValue={values.fallbackMessage}
            disabled={isPending}
            help="What should the agent say when it cannot answer?"
            id="fallbackMessage"
            label="Fallback message"
            maxLength={500}
            minHeight={108}
            name="fallbackMessage"
            onValueChange={updateDirtyState}
            placeholder="I'm sorry, I don't have confirmed information about that. I can take a message for the team instead."
            variables={[
              { label: '{Business Name}', token: '{Business Name}' },
              { label: '{Agent Name}', token: '{Agent Name}' },
            ]}
          />
        </div>

        <div
          className={`capability-card${isPending ? ' is-disabled' : ''}`}
          style={{ marginTop: '16px' }}
        >
          <div className="capability-card-header">
            <div className="capability-card-copy">
              <h3 className="capability-card-title">
                <label htmlFor="interruption-enabled">Allow interruptions</label>
              </h3>
              <p className="capability-card-help">
                Let callers speak over the agent, including the opening greeting
                after a short settle window. Turn off to keep bot speech
                non-interruptible.
              </p>
            </div>
            <label
              className="toggle-switch capability-card-toggle"
              htmlFor="interruption-enabled"
            >
              <input
                checked={interruptionEnabled}
                disabled={!canEdit || isPending}
                id="interruption-enabled"
                name="interruptionEnabled"
                onChange={(event) => setInterruptionEnabled(event.target.checked)}
                type="checkbox"
                value="on"
              />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>
      </section>

      {/* Section 4: Capabilities */}
      <section className="panel" style={{ marginBottom: '24px' }}>
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Capabilities</h2>
            <p className="panel-subtitle">
              Turn on the workflows this agent may run, then choose which fields
              to collect. Required fields stay selected while a capability is
              on. Appointment captures stay requests only — never confirmed
              bookings.
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
                    ensureRequiredFields(next, ['name', 'preferred_time']),
                  )
                }
                requiredFields={['name', 'preferred_time']}
              />

              <div
                className={`capability-card${isPending ? ' is-disabled' : ''}`}
              >
                <div className="capability-card-header">
                  <div className="capability-card-copy">
                    <h3 className="capability-card-title">
                      <label htmlFor="capabilities-offer-handoff">
                        Human handoff / callback
                      </label>
                    </h3>
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

      {state.status === 'error' && state.message ? (
        <div className="notice notice-danger" style={{ marginBottom: '20px' }}>
          {state.message}
        </div>
      ) : null}

      {canEdit ? (
        // Editing an existing agent already has a Save button (plus a
        // scroll-triggered floating fallback) in the page header via
        // form="agent-configuration-form" -- this bottom button is only
        // needed for the /new create flow, which has no header equivalent.
        !agentId && (
          <button className="button" disabled={saveDisabled} type="submit">
            {isPending ? 'Saving...' : 'Create agent'}
          </button>
        )
      ) : (
        <div className="notice">
          You have read-only access. Owners and admins may create or edit agents.
        </div>
      )}
    </form>

    {isVoiceDrawerOpen ? (
      <VoiceConfigDrawer
        disabled={!canEdit || isPending}
        initialTones={selectedTones}
        initialVoiceId={selectedVoiceId}
        initialVoiceName={selectedVoiceName}
        onApply={(next) => {
          setSelectedVoiceId(next.voiceId);
          setSelectedVoiceName(next.voiceName);
          setSelectedTones(next.tones);
          setIsVoiceDrawerOpen(false);
        }}
        onClose={() => setIsVoiceDrawerOpen(false)}
      />
    ) : null}
    </>
  );
}
