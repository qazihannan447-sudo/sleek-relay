'use client';

import { useActionState } from 'react';

import { TimezoneCombobox } from '../../dashboard/business/timezone-combobox';
import {
  emptyWorkspaceOnboardingValues,
  initialWorkspaceOnboardingState,
  type WorkspaceOnboardingState,
} from '../../../lib/onboarding/validation';
import { createWorkspace, signOutToLogin } from './actions';

const placeholders = {
  businessName: 'Acme Dental Care',
  category: 'Family dental clinic',
  workspaceName: 'Acme Relay Workspace',
} as const;

type WorkspaceFormProps = {
  email: string;
};

export function WorkspaceForm({ email }: WorkspaceFormProps) {
  const [state, formAction, isPending] = useActionState<
    WorkspaceOnboardingState,
    FormData
  >(createWorkspace, initialWorkspaceOnboardingState());
  const values = state.values ?? emptyWorkspaceOnboardingValues();

  return (
    <form action={formAction} className="workspace-form">
      <div className="workspace-copy">
        <p className="eyebrow">Workspace Setup</p>
        <h1>Create your workspace</h1>
        <p className="auth-copy">
          You&apos;re signed in as <strong>{email}</strong>. Set up your business
          workspace to unlock agents, knowledge, and the voice-testing dashboard.
        </p>
      </div>

      <div className="workspace-form-grid">
        <div className="field">
          <label htmlFor="workspaceName">Workspace name</label>
          <input
            defaultValue={values.workspaceName}
            disabled={isPending}
            id="workspaceName"
            name="workspaceName"
            placeholder={placeholders.workspaceName}
            required
            type="text"
          />
        </div>

        <div className="field">
          <label htmlFor="businessName">Business name</label>
          <input
            defaultValue={values.businessName}
            disabled={isPending}
            id="businessName"
            name="businessName"
            placeholder={placeholders.businessName}
            required
            type="text"
          />
        </div>

        <div className="field">
          <label htmlFor="category">Category</label>
          <input
            defaultValue={values.category}
            disabled={isPending}
            id="category"
            name="category"
            placeholder={placeholders.category}
            type="text"
          />
        </div>

        <div className="field">
          <label htmlFor="timezone">Timezone</label>
          <TimezoneCombobox
            disabled={isPending}
            name="timezone"
            value={values.timezone}
          />
        </div>
      </div>

      <div className="notice">
        This creates your workspace, assigns you as the owner, and prepares the
        shared business configuration used by your future agents.
      </div>

      {state.message ? (
        <div className="notice notice-danger">{state.message}</div>
      ) : null}

      <div className="workspace-actions">
        <button className="button" disabled={isPending} type="submit">
          {isPending ? 'Creating workspace...' : 'Create workspace'}
        </button>
        <button
          className="button-secondary"
          disabled={isPending}
          formAction={signOutToLogin}
          formNoValidate
          type="submit"
        >
          Back to login
        </button>
      </div>
    </form>
  );
}
