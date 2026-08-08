# Cartesia Sonic + Pipecat Humanization Audit — Audited v2

**Project:** Sleek Relay voice agent  
**Original audit date:** 2026-08-09  
**Second-pass audit:** 2026-08-09  
**Scope:** Cartesia Sonic TTS, Pipecat voice orchestration, Deepgram Flux turn-taking, Gemini spoken-response prompting, voice catalog/selection, browser playback/startup  
**Primary objective:** Make the agent feel like a natural live receptionist rather than a chatbot whose text happens to be read aloud.

---


## 0. Second-pass audit corrections

This version supersedes the first report. Use **this file** for Codex implementation.

The second pass re-checked the recommendations against the supplied code, the exact pinned dependency (`pipecat-ai==1.7.0` in `uv.lock`), current Cartesia documentation, current Pipecat documentation, and the generated 418-row voice migration.

### Critical corrections made

1. **Sonic 3.5 speed/volume correction.** The first report incorrectly said Sonic 3.5 speed and volume controls were disabled. Current Cartesia and Pipecat documentation says the controls remain available on Sonic 3.5. The correct recommendation is still to **omit the forced `speed=0.9` and `volume=1.0` for the humanization baseline**, but because Sonic 3.5 generally performs better when natural pacing comes from the transcript/context, not because those parameters are unsupported.

2. **Stable voice shortlist correction.** The current Cartesia "Choosing a Voice" page lists:
   - Male: **Archie, Ronald, Carson, Jameson, Daniel**
   - Female: **Skylar, Gemma, Katie, Jacqueline, Cathy, Caroline**

   Brooke is present in the supplied catalog, but is **not** on Cartesia's current stable production-agent shortlist.

3. **Turn-management correction.** The original report overstated `VADUserStopAdapterProcessor` as an active competing stop authority. In the supplied pipeline it sits **before** `user_aggregator`, while Pipecat 1.x configures the supplied `vad_analyzer` **inside the aggregator**. The safer finding is:
   - your explicit `UserTurnStrategies(...)` overrides Flux's recommended automatic external turn strategy;
   - Flux already emits its own user speaking frames;
   - VAD start can separately drive user-turn start/interruption;
   - the adapter should not be relied on to bridge aggregator-generated VAD-stop frames in its current position.

4. **Silero must be preserved for metrics unless metrics are refactored.** Your latency tracker deliberately prefers `VADUserStoppedSpeakingFrame` as physical speech-stop timing. Removing Silero while keeping the current metrics code can make speech-stop/STT intervals disappear or become misleading. The recommended baseline is **Flux owns conversational turns; Silero remains observational for timing**.

5. **Interruption wiring needs both layers considered.** `interruptionEnabled` is not currently enforced. Do not only set Deepgram `should_interrupt`; if any VAD-based start strategy remains, its `enable_interruptions` behavior must follow the same runtime setting too. Prefer one intentional interruption authority.

6. **The greeting is currently non-interruptible.** `StartupMicMuteProcessor` drops microphone audio before STT until greeting playback completes, and `StartupTurnGateProcessor` blocks user-turn frames until the greeting is done. This is a real humanization limitation and must be treated as a separate controlled experiment, not accidentally changed while tuning Cartesia.

7. **Prompt punctuation needed another pass.** The prompt asks for contractions but then says punctuation should be only commas, periods, and question marks. It also bans exclamation marks and encourages "soft commas" as pause controls. Current Cartesia guidance instead recommends **normal punctuation** and terminal `.`, `?`, or `!`. The prompt should not micromanage punctuation for prosody.

8. **Model version must be verified before model-specific changes.** The deployed `CARTESIA_MODEL` was not provided. The repository recommends `sonic-3.5`, but Codex must not assume production is definitely on it. For repeatable A/B tests, prefer a dated Sonic 3.5 snapshot such as `sonic-3.5-2026-05-04` in the evaluation environment, or record the exact alias-resolved model used.

9. **Do not upgrade Pipecat during this task.** The worker is pinned to `pipecat-ai==1.7.0`. Fix the application against that version. Dependency upgrades would add another uncontrolled variable.

10. **The implementation must be phased.** The first report correctly warned against changing everything at once, but its Codex brief still grouped TTS, turn-taking, prompt, and catalog work together. This v2 separates them into explicit phases and acceptance gates.

---

## 1. Executive conclusion

The current system does **not** need a TTS-provider replacement as its first move.

The architecture is already capable of natural conversational speech:

`Browser/Daily -> Deepgram Flux -> Gemini -> Cartesia Sonic -> Daily/browser`

The main humanization problems are configuration and product-layer mismatches around that stack:

1. **Cartesia is being given less prosodic context than its current managed-buffering guidance prefers.** The worker uses token streaming but explicitly forces `max_buffer_delay_ms=1000`. Cartesia documents a 3000 ms managed buffering default and says changing it is generally not recommended; Pipecat intentionally leaves it unset in TOKEN mode so Cartesia's managed buffering applies.
2. **A static emotion is forced on every TTS turn.** `Friendly` and `Conversational` both become `curious`; `Calm` becomes `calm`; `Professional` becomes `neutral`; the first selected tone wins. Cartesia says Sonic already interprets emotional subtext from the transcript and warns that emotion guidance works poorly when it does not match the words.
3. **The LLM is instructed to over-preprocess speech for Sonic 3.5.** The prompt tells Gemini to manually verbalize times, phone numbers and symbols. Current Cartesia guidance says Sonic 3.5 handles common numbers, dates, times, phone numbers, emails, acronyms and symbols and recommends natural written text with normal punctuation.
4. **The default voice strategy is pointed toward expressive/emotive voices while Cartesia recommends stable realistic voices for production agents.** The README defaults to Maya. Current Cartesia stable-agent picks include Archie, Ronald, Carson, Jameson, Daniel, Skylar, Gemma, Katie, Jacqueline, Cathy and Caroline; the Sonic 3.5 model page specifically highlights Katie, Skylar, Jameson, Gemma and Archie.
5. **The voice catalog is too broad and weakly curated for an agent product.** The generated migration contains 418 English voices. Only 145 rows contain preview URLs, while the generated migration does not set `enabled=false` for the other 273. The newer fetch script does, so repository history is inconsistent.
6. **Turn ownership is customized away from Flux's recommended model.** The worker explicitly uses VAD for turn start plus an external stop strategy, overriding Flux's recommended external turn strategies. Flux itself emits speaking/turn frames. This needs deliberate ownership, especially for interruption behavior.
7. **`interruptionEnabled` is persisted and sent to the worker but is not enforced in `bot.py`.** Deepgram Flux exposes `should_interrupt`, and VAD start strategies also have interruption behavior. Both must be coherent with the runtime setting if the hybrid remains.
8. **The portal lets users choose multiple tones, while Cartesia receives only the first recognized tone.** The LLM is told to blend all selected tones, but TTS only sees one static emotion.
9. **The opening greeting cannot currently be interrupted.** Microphone audio and user-turn frames are intentionally gated until the greeting finishes, which can feel unlike a live receptionist if callers speak early.
10. **The spoken-output prompt contains punctuation contradictions.** It asks for contractions but restricts punctuation to commas/periods/question marks, bans `!`, and encourages commas as pause controls even though Cartesia recommends natural punctuation.
11. **The exact deployed Cartesia model is still an evidence gap.** Any Sonic-3.5-specific implementation must first verify or safely branch on `config.cartesia_model`.

The first remediation should be a **controlled simplification**, not more knobs.

---

## 2. Evidence boundary

This audit covered the supplied source code and current public documentation/research.

### Code reviewed

Worker:

- `workers/voice/app/bot.py`
- `workers/voice/app/config.py`
- `workers/voice/app/runtime_config.py`
- `workers/voice/app/prompt.py`
- `workers/voice/app/tts_markup.py`
- `workers/voice/pyproject.toml`
- `workers/voice/uv.lock`
- `workers/voice/README.md`

Portal runtime/prompt:

- `apps/portal/lib/runtime/builder.ts`
- `apps/portal/lib/runtime/schema.ts`
- `apps/portal/lib/voice/runtime-config.ts`
- `apps/portal/app/api/voice/runtime-config/route.ts`
- `apps/portal/lib/agents/tones.ts`
- `apps/portal/lib/agents/behavior-templates.ts`
- `apps/portal/lib/agents/schema.ts`
- `apps/portal/lib/agents/validation.ts`

Voice catalog/UI:

