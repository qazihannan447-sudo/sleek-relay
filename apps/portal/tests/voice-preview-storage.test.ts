import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVoicePreviewPublicUrl } from '../lib/voices/preview-storage';

test('buildVoicePreviewPublicUrl builds a public Supabase Storage object URL', () => {
  assert.equal(
    buildVoicePreviewPublicUrl(
      'https://example.supabase.co',
      'f786b574-daa5-4673-aa0c-cbe3e8534c02.mp3',
    ),
    'https://example.supabase.co/storage/v1/object/public/voice-previews/f786b574-daa5-4673-aa0c-cbe3e8534c02.mp3',
  );
});

test('buildVoicePreviewPublicUrl normalizes trailing slash and leading path slash', () => {
  assert.equal(
    buildVoicePreviewPublicUrl(
      'https://example.supabase.co/',
      '/voice-id.wav',
    ),
    'https://example.supabase.co/storage/v1/object/public/voice-previews/voice-id.wav',
  );
});
