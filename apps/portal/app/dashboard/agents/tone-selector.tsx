'use client';

import { useState } from 'react';

const toneOptions = [
  'Friendly',
  'Professional',
  'Conversational',
  'Calm',
  'Energetic',
] as const;

type ToneOption = (typeof toneOptions)[number];

type ToneSelectorProps = {
  defaultValue?: string;
  disabled?: boolean;
  name?: string;
};

function resolveInitialTone(defaultValue: string): ToneOption {
  if (!defaultValue.trim()) {
    return 'Friendly';
  }

  const parts = defaultValue
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    const match = toneOptions.find(
      (option) => option.toLowerCase() === part.toLowerCase(),
    );
    if (match) {
      return match;
    }
  }

  return 'Friendly';
}

export function ToneSelector({
  defaultValue = '',
  disabled = false,
  name = 'tone',
}: ToneSelectorProps) {
  const [selectedTone, setSelectedTone] = useState<ToneOption>(() =>
    resolveInitialTone(defaultValue),
  );

  return (
    <div className="tone-selector-wrapper">
      <input name={name} type="hidden" value={selectedTone} />
      <div
        aria-labelledby="tone-label"
        className="tone-pills-grid"
        role="radiogroup"
      >
        {toneOptions.map((tone) => {
          const isSelected = selectedTone === tone;
          return (
            <button
              aria-checked={isSelected}
              className={`tone-pill-btn${isSelected ? ' is-selected' : ''}`}
              disabled={disabled}
              key={tone}
              onClick={() => {
                if (!disabled) {
                  setSelectedTone(tone);
                }
              }}
              role="radio"
              type="button"
            >
              {tone}
            </button>
          );
        })}
      </div>
    </div>
  );
}
