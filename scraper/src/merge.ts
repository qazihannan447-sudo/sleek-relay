import type { Field, FieldKey } from "./schema.js";
import type { PartialFields } from "./structuredData.js";

// Section 8 step 4: merge with structured data taking precedence over LLM
// inference on conflicting fields. LLM fields only fill gaps structured data
// didn't cover — extractWithLlm is only ever asked about the missing keys in
// the first place, but this keeps the guarantee explicit even if that changes.
export function mergeFields(structured: PartialFields, llmInferred: PartialFields): PartialFields {
  const merged: PartialFields = { ...structured };
  for (const key of Object.keys(llmInferred) as FieldKey[]) {
    if (merged[key] === undefined) {
      merged[key] = llmInferred[key];
    }
  }
  return merged;
}

export function missingFieldKeys(fields: PartialFields, allKeys: readonly FieldKey[]): FieldKey[] {
  return allKeys.filter((k) => fields[k] === undefined);
}

const CONFIDENCE_RANK: Record<Field<unknown>["confidence"], number> = { high: 3, medium: 2, low: 1 };
const SOURCE_RANK: Record<Field<unknown>["source"], number> = { structured_data: 3, page_text: 2, llm_inferred: 1 };

// Combines the same list-type field (services/projects/partners/faqs) found
// across multiple pages into one field, de-duped by a caller-supplied key.
// Unlike mergeFields()'s "structured wins, first non-empty" rule for scalar
// fields, list fields legitimately accumulate — a Services overview page
// and three individual service detail pages should all contribute distinct
// items to the same `services` field rather than the first page winning
// outright. The Field<T> envelope only carries one source/confidence for
// the whole field, so this picks the highest-ranked source/confidence seen
// across contributors rather than tracking per-item provenance.
export function accumulateListField<T>(candidates: Array<Field<T[]>>, keyOf: (item: T) => string): Field<T[]> | undefined {
  if (candidates.length === 0) return undefined;

  const bestSource = [...candidates].sort((a, b) => SOURCE_RANK[b.source] - SOURCE_RANK[a.source])[0]!.source;
  const bestConfidence = candidates.reduce(
    (best, c) => (CONFIDENCE_RANK[c.confidence] > CONFIDENCE_RANK[best] ? c.confidence : best),
    candidates[0]!.confidence
  );

  const seen = new Set<string>();
  const items: T[] = [];
  for (const candidate of candidates) {
    for (const item of candidate.value) {
      // Items here are raw LLM output, not yet schema-validated (that pass
      // runs after merge, per Section 8 step 5) — a malformed item (wrong
      // shape, missing the field keyOf() expects) must be dropped here
      // rather than crash the whole run.
      let key: string;
      try {
        key = keyOf(item)?.trim().toLowerCase() ?? "";
      } catch {
        key = "";
      }
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  if (items.length === 0) return undefined;

  return { value: items, source: bestSource, sourceUrl: candidates[0]!.sourceUrl, confidence: bestConfidence };
}
