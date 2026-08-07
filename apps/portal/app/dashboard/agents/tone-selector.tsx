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

function resolveInitialTones(defaultValue: string): ToneOption[] {
  if (!defaultValue.trim()) {
    return ['Friendly'];
  }

  const parts = defaultValue
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  const selected: ToneOption[] = [];
  for (const part of parts) {
    const match = toneOptions.find(
      (option) => option.toLowerCase() === part.toLowerCase(),
    );
    if (match && !selected.includes(match)) {
      selected.push(match);
    }
  }

  return selected.length > 0 ? selected : ['Friendly'];
}

export function ToneSelector({
  defaultValue = '',
  disabled = false,
  name = 'tone',
}: ToneSelectorProps) {
  const [selectedTones, setSelectedTones] = useState<ToneOption[]>(() =>
    resolveInitialTones(defaultValue),
  );

  function toggleTone(tone: ToneOption) {
    if (disabled) {
      return;
    }

    setSelectedTones((prev) => {
      if (prev.includes(tone)) {
        return prev.filter((item) => item !== tone);
      }
      return [...prev, tone];
    });
  }

  return (
    <div className="tone-selector-wrapper">
      <input name={name} type="hidden" value={selectedTones.join(', ')} />
      <div
        aria-labelledby="tone-label"
        className="tone-pills-grid"
        role="group"
      >
        {toneOptions.map((tone) => {
          const isSelected = selectedTones.includes(tone);
          return (
            <button
              aria-pressed={isSelected}
              className={`tone-pill-btn${isSelected ? ' is-selected' : ''}`}
              disabled={disabled}
              key={tone}
              onClick={() => toggleTone(tone)}
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
