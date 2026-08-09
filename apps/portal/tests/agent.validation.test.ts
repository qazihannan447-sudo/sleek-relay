import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAgentForm } from '../lib/agents/validation';
import { agentRecordToValues, emptyAgentValues } from '../lib/agents/schema';
import { canManageTenantResources } from '../lib/dashboard/roles';

function buildValidAgentFormData(): FormData {
  const formData = new FormData();

  formData.set('name', 'Front Desk Assistant');
  formData.set('role', 'Reception');
  formData.set('language', 'en');
  formData.set('status', 'draft');
  formData.set('greeting', 'Thanks for calling. How can I help today?');
  formData.set('voiceId', 'alloy');
  formData.set('tone', 'Warm and calm');
  formData.set(
    'specialInstructions',
    'Keep answers concise and use the tenant business profile for facts.',
  );
  formData.set(
    'fallbackMessage',
    'I am sorry, I could not confirm that. Let me take a message instead.',
  );
  formData.set('interruptionEnabled', 'on');
  formData.set('idleTimeoutEnabled', 'on');
  formData.set('idleCheckInSeconds', '30');
  formData.set('idleEndSeconds', '60');
  formData.set('idleCheckInMessage', 'Hello, are you there?');
  formData.set('silenceTimeoutSeconds', '8');
  formData.set('maximumSessionDurationSeconds', '900');
  formData.set('capabilities.captureLeads', 'on');
  formData.set('capabilities.captureAppointments', 'on');
  formData.append('capabilities.leadFields', 'name');
  formData.append('capabilities.leadFields', 'phone');
  formData.append('capabilities.appointmentFields', 'name');
  formData.append('capabilities.appointmentFields', 'preferred_time');

  return formData;
}

test('parseAgentForm accepts a valid tenant agent payload', () => {
  const result = parseAgentForm(buildValidAgentFormData());

  assert.equal('data' in result, true);

  if ('data' in result) {
    assert.equal(result.data.name, 'Front Desk Assistant');
    assert.equal(result.data.status, 'draft');
    assert.equal(result.data.interruption_enabled, true);
    assert.equal(result.data.idle_timeout_enabled, true);
    assert.equal(result.data.idle_check_in_seconds, 30);
    assert.equal(result.data.idle_end_seconds, 60);
    assert.equal(result.data.idle_check_in_message, 'Hello, are you there?');
    assert.equal(result.data.tone, 'Warm and calm');
    assert.equal(result.data.capabilities.capture_leads, true);
    assert.equal(result.data.capabilities.capture_appointments, true);
    assert.deepEqual(result.data.capabilities.lead_fields, ['name', 'phone']);
  }
});

test('parseAgentForm persists idle timeout disabled state', () => {
  const formData = buildValidAgentFormData();
  formData.delete('idleTimeoutEnabled');
  formData.set('idleCheckInSeconds', '25');
  formData.set('idleEndSeconds', '45');
  formData.set('idleCheckInMessage', 'Still there?');

  const result = parseAgentForm(formData);

  assert.equal('data' in result, true);
  if ('data' in result) {
    assert.equal(result.data.idle_timeout_enabled, false);
    assert.equal(result.data.idle_check_in_seconds, 25);
    assert.equal(result.data.idle_end_seconds, 45);
    assert.equal(result.data.idle_check_in_message, 'Still there?');
  }
});

test('parseAgentForm rejects ask-at below half of ending timeout', () => {
  const formData = buildValidAgentFormData();
  formData.set('idleCheckInSeconds', '20');
  formData.set('idleEndSeconds', '60');

  const result = parseAgentForm(formData);

  assert.equal('errors' in result, true);
  if ('errors' in result) {
    assert.equal(
      result.errors.some((error) =>
        error.includes(
          'Ask message time should be between 30 and 45 seconds (half to three-quarters of the 60s call ending timeout).',
        ),
      ),
      true,
    );
  }
});

test('parseAgentForm rejects ask-at above three-quarters of ending timeout', () => {
  const formData = buildValidAgentFormData();
  formData.set('idleCheckInSeconds', '50');
  formData.set('idleEndSeconds', '60');

  const result = parseAgentForm(formData);

  assert.equal('errors' in result, true);
  if ('errors' in result) {
    assert.equal(
      result.errors.some((error) =>
        error.includes(
          'Ask message time should be between 30 and 45 seconds (half to three-quarters of the 60s call ending timeout).',
        ),
      ),
      true,
    );
  }
});

