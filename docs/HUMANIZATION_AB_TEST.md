# Cartesia Humanization A/B Test Notes

**Started:** 2026-08-09  
**Source plan:** `docs/CARTESIA_HUMANIZATION_RESEARCH_AUDITED.md`  
**Rule:** Change one behavior class per phase. Do not upgrade `pipecat-ai`.

---

## Phase 0 — Frozen baseline (pre-change)

Recorded from repository + local `.env.voice` (no secrets logged).

| Item | Value |
| --- | --- |
| `pipecat-ai` | `1.7.0` (`pyproject.toml` + `uv.lock`) |
| Effective `CARTESIA_MODEL` | `sonic-3.5` |
| Fallback `CARTESIA_VOICE_ID` | Maya (`cbaf8084-f009-4838-a096-07ee2e6612b1`) |
| Aggregation | `TextAggregationMode.TOKEN` |
| Buffer override | `max_buffer_delay_ms=1000` |
| Generation emotion | Derived from agent tone (first match); default `calm` |
| Generation speed | `0.9` |
| Generation volume | `1.0` |
| Turn strategies | VAD start + `ExternalUserTurnStopStrategy(timeout=0.05)` |
| Silero VAD | Attached on user aggregator (metrics + start) |
| `interruptionEnabled` | Persisted/runtime-parsed; **not enforced** in `bot.py` |
| Opening greeting | Non-interruptible (mic mute + turn gate) |
| LLM | Gemini via `GOOGLE_MODEL`; temperature `0.65` |

Tone → emotion map before Phase 1:

```text
Calm           -> calm
Conversational -> curious
Energetic      -> enthusiastic
Friendly       -> curious
Professional   -> neutral
fallback       -> calm
```

---

## Phase 1 — TTS simplification (Sonic 3.5 only)

**Status:** implemented in code  
**File:** `workers/voice/app/bot.py`  
**Helper:** `build_cartesia_tts_kwargs` / `is_sonic_3_5_model`

### Control (A) — previous Sonic 3.5 behavior

```text
TOKEN
max_buffer_delay_ms = 1000
generation_config.emotion = tone-derived
generation_config.speed = 0.9
generation_config.volume = 1.0
```

### Treatment (B) — new Sonic 3.5 humanization baseline

```text
TOKEN
max_buffer_delay_ms = unset (Cartesia managed buffering)
generation_config = unset (no emotion / speed / volume)
model / voice / language unchanged
```

### Non-Sonic-3.5 models

Legacy override path is preserved (A behavior) so older models are not silently changed.

### Listening comparison checklist

Keep voice ID, prompt, and turn logic identical. Compare only A vs B:

- Sentence rhythm / clause intonation
- Ending cadence
- Emotional appropriateness without forced curiosity
- EOT → first audible audio (median / p95)
- Overall “live receptionist” score (1–5)

Do **not** change voice, prompt, or turn ownership in this comparison.

---

## Phase 2 — Spoken-text prompt cleanup only

**Status:** implemented in code  
**Files:**
- `apps/portal/lib/runtime/builder.ts`
- `workers/voice/app/prompt.py`

### Control (B / Phase 1 winner) — previous prompt contract

```text
Prefer one or two sentences per turn
plain punctuation only (commas, periods, question marks)
soft commas for pauses
manual verbalization of phones/times/emails/symbols
Keep this tone consistent for the whole call
Vary with Got it / Sure / Okay openings
```

### Treatment (C) — Cartesia natural-text contract

```text
Usually 1–3 short spoken sentences
normal punctuation + required terminal . ? !
no soft-comma timing instruction
normal written numbers/dates/times/phones/emails/acronyms
tone = adaptive baseline personality
prefer direct answers over front-loaded acknowledgments
```

### Listening comparison checklist

Keep Phase-1 TTS config and the same voice. Compare only prompt B vs C:

- Natural number / time / email pronunciation
- Sentence endings (period / question / occasional !)
- Less robotic acknowledgment cadence
- Empathy still present when caller is frustrated
- Grounding / tool safety unchanged

Do **not** change voice catalog or turn ownership in this comparison.

---

## Phase 3 — Voice catalog / recommended shortlist

**Status:** implemented in code  
**Files:**
- `supabase/migrations/20260809030000_voice_catalog_recommendations.sql`
- `supabase/scripts/fetch-cartesia-voices.mjs`
- `apps/portal/lib/voices/recommended-voices.ts`
- `apps/portal/lib/voices/load-voice-catalog.ts`
- `apps/portal/app/dashboard/agents/voice-config-drawer.tsx`
- `workers/voice/README.md`
- `supabase/README.md`

### What changed

```text
Recommended for voice agents shortlist (Katie → Caroline)
More voices = advanced/provider catalog (collapsed by default)
description / country / accent columns added
fetch script disables stale previewable-missing voices (no delete)
Maya is no longer documented as the production default
Carson / Daniel not featured yet
```

### Listening comparison checklist

Keep Phase-1 TTS + Phase-2 prompt. Compare recommended stable voices:

```text
Katie
Skylar
Jacqueline
Jameson
Ronald
```

Score realism / rhythm / receptionist fit. Do **not** declare a single default winner without listening.

Suggested env A/B starting point only: Katie (`f786b574-daa5-4673-aa0c-cbe3e8534c02`).

### Apply locally

