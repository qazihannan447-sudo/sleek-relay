import { DashboardShell } from './dashboard-shell';

type DashboardLoadingSection =
  | 'agents'
  | 'business'
  | 'conversations'
  | 'knowledge'
  | 'overview';

type DashboardLoadingLayout =
  | 'overview'
  | 'list'
  | 'form'
  | 'detail'
  | 'business'
  | 'knowledge'
  | 'conversations'
  | 'voice-test';

type DashboardLoadingProps = {
  currentSection: DashboardLoadingSection;
  layout: DashboardLoadingLayout;
  showHeader?: boolean;
};

function SkeletonLines({
  count,
  variant = 'default',
}: {
  count: number;
  variant?: 'compact' | 'default';
}) {
  return (
    <div className="skeleton-stack">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={`${variant}-${index}`}
          className={
            variant === 'compact'
              ? 'skeleton-line skeleton-line-compact'
              : 'skeleton-line'
          }
        />
      ))}
    </div>
  );
}

function SkeletonButton({ short = false }: { short?: boolean }) {
  return (
    <div
      className={short ? 'skeleton-button skeleton-button-short' : 'skeleton-button'}
    />
  );
}

function SkeletonHeader() {
  return (
    <div className="page-header skeleton-page-header">
      <div className="skeleton-kicker" />
      <div className="skeleton-title" />
      <div className="skeleton-subtitle-stack">
        <div className="skeleton-line" />
        <div className="skeleton-line skeleton-line-compact" />
      </div>
    </div>
  );
}

function SkeletonPanelHeading({ withAction = false }: { withAction?: boolean }) {
  return (
    <div className="panel-heading skeleton-panel-heading">
      <div className="skeleton-panel-copy">
        <div className="skeleton-panel-title" />
        <div className="skeleton-panel-subtitle" />
      </div>
      {withAction ? <SkeletonButton short={true} /> : null}
    </div>
  );
}

function SkeletonKeyValueList({ rows }: { rows: number }) {
  return (
    <div className="kv-list">
      {Array.from({ length: rows }, (_, index) => (
        <div className="kv-row" key={index}>
          <div className="skeleton-key" />
          <div className="skeleton-value" />
        </div>
      ))}
    </div>
  );
}

