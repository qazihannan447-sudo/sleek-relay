import {
  DEFAULT_CANADIAN_TIMEZONE,
  isCanadianTimezone,
} from '../business-configuration/canadian-timezones';

export type WorkspaceOnboardingValues = {
  businessName: string;
  category: string;
  timezone: string;
  workspaceName: string;
};

export type WorkspaceOnboardingState = {
  message: string | null;
  status: 'error' | 'idle';
  values: WorkspaceOnboardingValues;
};

export type WorkspaceOnboardingValidationResult =
  | {
      errors: string[];
      values: WorkspaceOnboardingValues;
    }
  | {
      values: WorkspaceOnboardingValues;
    };

function normalizeText(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function emptyWorkspaceOnboardingValues(): WorkspaceOnboardingValues {
  return {
    businessName: '',
    category: '',
    timezone: DEFAULT_CANADIAN_TIMEZONE,
    workspaceName: '',
  };
}

export function initialWorkspaceOnboardingState(
  values: WorkspaceOnboardingValues = emptyWorkspaceOnboardingValues(),
): WorkspaceOnboardingState {
  return {
    message: null,
    status: 'idle',
    values,
  };
}

export function parseWorkspaceOnboardingForm(
  formData: FormData,
): WorkspaceOnboardingValidationResult {
  const values: WorkspaceOnboardingValues = {
    businessName: normalizeText(formData.get('businessName')),
    category: normalizeText(formData.get('category')),
    timezone: normalizeText(formData.get('timezone')),
    workspaceName: normalizeText(formData.get('workspaceName')),
  };
  const errors: string[] = [];

  if (!values.workspaceName) {
    errors.push('Workspace name is required.');
  }

  if (!values.businessName) {
    errors.push('Business name is required.');
  }

  if (!values.timezone) {
    errors.push('Timezone is required.');
  } else if (!isCanadianTimezone(values.timezone)) {
    errors.push('Timezone must be one of the six Canadian timezones.');
  }

  if (errors.length > 0) {
    return {
      errors,
      values,
    };
  }

  return {
    values,
  };
}
