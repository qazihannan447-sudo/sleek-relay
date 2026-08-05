**SLEEK RELAY  |  NPE VALIDATION RELEASE RFQ** 

### **SLEEK RELAY** 

# **NPE Validation Release – Offshore Engineering RFQ** 

Scope, architecture constraints, deliverables, acceptance criteria, and quotation format 

**Request for a fixed-price quotation to build a lean, reusable market-validation release in Sleek Relayowned non-production infrastructure.** 

#### **Prepared for: Qualified Pakistan-based voice AI and software engineering teams** 

Canada-first architecture | Sleek Relay-owned accounts and code | Market-validation stage 

Confidential | July 2026 

Page 1 

**SLEEK RELAY  |  NPE VALIDATION RELEASE RFQ** 

## **1. RFQ Purpose** 

**Sleek Relay is seeking a small, experienced engineering team to build a lean voice-AI validation release in a Sleek Relayowned non-production environment (NPE).** The objective is to test market demand with a small number of pilot businesses before investing in the complete production-scale end state. 

**Quote only the Validation Release described in this RFQ. Do not price the complete 18-page Frozen Baseline as one immediate build. Any future production-scale or regulated capability must be quoted separately as an option.** 

## **2. Reference Architecture Status** 

- The attached Sleek Relay Frozen Baseline v1.3 remains the long-term architecture direction and no-rebuild reference. 

- This RFQ intentionally reduces the immediate scope to an NPE validation release while preserving the architecture boundaries needed for later scale. 

- Provider substitutions require a written equivalency analysis covering recurring cost, Canadian processing, latency, voice quality, reliability, portability, security, and support impact. 

- All code, repositories, accounts, data, Infrastructure as Code, pipelines, documentation, and deployment assets must remain under Sleek Relay control from the first milestone. 

## **3. Fixed Technical Direction** 

|**Component**|**Binding direction**|
|---|---|
|**Carrier**|Telnyx Canadian DID through a Sleek Relay carrier adapter. No workfow code may call a carrier SDK directly.|
|**Call ingress**|Sleek Relay CallRouter service with verifed webhooks, replay protection, idempotency, and safe fallback.|
|**Voice orchestration**|Pipecat in Sleek Relay-owned Docker containers, including interruption handling, endpointing, timeouts, tool<br>calls, and safe close-of.|
|**Speech**|Azure AI Speech regional endpoint in Canada Central for production-intended STT/TTS testing.|
|**LLM**|Microsoft Foundry Standard single-region deployment in Canada East using an approved low-cost regional<br>model.|
|**Application**|Next.js portal/API in Sleek Relay-owned Docker containers.|
|**Database**|Azure PostgreSQL Flexible Server in Canada Central; tenant_id on business rows, migrations, encryption, and<br>row-level security.|
|**Storage / jobs / secrets**|Azure Blob Storage, Storage Queues, and Key Vault in Canadian regions.|
|**Monitoring**|OpenTelemetry plus Azure Monitor / Log Analytics with one trace per call and caller-content redaction by<br>default.|
|**Delivery**|GitHub Actions plus OpenTofu/Terraform, environment-driven confguration, scans, staged deployment, and<br>rollback.|



## **4. Canadian Foundation Provided Separately** 

A Canadian Azure advisor will establish or supervise the following foundation. Do not duplicate these items in your quotation unless a specific gap is identified and priced separately: 

- Azure tenant/subscription/resource-group structure and billing ownership. 

- Base Azure policies, region restrictions, budgets, alerts, and environment boundaries. 

- Identity/RBAC model, emergency access, Key Vault foundation, and workload-identity pattern. 

- Base OpenTofu/Terraform modules and GitHub Actions / OIDC pipeline foundation. 

- NPE skeleton for PostgreSQL, Blob, Queues, Key Vault, monitoring, Azure Speech, and Foundry connectivity. 

- Infrastructure pull-request review and production-promotion oversight. 

Confidential | July 2026 

Page 2 

**SLEEK RELAY  |  NPE VALIDATION RELEASE RFQ** 

**Your quotation should focus on application engineering, integration, testing, documentation, and deployment into the supplied NPE foundation.** 

## **5. Mandatory Phase 0 – Reuse Demonstration** 

Before Sleek Relay approves a build quotation, the vendor must demonstrate any claimed reusable capability live. The demonstration must use a Sleek Relay-provisioned number or an agreed temporary test path and must cover: 

