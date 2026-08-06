import { sanitizeReturnPath, WORKSPACE_ONBOARDING_PATH } from '../auth/paths';

export const DEFAULT_AUTHENTICATED_PATH = '/dashboard';

export function getAuthenticatedAppPath(options: {
  hasWorkspace: boolean;
  nextPath?: string | null;
}): string {
  const safeNextPath = sanitizeReturnPath(options.nextPath);

  if (!options.hasWorkspace) {
    return WORKSPACE_ONBOARDING_PATH;
  }

  if (safeNextPath === WORKSPACE_ONBOARDING_PATH) {
    return DEFAULT_AUTHENTICATED_PATH;
  }

  return safeNextPath;
}
