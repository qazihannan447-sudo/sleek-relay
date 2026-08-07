import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emptyWorkspaceOnboardingValues,
  parseWorkspaceOnboardingForm,
} from '../lib/onboarding/validation';

function buildValidWorkspaceFormData(): FormData {
  const formData = new FormData();

  formData.set('workspaceName', 'Acme Relay Workspace');
  formData.set('businessName', 'Acme Dental Care');
  formData.set('category', 'Dental clinic');
  formData.set('timezone', 'America/Toronto');

  return formData;
}

test('parseWorkspaceOnboardingForm accepts a valid workspace payload', () => {
  const result = parseWorkspaceOnboardingForm(buildValidWorkspaceFormData());

  assert.equal('errors' in result, false);

  if ('values' in result) {
    assert.equal(result.values.workspaceName, 'Acme Relay Workspace');
    assert.equal(result.values.businessName, 'Acme Dental Care');
    assert.equal(result.values.timezone, 'America/Toronto');
  }
});

test('parseWorkspaceOnboardingForm rejects blank names and invalid timezone', () => {
  const formData = new FormData();
  formData.set('workspaceName', '');
  formData.set('businessName', '');
  formData.set('timezone', 'Not/A_Timezone');

  const result = parseWorkspaceOnboardingForm(formData);

  assert.equal('errors' in result, true);

  if ('errors' in result) {
    assert.equal(
      result.errors.includes('Workspace name is required.'),
      true,
    );
    assert.equal(
      result.errors.includes('Business name is required.'),
      true,
    );
    assert.equal(
      result.errors.includes(
        'Timezone must be one of the six Canadian timezones.',
      ),
      true,
    );
  }
});

test('emptyWorkspaceOnboardingValues starts with a blank setup form', () => {
  assert.deepEqual(emptyWorkspaceOnboardingValues(), {
    businessName: '',
    category: '',
    timezone: 'America/Toronto',
    workspaceName: '',
  });
});
