import assert from 'node:assert/strict';
import test from 'node:test';

import { emptyBusinessConfigurationValues } from '../lib/business-configuration/schema';
import {
  applyExtractionPatchToValues,
  clearWebsiteAssistedProfileFields,
  draftHasApplicableProfileFields,
  draftHasReviewContent,
  filterDraftFormPatch,
  formatBusinessHoursDisplay,
  formatWebsiteDisplayLabel,
  formatWebsiteScrapeFailureMessage,
  isDifferentWebsiteHost,
  listDraftProfileFieldKeys,
  mapExtractionDraftToView,
  mergeWebsiteExtractionDrafts,
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

  assert.equal(view.formPatch.businessName, undefined);
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

test('draftHasReviewContent ignores website-only drafts', () => {
  const view = mapExtractionDraftToView(
    buildRawDraft({
      fields: {
        website: {
          confidence: 'high',
          source: 'structured_data',
          sourceUrl: 'https://greenleaf.example.com/',
          value: 'https://greenleaf.example.com/',
        },
      },
      status: 'empty',
    }),
  );

  assert.equal(draftHasApplicableProfileFields(view), false);
  assert.equal(draftHasReviewContent(view), false);
});

test('applyExtractionPatchToValues keeps untouched fields', () => {
  const current = emptyBusinessConfigurationValues();
  current.businessName = 'Existing Name';
  current.contactName = 'Ava Green';
  current.timezone = 'America/Toronto';

  const replaced = applyExtractionPatchToValues(
    current,
    {
      category: 'Dental clinic',
      businessPhone: '+1-555-0101',
    },
    'replace',
  );

  assert.equal(replaced.next.businessName, 'Existing Name');
  assert.equal(replaced.next.category, 'Dental clinic');
  assert.equal(replaced.next.businessPhone, '+1-555-0101');
  assert.equal(replaced.next.contactName, 'Ava Green');
  assert.equal(replaced.next.timezone, 'America/Toronto');
  assert.deepEqual(replaced.appliedKeys.sort(), ['businessPhone', 'category']);
  assert.deepEqual(replaced.skippedKeys, []);
});

test('applyExtractionPatchToValues fillEmpty skips non-blank profile fields', () => {
  const current = emptyBusinessConfigurationValues();
  current.category = 'Existing category';
  current.businessPhone = '';

  const filled = applyExtractionPatchToValues(
    current,
    {
      category: 'Dental clinic',
      businessPhone: '+1-555-0101',
    },
    'fillEmpty',
  );

  assert.equal(filled.next.category, 'Existing category');
  assert.equal(filled.next.businessPhone, '+1-555-0101');
  assert.deepEqual(filled.appliedKeys, ['businessPhone']);
  assert.deepEqual(filled.skippedKeys, ['category']);
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

test('draftHasReviewContent recognizes services and summary extras', () => {
  const view = mapExtractionDraftToView(
    buildRawDraft({
      fields: {
        services: {
          confidence: 'medium',
          source: 'llm_inferred',
          sourceUrl: 'https://greenleaf.example.com/',
          value: [
            { description: 'Routine cleaning', name: 'Dental cleaning' },
            { name: 'Whitening' },
          ],
        },
        summary: {
          confidence: 'low',
          source: 'llm_inferred',
          sourceUrl: 'https://greenleaf.example.com/',
          value: 'Greenleaf Dental offers family dentistry in Toronto.',
        },
        policies: {
          confidence: 'low',
          source: 'llm_inferred',
          sourceUrl: 'https://greenleaf.example.com/',
          value: ['Cancellations require 24 hours notice.'],
        },
      },
      status: 'partial',
    }),
  );

  assert.equal(view.fields.services?.value.length, 2);
  assert.equal(view.fields.summary?.value.includes('Greenleaf Dental'), true);
  assert.equal(view.fields.policies?.value[0], 'Cancellations require 24 hours notice.');
  assert.equal(draftHasApplicableProfileFields(view), false);
  assert.equal(draftHasReviewContent(view), true);
});

test('draftToKnowledgeCandidates maps faqs services policies and summary', async () => {
  const { draftToKnowledgeCandidates, draftHasKnowledgeContent } = await import(
    '../lib/business-configuration/website-knowledge'
  );

  const view = mapExtractionDraftToView(
    buildRawDraft({
      fields: {
        address: {
          confidence: 'high',
          source: 'structured_data',
          sourceUrl: 'https://greenleaf.example.com/',
          value: '12 Main St',
        },
        faqs: {
          confidence: 'low',
          source: 'llm_inferred',
          sourceUrl: 'https://greenleaf.example.com/',
          value: [{ answer: 'Yes.', question: 'Do you accept walk-ins?' }],
        },
        services: {
          confidence: 'medium',
          source: 'llm_inferred',
          sourceUrl: 'https://greenleaf.example.com/',
          value: [{ description: 'Routine cleaning', name: 'Cleaning' }],
        },
        summary: {
          confidence: 'low',
          source: 'llm_inferred',
          sourceUrl: 'https://greenleaf.example.com/',
          value: 'A family dental clinic.',
        },
        socialLinks: {
          confidence: 'high',
          source: 'structured_data',
          sourceUrl: 'https://greenleaf.example.com/',
          value: ['https://facebook.com/greenleaf'],
        },
      },
      status: 'ok',
    }),
  );

  const candidates = draftToKnowledgeCandidates(view);
  assert.equal(draftHasKnowledgeContent(view), true);
  assert.equal(candidates.some((item) => item.kind === 'faq'), true);
  assert.equal(candidates.some((item) => item.kind === 'service_information'), true);
  assert.equal(candidates.some((item) => item.title === 'Business summary'), true);
  assert.equal(candidates.some((item) => item.title === 'Business address'), true);
  assert.equal(
    candidates.some((item) => item.title.startsWith('Social link:')),
    true,
  );
});

test('draftToKnowledgeCandidates includes project and partner names in content', async () => {
  const { draftToKnowledgeCandidates } = await import(
    '../lib/business-configuration/website-knowledge'
  );

  const view = mapExtractionDraftToView(
    buildRawDraft({
      fields: {
        partners: {
          confidence: 'high',
          source: 'llm_inferred',
          sourceUrl: 'https://finova.example.com/',
          value: [{ name: 'Acme Corp', url: 'https://acme.example.com' }],
        },
        projects: {
          confidence: 'high',
          source: 'llm_inferred',
          sourceUrl: 'https://finova.example.com/',
          value: [
            {
              description: 'Automation rollout',
              name: 'Retail Bot',
              url: 'https://finova.example.com/projects/retail',
            },
          ],
        },
      },
      status: 'ok',
    }),
  );

  const candidates = draftToKnowledgeCandidates(view);
  const project = candidates.find((item) => item.title === 'Project: Retail Bot');
  const partner = candidates.find((item) => item.title === 'Partner: Acme Corp');

  assert.ok(project);
  assert.match(project!.content, /Retail Bot/);
  assert.match(project!.content, /Automation rollout/);
  assert.ok(partner);
  assert.match(partner!.content, /Acme Corp/);
  assert.match(partner!.content, /https:\/\/acme\.example\.com/);
});

test('draftToKnowledgeCandidates uses short policy titles', async () => {
  const { draftToKnowledgeCandidates } = await import(
    '../lib/business-configuration/website-knowledge'
  );

  const view = mapExtractionDraftToView(
    buildRawDraft({
      fields: {
        policies: {
          confidence: 'low',
          source: 'llm_inferred',
          sourceUrl: 'https://greenleaf.example.com/',
          value: [
            'Cancellations require 24 hours notice. Fees may apply for late changes.',
          ],
        },
      },
      status: 'partial',
    }),
  );

  const candidates = draftToKnowledgeCandidates(view);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.title, 'Cancellations require 24 hours notice.');
  assert.match(candidates[0]?.content ?? '', /Fees may apply/);
});

test('formatBusinessHoursDisplay summarizes closed and open days', () => {
  const view = mapExtractionDraftToView(buildRawDraft());
  assert.ok(view.fields.hours);
  assert.equal(
    formatBusinessHoursDisplay(view.fields.hours.value).includes('Sat Closed'),
    true,
  );
});

test('formatWebsiteDisplayLabel prefers hostname without www', () => {
  assert.equal(
    formatWebsiteDisplayLabel('https://www.bad-site.example/path'),
    'bad-site.example',
  );
  assert.equal(formatWebsiteDisplayLabel('not-a-real-biz.test'), 'not-a-real-biz.test');
});

test('formatWebsiteScrapeFailureMessage explains unreachable and invalid sites', () => {
  assert.match(
    formatWebsiteScrapeFailureMessage('url_unreachable', 'https://missing.example'),
    /Couldn't load missing\.example/,
  );
  assert.match(
    formatWebsiteScrapeFailureMessage('url_unreachable', 'https://missing.example'),
    /does not appear to exist/,
  );
  assert.match(
    formatWebsiteScrapeFailureMessage('url_unreachable', 'https://missing.example'),
    /Profile below is unchanged/,
  );
  assert.match(
    formatWebsiteScrapeFailureMessage('invalid_url', ':::bad'),
    /not a valid website URL/,
  );
  assert.match(
    formatWebsiteScrapeFailureMessage('timed_out', 'slow.example.com'),
    /Timed out loading slow\.example\.com/,
  );
  assert.match(
    formatWebsiteScrapeFailureMessage('url_unreachable', 'https://missing.example', {
      unchangedClause:
        'Nothing was applied to the form yet — review any earlier results, or try again.',
    }),
    /Nothing was applied to the form yet/,
  );
});

test('isDifferentWebsiteHost detects a new scrape target', () => {
  assert.equal(
    isDifferentWebsiteHost('https://old.example', 'https://new.example'),
    true,
  );
  assert.equal(
    isDifferentWebsiteHost('https://www.same.example', 'same.example/about'),
    false,
  );
  assert.equal(isDifferentWebsiteHost('', 'https://first.example'), true);
});

test('clearWebsiteAssistedProfileFields removes previous-site contact fields', () => {
  const values = emptyBusinessConfigurationValues();
  values.businessName = 'Keep Me';
  values.contactName = 'Owner';
  values.timezone = 'America/Toronto';
  values.website = 'https://old.example';
  values.businessPhone = '555-1111';
  values.contactEmail = 'old@example.com';
  values.category = 'Old category';
  values.businessHours.mon = { close: '17:00', closed: false, open: '09:00' };

  const cleared = clearWebsiteAssistedProfileFields(values);
  assert.equal(cleared.businessName, 'Keep Me');
  assert.equal(cleared.contactName, 'Owner');
  assert.equal(cleared.timezone, 'America/Toronto');
  assert.equal(cleared.website, '');
  assert.equal(cleared.businessPhone, '');
  assert.equal(cleared.contactEmail, '');
  assert.equal(cleared.category, '');
  assert.equal(cleared.businessHours.mon.closed, true);
});

test('mergeWebsiteExtractionDrafts keeps quick profile fields enrich omitted', () => {
  const quick = mapExtractionDraftToView(
    buildRawDraft({
      fields: {
        phone: {
          confidence: 'high',
          source: 'structured_data',
          sourceUrl: 'https://greenleaf.example.com/',
          value: '+1 555 0100',
        },
        website: {
          confidence: 'high',
          source: 'structured_data',
          sourceUrl: 'https://greenleaf.example.com/',
          value: 'https://greenleaf.example.com/',
        },
      },
      status: 'partial',
    }),
  );
  const enrich = mapExtractionDraftToView(
    buildRawDraft({
      fields: {
        faqs: {
          confidence: 'medium',
          source: 'llm_inferred',
          sourceUrl: 'https://greenleaf.example.com/',
          value: [{ answer: 'Yes', question: 'Do you accept insurance?' }],
        },
        website: {
          confidence: 'high',
          source: 'structured_data',
          sourceUrl: 'https://greenleaf.example.com/',
          value: 'https://greenleaf.example.com/',
        },
      },
      status: 'ok',
    }),
  );

  const merged = mergeWebsiteExtractionDrafts(quick, enrich);
  assert.equal(merged.fields.phone?.value, '+1 555 0100');
  assert.equal(merged.fields.faqs?.value[0]?.question, 'Do you accept insurance?');
  assert.equal(merged.formPatch.businessPhone, '+1 555 0100');
});

test('listDraftProfileFieldKeys returns only formPatch scrape keys', () => {
  const view = mapExtractionDraftToView(buildRawDraft());
  assert.deepEqual(listDraftProfileFieldKeys(view).sort(), [
    'businessHours',
    'businessPhone',
    'contactEmail',
    'website',
  ]);
});

test('filterDraftFormPatch keeps only selected profile scrape keys', () => {
  const view = mapExtractionDraftToView(buildRawDraft());
  const filtered = filterDraftFormPatch(view, ['businessPhone', 'category']);

  assert.equal(filtered.businessPhone, '+1-555-0101');
  assert.equal(filtered.contactEmail, undefined);
  assert.equal(filtered.website, undefined);
  assert.equal(filtered.businessHours, undefined);
  assert.equal(filtered.category, undefined);
});
