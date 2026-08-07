'use client';

import {
  canadianTimezones,
  DEFAULT_CANADIAN_TIMEZONE,
  isCanadianTimezone,
} from '../../../lib/business-configuration/canadian-timezones';
import { CustomSelect } from '../agents/custom-select';

type TimezoneComboboxProps = {
  disabled: boolean;
  name: string;
  placeholder?: string;
  value: string;
  onValueChange?: () => void;
};

export type { CanadianTimezoneOption } from '../../../lib/business-configuration/canadian-timezones';
export { canadianTimezones, DEFAULT_CANADIAN_TIMEZONE } from '../../../lib/business-configuration/canadian-timezones';

const timezoneOptions = canadianTimezones.map((timezone) => ({
  label: timezone.label,
  value: timezone.value,
}));

export function TimezoneCombobox({
  disabled,
  name,
  value,
  onValueChange,
}: TimezoneComboboxProps) {
  const selected = isCanadianTimezone(value) ? value : DEFAULT_CANADIAN_TIMEZONE;

  return (
    <CustomSelect
      disabled={disabled}
      id="timezone"
      name={name}
      onChange={() => onValueChange?.()}
      options={timezoneOptions}
      value={selected}
    />
  );
}
