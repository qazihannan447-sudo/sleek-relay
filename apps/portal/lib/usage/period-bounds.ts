import { usagePeriodLabel } from './period';
import type { UsagePeriodId } from './types';

export type UsagePeriodBounds = {
  end: Date;
  start: Date;
};

export function resolveUsagePeriodBounds(
  periodId: UsagePeriodId,
  now: Date = new Date(),
): UsagePeriodBounds {
  const end = new Date(now);

  if (periodId === '7d') {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    start.setUTCDate(start.getUTCDate() - 6);
    return { start, end };
  }

  if (periodId === '30d') {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    start.setUTCDate(start.getUTCDate() - 29);
    return { start, end };
  }

  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start, end };
}

export function formatUsageDayKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatUsageDayLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  if (!year || !month || !day) {
    return dayKey;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function listUsageDayKeys(bounds: UsagePeriodBounds): string[] {
  const keys: string[] = [];
  const cursor = new Date(
    Date.UTC(
      bounds.start.getUTCFullYear(),
      bounds.start.getUTCMonth(),
      bounds.start.getUTCDate(),
    ),
  );
  const endDay = new Date(
    Date.UTC(
      bounds.end.getUTCFullYear(),
      bounds.end.getUTCMonth(),
      bounds.end.getUTCDate(),
    ),
  );

  while (cursor.getTime() <= endDay.getTime()) {
    keys.push(formatUsageDayKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return keys;
}

export function describeUsagePeriod(
  periodId: UsagePeriodId,
  bounds: UsagePeriodBounds,
): string {
  const startLabel = formatUsageDayLabel(formatUsageDayKey(bounds.start));
  const endLabel = formatUsageDayLabel(formatUsageDayKey(bounds.end));
  return `${usagePeriodLabel(periodId)} · ${startLabel} – ${endLabel}`;
}