- `apps/portal/lib/voices/load-voice-catalog.ts`
- `apps/portal/lib/voices/load-voice-preview.ts`
- `apps/portal/lib/voices/cartesia-preview.ts`
- `apps/portal/app/dashboard/agents/voice-config-drawer.tsx`
- `supabase/migrations/20260808150000_add_voices_catalog.sql`
- `supabase/migrations/20260808150500_seed_cartesia_voices.sql`
- `supabase/scripts/fetch-cartesia-voices.mjs`

Conversation/browser:

- `apps/portal/lib/voice/browser-test.ts`
- `apps/portal/lib/voice/session.ts`
- `apps/portal/lib/voice/warm-connect.ts`
- `apps/portal/app/dashboard/agents/[agentId]/test/voice-test-panel.tsx`

Database:

- `supabase/migrations/20260806083745_add_agent_runtime_settings.sql`
- supplied demo seed data

### Evidence not available

The following were not provided:

- the actual deployed `CARTESIA_MODEL`
- the actual deployed fallback `CARTESIA_VOICE_ID`
- the exact selected voice/tone for the specific bad-sounding agent
- a bad-call audio recording

Therefore this report distinguishes **confirmed code/configuration findings** from **A/B experiments that still require listening tests**. In particular, statements about Sonic 3.5 are conditional on the deployed model being Sonic 3.5, which the repository README recommends but the environment ultimately controls.

---

## 3. Current architecture and control flow

### Portal configuration path

1. Persisted agent/runtime schema carries:
   - `voice_id`
   - `tone`
   - `interruption_enabled`
   - `silence_timeout_seconds`
   - greeting
   - special instructions
   - fallback message

   The supplied validation path explicitly writes voice/tone/interruption fields; the database migration establishes the persisted defaults for silence timeout and maximum duration. Do not assume every runtime field is editable in the same UI surface without checking its action/form path.

2. `runtime/builder.ts` composes:
   - spoken-style system prompt
   - business facts
   - approved knowledge
   - tone description
   - workflow/tool rules
   - runtime agent configuration

3. `lib/voice/runtime-config.ts` validates the voice-session token and returns the runtime package without materially changing the speech fields.

4. Python `runtime_config.py` parses the package and supplies it to the worker.

### Worker path

The important live path in `bot.py` is effectively:

```text
Daily/browser audio
  -> Deepgram Flux STT
  -> turn processors / user aggregator
  -> Gemini LLM
  -> Cartesia TTS
  -> Daily output
  -> browser audio element
```

### Current TTS construction

The worker currently configures Cartesia with:

```text
TextAggregationMode.TOKEN
max_buffer_delay_ms = 1000
model = CARTESIA_MODEL
voice = runtime agent voiceId
language = runtime TTS language

generation_config:
  emotion = derived from agent tone
  speed = 0.9
  volume = 1.0
```

### Current tone mapping

```text
Calm           -> calm
Conversational -> curious
Energetic      -> enthusiastic
Friendly       -> curious
Professional   -> neutral
fallback       -> calm
```

For multiple tones, `resolve_cartesia_emotion_for_tone()` returns the **first recognized tone**.

---

# 4. Findings by priority

## P0-1 — Stop overriding Cartesia managed token buffering

**Status:** CHANGE  
**File:** `workers/voice/app/bot.py`

Current:

```python
tts = CartesiaTTSService(
    ...
    text_aggregation_mode=TextAggregationMode.TOKEN,
    max_buffer_delay_ms=1000,
    ...
)
```

### Why this matters

Cartesia's continuation/buffering documentation says streamed tiny text chunks can produce choppy audio or unnatural prosody because the model lacks linguistic context. `max_buffer_delay_ms` gives the model time to collect enough text context before committing to audio.

Current Cartesia documentation states:

- supported range: 0–5000 ms
- documented default: 3000 ms
- the model can start before the maximum once it believes it has enough context
- the setting is especially relevant to token-streamed LLM output

Pipecat also changed its Cartesia integration specifically so that in `TOKEN` mode an unset buffer lets Cartesia's managed buffering apply.

Your code explicitly caps that managed window at **1000 ms**.

This is a plausible direct cause of speech that has good timbre but bad sentence-level rhythm: emphasis chosen too early, awkward intonation across clause boundaries, and sentence endings that feel generated word-by-word.

### Recommended first experiment

**Remove the explicit `max_buffer_delay_ms` argument.**

Do not replace it with `3000` initially. Let the Pipecat/Cartesia integration use its intended token-mode behavior.

Target shape:

```python
tts = cartesia_tts_service_cls(
    api_key=config.cartesia_api_key,
    text_aggregation_mode=text_aggregation_mode_cls.TOKEN,
    settings=...
)
```

### A/B test

- A: current `1000`
- B: argument omitted
- C only if needed: explicit `1500–2000`

Measure both perceived naturalness and EOT-to-first-audio. Do not optimize buffer purely for smallest TTFB.

**Expected impact:** VERY HIGH

---

## P0-2 — Remove fixed speed and volume from the Sonic 3.5 humanization baseline

**Status:** CHANGE / A-B TEST  
**File:** `workers/voice/app/bot.py`

Current constants:

```python
CARTESIA_DEFAULT_SPEED = 0.9
CARTESIA_DEFAULT_VOLUME = 1.0
```

and every generation receives them.

### Corrected documentation finding

Current Cartesia documentation says speed and volume controls **are available** on Sonic 3.5. Pipecat also documents `GenerationConfig.speed` and `GenerationConfig.volume` as applicable to Sonic 3 and Sonic 3.5.

However, both Cartesia and Pipecat now recommend treating these controls as refinements rather than defaults. Pipecat specifically notes that Sonic 3.5 has substantially improved natural expressiveness and that most users will get better results by relying on model + transcript context instead of manually tuning emotion, speed or volume.

So the issue with `speed=0.9` is **not that it is unsupported**. The issue is that the worker globally slows every utterance before you have established that this makes the selected voice more human.

`volume=1.0` is effectively the documented neutral/default value and adds no useful humanization signal.

### Recommendation

First verify `config.cartesia_model`.

For a Sonic 3.5 baseline:

- omit `speed`
- omit `volume`
- compare against the current `speed=0.9`
- only restore a speed override if listening tests show a specific selected voice consistently benefits from it

If production is actually on another model, preserve existing behavior until that model is separately evaluated. Do not silently make a model-specific assumption.

**Expected impact:** MEDIUM directly, HIGH for configuration clarity and experiment quality.

## P0-3 — Stop forcing one static emotion across the entire call

**Status:** CHANGE  
**Files:**

- `workers/voice/app/bot.py`
- `apps/portal/lib/agents/tones.ts`
- `apps/portal/lib/runtime/builder.ts`

Current behavior combines two separate concepts:

1. **Persona:** Friendly / Calm / Professional / etc.
2. **Per-utterance emotion:** curious / calm / neutral / enthusiastic.

Those are not the same thing.

A professional receptionist can sound:

- warm when greeting
- neutral while reading hours
- apologetic after a mistake
- reassuring when a caller is worried
- slightly upbeat when confirming a solution

The current worker gives every utterance one static emotion based on the configured tone.

Worse:

```text
Friendly       -> curious
Conversational -> curious
```

A caller asking about closing time does not inherently require "curious" delivery. A cancellation confirmation does not require "curious" delivery. A frustrated caller definitely may not.

Cartesia's documentation says:

- by default Sonic interprets emotional subtext from the transcript
- emotion controls are guidance
- emotion guidance works best when it is consistent with the transcript
- mismatched emotion/text may not work well

### Recommendation: baseline configuration

For the first humanization pass, **omit `generation_config.emotion` entirely** and allow Sonic to infer expression from the actual text.

Tone should remain an **LLM/persona instruction**, not a permanent TTS emotion.

### Later experiment

If explicit emotion becomes necessary, make it **contextual**, not agent-global.

Examples:

```text
normal business answer -> no override
apology                -> apologetic / sympathetic
celebratory outcome    -> content / happy
high-energy sales case -> enthusiastic
```

Do not implement this until the no-override baseline has been listening-tested.

**Expected impact:** VERY HIGH

---

## P0-4 — Let Sonic 3.5 normalize numbers and common speech patterns itself

**Status:** CHANGE  
**Files:**

- `apps/portal/lib/runtime/builder.ts`
- `workers/voice/app/prompt.py`

Current prompt says:

> Speak numbers the way a person would on a call: phone numbers digit by digit with natural grouping; times like "two thirty" or "nine a.m."; street numbers as words when short; never read symbols aloud...

This made more sense with weaker normalization stacks.

Current Sonic 3.5 guidance says to pass natural, well-punctuated text and specifically says it natively handles common:

- large numbers
- phone numbers
- emails
- dates
- times
- acronyms/initialisms
- `@`
- parentheses

