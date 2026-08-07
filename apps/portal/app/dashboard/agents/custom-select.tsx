'use client';

import { useEffect, useRef, useState } from 'react';

export type CustomSelectOption = {
  label: string;
  value: string;
};

type CustomSelectProps = {
  disabled?: boolean;
  id?: string;
  name: string;
  onChange?: (value: string) => void;
  options: readonly CustomSelectOption[];
  value: string;
};

export function CustomSelect({
  disabled = false,
  id,
  name,
  onChange,
  options,
  value,
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState(value);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSelected(value);
  }, [value]);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const activeOption = options.find((o) => o.value === selected) ?? options[0];

  function handleSelect(val: string) {
    setSelected(val);
    setIsOpen(false);
    onChange?.(val);
  }

  return (
    <div className="custom-select-wrapper" ref={rootRef}>
      <button
        aria-expanded={isOpen}
        className={`custom-select-trigger${isOpen ? ' is-open' : ''}`}
        disabled={disabled}
        id={id}
        onClick={() => setIsOpen((prev) => !prev)}
        type="button"
      >
        <span className="custom-select-label">{activeOption?.label ?? selected}</span>
        <svg
          className={`custom-select-chevron${isOpen ? ' is-open' : ''}`}
          fill="none"
          height="16"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width="16"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <input name={name} type="hidden" value={selected} />

      {isOpen && !disabled ? (
        <div className="custom-select-menu" role="listbox">
          {options.map((opt) => {
            const isSelected = opt.value === selected;
            return (
              <button
                className={`custom-select-option${isSelected ? ' is-selected' : ''}`}
                key={opt.value}
                onClick={() => handleSelect(opt.value)}
                type="button"
              >
                <span>{opt.label}</span>
                {isSelected ? (
                  <svg
                    fill="none"
                    height="14"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                    viewBox="0 0 24 24"
                    width="14"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
