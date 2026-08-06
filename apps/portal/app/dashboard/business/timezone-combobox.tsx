'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

type TimezoneComboboxProps = {
  disabled: boolean;
  name: string;
  placeholder: string;
  value: string;
  onValueChange?: () => void;
};

const fallbackTimezones = [
  'America/Vancouver',
  'America/Edmonton',
  'America/Winnipeg',
  'America/Toronto',
  'America/Halifax',
  'America/St_Johns',
];

function getTimezones() {
  return [...fallbackTimezones];
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

    return timezones.filter((timezone: string) =>
      timezone.toLowerCase().includes(normalized),
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
            filteredTimezones.map((timezone: string) => (
              <button
                className="timezone-option"
                key={timezone}
                onClick={() => {
                  setQuery(timezone);
                  setIsOpen(false);
                }}
                type="button"
              >
                {timezone}
              </button>
            ))
          ) : (
            <div className="timezone-empty">No matching timezone found.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