1. Apply migration `20260809030000_voice_catalog_recommendations.sql`
2. Optionally re-fetch Cartesia metadata to populate description/country/accent
3. Ensure recommended voices have `preview_storage_path` via `sync-voice-previews.mjs`

---

## Phase 4 — Flux turn ownership / interruption

**Status:** implemented in code  
**File:** `workers/voice/app/bot.py`

### Control (previous)

```text
VADUserTurnStartStrategy + ExternalUserTurnStopStrategy(timeout=0.05)
VADUserStopAdapterProcessor in pipeline
interruptionEnabled persisted but not enforced
```

### Treatment (Phase 4)

```text
ExternalUserTurnStrategies() — Flux owns start/stop
SileroVADAnalyzer kept on user aggregator for metrics only
should_interrupt = runtime_config.agent.interruptionEnabled
VADUserStopAdapterProcessor removed from live pipeline
silenceTimeoutSeconds unchanged (safety watchdog)
startup greeting gates unchanged
```

### Listening comparison checklist

Keep Phase 1–3 TTS/prompt/voice. Compare only turn ownership:

- Mid-thought pauses do not cut the caller off
- Barge-in works when interruptionEnabled=true
- Bot speech is not cancelled when interruptionEnabled=false
- speech_stop_to_stt metrics still populate via Silero

---

## Phase 5 — Opening-greeting barge-in

**Status:** implemented in code  
**File:** `workers/voice/app/bot.py`

### Control (previous)

```text
Mic muted until greeting playback finishes
Turn gate blocks all user-turn frames until greeting done + Deepgram ready
Greeting non-interruptible
```

### Treatment (Phase 5)

```text
When interruptionEnabled=true:
  BotStartedSpeaking marks greeting started
  After 0.35s grace, mic unmutes for barge-in listening
  Flux UserStartedSpeaking is forwarded (TTS interrupt via Flux)
  Turn gate stays closed until BotStoppedSpeaking (or 2s fallback)
  Buffered caller transcripts flush on open; greeting-echo text dropped
When interruptionEnabled=false:
  Previous non-interruptible behavior preserved
Greeting text gets terminal punctuation if missing
Greeting still queued once; LLM is told not to re-greet
```

### Listening comparison checklist

- Speak over greeting after ~0.5s: greeting stops, no repeat greeting
- No user transcript of the bot's own greeting (echo filter + late gate open)
- Caller utterance is retained and answered after greeting audio stops
- With interruptionEnabled=false (agent form toggle off), greeting still plays fully

---

## Phase 6 — Docs / observability cleanup

**Status:** implemented in code  
**Files:**
- `apps/portal/lib/agents/behavior-templates.ts`
- `apps/portal/lib/runtime/builder.ts`
- `apps/portal/app/dashboard/agents/agent-form.tsx`
- `workers/voice/app/bot.py` (`log_humanization_session_baseline`)
- `workers/voice/README.md`
- this file

### What changed

```text
{Caller Name} removed from pre-session UI chips
pre-session template helper always clears caller-name token
safe humanization_baseline worker log (no secrets)
voice README rewritten for Daily + portal runtime package
listening playbook + acceptance criteria below
agent form Allow interruptions toggle (no longer force-on)
Phase 5 gate hardened: barge-in waits for BotStoppedSpeaking + echo filter
```

Skipped as optional/out of MVP scope for this pass: a separate
runtime-realistic live-TTS preview path beyond the existing Storage preview
catalog (portal Configure Voice already previews selected voices).

### QA finalization notes

Strict review found and fixed:
1. Greeting barge-in opening LLM turns before TTS stopped (loopback risk)
2. `interruptionEnabled=false` unreachable from the agent form
3. Docs claiming transcription always waited on Deepgram readiness alone

---

## Listening-test playbook (full stack)

Use the same script across comparisons. Change **one dimension at a time**.
Copy the worker `humanization_baseline` log line into the scorecard.

### Script

1. **Basic answer** — “What time are you open tomorrow?”
2. **Phone number** — “What's your phone number?”
3. **Email** — “What's the email address?”
4. **Mid-thought pause** — “I wanted to book for... actually, maybe Friday afternoon.”
5. **Correction** — “Sorry, I meant Friday, not Thursday.”
6. **Frustration** — “I've already explained this twice.”
7. **Barge-in** — Interrupt a 2-sentence answer with “Wait, sorry, I just need the address.”
8. **Greeting barge-in** — Speak over the opening greeting after ~0.5s.
9. **Business acronym** — Ask about a real tenant acronym / brand name.

### Quantitative targets (audit, not provider guarantees)

```text
No-tool EOT -> audible first bot audio:
  median <= 1.2 s
  p95 <= 1.8 s

Barge-in:
  no noticeable stale response continuation
  latest user intent becomes next LLM turn

Premature response rate:
  < 2% of normal test turns

Greeting barge-in:
  no repeated greeting
  no loopback user transcript of the bot greeting
```

### Subjective scorecard (copy per run)

```text
Run ID:
humanization_baseline log:
Model:
Voice ID:
Config notes:
Voice realism (1-5):
Sentence rhythm (1-5):
Emotional appropriateness (1-5):
Pause naturalness (1-5):
Responsiveness (1-5):
Interruption naturalness (1-5):
Pronunciation (1-5):
Feels like a live receptionist (1-5):
Notes:
```
