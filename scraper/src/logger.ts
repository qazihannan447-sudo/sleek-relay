// Section 6 logging requirement: log the URL fetched, which fields were
// extracted and their source/confidence, and any failure reason — tagged to
// the onboarding session. Never log full page content or raw field values
// (those may contain PII-lite like phone/email); one structured event per
// operation, nothing kept longer than the caller chooses to retain it.

export interface LogEvent {
  event: string;
  onboardingSessionId?: string;
  [key: string]: unknown;
}

export interface Logger {
  info(event: LogEvent): void;
  warn(event: LogEvent): void;
}

function emit(level: "info" | "warn", onboardingSessionId: string | undefined, event: LogEvent) {
  const line = {
    level,
    ts: new Date().toISOString(),
    onboardingSessionId,
    ...event
  };
  // eslint-disable-next-line no-console
  console[level === "warn" ? "warn" : "log"](JSON.stringify(line));
}

export function createLogger(onboardingSessionId: string | undefined): Logger {
  return {
    info: (event) => emit("info", onboardingSessionId, event),
    warn: (event) => emit("warn", onboardingSessionId, event)
  };
}

// Summarizes fields for logging without leaking extracted values.
export function summarizeFieldsForLog(fields: Record<string, { source: string; confidence: string } | undefined>) {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([key, v]) => ({ field: key, source: v!.source, confidence: v!.confidence }));
}
