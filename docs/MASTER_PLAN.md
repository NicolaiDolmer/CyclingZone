# MASTER PLAN — CyclingZone styring, prioritering og AI-arbejdsmodel

> **Status:** Aktiv styringskontrakt fra 2026-05-19.  
> **Formål:** Én varig plan for hvad der skal gøres, i hvilken rækkefølge, og hvilken agent der bør udføre hvad.  
> **Scope:** Validation sprint, Discord community, brand identity, i18n/oversættelse, commercial readiness og GitHub/AI-workflow.  
> **Regel:** Hvis `docs/NOW.md`, GitHub-issues eller en agent-session er i konflikt med denne fil, skal konflikten afklares og dokumenteres her eller i `NOW.md` før nyt arbejde startes.

---

## 1. Single source of truth

CyclingZone skal styres fra GitHub, ikke fra løse chat-tråde. Chat med Manus, Claude Code eller Codex må gerne bruges til analyse og udførelse, men varige beslutninger, status og næste skridt skal ende i repoet eller GitHub-issues.

| Lag | Fil/sted | Funktion | Opdateres hvornår |
| --- | --- | --- | --- |
| **Strategisk masterplan** | `docs/MASTER_PLAN.md` | Prioriteter, agentroller, beslutningsregler og samlet roadmap. | Når prioritet eller arbejdsmodel ændres. |
| **Aktuel handoff** | `docs/NOW.md` | Næste konkrete session og senest leveret. Skal være kort. | Ved close-out af hver session. |
| **Validation scoreboard** | `docs/SPRINT_DASHBOARD.md` | Sprint-metrics, status, week-by-week execution og Go/Iterate/No-Go. | Mindst ugentligt under sprint; oftere ved større statusændringer. |
| **Forretningsstrategi** | `docs/BUSINESS_STRATEGY.md` | Tier-struktur, non-P2W-politik, legal/commercial blockers og Go/No-Go framework. | Kun når strategi eller beslutninger ændres. |
| **Brand source of truth** | `docs/brand/DECISIONS_LOG.md` + `docs/brand/PROJECT_PLAN.md` | Låste brandbeslutninger og næste brandfase. | Efter hver brandbeslutning. |
| **Execution layer** | GitHub issues | Hver konkret kode-, design-, docs- eller research-opgave. | Før arbejde starter og ved close-out. |
| **PR/commit layer** | Pull requests + commits | Hvad der faktisk ændrede sig. | Ved hver leverance. |

**Best practice fremover:** Start ikke en ny større session fra hukommelse. Start fra `AGENTS.md`, `docs/GUARDRAILS_CORE.md`, `docs/NOW.md` og denne `docs/MASTER_PLAN.md`. Hvis sessionen matcher brand, sprint eller i18n, læses den relevante specialfil derefter.

---

## 2. Overordnet prioriteringsregel frem til 2026-06-17

Frem til validation sprinten er afsluttet, skal alt arbejde prioriteres efter om det hjælper med at validere forretningen eller fastholde beta-spillere.

> **P0-regel:** En opgave er P0/P1 under sprinten, hvis den direkte hjælper med survey-svar, waitlist-signups, Discord-feedback, interviews, retention, mobile onboarding eller blocker-fjernelse før commercial launch.

| Prioritet | Kriterium | Eksempler | Hvad skal parkeres |
| --- | --- | --- | --- |
| **P0 — Sprint outcome** | Påvirker Go/Iterate/No-Go-data direkte. | Discord feedback-loop, survey, interview-DMs, waitlist funnel, metrics sync. | Bot-polish, deep UI redesign, post-Go payment-build. |
| **P1 — Trust og retention** | Reducerer churn eller øger tillid hos aktive beta-spillere. | Mobile performance, balance-/auction-trust bugs, i18n high-traffic pages. | Lavtrafik-polish. |
| **P2 — Brand og acquisition support** | Gør public surfaces mere professionelle uden at blokere sprint. | Brand Phase 2 palette, Discord/social assets, recruitment drafts. | At genåbne låste logo-/typografi-beslutninger. |
| **P3 — Commercial readiness** | Skal være klar før betaling, men bør vente på sprintsignal. | MoR/Stripe/Paddle, ApS/CVR, UCI/IP, fiktivt univers. | Betalingsimplementation før Go. |
| **P4 — Ops/tech debt** | Forbedrer robusthed, men skaber ikke sprintdata. | Webhook health-check, admin economy dashboard phase B, AI hooks. | Alt der ikke er konkret flaskehals. |

---

## 3. Agentroller: hvem gør hvad?

