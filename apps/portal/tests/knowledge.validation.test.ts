import assert from 'node:assert/strict';
import test from 'node:test';

import { businessKnowledgeRecordToValues } from '../lib/knowledge/schema';
import { parseBusinessKnowledgeForm } from '../lib/knowledge/validation';

function buildValidKnowledgeFormData(): FormData {
  const formData = new FormData();

  formData.set('title', 'Do you accept walk-ins?');
  formData.set('kind', 'faq');
  formData.set('status', 'approved');
  formData.set(
    'content',
    'Walk-in availability depends on same-day capacity and should be framed as best-effort only.',
  );

  return formData;
}

test('parseBusinessKnowledgeForm accepts a valid knowledge record', () => {
  const result = parseBusinessKnowledgeForm(buildValidKnowledgeFormData());

  assert.equal('data' in result, true);

  if ('data' in result) {
    assert.equal(result.data.kind, 'faq');
    assert.equal(result.data.status, 'approved');
    assert.equal(result.data.title, 'Do you accept walk-ins?');
  }
});

test('parseBusinessKnowledgeForm rejects invalid type, status, and blank content', () => {
  const formData = buildValidKnowledgeFormData();
  formData.set('kind', 'script');
  formData.set('status', 'published');
  formData.set('content', '');

  const result = parseBusinessKnowledgeForm(formData);

  assert.equal('errors' in result, true);

  if ('errors' in result) {
    assert.equal(
      result.errors.some((error) => error.includes('Knowledge type')),
      true,
    );
    assert.equal(
      result.errors.some((error) => error.includes('Knowledge status')),
      true,
    );
    assert.equal(
      result.errors.some((error) => error.includes('Knowledge content is required')),
      true,
    );
  }
});

test('businessKnowledgeRecordToValues keeps stored knowledge fields intact', () => {
  const values = businessKnowledgeRecordToValues({
    content: 'We are closed on statutory holidays.',
    id: 'knowledge-1',
    kind: 'policy',
    status: 'disabled',
    title: 'Holiday closure policy',
    updated_at: '2026-08-06T09:00:00.000Z',
  });

  assert.equal(values.kind, 'policy');
  assert.equal(values.status, 'disabled');
  assert.equal(values.content, 'We are closed on statutory holidays.');
});

