import {
  businessHoursDays,
  emptyBusinessHours,
  normalizeBusinessHours,
  type BusinessConfigurationValues,
  type BusinessHours,
} from './schema';

export type ExtractionFieldProvenance = {
  confidence: 'high' | 'medium' | 'low';
  source: 'structured_data' | 'page_text' | 'llm_inferred';
  sourceUrl: string;
};

export type ExtractionFieldView<T> = ExtractionFieldProvenance & {
  value: T;
};

export type ExtractionFaqView = {
  answer: string;
  question: string;
};

export type ExtractionNamedItemView = {
  description?: string;
  name: string;
  url?: string;
};

export type WebsiteExtractionDraftView = {
  extractedAt: string;
  failureReason?: string;
  fields: {
    address?: ExtractionFieldView<string>;
    businessName?: ExtractionFieldView<string>;
    category?: ExtractionFieldView<string>;
    contactEmail?: ExtractionFieldView<string>;
    faqs?: ExtractionFieldView<ExtractionFaqView[]>;
    hours?: ExtractionFieldView<BusinessHours> & { display: string };
    partners?: ExtractionFieldView<ExtractionNamedItemView[]>;
    phone?: ExtractionFieldView<string>;
    policies?: ExtractionFieldView<string[]>;
    projects?: ExtractionFieldView<ExtractionNamedItemView[]>;
    services?: ExtractionFieldView<ExtractionNamedItemView[]>;
    socialLinks?: ExtractionFieldView<string[]>;
    summary?: ExtractionFieldView<string>;
    website?: ExtractionFieldView<string>;
  };
  formPatch: Partial<BusinessConfigurationValues>;
  normalizedUrl: string;
  status: 'ok' | 'partial' | 'empty';
};

type RawField<T> = {
  confidence: ExtractionFieldProvenance['confidence'];
  source: ExtractionFieldProvenance['source'];
  sourceUrl: string;
  value: T;
};

export type RawExtractionDraft = {
  extractedAt: string;
  failureReason?: string;
  fields: {
    address?: RawField<string>;
    businessName?: RawField<string>;
    category?: RawField<string>;
    contactEmail?: RawField<string>;
    faqs?: RawField<ExtractionFaqView[]>;
    hours?: RawField<unknown>;
    partners?: RawField<ExtractionNamedItemView[]>;
    phone?: RawField<string>;
    policies?: RawField<string[]>;
    projects?: RawField<ExtractionNamedItemView[]>;
    services?: RawField<ExtractionNamedItemView[]>;
    socialLinks?: RawField<string[]>;
    summary?: RawField<string>;
    website?: RawField<string>;
  };
  normalizedUrl: string;
  status: 'ok' | 'partial' | 'empty';
};

