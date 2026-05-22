# DISPATCH_PLAYBOOK.md — safe/forbidden tasks for mobil→PC agentic dispatch

> **Læs hvornår:** Før du dispatch'er en task fra mobilen til din PC (via Claude mobile app's Dispatch-feature, `mcp__scheduled-tasks__create_scheduled_task` eller en CCR/RemoteTrigger-routine). Hvis du sidder ved PC'en og bare kører Claude Code direkte, skipper du denne doc.
> **Kilde:** Workflow-analyse 2026-05-22 ([`docs/archive/2026-05-22-workflow-analyse.md`](archive/2026-05-22-workflow-analyse.md), sektion 3 + 5B). Tracker: [#557](https://github.com/NicolaiDolmer/CyclingZone/issues/557).
> **Sidst opdateret:** 2026-05-22.

## Hvad "dispatch" betyder her (ikke det samme som AGENT_DISPATCH.md)

To navne ligger tæt — hold dem adskilt:

| Doc | Hvad det handler om |
|---|---|
| [`docs/AGENT_DISPATCH.md`](AGENT_DISPATCH.md) | **AI-til-AI handoff via GitHub labels.** Manus-dispatcher-model: `Dispatch #327` → handoff-comment → `@claude` trigger på GitHub. Foregår på PC eller mobil, men målet er at koordinere Manus/Claude/Codex via labels og PRs. |
| **DISPATCH_PLAYBOOK.md (denne)** | **Mobil → PC agentic dispatch.** Du sender en async task til PC'en/skyen mens du selv er væk: scheduled-tasks (cron), Claude mobile app's Dispatch-knap, eller RemoteTrigger/CCR-routines. Du verificerer outcome når du kommer tilbage. |

Resten af denne doc handler udelukkende om #2.

## Hvorfor doc'en findes

Dispatch er et asynkront produkt. Du ser ikke kørslen mens den foregår, og du kan ikke korrigere midtvejs. Det betyder to ting:

1. **Blast radius skal være forudsigelig før kørsel.** Du har ingen "stop"-knap når du er på cykel.
2. **Sandboxe er ofte ephemerale.** CCR-routinen 2026-05-03 "Dark Mode S2" gennemførte 31 fil-edits + commit lokalt, men kunne ikke pushe (GitHub MCP `permitted_tools: []`) og hele arbejdet gik tabt da sandbox blev nedlagt. [Memory: `feedback_remote_routines.md`].

Konsekvens: dispatch er kun for tasks hvor (a) hele kæden er low-risk eller idempotent, (b) outcome kan verificeres uden at have set kørslen, og (c) tab af arbejdet ikke koster mere end en re-run.

## SAFE tasks (default-ja)

| Task-type | Eksempel | Hvorfor safe |
|---|---|---|
| **Read-only audits** | `agent-doctor` ugentlig sundheds-rapport (#346), memory-drift audit (#78), cross-PC forensic audit | Ingen writes til prod, ingen sletninger, output er en rapport eller GitHub-comment. |
| **Scheduled report-jobs** | `time-tracker-weekly-report.json` søndag 21:00, `weekly-memory-audit.json` mandag 09:00 | Cron-baseret, idempotent, output går til GitHub issue eller stdout. Skader intet ved re-run. |
| **External data-fetches** | Hent UCI race-resultater til CSV i `data/`, scrape Vercel deployment-status, pull Discord-feedback fra kanal | Read-only mod 3.-parts API; lokal write til ikke-kritisk fil; ingen DB-mutation. |
| **Test-runs uden commit** | `npm test`, `npx playwright test core-smoke.spec.js`, lint-runs, type-check | Output er pass/fail; ingen state ændres; resultater kan postes til issue-comment. |
| **Docs-only forslag-draft** | Generér første udkast til en archive-doc eller patch-notes-draft til review | Skriver til ny fil eller til en branch; bruger reviewer FØR merge. |
| **Issue-grooming uden close** | Label-audit, sub-issue write, comment-summarisering | GitHub MCP issue_write er reversible (du kan slette labels/comments); ingen issue lukkes uden bruger-godkendelse. |

**Mønsteret:** read-heavy, write-light, alt går gennem en review-gate FØR det rammer noget irreversibelt.

## FORBIDDEN tasks (default-nej)

| Task-type | Hvorfor forbudt | Brug i stedet |
|---|---|---|
| **Production deploy** (Vercel/Railway promote, `gh workflow run deploy-prod`) | Du kan ikke rulle tilbage mens du er på cyklen. En broken deploy rammer 17 brugere. | Claude Code på PC mens du er ved skærmen. |
| **Database migrations** (Supabase migration apply, schema-ændring, RLS-policy-rotation) | Migrations er rarely idempotent. Failure midt i mig kan efterlade DB i invalid state. | PC + Claude Code + lokal verification + brug `database/`-migration-pattern. |
| **Sletninger** (`rm -rf`, `gh issue delete`, GitHub branch deletion, Supabase row-delete, OneDrive-fil-flytning) | Sletninger kan ikke "almost" lykkes. Enten sker det 100% eller 0%. Du har ingen midtvejs-verifikation. | PC med eksplicit `git status`/`gh pr view`-confirmation før hver delete. |
| **Tasks der kræver beslutninger undervejs** (fx "find ud af hvad der er galt og fix det") | Dispatchen kan ikke pause og spørge dig. Den vil enten gætte eller fejle stille. | PC-chat planlægger → Claude Code implementerer, eller mobil→Code prompt med eksplicit acceptance criteria ([`docs/prompts/mobile-to-code.md`](prompts/mobile-to-code.md)). |
| **Secrets-rotation/skrivning** (Infisical, Vercel env, Railway env, GitHub secrets) | Forkert secret bryder produktion, og du opdager det ikke før næste deploy. Kræver runtime-verify on PC. | Manual via PC + dashboard-checklist. Se [`docs/decisions/secret-management-adr.md`](decisions/secret-management-adr.md). |
| **Multi-PR koordinering** (oprette 5 PRs i kæde, hver afhænger af forrige) | Hvis PR #3 fejler, kan dispatch ikke handle på det. Resten lander forkert. | PC-session med plan mode. |
| **PatchNotesPage.jsx bump** | Kollisions-risiko: hvis to commits prøver samme version, fejler en. Kræver `gh api`-tjek mod main FØR commit. | PC, hvor du kan se main's øverste version i samme session. |
| **Branch-mutations på `main`** (force-push, merge uden review, rebase) | Hooks kører måske ikke i sandbox-env'et. `--no-verify` er bidt før. | PC, med branch protection + manuel `gh pr merge`. |

**Mønsteret:** alt der enten muterer prod-state, kræver løbende beslutning, eller mangler en rollback-vej.

## Pre-flight checklist (kør FØR dispatch fyres af)

Før du trykker "send" på dispatchen, gå listen igennem på 30 sekunder:

- [ ] **Idempotens-tjek:** Hvis denne task kører to gange ved et uheld — sker der noget galt? (Ikke-idempotent → dispatch IKKE.)
- [ ] **Write-permission-tjek:** Hvis dispatchen skal pushe en branch eller åbne en PR, har dens MCP-connector reelle write-rettigheder? Tomt `permitted_tools: []` = sandbox kan ikke pushe; dit arbejde tabes. [Memory: `feedback_remote_routines.md`].
- [ ] **Acceptance-felt udfyldt:** Du skriver eksplicit hvad "succeeded" betyder (fx "GitHub-comment posted på #N med rapport", "rapport.md tilføjet til branch", "0 fejl i lint output"). Ikke "det virker".
- [ ] **Output-destination defineret:** Skriver dispatchen til GitHub issue, til en branch, til stdout? Hvis ingen af dem — du kan ikke se hvad der skete.
- [ ] **Blast radius < 5 brugere:** Kører noget mod prod? Hvor mange brugere kan ramme noget galt? Hvis >5 → revurdér.
- [ ] **Recovery-plan:** Hvis dispatchen fejler stille (sandbox dør, MCP-fejl, timeout), kan du detect det og re-runne uden tab? Hvis nej → gør den dispatch'bar først.

Hvis du tøver på et af punkterne, dispatch IKKE. Tag det manuelt på PC i stedet.

## Verification on return (når du kommer tilbage til PC)

Dispatchen rapporterer kun overfladisk status; outcome SKAL verificeres aktivt. Antag aldrig "no news = success".

| Dispatch-type | Verifikations-tjek (i prioriteret rækkefølge) |
|---|---|
| **Scheduled-task (cron)** | 1) `gh issue list --label "agent-doctor"` eller den specifikke issue task'en skriver til — er der ny comment med dagens dato? 2) `~/.claude/scheduled-tasks/<taskId>/runs/` — log fra seneste run (hvis MCP'en gemmer det). 3) Hvis task pushede til branch: `gh pr list --search "head:<task-prefix>"`. |
| **Claude mobile app Dispatch** | 1) Åbn dispatch-historikken i mobile app — succeeded/failed? 2) Hvis branch forventes: `gh pr list --author <bot> --state open`. 3) Hvis comment forventes: `gh issue view N --comments` på target-issue. |
| **CCR/RemoteTrigger-routine** | 1) `claude.ai/code/routines/<id>` i browser — status, log, evt. trunkeret output. 2) `gh api repos/.../branches` — eksisterer branchen? 3) Hvis intet spor: routine fejlede stille i sandbox; planlæg lokalt. [Memory: `feedback_remote_routines.md`]. |
| **Eksternt API-pull** | 1) Forventet output-fil eksisterer (`ls data/<fil>` eller `gh-pr-diff`). 2) Filen er ikke tom og indeholder forventede rækker/keys. 3) Hvis API gav rate-limit: dispatchen burde have detected og rapporteret det. |

