import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_TONE_OPTIONS,
  DEFAULT_AGENT_TONE,
  formatAgentToneValue,
  resolveAgentToneLabels,
  resolveKnownAgentTones,
} from '../lib/agents/tones';

test('resolveAgentToneLabels defaults blank values to Friendly', () => {
  assert.deepEqual(resolveAgentToneLabels(''), [DEFAULT_AGENT_TONE]);
  assert.deepEqual(resolveAgentToneLabels(null), [DEFAULT_AGENT_TONE]);
});

test('resolveAgentToneLabels preserves configured multi-tone selections', () => {
  assert.deepEqual(resolveAgentToneLabels('Calm, Professional'), [
    'Calm',
    'Professional',
  ]);
});

test('formatAgentToneValue normalizes blank and known tone labels', () => {
  assert.equal(formatAgentToneValue(''), 'Friendly');
  assert.equal(formatAgentToneValue([]), 'Friendly');
  assert.equal(formatAgentToneValue(['professional', 'calm']), 'Professional, Calm');
  assert.equal(formatAgentToneValue('calm, professional'), 'Calm, Professional');
});

test('resolveKnownAgentTones defaults blank values to Friendly', () => {
  assert.deepEqual(resolveKnownAgentTones(''), [DEFAULT_AGENT_TONE]);
  assert.deepEqual(resolveKnownAgentTones(null), [DEFAULT_AGENT_TONE]);
  assert.deepEqual(resolveKnownAgentTones(undefined), [DEFAULT_AGENT_TONE]);
});

test('resolveKnownAgentTones only returns values from AGENT_TONE_OPTIONS', () => {
  assert.deepEqual(resolveKnownAgentTones('Calm, Professional'), ['Calm', 'Professional']);
  for (const tone of resolveKnownAgentTones('Calm, Not-A-Real-Tone, Energetic')) {
    assert.ok((AGENT_TONE_OPTIONS as readonly string[]).includes(tone));
  }
});

test('resolveKnownAgentTones drops an entirely unrecognized value back to the default', () => {
  assert.deepEqual(resolveKnownAgentTones('Not-A-Real-Tone'), [DEFAULT_AGENT_TONE]);
});
