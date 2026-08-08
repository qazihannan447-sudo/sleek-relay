#!/usr/bin/env node
// Downloads Cartesia voice preview samples and stores durable copies in the
// Supabase `voice-previews` bucket, then records preview_storage_path on
// public.voices. Run after applying the voice-preview storage migration.
//
// From the repo root:
//   node --env-file=apps/portal/.env.local --env-file=.env.voice \
//     supabase/scripts/sync-voice-previews.mjs
//
// Options:
//   --force     Re-download and overwrite existing storage objects
//   --limit N   Only process the first N voices that have a Cartesia preview
//   --concurrency N  Parallel downloads/uploads (default 4)

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const portalPackageJson = path.resolve(
  scriptDir,
  '../../apps/portal/package.json',
);
const require = createRequire(portalPackageJson);

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (!Number.isFinite(nodeMajor) || nodeMajor < 22) {
  console.error(
    `This script needs Node.js 22+ (current: ${process.versions.node}).\n` +
      'If you use nvm-windows, run: nvm use 24.12.0',
  );
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');

const CARTESIA_API_BASE = 'https://api.cartesia.ai';
const CARTESIA_VERSION = '2026-03-01';
const VOICE_PREVIEW_BUCKET = 'voice-previews';
const MAX_PAGES = 20;
const DEFAULT_CONCURRENCY = 4;

function parseArgs(argv) {
  const args = {
    concurrency: DEFAULT_CONCURRENCY,
    force: false,
    limit: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--force') {
      args.force = true;
    } else if (flag === '--limit') {
      args.limit = Number(argv[i + 1]);
      i += 1;
    } else if (flag === '--concurrency') {
      args.concurrency = Number(argv[i + 1]);
      i += 1;
    }
  }

  return args;
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function extensionForContentType(contentType) {
  const normalized = (contentType || '').split(';')[0]?.trim().toLowerCase();
  switch (normalized) {
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/mp4':
    case 'audio/aac':
      return 'm4a';
    case 'audio/mpeg':
    case 'audio/mp3':
    default:
      return 'mp3';
  }
}

function cartesiaHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Cartesia-Version': CARTESIA_VERSION,
  };
}

async function fetchVoicesPage(apiKey, startingAfter) {
  const url = new URL(`${CARTESIA_API_BASE}/voices`);
  url.searchParams.set('limit', '100');
  url.searchParams.append('expand[]', 'preview_file_url');
  if (startingAfter) {
    url.searchParams.set('starting_after', startingAfter);
  }

  const response = await fetch(url, {
    headers: cartesiaHeaders(apiKey),
  });

  if (!response.ok) {
    throw new Error(
      `Cartesia voices request failed: ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}

async function fetchAllEnglishVoices(apiKey) {
  const voices = [];
  let cursor;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchVoicesPage(apiKey, cursor);
    voices.push(...result.data);
    if (!result.has_more || !result.next_page) {
      break;
    }
    cursor = result.next_page;
  }

  return voices.filter((voice) => voice.language === 'en');
}

function normalizeGender(value) {
  return value === 'masculine' || value === 'feminine' || value === 'gender_neutral'
    ? value
    : null;
}

async function downloadPreviewAudio(previewUrl, apiKey) {
  const response = await fetch(previewUrl, {
    headers: cartesiaHeaders(apiKey),
  });

  if (!response.ok) {
    throw new Error(`Preview download failed (${response.status})`);
  }

  const contentType = response.headers.get('content-type') || 'audio/mpeg';
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error('Preview download returned empty audio');
  }

  return { bytes, contentType };
}

async function mapPool(items, concurrency, worker) {
  let index = 0;
  const results = new Array(items.length);

  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => run(),
  );
  await Promise.all(runners);
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cartesiaApiKey = requireEnv('CARTESIA_API_KEY');
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL for Supabase Storage uploads.',
    );
  }

  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) {
    throw new Error('--concurrency must be a positive number');
  }
  if (args.limit != null && (!Number.isFinite(args.limit) || args.limit < 1)) {
    throw new Error('--limit must be a positive number');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log('Fetching Cartesia English voice catalog...');
  const voices = await fetchAllEnglishVoices(cartesiaApiKey);
  const withPreview = voices.filter((voice) => Boolean(voice.preview_file_url));
  const selected =
    args.limit != null ? withPreview.slice(0, args.limit) : withPreview;

  console.log(
    `Found ${voices.length} English voices; ${withPreview.length} have previews; syncing ${selected.length}.`,
  );

  const summary = {
    failed: 0,
    skipped: 0,
    uploaded: 0,
  };

  await mapPool(selected, args.concurrency, async (voice) => {
    const label = `${voice.name} (${voice.id})`;

    try {
      const { data: existing, error: existingError } = await supabase
        .from('voices')
        .select('preview_storage_path')
        .eq('id', voice.id)
        .maybeSingle();

      if (existingError) {
        throw new Error(existingError.message);
      }

      if (existing?.preview_storage_path && !args.force) {
        summary.skipped += 1;
        console.log(`skip  ${label}`);
        return;
      }

      const audio = await downloadPreviewAudio(voice.preview_file_url, cartesiaApiKey);
      const extension = extensionForContentType(audio.contentType);
      const storagePath = `${voice.id}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from(VOICE_PREVIEW_BUCKET)
        .upload(storagePath, audio.bytes, {
          contentType: audio.contentType.split(';')[0] || 'audio/mpeg',
          upsert: true,
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { error: upsertError } = await supabase.from('voices').upsert(
        {
          enabled: true,
          gender: normalizeGender(voice.gender),
          id: voice.id,
          language: voice.language ?? 'en',
          name: voice.name,
          preview_storage_path: storagePath,
          preview_url: voice.preview_file_url ?? null,
          tagline: voice.tagline || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      );

      if (upsertError) {
        throw new Error(upsertError.message);
      }

      summary.uploaded += 1;
      console.log(`ok    ${label} -> ${storagePath}`);
    } catch (error) {
      summary.failed += 1;
      console.error(
        `fail  ${label}: ${error instanceof Error ? error.message : error}`,
      );
    }
  });

  console.log(
    `Done. uploaded=${summary.uploaded} skipped=${summary.skipped} failed=${summary.failed}`,
  );

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
