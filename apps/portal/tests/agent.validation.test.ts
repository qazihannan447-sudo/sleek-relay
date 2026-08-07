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
  formData.set('silenceTimeoutSeconds', '8');
  formData.set('maximumSessionDurationSeconds', '900');

  return formData;
}

test('parseAgentForm accepts a valid tenant agent payload', () => {
  const result = parseAgentForm(buildValidAgentFormData());

  assert.equal('data' in result, true);

  if ('data' in result) {
    assert.equal(result.data.name, 'Front Desk Assistant');
    assert.equal(result.data.status, 'draft');
    assert.equal(result.data.interruption_enabled, true);
    assert.equal(result.data.silence_timeout_seconds, 8);
    assert.equal(result.data.maximum_session_duration_seconds, 900);
    assert.equal(result.data.tone, 'Warm and calm');
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

test('parseAgentForm rejects invalid status, language, and runtime limits', () => {
  const formData = buildValidAgentFormData();
  formData.set('status', 'archived');
  formData.set('language', 'en_us');
  formData.set('silenceTimeoutSeconds', '2');
  formData.set('maximumSessionDurationSeconds', '30');

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
    assert.equal(
      result.errors.some((error) => error.includes('Silence timeout')),
      true,
    );
    assert.equal(
      result.errors.some((error) =>
        error.includes('Maximum session duration'),
      ),
      true,
    );
  }
});

test('agentRecordToValues keeps runtime settings from the database record', () => {
  const values = agentRecordToValues({
    fallback_message: 'Please leave a message after the tone.',
    greeting: 'Hello from Sleek Relay.',
    id: 'agent-1',
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
  assert.equal(values.status, 'paused');
  assert.equal(values.maximumSessionDurationSeconds, 1200);
});

test('emptyAgentValues returns safe defaults for a new agent form', () => {
  const values = emptyAgentValues();

  assert.equal(values.status, 'draft');
  assert.equal(values.language, 'en');
  assert.equal(values.interruptionEnabled, true);
});

test('canManageTenantResources limits mutations to owners and admins', () => {
  assert.equal(canManageTenantResources('owner'), true);
  assert.equal(canManageTenantResources('admin'), true);
  assert.equal(canManageTenantResources('member'), false);
});