- Inbound telephone call from PSTN to AI agent. 

- Natural turn-taking, interruption/barge-in, timeout handling, and safe close-off. 

- FAQ or grounded business-knowledge response. 

- Lead/message capture and confirmation. 

- Appointment request or calendar-booking flow. 

- Human transfer or fallback route. 

- Post-call summary and basic operator/dashboard view. 

- Evidence of tenant configuration, usage tracking, logs, and operational diagnostics. 

**The quotation must clearly separate: (a) components already reusable, (b) components requiring adaptation, and (c) components requiring new development. No rebuild may be quoted without this mapping.** 

## **6. Validation Release Scope – Build Now** 

|**Capability**|**Minimum validation-release requirement**|
|---|---|
|**Tenant setup**|Lightweight multi-tenant confguration for at least three pilot businesses. Tenant isolation must be<br>enforced in data access and credentials.|
|**Assisted self-service**<br>**onboarding**|Business name, website, telephone, category, contact, hours, FAQs, transfer destination, and notifcation<br>settings. Website extraction may draft facts, but owner approval is required before activation.|
|**Core inbound call fow**|AI disclosure, greeting, FAQ, message/lead capture, appointment request or calendar booking, human<br>transfer, and safe fallback.|
|**Post-call close-of**|Structured call outcome, summary, and one transactional SMS or email where confgured.|
|**Basic customer portal**|Activation status, hours, FAQs, transfer destination, messages/summaries, usage, and pause/resume.<br>Simple functional UI is acceptable.|
|**Operator view**|Search/flter calls, inspect trace and outcome, identify failure stage, and view estimated usage/cost.|
|**Usage controls**|Connected-minute counting, call-duration cap, tenant usage cap, token/SMS limits, and visible<br>consumption.|
|**Application security**|Typed allowlisted tools, JSON/schema validation, tenant authorization, idempotency, webhook<br>verifcation, and no unrestricted LLM network/SQL/shell access.|
|**Deployment**|Dockerized services deployed into Sleek Relay NPE through the approved pipeline. No hidden portal-only<br>steps or vendor-owned infrastructure.|
|**Documentation**|Architecture mapping, setup guide, API/confguration notes, deployment/rollback steps, test evidence, and<br>operator runbook.|



## **7. Scope Deferred from This Quotation** 

- Fully autonomous voice-led owner onboarding and a production-grade configuration compiler. 

- Public self-registration, automated subscription billing, complex plan management, reseller, or white-label administration. 

- Dedicated Regulated deployments, customer-managed keys, private endpoints, or customer-specific compliance evidence packages. 

- Multiple production carriers, AWS implementation, or a parallel all-Azure production stack. 

Confidential | July 2026 

Page 3 

**SLEEK RELAY  |  NPE VALIDATION RELEASE RFQ** 

- 100-call scale testing, broad-rollout capacity engineering, or enterprise high availability. 

- Canadian French launch support, advanced analytics, custom integrations, outbound marketing campaigns, or verticalspecific workflows. 

- A polished design system beyond the functional customer and operator screens required for pilot use. 

Deferred items may be shown as separate optional quotations but must not be bundled into the base Validation Release price. 

## **8. Delivery Milestones** 

|**Milestone**|**Deliverable**|**Acceptance gate**|
|---|---|---|
|**0. Reuse demonstration**|Live demonstration, reuse matrix, architecture mapping, assumptions, and fxed<br>milestone quotation.|Quotation approval<br>gate|
|**1. NPE core integration**|Repository setup, application skeleton, carrier adapter, CallRouter, Pipecat pipeline,<br>Azure Speech/Foundry connection, database model, logging, and deployment.|Working inbound call<br>in NPE|
|**2. Pilot workfows**|FAQ, lead/message, appointment request/booking, transfer, summary, SMS/email,<br>lightweight onboarding, and three pilot tenant confgurations.|End-to-end pilot<br>journeys pass|
|**3. Portal and usage**|Basic customer portal, operator diagnostics, usage metering, limits, pause/resume,<br>and confguration updates.|Functional<br>acceptance demo|
|**4. Hardening and handof**|Security tests, tenant-isolation tests, failure paths, deployment/rollback,<br>documentation, knowledge transfer, and warranty start.|Final acceptance and<br>holdback release|



## **9. Minimum Acceptance Criteria** 

