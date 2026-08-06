# Sleek Relay Validation Demo Foundation

This repository currently contains the early foundation for the browser-based validation demo:

- `apps/portal`: Next.js portal with Supabase SSR authentication, a protected dashboard overview, and a health endpoint
- `workers/voice`: Python voice worker with a local Pipecat proof of concept plus helper health and config endpoints
- `supabase/`: migrations, seed assets, and database-oriented tests for the demo data foundation

The portal currently implements only authentication and read-only tenant verification data. It does not yet include sign-up, CRUD workflows, voice sessions, provider integrations, or a complete dashboard product surface.

## Local setup

### Portal

1. Copy `.env.portal.example` to `apps/portal/.env.local`.
2. Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for the target Supabase project.
3. Install portal dependencies from `apps/portal` with `npm install`.
4. Start the portal from `apps/portal` with `npm run dev`.
   This now stops stale `apps/portal` Next.js processes and clears a broken local `.next` cache before starting, which helps avoid recurring missing-manifest and missing-`_document.js` errors on Windows.
5. Check `http://localhost:3000/api/health`.
6. Sign in at `http://localhost:3000/login` with an existing Supabase Auth user that already has a tenant membership.

### Voice worker

1. Copy `.env.voice.example` to `workers/voice/.env` if you want a local file, or export the variables in your shell.
2. Install worker dependencies from `workers/voice` with `python3.11 -m pip install -e .`.
3. Start the helper server from `workers/voice` with `python3.11 -m app.server`.
4. Start the Pipecat runner from `workers/voice` with `python3.11 -m app.bot`.
5. Check `http://127.0.0.1:8000/config`.
6. Open `http://127.0.0.1:7860/client` for the local browser voice demo.

## Available checks

- Portal lint: run `npm run lint` from `apps/portal`
- Portal type-check: run `npm run typecheck` from `apps/portal`
- Portal build: run `npm run build` from `apps/portal`
- Portal tests: run `npm test` from `apps/portal`
- Voice worker syntax: `python3.11 -m compileall workers/voice/app`
- Voice worker tests: `python3.11 -m unittest discover -s workers/voice/tests -t workers/voice -p "test_*.py"`
