import { isCanadianTimezone } from './canadian-timezones';
import {
  businessHoursDays,
  emptyBusinessConfigurationValues,
  isHandoffDestinationType,
  serializeBusinessHours,
  type BusinessConfigurationValues,
  type HandoffDestinationType,
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
        appointment_policy: string | null;
        business_hours: BusinessConfigurationValues['businessHours'];
        business_name: string;
        business_phone: string | null;
        category: string | null;
        contact_email: string | null;
        contact_name: string | null;
        handoff_destination_type: HandoffDestinationType;
        handoff_destination_value: string | null;
        handoff_script: string | null;
        notification_email: string | null;
        notification_whatsapp: string | null;
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
  values.appointmentPolicy = normalizeText(formData.get('appointmentPolicy'));
  values.handoffDestinationValue = normalizeText(
    formData.get('handoffDestinationValue'),
  );
  values.handoffScript = normalizeText(formData.get('handoffScript'));
  values.notificationEmail = normalizeText(formData.get('notificationEmail'));
  values.notificationWhatsapp = normalizeText(
    formData.get('notificationWhatsapp'),
  );

  const handoffType = normalizeText(formData.get('handoffDestinationType'));
  values.handoffDestinationType = isHandoffDestinationType(handoffType)
    ? handoffType
    : 'none';

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
    appointmentPolicy: valuesInput.appointmentPolicy.trim(),
    businessHours: serializeBusinessHours(valuesInput.businessHours),
    businessName: valuesInput.businessName.trim(),
    businessPhone: valuesInput.businessPhone.trim(),
    category: valuesInput.category.trim(),
    contactEmail: valuesInput.contactEmail.trim(),
    contactName: valuesInput.contactName.trim(),
    handoffDestinationType: isHandoffDestinationType(
      valuesInput.handoffDestinationType,
    )
      ? valuesInput.handoffDestinationType
      : 'none',
    handoffDestinationValue: valuesInput.handoffDestinationValue.trim(),
    handoffScript: valuesInput.handoffScript.trim(),
    notificationEmail: valuesInput.notificationEmail.trim(),
    notificationWhatsapp: valuesInput.notificationWhatsapp.trim(),
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

  if (values.notificationEmail && !isValidEmail(values.notificationEmail)) {
    errors.push('Notification email must be a valid email address.');
  }

  if (
    values.notificationWhatsapp &&
    !/^\+?[0-9\s().-]{8,20}$/.test(values.notificationWhatsapp)
  ) {
    errors.push(
      'Notification WhatsApp must be a phone number with country code.',
    );
  }

  if (values.timezone && !isCanadianTimezone(values.timezone)) {
    errors.push('Timezone must be one of the six Canadian timezones.');
  }

  if (!isHandoffDestinationType(values.handoffDestinationType)) {
    errors.push('Handoff destination type is invalid.');
  }

  if (
    (values.handoffDestinationType === 'phone_info' ||
      values.handoffDestinationType === 'email_info') &&
    !values.handoffDestinationValue
  ) {
    errors.push(
      'Handoff destination value is required when phone or email info is selected.',
    );
  }

  if (
    values.handoffDestinationType === 'email_info' &&
    values.handoffDestinationValue &&
    !isValidEmail(values.handoffDestinationValue)
  ) {
    errors.push('Handoff destination must be a valid email address.');
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
      appointment_policy: optionalText(values.appointmentPolicy),
      business_hours: serializeBusinessHours(values.businessHours),
      business_name: values.businessName,
      business_phone: optionalText(values.businessPhone),
      category: optionalText(values.category),
      contact_email: optionalText(values.contactEmail),
      contact_name: optionalText(values.contactName),
      handoff_destination_type: values.handoffDestinationType,
      handoff_destination_value: optionalText(values.handoffDestinationValue),
      handoff_script: optionalText(values.handoffScript),
      notification_email: optionalText(values.notificationEmail),
      notification_whatsapp: optionalText(values.notificationWhatsapp),
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
