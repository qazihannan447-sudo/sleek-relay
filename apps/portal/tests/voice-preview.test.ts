import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearCachedVoicePreviews,
  fetchCartesiaPreviewAudio,
  readCachedVoicePreview,
  resolveCartesiaPreviewUrl,
  writeCachedVoicePreview,
} from '../lib/voices/cartesia-preview';

test('resolveCartesiaPreviewUrl reads expand[] preview_file_url from Cartesia', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    return new Response(
      JSON.stringify({
        preview_file_url:
          'https://files.cartesia.ai/files/file_fresh/download?format=playback',
      }),
      { status: 200 },
    );
  };

  const previewUrl = await resolveCartesiaPreviewUrl(
    'voice-123',
    'sk_car_test',
    fetchImpl,
  );

  assert.equal(
    previewUrl,
    'https://files.cartesia.ai/files/file_fresh/download?format=playback',
  );
  assert.match(calls[0] ?? '', /\/voices\/voice-123/);
  assert.match(calls[0] ?? '', /expand%5B%5D=preview_file_url|expand\[\]=preview_file_url/);
});

test('resolveCartesiaPreviewUrl returns null when Cartesia has no preview sample', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ preview_file_url: null }), { status: 200 });

  assert.equal(
    await resolveCartesiaPreviewUrl('voice-123', 'sk_car_test', fetchImpl),
    null,
  );
});

test('fetchCartesiaPreviewAudio returns buffered audio bytes', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
  const fetchImpl: typeof fetch = async () =>
    new Response(bytes, {
      headers: { 'Content-Type': 'audio/mpeg' },
      status: 200,
    });

  const audio = await fetchCartesiaPreviewAudio(
    'https://files.cartesia.ai/files/file_fresh/download?format=playback',
    'sk_car_test',
    fetchImpl,
  );

  assert.ok(audio);
  assert.equal(audio.contentType, 'audio/mpeg');
  assert.equal(audio.body.byteLength, 4);
});

test('fetchCartesiaPreviewAudio returns null for failed upstream responses', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response('gone', { status: 404 });

  assert.equal(
    await fetchCartesiaPreviewAudio(
      'https://files.cartesia.ai/files/file_stale/download?format=playback',
      'sk_car_test',
      fetchImpl,
    ),
    null,
  );
});

test('voice preview audio cache serves repeats without refetching Cartesia', () => {
  clearCachedVoicePreviews();
  const body = new Uint8Array([9, 8, 7]).buffer;

  writeCachedVoicePreview('voice-cache', {
    body,
    contentType: 'audio/mpeg',
  });

  const cached = readCachedVoicePreview('voice-cache');
  assert.ok(cached);
  assert.equal(cached.contentType, 'audio/mpeg');
  assert.equal(cached.body.byteLength, 3);

  const expired = readCachedVoicePreview('voice-cache', Date.now() + 11 * 60 * 1000);
  assert.equal(expired, null);
  clearCachedVoicePreviews();
});
