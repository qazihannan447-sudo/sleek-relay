import type { UsageCapStatus } from './types';

export function formatMinutes(value: number): string {
  if (Number.isInteger(value)) {
    return `${value}`;
  }

  return value.toFixed(1);
}

export function formatMinutesLabel(value: number): string {
  return `${formatMinutes(value)} min`;
}

export function formatSecondsLabel(value: number): string {
  return `${value.toFixed(1)}s`;
}

export function usageCapStatusLabel(status: UsageCapStatus): string {
  switch (status) {
    case 'exceeded':
      return 'Over cap';
    case 'warning':
      return 'Nearing limit';
    default:
      return 'Within limits';
  }
}

export function usageCapStatusToneClass(status: UsageCapStatus): string {
  switch (status) {
    case 'exceeded':
      return 'usage-status-pill usage-status-pill-danger';
    case 'warning':
      return 'usage-status-pill usage-status-pill-warning';
    default:
      return 'usage-status-pill usage-status-pill-success';
  }
}
