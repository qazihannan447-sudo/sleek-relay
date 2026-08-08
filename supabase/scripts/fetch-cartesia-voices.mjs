#!/usr/bin/env node
// Fetches Cartesia's live English voice catalog (GET /voices, a free/metadata
// endpoint separate from TTS-generation billing) and writes a Supabase
// migration that upserts public.voices. Standalone by design -- it does not
// import from apps/portal so it can run independent of the Next.js app.
//
// Re-run this whenever you want to pick up newly added Cartesia voices or
// refresh preview URLs. Only voices with a Cartesia preview_file_url are
// written. Upserts by id (never deletes), so it's safe to run repeatedly.
//
//   CARTESIA_API_KEY=sk_car_... node supabase/scripts/fetch-cartesia-voices.mjs \
//     --write-migration supabase/migrations/<timestamp>_seed_cartesia_voices.sql

import { writeFileSync } from 'node:fs';

const CARTESIA_API_BASE = 'https://api.cartesia.ai';
const CARTESIA_VERSION = '2026-03-01';
const MAX_PAGES = 20;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--write-migration') {
      args.writeMigration = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

async function fetchVoicesPage(apiKey, startingAfter) {
  const url = new URL(`${CARTESIA_API_BASE}/voices`);
  url.searchParams.set('limit', '100');
  url.searchParams.append('expand[]', 'preview_file_url');
  if (startingAfter) {
    url.searchParams.set('starting_after', startingAfter);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Cartesia-Version': CARTESIA_VERSION,
    },
  });

  if (!response.ok) {
    throw new Error(`Cartesia voices request failed: ${response.status} ${response.statusText}`);
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

function sqlString(value) {
  if (value === null || value === undefined || value === '') {
    return 'null';
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizeGender(value) {
  return value === 'masculine' || value === 'feminine' || value === 'gender_neutral'
    ? value
    : null;
}

function buildMigrationSql(voices) {
  const withPreview = voices.filter((voice) => Boolean(voice.preview_file_url));
  const rows = withPreview.map((voice) => {
    const columns = [
      sqlString(voice.id),
      sqlString(voice.name),
      sqlString(normalizeGender(voice.gender)),
      sqlString(voice.tagline ?? null),
      sqlString(voice.language ?? 'en'),
      sqlString(voice.preview_file_url ?? null),
      'true',
    ];
    return `  (${columns.join(', ')})`;
  });
  const omitted = voices.length - withPreview.length;

  return `-- Seeds/refreshes public.voices from Cartesia's live English catalog
-- (${withPreview.length} voices with preview samples; ${omitted} without
-- preview omitted), fetched via supabase/scripts/fetch-cartesia-voices.mjs.
-- Safe to re-run: upserts by id (never deletes) -- a voice Cartesia removes
-- just stops being refreshed here rather than being silently dropped.
--
-- Only voices with a preview_file_url are seeded so Configure Voice only
-- lists voices users can actually hear before choosing.

insert into public.voices (id, name, gender, tagline, language, preview_url, enabled)
values
${rows.join(',\n')}
on conflict (id) do update set
  name = excluded.name,
  gender = excluded.gender,
  tagline = excluded.tagline,
  language = excluded.language,
  preview_url = excluded.preview_url,
  enabled = excluded.enabled,
  updated_at = now();
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.writeMigration) {
    console.error('Usage: node fetch-cartesia-voices.mjs --write-migration <path>');
    process.exitCode = 1;
    return;
  }

  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) {
    console.error('CARTESIA_API_KEY is not set.');
    process.exitCode = 1;
    return;
  }

  const voices = await fetchAllEnglishVoices(apiKey);
  const withPreview = voices.filter((voice) => Boolean(voice.preview_file_url));
  console.log(
    `Fetched ${voices.length} English Cartesia voices; ${withPreview.length} have previews.`,
  );

  writeFileSync(args.writeMigration, buildMigrationSql(voices), 'utf8');
  console.log(`Wrote ${args.writeMigration}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
