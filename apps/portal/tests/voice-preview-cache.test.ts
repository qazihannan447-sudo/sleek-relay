import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensureVoicePreviewCached,
  getCachedVoicePreviewUrl,
  hasCachedVoicePreview,
} from '../lib/voices/voice-preview-cache';

test('ensureVoicePreviewCached stores a playable object URL for instant reuse', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  globalThis.fetch = (async () =>
    new Response(new Uint8Array([1, 2, 3, 4]), {
      headers: { 'Content-Type': 'audio/mpeg' },
      status: 200,
    })) as typeof fetch;
  URL.createObjectURL = () => 'blob:voice-preview-test';
  URL.revokeObjectURL = () => undefined;

  try {
    const first = await ensureVoicePreviewCached(
      'voice-instant',
      '/api/voices/voice-instant/preview',
    );
    const second = getCachedVoicePreviewUrl('voice-instant');

    assert.equal(first, 'blob:voice-preview-test');
    assert.equal(second, 'blob:voice-preview-test');
    assert.equal(hasCachedVoicePreview('voice-instant'), true);
  } finally {
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});
