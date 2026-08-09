import Link from 'next/link';

import {
  formatMinutes,
  formatMinutesLabel,
  formatSecondsLabel,
  usageCapStatusLabel,
  usageCapStatusToneClass,
} from '../../../lib/usage/format';
import type { UsageAnalyticsView } from '../../../lib/usage/types';
import {
  UsageBarChart,
  UsageDonutChart,
  UsageLineChart,
  UsageShareDonutChart,
} from './usage-charts';
import { UsagePeriodTabs } from './usage-period-tabs';

type UsageDashboardProps = {
  analytics: UsageAnalyticsView;
};

function CapBanner({ analytics }: { analytics: UsageAnalyticsView }) {
  if (analytics.capStatus === 'within' || analytics.sessionCount === 0) {
    return null;
  }

  const toneClass =
    analytics.capStatus === 'exceeded'
      ? 'notice notice-danger'
      : 'notice notice-warning';

  const message =
    analytics.capStatus === 'exceeded'
      ? `${formatMinutes(analytics.connectedMinutes)} of ${analytics.capMinutes} connected minutes used. The monthly cap is reached.`
      : `${formatMinutes(analytics.connectedMinutes)} of ${analytics.capMinutes} connected minutes used (${analytics.usedPercent}%). New sessions can still start until the hard cap.`;

  return <div className={toneClass}>{message}</div>;
}

function ChartEmptyState({ message }: { message: string }) {
  return <p className="usage-chart-empty">{message}</p>;
}

export function UsageDashboard({ analytics }: UsageDashboardProps) {
  const hasSessions = analytics.sessionCount > 0;

  return (
    <div className="usage-dashboard">
      <div className="usage-toolbar">
        <UsagePeriodTabs activePeriod={analytics.periodId} />
        <span className={usageCapStatusToneClass(analytics.capStatus)}>
          <span className="usage-status-dot" />
          {usageCapStatusLabel(analytics.capStatus)}
        </span>
      </div>

      <CapBanner analytics={analytics} />

      <div className="stat-grid usage-stat-grid">
        <section className="stat-card">
          <div className="stat-label">Connected minutes</div>
          <div className="stat-value">
            {formatMinutes(analytics.connectedMinutes)} / {analytics.capMinutes}
          </div>
          <div className="usage-progress-track" aria-hidden="true">
            <div
              className={
                analytics.capStatus === 'exceeded'
                  ? 'usage-progress-fill usage-progress-fill-danger'
                  : analytics.capStatus === 'warning'
                    ? 'usage-progress-fill usage-progress-fill-warning'
                    : 'usage-progress-fill'
              }
              style={{ width: `${Math.min(analytics.usedPercent, 100)}%` }}
            />
          </div>
          <div className="stat-detail">
            {analytics.usedPercent}% of default monthly cap
          </div>
        </section>

        <section className="stat-card">
          <div className="stat-label">Sessions</div>
          <div className="stat-value">{analytics.sessionCount}</div>
          <div className="stat-detail">
            Conversations in {analytics.periodLabel.toLowerCase()}
          </div>
        </section>

        <section className="stat-card">
          <div className="stat-label">Avg session</div>
          <div className="stat-value">
            {hasSessions
              ? formatMinutesLabel(analytics.averageSessionMinutes)
              : '—'}
          </div>
          <div className="stat-detail">Connected duration</div>
        </section>

        <section className="stat-card">
          <div className="stat-label">Est. tokens</div>
          <div className="stat-value">{analytics.estimatedTokensLabel}</div>
          <div className="stat-detail">
            {analytics.hasTokenMetering
              ? 'Prompt + completion tokens'
              : 'Token metering not recorded yet'}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Connected minutes over time</h2>
            <p className="panel-subtitle">
              Daily connected minutes · {analytics.periodLabel.toLowerCase()}
            </p>
          </div>
        </div>
        {hasSessions ? (
          <UsageLineChart
            periodId={analytics.periodId}
            points={analytics.minutesOverTime}
          />
        ) : (
          <ChartEmptyState message="Minutes will appear after the first conversation in this period." />
        )}
      </section>

      <div className="usage-charts-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Minutes by agent</h2>
              <p className="panel-subtitle">
                Connected minutes · {analytics.periodLabel.toLowerCase()}
              </p>
            </div>
          </div>
          {analytics.minutesByAgent.length > 0 ? (
            <UsageBarChart items={analytics.minutesByAgent} />
          ) : (
            <ChartEmptyState message="No agent usage in this period." />
          )}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Cap remaining</h2>
              <p className="panel-subtitle">
                Default monthly connected-minute budget
              </p>
            </div>
          </div>
          <UsageDonutChart
            centerDetail={`Hard stop reference at ${analytics.capMinutes} minutes`}
            centerLabel={`${formatMinutes(analytics.remainingMinutes)} min left`}
            remaining={analytics.remainingMinutes}
            used={Math.min(analytics.connectedMinutes, analytics.capMinutes)}
          />
        </section>
      </div>

      <div className="usage-charts-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Session outcomes</h2>
              <p className="panel-subtitle">
                Share of sessions · {analytics.periodLabel.toLowerCase()}
              </p>
            </div>
          </div>
          {analytics.outcomes.length > 0 ? (
            <UsageShareDonutChart
              ariaLabel="Session outcomes"
              centerDetail="sessions"
              centerLabel={String(
                analytics.outcomes.reduce((sum, item) => sum + item.value, 0),
              )}
              items={analytics.outcomes}
            />
          ) : (
            <ChartEmptyState message="Outcomes will appear once conversations complete." />
          )}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Latency snapshot</h2>
              <p className="panel-subtitle">
                Speech-stop to bot speaking · {analytics.periodLabel.toLowerCase()}
              </p>
            </div>
          </div>

          {analytics.latency ? (
            <div className="usage-latency-grid">
              <section className="usage-latency-card">
                <div className="stat-label">p50 response</div>
                <div className="usage-latency-value">
                  {formatSecondsLabel(analytics.latency.p50Seconds)}
                </div>
              </section>
              <section className="usage-latency-card">
                <div className="stat-label">p95 response</div>
                <div className="usage-latency-value">
                  {formatSecondsLabel(analytics.latency.p95Seconds)}
                </div>
              </section>
            </div>
          ) : (
            <ChartEmptyState message="Latency appears after sessions store turn metrics." />
          )}

          <div className="usage-conversations-cta">
            <p className="muted-copy">
              Session-level duration and outcomes live on Conversations. This
              page stays chart-focused.
            </p>
            <Link className="button" href="/dashboard/conversations">
              View conversations
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
