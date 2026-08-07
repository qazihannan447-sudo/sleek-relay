'use client';

import { useState } from 'react';

import {
  AGENT_TONE_OPTIONS,
  type AgentToneOption,
  resolveAgentToneLabels,
} from '../../../lib/agents/tones';

type ToneSelectorProps = {
  defaultValue?: string;
  disabled?: boolean;
  name?: string;
};

function resolveInitialTones(defaultValue: string): AgentToneOption[] {
  const resolved = resolveAgentToneLabels(defaultValue);
  const selected: AgentToneOption[] = [];

  for (const label of resolved) {
    const match = AGENT_TONE_OPTIONS.find(
      (option) => option.toLowerCase() === label.toLowerCase(),
    );
    if (match && !selected.includes(match)) {
      selected.push(match);
    }
  }

  return selected.length > 0 ? selected : [AGENT_TONE_OPTIONS[0]];
}

export function ToneSelector({
  defaultValue = '',
  disabled = false,
  name = 'tone',
}: ToneSelectorProps) {
  const [selectedTones, setSelectedTones] = useState<AgentToneOption[]>(() =>
    resolveInitialTones(defaultValue),
  );

  function toggleTone(tone: AgentToneOption) {
    if (disabled) {
      return;
    }

    setSelectedTones((prev) => {
      if (prev.includes(tone)) {
        if (prev.length === 1) {
          return prev;
        }
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
        {AGENT_TONE_OPTIONS.map((tone) => {
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
