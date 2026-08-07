# Website Extraction Scraper — Requirements

**Component:** Assisted self-service onboarding — website extraction
**Parent project:** Sleek Relay NPE Validation Release
**Source spec:** RFQ Section 6, "Assisted self-service onboarding" row —
> "Website extraction may draft facts, but owner approval is required before activation."

## 1. Purpose

During tenant onboarding, a pilot business supplies their existing website URL. The scraper visits that site and **drafts** a set of business-profile facts to pre-fill the onboarding form, saving the owner from typing everything by hand. It never activates a tenant on its own — every extracted field is a *draft* until a human reviews and approves it.

This is a single-shot, per-tenant extraction tool run at onboarding time — not a crawler, not a scheduled monitor, and not a bulk scraping pipeline.

## 2. Scope

### In scope
- Given one business website URL, extract a fixed set of fields (Section 4).
- Handle arbitrary, unknown site structures — pilot businesses will not share a common CMS or template.
- Produce a structured, schema-validated draft record with per-field confidence/source metadata.
- Surface the draft to the owner for review; require explicit approval before any field is written to live tenant config.
- Fail gracefully and legibly — partial extraction is fine, silent wrong data is not.

### Out of scope (do not build)
- Multi-page crawling or full-site indexing of the business's website.
- Scheduled/recurring re-scraping of the same site.
- Any automatic activation of a tenant without owner approval.
- Scraping of third-party sites (review platforms, directories, social media) — website URL only, as supplied by the owner.
- Circumventing bot protection, CAPTCHAs, or login walls. If the target site blocks access, extraction fails cleanly and the owner fills the form manually.

## 3. Extraction type (per taxonomy)

| Axis | Choice | Why |
|---|---|---|
| **Fetch** | HTTP fetch first; headless browser fallback | Most small-business sites are server-rendered; headless (e.g. Playwright) only for JS-rendered sites where plain fetch returns an empty shell |
| **Roam** | Single target, single run | One URL, triggered once at onboarding — not a crawl or monitor |
| **Extract** | Schema-driven, LLM-assisted with rule-based fallback | Sites have no shared template, so fixed CSS selectors alone won't generalize; use structured data (JSON-LD/schema.org, Open Graph) where present, LLM extraction against a strict schema otherwise |

## 4. Required output fields

All fields optional in the draft (extraction may not find everything) but validated against types when present. Do not fabricate a value — omit the field if not found.

| Field | Type | Notes |
|---|---|---|
| `businessName` | string | |
| `website` | string (URL) | the input URL, normalized |
| `phone` | string | E.164 or as found; do not guess format |
| `category` | string | best-effort business category/industry |
| `contactEmail` | string (email) | |
| `hours` | structured (per weekday: open/close or "closed") | if published; do not infer from partial data |
| `faqs` | array of `{question, answer}` | only from content explicitly presented as Q&A or clearly answerable facts (e.g. "we accept walk-ins") |
| `address` | string | if present |
| `socialLinks` | array of URLs | optional, low priority |

Each field, when present, must carry:
- `value` — the extracted value
- `source` — `"structured_data"` \| `"page_text"` \| `"llm_inferred"`
- `sourceUrl` — which page it came from (homepage, /about, /contact, etc.)
- `confidence` — `"high"` \| `"medium"` \| `"low"` (structured data = high, LLM inference from prose = medium/low)

> **Implementation note:** no evaluated extraction library (Firecrawl, Scrapling, Scrapegraph-ai) returns this metadata natively — they return a flat result. This tagging must be built at the application layer: e.g. treat anything matched from JSON-LD/schema.org/Open Graph as `structured_data`/`high`, anything the LLM pulled from prose as `llm_inferred`/`medium` or `low`. Do not treat "the library validated it" as equivalent to "the field is high-confidence."

## 5. Draft-only / approval gate — hard requirement

This is the single most important constraint in this component, per both the RFQ (Section 6) and the acceptance criteria (Section 9: *"the system never invents... success"*):

- Extracted data is written to a **draft** record, never directly to live tenant configuration.
- The onboarding UI must display each field with its source/confidence so the owner can see what was scraped vs. what they've typed themselves.
- A tenant cannot move to "active" status until the owner has explicitly approved (or edited and approved) the draft. Log the approval action with a timestamp and the identity of who approved it.
- If extraction fails entirely, onboarding continues normally with an empty manual-entry form — extraction failure is never a blocking error.

## 6. Non-functional requirements

