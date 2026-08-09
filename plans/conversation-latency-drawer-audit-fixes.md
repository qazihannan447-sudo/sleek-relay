# Conversation latency drawer — audit fixes

## Goal

Make conversation-drawer latency labels and status mapping match what the worker actually measures, so operators do not misread stage rows as an additive waterfall or treat incomplete turns as healthy.

## In scope

1. **Honest interval labels** (portal detail rows + worker stage labels)
   - `llmFirstTokenToTtsFirstAudioMs` → “LLM first token → TTS first audio” (not “TTS first audio”)
   - `speechStopToBotSpeakingMs` → “Speech stop → bot speaking” (not “End speech → first audio”)
   - Keep STT / playback / speaking labels accurate
2. **Tool overlap clarity**
   - When a turn has tool time, mark the nested interval and tool row so summing rows is discouraged
   - Optional one-line note in expanded chip details for tool turns
3. **Incomplete metrics status**
   - Worker `map_turn_status`: `incomplete-metrics` → `incomplete` (not `ok`)
   - Portal: allow `incomplete` status; chip summary shows it; exclude incomplete turns from conversation latency KPIs
4. **Conversation latency panel honesty**
   - Short subtitle: pipeline speech-stop → bot started speaking (not mouth-to-ear)

## Out of scope

- True mouth-to-ear / browser playout instrumentation
- Changing timestamp capture points or Silero/Flux preference
- Rebuilding chip↔message linking heuristics
- Usage dashboard chart changes (same underlying KPI meaning; optional follow-up)

## Files

- `plans/conversation-latency-drawer-audit-fixes.md` (this plan)
- `workers/voice/app/call_timeline.py` — status map + stage labels
- `apps/portal/lib/conversations/conversation-timeline.ts` — parse status, detail rows, summary filter, chip copy
- `apps/portal/app/dashboard/conversations/conversation-detail-drawer.tsx` — panel subtitle + tool note
- Tests: `workers/voice/tests/test_call_timeline.py`, `apps/portal/tests/conversation-timeline.test.ts`
- `docs/PROGRESS.md` — brief note after verification

## Verification

- Portal: `npx tsx --test tests/conversation-timeline.test.ts` — pass (10)
- Worker: `python -m unittest tests.test_call_timeline` — pass (9)
- Self-audit against original findings completed in the implementation follow-up

## Status

Re-audited and tightened 2026-08-09: agent Response breakdown is now an exclusive waterfall that sums to Response total; conversation latency KPIs remain speech-stop → bot speaking samples.
