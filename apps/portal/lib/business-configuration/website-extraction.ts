import {
  businessHoursDays,
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

  if (fields.businessName?.value) {
    patch.businessName = fields.businessName.value;
  }
  if (fields.category?.value) {
    patch.category = fields.category.value;
  }
  if (fields.website?.value) {
    patch.website = fields.website.value;
  }
  if (fields.phone?.value) {
    patch.businessPhone = fields.phone.value;
  }
  if (fields.contactEmail?.value) {
    patch.contactEmail = fields.contactEmail.value;
  }
  if (fields.hours?.value) {
    patch.businessHours = fields.hours.value;
  }

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
  return Object.keys(draft.formPatch).length > 0;
}

export function draftHasReviewContent(draft: WebsiteExtractionDraftView): boolean {
  const { fields } = draft;
  return Boolean(
    fields.businessName ||
      fields.category ||
      fields.website ||
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

export function applyExtractionPatchToValues(
  current: BusinessConfigurationValues,
  patch: Partial<BusinessConfigurationValues>,
): BusinessConfigurationValues {
  return {
    ...current,
    ...patch,
    businessHours: patch.businessHours ?? current.businessHours,
  };
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