- **Timeout budget:** total extraction (fetch + parse + LLM pass) should complete within ~15 seconds; abandon and fall back to manual entry beyond that rather than blocking the onboarding flow.
- **No unrestricted LLM tool access:** per Section 6's application-security row, the LLM extraction step must not have open network, SQL, or shell access — it receives only the already-fetched page content and returns structured JSON against the schema above. No agentic browsing.
  - **Explicitly disqualifying:** any library or API mode where the LLM autonomously navigates, clicks, searches, or fetches additional pages on its own initiative (e.g. an "agent" mode that decides where to go next). We fetch; the LLM only reads and structures. If a candidate library's extraction feature is described as "agentic," "autonomous," or requires no upfront URL, do not use that mode for this component even if the same library has a plain single-page extraction option available.
  - Also disqualifying: any tool whose design center is executing shell commands, installing CLIs, or storing platform login credentials/cookies on disk to access third-party sites. This component only ever touches the one business website URL the owner supplied — nothing resembling a general-purpose "give an agent internet access" tool belongs here.
- **Idempotent:** re-running extraction on the same URL should be safe to call again (e.g. owner clicks "re-scan") without side effects beyond producing a new draft.
- **Tenant isolation:** extraction runs are not persisted or associated with any tenant until that tenant record exists; no cross-tenant data leakage in logs or caches.
- **Logging:** log the URL fetched, fields extracted (not full page content) and their source/confidence, and any failure reason, tagged to the onboarding session — feeds into the observability requirements in Section 9 of the parent RFQ (one trace per operation, no caller-content-style raw dumps kept longer than needed).
- **Respect basic scraping etiquette:** check `robots.txt`; identify with a real user-agent; single request per page, no aggressive retries.

## 7. Error handling

| Failure | Behavior |
|---|---|
| URL unreachable / times out | Return empty draft, log reason, continue onboarding manually |
| Site blocks bots / CAPTCHA | Same as above — no bypass attempts |
| Page fetched but no extractable content | Return whatever partial fields were found (possibly none); never error out the whole onboarding flow |
| LLM returns malformed/non-schema JSON | Discard that field(s), do not retry more than once, fall back to omitting the field |
| Extracted value fails schema validation (e.g. malformed phone) | Drop the field rather than passing bad data to the form |

## 8. Suggested implementation shape

Mirrors the schema-first pattern already validated for this project:

1. Fetch page (HTTP first, headless fallback if content looks empty/JS-rendered).
2. Run structured-data extraction (JSON-LD, Open Graph, microdata) — highest confidence, cheapest.
3. Run LLM extraction against the same target schema, using cleaned page text as input, for anything structured extraction didn't find.
4. Merge with structured data taking precedence over LLM inference on conflicting fields.
5. Validate the merged candidate against the schema (e.g. Zod) — drop invalid fields rather than reject the whole draft.
6. Return the draft with source/confidence metadata attached; never write to tenant config directly.

## 9. Library / dependency selection criteria

Before adopting any third-party scraping or extraction library for this component, confirm it meets all of the following. This list exists because evaluated candidates varied widely on these points — none of them fail cleanly, so each has to be checked deliberately rather than assumed from the marketing copy:

- [ ] **Self-hostable / no forced third-party processing region.** Either the library runs entirely in our infrastructure, or if it depends on an external API, that API's processing region is contractually known and acceptable — not "wherever the vendor's cloud happens to run."
- [ ] **Bring-your-own-LLM.** The extraction/LLM step must accept a configurable model endpoint (e.g. Azure) so it can be pointed at the approved Foundry Canada East deployment from Section 3, rather than an embedded/opaque model choice.
- [ ] **No agentic/autonomous mode is the only extraction path.** Confirm the library offers a constrained single-page, single-shot extraction call — not just an "agent" mode that browses on its own.
- [ ] **Does not require shell-execution permission, credential storage, or third-party platform login** to do its job. This component only ever touches one supplied business URL.
- [ ] **Robots.txt handling verified, not assumed.** Test directly against a `robots.txt`-disallowed path — don't rely on a README claim.
- [ ] **No native confidence/source metadata expected.** Plan for this to be built in-house regardless of library choice (see Section 4 note above).

## 10. Acceptance criteria for this component

- [ ] Given a normal small-business website, extraction returns at least business name and one contact method (phone or email) in a majority of test cases.
- [ ] No field is ever written to an active tenant without a logged owner approval action.
- [ ] Extraction failure never blocks or errors the onboarding flow — it degrades to manual entry.
- [ ] Draft output validates against the defined schema before being shown to the owner.
- [ ] LLM extraction step has no network, filesystem, or shell tool access beyond receiving text input.
- [ ] Extraction of one site completes or times out within 15 seconds.
- [ ] `robots.txt` is checked before fetching; disallowed paths are not fetched.

## 11. Open questions for Sleek Relay / vendor to confirm before build

- Is a single extraction attempt sufficient, or should the owner get a manual "re-scan" trigger from the onboarding UI (recommended, see idempotency note above)?
- Confirm whether social links / address are must-have for pilot or genuinely optional — affects how much LLM-inference (lower confidence) is worth building vs. cutting for the validation release.
- Confirm the specific approved way to reach the Foundry Canada East endpoint from a third-party extraction library (API key / auth pattern), now that Section 9 requires bring-your-own-LLM support as a hard constraint on library choice.
