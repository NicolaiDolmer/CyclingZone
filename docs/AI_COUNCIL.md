# AI_COUNCIL.md — rolle-matrix, SLA og fallback for Claude/Codex/Manus

> **Læs hvornår:** Når en task starter og du er i tvivl om hvilken AI der ejer beslutningen — eller når en agent har siddet for længe på en leverance og du overvejer reassign. Ellers skipper du den.
> **Kilde:** Workflow-analyse 2026-05-22 (`docs/archive/2026-05-22-workflow-analyse.md`, sektion 8), forslag B12.
> **Tracker:** [#564](https://github.com/NicolaiDolmer/CyclingZone/issues/564) (denne doc) under [#555](https://github.com/NicolaiDolmer/CyclingZone/issues/555) (workflow-analyse epic).
> **Sidst opdateret:** 2026-05-23.

## Hvorfor docen findes

`AI_OPS_REFERENCE.md` har en kort rolle-fordeling (udfaset fra AGENTS.md 2026-05-29, [#733](https://github.com/NicolaiDolmer/CyclingZone/issues/733)), og `AI_CHANNEL_ROUTING.md` matcher tasks til kanaler. Men ingen samlet doc svarer på:

1. **Hvem ejer hvilken beslutnings-type?** (kontrakt-design, ADR, hurtige fixes, audits)
2. **Hvor længe må en leverance vente før reassign?** (#327 har stået åben i 10+ dage uden ADR-leverance — det er signalet B12 fanger).
3. **Hvad sker hvis Manus/Codex ikke leverer?** Eskalations-protokol uden den blokerer Claude-eksekvering.

Denne doc er kontrakten der gør de tre svar eksplicitte.

## Council roster

| Agent | Primær rolle | Ejer-share (mål) | Stærk i | Svag i |
|---|---|---|---|---|
| **Claude** | Lead developer + kontrakt-ejer | 80%+ af alle PRs | Multi-fil refactors, kontrakt-design, dybde-research, postmortems, AskUserQuestion-sessioner | Ren ADR-skrivning uden eksekvering (kan bias mod implementation før beslutning) |
| **Codex** | Speed runner | 10-15% (<30 min tasks) | Single-fil bugfixes, test-tilføjelse, docs-cleanup, lint/format, `risk:low` auto-merge-kandidater | Multi-fil kontrakter, beslutninger med uklare specs |
| **Manus** | Architect + ADR-ejer | 5-10% (strategiske valg) | Platform-beslutninger (secret mgmt, hosting), incident-playbooks, cross-domain ADRs der binder Claude/Codex til en linje | Hurtig eksekvering, hyppige hand-offs |

> **Ejer-share er et mål, ikke en kvote.** Hvis Claude tager 95% i en uge fordi der ingen ADRs eller hurtige fixes er, er det fint. Mål-tallet styrer kun reassign-beslutningen når en agent _ikke_ leverer.

### Microsoft Clarity (ikke en agent)

UX-data leverandør — heatmaps, session recordings, dead/rage-click rapporter konverteres til slices via loop I (`docs/AI_LOOPS.md`). Ejer ingen beslutninger.

## Decision-rights matrix

| Beslutnings-type | Ejer | Hvorfor |
|---|---|---|
| Slice-kontrakt (`docs/slices/<slug>.md`) | **Claude** | Kontrakt-sikkerhed er Claudes hovedansvar (`AGENTS.md` rolle-fordeling). |
| Multi-tabel migration | **Claude** | Kræver runtime-verifikation før commit. |
| ADR for platform-valg (secret mgmt, hosting, infra) | **Manus** | Cross-domain konsekvenser → strategisk valg før kode. |
| Bugfix (1 fil, klar root cause) | **Codex** | Hurtig auto-merge med `risk:low` + backend/frontend-tests. |
| Test-tilføjelse til eksisterende feature | **Codex** | Mekanisk, hurtig, lavt-risk. |
| Lint/format/docs-typo | **Codex** | Trivielle, auto-merge-kandidater. |
| Ny feature med uklar spec | **Claude** | AskUserQuestion-session før kode. |
| Audit der spænder kodebasen | **Claude** (med Explore-subagents) | Subagent-orkestrering kræver Claude som koordinator. |
| Doc-konsolidering (samme domæne) | **Claude** | Kontekst-tung, kræver cross-reference verifikation. |
| Incident playbook + postmortem-template | **Manus** | Skabelon-niveau valg der binder fremtidige sessioner. |
| Postmortem af konkret bug | **Claude** | Den AI der fiksede bug'en har konteksten. |
| Visual regression-godkendelse | **Claude** (Playwright via Chrome MCP) | Bruger har ikke iPhone, AI er proxy. |
| Konflikt mellem agenter i samme fil | Den AI der ejede slice-doc'en | Per `AGENTS.md` konflikt-resolution. |

## SLA + deadlines per rolle

| Rolle | Acknowledge | Initial deliverable | Total slice/ADR |
|---|---|---|---|
| **Claude** | Same session (issue picked from `claude:todo`) | Plan eller første commit indenfor 1 session | 1-3 sessioner for slice, 1 session for bugfix |
| **Codex** | Same day (label `agent:codex` + `needs-dispatch`) | PR åbnet indenfor 24t | 24-48t fra dispatch til merge |
| **Manus** | 48t (issue label `agent:manus`) | Draft ADR indenfor 5 dage | 7-10 dage for ADR i `docs/decisions/` |

> **Disse SLAs er forventninger, ikke garantier.** Brugeren styrer reelt agent-tid (Manus-prompts skrives manuelt, Codex dispatches manuelt). SLA-tabellen bruges til at træffe reassign-beslutning, ikke til at presse brugeren.

## Fallback-protokol

Når en agent ikke leverer indenfor SLA, gælder følgende eskalations-trin. Hver trin udløses automatisk hvis foregående ikke har resulteret i progress.

### Trigger: Manus → Claude

- **Symptom:** `agent:manus`-issue åben >7 dage uden ADR-draft committed i `docs/decisions/`.
- **Eksempel:** [#327](https://github.com/NicolaiDolmer/CyclingZone/issues/327) (secret mgmt ADR) — åben siden 2026-05-12, ADR ankom 2026-05-22 (10 dage). Phase 1 implementation blokeret til ADR landede.
- **Reassign-protokol:**
  1. Kommentér på issue: "SLA 7d overskredet — reassigning til Claude med ADR-skabelon."
  2. Skift labels: fjern `agent:manus`, tilføj `agent:claude`.
  3. Claude leverer ADR + implementation i samme slice (én session).
- **Forward-guard:** Hvis 2+ Manus-issues hit denne trigger i samme måned → træk Manus ud af council midlertidigt; ADR-tasks routes direkte til Claude med AskUserQuestion-session.

### Trigger: Codex → Claude

- **Symptom:** `agent:codex`-issue med `needs-dispatch` åben >5 dage uden PR.
- **Eksempel:** [#377](https://github.com/NicolaiDolmer/CyclingZone/issues/377) (ESLint warning debt) — `agent:codex`-label siden 2026-05-15.
- **Reassign-protokol:**
  1. Kommentér: "SLA 5d overskredet — Claude tager den i næste session."
  2. Skift labels: fjern `agent:codex`+`needs-dispatch`, tilføj `claude:todo`.
  3. Claude håndterer (typisk meget hurtigt — Codex-tasks er per definition små).
- **Forward-guard:** Hvis Codex-issue var auto-mergeable men reassigned til Claude, opdatér Codex-routing-kriterierne i `AGENTS.md` rolle-fordeling.

### Trigger: Claude blokeret af ekstern part (Manus/Bruger)

- **Symptom:** Claude-issue har `needs-user-action` eller `manual-review` label >5 dage.
- **Reassign-protokol:**
  1. Claude kommentérer issue med præcis "hvad jeg venter på + hvor det skal komme fra" (én linje).
  2. Bruger informeres i NOW.md `Pending bruger-actions`-sektion.
  3. Issue forbliver Claudes (ingen reassign) — der er ingen anden agent der kan unblock'e.
- **Forward-guard:** Hvis samme blocker-type rammer 3+ issues → spawn meta-issue om at automatisere/dokumentere blocker-handlingen.

## Issue→agent mapping (eksempler fra åbne/lukkede issues)

| Issue | Type | Agent | Hvorfor |
|---|---|---|---|
| [#327](https://github.com/NicolaiDolmer/CyclingZone/issues/327) | Secret mgmt ADR | Manus → leveret 2026-05-22 | Platform-beslutning der binder Claude+Codex til Infisical. |
| [#377](https://github.com/NicolaiDolmer/CyclingZone/issues/377) | ESLint warning debt | Codex (currently pending) | Mekanisk lint-cleanup, auto-merge på risk:low. |
| [#549](https://github.com/NicolaiDolmer/CyclingZone/issues/549) | npm audit dep review | Claude (PR [#576](https://github.com/NicolaiDolmer/CyclingZone/pull/576)) | Multi-fil overrides + verifikation af exploit-paths kræver kontekst-arbejde. |
| [#561](https://github.com/NicolaiDolmer/CyclingZone/issues/561) | Prompt-bibliotek B7 | Claude | Doc-konsolidering på tværs af eksisterende templates. |
| [#564](https://github.com/NicolaiDolmer/CyclingZone/issues/564) (denne doc) | Council meta-doc | Claude | Cross-reference mellem AGENTS.md, AI_CHANNEL_ROUTING.md, og slice-historik. |
| [#454](https://github.com/NicolaiDolmer/CyclingZone/issues/454) (kandidat) | Memory frontmatter | Codex | <30 min, single-doc edit. |
| [#547](https://github.com/NicolaiDolmer/CyclingZone/issues/547) (kandidat) | Stale root-filer cleanup | Codex | 30 min, file-deletion + verify ingen ref-er fra repo. |
| [#240](https://github.com/NicolaiDolmer/CyclingZone/issues/240) | Slice 08 audit | Claude (Explore-subagents) | Spænder hele economy-domænet, kræver subagent-orkestrering. |

> **Bruger-handlings-issues** (`needs-user-action`-label) ejes af ingen AI — det er brugerens hardware/console-handlinger. AI dokumenterer hvad der mangler i NOW.md `Pending bruger-actions`-sektion.

## Conflict resolution (når to agenter har rørt samme fil)

Per `AGENTS.md`-konvention:

1. Den AI der ejede slice-doc'en (eller issue ved nyere arbejde) vinder.
2. Den anden's ændringer flyttes til separat slice/PR.
3. Hvis konflikten er i en delt fil (NOW.md, AGENTS.md, PatchNotesPage.jsx) → den senere session merger manuelt, dokumentérer hvilke ændringer der overlappede.
4. Hvis konflikten skyldes parallel-sessions samme PC → læs `docs/AGENT_ARCHITECTURE.md §Parallel-session-safety`.

## Council-revision

Denne doc opdateres når:

- En reassign-trigger rammes 2+ gange i samme måned (juster SLA eller ejer-share).
- Et nyt agent-typer tilføjes (fx en specialiseret subagent-konfiguration eller en ny ekstern AI).
- En SLA viser sig urealistisk efter 3+ datapoints (typisk for kort tid).
- Council-roster ændres (agent fjernes/tilføjes).

> **Memory-disciplin:** Council-revisioner skrives _her_, ikke i memory. Memory bruges kun til runtime-rules der gælder >50% af sessioner (per HOT-tier-doktrin).

## Cross-refs

- Rolle-grundlag (kort version): [`AI_OPS_REFERENCE.md` §Rolle-fordeling](AI_OPS_REFERENCE.md#rolle-fordeling-mellem-ai-assistenter-verdensklasse-ai-standard) (udfaset fra AGENTS.md 2026-05-29, [#733](https://github.com/NicolaiDolmer/CyclingZone/issues/733)).
- Kanal-til-task matrix (hvilken kanal en task hører i): [`docs/AI_CHANNEL_ROUTING.md`](AI_CHANNEL_ROUTING.md).
- Dispatch safe/forbidden tasks (mobil→PC agentic): [`docs/DISPATCH_PLAYBOOK.md`](DISPATCH_PLAYBOOK.md).
- Session-prompt templates (når en agent picker en task): [`docs/prompts/`](prompts/).
- Parallel-session safety: [`docs/AGENT_ARCHITECTURE.md`](AGENT_ARCHITECTURE.md).
- ADR-eksempel (secret mgmt, Manus-leveret): [`docs/decisions/secret-management-adr.md`](decisions/secret-management-adr.md).
- Workflow-analyse (kilde): [`docs/archive/2026-05-22-workflow-analyse.md`](archive/2026-05-22-workflow-analyse.md) sektion 8.
- Tracker: [#555](https://github.com/NicolaiDolmer/CyclingZone/issues/555) (workflow-analyse epic) → [#564](https://github.com/NicolaiDolmer/CyclingZone/issues/564) (denne doc).