function formatTime12h(timeStr: string | null | undefined): string {
  if (!timeStr) {
    return '';
  }

  const [hStr, mStr = '00'] = timeStr.split(':');
  const h = Number.parseInt(hStr, 10);
  if (Number.isNaN(h)) {
    return timeStr;
  }

  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr.padStart(2, '0')} ${ampm}`;
}

export function formatBusinessHoursDisplay(hours: BusinessHours): string {
  return businessHoursDays
    .map((day) => {
      const entry = hours[day.key];
      if (!entry || entry.closed || !entry.open || !entry.close) {
        return `${day.label.slice(0, 3)} Closed`;
      }

      return `${day.label.slice(0, 3)} ${formatTime12h(entry.open)} – ${formatTime12h(entry.close)}`;
    })
    .join(' · ');
}

function toFormPatch(fields: WebsiteExtractionDraftView['fields']): Partial<BusinessConfigurationValues> {
  const patch: Partial<BusinessConfigurationValues> = {};

  // Prefer keeping the owner's typed URL unless scrape found a clearer canonical one
  // that differs; still include website when present so apply can normalize.
  if (fields.website?.value) {
    patch.website = fields.website.value;
  }
  if (fields.phone?.value) {
    patch.businessPhone = fields.phone.value;
  }
  if (fields.contactEmail?.value) {
    patch.contactEmail = fields.contactEmail.value;
  }
  if (fields.category?.value) {
    patch.category = fields.category.value;
  }
  if (fields.hours?.value) {
    patch.businessHours = fields.hours.value;
  }

  // Business name, contact name, and timezone stay owner-entered — never patched from scrape.
  return patch;
}

export function mapExtractionDraftToView(
  draft: RawExtractionDraft,
): WebsiteExtractionDraftView {
  const fields: WebsiteExtractionDraftView['fields'] = {};

  if (draft.fields.businessName) {
    fields.businessName = draft.fields.businessName;
  }
  if (draft.fields.category) {
    fields.category = draft.fields.category;
  }
  if (draft.fields.website) {
    fields.website = draft.fields.website;
  }
  if (draft.fields.phone) {
    fields.phone = draft.fields.phone;
  }
  if (draft.fields.contactEmail) {
    fields.contactEmail = draft.fields.contactEmail;
  }
  if (draft.fields.address) {
    fields.address = draft.fields.address;
  }
  if (draft.fields.socialLinks) {
    fields.socialLinks = draft.fields.socialLinks;
  }
  if (draft.fields.faqs) {
    fields.faqs = draft.fields.faqs;
  }
  if (draft.fields.summary) {
    fields.summary = draft.fields.summary;
  }
  if (draft.fields.services) {
    fields.services = draft.fields.services;
  }
  if (draft.fields.projects) {
    fields.projects = draft.fields.projects;
  }
  if (draft.fields.partners) {
    fields.partners = draft.fields.partners;
  }
  if (draft.fields.policies) {
    fields.policies = draft.fields.policies;
  }

  if (draft.fields.hours) {
    const hours = normalizeBusinessHours(draft.fields.hours.value);
    fields.hours = {
      confidence: draft.fields.hours.confidence,
      display: formatBusinessHoursDisplay(hours),
      source: draft.fields.hours.source,
      sourceUrl: draft.fields.hours.sourceUrl,
      value: hours,
    };
  }

  return {
    extractedAt: draft.extractedAt,
    failureReason: draft.failureReason,
    fields,
    formPatch: toFormPatch(fields),
    normalizedUrl: draft.normalizedUrl,
    status: draft.status,
  };
}

export function draftHasApplicableProfileFields(
  draft: WebsiteExtractionDraftView,
): boolean {
  return Object.keys(draft.formPatch).some((key) => key !== 'website');
}

export function draftHasReviewContent(draft: WebsiteExtractionDraftView): boolean {
  const { fields } = draft;
  // `website` is always populated from the input URL after a fetch, so it alone
  // must not count as a successful extraction.
  return Boolean(
    fields.businessName ||
      fields.category ||
      fields.phone ||
      fields.contactEmail ||
      fields.hours ||
      fields.address ||
      fields.summary ||
      (fields.socialLinks?.value.length ?? 0) > 0 ||
      (fields.faqs?.value.length ?? 0) > 0 ||
      (fields.services?.value.length ?? 0) > 0 ||
      (fields.projects?.value.length ?? 0) > 0 ||
      (fields.partners?.value.length ?? 0) > 0 ||
      (fields.policies?.value.length ?? 0) > 0,
  );
}

export type ApplyExtractionPatchMode = 'fillEmpty' | 'replace';

export type ApplyExtractionPatchResult = {
  appliedKeys: string[];
  next: BusinessConfigurationValues;
  skippedKeys: string[];
};

export const profileScrapeFieldKeys = [
  'category',
  'website',
  'businessPhone',
  'contactEmail',
  'businessHours',
] as const;

export type ProfileScrapeFieldKey = (typeof profileScrapeFieldKeys)[number];

const profilePatchKeys = profileScrapeFieldKeys;

type ProfilePatchKey = ProfileScrapeFieldKey;

export function listDraftProfileFieldKeys(
  draft: WebsiteExtractionDraftView,
): ProfileScrapeFieldKey[] {
  return profileScrapeFieldKeys.filter((key) => draft.formPatch[key] !== undefined);
}

export function filterDraftFormPatch(
  draft: WebsiteExtractionDraftView,
  selectedKeys: Iterable<string>,
): Partial<BusinessConfigurationValues> {
  const selected = new Set(selectedKeys);
  const patch: Partial<BusinessConfigurationValues> = {};
  for (const key of profileScrapeFieldKeys) {
    if (!selected.has(key) || draft.formPatch[key] === undefined) {
      continue;
    }
    if (key === 'businessHours') {
      patch.businessHours = draft.formPatch.businessHours;
    } else {
      patch[key] = draft.formPatch[key];
    }
  }
  return patch;
}

function isBlankProfileField(
  values: BusinessConfigurationValues,
  key: ProfilePatchKey,
): boolean {
  if (key === 'businessHours') {
    return businessHoursDays.every((day) => values.businessHours[day.key].closed);
  }

  return !String(values[key] ?? '').trim();
}

export function applyExtractionPatchToValues(
  current: BusinessConfigurationValues,
  patch: Partial<BusinessConfigurationValues>,
  mode: ApplyExtractionPatchMode = 'replace',
): ApplyExtractionPatchResult {
  const appliedKeys: string[] = [];
  const skippedKeys: string[] = [];
  const next: BusinessConfigurationValues = {
    ...current,
    businessHours: current.businessHours,
  };

  for (const key of profilePatchKeys) {
    const patchValue = patch[key];
    if (patchValue === undefined) {
      continue;
    }

    if (mode === 'fillEmpty' && !isBlankProfileField(current, key)) {
      skippedKeys.push(key);
      continue;
    }

    if (key === 'businessHours') {
      next.businessHours = patchValue as BusinessHours;
    } else {
      next[key] = patchValue as string;
    }
    appliedKeys.push(key);
  }

  return { appliedKeys, next, skippedKeys };
}

export function normalizeWebsiteInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (!/^https?:\/\//i.test(trimmed) && trimmed.includes('.')) {
    return `https://${trimmed}`;
  }

  return trimmed;
}

