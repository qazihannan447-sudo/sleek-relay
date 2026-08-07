// Distinct failure reasons per Section 7. Each maps to a specific,
// non-throwing code path in the orchestrator — never a hard error out of
// extractDraft().
export type FailureReason =
  | "blocked_by_robots"
  | "url_unreachable"
  | "timed_out"
  | "no_extractable_content";

export class UnreachableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UnreachableError";
  }
}

export class TimeoutBudgetExceededError extends Error {
  constructor(message = "extraction time budget exceeded") {
    super(message);
    this.name = "TimeoutBudgetExceededError";
  }
}