Cartesia also warns that heavy preprocessing can hurt output quality.

### Replace the current rule with

```text
Write numbers, dates, times, phone numbers, email addresses, and common
acronyms in normal written form. Do not manually spell or verbalize them
unless the caller explicitly needs a character-by-character confirmation.
```

Then reserve `<spell>` for:

- confirmation codes
- order IDs
- serial numbers
- identifiers that genuinely need character-by-character speech

### Example

Prefer LLM output:

```text
We're open from 9:00 AM to 5:30 PM.
You can call us at (415) 555-1212.
The email is support@example.com.
```

over prompt-forced output:

```text
We're open from nine a.m. to five thirty p.m.
You can call us at four one five...
The email is support at example dot com.
```

Let the TTS model perform the acoustic normalization.

**Expected impact:** HIGH

---

## P0-5 — Replace the "Maya by default" strategy with a curated production-agent shortlist

**Status:** CHANGE  
**Files:**

- `workers/voice/README.md`
- voice catalog seed/sync path
- voice selection UI

Your README says:

> Default: Maya.

Maya is an emotive voice and may work well for expressive experiences, but current Cartesia guidance separates **stable production-agent voices** from **emotive character voices**.

### Current Cartesia stable production-agent recommendations

Cartesia's current "Choosing a Voice" page lists:

**Male**
- Archie
- Ronald
- Carson
- Jameson
- Daniel

**Female**
- Skylar
- Gemma
- Katie
- Jacqueline
- Cathy
- Caroline

The Sonic 3.5 model page specifically highlights:

- Katie
- Skylar
- Jameson
- Gemma
- Archie

### Supplied-catalog availability

The supplied generated migration includes previewable rows for:

```text
Skylar
db6b0ed5-d5d3-463d-ae85-518a07d3c2b4

Gemma
62ae83ad-4f6a-430b-af41-a9bede9286ca

Archie
ef191366-f52f-447a-a398-ed8c0f2943a1

Katie
f786b574-daa5-4673-aa0c-cbe3e8534c02

Jacqueline
9626c31c-bec5-4cca-baa8-f8ba9e84c8bc

Ronald
5ee9feff-1265-424a-9d7f-8e4d431a12c7

Caroline
f9836c6e-a0bd-460e-9d3c-f7299fa60f94

Cathy
e8e5fffb-252c-436d-b842-8879b84445b6

Jameson
a5136bf9-224c-4d76-b823-52bd5efcffcc
```

The supplied snapshot also contains several Carson variants, including neutral/friendly and emotion-specific variants. Do not choose a Carson ID purely by name; audition the current live provider metadata and avoid emotion-specific variants for the baseline.

Daniel is on Cartesia's stable list but has no preview URL in the supplied generated migration, so under the newer "preview required" catalog policy it should not be featured until previewability is resolved.

Brooke exists in the supplied catalog, but it is **not** on Cartesia's current stable production-agent shortlist.

### Recommendation

Use a first production A/B set such as:

1. **Katie**
2. **Skylar**
3. **Jacqueline**
4. **Jameson**
5. **Ronald**
6. **Gemma / Archie** depending desired accent/gender

Then compare the winning stable voice against Maya as an expressive alternative.

Maya/Tessa/etc. can remain available under something like:

```text
Expressive / Character voices
```

but should not be the default receptionist recommendation solely because they respond strongly to emotion controls.

**Expected impact:** VERY HIGH

## P0-6 — Curate the voice catalog instead of exposing hundreds of unrelated voices

**Status:** CHANGE  
**Files:**

- `supabase/scripts/fetch-cartesia-voices.mjs`
- `supabase/migrations/20260808150500_seed_cartesia_voices.sql`
- `apps/portal/lib/voices/load-voice-catalog.ts`
- `voice-config-drawer.tsx`

### Supplied catalog audit

The generated SQL contains:

```text
418 English voices
145 with preview_file_url
273 without preview_file_url
```

That means roughly **65% have no preview URL in this migration**.

It also includes voice categories visible in names such as:

- narrator
- storyteller
- performer
- announcer
- sportscaster
- instructor
- companion
- character-like emotional variants

At least 16 names contain "Narrator".

That is not a useful production-agent picker. It is a provider dump.

### Repository inconsistency

The current `fetch-cartesia-voices.mjs` has been improved so that it generates:

```text
enabled = hasPreview
```

and comments that voices without previews should be disabled.

However, the supplied generated migration `20260808150500_seed_cartesia_voices.sql` does **not** include the `enabled` column in its insert.

Since `public.voices.enabled` defaults true, a database built from that migration can leave all those rows enabled.

The migration and generator no longer represent the same behavior.

### More metadata is also being discarded

Cartesia's current `/voices` response includes useful metadata such as:

- `description`
- `country`
- language
- gender
- name

Your script currently keeps:

- ID
- name
- gender
- language
- preview URL
- tagline, which is null throughout the supplied generated catalog

The UI therefore loses provider descriptions such as:

> Approachable American female ideal for customer care and support.

That information is far more useful than just gender.

### Recommendation

Do not display the complete provider catalog by default.

Create a curated "Recommended for voice agents" tier.

Suggested schema/application metadata:

```text
recommended_for_agent
voice_category
country/accent
provider_description
featured_rank
```

At minimum, hard-code or seed a small reviewed shortlist while retaining "More voices" behind an advanced section.

Also generate a **corrective migration** from the current fetch script so rows lacking previews are disabled consistently.

**Expected impact:** HIGH

---

## P1-1 — Use a single baseline tone, not multiple simultaneous tones

**Status:** CHANGE  
**Files:**

- `voice-config-drawer.tsx`
- `tones.ts`
- `builder.ts`
- `bot.py`

The UI says:

> Pick one or more delivery tones

The LLM prompt then says:

> Blend these tones naturally

But Cartesia's worker code loops through the comma-separated tones and returns the **first** recognized one.

Example:

```text
UI selection: Friendly, Professional

LLM:
  blend Friendly + Professional

TTS:
  Friendly -> curious
  Professional never reaches Cartesia
```

That can create a text/delivery mismatch.

### Recommendation

For now:

- allow **one baseline persona tone**
- keep the five labels if desired
- stop translating the persona label into a permanent Cartesia emotion

Better UI concept:

```text
Conversation style
[ Friendly ]
[ Professional ]
[ Conversational ]
[ Calm ]
[ Energetic ]
```

single-select.

If multi-tone composition is strategically important later, model it as a true style profile rather than pretending five buttons map cleanly to one TTS emotion.

**Expected impact:** MEDIUM-HIGH

---

## P1-2 — Make tone adaptive instead of "consistent for the whole call"

**Status:** CHANGE  
**File:** `apps/portal/lib/runtime/builder.ts`

Current prompt:

> Keep this tone consistent for the whole call.

This is a good instruction for brand consistency but a bad literal instruction for human emotion.

Replace it with something like:

```text
Use this as your baseline personality. Keep the overall character consistent,
but adapt the moment-to-moment delivery to the caller. Be reassuring when they
are concerned, concise when they are in a hurry, and briefly apologetic when
you or the business caused confusion.
```

This preserves persona without flattening emotional dynamics.

**Expected impact:** HIGH

---

## P1-3 — Make Deepgram Flux the explicit turn owner while preserving Silero for metrics

**Status:** CHANGE / TEST CAREFULLY  
**File:** `workers/voice/app/bot.py`

Current code explicitly supplies:

```text
Start:
  VADUserTurnStartStrategy

Stop:
  ExternalUserTurnStopStrategy(timeout=0.05)

VAD analyzer:
  SileroVADAnalyzer(...)
```

Pipecat's current Deepgram Flux documentation states that Flux:

- provides native `StartOfTurn` / `EndOfTurn`
- broadcasts `UserStartedSpeakingFrame` / `UserStoppedSpeakingFrame`
- recommends `ExternalUserTurnStrategies`
- can operate without VAD for core turn detection

Pipecat 1.x also states that when an STT service recommends turn strategies through service metadata, an explicitly supplied `user_turn_strategies` still wins. Your custom strategy therefore intentionally overrides Flux's recommended automatic external-turn configuration.

### Important correction about `VADUserStopAdapterProcessor`

The adapter is currently placed **before** `user_aggregator` in the pipeline.

The supplied Silero analyzer is configured **on the user aggregator** through `LLMUserAggregatorParams(vad_analyzer=...)`.

Therefore VAD signals produced by that analyzer do not naturally flow backward through the upstream adapter. Do not assume the adapter is successfully converting aggregator-generated VAD stop signals into the Flux external stop signal.

