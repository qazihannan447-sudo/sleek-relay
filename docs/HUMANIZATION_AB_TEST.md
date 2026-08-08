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
- Greeting still non-interruptible (startup gates)
- speech_stop_to_stt metrics still populate via Silero

---

## Later phases (not started)

| Phase | Focus |
| --- | --- |
| 5 | Greeting barge-in experiment |
| 6 | Docs / observability cleanup |

---

## Subjective scorecard (copy per run)

```text
Run ID:
Model:
Voice ID:
Config: A (legacy overrides) / B (Phase 1 baseline)
Voice realism:
Sentence rhythm:
Emotional appropriateness:
Pause naturalness:
Responsiveness:
Pronunciation:
Feels like a live receptionist:
Notes:
```