/** Host-focused label for scrape errors (e.g. `bad-site.com`). */
export function formatWebsiteDisplayLabel(websiteUrl: string): string {
  const normalized = normalizeWebsiteInput(websiteUrl);
  if (!normalized) {
    return 'that website';
  }

  try {
    const host = new URL(normalized).hostname.replace(/^www\./i, '');
    return host || normalized;
  } catch {
    return websiteUrl.trim() || 'that website';
  }
}

/** True when the next scrape targets a different site than the saved profile. */
export function isDifferentWebsiteHost(
  previousWebsiteUrl: string,
  nextWebsiteUrl: string,
): boolean {
  const next = formatWebsiteDisplayLabel(nextWebsiteUrl);
  if (!next || next === 'that website') {
    return false;
  }

  const previous = formatWebsiteDisplayLabel(previousWebsiteUrl);
  if (!previous || previous === 'that website') {
    return true;
  }

  return previous !== next;
}

/**
 * Clears scrape-assisted profile fields so a new website cannot leave stale
 * phone/email/hours/category/website from the previous site.
 */
export function clearWebsiteAssistedProfileFields(
  values: BusinessConfigurationValues,
): BusinessConfigurationValues {
  return {
    ...values,
    businessHours: emptyBusinessHours(),
    businessPhone: '',
    category: '',
    contactEmail: '',
    website: '',
  };
}

/**
 * Prefer enrich fields when present; keep quick fields that enrich omitted.
 */
export function mergeWebsiteExtractionDrafts(
  base: WebsiteExtractionDraftView,
  overlay: WebsiteExtractionDraftView,
): WebsiteExtractionDraftView {
  const fields: WebsiteExtractionDraftView['fields'] = {
    ...base.fields,
  };

  for (const [key, value] of Object.entries(overlay.fields) as Array<
    [keyof WebsiteExtractionDraftView['fields'], WebsiteExtractionDraftView['fields'][keyof WebsiteExtractionDraftView['fields']]]
  >) {
    if (value !== undefined) {
      fields[key] = value as never;
    }
  }

  const formPatch: Partial<BusinessConfigurationValues> = {
    ...base.formPatch,
  };
  for (const key of profileScrapeFieldKeys) {
    if (overlay.formPatch[key] !== undefined) {
      if (key === 'businessHours') {
        formPatch.businessHours = overlay.formPatch.businessHours;
      } else {
        formPatch[key] = overlay.formPatch[key];
      }
    }
  }

  return {
    extractedAt: overlay.extractedAt || base.extractedAt,
    failureReason: overlay.failureReason ?? base.failureReason,
    fields,
    formPatch,
    normalizedUrl: overlay.normalizedUrl || base.normalizedUrl,
    status:
      overlay.status === 'ok' || base.status === 'ok'
        ? 'ok'
        : overlay.status === 'partial' || base.status === 'partial'
          ? 'partial'
          : 'empty',
  };
}

/**
 * Human-readable scrape failure copy after the extractor verified (or failed to
 * verify) that the site can be loaded.
 */
export function formatWebsiteScrapeFailureMessage(
  failureReason: string | undefined,
  websiteUrl: string,
  options?: {
    unchangedClause?: string;
  },
): string {
  const site = formatWebsiteDisplayLabel(websiteUrl);
  const unchanged =
    options?.unchangedClause ?? 'Profile below is unchanged.';

  switch (failureReason) {
    case 'invalid_url':
      return `“${site}” is not a valid website URL. Check the address and try again. ${unchanged}`;
    case 'url_unreachable':
      return `Couldn't load ${site} — that site could not be reached or does not appear to exist. ${unchanged}`;
    case 'timed_out':
      return `Timed out loading ${site}. The site may be slow or unavailable. ${unchanged}`;
    case 'blocked_by_robots':
      return `${site} blocks automated reading, so nothing new was applied. ${unchanged} You can fill the form manually.`;
    default:
      if (failureReason) {
        return `Couldn't load usable details from ${site} (${failureReason.replaceAll('_', ' ')}). ${unchanged}`;
      }
      return `No usable business details were found on ${site}. ${unchanged} You can fill the form manually.`;
  }
}
