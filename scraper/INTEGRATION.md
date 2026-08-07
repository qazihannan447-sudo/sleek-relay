# Integration guide — wiring this into `sleek-relay`

Companion to [`README.md`](./README.md) (what this is / architecture / what's not done).
This is the "how do we actually plug it in" doc. Several steps below are **reasonable
defaults, not decisions already made** — each one is flagged with ⚠️ where your team
needs to confirm or override the assumption before treating it as final.

## 1. Where this code lives

Recommended: add as a sibling to the existing worker, matching the repo's own convention —

```
sleek-relay/
  apps/portal/       (existing)
  workers/voice/     (existing — Python/Pipecat)
  workers/extraction/  ← this package goes here
```

⚠️ **Team decision**: does the repo root use npm/pnpm/yarn **workspaces**? Check the root
`package.json` for a `"workspaces"` field.
- **If yes**: add `"workers/extraction"` to that array, then `npm install` from the repo
  root — this package's own `package.json`/`package-lock.json` can likely be dropped in
  favor of the root lockfile managing it.
- **If no** (each app/worker is independently deployed with its own lockfile, matching how
  `workers/voice` looks like it's set up): keep this package's `package.json` as-is, drop
  the folder in, deploy it independently — same pattern as `workers/voice` presumably
  already uses.

Either way: copy everything except `node_modules/`, `dist/`, `.env`, `data/` (already
gitignored) into the new location, then run `npm install && npm test` there to confirm
nothing broke in the move.

## 2. Triggering extraction from the portal

This is the biggest open piece — **nothing here decides it, because `AGENTS.md` only says
"voice workers and internal services should use protected server-to-server authentication"
without specifying a mechanism**, and no queue/job infra currently exists in the repo.

⚠️ **Team decision**: pick one —

**Option A — minimal HTTP trigger (recommended default, matches `AGENTS.md`'s stated pattern)**
`workers/extraction` exposes a small internal API (a few routes, not a public one):
```
POST /extract   { url, tenantId, agentId }  →  202 { jobId }   (starts extractSiteDraft() async)
GET  /extract/:jobId                        →  { status, draft? }
POST /extract/:jobId/approve  { approvedBy } →  calls approveSiteDraft(), 200 { approved }
```
The portal calls these with a server-to-server credential (shared secret / signed JWT —
whatever `apps/portal` already uses for its other internal calls, if anything does yet).
Given extraction can take up to 15 minutes, `/extract` must return immediately with a job id,
not block on the crawl.

**Option B — DB-polling, no new API surface**
Portal inserts a row into a new `extraction_jobs` table (`tenant_id`, `agent_id`, `url`,
`status`). `workers/extraction` polls that table (or uses a Supabase Realtime subscription
instead of polling) for `status = 'pending'` rows, processes them, writes the result back.
No HTTP surface needed on the worker at all, but every "trigger extraction" and "get status"
interaction now goes through Supabase instead of a direct call.

Option A is more responsive and matches the architecture's own stated pattern; Option B needs
zero new infrastructure decisions. Either is a legitimate choice — this isn't something the
scraper package itself has an opinion on.

## 3. Database: run the migration for real

1. Copy [`supabase/agent_knowledge_chunks.sql`](./supabase/agent_knowledge_chunks.sql) into
   the repo's `supabase/migrations/` folder, following whatever timestamp-prefixed naming
   convention is already in use there.
2. Confirm the `vector` extension is enabled on the project (`create extension if not exists
   vector;` — the migration file assumes this).
3. ⚠️ **Team decision**: the migration uses `tenant_id text` / `agent_id text` to match this
   package's string-typed interface. If the real `tenants`/`agents` tables use `uuid` primary
   keys, change these to `uuid` + `references tenants(id)` / `references agents(id)` before
   applying it.
4. Apply it however this repo already applies migrations (Supabase CLI `db push`, or manual
   run against the project) — not something this package can do for you, it has no connection
   details for your actual project.
5. Once applied, run one real smoke test: `SupabaseChunkStore.save()` a handful of chunks,
   `.load()` them back, confirm row shape matches. `test/supabaseChunkStore.test.ts` only
   proves the code is correct against a fake client — this step proves the real database
   agrees.

## 4. Environment variables in deployment

Wherever `workers/extraction` ends up hosted, it needs (see `.env.example` for the full list):
```
AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY / AZURE_OPENAI_DEPLOYMENT   (production LLM)
SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY                                 (production storage)
```
`GEMINI_*` vars are dev-only — don't set them in any deployed environment.

## 5. Portal UI (the onboarding draft screen)

Sequence the review screen (the mockup you shared) against:
1. Owner submits URL → portal calls whichever trigger mechanism was chosen in step 2.
2. Portal polls/subscribes for job completion → receives a `SiteExtractionDraft`.
3. Render `draft.fields` into the mockup's rows — the mapping is already 1:1 (see
   `README.md`'s field table): `businessName`, `phone`, `contactEmail`, `hours`, `summary`,
   `services`, `faqs`, `policies`. Show `field.source`/`field.confidence` next to each value
   (Section 5's requirement — the owner needs to see what was scraped vs. typed).
4. Owner edits/approves → portal calls the approve trigger with `approvedBy` (the
   authenticated owner's identity) → worker calls `approveSiteDraft()` → chunks land in
   Supabase.

⚠️ Not built anywhere yet: this rendering step, the edit-then-approve UI flow, and capturing
`approvedBy` from the actual authenticated session. All portal-side work, outside this
package's scope.

## 6. CI

⚠️ **Team decision**: match whatever pattern `.github/workflows` already uses for
`apps/portal` / `workers/voice`. Minimally, a workflow scoped to `workers/extraction/**`
running:
```yaml
- run: npm ci
- run: npm run typecheck
- run: npm run build
- run: npm test
```
No secrets needed for CI — the full test suite (84 tests) runs against mocks, no live
Azure/Gemini/Supabase calls.

## Summary checklist

- [ ] Decide workspace vs. standalone package placement (§1)
- [ ] Decide HTTP trigger vs. DB-polling (§2)
- [ ] Run the Supabase migration for real, decide text vs. uuid tenant/agent ids (§3)
- [ ] Set production env vars on the deployed worker (§4)
- [ ] Build the portal-side draft review/approve UI (§5)
- [ ] Add a CI workflow entry (§6)
