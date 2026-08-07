export type CanadianTimezoneOption = {
  label: string;
  region: string;
  value: string;
};

/** Canada's six primary civil time zones (IANA identifiers). */
export const canadianTimezones: readonly CanadianTimezoneOption[] = [
  { label: 'Pacific Time (PT) — America/Vancouver', region: 'Pacific Time (PT)', value: 'America/Vancouver' },
  { label: 'Mountain Time (MT) — America/Edmonton', region: 'Mountain Time (MT)', value: 'America/Edmonton' },
  { label: 'Central Time (CT) — America/Winnipeg', region: 'Central Time (CT)', value: 'America/Winnipeg' },
  { label: 'Eastern Time (ET) — America/Toronto', region: 'Eastern Time (ET)', value: 'America/Toronto' },
  { label: 'Atlantic Time (AT) — America/Halifax', region: 'Atlantic Time (AT)', value: 'America/Halifax' },
  { label: 'Newfoundland Time (NT) — America/St_Johns', region: 'Newfoundland Time (NT)', value: 'America/St_Johns' },
] as const;

export const DEFAULT_CANADIAN_TIMEZONE = 'America/Toronto';

const canadianTimezoneValues = new Set(
  canadianTimezones.map((timezone) => timezone.value),
);

export function isCanadianTimezone(value: string): boolean {
  return canadianTimezoneValues.has(value);
}