Manus, Claude Code og Codex skal ikke bruges til det samme. Den højeste kvalitet kommer ved at lade hver agent gøre det, den er bedst til, og lade GitHub være fælles hukommelse.

| Arbejdstype | Primær agent | Sekundær agent | Hvorfor |
| --- | --- | --- | --- |
| **Strategi, prioritering og plan-syntese** | **Manus** | Bruger | Manus skal være PM/strategisk sparringspartner, samle planer, holde overblik og formulere beslutningsmemoer. |
| **Survey, interview, Discord copy og tone** | **Manus** | Claude Code ved repo-docs | Manus er bedst til struktureret kommunikation, syntese og go-to-market-materiale. |
| **Brandbeslutninger og visuelle valg** | **Claude Code** | Manus til kriterier og beslutningsmemo | Claude Code kan arbejde i repo, previewe assets og opdatere brand-log; Manus kan holde processen skarp. |
| **Frontend/backend kodeændringer** | **Claude Code** | Codex til smalle patches | Claude Code bør eje sammenhængende slices, tests, patch notes og close-out. |
| **Små isolerede bugfixes/refactors** | **Codex** | Claude Code ved review | Codex er bedst til afgrænsede kodeopgaver med tydelig issue-kontrakt. |
| **Runtime verification og test-fix** | **Claude Code** | Codex til enkeltfejl | Kræver repo-kontekst, tests og close-out-disciplin. |
| **GitHub hygiene og status-audit** | **Manus** | Claude Code ved commits | Manus kan identificere stale issues og foreslå issue-comments; Claude Code kan udføre repo-close-out. |
| **Legal, CVR, betaling, eksterne aftaler** | **Bruger** | Manus til research-spørgsmål | Juridiske og kommercielle valg kræver brugerbeslutning og evt. rådgivere. |

### Tommelfingerregel

Hvis opgaven handler om **hvad vi bør gøre og hvorfor**, start med Manus. Hvis opgaven handler om **at ændre kode eller repo-filer**, brug Claude Code. Hvis opgaven er **en lille isoleret kodeændring med klar definition of done**, brug Codex.

---

## 4. Aktuel master-rækkefølge

Denne rækkefølge erstatter løs prioritering på tværs af chat-tråde. Den må kun ændres, hvis der kommer nye data fra sprinten eller en blocker opstår.

