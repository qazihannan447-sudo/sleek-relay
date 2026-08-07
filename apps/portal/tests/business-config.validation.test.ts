import assert from 'node:assert/strict';
import test from 'node:test';

import {
  businessConfigurationToValues,
  emptyBusinessConfigurationValues,
  normalizeBusinessHours,
  serializeBusinessHours,
} from '../lib/business-configuration/schema';
import { parseBusinessConfigurationForm } from '../lib/business-configuration/validation';

function buildValidFormData(): FormData {
  const formData = new FormData();

  formData.set('businessName', 'Greenleaf Dental');
  formData.set('website', 'https://greenleaf.example.com');
  formData.set('businessPhone', '+1-555-0101');
  formData.set('category', 'Dental Clinic');
  formData.set('contactName', 'Ava Green');
  formData.set('contactEmail', 'owner+greenleaf@sleekrelay.demo');
  formData.set('timezone', 'America/Toronto');

  for (const [day, hours] of Object.entries({
    mon: { close: '17:00', open: '09:00' },
    tue: { close: '17:00', open: '09:00' },
    wed: { close: '17:00', open: '09:00' },
    thu: { close: '17:00', open: '09:00' },
    fri: { close: '17:00', open: '09:00' },
    sat: { close: '13:00', open: '09:00' },
    sun: { close: '', open: '' },
  })) {
    if (day === 'sun') {
      formData.set(`businessHours.${day}.closed`, 'on');
    }

    formData.set(`businessHours.${day}.open`, hours.open);
    formData.set(`businessHours.${day}.close`, hours.close);
  }

  return formData;
}

test('normalizeBusinessHours falls back to a complete weekly structure', () => {
  const hours = normalizeBusinessHours({
    mon: { close: '17:00', closed: false, open: '09:00' },
  });

  assert.equal(hours.mon.closed, false);
  assert.equal(hours.mon.open, '09:00');
  assert.equal(hours.sun.closed, true);
  assert.equal(hours.sun.open, null);
});

test('normalizeBusinessHours parses stored JSON strings and preserves open days', () => {
  const hours = normalizeBusinessHours(
    '{"mon":{"closed":false,"open":"08:00","close":"18:00"},"tue":{"closed":false,"open":"08:00","close":"18:00"},"wed":{"closed":false,"open":"08:00","close":"18:00"},"thu":{"closed":false,"open":"08:00","close":"18:00"},"fri":{"closed":false,"open":"08:00","close":"18:00"},"sat":{"closed":true,"open":null,"close":null},"sun":{"closed":true,"open":null,"close":null}}',
  );

  assert.equal(hours.mon.closed, false);
  assert.equal(hours.mon.open, '08:00');
  assert.equal(hours.mon.close, '18:00');
  assert.equal(hours.sat.closed, true);
});

test('normalizeBusinessHours accepts full weekday keys from stored JSON', () => {
  const hours = normalizeBusinessHours({
    monday: { close: '16:00', closed: false, open: '08:00' },
    tuesday: { close: '16:00', closed: false, open: '08:00' },
    wednesday: { close: '16:00', closed: false, open: '08:00' },
    thursday: { close: '16:00', closed: false, open: '08:00' },
    friday: { close: '16:00', closed: false, open: '08:00' },
    saturday: { close: null, closed: true, open: null },
    sunday: { close: null, closed: true, open: null },
  });

  assert.equal(hours.mon.closed, false);
  assert.equal(hours.mon.open, '08:00');
  assert.equal(hours.mon.close, '16:00');
  assert.equal(hours.sun.closed, true);
});