With the supplied transport configuration, no transport-level VAD analyzer is installed, and Flux emits `UserStoppedSpeakingFrame`, not `VADUserStoppedSpeakingFrame`.

Treat this processor as **suspect/dead unless a test proves it receives the intended frames**.

### Recommended baseline

Prefer one of these two equivalent ownership models:

**Option A, framework-managed (preferred if verified in the pinned Pipecat 1.7.0):**

```text
Do not pass a custom user_turn_strategies value.
Allow Deepgram Flux service metadata to recommend ExternalUserTurnStrategies.
Keep vad_analyzer=SileroVADAnalyzer(...) for observation/metrics.
```

**Option B, explicit:**

```python
user_turn_strategies = ExternalUserTurnStrategies()
```

Again, keep Silero attached as an analyzer for metrics, not as the conversational turn authority.

### Why Silero should remain for now

The current latency tracker treats `VADUserStoppedSpeakingFrame` as the preferred physical speech-stop timestamp.

If Silero is removed without refactoring metrics:

- `speech_stop_to_stt` may become unavailable
- a late Flux `UserStoppedSpeakingFrame` can be ignored after the final transcript by the current tracker logic
- before/after latency comparisons become less trustworthy

So this audit **does not recommend removing Silero in the same change**.

### About the current `0.05` second external-stop delay

`ExternalUserTurnStopStrategy.timeout` defaults to `0.5` seconds and exists to handle consecutive/slightly delayed transcription.

If you stop supplying the custom strategy and let Flux's recommended path own turns, do not manually tune this value in the first pass.

If you intentionally retain a custom external-stop strategy, A/B values such as:

```text
0.25
0.35
0.50
```

against final-transcript completeness and perceived pause naturalness.

Do not optimize this number in isolation.

**Expected impact:** HIGH

## P1-4 — Actually enforce `interruptionEnabled` and avoid split interruption ownership

**Status:** FIX  
**Files:**

- `workers/voice/app/bot.py`
- runtime setting already exists through portal/database

The setting is persisted, placed in the runtime package, and parsed by Python, but `bot.py` does not reference `runtime_config.agent.interruptionEnabled`.

Deepgram Flux exposes:

```python
should_interrupt: bool
```

Pipecat user-turn start strategies also expose `enable_interruptions`.

### Recommendation

If Flux becomes the turn owner:

```python
stt = DeepgramFluxSTTService(
    ...,
    should_interrupt=runtime_config.agent.interruptionEnabled,
    settings=...,
)
```

Then use the Flux-recommended external turn strategy path.

If a VAD-based start strategy is deliberately retained, its interruption behavior must use the same setting, e.g. conceptually:

```python
VADUserTurnStartStrategy(
    enable_interruptions=runtime_config.agent.interruptionEnabled,
)
```

Verify the exact constructor/signature against the pinned `pipecat-ai==1.7.0` before coding.

### Guardrail

Do **not** leave one layer interruptible while the other is disabled.

The product meaning should be:

```text
interruptionEnabled = true
  -> caller can barge in during normal assistant speech

interruptionEnabled = false
  -> normal user speech does not cancel current assistant speech
```

Opening-greeting interruption is a separate issue because the startup mic/turn gates currently prevent the caller's speech from reaching normal turn handling at all.

**Expected impact:** HIGH for correctness and conversational predictability.

## P1-5 — Rename/rethink the 8 second "silence timeout"

**Status:** CHANGE semantics/UI  
**Files:**

- agent runtime settings migration
- agent schema/UI
- worker aggregator configuration

Persisted default:

```text
silence_timeout_seconds = 8
```

The worker passes this to:

```python
LLMUserAggregatorParams(
    user_turn_stop_timeout=...
)
```

Pipecat documents `user_turn_stop_timeout` as a **safety-net maximum** if no stop strategy triggers. It is not the normal between-sentence silence threshold.

So "silence timeout" is a misleading product name.

As long as Flux/external stop works, the agent should not normally wait eight seconds. But if turn-stop signaling fails, eight seconds becomes the fallback and feels catastrophic on a live call.

### Recommendation

Rename it conceptually to:

```text
Turn detection safety timeout
```

or stop exposing it to normal users.

Do not change the database default in the same humanization baseline unless tests show the watchdog is actually firing. Pipecat's framework default is 5 s, but your persisted 8 s value is a safety backstop, not normal conversational silence.

First rename/document the semantics and instrument whether the timeout ever fires. Do not use this value to tune ordinary conversational pauses. Tune the actual turn strategy instead.

**Expected impact:** MEDIUM

---

## P1-6 — Keep the warm-connect architecture

**Status:** KEEP  
**Files:**

- `warm-connect.ts`
- `voice-test-panel.tsx`
- browser startup path

This part is directionally good.

The system:

- wakes the hosted runner
- prebuilds the portal runtime package
- calls `/start`
- prejoins Daily muted
- waits for BotReady
- only enables mic and arms greeting after user Connect

That hides cold infrastructure time from the conversational interaction.

The opening greeting is gated until:

- pipeline started
- client connected
- RTVI ready
- session armed

This is exactly the right class of optimization because a beautiful voice with a 3–5 second dead pause still feels broken.

Do not dismantle the prejoin approach while fixing TTS humanization.

**Expected impact:** already positive.

---

## P1-7 — Keep TOKEN streaming, but let it have context

**Status:** KEEP + MODIFY BUFFER  
**File:** `bot.py`

Do not respond to the current prosody problem by immediately switching to full-sentence TTS aggregation.

Sentence aggregation can improve context but can also add noticeable latency because the TTS request waits for a sentence boundary.

Cartesia supports WebSocket continuations specifically so token-streamed LLM input can preserve context/prosody.

First test:

```text
TOKEN + managed Cartesia buffering
```

before:

```text
SENTENCE aggregation
```

Sentence mode can remain an experiment if managed token buffering still sounds fragmented.

---

## P1-8 — Do not switch LLM providers as the first fix

**Status:** KEEP for baseline  
**File:** `bot.py`

Current LLM temperature:

```text
0.65
```

The prompt already does several useful things:

- avoids "Certainly" / "Absolutely"
- asks for contractions
- keeps answers short
- avoids markdown
- asks one question at a time
- varies opening structure
- encourages brief empathy
- prevents fake tool success

These are good voice-agent rules.

There may later be value in A/B testing another fast LLM, but changing LLM + TTS + voices + turn detection simultaneously would destroy your ability to learn what fixed the problem.

Keep Gemini during the first controlled TTS/turn experiments.

---


## P1-9 — The opening greeting is currently non-interruptible

**Status:** EXPERIMENT AFTER BASELINE  
**Files:**

- `workers/voice/app/bot.py`
- `apps/portal/app/dashboard/agents/[agentId]/test/voice-test-panel.tsx`

Two startup mechanisms intentionally block caller speech until the greeting finishes:

1. `StartupMicMuteProcessor` drops `InputAudioRawFrame` before STT until greeting playback is done.
2. `StartupTurnGateProcessor` blocks transcription/user-turn frames until both greeting playback is done and Deepgram is ready.

This protects against loopback/repeated greetings, but it means a caller cannot naturally say:

```text
"Hi, sorry, I just need the address..."
```

while the greeting is still playing.

### Recommendation

Do **not** change this in the same commit as the initial Cartesia tuning.

First make the greeting short and natural.

Then run a separate greeting-barge-in experiment. Supporting it correctly requires changing **both** the mic mute and turn gate behavior while proving that:

- the bot does not transcribe its own greeting
- the greeting can be cancelled cleanly
- the caller's interrupted utterance is retained
- the LLM does not repeat the greeting
- startup transcript/latency metrics remain correct

Until that is solved, treat greeting barge-in as an explicit known limitation.

**Expected impact:** HIGH for first-impression naturalness, but higher regression risk.

---

## P1-10 — Fix punctuation rules so the transcript helps Sonic instead of constraining it

**Status:** CHANGE  
**Files:**

- `apps/portal/lib/runtime/builder.ts`
- `workers/voice/app/prompt.py`

Current rules contain three problems:

1. They request contractions (`I'm`, `you're`, etc.) while saying the only punctuation should be commas, periods and question marks. Apostrophes are therefore implicitly contradicted.
2. They ban exclamation marks entirely, even though Cartesia recommends complete phrases ending in `.`, `?`, or `!`.
3. They tell the LLM to use "soft commas" as pause controls, which encourages punctuation to be used as TTS markup instead of normal writing.

### Replace with a simpler output contract

```text
Use normal written punctuation and capitalization. Contractions are encouraged.
Every spoken turn must end with normal terminal punctuation: ., ?, or !.
Use punctuation for the meaning of the sentence, not as manual TTS timing control.
Do not use markdown, bullets, numbered lists, raw JSON, emoji, or decorative symbols.
Use exclamation marks only when the meaning genuinely calls for one.
```

