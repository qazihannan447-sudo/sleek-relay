import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CALLER_BEHAVIOR_TEMPLATE_TOKEN,
  PRE_SESSION_BEHAVIOR_TEMPLATE_TOKENS,
  applyAgentBehaviorTemplates,
  applyPreSessionAgentBehaviorTemplates,
} from '../lib/agents/behavior-templates';

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

test('pre-session templates never leave a caller-name token for composition time', () => {
  assert.deepEqual([...PRE_SESSION_BEHAVIOR_TEMPLATE_TOKENS], [
    '{Business Name}',
    '{Agent Name}',
  ]);
  assert.equal(CALLER_BEHAVIOR_TEMPLATE_TOKEN, '{Caller Name}');
  assert.equal(
    applyPreSessionAgentBehaviorTemplates(
      'Hi {Caller Name}, this is {Agent Name} at {Business Name}.',
      {
        agentName: 'Katie',
        businessName: 'Finova',
      },
    ),
    'Hi, this is Katie at Finova.',
  );
  assert.equal(
    applyAgentBehaviorTemplates('Hi {Caller Name}, thanks for waiting.', {
      callerName: 'Ada',
    }),
    'Hi Ada, thanks for waiting.',
  );
});
