import type { SiteExtractionDraft, SiteFieldKey } from "./siteSchema.js";
import type { ChunkStore } from "./chunkStore.js";
import type { Logger } from "./logger.js";
import { createLogger } from "./logger.js";

export interface ApprovedSiteProfile {
  approvedBy: string;
  approvedAt: string; // ISO 8601
  sourceUrl: string;
  tenantId: string;
  agentId: string;
  fields: Partial<Record<SiteFieldKey, unknown>>;
  chunkCount: number;
}

export interface SiteApprovalOptions {
  onboardingSessionId?: string;
  logger?: Logger;
}

// Section 5 parity, extended for storage: the ONLY function that calls
// chunkStore.save() — cannot be invoked without approvedBy, approvedAt, and
// the tenant+agent this content belongs to. extractSiteDraft() has no path
// to storage on its own; this is the sole gate, same separation as
// approveDraft() in the single-page flow.
export async function approveSiteDraft(
  draft: SiteExtractionDraft,
  approvedBy: string,
  approvedAt: Date,
  tenantId: string,
  agentId: string,
  chunkStore: ChunkStore,
  options: SiteApprovalOptions = {}
): Promise<ApprovedSiteProfile> {
  if (!approvedBy || !approvedBy.trim()) {
    throw new Error("approveSiteDraft requires a non-empty approvedBy identity");
  }
  if (!(approvedAt instanceof Date) || Number.isNaN(approvedAt.getTime())) {
    throw new Error("approveSiteDraft requires a valid approvedAt Date");
  }
  if (!tenantId || !tenantId.trim()) {
    throw new Error("approveSiteDraft requires a non-empty tenantId");
  }
  if (!agentId || !agentId.trim()) {
    throw new Error("approveSiteDraft requires a non-empty agentId");
  }

  const fields: Partial<Record<SiteFieldKey, unknown>> = {};
  for (const [key, field] of Object.entries(draft.fields)) {
    if (field) fields[key as SiteFieldKey] = field.value;
  }

  await chunkStore.save(tenantId, agentId, draft.chunks);

  const approved: ApprovedSiteProfile = {
    approvedBy,
    approvedAt: approvedAt.toISOString(),
    sourceUrl: draft.normalizedUrl,
    tenantId,
    agentId,
    fields,
    chunkCount: draft.chunks.length
  };

  const logger = options.logger ?? createLogger(options.onboardingSessionId);
  logger.info({
    event: "site_draft_approved",
    url: draft.normalizedUrl,
    tenantId,
    agentId,
    approvedBy,
    approvedAt: approved.approvedAt,
    approvedFields: Object.keys(fields),
    chunkCount: draft.chunks.length
  });

  return approved;
}

export interface DiscardedSiteRecord {
  discardedBy: string;
  discardedAt: string;
  sourceUrl: string;
}

// The "delete" capability from the described workflow. Since nothing is
// persisted before approval, discarding pre-approval is just "never call
// approveSiteDraft" — this function's job is the audit log entry for that
// decision. If a draft was already approved (chunks already stored),
// removing it is a separate, deliberate chunkStore.deleteAll(tenantId,
// agentId) call with the same tenant/agent — kept out of this function so a
// discard action can't accidentally wipe already-approved storage.
export function discardSiteDraft(
  draft: SiteExtractionDraft,
  discardedBy: string,
  discardedAt: Date,
  options: SiteApprovalOptions = {}
): DiscardedSiteRecord {
  if (!discardedBy || !discardedBy.trim()) {
    throw new Error("discardSiteDraft requires a non-empty discardedBy identity");
  }
  if (!(discardedAt instanceof Date) || Number.isNaN(discardedAt.getTime())) {
    throw new Error("discardSiteDraft requires a valid discardedAt Date");
  }

  const logger = options.logger ?? createLogger(options.onboardingSessionId);
  logger.info({
    event: "site_draft_discarded",
    url: draft.normalizedUrl,
    discardedBy,
    discardedAt: discardedAt.toISOString()
  });

  return { discardedBy, discardedAt: discardedAt.toISOString(), sourceUrl: draft.normalizedUrl };
}
