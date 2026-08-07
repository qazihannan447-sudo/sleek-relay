'use client';

import { useState } from 'react';

const toneOptions = [
  'Friendly',
  'Professional',
  'Conversational',
  'Calm',
  'Energetic',
] as const;

type ToneSelectorProps = {
  defaultValue?: string;
  disabled?: boolean;
  name?: string;
};

export function ToneSelector({
  defaultValue = '',
  disabled = false,
  name = 'tone',
}: ToneSelectorProps) {
  const [selectedTones, setSelectedTones] = useState<string[]>(() => {
    if (!defaultValue) return ['Friendly', 'Professional'];
    return defaultValue
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  });

  function toggleTone(tone: string) {
    if (disabled) return;
    setSelectedTones((prev) =>
      prev.includes(tone)
        ? prev.filter((t) => t !== tone)
        : [...prev, tone],
    );
  }

  const valueString = selectedTones.join(', ');

  return (
    <div className="tone-selector-wrapper">
      <input name={name} type="hidden" value={valueString} />
      <div className="tone-pills-grid">
        {toneOptions.map((tone) => {
          const isSelected = selectedTones.includes(tone);
          return (
            <button
              className={`tone-pill-btn${isSelected ? ' is-selected' : ''}`}
              disabled={disabled}
              key={tone}
              onClick={() => toggleTone(tone)}
              type="button"
            >
              <span className="tone-pill-icon">{isSelected ? '✓' : '+'}</span>
              <span>{tone}</span>
            </button>
          );
        })}
      </div>
      {selectedTones.length > 0 ? (
        <span className="tone-selected-hint">
          Selected: {valueString}
        </span>
      ) : (
        <span className="tone-selected-hint" style={{ color: 'var(--text-soft)' }}>
          Select one or more tone traits for your agent.
        </span>
      )}
    </div>
  );
}
