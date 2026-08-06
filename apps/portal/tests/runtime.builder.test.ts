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
  assert.equal(
    runtimePackage.promptText.includes('Approved tenant knowledge:'),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes('Keep answers concise.'),
    true,
  );
  assert.equal(runtimePackage.groundingRules.length > 0, true);
});