| Rækkefølge | Step | Primær agent | Output | Definition of done |
| --- | --- | --- | --- | --- |
| 1 | **Status-synk efter audit** | Manus → Claude Code | `SPRINT_DASHBOARD.md` og `NOW.md` afspejler faktisk GitHub-state. | Stale checkboxes/issue-status er rettet eller kommenteret. |
| 2 | **Naming + fair freemium messaging** | Manus | Tier-navne, PatchNotes-copy, Discord-launch copy, survey wording. | #366 kan løses uden ny afklaring. |
| 3 | **Discord validation loop** | Manus + bruger | `#fair-premium-feedback`, poll, top-player DM-skabelon og interview-plan. | Første poll/DM-batch er sendt eller klar til paste. |
| 4 | **Survey publicering** | Manus + bruger | Tally/Forms-spørgsmål, introtekst, privacy wording, price sensitivity. | Survey-link klar og delt i Discord/app CTA. |
| 5 | **Mobile performance på waitlist** | Claude Code eller Codex | #479 triageret og evt. fixet. | `/founder-supporter` er acceptabel på mobil før bred recruitment. |
| 6 | **Brand Phase 2 — color palette** | Claude Code | Light/dark palette, token-retning, brand decision-log. | Palette låst uden at genåbne logo/typografi. |
| 7 | **i18n Fase 3.5 high priority** | Claude Code | #412/#484 status-afstemt; #485 og #486 prioriteret. | Mindst én high-priority authenticated page færdig pr. session. |
| 8 | **Recruitment assets** | Manus | Reddit/Discord drafts og kanalplan (#472). | Drafts klar med tone, kanal og CTA. |
| 9 | **Discord funnel automation** | Claude Code/Codex | #427 først; #424-#426 kun efter behov. | Discord-link i relevante public/user surfaces. |
| 10 | **Commercial readiness efter signal** | Manus + bruger + rådgivere | MoR/ApS/UCI/IP decision memo. | Klar beslutning før betaling implementeres. |

---

## 5. Næste konkrete sessioner

Disse sessioner skal køres én ad gangen. Hver session skal slutte med opdateret `NOW.md`, opdaterede relevante issues, og commit/push hvis repo-filer er ændret.

| Session | Skal udføres af | Startprompt | Output |
| --- | --- | --- | --- |
| **A — Status-synk og masterplan landing ([#497](https://github.com/NicolaiDolmer/CyclingZone/issues/497))** | Claude Code | “Læs `AGENTS.md`, `docs/GUARDRAILS_CORE.md`, `docs/NOW.md` og `docs/MASTER_PLAN.md`. Synkronisér `SPRINT_DASHBOARD.md` og `NOW.md` med masterplanen og faktisk GitHub-state.” | Dashboard/NOW matcher plan og issue-state. |
| **B — Naming og fair freemium copy** | Manus | “Brug `BUSINESS_STRATEGY.md`, `TONE_OF_VOICE.md` og `MASTER_PLAN.md`. Lav tier naming-beslutning og skriv PatchNotes-, Discord-, survey- og landing-copy.” | Copy klar; #366 kan udføres. |
| **C — Discord validation loop** | Manus + bruger | “Lav konkret Discord poll, DM til top-spillere og interview-flow for validation sprinten.” | Første feedback-loop live. |
| **D — #366 implementation** | Claude Code eller Codex | “Implementér PatchNotes-entry om fair freemium-eksperiment ud fra godkendt copy.” | #366 lukket/kommenteret. |
| **E — #479 mobile performance triage** | Codex eller Claude Code | “Triagér `/founder-supporter` mobile performance og lav smallest safe fix.” | Mobil waitlist ikke flaskehals for recruitment. |
| **F — Brand Phase 2** | Claude Code | “Start fra `docs/brand/HANDOFF_PROMPT.md`, men respekter `MASTER_PLAN.md`: kun palette light/dark, ingen logo-genåbning.” | Palette låst og dokumenteret. |
| **G — i18n Fase 3.5** | Claude Code | “Status-afstem #412/#484 og implementér næste high-priority page efter #482-pattern.” | Én side færdig pr. session. |

---

## 6. GitHub best practice fremover

Hver større opgave skal have præcis ét “hjem”. Hvis den ikke har et hjem, oprettes et issue eller en slice-doc før arbejdet starter. Hvis den allerede har et hjem, må der ikke oprettes parallelle dokumenter med modstridende status.

| Opgavetype | Bedste GitHub-hjem | Regel |
| --- | --- | --- |
| Strategisk plan | `docs/MASTER_PLAN.md` | Ikke i issues alene. Issues er execution, ikke strategi. |
| Aktuelt næste arbejde | `docs/NOW.md` | Skal være kort og pege på én næste session. |
| Kodefeature/bug | GitHub issue | Issue skal have definition of done og label. |
| Stor kode-slice | `docs/slices/<slug>.md` + issue | Slice-doc er kontrakt; issue er execution tracker. |
| Brandbeslutning | `docs/brand/DECISIONS_LOG.md` | Beslutninger er append-only og kræver visuel bekræftelse ved designvalg. |
| Sprint-data | `docs/SPRINT_DASHBOARD.md` | Metrics skal ikke gemmes i chats. |
| Research til beslutning | `docs/decisions/<slug>.md` eller issue-comment | Skal have konklusion, kilder og næste handling. |

---

## 7. Session close-out checklist

Enhver agent-session skal slutte med denne korte kontrol. Hvis den ikke er opfyldt, er arbejdet ikke færdigt.

| Punkt | Krav |
| --- | --- |
| Status | `docs/NOW.md` afspejler næste startpunkt. |
| Plan | Hvis prioritet ændrede sig, er `docs/MASTER_PLAN.md` opdateret. |
| Issues | Relevante GitHub-issues er kommenteret, lukket eller korrekt label'et. |
| Docs | `SPRINT_DASHBOARD.md`, brand-log eller slice-docs er opdateret ved behov. |
| Patch notes | Ved brugerrettet ændring: `frontend/src/pages/PatchNotesPage.jsx` opdateret. Ved ren plan/docs: skriv eksplicit at patch notes ikke er nødvendigt. |
| Verification | Tests, smoke eller runtime-check er dokumenteret. Hvis ikke muligt, markér “ikke runtime-verificeret”. |
| Git | Commit + push efter godkendelse, og ingen utilsigtede tempfiler i `git status`. |

---

## 8. Aktuel beslutning

Den aktive styringsbeslutning er: **Validation sprinten har forrang over brand-polish, bot-polish og post-Go betaling frem til 2026-06-17**. Brand Phase 2 og i18n fortsætter kun, hvis sprintens feedback-loop ikke blokeres.

**Næste bedste handling:** Kør Session A med Claude Code via [#497](https://github.com/NicolaiDolmer/CyclingZone/issues/497): land denne masterplan i repoet, synkronisér `NOW.md` og `SPRINT_DASHBOARD.md`, og gør næste session tydelig: naming + fair freemium messaging.

