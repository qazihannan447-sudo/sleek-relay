export function isMissingAuthSessionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const name = 'name' in error && typeof error.name === 'string'
    ? error.name
    : '';
  const message = 'message' in error && typeof error.message === 'string'
    ? error.message
    : '';

  return (
    name === 'AuthSessionMissingError' ||
    message === 'Auth session missing!'
  );
}