test('businessConfigurationToValues keeps stored weekday hours through page props', () => {
  const values = businessConfigurationToValues({
    business_hours: {
      monday: { close: '16:00', closed: false, open: '08:00' },
      friday: { close: '14:00', closed: false, open: '09:00' },
      sunday: { close: null, closed: true, open: null },
    },
    business_name: 'Harbor Home Care',
    business_phone: '+1-555-0102',
    category: 'Home Care',
    contact_email: 'owner+harbor@sleekrelay.demo',
    contact_name: 'Owen Harbor',
    timezone: 'America/Toronto',
    website: 'https://harbor.example.com',
  });

  assert.equal(values.businessHours.mon.closed, false);
  assert.equal(values.businessHours.mon.open, '08:00');
  assert.equal(values.businessHours.mon.close, '16:00');
  assert.equal(values.businessHours.fri.open, '09:00');
  assert.equal(values.businessHours.sun.closed, true);
});

test('parseBusinessConfigurationForm accepts a valid business profile', () => {
  const result = parseBusinessConfigurationForm(buildValidFormData());

  assert.equal('data' in result, true);

  if ('data' in result) {
    assert.equal(result.data.business_name, 'Greenleaf Dental');
    assert.equal(result.data.business_hours.mon.open, '09:00');
    assert.equal(result.data.business_hours.sun.closed, true);
  }
});

test('parseBusinessConfigurationForm serializes all seven days and clears closed-day times', () => {
  const formData = buildValidFormData();
  formData.set('businessHours.sat.closed', 'on');
  formData.set('businessHours.sat.open', '09:00');
  formData.set('businessHours.sat.close', '13:00');

  const result = parseBusinessConfigurationForm(formData);

  assert.equal('data' in result, true);

  if ('data' in result) {
    assert.deepEqual(Object.keys(result.data.business_hours).sort(), [
      'fri',
      'mon',
      'sat',
      'sun',
      'thu',
      'tue',
      'wed',
    ]);
    assert.equal(result.data.business_hours.sat.closed, true);
    assert.equal(result.data.business_hours.sat.open, null);
    assert.equal(result.data.business_hours.sat.close, null);
    assert.equal(result.data.business_hours.mon.open, '09:00');
  }
});

test('parseBusinessConfigurationForm rejects invalid website, email, and hours', () => {
  const formData = buildValidFormData();
  formData.set('website', 'not-a-url');
  formData.set('contactEmail', 'invalid');
  formData.set('businessHours.mon.open', '18:00');
  formData.set('businessHours.mon.close', '09:00');

  const result = parseBusinessConfigurationForm(formData);

  assert.equal('errors' in result, true);

  if ('errors' in result) {
    assert.equal(result.values.businessName, 'Greenleaf Dental');
    assert.equal(result.errors.some((error) => error.includes('Website')), true);
    assert.equal(
      result.errors.some((error) => error.includes('Contact email')),
      true,
    );
    assert.equal(
      result.errors.some((error) => error.includes('Monday opening time')),
      true,
    );
  }
});

test('parseBusinessConfigurationForm rejects non-Canadian timezones', () => {
  const formData = buildValidFormData();
  formData.set('timezone', 'America/Chicago');

  const result = parseBusinessConfigurationForm(formData);

  assert.equal('errors' in result, true);

  if ('errors' in result) {
    assert.equal(
      result.errors.includes('Timezone must be one of the six Canadian timezones.'),
      true,
    );
  }
});

test('emptyBusinessConfigurationValues returns blank editable defaults', () => {
  const values = emptyBusinessConfigurationValues();

  assert.equal(values.businessName, '');
  assert.equal(values.businessHours.mon.closed, true);
  assert.equal(values.businessHours.mon.open, null);
});

test('serializeBusinessHours removes misleading times from closed days', () => {
  const values = emptyBusinessConfigurationValues();

  values.businessHours.mon = {
    close: '17:00',
    closed: false,
    open: '09:00',
  };
  values.businessHours.sun = {
    close: '18:00',
    closed: true,
    open: '08:00',
  };

  const serialized = serializeBusinessHours(values.businessHours);

  assert.equal(serialized.mon.closed, false);
  assert.equal(serialized.mon.open, '09:00');
  assert.equal(serialized.sun.closed, true);
  assert.equal(serialized.sun.open, null);
  assert.equal(serialized.sun.close, null);
});
