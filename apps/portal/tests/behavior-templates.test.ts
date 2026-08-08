import assert from 'node:assert/strict';
import test from 'node:test';

import { applyAgentBehaviorTemplates } from '../lib/agents/behavior-templates';

test('applyAgentBehaviorTemplates replaces known agent behavior tokens', () => {
  assert.equal(
    applyAgentBehaviorTemplates(
      'Thanks for calling {Business Name}. This is {Agent Name}.',
      {
        agentName: 'Maya',
        businessName: 'Greenleaf Dental',
      },
    ),
    'Thanks for calling Greenleaf Dental. This is Maya.',
  );
});

test('applyAgentBehaviorTemplates removes unresolved tokens cleanly', () => {
  assert.equal(
    applyAgentBehaviorTemplates('Hello {Caller Name}, welcome to {Business Name}.', {
      businessName: 'Acme Clinic',
    }),
    'Hello, welcome to Acme Clinic.',
  );
});
