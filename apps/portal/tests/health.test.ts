import assert from 'node:assert/strict';
import test from 'node:test';

import { getHealthPayload } from '../lib/health';

test('getHealthPayload reports a reachable Supabase project when env is configured', async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://demo-project.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_demo';

  try {
    const payload = await getHealthPayload({
      fetchImpl: async (input, init) => {
        assert.equal(String(input), 'https://demo-project.supabase.co/auth/v1/settings');
        assert.equal(
          (init?.headers as Record<string, string>)?.apikey,
          'sb_publishable_demo',
        );

        return new Response('{}', {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        });
      },
    });

    assert.equal(payload.ok, true);
    assert.equal(payload.service, 'portal');
    assert.equal(payload.supabase.configured, true);
    assert.equal(payload.supabase.reachable, true);
    assert.equal(payload.supabase.status, 200);
    assert.equal(payload.supabase.projectRef, 'demo-project');
    assert.equal(payload.supabase.error, null);
    assert.equal(typeof payload.timestamp, 'string');
    assert.ok(Number.isFinite(Date.parse(payload.timestamp)));
  } finally {
    if (previousUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    }

    if (previousKey === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;
    }
  }
});

test('getHealthPayload reports configuration failures without throwing', async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  try {
    const payload = await getHealthPayload();

    assert.equal(payload.ok, false);
    assert.equal(payload.service, 'portal');
    assert.equal(payload.supabase.configured, false);
    assert.equal(payload.supabase.reachable, false);
    assert.equal(payload.supabase.status, null);
    assert.equal(payload.supabase.projectRef, null);
    assert.equal(
      payload.supabase.error?.includes('Missing required environment variable'),
      true,
    );
    assert.equal(typeof payload.timestamp, 'string');
    assert.ok(Number.isFinite(Date.parse(payload.timestamp)));
  } finally {
    if (previousUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    }

    if (previousKey === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;
    }
  }
});