function SkeletonTable({ columns, rows }: { columns: number; rows: number }) {
  return (
    <div className="skeleton-table">
      <div className="skeleton-table-row skeleton-table-header">
        {Array.from({ length: columns }, (_, index) => (
          <div className="skeleton-line skeleton-line-compact" key={index} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div className="skeleton-table-row" key={rowIndex}>
          {Array.from({ length: columns }, (_, columnIndex) => (
            <div
              className={
                columnIndex === 0
                  ? 'skeleton-line'
                  : 'skeleton-line skeleton-line-compact'
              }
              key={columnIndex}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function SkeletonStats() {
  return (
    <div className="stat-grid">
      {Array.from({ length: 2 }, (_, index) => (
        <section className="stat-card skeleton-panel" key={index}>
          <div className="skeleton-stat-label" />
          <div className="skeleton-stat-value" />
          <div className="skeleton-stat-detail" />
        </section>
      ))}
    </div>
  );
}

function SkeletonAgentList() {
  return (
    <section className="panel skeleton-panel">
      <SkeletonPanelHeading />
      <div className="agent-list">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="agent-row" key={index}>
            <div className="agent-row-copy">
              <div className="skeleton-agent-name" />
              <div className="skeleton-agent-role" />
            </div>
            <div className="skeleton-pill" />
          </div>
        ))}
      </div>
    </section>
  );
}

function SkeletonTopGrid({
  leftRows,
  rightRows,
  rightAction = false,
}: {
  leftRows: number;
  rightRows: number;
  rightAction?: boolean;
}) {
  return (
    <div className="overview-top-grid">
      <section className="panel skeleton-panel">
        <SkeletonPanelHeading withAction={true} />
        <SkeletonKeyValueList rows={leftRows} />
      </section>

      <section className="shell-card skeleton-panel">
        <SkeletonPanelHeading />
        {rightAction ? (
          <div className="skeleton-action-stack">
            <SkeletonButton />
            {rightRows > 0 ? <SkeletonLines count={rightRows} variant="compact" /> : null}
          </div>
        ) : (
          <SkeletonLines count={rightRows} variant="compact" />
        )}
      </section>
    </div>
  );
}

function SkeletonFormGrid({ fields }: { fields: number }) {
  return (
    <div className="business-form-grid">
      {Array.from({ length: fields }, (_, index) => (
        <div className="field" key={index}>
          <div className="skeleton-field-label" />
          <div className="skeleton-input" />
        </div>
      ))}
    </div>
  );
}

function SkeletonTextArea({ rows = 1 }: { rows?: number }) {
  return (
    <div className="field">
      <div className="skeleton-field-label" />
      <div className={`skeleton-textarea skeleton-textarea-${rows}`} />
    </div>
  );
}

function SkeletonBusinessForm() {
  return (
    <section className="panel skeleton-panel">
      <SkeletonPanelHeading />
      <div className="business-form">
        <SkeletonFormGrid fields={7} />

        <section className="hours-panel">
          <SkeletonPanelHeading />
          <div className="hours-grid">
            {Array.from({ length: 7 }, (_, index) => (
              <div className="hours-row" key={index}>
                <div className="skeleton-day" />
                <div className="skeleton-toggle" />
                <div className="skeleton-hours-inputs">
                  <div className="skeleton-input skeleton-time-input" />
                  <div className="skeleton-hours-separator" />
                  <div className="skeleton-input skeleton-time-input" />
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="skeleton-notice" />
        <SkeletonButton />
      </div>
    </section>
  );
}

function SkeletonAgentForm() {
  return (
    <section className="panel skeleton-panel skeleton-panel-spaced">
      <SkeletonPanelHeading />
      <div className="business-form">
        <SkeletonFormGrid fields={8} />
        <SkeletonTextArea rows={2} />
        <SkeletonTextArea rows={3} />
        <SkeletonTextArea rows={2} />
        <div className="skeleton-checkbox-row" />
        <div className="skeleton-notice" />
        <SkeletonButton />
      </div>
    </section>
  );
}

function SkeletonKnowledgeForm() {
  return (
    <section className="panel skeleton-panel skeleton-panel-spaced">
      <SkeletonPanelHeading />
      <div className="business-form">
        <SkeletonFormGrid fields={3} />
        <SkeletonTextArea rows={4} />
        <div className="skeleton-notice" />
        <SkeletonButton />
      </div>
    </section>
  );
}

function SkeletonVoiceTestPanel() {
  return (
    <section className="panel skeleton-panel skeleton-panel-spaced">
      <SkeletonPanelHeading />

      <div className="voice-test-grid">
        {Array.from({ length: 2 }, (_, index) => (
          <div className="voice-summary-card" key={index}>
            <div className="skeleton-panel-title skeleton-panel-title-compact" />
            <SkeletonLines count={2} variant="compact" />
          </div>
        ))}
      </div>

      <div className="skeleton-action-row">
        <SkeletonButton short={true} />
        <SkeletonButton short={true} />
      </div>

      <div className="voice-speaker-state">
        <div className="skeleton-pill" />
        <div className="skeleton-pill" />
        <div className="skeleton-pill" />
      </div>

      <div className="skeleton-transcript-list">
        {Array.from({ length: 3 }, (_, index) => (
          <div className="voice-transcript-item" key={index}>
            <div className="skeleton-transcript-meta" />
            <SkeletonLines count={3} />
          </div>
        ))}
      </div>
    </section>
  );
}

function renderLayout(layout: DashboardLoadingLayout) {
  switch (layout) {
    case 'overview':
      return (
        <div className="overview-grid">
          <SkeletonStats />
          <SkeletonAgentList />
        </div>
      );
    case 'list':
      return (
        <>
          <SkeletonTopGrid leftRows={3} rightRows={1} rightAction={true} />
          <section className="panel skeleton-panel skeleton-panel-spaced">
            <SkeletonPanelHeading />
            <SkeletonTable columns={5} rows={4} />
          </section>
        </>
      );
    case 'business':
      return <SkeletonBusinessForm />;
    case 'detail':
      return (
        <>
          <SkeletonTopGrid leftRows={4} rightRows={1} rightAction={true} />
          <SkeletonAgentForm />
        </>
      );
    case 'form':
      return <SkeletonAgentForm />;
    case 'knowledge':
      return (
        <>
          <SkeletonTopGrid leftRows={3} rightRows={1} rightAction={true} />
          <SkeletonKnowledgeForm />
        </>
      );
    case 'conversations':
      return (
        <>
          <SkeletonTopGrid leftRows={4} rightRows={4} />
          <section className="panel skeleton-panel skeleton-panel-spaced">
            <SkeletonPanelHeading />
            <SkeletonTable columns={7} rows={5} />
          </section>
        </>
      );
    case 'voice-test':
      return (
        <>
          <SkeletonTopGrid leftRows={4} rightRows={2} />
          <SkeletonVoiceTestPanel />
        </>
      );
    default:
      return null;
  }
}

export function DashboardLoading({
  currentSection,
  layout,
  showHeader = true,
}: DashboardLoadingProps) {
  return (
    <DashboardShell
      currentSection={currentSection}
      email={null}
      membershipRole={null}
      tenantName={null}
    >
      {showHeader ? <SkeletonHeader /> : null}
      {renderLayout(layout)}
    </DashboardShell>
  );
}
