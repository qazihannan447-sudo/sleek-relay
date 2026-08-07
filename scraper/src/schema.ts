import { z } from "zod";

// Section 4: per-field provenance metadata.
export const SourceSchema = z.enum(["structured_data", "page_text", "llm_inferred"]);
export type Source = z.infer<typeof SourceSchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

// Exported so siteSchema.ts (the multi-page pipeline) can reuse the same
// provenance envelope instead of inventing a second metadata model.
export function field<T extends z.ZodTypeAny>(valueSchema: T) {
  return z.object({
    value: valueSchema,
    source: SourceSchema,
    sourceUrl: z.string().url(),
    confidence: ConfidenceSchema
  });
}
export type Field<T> = { value: T; source: Source; sourceUrl: string; confidence: Confidence };

// "E.164 or as found; do not guess format" — we don't reformat, but we still
// reject obvious garbage (prose, placeholders) rather than pass it to the form.
const PhoneValueSchema = z
  .string()
  .trim()
  .min(6)
  .max(25)
  .regex(/^[+()\-.\sx0-9]+$/i, "does not look like a phone number");

const WeekdayHoursSchema = z.union([
  z.object({ open: z.string().min(1), close: z.string().min(1) }),
  z.literal("closed")
]);

const HoursValueSchema = z
  .object({
    monday: WeekdayHoursSchema.optional(),
    tuesday: WeekdayHoursSchema.optional(),
    wednesday: WeekdayHoursSchema.optional(),
    thursday: WeekdayHoursSchema.optional(),
    friday: WeekdayHoursSchema.optional(),
    saturday: WeekdayHoursSchema.optional(),
    sunday: WeekdayHoursSchema.optional()
  })
  .refine((h) => Object.keys(h).length > 0, "at least one day must be present");

const FaqsValueSchema = z
  .array(
    z.object({
      question: z.string().min(1),
      answer: z.string().min(1)
    })
  )
  .min(1);

export const FieldValueSchemas = {
  businessName: z.string().trim().min(1).max(200),
  website: z.string().url(),
  phone: PhoneValueSchema,
  category: z.string().trim().min(1).max(100),
  contactEmail: z.string().email(),
  hours: HoursValueSchema,
  faqs: FaqsValueSchema,
  address: z.string().trim().min(1).max(300),
  socialLinks: z.array(z.string().url()).min(1)
} as const;

export type FieldKey = keyof typeof FieldValueSchemas;

export const ExtractionFieldsSchema = z.object({
  businessName: field(FieldValueSchemas.businessName).optional(),
  website: field(FieldValueSchemas.website).optional(),
  phone: field(FieldValueSchemas.phone).optional(),
  category: field(FieldValueSchemas.category).optional(),
  contactEmail: field(FieldValueSchemas.contactEmail).optional(),
  hours: field(FieldValueSchemas.hours).optional(),
  faqs: field(FieldValueSchemas.faqs).optional(),
  address: field(FieldValueSchemas.address).optional(),
  socialLinks: field(FieldValueSchemas.socialLinks).optional()
});
export type ExtractionFields = z.infer<typeof ExtractionFieldsSchema>;

// Top-level draft record. This is the only shape extraction ever produces —
// there is no field on it that can trigger tenant activation (Section 5).
export const ExtractionDraftSchema = z.object({
  inputUrl: z.string().url(),
  normalizedUrl: z.string().url(),
  extractedAt: z.string().datetime(),
  fields: ExtractionFieldsSchema,
  status: z.enum(["ok", "partial", "empty"]),
  failureReason: z.string().optional(),
  fetchedPages: z.array(z.string().url())
});
export type ExtractionDraft = z.infer<typeof ExtractionDraftSchema>;
