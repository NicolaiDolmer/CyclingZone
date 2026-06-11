# Natbølge-runbook — multiagent-fleet om natten

> **On-demand doc.** Auto-loader IKKE (bevidst: 0 cold-start-tokens — derfor doc, ikke skill/saved workflow; orkestreringen er konversationel med ejer-go pr. bølge). Læs FØR enhver natbølge claims. Kanonisk kilde for bølge-protokollen; memory `project_multiagent_fleet_playbook.md` peger hertil. Oprettet efter natbølge 3-postmortem (PC i Modern Standby 4 min efter claim → 0 agenter kørte).

## Pipeline (6 trin — rækkefølgen er ikke valgfri)

| # | Trin | Kommando/handling | Gate |
|---|---|---|---|
| 1 | **Preflight** | `pwsh -File scripts/preflight-night-wave.ps1 -Fix` | Skal printe `[GO]`. NO-GO → løs årsager, kør igen. Aldrig launch på NO-GO. |
| 2 | **Bølgeplan + ejer-go** | Orkestrator poster plan: spor, issues, merge-policy (auto-merge grønne? SQL-policy?), antal agenter | Ejer siger eksplicit go. Go til "kør bølgen" dækker IKKE merge (se trin 5). |
| 3 | **Launch i SAMME tur som go** | Workflow spawnes i samme svar som ejer-go modtages — turen må IKKE slutte mellem claim-commit og launch (natbølge 3-død) | Workflow-kald afsendt |
| 4 | **Launch-bevis** | Ejer SER "Workflow kører — N agenter aktive" på skærmen før maskinen forlades | Intet bevis = bølgen er IKKE startet. Fuld stop, ingen antagelser. |
| 5 | **Merge-protokol** (morgen) | Ejer-go pr. bølge; >5 PR'er = eksplicit bulk-go ([fleet-playbook](../.claude/learnings/) bølge 2). Rækkefølge: backend/lav-konflikt → store UI-PR'er → bredeste PR (med migration) sidst; snapshots refreshes i DENS worktree. `database/2026-*.sql` auto-applies på prod ved merge — review SQL FØR merge. Mellemliggende deploy-verify-fails i en merge-salve er støj; kun SIDSTE merges deploy-verify + auto-migrate tæller. | Alle merges har ejer-go |
| 6 | **Bølge-artifact** | Orkestrator skriver `docs/audits/night-wave-YYYY-MM-DD.md` (template nedenfor) ved close-out | Artifact committet |

## Preflight-detaljer

`scripts/preflight-night-wave.ps1` — idempotent, read-only default; `-Fix` retter kun powercfg-timeouts. JSON-state: `.codex.local/night-wave-preflight.json`.

| Check | NO-GO hvis | Note |
|---|---|---|
| Standby/hibernate AC-timeout | ≠ 0 | `-Fix` kører `powercfg /change standby-timeout-ac 0` + `hibernate-timeout-ac 0`. Kræver evt. elevated shell på nogle OEM-configs. `powercfg /a`-linjen i output afslører Modern Standby (S0) — S0-maskiner kan sove trods timeout 0; verificér første nat. |
| gh GraphQL-probe | Alle 5 forsøg fejler | 1. forsøg fejler ~40% af tiden (kendt) — agenter SKAL bruge 4-5× retry-wrapper med 3-4s pause på alle gh-kald. |
| `git fetch --prune origin` | Fetch fejler | Dirty main-checkout er kun warn (agenter brancher fra origin/main). |
| Ledig disk C: | < 10 GB | Kør `npm run cleanup:worktrees:run` først. |
| node på PATH | Mangler | node_modules-mangler er kun warn. |

## Agent-regler (fra fleet-playbook, bølge 1-3-læringer)

- **Branch fra origin/main som FØRSTE skridt:** `git checkout -b <branch> origin/main` (worktrees oprettet fra HEAD kan stå på en feature-branch).
- **PR-body:** `## Brugerverifikation` med mindst ét `- [x]` ELLER `backend-only`/`docs-only`-label — ellers fejler PR-checket.
- **PatchNotes:** agenter rører IKKE `PatchNotesPage.jsx`; orkestrator laver én konsolideret entry til sidst (undgår merge-konflikter).
- **Relaterede bugs (samme rod-domæne) = ÉN agent** — tjek fil-overlap før fan-out.
- **gh-retry:** alle gh-kald i 4-5× retry-loop (3-4s pause); GraphQL rammes hårdere end REST.
- **frontend-smoke-fejl klassificeres pr. PR:** `did not exit` = teardown-flake (advisory) vs `pixels`/`toHaveScreenshot` = ægte diff → refresh ALLE 3 playwright-projekter.
- **Semantiske kryds-PR-konflikter** (to agenter redesigner samme modul) løses centralt af orkestrator: MERGE intentionerne, vælg ikke side.

## Recovery (workflow dør med parent-session)

Detektion: `git worktree list` + `gh pr list --head <branch>` pr. spor. Genopretning i prioriteret rækkefølge:

| Tilstand | Handling |
|---|---|
| Branch pushet, ingen PR | Opret PR fra worktree'ets `.pr-body-*.md` |
| Uncommitted arbejde i worktree | Fortsæt agent i SAMME worktree (ikke ny worktree) |
| Untracked filer (agent-timeout) | Samme mønster — fortsæt i worktree'et |
| Intet spor | Re-spawn agenten fra issue (frisk) |

`resumeFromRunId` virker kun med uændret agent-rækkefølge — fortsættelser i worktrees er mere robuste.

## Bølge-artifact-template (`docs/audits/night-wave-YYYY-MM-DD.md`)

```markdown
# Natbølge YYYY-MM-DD

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | HH:MM → HH:MM |
| Agenter launched / fuldført / døde | N / N / N |
| PR'er åbnet / merged | N / N |
| Issues → claude:done | #N, #N, ... |
| gh-401-retries (preflight-probe + bølge) | N |
| Recoveries (type) | N (pushed-no-PR: N, uncommitted: N) |
| Preflight | GO kl. HH:MM (.codex.local/night-wave-preflight.json) |

## Afvigelser/læringer
- ...
```

Trend over tid = PR'er pr. bølge pr. wall-clock-time — bruges i [#605](https://github.com/NicolaiDolmer/CyclingZone/issues/605)-sporet som velocity-måling.

---

_Refs #605. Se også: [`AGENT_ARCHITECTURE.md`](AGENT_ARCHITECTURE.md) (parallel-session-safety), [`WORKTREE_WORKFLOW.md`](WORKTREE_WORKFLOW.md), `.claude/learnings/` (natbølge-postmortems)._
