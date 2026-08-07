import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DashboardPageHeader } from '../../../../components/dashboard-page-header';
import { DashboardShell } from '../../../../components/dashboard-shell';
import { WORKSPACE_ONBOARDING_PATH } from '../../../../lib/auth/paths';
import { formatConversationDuration } from '../../../../lib/conversations/helpers';
import { formatTimestamp } from '../../../../lib/format-timestamp';
import {
  loadConversationDetailPageData,
  type ConversationDetailLoaderInput,
} from '../../../../lib/conversations/load-conversation-detail';

export const dynamic = 'force-dynamic';

type ConversationDetailPageProps = {
  params: Promise<{
    conversationId: string;
  }>;
  searchParams: Promise<ConversationDetailLoaderInput>;
};



export default async function ConversationDetailPage({
  params,
  searchParams,
}: ConversationDetailPageProps) {
  const { conversationId } = await params;
  const pageData = await loadConversationDetailPageData(
    conversationId,
    await searchParams,
  );

  if (pageData.kind === 'unauthenticated') {
    redirect(`/login?next=%2Fdashboard%2Fconversations%2F${conversationId}`);
  }

  if (pageData.kind === 'missing-membership') {
    redirect(WORKSPACE_ONBOARDING_PATH);
  }

  if (pageData.kind === 'error') {
    return (
      <DashboardShell
        currentSection="conversations"
        email={pageData.email}
        membershipRole={null}
        tenantName={null}
      >
        <DashboardPageHeader
          subtitle="The selected conversation could not be loaded inside the current tenant scope."
          title="Conversation unavailable"
        />

        <section className="panel">
          <div className="empty-state">
            <div className="notice notice-danger">{pageData.message}</div>
            <Link className="button-secondary" href="/dashboard/conversations">
              Back to conversations
            </Link>
          </div>
        </section>
      </DashboardShell>
    );
  }

  if (pageData.kind === 'not-found') {
    return (
      <DashboardShell
        currentSection="conversations"
        email={pageData.email}
        membershipRole={pageData.membershipRole}
        tenantName={pageData.tenantName}
      >
        <DashboardPageHeader
          subtitle="The requested conversation could not be found in the current tenant scope."
          title="Conversation not found"
        />

        <section className="panel">
          <div className="empty-state">
            <div className="notice">
              The requested conversation is unavailable.
            </div>
            <Link className="button-secondary" href="/dashboard/conversations">
              Back to conversations
            </Link>
          </div>
        </section>
      </DashboardShell>
    );
  }

  const { conversation } = pageData;

  return (
    <DashboardShell
      currentSection="conversations"
      email={pageData.email}
      membershipRole={pageData.membershipRole}
      tenantName={pageData.tenantName}
    >
      <DashboardPageHeader
        subtitle="Review the captured transcript, safe diagnostics, and stored runtime context for this tenant-scoped browser conversation."
        title="Conversation detail"
      />

      <div className="overview-top-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Conversation header</h2>
              <p className="panel-subtitle">
                Server-loaded through the authenticated Supabase session plus
                row-level security.
              </p>
            </div>
            <Link className="button-secondary" href={pageData.backToHref}>
              Back to conversations
            </Link>
          </div>

          <div className="kv-list">
            <div className="kv-row">
              <span className="kv-label">Status</span>
              <span className="kv-value">
                <span className={`status-pill status-pill-${conversation.status}`}>
                  <span className="status-dot" />
                  {conversation.statusLabel}
                </span>
              </span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Agent</span>
              <span className="kv-value">{conversation.agentName}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Source</span>
              <span className="kv-value">{conversation.sourceLabel}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Started</span>
              <span className="kv-value">
                {formatTimestamp(conversation.startedAt)}
              </span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Ended</span>
              <span className="kv-value">{formatTimestamp(conversation.endedAt)}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Duration</span>
              <span className="kv-value">
                {formatConversationDuration(conversation.durationMs)}
              </span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Outcome</span>
              <span className="kv-value">{conversation.outcome}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">End reason</span>
              <span className="kv-value">{conversation.endReason}</span>
            </div>
          </div>
        </section>

        <section className="shell-card">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Summary and outcome</h2>
              <p className="panel-subtitle">
                Stored fields only. No new summary or outcome generation happens
                here.
              </p>
            </div>
          </div>

          <div className="conversation-detail-stack">
            <div className="detail-block">
              <h3 className="detail-block-title">Summary</h3>
              <p className="detail-block-copy">{conversation.summary}</p>
            </div>
            <div className="detail-block">
              <h3 className="detail-block-title">Outcome</h3>
              <p className="detail-block-copy">{conversation.outcome}</p>
            </div>
            <div className="detail-block">
              <h3 className="detail-block-title">End reason</h3>
              <p className="detail-block-copy">{conversation.endReason}</p>
            </div>
          </div>
        </section>
      </div>

      {conversation.status === 'failed' ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Failure details</h2>
              <p className="panel-subtitle">
                Stored safe fields only. Raw provider payloads and stack traces
                are not shown.
              </p>
            </div>
          </div>

          <div className="notice notice-danger conversation-error-card">
            <div className="conversation-detail-stack">
              <div className="detail-block">
                <h3 className="detail-block-title">Error code</h3>
                <p className="detail-block-copy">
                  {conversation.errorCode ?? 'Not set'}
                </p>
              </div>
              <div className="detail-block">
                <h3 className="detail-block-title">Error message</h3>
                <p className="detail-block-copy">
                  {conversation.errorMessage ?? 'No stored error message.'}
                </p>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Transcript</h2>
            <p className="panel-subtitle">
              Messages are ordered by sequence number and rendered as plain text
              only.
            </p>
          </div>
        </div>

        {pageData.transcriptState === 'results' ? (
          <div className="voice-transcript-list">
            {pageData.messages.map((message) => (
              <article
                className={`voice-transcript-item voice-transcript-item-${message.role} conversation-message-card`}
                key={message.id}
              >
                <div className="voice-transcript-meta conversation-message-meta">
                  <span>#{message.sequenceNumber}</span>
                  <span>{message.roleLabel}</span>
                  <span>{message.stateLabel}</span>
                  {message.interruptedLabel ? (
                    <span className="conversation-message-flag">
                      {message.interruptedLabel}
                    </span>
                  ) : null}
                  <span>{formatTimestamp(message.timestamp)}</span>
                </div>
                <p className="voice-transcript-text">{message.content}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="notice">
              No transcript messages were stored for this conversation.
            </div>
          </div>
        )}
      </section>

      <div className="overview-top-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Latency metrics</h2>
              <p className="panel-subtitle">
                Safe allowlisted diagnostics from stored metric fields only.
              </p>
            </div>
          </div>

          {pageData.latencyMetrics.length > 0 ? (
            <div className="kv-list">
              {pageData.latencyMetrics.map((metric) => (
                <div className="kv-row" key={metric.key}>
                  <span className="kv-label">{metric.label}</span>
                  <span className="kv-value">{metric.valueLabel}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="notice">No safe latency metrics were stored.</div>
          )}
        </section>

        <section className="shell-card">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Metadata</h2>
              <p className="panel-subtitle">
                A small safe allowlist only. Secret or internal fields are
                ignored.
              </p>
            </div>
          </div>

          {pageData.metadataFields.length > 0 ? (
            <div className="kv-list">
              {pageData.metadataFields.map((field) => (
                <div className="kv-row" key={field.label}>
                  <span className="kv-label">{field.label}</span>
                  <span className="kv-value">{field.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="notice">No safe metadata fields were stored.</div>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Runtime snapshot</h2>
            <p className="panel-subtitle">
              Human-readable allowlisted runtime context only. Raw prompts,
              tokens, and provider secrets are excluded.
            </p>
          </div>
        </div>

        {pageData.runtimeSnapshotFields.length > 0 ? (
          <div className="conversation-runtime-grid">
            {pageData.runtimeSnapshotFields.map((field) => (
              <div className="conversation-runtime-card" key={field.label}>
                <div className="stat-label">{field.label}</div>
                <div className="conversation-runtime-value">{field.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="notice">
            No safe runtime snapshot fields were stored for this conversation.
          </div>
        )}
      </section>
    </DashboardShell>
  );
}
