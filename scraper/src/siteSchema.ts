import { z } from "zod";
import {
  EXTRA_EXTRACTION_FIELD_KEYS,
  ORIGINAL_FIELD_KEYS,
  field,
  FieldValueSchemas,
  type FieldKey
} from "./schema.js";

// Multi-page pipeline reuses the same field value schemas as the single-page
// extractDraft() path (schema.ts). Page/chunk types below are site-crawl only.

export const SiteFieldValueSchemas = FieldValueSchemas;
export type SiteFieldKey = FieldKey;
export const NEW_SITE_FIELD_KEYS = EXTRA_EXTRACTION_FIELD_KEYS;

export function isOriginalFieldKey(key: SiteFieldKey): key is (typeof ORIGINAL_FIELD_KEYS)[number] {
  return (ORIGINAL_FIELD_KEYS as readonly string[]).includes(key);
}

export const SiteExtractionFieldsSchema = z.object({
  businessName: field(SiteFieldValueSchemas.businessName).optional(),
  website: field(SiteFieldValueSchemas.website).optional(),
  phone: field(SiteFieldValueSchemas.phone).optional(),
  category: field(SiteFieldValueSchemas.category).optional(),
  contactEmail: field(SiteFieldValueSchemas.contactEmail).optional(),
  hours: field(SiteFieldValueSchemas.hours).optional(),
  faqs: field(SiteFieldValueSchemas.faqs).optional(),
  address: field(SiteFieldValueSchemas.address).optional(),
  socialLinks: field(SiteFieldValueSchemas.socialLinks).optional(),
  services: field(SiteFieldValueSchemas.services).optional(),
  projects: field(SiteFieldValueSchemas.projects).optional(),
  partners: field(SiteFieldValueSchemas.partners).optional(),
  summary: field(SiteFieldValueSchemas.summary).optional(),
  policies: field(SiteFieldValueSchemas.policies).optional()
});
export type SiteExtractionFields = z.infer<typeof SiteExtractionFieldsSchema>;

export const PageTypeSchema = z.enum([
  "home",
  "about",
  "services",
  "projects",
  "partners",
  "faq",
  "contact",
  "other",
  "ignore"
]);
export type PageType = z.infer<typeof PageTypeSchema>;

export const PageSummarySchema = z.object({
  url: z.string().url(),
  pageType: PageTypeSchema,
  fetchStatus: z.enum(["ok", "unreachable", "skipped_robots", "skipped_budget"])
});
export type PageSummary = z.infer<typeof PageSummarySchema>;

export const ChunkSchema = z.object({
  sourceUrl: z.string().url(),
  pageType: PageTypeSchema,
  chunkIndex: z.number().int().nonnegative(),
  text: z.string().min(1)
});
export type Chunk = z.infer<typeof ChunkSchema>;

// Site-level draft. Same hard rule as ExtractionDraftSchema: this is the
// only output of extraction, and nothing here can trigger a write to
// storage — that's approveSiteDraft()'s job alone (siteApproval.ts).
export const SiteExtractionDraftSchema = z.object({
  inputUrl: z.string().url(),
  normalizedUrl: z.string().url(),
  extractedAt: z.string().datetime(),
  fields: SiteExtractionFieldsSchema,
  pages: z.array(PageSummarySchema),
  chunks: z.array(ChunkSchema),
  status: z.enum(["ok", "partial", "empty"]),
  failureReason: z.string().optional()
});
export type SiteExtractionDraft = z.infer<typeof SiteExtractionDraftSchema>;
