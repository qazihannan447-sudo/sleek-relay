# Sleek Relay Validation Demo Foundation

This repository currently contains only the initial project foundation for the browser-based validation demo:

- `apps/portal`: minimal Next.js portal shell with a health endpoint
- `workers/voice`: minimal Python voice worker with a health endpoint
- `supabase/`: placeholder project folder for future migrations and local Supabase assets

No product features, tenant logic, database tables, authentication flows, or provider integrations have been added yet.

## Local setup

### Portal

1. Copy `.env.portal.example` to `apps/portal/.env.local`.
2. Install portal dependencies from `apps/portal` with `npm install`.
3. Start the portal from `apps/portal` with `npm run dev`.
4. Check `http://localhost:3000/api/health`.

### Voice worker

1. Copy `.env.voice.example` to `workers/voice/.env` if you want a local file, or export the variables in your shell.
2. Start the server from `workers/voice` with `python3.11 -m app.server`.
3. Check `http://127.0.0.1:8000/health`.

## Available checks

- Portal lint: run `npm run lint` from `apps/portal`
- Portal build: run `npm run build` from `apps/portal`
- Portal tests: run `npm test` from `apps/portal`
- Voice worker syntax: `python3.11 -m compileall workers/voice/app`
- Voice worker tests: `python3.11 -m unittest discover -s workers/voice/tests -t workers/voice -p "test_*.py"`
