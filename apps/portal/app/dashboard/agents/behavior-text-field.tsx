'use client';

import { useEffect, useRef, useState } from 'react';

export type BehaviorTemplateVariable = {
  label: string;
  token: string;
};

type BehaviorTextFieldProps = {
  canEdit: boolean;
  defaultValue: string;
  disabled?: boolean;
  help: string;
  id: string;
  label: string;
  maxLength: number;
  minHeight: number;
  name: string;
  onValueChange?: () => void;
  placeholder?: string;
  variables?: readonly BehaviorTemplateVariable[];
};

function resizeTextarea(element: HTMLTextAreaElement, minHeight: number) {
  element.style.height = 'auto';
  element.style.height = `${Math.max(minHeight, element.scrollHeight)}px`;
}

export function BehaviorTextField({
  canEdit,
  defaultValue,
  disabled = false,
  help,
  id,
  label,
  maxLength,
  minHeight,
  name,
  onValueChange,
  placeholder,
  variables = [],
}: BehaviorTextFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    resizeTextarea(textarea, minHeight);
  }, [minHeight, value]);

  function commitValue(nextValue: string) {
    const clipped =
      nextValue.length > maxLength ? nextValue.slice(0, maxLength) : nextValue;
    setValue(clipped);
    onValueChange?.();
  }

  function insertToken(token: string) {
    const textarea = textareaRef.current;
    if (!textarea || !canEdit || disabled) {
      return;
    }

    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? value.length;
    const nextValue = `${value.slice(0, start)}${token}${value.slice(end)}`;
    const clipped =
      nextValue.length > maxLength ? nextValue.slice(0, maxLength) : nextValue;
    const insertedLength = clipped.length - value.length + (end - start);
    const nextCaret = Math.min(start + insertedLength, clipped.length);

    setValue(clipped);
    onValueChange?.();

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
      resizeTextarea(textarea, minHeight);
    });
  }

  const remaining = maxLength - value.length;
  const counterTone =
    remaining <= 0 ? 'is-limit' : remaining <= Math.ceil(maxLength * 0.1) ? 'is-warn' : '';

  return (
    <div className="behavior-field">
      <label className="behavior-field-label" htmlFor={id}>
        {label}
      </label>
      <p className="behavior-field-help">{help}</p>

      <div className="behavior-textarea-shell">
        <textarea
          className="behavior-textarea"
          disabled={!canEdit || disabled}
          id={id}
          name={name}
          onChange={(event) => commitValue(event.target.value)}
          placeholder={placeholder}
          ref={textareaRef}
          style={{ minHeight }}
          value={value}
        />
        <div className={`behavior-textarea-counter ${counterTone}`.trim()}>
          {value.length} / {maxLength}
        </div>
      </div>

      {variables.length > 0 ? (
        <div aria-label={`${label} variables`} className="behavior-variable-row">
          {variables.map((variable) => (
            <button
              className="behavior-variable-chip"
              disabled={!canEdit || disabled || value.length >= maxLength}
              key={variable.token}
              onClick={() => insertToken(variable.token)}
              type="button"
            >
              + {variable.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
