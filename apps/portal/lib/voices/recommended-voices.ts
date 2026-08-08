/**
 * Curated Cartesia stable production-agent shortlist for Sleek Relay.
 * Source: Cartesia "Choosing a Voice" guidance + previewable catalog rows.
 * Carson and Daniel are intentionally excluded until audited / previewable.
 */

export type RecommendedVoiceEntry = {
  featuredRank: number;
  id: string;
  label: string;
};

export const RECOMMENDED_AGENT_VOICES: readonly RecommendedVoiceEntry[] = [
  { featuredRank: 1, id: 'f786b574-daa5-4673-aa0c-cbe3e8534c02', label: 'Katie' },
  { featuredRank: 2, id: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4', label: 'Skylar' },
  { featuredRank: 3, id: '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc', label: 'Jacqueline' },
  { featuredRank: 4, id: 'a5136bf9-224c-4d76-b823-52bd5efcffcc', label: 'Jameson' },
  { featuredRank: 5, id: '5ee9feff-1265-424a-9d7f-8e4d431a12c7', label: 'Ronald' },
  { featuredRank: 6, id: '62ae83ad-4f6a-430b-af41-a9bede9286ca', label: 'Gemma' },
  { featuredRank: 7, id: 'ef191366-f52f-447a-a398-ed8c0f2943a1', label: 'Archie' },
  { featuredRank: 8, id: 'e8e5fffb-252c-436d-b842-8879b84445b6', label: 'Cathy' },
  { featuredRank: 9, id: 'f9836c6e-a0bd-460e-9d3c-f7299fa60f94', label: 'Caroline' },
] as const;

export const RECOMMENDED_AGENT_VOICE_IDS = new Set(
  RECOMMENDED_AGENT_VOICES.map((voice) => voice.id),
);

/** Suggested env/fallback starting point for A/B listening — not a declared winner. */
export const SUGGESTED_AGENT_VOICE_ID = RECOMMENDED_AGENT_VOICES[0]!.id;

export type CatalogVoiceLike = {
  country?: string | null;
  description?: string | null;
  featuredRank?: number | null;
  id: string;
  name: string;
  recommendedForAgent?: boolean;
};

export function compareCatalogVoices(
  left: CatalogVoiceLike,
  right: CatalogVoiceLike,
): number {
  const leftRecommended = Boolean(left.recommendedForAgent);
  const rightRecommended = Boolean(right.recommendedForAgent);
  if (leftRecommended !== rightRecommended) {
    return leftRecommended ? -1 : 1;
  }

  const leftRank = left.featuredRank ?? Number.POSITIVE_INFINITY;
  const rightRank = right.featuredRank ?? Number.POSITIVE_INFINITY;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  return left.name.localeCompare(right.name);
}

export function partitionCatalogVoices<T extends CatalogVoiceLike>(
  voices: readonly T[],
): { more: T[]; recommended: T[] } {
  const recommended: T[] = [];
  const more: T[] = [];

  for (const voice of voices) {
    if (voice.recommendedForAgent) {
      recommended.push(voice);
    } else {
      more.push(voice);
    }
  }

  recommended.sort(compareCatalogVoices);
  more.sort(compareCatalogVoices);
  return { more, recommended };
}
