export type UsagePeriodId = 'month' | '7d' | '30d';

export type UsageCapStatus = 'within' | 'warning' | 'exceeded';

export type UsageSeriesPoint = {
  label: string;
  value: number;
};

export type UsageNamedValue = {
  label: string;
  value: number;
};

export type UsageLatencySnapshot = {
  p50Seconds: number;
  p95Seconds: number;
};

export type UsageAnalyticsView = {
  averageSessionMinutes: number;
  capMinutes: number;
  capStatus: UsageCapStatus;
  connectedMinutes: number;
  estimatedTokensLabel: string;
  latency: UsageLatencySnapshot | null;
  minutesByAgent: UsageNamedValue[];
  minutesOverTime: UsageSeriesPoint[];
  outcomes: UsageNamedValue[];
  periodId: UsagePeriodId;
  periodLabel: string;
  remainingMinutes: number;
  sessionCount: number;
  usedPercent: number;
};
