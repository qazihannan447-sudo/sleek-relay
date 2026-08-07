import assert from 'node:assert/strict';
import test from 'node:test';

import { emptyBusinessConfigurationValues } from '../lib/business-configuration/schema';
import {
  applyExtractionPatchToValues,
  draftHasApplicableProfileFields,
  draftHasReviewContent,
  formatBusinessHoursDisplay,
  mapExtractionDraftToView,
  normalizeWebsiteInput,
  type RawExtractionDraft,
} from '../lib/business-configuration/website-extraction';

function buildRawDraft(
  overrides: Partial<RawExtractionDraft> = {},
): RawExtractionDraft {
  return {
    extractedAt: '2026-08-07T12:00:00.000Z',
    fields: {
      businessName: {
        confidence: 'high',
        source: 'structured_data',
        sourceUrl: 'https://greenleaf.example.com/',
        value: 'Greenleaf Dental',
      },
      contactEmail: {
        confidence: 'medium',
        source: 'llm_inferred',
        sourceUrl: 'https://greenleaf.example.com/',
        value: 'hello@greenleaf.example.com',
      },
      hours: {
        confidence: 'high',
        source: 'structured_data',
        sourceUrl: 'https://greenleaf.example.com/',
        value: {
          friday: { close: '17:00', open: '09:00' },
          monday: { close: '17:00', open: '09:00' },
          saturday: 'closed',
          sunday: 'closed',
          thursday: { close: '17:00', open: '09:00' },
          tuesday: { close: '17:00', open: '09:00' },
          wednesday: { close: '17:00', open: '09:00' },
        },
      },
      phone: {
        confidence: 'high',
        source: 'structured_data',
        sourceUrl: 'https://greenleaf.example.com/',
        value: '+1-555-0101',
      },
      website: {
        confidence: 'high',
        source: 'structured_data',
        sourceUrl: 'https://greenleaf.example.com/',
        value: 'https://greenleaf.example.com/',
      },
    },
    normalizedUrl: 'https://greenleaf.example.com/',
    status: 'ok',
    ...overrides,
  };
}

test('normalizeWebsiteInput prepends https for bare domains', () => {
  assert.equal(normalizeWebsiteInput('greenleaf.example.com'), 'https://greenleaf.example.com');
  assert.equal(
    normalizeWebsiteInput('https://greenleaf.example.com'),
    'https://greenleaf.example.com',
  );
});

test('mapExtractionDraftToView builds form patch and hours display', () => {
  const view = mapExtractionDraftToView(buildRawDraft());

  assert.equal(view.formPatch.businessName, 'Greenleaf Dental');
  assert.equal(view.formPatch.businessPhone, '+1-555-0101');
  assert.equal(view.formPatch.contactEmail, 'hello@greenleaf.example.com');
  assert.equal(view.formPatch.website, 'https://greenleaf.example.com/');
  assert.equal(view.fields.hours?.value.mon.closed, false);
  assert.equal(view.fields.hours?.value.mon.open, '09:00');
  assert.equal(view.fields.hours?.value.sun.closed, true);
  assert.match(view.fields.hours?.display ?? '', /Mon 9:00 AM/);
  assert.equal(draftHasApplicableProfileFields(view), true);
  assert.equal(draftHasReviewContent(view), true);
});

test('applyExtractionPatchToValues keeps untouched fields', () => {
  const current = emptyBusinessConfigurationValues();
  current.businessName = 'Existing Name';
  current.contactName = 'Ava Green';
  current.timezone = 'America/Toronto';

  const next = applyExtractionPatchToValues(current, {
    businessName: 'Greenleaf Dental',
    businessPhone: '+1-555-0101',
  });

  assert.equal(next.businessName, 'Greenleaf Dental');
  assert.equal(next.businessPhone, '+1-555-0101');
  assert.equal(next.contactName, 'Ava Green');
  assert.equal(next.timezone, 'America/Toronto');
});

test('draftHasReviewContent recognizes FAQ-only drafts', () => {
  const view = mapExtractionDraftToView(
    buildRawDraft({
      fields: {
        faqs: {
          confidence: 'low',
          source: 'llm_inferred',
          sourceUrl: 'https://greenleaf.example.com/',
          value: [{ answer: 'Yes.', question: 'Do you accept walk-ins?' }],
        },
      },
      status: 'partial',
    }),
  );

  assert.equal(draftHasApplicableProfileFields(view), false);
  assert.equal(draftHasReviewContent(view), true);
});

test('formatBusinessHoursDisplay summarizes closed and open days', () => {
  const view = mapExtractionDraftToView(buildRawDraft());
  assert.ok(view.fields.hours);
  assert.equal(
    formatBusinessHoursDisplay(view.fields.hours.value).includes('Sat Closed'),
    true,
  );
});
