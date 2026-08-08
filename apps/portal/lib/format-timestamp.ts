import {
  DEFAULT_CANADIAN_TIMEZONE,
  isCanadianTimezone,
} from './business-configuration/canadian-timezones';

export type FormatTimestampOptions = {
  fallback?: string;
  timeZone?: string | null;
};

const timestampFormatters = new Map<string, Intl.DateTimeFormat>();
const timeWithSecondsFormatters = new Map<string, Intl.DateTimeFormat>();

const LOCAL_FORMATTER_KEY = '__local__';

/**
 * Resolves a dashboard display timezone from the tenant business configuration.
 * Falls back to the default Canadian timezone when unset or invalid.
 */
export function resolveDisplayTimezone(timezone: string | null | undefined): string {
  if (timezone && isCanadianTimezone(timezone)) {
    return timezone;
  }

  return DEFAULT_CANADIAN_TIMEZONE;
}

function getTimestampFormatter(timeZone: string | null): Intl.DateTimeFormat {
  const cacheKey = timeZone ?? LOCAL_FORMATTER_KEY;
  const cached = timestampFormatters.get(cacheKey);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  });
  timestampFormatters.set(cacheKey, formatter);
  return formatter;
}

function getTimeWithSecondsFormatter(timeZone: string | null): Intl.DateTimeFormat {
  const cacheKey = timeZone ?? LOCAL_FORMATTER_KEY;
  const cached = timeWithSecondsFormatters.get(cacheKey);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  });
  timeWithSecondsFormatters.set(cacheKey, formatter);
  return formatter;
}

function resolveOptionalDisplayTimezone(
  timeZone: string | null | undefined,
  explicit: boolean,
): string | null {
  if (!explicit) {
    return null;
  }

  return resolveDisplayTimezone(timeZone);
}

/**
 * Formats an ISO timestamp string for display in the dashboard.
 *
 * Uses 24-hour clock time (e.g. "6 Aug 2026, 15:08"). When `timeZone` is
 * provided, formats in that workspace business timezone.
 */
export function formatTimestamp(
  value: string | null,
  options: FormatTimestampOptions = {},
): string {
  const fallback = options.fallback ?? 'Unknown';
  if (!value) return fallback;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return 'Unknown';

  const timeZone = resolveOptionalDisplayTimezone(
    options.timeZone,
    Object.prototype.hasOwnProperty.call(options, 'timeZone'),
  );
  // e.g. "6 Aug 2026, 15:08"
  return getTimestampFormatter(timeZone).format(date);
}

/** Time-only display with seconds, e.g. "15:08:42". */
export function formatTimeWithSeconds(
  value: string | null,
  options: FormatTimestampOptions = {},
): string {
  const fallback = options.fallback ?? 'Unknown';
  if (!value) return fallback;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return 'Unknown';

  const timeZone = resolveOptionalDisplayTimezone(
    options.timeZone,
    Object.prototype.hasOwnProperty.call(options, 'timeZone'),
  );
  return getTimeWithSecondsFormatter(timeZone).format(date);
}
