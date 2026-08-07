import type { ExtractionDraft, FieldKey } from "./schema.js";
import type { Logger } from "./logger.js";
import { createLogger } from "./logger.js";

export interface ApprovedProfile {
  approvedBy: string;
  approvedAt: string; // ISO 8601
  sourceUrl: string;
  fields: Partial<Record<FieldKey, unknown>>;
}

export interface ApproveDraftOptions {
  onboardingSessionId?: string;
  logger?: Logger;
}

// Section 5 hard requirement: this is the ONLY function in this component
// that produces a record fit for writing to tenant config, and it cannot be
// invoked without both approvedBy and approvedAt. extractDraft() has no
// path that calls this, and this function never fetches or infers anything
// itself — it only accepts an already-produced draft (optionally edited by
// the owner) and stamps the approval. Persisting the returned ApprovedProfile
// into live tenant config is the onboarding system's job, out of scope here.
export function approveDraft(
  draft: ExtractionDraft,
  approvedBy: string,
  approvedAt: Date,
  options: ApproveDraftOptions = {}
): ApprovedProfile {
  if (!approvedBy || !approvedBy.trim()) {
    throw new Error("approveDraft requires a non-empty approvedBy identity");
  }
  if (!(approvedAt instanceof Date) || Number.isNaN(approvedAt.getTime())) {
    throw new Error("approveDraft requires a valid approvedAt Date");
  }

  const fields: Partial<Record<FieldKey, unknown>> = {};
  for (const [key, field] of Object.entries(draft.fields)) {
    if (field) fields[key as FieldKey] = field.value;
  }

  const approved: ApprovedProfile = {
    approvedBy,
    approvedAt: approvedAt.toISOString(),
    sourceUrl: draft.normalizedUrl,
    fields
  };

  const logger = options.logger ?? createLogger(options.onboardingSessionId);
  logger.info({
    event: "draft_approved",
    url: draft.normalizedUrl,
    approvedBy,
    approvedAt: approved.approvedAt,
    approvedFields: Object.keys(fields)
  });

  return approved;
}
