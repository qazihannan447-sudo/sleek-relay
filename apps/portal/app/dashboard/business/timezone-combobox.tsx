'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

type TimezoneComboboxProps = {
  disabled: boolean;
  name: string;
  placeholder: string;
  value: string;
  onValueChange?: () => void;
};

export type CanadianTimezoneOption = {
  region: string;
  value: string;
};

export const canadianTimezones: readonly CanadianTimezoneOption[] = [
  { region: 'Pacific Time (PT)', value: 'America/Vancouver' },
  { region: 'Mountain Time (MT)', value: 'America/Edmonton' },
  { region: 'Central Time (CT)', value: 'America/Winnipeg' },
  { region: 'Eastern Time (ET)', value: 'America/Toronto' },
  { region: 'Atlantic Time (AT)', value: 'America/Halifax' },
  { region: 'Newfoundland Time (NT)', value: 'America/St_Johns' },
] as const;

function getTimezones() {
  return [...canadianTimezones];
}

export function TimezoneCombobox({
  disabled,
  name,
  placeholder,
  value,
  onValueChange,
}: TimezoneComboboxProps) {
  const [query, setQuery] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hasMountedRef = useRef(false);
  const deferredQuery = useDeferredValue(query);
  const timezones = useMemo(getTimezones, []);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, []);

  useEffect(() => {
    if (hasMountedRef.current) {
      onValueChange?.();
      return;
    }

    hasMountedRef.current = true;
  }, [onValueChange, query]);

  const filteredTimezones = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();

    if (!normalized) {
      return timezones;
    }

    return timezones.filter(
      (tz) =>
        tz.value.toLowerCase().includes(normalized) ||
        tz.region.toLowerCase().includes(normalized),
    );
  }, [deferredQuery, timezones]);

  return (
    <div className="timezone-combobox" ref={rootRef}>
      <input
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        autoComplete="off"
        className="timezone-input"
        disabled={disabled}
        id="timezone"
        name={name}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
        }}
        onFocus={() => {
          if (!disabled) {
            setIsOpen(true);
          }
        }}
        onInput={() => setIsOpen(true)}
        placeholder={placeholder}
        type="text"
        value={query}
      />

      {isOpen && !disabled ? (
        <div className="timezone-menu" role="listbox">
          {filteredTimezones.length > 0 ? (
            filteredTimezones.map((tz) => (
              <button
                className="timezone-option"
                key={tz.value}
                onClick={() => {
                  setQuery(tz.value);
                  setIsOpen(false);
                }}
                type="button"
              >
                <span className="timezone-option-val">{tz.value}</span>
                <span className="timezone-option-region">{tz.region}</span>
              </button>
            ))
          ) : (
            <div className="timezone-empty">No matching Canadian timezone found.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
