/**
 * Formats an ISO timestamp string for display in the dashboard.
 *
 * Uses 24-hour clock time (e.g. "Aug 6, 2026, 15:08") so the output is
 * unambiguous and consistent regardless of the browser's locale settings.
 */
const FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const TIME_WITH_SECONDS_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatTimestamp(value: string | null, fallback = 'Unknown'): string {
  if (!value) return fallback;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return 'Unknown';

  // e.g. "6 Aug 2026, 15:08"
  return FORMATTER.format(date);
}

/** Time-only display with seconds, e.g. "15:08:42". */
export function formatTimeWithSeconds(
  value: string | null,
  fallback = 'Unknown',
): string {
  if (!value) return fallback;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return 'Unknown';

  return TIME_WITH_SECONDS_FORMATTER.format(date);
}
