import { normalizeUrl } from "./urlUtils.js";
import { isAllowedByRobots } from "./robots.js";
import { fetchPage, type HeadlessFetcher } from "./fetchPage.js";
import { extractStructuredData, extractCleanedText, type PartialFields } from "./structuredData.js";
import { extractWithLlm } from "./llmExtract.js";
import { mergeFields, missingFieldKeys } from "./merge.js";
import { validateAndPruneFields } from "./validate.js";
import { ExtractionDraftSchema, type ExtractionDraft, type FieldKey } from "./schema.js";
import { createLogger, summarizeFieldsForLog, type Logger } from "./logger.js";
import { DEFAULT_USER_AGENT, DEFAULT_TIMEOUT_MS, MIN_LLM_BUDGET_MS } from "./config.js";
import type { LlmClient } from "./llmClient.js";

const ALL_FIELD_KEYS: readonly FieldKey[] = [
  "businessName",
  "website",
  "phone",
  "category",
  "contactEmail",
  "hours",
  "faqs",
  "address",
  "socialLinks",
  "services",
  "projects",
  "partners",
  "summary",
  "policies"
];

export interface ExtractDraftOptions {
  /** Total budget for fetch + parse + LLM pass. Section 6: ~15s. */
  timeoutMs?: number;
  userAgent?: string;
  /** Tags log lines to the onboarding session; never used to persist/associate the run itself (Section 6 tenant isolation). */
  onboardingSessionId?: string;
  /** If omitted, the LLM pass is skipped entirely and the draft is structured-data-only. */
  llmClient?: LlmClient;
  headlessFetcher?: HeadlessFetcher;
  /** Test seam; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

function websiteField(normalizedUrl: string) {
  return { value: normalizedUrl, source: "structured_data" as const, sourceUrl: normalizedUrl, confidence: "high" as const };
}

function buildDraft(
  inputUrl: string,
  normalizedUrl: string,
  fields: PartialFields,
  status: ExtractionDraft["status"],
  fetchedPages: string[],
  failureReason?: string
): ExtractionDraft {
  return ExtractionDraftSchema.parse({
    inputUrl,
    normalizedUrl,
    extractedAt: new Date().toISOString(),
    fields,
    status,
    failureReason,
    fetchedPages
  });
}

function logAndBuildFailureDraft(
  logger: Logger,
  inputUrl: string,
  normalizedUrl: string,
  reason: string,
  detail?: unknown
): ExtractionDraft {
  logger.warn({ event: "extraction_failed", url: normalizedUrl, reason, detail: detail !== undefined ? String(detail) : undefined });
  // Section 7: page never fetched -> empty draft (plus the trivially-known
  // website field, which needs no fetch) and onboarding continues manually.
  return buildDraft(inputUrl, normalizedUrl, { website: websiteField(normalizedUrl) }, "empty", [], reason);
}

// Section 5/8: the ONLY output of this function is a draft. There is no
// parameter or code path here that writes to tenant config or activates a
// tenant — that only ever happens via the separate approveDraft() function.
// Section 6: idempotent — safe to re-invoke for a "re-scan"; no shared state
// is read or mutated across calls, so re-running has no side effects beyond
// producing a fresh draft.
export async function extractDraft(inputUrl: string, options: ExtractDraftOptions = {}): Promise<ExtractionDraft> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const logger = createLogger(options.onboardingSessionId);
  const deadline = Date.now() + timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeUrl(inputUrl);
    } catch {
      logger.warn({ event: "invalid_url", inputUrl });
      return buildDraft(inputUrl, inputUrl, {}, "empty", [], "invalid_url");
    }

    const allowed = await isAllowedByRobots(normalizedUrl, {
      userAgent,
      signal: controller.signal,
      fetchImpl: options.fetchImpl,
      logger
    });
    if (!allowed) {
      return logAndBuildFailureDraft(logger, inputUrl, normalizedUrl, "blocked_by_robots");
    }

    let fetched;
    try {
      fetched = await fetchPage(normalizedUrl, {
        userAgent,
        signal: controller.signal,
        fetchImpl: options.fetchImpl,
        launchHeadless: options.headlessFetcher,
        logger
      });
    } catch (err) {
      const reason = controller.signal.aborted ? "timed_out" : "url_unreachable";
      return logAndBuildFailureDraft(logger, inputUrl, normalizedUrl, reason, err);
    }

    const structuredFields = extractStructuredData(fetched.html, normalizedUrl);

    const candidateKeys = ALL_FIELD_KEYS.filter((k) => k !== "website");
    const missing = missingFieldKeys(structuredFields, candidateKeys);

    let llmFields: PartialFields = {};
    let budgetTruncated = false;
    const remaining = deadline - Date.now();
    if (options.llmClient && missing.length > 0) {
      if (remaining > MIN_LLM_BUDGET_MS) {
        llmFields = await extractWithLlm({
          client: options.llmClient,
          pageText: extractCleanedText(fetched.html),
          missingKeys: missing,
          sourceUrl: normalizedUrl,
          signal: controller.signal,
          logger
        });
      } else {
        budgetTruncated = true;
        logger.warn({ event: "llm_skipped_time_budget", url: normalizedUrl, remainingMs: remaining });
      }
    }

    const merged = mergeFields(structuredFields, llmFields);
    merged.website = websiteField(normalizedUrl);

    const validated = validateAndPruneFields(merged, logger);

    const status: ExtractionDraft["status"] = budgetTruncated ? "partial" : "ok";

    logger.info({
      event: "extraction_complete",
      url: normalizedUrl,
      status,
      fields: summarizeFieldsForLog(validated as Record<string, { source: string; confidence: string } | undefined>)
    });

    return buildDraft(inputUrl, normalizedUrl, validated, status, [normalizedUrl]);
  } finally {
    clearTimeout(timer);
  }
}