test('parseAgentForm rejects appointment capture without preferred_time', () => {
  const formData = buildValidAgentFormData();
  formData.delete('capabilities.appointmentFields');
  formData.append('capabilities.appointmentFields', 'name');

  const result = parseAgentForm(formData);

  assert.equal('errors' in result, true);
  if ('errors' in result) {
    assert.equal(
      result.errors.some((error) =>
        error.includes('preferred time field'),
      ),
      true,
    );
  }
});

test('parseAgentForm rejects appointment capture without name', () => {
  const formData = buildValidAgentFormData();
  formData.delete('capabilities.appointmentFields');
  formData.append('capabilities.appointmentFields', 'preferred_time');

  const result = parseAgentForm(formData);

  assert.equal('errors' in result, true);
  if ('errors' in result) {
    assert.equal(
      result.errors.some((error) => error.includes('name field')),
      true,
    );
  }
});

test('parseAgentForm defaults blank tone to Friendly', () => {
  const formData = buildValidAgentFormData();
  formData.set('tone', '');

  const result = parseAgentForm(formData);

  assert.equal('data' in result, true);
  if ('data' in result) {
    assert.equal(result.data.tone, 'Friendly');
    assert.equal(result.values.tone, 'Friendly');
  }
});

test('parseAgentForm rejects invalid status and language', () => {
  const formData = buildValidAgentFormData();
  formData.set('status', 'archived');
  formData.set('language', 'en_us');

  const result = parseAgentForm(formData);

  assert.equal('errors' in result, true);

  if ('errors' in result) {
    assert.equal(
      result.errors.some((error) => error.includes('Status must be draft')),
      true,
    );
    assert.equal(
      result.errors.some((error) => error.includes('Language must be')),
      true,
    );
  }
});

test('agentRecordToValues keeps runtime settings from the database record', () => {
  const values = agentRecordToValues({
    capabilities: {
      capture_appointments: true,
      capture_leads: true,
      capture_messages: false,
      offer_handoff: true,
      appointment_fields: ['name', 'preferred_time'],
      lead_fields: ['name', 'phone'],
      message_fields: ['message'],
    },
    fallback_message: 'Please leave a message after the tone.',
    greeting: 'Hello from Sleek Relay.',
    id: 'agent-1',
    idle_check_in_message: 'Are you still there?',
    idle_check_in_seconds: 20,
    idle_end_seconds: 45,
    idle_timeout_enabled: false,
    interruption_enabled: false,
    language: 'en',
    maximum_session_duration_seconds: 1200,
    name: 'After Hours Assistant',
    role: 'After Hours',
    silence_timeout_seconds: 10,
    special_instructions: 'Escalate urgent matters.',
    status: 'paused',
    tone: 'Professional',
    updated_at: '2026-08-06T08:30:00.000Z',
    voice_id: 'verse',
  });

  assert.equal(values.voiceId, 'verse');
  assert.equal(values.interruptionEnabled, false);
  assert.equal(values.idleTimeoutEnabled, false);
  assert.equal(values.idleCheckInSeconds, 20);
  assert.equal(values.idleEndSeconds, 45);
  assert.equal(values.idleCheckInMessage, 'Are you still there?');
  assert.equal(values.status, 'paused');
  assert.equal(values.maximumSessionDurationSeconds, 1200);
  assert.equal(values.capabilities.captureAppointments, true);
  assert.equal(values.capabilities.offerHandoff, true);
});

test('emptyAgentValues returns safe defaults for a new agent form', () => {
  const values = emptyAgentValues();

  assert.equal(values.status, 'draft');
  assert.equal(values.language, 'en');
  assert.equal(values.interruptionEnabled, true);
  assert.equal(values.idleTimeoutEnabled, true);
  assert.equal(values.idleCheckInSeconds, 30);
  assert.equal(values.idleEndSeconds, 60);
  assert.equal(values.idleCheckInMessage, 'Hello, are you there?');
  assert.equal(values.capabilities.captureLeads, false);
  assert.equal(values.capabilities.captureAppointments, false);
});

test('canManageTenantResources limits mutations to owners and admins', () => {
  assert.equal(canManageTenantResources('owner'), true);
  assert.equal(canManageTenantResources('admin'), true);
  assert.equal(canManageTenantResources('member'), false);
});