**Stille-fejl er den farligste fejl-mode.** Hvis du ikke finder spor af dispatchen efter de 3 tjek, antag at den fejlede uden besked og kør tasken manuelt.

## Gradvis ibrugtagning (krav før dispatch bliver normaliseret)

Dispatch er endnu ikke "tilfældigt tryg" på CyclingZone. Følg denne soak-rytme:

1. **Uge 1:** Kør 1 SAFE dispatch (fx ad-hoc memory-audit). Verificér outcome. Dokumentér i `.claude/learnings/` hvis noget overraskede.
2. **Uge 2:** Hvis uge 1 var clean, tilføj 1 yderligere scheduled-task til canonical-listen (`scripts/scheduled-tasks/*.json`).
3. **Uge 3+:** Når 2+ tasks har kørt clean 4+ uger, kan du dispatchere ad-hoc fra mobil med mindre friction. FORBIDDEN-listen forbliver dog low-water-mark.
4. **Stop-regel:** Hvis 2 dispatches i træk fejler stille på samme symptom → STOP, postmortem, fix root cause før næste dispatch. (Samme regel som `feedback_reproduce_locally_before_push.md`.)

## Anti-patterns

| Forbudt | Hvorfor |
|---|---|
| **Dispatch "fix the bug from Discord" uden konkret scope** | Beslutninger undervejs → dispatchen gætter. Brug i stedet PC-chat → genererer `mobile-to-code`-task → Claude Code på PC. |
| **Dispatch et `npm install` af nyt package** | Lock-fil-mutation + dependency-ændring kræver lokal `npm run build`-verifikation. |
| **Dispatch en deploy "fordi du er på vej hjem og vil have det live ved ankomst"** | Deploy = forbidden. Vent 10 min til du er ved PC. |
| **Antage at "ingen besked" = success** | Sandboxe dør stille. Verificér aktivt per checklist ovenfor. |
| **Dispatche en task der refererer "som vi snakkede om tidligere"** | Dispatch-sandbox har ingen kontekst-historik. Skriv tasken selvindeholdt (samme regel som `mobile-to-code.md`). |

