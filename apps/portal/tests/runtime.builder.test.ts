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
  agentValues.capabilities.captureAppointments = true;
  agentValues.capabilities.captureLeads = true;
  agentValues.capabilities.offerHandoff = true;
  agentValues.capabilities.appointmentFields = [
    'name',
    'phone',
    'preferred_time',
    'party',
  ];

  businessValues.appointmentPolicy =
    'We accept appointment requests only. Staff confirm later.';
  businessValues.handoffDestinationType = 'callback';
  businessValues.handoffScript =
    'I can have someone from the team call you back.';

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
  assert.equal(runtimePackage.agent.idleTimeoutEnabled, true);
  assert.equal(runtimePackage.agent.idleCheckInSeconds, 30);
  assert.equal(runtimePackage.agent.idleEndSeconds, 60);
  assert.equal(
    runtimePackage.agent.idleCheckInMessage,
    'Hello, are you there?',
  );
  assert.equal(runtimePackage.business.businessName, 'Greenleaf Dental');
  assert.equal(runtimePackage.knowledge.length, 1);
  assert.equal(runtimePackage.capabilities.captureAppointments, true);
  assert.deepEqual(runtimePackage.enabledTools, [
    'capture_lead',
    'create_appointment_request',
    'offer_human_handoff',
    'end_session',
  ]);
  assert.equal(
    runtimePackage.promptText.includes('Appointment policy:'),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'We accept appointment requests only. Staff confirm later.',
    ),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes('Appointment requests: enabled'),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'Never say the caller is booked',
    ),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes('create_appointment_request'),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes('offer_human_handoff'),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'Never claim a live phone transfer happened',
    ),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'Never say a capture, booking, transfer, callback, or notification succeeded',
    ),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'ask if there is anything else',
    ),
    true,
  );
  assert.equal(
    runtimePackage.groundingRules.some((rule) =>
      rule.includes('unless a tool result confirms it'),
    ),
    true,
  );
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
    runtimePackage.promptText.includes('Baseline speaking personality:'),
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
      'Use normal sentence punctuation and capitalization',
    ),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'End every spoken turn with ., ?, or !',
    ),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'Write numbers, dates, times, phone numbers, email addresses, and common acronyms in normal written form',
    ),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes('Use soft commas for brief pauses'),
    false,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'Use plain punctuation only (commas, periods, question marks).',
    ),
    false,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'Speak numbers the way a person would on a call',
    ),
    false,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'Keep this tone consistent for the whole call',
    ),
    false,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'Treat the configured style as your baseline personality, not a fixed emotion',
    ),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'Usually answer in one to three short spoken sentences',
    ),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'Respond to the caller\'s actual last thought before adding any extra information',
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
      'Before capturing a lead, appointment request, or handoff',
    ),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'When the caller wants a follow-up, callback contact, or to leave their details',
    ),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'How to reflect enabled capabilities in conversation:',
    ),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'You may briefly offer to submit an appointment request',
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

test('composeAgentRuntimePackage omits handoff tool when destination is none', () => {
  const businessValues = emptyBusinessConfigurationValues();
  businessValues.businessName = 'Greenleaf Dental';
  businessValues.handoffDestinationType = 'none';

  const agentValues = emptyAgentValues();
  agentValues.name = 'Front Desk Assistant';
  agentValues.role = 'Reception';
  agentValues.capabilities.offerHandoff = true;
  agentValues.fallbackMessage = 'Please leave a message.';

  const runtimePackage = composeAgentRuntimePackage({
    agentId: 'agent-1',
    agentValues,
    businessValues,
    knowledge: [],
    tenantId: 'tenant-1',
    tenantName: 'Greenleaf Dental',
    tenantSlug: 'greenleaf-dental',
  });

  assert.deepEqual(runtimePackage.enabledTools, ['end_session']);
  assert.equal(
    runtimePackage.promptText.includes('no business handoff destination'),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes('offer_human_handoff'),
    false,
  );
  assert.equal(runtimePackage.promptText.includes('Handoff settings:'), true);
});

test('composeAgentRuntimePackage omits handoff settings when handoff capability is off', () => {
  const businessValues = emptyBusinessConfigurationValues();
  businessValues.businessName = 'Greenleaf Dental';
  businessValues.handoffDestinationType = 'callback';
  businessValues.handoffScript = 'Someone will call you back.';

  const agentValues = emptyAgentValues();
  agentValues.name = 'Front Desk Assistant';
  agentValues.role = 'Reception';
  agentValues.capabilities.offerHandoff = false;
  agentValues.capabilities.captureMessages = true;
  agentValues.fallbackMessage = 'Please leave a message.';

  const runtimePackage = composeAgentRuntimePackage({
    agentId: 'agent-1',
    agentValues,
    businessValues,
    knowledge: [],
    tenantId: 'tenant-1',
    tenantName: 'Greenleaf Dental',
    tenantSlug: 'greenleaf-dental',
  });

  assert.equal(runtimePackage.promptText.includes('Handoff settings:'), false);
  assert.equal(
    runtimePackage.promptText.includes('Someone will call you back.'),
    false,
  );
  assert.equal(
    runtimePackage.promptText.includes(
      'When the caller wants to leave a message for the team',
    ),
    true,
  );
  assert.equal(
    runtimePackage.promptText.includes('create_appointment_request'),
    false,
  );
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

test('composeAgentRuntimePackage clears caller-name tokens before session start', () => {
  const businessValues = emptyBusinessConfigurationValues();
  businessValues.businessName = 'Greenleaf Dental';

  const agentValues = emptyAgentValues();
  agentValues.name = 'Maya';
  agentValues.greeting = 'Hi {Caller Name}, this is {Agent Name} at {Business Name}.';
  agentValues.specialInstructions = 'Greet {Caller Name} warmly.';
  agentValues.fallbackMessage = 'Sorry {Caller Name}, I do not have that.';

  const runtimePackage = composeAgentRuntimePackage({
    agentId: 'agent-1',
    agentValues,
    businessValues,
    knowledge: [],
    tenantId: 'tenant-1',
    tenantName: 'Greenleaf Dental',
    tenantSlug: 'greenleaf-dental',
  });

  assert.equal(
    runtimePackage.agent.greeting,
    'Hi, this is Maya at Greenleaf Dental.',
  );
  assert.equal(runtimePackage.agent.specialInstructions, 'Greet warmly.');
  assert.equal(
    runtimePackage.agent.fallbackMessage,
    'Sorry, I do not have that.',
  );
});