This is closer to Cartesia's own voice-agent prompt guidance.

**Expected impact:** MEDIUM-HIGH

---

## P1-11 — Verify and pin the TTS model for repeatable A/B evaluation

**Status:** PRECONDITION / KEEP VERSION CONTROLLED  
**Files:**

- deployment environment
- `.env.voice.example` / README documentation
- safe runtime diagnostics

The deployed `CARTESIA_MODEL` value was not provided.

The repository README recommends:

```text
CARTESIA_MODEL=sonic-3.5
```

Cartesia documents `sonic-3.5` as an alias that follows the most recent stable snapshot. It also provides the dated stable snapshot:

```text
sonic-3.5-2026-05-04
```

### Recommendation

Before listening tests:

1. record/log the actual model value used by the session
2. do not upgrade Pipecat or Cartesia API version during the experiment
3. for controlled evaluation, consider pinning the **test/evaluation environment** to the dated Sonic 3.5 snapshot
4. only move back to the rolling `sonic-3.5` alias after the selected configuration is validated

Do not silently change the production model as part of an unrelated refactor.

**Expected impact:** HIGH for trustworthy experiments.

---

## P2-1 — `{Caller Name}` is not actually available at runtime-package composition time

**Status:** FIX UX / TEMPLATE SEMANTICS  
**Files:**

- `apps/portal/lib/agents/behavior-templates.ts`
- `apps/portal/lib/runtime/builder.ts`

The behavior-template layer supports:

```text
{Business Name}
{Agent Name}
{Caller Name}
```

But `composeAgentRuntimePackage()` supplies only:

```text
agentName
businessName
```

so `{Caller Name}` becomes an empty string in greeting/special-instruction/fallback templates built before the caller is known.

That can produce awkward copy even after whitespace cleanup.

### Recommendation

Either:

- remove `{Caller Name}` from pre-session configurable template options, or
- defer caller-name substitution until a caller name has actually been captured during the conversation

Do not fake or guess the caller name.

**Expected impact:** LOW-MEDIUM, but it prevents obviously unnatural template output.

---

# 5. Prompt audit

## KEEP

Keep these ideas from `builder.ts`:

```text
Sound like a real receptionist, not a chatbot reading notes.
Write for the ear, not the screen.
Use contractions.
Ask one question at a time.
Avoid chatbot filler.
Vary openings/closings.
Acknowledge frustration briefly.
Do not invent business facts or tool success.
```

These are strong.

## CHANGE

### Current

```text
Prefer one or two sentences per turn. Never give a long multi-sentence monologue.
```

### Suggested

```text
Usually answer in one to three short spoken sentences. Be shorter for simple
questions, and use a few more sentences only when the caller genuinely needs
an explanation.
```

Human conversation is variable. If every response has exactly the same small shape, rhythm itself becomes robotic.

---

### Current

```text
Keep this tone consistent for the whole call.
```

### Suggested

```text
Treat the configured style as your baseline personality, not a fixed emotion.
Keep your character consistent while adapting naturally to the caller's mood
and the purpose of the turn.
```

---

### Current number rule

Remove the manual speech normalization rule and replace it with the natural-written-form rule in P0-4.

---

### Current punctuation/pause rules

Replace:

```text
Use plain punctuation only (commas, periods, question marks).
Use soft commas for brief pauses.
```

with:

```text
Use normal sentence punctuation and capitalization, including apostrophes in
contractions. End every spoken turn with ., ?, or !. Use punctuation for
meaning, not as a manual timing control. Use exclamation marks sparingly and
only when semantically natural.
```


---

## ADD

Add one small rule:

```text
Respond to the caller's actual last thought before adding any extra information.
Do not front-load generic acknowledgments when the direct answer can come first.
```

This avoids the repetitive:

```text
Got it. ...
Sure. ...
Okay. ...
```

pattern becoming its own robotic tic.

Do **not** instruct the LLM to add random "um", "uh", fake breaths or verbal stumbles. Community discussions often mention imperfections as humanizing, but synthetic disfluency used indiscriminately is easy to detect and can reduce trust in a receptionist context.

---

# 6. Recommended final TTS baseline

This should be your **Sonic 3.5 baseline configuration before adding any fancy controls**. First verify that the deployed model is actually Sonic 3.5. If it is not, preserve the existing legacy-model behavior until separately evaluated.

```python
tts = cartesia_tts_service_cls(
    api_key=config.cartesia_api_key,
    text_aggregation_mode=text_aggregation_mode_cls.TOKEN,
    settings=cartesia_tts_service_cls.Settings(
        model=config.cartesia_model,
        voice=runtime_config.agent.voiceId,
        language=runtime_config.ttsLanguage,
    ),
)
```

Key properties:

```text
TOKEN aggregation: KEEP
max_buffer_delay_ms: OMIT initially
generation_config.emotion: OMIT initially
generation_config.speed: OMIT for Sonic 3.5 baseline (supported, but not forced)
generation_config.volume: OMIT for Sonic 3.5 baseline (supported, but not forced)
```

This deliberately gives Sonic less micromanagement.

Humanization should then come from:

1. good stable voice
2. natural transcript
3. enough streamed linguistic context
4. correct conversational turn timing

not from stacking more global modifiers.

---

# 7. Recommended voice strategy

## Production shortlist

Use Cartesia's **current stable-agent recommendations** as the source of truth, then narrow to the voices that are actually previewable and suitable for the tenant/customer.

### Strong first A/B set from the supplied catalog

**Female**
1. Katie
2. Skylar
3. Jacqueline
4. Gemma
5. Cathy / Caroline

**Male**
1. Jameson
2. Ronald
3. Archie
4. Carson, but only after disambiguating the multiple variants in the supplied catalog

Cartesia also lists Daniel as a stable voice-agent pick, but the supplied generated migration has no preview URL for Daniel. Do not feature it under a preview-required policy until that is resolved.

### Why not default to Maya?

Maya is an emotive voice and can be excellent for expressive content.

That is not the same as being the safest production receptionist voice.

Current Cartesia guidance separates:

- stable realistic voices -> production agents
- highly emotive voices -> characters / strongly expressive experiences

Maya should be an A/B option, not the default assumption.

### Selection rule

Do not hard-code a winner from documentation alone.

Run the exact same receptionist script through the stable shortlist and score:

```text
voice realism
sentence rhythm
neutral business delivery
empathetic delivery
numbers/emails
barge-in recovery
listener preference
```

Then promote the winner as the Sleek Relay default.

---

# 8. Voice picker redesign recommendation

Current UI:

```text
Tone:
  multiple pills

Voice:
  hundreds of provider voices
  gender filter
  search
  optional preview
```

Recommended:

```text
Recommended voices
  Katie       Friendly support
  Jacqueline  Reassuring agent
  Ronald      Measured / natural
  Jameson     Easygoing support
  ...

Style
  Friendly
  Professional
  Conversational
  Calm
  Energetic

More voices
  Advanced provider catalog
```

Also surface:

```text
country/accent
provider description
agent suitability
preview availability
```

The Cartesia API already exposes better metadata than your current migration preserves.

---

# 9. TTS markup recommendation

**File:** `workers/voice/app/tts_markup.py`

Current implementation is conservative and only inserts `<spell>` for allowlisted acronym-like agent/business names.

That is much better than blanket SSML injection.

### KEEP

Keep `<spell>` infrastructure for cases that truly require character-by-character reading.

### CHANGE

Do not assume every uppercase business acronym should always be spelled.

Example:

```text
NASA
```

may need to be pronounced as a word, not "N A S A".

For brand/proper-noun pronunciation, Cartesia's pronunciation dictionary is a better long-term mechanism than spelling every acronym.

Use `<spell>` primarily for:

- codes
- IDs
- account/reference numbers
- caller-requested spelling confirmations

---

# 10. Greeting audit

The opening greeting bypasses the LLM and is sent directly to TTS as an exact `TTSSpeakFrame`.

That is technically good for latency and determinism.

But it means a stiff greeting remains stiff forever because Gemini never gets a chance to rewrite it.

### Recommendation

Keep direct TTS greeting, but validate/default the copy itself.

Good shape:

```text
Hi, thanks for calling Finova Solutions. This is Maya. How can I help?
```

Avoid:

```text
Hello and thank you for contacting Finova Solutions. I would be delighted to
assist you with any questions or concerns you may have today.
```

Do not add random greeting variation until the baseline is stable. Determinism is useful for A/B listening.

---

