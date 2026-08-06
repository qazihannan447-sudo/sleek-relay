export const businessHoursDays = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
] as const;

export type BusinessHoursDayKey = (typeof businessHoursDays)[number]['key'];

export type BusinessHoursDay = {
  close: string | null;
  closed: boolean;
  open: string | null;
};

export type BusinessHours = Record<BusinessHoursDayKey, BusinessHoursDay>;

export type BusinessConfigurationValues = {
  businessHours: BusinessHours;
  businessName: string;
  businessPhone: string;
  category: string;
  contactEmail: string;
  contactName: string;
  timezone: string;
  website: string;
};

export type BusinessConfigurationRecord = {
  business_hours: unknown;
  business_name: string;
  business_phone: string | null;
  category: string | null;
  contact_email: string | null;
  contact_name: string | null;
  timezone: string | null;
  website: string | null;
};

function blankDay(closed = true): BusinessHoursDay {
  return {
    close: closed ? null : '',
    closed,
    open: closed ? null : '',
  };
}

export function emptyBusinessHours(): BusinessHours {
  return {
    fri: blankDay(),
    mon: blankDay(),
    sat: blankDay(),
    sun: blankDay(),
    thu: blankDay(),
    tue: blankDay(),
    wed: blankDay(),
  };
}

export function emptyBusinessConfigurationValues(): BusinessConfigurationValues {
  return {
    businessHours: emptyBusinessHours(),
    businessName: '',
    businessPhone: '',
    category: '',
    contactEmail: '',
    contactName: '',
    timezone: '',
    website: '',
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBusinessHoursSource(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  return isObject(value) ? value : {};
}

function normalizeSourceKeys(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    normalized[key.toLowerCase()] = entry;
  }

  return normalized;
}

function getDaySource(
  source: Record<string, unknown>,
  shortKey: BusinessHoursDayKey,
): unknown {
  switch (shortKey) {
    case 'mon':
      return source.mon ?? source.monday;
    case 'tue':
      return source.tue ?? source.tuesday;
    case 'wed':
      return source.wed ?? source.wednesday;
    case 'thu':
      return source.thu ?? source.thursday;
    case 'fri':
      return source.fri ?? source.friday;
    case 'sat':
      return source.sat ?? source.saturday;
    case 'sun':
      return source.sun ?? source.sunday;
  }
}

function normalizeDay(value: unknown): BusinessHoursDay {
  if (!isObject(value)) {
    return blankDay();
  }

  const hasOpen =
    typeof value.open === 'string' && value.open.trim().length > 0;
  const hasClose =
    typeof value.close === 'string' && value.close.trim().length > 0;
  const closed = value.closed === true ? true : !(hasOpen || hasClose);
  const open =
    hasOpen && !closed ? (value.open as string) : null;
  const close =
    hasClose && !closed ? (value.close as string) : null;

  return {
    close,
    closed,
    open,
  };
}

export function normalizeBusinessHours(value: unknown): BusinessHours {
  const source = normalizeSourceKeys(parseBusinessHoursSource(value));

  return {
    fri: normalizeDay(getDaySource(source, 'fri')),
    mon: normalizeDay(getDaySource(source, 'mon')),
    sat: normalizeDay(getDaySource(source, 'sat')),
    sun: normalizeDay(getDaySource(source, 'sun')),
    thu: normalizeDay(getDaySource(source, 'thu')),
    tue: normalizeDay(getDaySource(source, 'tue')),
    wed: normalizeDay(getDaySource(source, 'wed')),
  };
}

export function serializeBusinessHours(value: BusinessHours): BusinessHours {
  return {
    fri: normalizeDay(value.fri),
    mon: normalizeDay(value.mon),
    sat: normalizeDay(value.sat),
    sun: normalizeDay(value.sun),
    thu: normalizeDay(value.thu),
    tue: normalizeDay(value.tue),
    wed: normalizeDay(value.wed),
  };
}

export function businessConfigurationToValues(
  record: BusinessConfigurationRecord,
): BusinessConfigurationValues {
  return {
    businessHours: normalizeBusinessHours(record.business_hours),
    businessName: record.business_name,
    businessPhone: record.business_phone ?? '',
    category: record.category ?? '',
    contactEmail: record.contact_email ?? '',
    contactName: record.contact_name ?? '',
    timezone: record.timezone ?? '',
    website: record.website ?? '',
  };
}