## Cross-refs

- Kanal-til-task matrix: [`docs/AI_CHANNEL_ROUTING.md`](AI_CHANNEL_ROUTING.md) (B1, [#556](https://github.com/NicolaiDolmer/CyclingZone/issues/556)) — placerer dispatch som én af 6 kanaler.
- Mobil → Claude Code task-format (5-linje template): [`docs/prompts/mobile-to-code.md`](prompts/mobile-to-code.md) (B8, [#562](https://github.com/NicolaiDolmer/CyclingZone/issues/562)) — alternativ til dispatch for tasks der ikke skal køre asynkront.
- AI-til-AI handoff (forveksles ofte): [`docs/AGENT_DISPATCH.md`](AGENT_DISPATCH.md) — om Manus/Claude/Codex via GitHub labels.
- Scheduled-tasks infrastruktur: [`scripts/scheduled-tasks/README.md`](../scripts/scheduled-tasks/README.md) — canonical cron-tasks per PC.
- RemoteTrigger burned-fingers postmortem: `feedback_remote_routines.md` (auto-memory) — 2026-05-03 Dark Mode S2 incident.
- Workflow-analyse (kilde): [`docs/archive/2026-05-22-workflow-analyse.md`](archive/2026-05-22-workflow-analyse.md), sektion 3 + 5B.
- Tracker: [#555](https://github.com/NicolaiDolmer/CyclingZone/issues/555) → [#557](https://github.com/NicolaiDolmer/CyclingZone/issues/557) (denne doc).