# 11. Turn-taking baseline

## Recommended first implementation

Use Flux as the conversational turn authority while retaining Silero as a measurement signal.

Preferred conceptual configuration:

```text
Deepgram Flux:
  owns StartOfTurn / EndOfTurn
  interruption behavior follows runtime interruptionEnabled

Pipecat user aggregator:
  uses Flux-recommended ExternalUserTurnStrategies
  (either through service metadata or explicitly)

Silero VAD:
  remains attached for physical speech-stop metrics
  does NOT own conversational start/stop in the baseline
```

### Important implementation choice

Because the worker is pinned to `pipecat-ai==1.7.0`, Codex must verify the exact installed signatures rather than upgrading packages.

If the service-metadata path is available in the pinned version, prefer letting Flux recommend its external strategies by **not overriding `user_turn_strategies`**.

If explicit configuration is clearer/testable, use `ExternalUserTurnStrategies()`.

### Interruption

Wire `runtime_config.agent.interruptionEnabled` coherently.

If Flux owns start/interruption, set its `should_interrupt` accordingly.

If VAD-start is later reintroduced as an experiment, ensure its `enable_interruptions` uses the same value and avoid two independent interruption authorities.

### Experiment only if needed

If Flux start detection is measurably worse for barge-in:

```text
Silero/VAD -> fast interruption/start
Flux       -> authoritative turn stop
```

Treat that as a separate A/B branch.

Do not convert VAD stop into the external stop signal merely to make the hybrid work.

---

# 12. What NOT to do

Do not make all these changes simultaneously:

```text
Cartesia -> ElevenLabs
Gemini -> another LLM
Deepgram -> another STT
TOKEN -> SENTENCE
new voice
new prompt
new VAD
```

You would get a different agent but learn nothing.

Also do not:

- add random "um" and "uh" globally
- inject fake breathing every few sentences
- force a dramatic emotion on every response
- lower every latency timer just because lower looks better
- expose 400+ voices and expect end-users to find the five good agent voices
- use the provider preview alone as proof of live-agent quality
- remove Silero VAD without refactoring the latency tracker that depends on VAD speech-stop timestamps
- change `silence_timeout_seconds` just to make normal turns faster
- upgrade `pipecat-ai==1.7.0` during the humanization baseline
- make the opening greeting interruptible in the same commit as TTS/prosody tuning

---

# 13. Controlled implementation plan

The key audit rule is: **one behavior class per phase**.

Do not let Codex turn this into one giant "humanize everything" patch.

## Phase 0 — Freeze and identify the baseline

Before changing behavior:

1. Confirm the pinned worker dependency remains `pipecat-ai==1.7.0`.
2. Record the effective:
   - `CARTESIA_MODEL`
   - selected `voice_id`
   - configured tone
   - current buffer mode/value
   - current generation config
   - current turn strategy
3. Preserve the old behavior as the A/B control.
4. If running controlled listening tests on Sonic 3.5, consider pinning the test environment to `sonic-3.5-2026-05-04`.
5. Do not expose API keys in diagnostics.

**Gate:** no functional behavior change yet.

---

## Phase 1 — TTS simplification only

### `workers/voice/app/bot.py`

For a verified Sonic 3.5 baseline:

1. Keep `CartesiaTTSService`.
2. Keep `TextAggregationMode.TOKEN`.
3. Omit explicit `max_buffer_delay_ms=1000`.
4. Omit the global `generation_config.emotion`.
5. Omit forced `speed=0.9`.
6. Omit redundant `volume=1.0`.
7. Preserve voice/model/language selection.
8. Preserve all current connection/latency instrumentation.
9. Do not touch Deepgram turn logic in this phase.

**Gate:** A/B current TTS vs simplified TTS on the same voice and transcript.

---

## Phase 2 — Spoken-text prompt cleanup only

### `apps/portal/lib/runtime/builder.ts`
### `workers/voice/app/prompt.py`

1. Replace manual verbalization of normal phone numbers/times/emails with conventional written forms.
2. Replace the punctuation rules with normal punctuation + required terminal `.`, `?`, or `!`.
3. Remove the "soft commas" timing instruction.
4. Make tone a baseline persona that can adapt to context.
5. Prefer "usually 1–3 short sentences" rather than a rigid repeated shape.
6. Preserve grounding/tool/capability safety rules.
7. Keep the LLM provider and temperature unchanged.

**Gate:** compare transcript quality and TTS naturalness using the winning Phase-1 TTS config.

---

## Phase 3 — Voice curation/catalog consistency

1. Change documentation/default recommendations away from "Maya by default."
2. Create a stable-agent recommended shortlist from current Cartesia guidance.
3. Correct the generated migration vs current fetch-script `enabled` behavior.
4. Preserve/add provider `description`, `country`, and preferably locale metadata where practical.
5. Resolve stale voices that disappear from Cartesia's live list so they do not remain indefinitely enabled.
6. Keep the full provider catalog behind an advanced path.
7. Do not hard-code a Carson variant until the current live metadata/preview is reviewed.

**Gate:** blind or semi-blind listening comparison on the same prompt/TTS configuration.

---

## Phase 4 — Turn ownership and interruption

Only after TTS/prompt/voice work has an established baseline:

1. Make Flux the conversational turn owner using its recommended external strategy path.
2. Keep Silero for metrics.
3. Stop relying on `VADUserStopAdapterProcessor` in its current upstream position; remove it only after tests prove no required path depends on it.
4. Wire `interruptionEnabled` coherently.
5. Do not tune Flux `eot_threshold`, `eager_eot_threshold`, or `eot_timeout_ms` in the same first turn-ownership change.
6. Do not change the 8 s safety watchdog just to make normal turn-taking faster.
7. Preserve startup gating and instrumentation.

**Gate:** test pauses, corrections, backchannels, and barge-in.

---

## Phase 5 — Opening-greeting barge-in experiment

This is a separate behavior change.

1. Measure how often callers speak over the greeting.
2. If needed, make the greeting interruptible by revisiting both:
   - `StartupMicMuteProcessor`
   - `StartupTurnGateProcessor`
3. Prove no self-transcription/echo regression.
4. Prove caller speech is not lost.
5. Keep the greeting itself short and terminally punctuated.

**Gate:** no repeated greeting, no loopback transcript, clean barge-in.

---

## Phase 6 — Product/docs/observability cleanup

1. Add a runtime-realistic voice preview/test path if worth the scope.
2. Persist/log safe experiment metadata (model, voice ID, buffering mode, no secrets).
3. Fix `{Caller Name}` template semantics.
4. Update `workers/voice/README.md`, whose opening POC/out-of-scope section is stale relative to the current architecture.
5. Add/refresh the listening-test playbook and acceptance criteria.

---

# 14. A/B matrix

Change **one dimension at a time**. Keep the exact Cartesia model snapshot/alias constant across a comparison set.

| Test | Voice | Emotion | Buffer | Turn model | Purpose |
|---|---|---|---|---|---|
| A | current | current static | 1000 ms | current | control |
| B | current | current static | managed/unset | current | isolate buffering |
| C | current | none | managed/unset | current | isolate static emotion |
| D | Katie | none | managed/unset | current | isolate stable voice |
| E | Jacqueline | none | managed/unset | current | voice comparison |
| F | Ronald/Jameson | none | managed/unset | current | male voice comparison |
| G | winning voice | none | managed/unset | Flux external | turn-taking |
| H | winning baseline | dynamic experiment | managed | Flux external | optional emotion |

Do not proceed to H unless the no-emotion baseline actually needs help.

---

# 15. Humanization test script

Use the same script for every A/B run.

## Basic answer

Caller:

```text
What time are you open tomorrow?
```

Check:

- direct answer
- no corporate filler
- natural time pronunciation
- sentence-ending intonation

## Phone number

Caller:

```text
What's your phone number?
```

Check:

- grouping
- pace
- no unnatural over-spelling

## Email

Caller:

```text
What's the email address?
```

Check:

- natural @ / dot pronunciation
- intelligibility

## Mid-thought pause

Caller:

```text
I wanted to book for... actually, maybe Friday afternoon.
```

Check:

- does bot jump in after "for..."
- does turn detection wait naturally

## Correction

Caller:

```text
Sorry, I meant Friday, not Thursday.
```

Check:

- brief correction response
- no generic reset
- correct emotional delivery

## Frustration

Caller:

```text
I've already explained this twice.
```

Check:

- brief empathy
- not cheerful/curious
- no theatrical sadness

## Barge-in

Let agent begin a 2-sentence answer and interrupt:

```text
Wait, sorry, I just need the address.
```

Check:

- interruption stops bot quickly
- no stale audio continues
- new answer addresses latest intent