|**Area**|**Acceptance condition**|
|---|---|
|**End-to-end operation**|A real inbound call completes FAQ, message/lead, appointment request or booking, transfer/fallback, and<br>post-call summary fows.|
|**Voice experience**|Interruption and endpointing work reliably. Pilot target: p95 caller-end-of-turn to frst audible response no<br>worse than 1.8 seconds under agreed pilot load.|
|**Grounded outcomes**|The system never invents booking, transfer, payment, or confrmation success. System-of-record result is<br>required before speaking success.|
|**Tenant isolation**|Automated tests show no cross-tenant exposure of knowledge, confguration, messages, credentials, storage<br>paths, or logs.|
|**Canadian processing**|Logs and deployment evidence show approved Canadian Speech endpoint and Foundry single-region<br>Canadian deployment with no global fallback.|
|**Failure handling**|Two failed understandings or a dependency outage triggers a deterministic message, callback, voicemail, or<br>human route.|
|**Observability**|Each call has one trace showing stage latency, provider events, tool result, error, recovery action, and<br>estimated usage/cost.|
|**Reproducible**<br>**deployment**|A qualifed engineer can deploy the NPE from repositories and documented pipeline without undocumented<br>vendor actions.|
|**Ownership**|All source, data, accounts, keys, pipelines, documentation, and transition rights remain under Sleek Relay<br>control.|
|**Security**|No unresolved critical or high-severity fnding in the agreed scans and tests at fnal acceptance.|



## **10. Operating-Cost Requirements** 

**The vendor must preserve the long-term technical target of approximately CAD $20-$23 variable cost for a fully** 

Confidential | July 2026 

Page 4 

**SLEEK RELAY  |  NPE VALIDATION RELEASE RFQ** 

**utilized 300-minute tenant, CAD $25 hard ceiling, and approximately CAD $200 shared fixed launch infrastructure. These are engineering constraints, not the disclosed project budget or customer price.** 

- Provide a low/base/high worksheet for 100, 150, and 300 connected minutes. 

- Show carrier minutes, media streaming, STT seconds, TTS characters, model tokens, SMS, transfer legs, onboarding/test allowance, retries, logging, and fixed infrastructure. 

- State the exact connected-minute definition, average call length, speech ratio, transfer rate, second-leg billing, SMS volume, and retry assumptions. 

- Identify any proposed service that would make the operating-cost targets unrealistic before work begins. 

## **11. Quotation and Team Response Format** 

1. Provide a fixed price for each milestone. Do not rely on or request a disclosed Sleek Relay budget ceiling. 

2. Show reused, adapted, and newly built components separately. 

3. Name the technical lead and each team member, role, allocation, relevant voice/telephony experience, and location. 

4. Provide schedule, assumptions, dependencies, exclusions, and the maximum expected duration for each milestone. 

5. State the warranty period, defect response times, knowledge-transfer plan, and post-warranty support options. 

6. Confirm that all work is performed in Sleek Relay-owned accounts and repositories and that no proprietary vendor control plane is required. 

7. Identify every third-party library, commercial dependency, open-source licence, recurring fee, and subprocessor. 

8. Provide two relevant references or demonstrations of real-time voice, telephony, multi-tenant SaaS, or Azure AI delivery. 

9. List all questions or proposed deviations in a separate section. Silence does not constitute approval of an architecture change. 

## **12. Commercial and Delivery Terms** 

- Milestone-based fixed-price contract; no open-ended monthly team commitment for the validation release. 

- Payments tied to accepted working software and evidence, not elapsed time or slide presentations. 

- Recommended final holdback: 15% until hardening, documentation, handoff, and agreed warranty start are accepted. 

- Change requests require written scope, impact, price, and approval before work begins. 

- No production access beyond the minimum approved role; all privileged access is auditable and revocable. 

- No subcontractor may access Sleek Relay systems or data without prior written disclosure and approval. 

**Submission gate: no vendor may begin development until Sleek Relay approves the reuse matrix, architecture mapping, milestone quotation, Canadian data-flow statement, operating-cost worksheet, named team, and delivery schedule.** 

## **13. Vendor Submission Summary** 

|**Company**|[Vendor to complete]|
|---|---|
|**Technical lead**|[Name, title, location, experience]|
|**Reuse demonstrated**|[Yes/No; attach reuse matrix]|
|**Fixed milestone total**|[Vendor quotation; currency and tax treatment]|
|**Delivery duration**|[Calendar weeks]|



Confidential | July 2026 

Page 5 

