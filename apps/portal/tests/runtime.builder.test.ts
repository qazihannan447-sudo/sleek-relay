import assert from 'node:assert/strict';
import test from 'node:test';

import { emptyBusinessConfigurationValues } from '../lib/business-configuration/schema';
import { emptyAgentValues } from '../lib/agents/schema';
import {
  approvedKnowledgeItemsFromRecords,
  composeAgentRuntimePackage,
} from '../lib/runtime/builder';

test('approvedKnowledgeItemsFromRecords keeps only approved tenant knowledge', () => {
  const items = approvedKnowledgeItemsFromRecords([
    {
      content: 'Approved FAQ answer.',
      id: 'knowledge-1',
      kind: 'faq',
      status: 'approved',
      title: 'FAQ',
      updated_at: '2026-08-06T09:00:00.000Z',
    },
    {
      content: 'Draft internal note.',
      id: 'knowledge-2',
      kind: 'business_fact',
      status: 'draft',
      title: 'Draft',
      updated_at: '2026-08-06T09:05:00.000Z',
    },
    {
      content: 'Disabled policy note.',
      id: 'knowledge-3',
      kind: 'policy',
      status: 'disabled',
      title: 'Disabled',
      updated_at: '2026-08-06T09:10:00.000Z',
    },
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.id, 'knowledge-1');
});

test('composeAgentRuntimePackage combines business configuration, approved knowledge, and agent settings', () => {
  const businessValues = emptyBusinessConfigurationValues();
  businessValues.businessName = 'Greenleaf Dental';
  businessValues.category = 'Dental Clinic';
  businessValues.businessPhone = '+1-555-0101';
  businessValues.website = 'https://greenleaf.example.com';
  businessValues.businessHours.mon = {
    close: '17:00',
    closed: false,
    open: '09:00',
  };

  const agentValues = emptyAgentValues();
  agentValues.name = 'Front Desk Assistant';
  agentValues.role = 'Reception';
  agentValues.greeting = 'Thanks for calling Greenleaf Dental.';
  agentValues.specialInstructions = 'Keep answers concise.';
  agentValues.fallbackMessage = 'Please leave a message.';
  agentValues.tone = 'Warm';

  const runtimePackage = composeAgentRuntimePackage({
    agentId: 'agent-1',
    agentValues,
    businessValues,
    knowledge: [
      {
        content: 'Greenleaf Dental accepts new patients.',
        id: 'knowledge-1',
        kind: 'faq',
        title: 'New patient policy',
      },
    ],
    tenantId: 'tenant-1',
    tenantName: 'Greenleaf Dental',
    tenantSlug: 'greenleaf-dental',
  });

  assert.equal(runtimePackage.agent.id, 'agent-1');
  assert.equal(runtimePackage.business.businessName, 'Greenleaf Dental');
  assert.equal(runtimePackage.knowledge.length, 1);
  assert.equal(runtimePackage.agent.greeting, 'Thanks for calling Greenleaf Dental.');
  assert.equal(
    runtimePackage.agent.specialInstructions,
    'Keep answers concise.',
  );
  assert.equal(
    runtimePackage.agent.fallbackMessage,
    'Please leave a message.',
  );
  assert.equal(
    runtimePackage.promptText.includes('Special instructions (required'),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes('Keep answers concise.'),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes('Fallback message (required'),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes('Please leave a message.'),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'The system already speaks this exact greeting at session start',
    ),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes('Required speaking tone (apply on every turn):'),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'Sound like a real receptionist on a phone call, not a chatbot reading notes.',
    ),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'Use plain punctuation only (commas, periods, question marks).',
    ),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'Speak numbers the way a person would on a call',
    ),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'Vary turn shape: sometimes lead with the answer',
    ),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'If the caller sounds frustrated or upset',
    ),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'Before capturing a lead, message, or appointment request',
    ),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'Configured tone: Warm — warm and natural for spoken conversation.',
    ),
    true,
  );
  assert.equal(runtimePackage.agent.tone, 'Warm');
  assert.equal(
    runtimePackage.groundingRules.some((rule) =>
      rule.includes('Please leave a message.'),
    ),
    true,
  );
  assert.equal(runtimePackage.groundingRules.length > 0, true);
});

test('composeAgentRuntimePackage defaults missing tone to Friendly in prompt and package', () => {
  const businessValues = emptyBusinessConfigurationValues();
  businessValues.businessName = 'Greenleaf Dental';

  const agentValues = emptyAgentValues();
  agentValues.name = 'Front Desk Assistant';
  agentValues.role = 'Reception';
  agentValues.tone = '';

  const runtimePackage = composeAgentRuntimePackage({
    agentId: 'agent-1',
    agentValues,
    businessValues,
    knowledge: [],
    tenantId: 'tenant-1',
    tenantName: 'Greenleaf Dental',
    tenantSlug: 'greenleaf-dental',
  });

  assert.equal(runtimePackage.agent.tone, 'Friendly');
  assert.equal(
    runtimePackage.promptText.includes(
      'Configured tone: Friendly — warm and approachable, lightly upbeat without sounding chipper.',
    ),
    true,
  );
});

