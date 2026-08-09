# Website Extraction — Sleek Relay

Scrapes a business's website at onboarding time and produces a **draft** business-profile
(fields + a chunked knowledge base) for an owner to review and approve. It never writes to
live tenant config or agent storage on its own — see [Section 5: the hard rule](#the-hard-rule-draft-only)
below before touching anything here.

Full spec: [`requirements.md`](./requirements.md) (the original single-page component).
The multi-page pipeline (`extractSiteDraft`) goes beyond that spec deliberately — see
[Two pipelines](#two-pipelines) for why both exist.

**Wiring this into the `sleek-relay` monorepo?** See [`INTEGRATION.md`](./INTEGRATION.md) —
concrete steps plus the open decisions your team needs to make (trigger mechanism, workspace
placement, CI). This file covers what the package *is*; that one covers how to plug it in.

## Status

Built and tested against real sites; **not yet integrated into the `sleek-relay` monorepo**.
See [What's not done](#whats-not-done-read-this-before-integrating) before wiring this in.

## Setup

```
npm install
cp .env.example .env   # fill in what you need — see below
npm run build
npm test
```

`npm run typecheck` / `npm run build` / `npm test` should all be clean before you change
anything. If they aren't, something's already broken — fix that first.

### Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_API_KEY` / `AZURE_OPENAI_DEPLOYMENT` | Production LLM calls | The approved Foundry Canada East deployment. **Never tested live** — no credentials were available while building this; verify before trusting it in production. |
| `GEMINI_API_KEY` / `GEMINI_MODEL` / `GEMINI_EMBEDDING_MODEL` | Local dev/demo only | Free-tier key. Uses native `generateContent` (not OpenAI-compat). Default model is `gemini-2.5-flash`. Never use in production — see `llmClientGemini.ts`. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_CHUNKS_TABLE` | Real chunk persistence | Service role key (not anon) — this is a backend write path. Run `supabase/agent_knowledge_chunks.sql` against your project first. **Never tested against a real Supabase project** — only against a fake client in tests. |

## Two pipelines

| | `extractDraft()` | `extractSiteDraft()` |
|---|---|---|
| Scope | One page, single-shot | Crawls the whole site (sitemap or link-following) |
| Budget | ~15s hard timeout | Up to 15 min (background job, not request/response) |
| Fields | Fixed 9-field schema (`requirements.md` Section 4) | Superset: + `services`, `projects`, `partners`, `summary`, `policies` |
| Output | Draft fields only | Draft fields **+ chunked content** for RAG retrieval |
| Matches spec? | Yes, exactly | No — deliberately goes beyond `requirements.md`; built after explicit sign-off mid-project when the real requirement turned out to be "the agent needs to know almost everything about the site," not just a form-prefill |

Use `extractDraft` if you only need a quick onboarding-form prefill from the homepage.
Use `extractSiteDraft` if the output needs to back a RAG agent (Pipecat voice worker, chat, etc.).

## The hard rule: draft-only

Neither pipeline writes anywhere. `extractDraft`/`extractSiteDraft` return a plain object;
that's it. The **only** functions that persist anything are `approveDraft`/`approveSiteDraft`,
and they cannot be called without an explicit `approvedBy` identity + `approvedAt` timestamp —
there is no code path from extraction straight to storage. Don't add one. If you're tempted
to skip the approval step "just for a quick test," use the `InMemoryChunkStore` /
`FileChunkStore` dev stores instead — they still go through the same gate.

## Architecture map

```
extractDraft() / extractSiteDraft()   — pure functions, no side effects, never throw
        │
        ├─ robots.ts / siteMap.ts     — robots.txt + sitemap/link discovery
        ├─ fetchPage.ts               — HTTP fetch, headless (Playwright) fallback
        ├─ structuredData.ts          — JSON-LD / Open Graph / mailto:/tel: (highest confidence)
        ├─ contentClean.ts / chunk.ts — boilerplate stripping, paragraph-aware chunking
        ├─ pageTypes.ts               — URL/nav-text page classification
        ├─ llmExtract.ts              — LLM field extraction, retry-once-on-malformed-JSON
        └─ merge.ts / validate.ts     — structured-data-wins merge, Zod schema validation
        │
        ▼
   ExtractionDraft / SiteExtractionDraft   (Zod-validated, schema.ts / siteSchema.ts)
        │
approveDraft() / approveSiteDraft()   — THE gate; requires approvedBy + approvedAt
        │
        ▼
   ChunkStore.save()   — InMemoryChunkStore (tests) / FileChunkStore (local dev,
                          durable across restarts) / SupabaseChunkStore (production)
```

Retrieval demo (not production code — see [What's not done](#whats-not-done-read-this-before-integrating)):
`embedder.ts` (Gemini embeddings) + `demoAsk.ts` (cosine-similarity search + LLM synthesis)
prove the chunks are actually answerable. Run `node --env-file=.env scratch-ask.mjs "your question"`
to see it end to end against a real site.

## Scripts you'll actually use

- `npm test` — full suite (84 tests as of this writing), all mocked, no network/API calls
- `npm run typecheck` — src + test
- `npm run build` — emits `dist/`, required before running any `scratch-*.mjs` script
- `node --env-file=.env scratch.mjs` — live multi-page crawl against a real site (edit the URL in the file)
- `node --env-file=.env scratch-ask.mjs "question"` — crawl + embed + ask, end to end

## Is this a library or a deployed service?

**Library.** Nothing here binds to a port or runs a server. It's meant to be `npm install`ed
by whatever process triggers extraction — most likely a Node worker in this monorepo
(mirroring the existing `workers/voice` pattern, e.g. `workers/extraction`), not a
separately-deployed API. The Python `workers/voice` Pipecat worker should **not** call into
this package at runtime — it should query Supabase/pgvector and the embedding/LLM APIs
directly in Python; `demoAsk.ts` exists to prove the chunks are answerable, not as code meant
to be invoked cross-language.

## What's NOT done — read this before integrating

- **No worker entrypoint exists.** Nothing currently triggers `extractSiteDraft()` from
  anywhere — no queue consumer, no API route. That glue needs to be built in the monorepo,
  not here.
- **`SupabaseChunkStore` is untested against a real Supabase project.** Only tested against a
  fake client (`test/supabaseChunkStore.test.ts`). Run the SQL migration for real and do one
  live save/load smoke test before trusting it.
- **The Azure OpenAI path has never been exercised live.** No credentials were available
  while building this. Typechecked and spec-correct, but unproven the way the Gemini path is
  (which was proven live, repeatedly, including through real failures — see git history /
  commit messages for what broke and how it was fixed).
- **Embeddings aren't persisted anywhere.** `askQuestion`/`embedChunks` re-embeds chunks fresh
  on every call. The `embedding` column in `supabase/agent_knowledge_chunks.sql` exists but
  nothing populates it yet — that should happen once, at approval time, not per-question.
- **No UI wiring.** Nothing connects a `SiteExtractionDraft` to an actual onboarding review
  screen — that's `apps/portal`'s job, not this package's.
- **No CI.** Tests pass locally; nothing runs them automatically yet. The monorepo already has
  `.github/workflows` — this package should get a workflow entry.

## A note on scope creep, for whoever picks this up next

This started as a strict implementation of `requirements.md` (single-page, 15s budget, fixed
9-field schema, no crawling — see Section 2's explicit "out of scope" list). It grew into the
multi-page/chunking/retrieval pipeline through a series of explicit conversations, each one
confirmed before building, not assumed. If you're extending this further, the same discipline
applies: `requirements.md` is still the spec for the single-page component; anything beyond it
(the whole `site*.ts` / `demoAsk.ts` / `*ChunkStore.ts` family) is additive scope that should
be treated as its own decision, not silently expanded further without checking in with
whoever owns the product call.
