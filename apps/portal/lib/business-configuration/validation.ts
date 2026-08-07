import {
  businessHoursDays,
  emptyBusinessConfigurationValues,
  serializeBusinessHours,
  type BusinessConfigurationValues,
} from './schema';

export type BusinessConfigurationActionState = {
  message: string | null;
  status: 'error' | 'idle' | 'success';
  values: BusinessConfigurationValues;
};

export type ValidationResult =
  | {
      errors: string[];
      values: BusinessConfigurationValues;
    }
  | {
      data: {
        business_hours: BusinessConfigurationValues['businessHours'];
        business_name: string;
        business_phone: string | null;
        category: string | null;
        contact_email: string | null;
        contact_name: string | null;
        timezone: string | null;
        website: string | null;
      };
      values: BusinessConfigurationValues;
    };

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeText(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: string): string | null {
  return value.length > 0 ? value : null;
}

function isValidWebsite(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function initialBusinessConfigurationActionState(
  values: BusinessConfigurationValues,
): BusinessConfigurationActionState {
  return {
    message: null,
    status: 'idle',
    values,
  };
}

export function extractBusinessConfigurationValues(
  formData: FormData,
): BusinessConfigurationValues {
  const values: BusinessConfigurationValues = emptyBusinessConfigurationValues();

  values.businessName = normalizeText(formData.get('businessName'));
  let websiteInput = normalizeText(formData.get('website'));
  if (websiteInput && !/^https?:\/\//i.test(websiteInput) && websiteInput.includes('.')) {
    websiteInput = `https://${websiteInput}`;
  }
  values.website = websiteInput;
  values.businessPhone = normalizeText(formData.get('businessPhone'));
  values.category = normalizeText(formData.get('category'));
  values.contactName = normalizeText(formData.get('contactName'));
  values.contactEmail = normalizeText(formData.get('contactEmail'));
  values.timezone = normalizeText(formData.get('timezone'));

  for (const day of businessHoursDays) {
    const dayPrefix = `businessHours.${day.key}`;
    const closed = formData.get(`${dayPrefix}.closed`) === 'on';
    const open = normalizeText(formData.get(`${dayPrefix}.open`));
    const close = normalizeText(formData.get(`${dayPrefix}.close`));

    values.businessHours[day.key] = {
      close: closed ? null : close,
      closed,
      open: closed ? null : open,
    };
  }

  return values;
}

export function parseBusinessConfigurationValues(
  valuesInput: BusinessConfigurationValues,
): ValidationResult {
  const values: BusinessConfigurationValues = {
    ...valuesInput,
    businessHours: serializeBusinessHours(valuesInput.businessHours),
    businessName: valuesInput.businessName.trim(),
    businessPhone: valuesInput.businessPhone.trim(),
    category: valuesInput.category.trim(),
    contactEmail: valuesInput.contactEmail.trim(),
    contactName: valuesInput.contactName.trim(),
    timezone: valuesInput.timezone.trim(),
    website: valuesInput.website.trim(),
  };

  if (values.website && !/^https?:\/\//i.test(values.website) && values.website.includes('.')) {
    values.website = `https://${values.website}`;
  }

  const errors: string[] = [];

  if (!values.businessName) {
    errors.push('Business name is required.');
  }

  if (values.website && !isValidWebsite(values.website)) {
    errors.push('Website must be a valid http or https URL.');
  }

  if (values.contactEmail && !isValidEmail(values.contactEmail)) {
    errors.push('Contact email must be a valid email address.');
  }

  if (values.timezone && !isValidTimezone(values.timezone)) {
    errors.push('Timezone must be a valid IANA timezone identifier.');
  }

  for (const day of businessHoursDays) {
    const open = values.businessHours[day.key].open ?? '';
    const close = values.businessHours[day.key].close ?? '';
    const closed = values.businessHours[day.key].closed;

    if (closed) {
      continue;
    }

    if (!timePattern.test(open) || !timePattern.test(close)) {
      errors.push(`${day.label} hours must use HH:MM 24-hour time.`);
      continue;
    }

    if (open >= close) {
      errors.push(`${day.label} opening time must be earlier than closing time.`);
    }
  }

  if (errors.length > 0) {
    return {
      errors,
      values,
    };
  }

  return {
    data: {
      business_hours: serializeBusinessHours(values.businessHours),
      business_name: values.businessName,
      business_phone: optionalText(values.businessPhone),
      category: optionalText(values.category),
      contact_email: optionalText(values.contactEmail),
      contact_name: optionalText(values.contactName),
      timezone: optionalText(values.timezone),
      website: optionalText(values.website),
    },
    values,
  };
}

export function parseBusinessConfigurationForm(
  formData: FormData,
): ValidationResult {
  return parseBusinessConfigurationValues(extractBusinessConfigurationValues(formData));
}