## Business acronym / proper noun

Use a real tenant acronym.

Check:

- correct spoken form
- only use `<spell>` if that is actually how humans say it

---

# 16. Metrics

Your existing instrumentation is a strong foundation.

Continue tracking:

```text
speech stop -> final STT
final STT -> LLM first token
LLM first token -> TTS request
TTS request -> first TTS audio
first TTS audio -> browser speaking
speech stop -> audible bot response
```

But add humanization evaluation.

When Flux becomes the turn owner, retain a physical end-of-speech timestamp for metrics. With the current tracker, that means keeping Silero VAD observational unless the tracker is refactored at the same time.

## Suggested quantitative targets

These are audit targets, not provider guarantees:

```text
No-tool EOT -> audible first bot audio:
  median <= 1.2 s
  p95 <= 1.8 s

Barge-in:
  no noticeable stale response continuation
  latest user intent becomes next LLM turn

Premature response rate:
  < 2% of normal test turns

Cut-off/incomplete final transcript rate:
  < 1% in clean browser tests
```

## Subjective scorecard

Rate 1–5:

```text
Voice realism
Sentence rhythm
Emotional appropriateness
Pause naturalness
Responsiveness
Interruption naturalness
Pronunciation
"Feels like a live receptionist"
```

Do blind A/B listening where possible.

The winning configuration is not necessarily the one with the smallest TTS TTFB.

---

# 17. Community signal

Recent community discussions around voice agents repeatedly converge on a few themes:

- TTS provider quality matters, but pipeline timing matters just as much.
- End-to-end or "mouth-to-ear" latency is more meaningful than provider TTFB alone.
- Extremely fast responses can still feel bad when turn-taking is over-eager.
- Slightly less impressive voice timbre with better timing can feel more alive.
- Cartesia Sonic 3.5 is commonly used in modern low-latency agent stacks.

Some Reddit discussions also advocate adding breaths, whispers, laughter or intentional imperfection.

For Sleek Relay, treat those as **optional character effects**, not baseline humanization. A business receptionist should first sound context-aware, rhythmically natural and appropriately responsive. Fake quirks added before those basics are solved usually become another recognizable AI pattern.

Reddit is anecdotal evidence, not authoritative product documentation.

---

# 18. KEEP / CHANGE / REMOVE / EXPERIMENT summary

## KEEP

- Cartesia Sonic as primary TTS
- TOKEN streaming
- Daily prejoin / warm-connect architecture
- browser audio-unlock logic
- concise voice-first LLM rules
- contractions
- anti-chatbot filler rules
- one-question-at-a-time behavior
- current latency instrumentation
- conservative `<spell>` processor infrastructure
- Gemini as the initial controlled baseline
- Deepgram Flux as STT

## CHANGE

- stable production-agent shortlist becomes the default recommendation
- curate voice picker
- preserve better Cartesia voice metadata
- tone becomes baseline persona, not fixed emotion
- natural written numbers/times/emails
- turn detection ownership
- wire `interruptionEnabled`
- rename/rethink `silenceTimeoutSeconds`
- loosen rigid one/two-sentence rhythm slightly
- regenerate/fix voice seed enablement

## REMOVE

For the Sonic 3.5 baseline:

- forced `speed=0.9` (supported, but remove as a global default for baseline testing)
- redundant forced `volume=1.0`
- global always-on TTS emotion
- explicit `max_buffer_delay_ms=1000`
- "keep this exact tone for whole call" wording
- blanket manual verbalization of common numbers/symbols
- explicit custom turn ownership that overrides Flux's recommended external-turn path

## EXPERIMENT

Only after baseline:

- explicit 1500–2000 ms buffer
- sentence aggregation
- contextual dynamic emotions
- VAD-start + Flux-stop hybrid
- alternate LLM
- expressive voices such as Maya/Tessa
- pronunciation dictionaries for domain-specific proper nouns

---

# 19. Recommended order of implementation

Do the work in this order:

### 0 — Freeze the measurement baseline

Verify the actual Cartesia model/voice and keep Pipecat pinned at 1.7.0.

### 1 — Cartesia buffering

Remove the explicit `max_buffer_delay_ms=1000` override and compare against the current baseline.

### 2 — Global TTS controls

For verified Sonic 3.5, remove the static emotion and forced speed/volume from the baseline.

### 3 — Spoken transcript rules

Stop pre-verbalizing normal numbers/times/emails, fix punctuation, require terminal punctuation, and make persona adaptive rather than emotionally fixed.

### 4 — Stable voice A/B

Test current Cartesia stable-agent recommendations against the winning configuration.

### 5 — Turn ownership/interruption

Only then move turn ownership toward Flux external strategies, retain Silero for metrics, and wire `interruptionEnabled`.

### 6 — Greeting barge-in

Treat opening-greeting interruption as a separate optional experiment because it requires changing startup mic/turn gating.

This ordering keeps the causes separable:

```text
prosody context
global generation controls
written transcript quality
voice suitability
conversation timing
first-impression barge-in
```

---

# 20. Audited Codex execution brief

Use the following as the implementation contract.

