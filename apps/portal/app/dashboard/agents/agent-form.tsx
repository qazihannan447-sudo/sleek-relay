'use client';

import { useActionState } from 'react';

import { saveAgent } from './actions';
import { type AgentValues } from '../../../lib/agents/schema';
import {
  initialAgentActionState,
  type AgentActionState,
} from '../../../lib/agents/validation';

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

  return (
    <form action={formAction} className="business-form">
      <input name="agentId" type="hidden" value={agentId ?? ''} />

      <div className="business-form-grid">
        <div className="field">
          <label htmlFor="name">Agent name</label>
          <input
            defaultValue={values.name}
            disabled={!canEdit || isPending}
            id="name"
            name="name"
            required
            type="text"
          />
        </div>

        <div className="field">
          <label htmlFor="role">Role</label>
          <input
            defaultValue={values.role}
            disabled={!canEdit || isPending}
            id="role"
            name="role"
            required
            type="text"
          />
        </div>

        <div className="field">
          <label htmlFor="language">Language</label>
          <input
            defaultValue={values.language}
            disabled={!canEdit || isPending}
            id="language"
            name="language"
            required
            type="text"
          />
        </div>

        <div className="field">
          <label htmlFor="status">Status</label>
          <select
            defaultValue={values.status}
            disabled={!canEdit || isPending}
            id="status"
            name="status"
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="voiceId">Voice ID</label>
          <input
            defaultValue={values.voiceId}
            disabled={!canEdit || isPending}
            id="voiceId"
            name="voiceId"
            type="text"
          />
        </div>

        <div className="field">
          <label htmlFor="tone">Tone</label>
          <input
            defaultValue={values.tone}
            disabled={!canEdit || isPending}
            id="tone"
            name="tone"
            type="text"
          />
        </div>

        <div className="field">
          <label htmlFor="silenceTimeoutSeconds">Silence timeout</label>
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
            Maximum session duration
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

      <div className="field">
        <label htmlFor="greeting">Greeting</label>
        <textarea
          defaultValue={values.greeting}
          disabled={!canEdit || isPending}
          id="greeting"
          name="greeting"
          rows={4}
        />
      </div>

      <div className="field">
        <label htmlFor="specialInstructions">Special instructions</label>
        <textarea
          defaultValue={values.specialInstructions}
          disabled={!canEdit || isPending}
          id="specialInstructions"
          name="specialInstructions"
          rows={5}
        />
      </div>

      <div className="field">
        <label htmlFor="fallbackMessage">Fallback message</label>
        <textarea
          defaultValue={values.fallbackMessage}
          disabled={!canEdit || isPending}
          id="fallbackMessage"
          name="fallbackMessage"
          rows={4}
        />
      </div>

      <label className="checkbox-field">
        <input
          defaultChecked={values.interruptionEnabled}
          disabled={!canEdit || isPending}
          name="interruptionEnabled"
          type="checkbox"
        />
        <span>Allow interruption handling during the voice session</span>
      </label>

      <div className="notice">
        Agents inherit shared business facts from the tenant business
        configuration. Keep business data there, and use this form only for
        agent-specific behavior and runtime settings.
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
