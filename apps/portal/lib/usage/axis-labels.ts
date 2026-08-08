import type { UsagePeriodId } from './types';

/**
 * Decides which day labels appear on the connected-minutes chart x-axis.
 * For the 30-day period, only calendar days divisible by 5 are labeled
 * (5, 10, 15, 20, 25, 30) so the axis stays readable.
 */
export function shouldShowUsageAxisLabel(
  dayKey: string,
  periodId: UsagePeriodId,
): boolean {
  if (periodId !== '30d') {
    return true;
  }

  const day = Number(dayKey.split('-')[2]);
  if (!Number.isInteger(day) || day <= 0) {
    return false;
  }

  return day % 5 === 0;
}
