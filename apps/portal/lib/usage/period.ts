import type { UsagePeriodId } from './types';

export const USAGE_PERIODS: Array<{
  id: UsagePeriodId;
  label: string;
}> = [
  { id: 'month', label: 'This month' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
];

export function normalizeUsagePeriod(
  value: string | string[] | undefined,
): UsagePeriodId {
  const raw = Array.isArray(value) ? value[0] : value;

  if (raw === '7d' || raw === '30d' || raw === 'month') {
    return raw;
  }

  return 'month';
}

export function usagePeriodLabel(periodId: UsagePeriodId): string {
  return USAGE_PERIODS.find((period) => period.id === periodId)?.label ?? 'This month';
}

export function buildUsagePeriodHref(periodId: UsagePeriodId): string {
  if (periodId === 'month') {
    return '/dashboard/usage';
  }

  return `/dashboard/usage?period=${periodId}`;
}