```text
GOAL
Improve Sleek Relay voice-agent naturalness while preserving the existing
Cartesia + Gemini + Deepgram Flux + Daily + Pipecat architecture.

NON-NEGOTIABLE GUARDRAILS
- Keep pipecat-ai pinned at exactly 1.7.0. Do not upgrade dependencies.
- Do not switch TTS, STT, LLM, or transport providers.
- Do not remove existing tenant/runtime security checks.
- Do not remove latency instrumentation.
- Do not remove Silero VAD unless the speech-stop metrics are refactored in the
  same change and equivalent metrics are proven.
- Do not change all humanization dimensions at once.
- Do not add fake filler words, breathing, laughter, random pauses, or
  theatrical SSML as baseline behavior.
- Do not assume CARTESIA_MODEL is Sonic 3.5 without reading the effective
  configuration path. Do not print secrets.

FIRST: VERIFY CURRENT STATE
1. Confirm pyproject.toml and uv.lock still pin pipecat-ai==1.7.0.
2. Trace the effective Cartesia model and voice selection:
   env CARTESIA_MODEL -> config -> runtime -> CartesiaTTSService
   agent voice_id -> runtime package -> Python -> CartesiaTTSService.
3. Record safe baseline values in the implementation notes:
   model, voice ID, TOKEN/SENTENCE mode, buffer override, generation controls,
   user-turn strategies, interruption behavior.
4. Do not change the deployed model in this verification step.

PHASE 1: TTS BASELINE ONLY
File: workers/voice/app/bot.py

If the effective model is Sonic 3.5:
- Keep CartesiaTTSService.
- Keep TextAggregationMode.TOKEN.
- Remove the explicit max_buffer_delay_ms=1000 argument so TOKEN mode leaves
  Cartesia managed buffering unset and Cartesia uses its normal managed buffer.
- Stop forcing generation_config.emotion from the agent tone.
- Stop forcing speed=0.9 for the baseline.
- Stop explicitly passing volume=1.0 for the baseline.
- Preserve model, voice and language selection.
- Preserve all service preconnect/startup/latency instrumentation.
- Do NOT touch Deepgram turn logic in this phase.
- Do NOT delete the agent tone field; tone remains an LLM persona setting.

If the effective model is NOT Sonic 3.5:
- Do not silently apply Sonic-3.5-specific behavior.
- Preserve existing generation behavior and document the model mismatch for a
  separate evaluation.

Tests for Phase 1:
- Sonic 3.5 construction uses TOKEN mode.
- Sonic 3.5 construction does not explicitly set max_buffer_delay_ms.
- Sonic 3.5 baseline has no global static emotion/speed/volume override.
- voice/model/language still propagate correctly.
- latency/startup instrumentation still attaches.
- legacy/non-3.5 behavior is not accidentally changed if a conditional path is
  retained.

PHASE 2: SPOKEN-TEXT CONTRACT ONLY
Files:
- apps/portal/lib/runtime/builder.ts
- workers/voice/app/prompt.py

Change the spoken-output rules so they follow Cartesia's natural-text guidance:
- Write normal prose in complete phrases.
- End each spoken turn with ., ?, or !.
- Allow normal apostrophes/contractions.
- Use punctuation for meaning, not as manual TTS timing control.
- Remove the "soft commas" pause instruction.
- Use conventional written forms for normal numbers, currency, dates, times,
  US phone numbers, addresses and emails instead of manually verbalizing them.
- Keep <spell> reserved for codes/IDs or explicit spelling confirmations.
- Treat configured tone as a baseline personality that adapts to caller context.
- Prefer usually 1-3 short spoken sentences, not a mechanically identical
  response shape.
- Preserve grounding, workflow/tool, safety, no-markdown and no-fake-success
  rules.
- Keep Gemini and the current LLM temperature unchanged.

Tests for Phase 2:
- prompt contains the natural-written-number rule.
- prompt requires terminal punctuation.
- prompt no longer restricts punctuation to only comma/period/question mark.
- prompt no longer tells the model to add commas for pauses.
- tone remains in the prompt but is described as adaptive baseline persona.
- grounding/tool instructions remain present.

PHASE 3: VOICE CATALOG / DEFAULT RECOMMENDATIONS
Files:
- workers/voice/README.md
- supabase/scripts/fetch-cartesia-voices.mjs
- relevant voice migration/schema/loaders/UI

Use current Cartesia stable-agent guidance as the recommendation source:
Male: Archie, Ronald, Carson, Jameson, Daniel.
Female: Skylar, Gemma, Katie, Jacqueline, Cathy, Caroline.

Implementation:
- Remove "Maya is the default because it is emotive" as the production rule.
- Create a small Recommended for voice agents section using previewable stable
  voices from the current catalog.
- Keep emotive voices such as Maya/Tessa as advanced alternatives.
- Do not hard-code a Carson ID until current variants are reviewed.
- Fix the discrepancy where the supplied generated migration inserted 418 rows
  without the enabled column while the current generator disables rows without
  preview_file_url.
- Ensure current sync behavior does not leave removed provider voices
  indefinitely enabled. Use a safe provider/source-aware strategy rather than
  blindly deleting shared data.
- Preserve Cartesia description, country and locale metadata where practical;
  tagline alone is insufficient and is null in the supplied generated snapshot.
- Keep tenant isolation/auth rules unchanged.

Do not declare a single winning default voice without an A/B listening test.

PHASE 4: TURN OWNERSHIP / INTERRUPTION
File: workers/voice/app/bot.py

Current behavior explicitly overrides Flux's recommended external turn strategy
with VAD start + ExternalUserTurnStopStrategy(timeout=0.05).

Baseline direction:
- Make Deepgram Flux the conversational turn owner.
- Prefer allowing its service metadata to provide ExternalUserTurnStrategies
  if that behavior exists in pinned Pipecat 1.7.0; otherwise configure
  ExternalUserTurnStrategies explicitly.
- Keep SileroVADAnalyzer attached for physical speech-stop metrics.
- Do not let Silero own conversational start/stop in this baseline.
- VADUserStopAdapterProcessor is upstream of user_aggregator while the VAD
  analyzer lives on the aggregator. Do not rely on that processor to convert
  aggregator-generated VAD stop frames. Remove it only after a test proves no
  required upstream VAD path depends on it.
- Wire runtime_config.agent.interruptionEnabled to Deepgram Flux
  should_interrupt.
- If any VAD-based start strategy is deliberately retained, configure its
  enable_interruptions behavior from the same runtime setting so interruption
  is not split across conflicting authorities.
- Do not tune eager_eot_threshold, eot_threshold or eot_timeout_ms in the same
  first ownership change.
- Do not change silence_timeout_seconds merely to make ordinary turns faster.
  It maps to Pipecat's user_turn_stop_timeout safety watchdog.

Tests for Phase 4:
- interruptionEnabled=true enables expected normal barge-in.
- interruptionEnabled=false prevents normal barge-in from cancelling bot speech.
- exactly one intended turn-start/interrupt path is active.
- Flux final transcripts are not clipped.
- natural mid-thought pauses do not trigger premature LLM responses.
- Silero VAD speech-stop metrics still populate.
- speech_stop_to_stt / response timing remains meaningful.
- existing startup gate/greeting behavior is unchanged in this phase.

PHASE 5: GREETING BARGE-IN -- SEPARATE EXPERIMENT, NOT BASELINE
Current behavior intentionally makes greeting non-interruptible:
- StartupMicMuteProcessor drops mic audio until greeting playback completes.
- StartupTurnGateProcessor blocks user-turn frames until greeting playback
  completes and Deepgram is ready.

Do not casually remove one of those guards.

If implementing greeting barge-in:
- change both mechanisms deliberately;
- prove the bot does not transcribe its own greeting;
- prove the user's interruption is retained;
- prove greeting audio stops cleanly;
- prove the LLM does not greet again;
- keep the configured greeting short and ensure it ends with terminal
  punctuation.

OTHER REQUIRED CLEANUP
- Fix or remove the pre-session {Caller Name} token because runtime package
  composition currently has no callerName value.
- Update workers/voice/README.md so its POC/out-of-scope section matches the
  current Daily/runtime-package/dashboard implementation.
- Keep the safe <spell> layer, but do not automatically spell every acronym.
  Prefer natural Sonic pronunciation or a pronunciation dictionary for proper
  nouns; reserve <spell> for true character-by-character output.

DELIVERABLES
1. Code changes grouped by phase, with no unrelated refactors.
2. Updated/added tests for every behavior above.
3. HUMANIZATION_AB_TEST.md containing:
   - exact old baseline
   - exact new baseline
   - model/voice used
   - one-dimension-at-a-time test matrix
   - latency metrics to compare
   - subjective listening scorecard
4. Update workers/voice/README.md with the final tested configuration.
5. Report any item that cannot be implemented confidently against Pipecat 1.7.0
   instead of guessing an API signature.

IMPORTANT
Do not implement EXPERIMENT items (sentence aggregation, dynamic per-turn
emotion, VAD-start/Flux-stop hybrid, alternate LLM/provider, fake
nonverbalisms) as baseline behavior.
```

---

# 21. Sources

## Cartesia official documentation

1. **Sonic 3.5**
   https://docs.cartesia.ai/build-with-cartesia/tts-models/latest

2. **Prompting tips**
   https://docs.cartesia.ai/build-with-cartesia/capability-guides/prompting-tips

3. **Volume, Speed, and Emotion**
   https://docs.cartesia.ai/build-with-cartesia/capability-guides/volume-speed-emotion

4. **Stream Inputs using Continuations**
   https://docs.cartesia.ai/build-with-cartesia/capability-guides/stream-inputs-using-continuations

5. **Choosing a Voice**
   https://docs.cartesia.ai/build-with-cartesia/capability-guides/choosing-a-voice

6. **SSML Tags**
   https://docs.cartesia.ai/build-with-cartesia/capability-guides/ssml-tags

7. **List Voices API**
   https://docs.cartesia.ai/api-reference/voices/list

8. **Cartesia 2026 changelog**
   https://docs.cartesia.ai/changelog/2026

## Pipecat official documentation / releases

9. **Cartesia TTS service**
   https://docs.pipecat.ai/api-reference/server/services/tts/cartesia

10. **Deepgram STT / Flux**
    https://docs.pipecat.ai/api-reference/server/services/stt/deepgram

11. **User Turn Strategies**
    https://docs.pipecat.ai/api-reference/server/utilities/turn-management/user-turn-strategies

12. **External Turn Management**
    https://docs.pipecat.ai/api-reference/server/utilities/turn-management/external-turn-management

13. **Pipecat releases**
    https://github.com/pipecat-ai/pipecat/releases

## Community discussions used as secondary signal

15. **Anyone building production AI voice agents? Struggling with latency + robotic voice**
    https://www.reddit.com/r/AI_Agents/comments/1r1bdzn/anyone_building_production_ai_voice_agents/

16. **What actually determines whether a voice agent feels real**
    https://www.reddit.com/r/VoiceAutomationAI/comments/1uotylr/what_actually_determines_whether_a_voice_agent/

17. **What are you actually using for TTS on voice agents?**
    https://www.reddit.com/r/AI_Agents/comments/1uysv5y/what_are_you_actually_using_for_tts_on_voice/

18. **Why do most AI voice agents still sound robotic even in 2026?**
    https://www.reddit.com/r/AIVoice_Agents/comments/1t8w5jy/why_do_most_ai_voice_agents_still_sound_robotic/

---

## Final assessment

The core problem is not "Cartesia sounds robotic."

The core problem is that the system currently asks a modern context-sensitive
TTS model to behave like a manually tuned legacy TTS engine:

```text
force a global emotion
force a global speed override
force a redundant/global volume override
limit its context buffer
pre-verbalize text for it
expose unsuitable voices
mix multiple tone concepts
let multiple systems influence turn stop
```

Sonic 3.5's current design direction is the opposite:

```text
give it natural text
give it enough context
choose a stable voice
let transcript semantics drive expression
keep turn-taking clean
```

Simplify first.

Then listen.

Only add explicit controls back when an A/B test proves they improve the live
conversation.
