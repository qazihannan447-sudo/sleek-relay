export const AGENT_TONE_OPTIONS = [
  'Friendly',
  'Professional',
  'Conversational',
  'Calm',
  'Energetic',
] as const;

export type AgentToneOption = (typeof AGENT_TONE_OPTIONS)[number];

export const DEFAULT_AGENT_TONE: AgentToneOption = 'Friendly';

const toneDeliveryHints: Record<AgentToneOption, string> = {
  Calm: 'steady and reassuring, unhurried',
  Conversational: 'relaxed and natural, like a real receptionist on a live call',
  Energetic: 'bright and engaged, still concise and not over-excited',
  Friendly: 'warm and approachable, lightly upbeat without sounding chipper',
  Professional: 'polite and capable, clear without sounding stiff or corporate',
};

export function describeToneDelivery(tone: string): string {
  const normalized = tone.trim().toLowerCase();
  for (const option of AGENT_TONE_OPTIONS) {
    if (option.toLowerCase() === normalized) {
      return toneDeliveryHints[option];
    }
  }
  return `${normalized} and natural for spoken conversation`;
}

export function resolveAgentToneLabels(toneValue: string | null | undefined): string[] {
  const parts = (toneValue ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  const selected: string[] = [];
  for (const part of parts) {
    const match = AGENT_TONE_OPTIONS.find(
      (option) => option.toLowerCase() === part.toLowerCase(),
    );
    const label = match ?? part;
    if (!selected.some((item) => item.toLowerCase() === label.toLowerCase())) {
      selected.push(label);
    }
  }

  return selected.length > 0 ? selected : [DEFAULT_AGENT_TONE];
}

export function formatAgentToneValue(toneValue: string | string[] | null | undefined): string {
  const raw = Array.isArray(toneValue) ? toneValue.join(', ') : (toneValue ?? '');
  return resolveAgentToneLabels(raw).join(', ');
}
