import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_AGENT_TONE,
  formatAgentToneValue,
  resolveAgentToneLabels,
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
