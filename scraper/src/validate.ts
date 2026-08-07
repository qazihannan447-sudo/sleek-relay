import type { Field, FieldKey } from "./schema.js";
import { FieldValueSchemas } from "./schema.js";
import type { PartialFields } from "./structuredData.js";
import type { Logger } from "./logger.js";

// Section 8 step 5 / Section 7 row "Extracted value fails schema validation":
// validate the merged candidate field-by-field and drop invalid fields
// rather than reject the whole draft. Applies uniformly regardless of
// whether the value came from structured data or the LLM.
export function validateAndPruneFields(fields: PartialFields, logger?: Logger): PartialFields {
  const result: PartialFields = {};
  for (const key of Object.keys(fields) as FieldKey[]) {
    const candidate = fields[key];
    if (!candidate) continue;
    const valueSchema = FieldValueSchemas[key];
    const parsed = valueSchema.safeParse(candidate.value);
    if (!parsed.success) {
      logger?.warn({ event: "field_failed_schema_validation", field: key, source: candidate.source });
      continue;
    }
    result[key] = { ...candidate, value: parsed.data } as Field<unknown>;
  }
  return result;
}
