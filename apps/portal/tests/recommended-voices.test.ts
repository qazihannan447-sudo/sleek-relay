import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RECOMMENDED_AGENT_VOICES,
  SUGGESTED_AGENT_VOICE_ID,
  compareCatalogVoices,
  partitionCatalogVoices,
} from '../lib/voices/recommended-voices.ts';

test('recommended agent shortlist starts with Katie and excludes Carson/Daniel placeholders', () => {
  assert.equal(RECOMMENDED_AGENT_VOICES[0]?.label, 'Katie');
  assert.equal(SUGGESTED_AGENT_VOICE_ID, RECOMMENDED_AGENT_VOICES[0]?.id);
  assert.equal(RECOMMENDED_AGENT_VOICES.length, 9);
  assert.equal(
    RECOMMENDED_AGENT_VOICES.some((voice) => /carson|daniel/i.test(voice.label)),
    false,
  );
});

test('compareCatalogVoices ranks recommended voices ahead of the advanced catalog', () => {
  const voices = [
    {
      featuredRank: null,
      id: 'advanced-1',
      name: 'Zed Narrator',
      recommendedForAgent: false,
    },
    {
      featuredRank: 2,
      id: 'rec-2',
      name: 'Skylar',
      recommendedForAgent: true,
    },
    {
      featuredRank: 1,
      id: 'rec-1',
      name: 'Katie',
      recommendedForAgent: true,
    },
  ];

  const sorted = [...voices].sort(compareCatalogVoices);
  assert.deepEqual(
    sorted.map((voice) => voice.id),
    ['rec-1', 'rec-2', 'advanced-1'],
  );
});

test('partitionCatalogVoices splits recommended and more voices with stable ordering', () => {
  const { more, recommended } = partitionCatalogVoices([
    {
      featuredRank: null,
      id: 'maya-like',
      name: 'Maya',
      recommendedForAgent: false,
    },
    {
      featuredRank: 3,
      id: 'jacqueline',
      name: 'Jacqueline',
      recommendedForAgent: true,
    },
    {
      featuredRank: 1,
      id: 'katie',
      name: 'Katie',
      recommendedForAgent: true,
    },
  ]);

  assert.deepEqual(
    recommended.map((voice) => voice.id),
    ['katie', 'jacqueline'],
  );
  assert.deepEqual(
    more.map((voice) => voice.id),
    ['maya-like'],
  );
});
