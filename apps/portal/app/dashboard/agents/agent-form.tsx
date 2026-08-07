'use client';

import { useActionState, useState } from 'react';

import { CustomSelect } from './custom-select';
import { ToneSelector } from './tone-selector';
import { saveAgent } from './actions';
import { type AgentStatus, type AgentValues } from '../../../lib/agents/schema';
import {
  initialAgentActionState,
  type AgentActionState,
} from '../../../lib/agents/validation';

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
};

function getFieldValues(
  state: AgentActionState,
  fallback: AgentValues,
): AgentValues {
  return state.values ?? fallback;
}

export function AgentForm({
  agentId,
  canEdit,
  defaultValues,
}: AgentFormProps) {
  const [state, formAction, isPending] = useActionState<AgentActionState, FormData>(
    saveAgent,
    initialAgentActionState(defaultValues),
  );
  const values = getFieldValues(state, defaultValues);

  const [status, setStatus] = useState<AgentStatus>(values.status ?? 'draft');

  const formKey = `${agentId || 'new'}-${values.name}-${values.greeting}-${values.specialInstructions}-${values.fallbackMessage}`;

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

      {/* Section 2: Voice & Runtime Settings */}
      <section className="panel" style={{ marginBottom: '24px' }}>
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Voice & Runtime Settings</h2>
            <p className="panel-subtitle">
              Configure speech voice and session thresholds.
            </p>
          </div>
        </div>

        <div className="business-form-grid">
          <div className="field">
            <label htmlFor="voiceId">Voice ID</label>
            <p className="hint-text" style={{ fontSize: '0.85rem', margin: '-4px 0 4px 0' }}>
              Leave blank to use default system voice, or paste your own Cartesia Voice ID.
            </p>
            <input
              defaultValue={values.voiceId}
              disabled={!canEdit || isPending}
              id="voiceId"
              name="voiceId"
              placeholder="e.g. 24468223-0373-4c42-a0b8-09477563a97d or custom Cartesia Voice ID"
              type="text"
            />
          </div>

          <div className="field">
            <label>Tone</label>
            <ToneSelector
              defaultValue={values.tone}
              disabled={!canEdit || isPending}
              name="tone"
            />
          </div>

          <div className="field">
            <label htmlFor="silenceTimeoutSeconds">Silence timeout (seconds)</label>
            <input
              defaultValue={values.silenceTimeoutSeconds}
              disabled={!canEdit || isPending}
              id="silenceTimeoutSeconds"
              min="3"
              max="120"
              name="silenceTimeoutSeconds"
              type="number"
            />
          </div>

          <div className="field">
            <label htmlFor="maximumSessionDurationSeconds">
              Maximum session duration (seconds)
            </label>
            <input
              defaultValue={values.maximumSessionDurationSeconds}
              disabled={!canEdit || isPending}
              id="maximumSessionDurationSeconds"
              min="60"
              max="7200"
              name="maximumSessionDurationSeconds"
              type="number"
            />
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
          <p className="hint-text" style={{ fontSize: '0.85rem', margin: '-4px 0 4px 0' }}>
            The initial phrase your agent speaks when starting a conversation.
          </p>
          <textarea
            defaultValue={values.greeting}
            disabled={!canEdit || isPending}
            id="greeting"
            name="greeting"
            placeholder="Hello! Thank you for calling. How can I help you today?"
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
