#!/usr/bin/env node
// Fetches Cartesia's live English voice catalog (GET /voices, a free/metadata
// endpoint separate from TTS-generation billing) and writes a Supabase
// migration that upserts public.voices. Standalone by design -- it does not
// import from apps/portal so it can run independent of the Next.js app.
//
// Re-run this whenever you want to pick up newly added Cartesia voices or
// refresh preview URLs. Only voices with a Cartesia preview_file_url are
// written. Upserts by id, then disables enabled catalog rows that are no
// longer present in the live previewable set (agents.voice_id remains text,
// so disabling is safer than deleting).
//
//   CARTESIA_API_KEY=sk_car_... node supabase/scripts/fetch-cartesia-voices.mjs \
//     --write-migration supabase/migrations/<timestamp>_seed_cartesia_voices.sql

import { writeFileSync } from 'node:fs';

const CARTESIA_API_BASE = 'https://api.cartesia.ai';
const CARTESIA_VERSION = '2026-03-01';
const MAX_PAGES = 20;

// Keep in sync with apps/portal/lib/voices/recommended-voices.ts
const RECOMMENDED_AGENT_VOICES = [
  { featuredRank: 1, id: 'f786b574-daa5-4673-aa0c-cbe3e8534c02' }, // Katie
  { featuredRank: 2, id: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4' }, // Skylar
  { featuredRank: 3, id: '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc' }, // Jacqueline
  { featuredRank: 4, id: 'a5136bf9-224c-4d76-b823-52bd5efcffcc' }, // Jameson
  { featuredRank: 5, id: '5ee9feff-1265-424a-9d7f-8e4d431a12c7' }, // Ronald
  { featuredRank: 6, id: '62ae83ad-4f6a-430b-af41-a9bede9286ca' }, // Gemma
  { featuredRank: 7, id: 'ef191366-f52f-447a-a398-ed8c0f2943a1' }, // Archie
  { featuredRank: 8, id: 'e8e5fffb-252c-436d-b842-8879b84445b6' }, // Cathy
  { featuredRank: 9, id: 'f9836c6e-a0bd-460e-9d3c-f7299fa60f94' }, // Caroline
];

const RECOMMENDED_BY_ID = new Map(
  RECOMMENDED_AGENT_VOICES.map((voice) => [voice.id, voice.featuredRank]),
);

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

function normalizeCountry(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toUpperCase();
  return trimmed || null;
}

function normalizeAccent(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeDescription(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function buildMigrationSql(voices) {
  const withPreview = voices.filter((voice) => Boolean(voice.preview_file_url));
  const rows = withPreview.map((voice) => {
    const featuredRank = RECOMMENDED_BY_ID.get(voice.id);
    const columns = [
      sqlString(voice.id),
      sqlString(voice.name),
      sqlString(normalizeGender(voice.gender)),
      sqlString(voice.tagline ?? null),
      sqlString(normalizeDescription(voice.description)),
      sqlString(normalizeCountry(voice.country)),
      sqlString(normalizeAccent(voice.accent)),
      sqlString(voice.language ?? 'en'),
      sqlString(voice.preview_file_url ?? null),
      'true',
      featuredRank ? 'true' : 'false',
      featuredRank ? String(featuredRank) : 'null',
      'now()',
    ];
    return `  (${columns.join(', ')})`;
  });
  const omitted = voices.length - withPreview.length;
  const liveIds = withPreview.map((voice) => sqlString(voice.id));

  return `-- Seeds/refreshes public.voices from Cartesia's live English catalog
-- (${withPreview.length} voices with preview samples; ${omitted} without
-- preview omitted), fetched via supabase/scripts/fetch-cartesia-voices.mjs.
--
-- Safe to re-run: upserts by id, then disables enabled rows that are no longer
-- in the live previewable set. agents.voice_id is plain text (no FK), so
-- disabling is preferred over deleting stale catalog rows.

insert into public.voices (
  id,
  name,
  gender,
  tagline,
  description,
  country,
  accent,
  language,
  preview_url,
  enabled,
  recommended_for_agent,
  featured_rank,
  last_seen_at
)
values
${rows.join(',\n')}
on conflict (id) do update set
  name = excluded.name,
  gender = excluded.gender,
  tagline = excluded.tagline,
  description = excluded.description,
  country = excluded.country,
  accent = excluded.accent,
  language = excluded.language,
  preview_url = excluded.preview_url,
  enabled = excluded.enabled,
  recommended_for_agent = excluded.recommended_for_agent,
  featured_rank = excluded.featured_rank,
  last_seen_at = excluded.last_seen_at,
  updated_at = now();

-- Disable formerly enabled catalog voices that Cartesia no longer returns with
-- a preview sample. Do not delete: agents may still reference voice_id text.
update public.voices
set
  enabled = false,
  recommended_for_agent = false,
  featured_rank = null,
  updated_at = now()
where enabled = true
  and id not in (
${liveIds.map((id) => `    ${id}`).join(',\n')}
  );
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
