import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emptyAgentCapabilities,
  listEnabledRuntimeTools,
  normalizeAgentCapabilities,
  serializeAgentCapabilities,
} from '../lib/agents/capabilities';

test('normalizeAgentCapabilities defaults all workflows off', () => {
  const capabilities = emptyAgentCapabilities();

  assert.equal(capabilities.captureLeads, false);
  assert.equal(capabilities.captureMessages, false);
  assert.equal(capabilities.captureAppointments, false);
  assert.equal(capabilities.offerHandoff, false);
  assert.deepEqual(listEnabledRuntimeTools(capabilities), ['end_session']);
});

test('normalizeAgentCapabilities accepts snake_case database payloads', () => {
  const capabilities = normalizeAgentCapabilities({
    appointment_fields: ['name', 'preferred_time', 'bogus'],
    capture_appointments: true,
    capture_leads: true,
    capture_messages: false,
    lead_fields: ['name', 'email'],
    message_fields: ['message'],
    offer_handoff: true,
  });

  assert.equal(capabilities.captureAppointments, true);
  assert.equal(capabilities.offerHandoff, true);
  assert.deepEqual(capabilities.leadFields, ['name', 'email']);
  assert.deepEqual(capabilities.appointmentFields, [
    'name',
    'preferred_time',
  ]);
  assert.deepEqual(listEnabledRuntimeTools(capabilities), [
    'capture_lead',
    'create_appointment_request',
    'end_session',
  ]);
  assert.deepEqual(listEnabledRuntimeTools(capabilities, 'callback'), [
    'capture_lead',
    'create_appointment_request',
    'offer_human_handoff',
    'end_session',
  ]);
  assert.deepEqual(listEnabledRuntimeTools(capabilities, 'none'), [
    'capture_lead',
    'create_appointment_request',
    'end_session',
  ]);
});

test('serializeAgentCapabilities writes snake_case for database storage', () => {
  const serialized = serializeAgentCapabilities({
    appointmentFields: ['name', 'preferred_time'],
    captureAppointments: true,
    captureLeads: false,
    captureMessages: true,
    leadFields: ['name', 'phone'],
    messageFields: ['name', 'message'],
    offerHandoff: false,
  });

  assert.equal(serialized.capture_appointments, true);
  assert.equal(serialized.capture_messages, true);
  assert.equal(serialized.offer_handoff, false);
  assert.deepEqual(serialized.appointment_fields, ['name', 'preferred_time']);
});
