# Natbølge-runbook — multiagent-fleet om natten

> **On-demand doc.** Auto-loader IKKE (bevidst: 0 cold-start-tokens — derfor doc, ikke skill/saved workflow; orkestreringen er konversationel med ejer-go pr. bølge). Læs FØR enhver natbølge claims. Kanonisk kilde for bølge-protokollen; memory `project_multiagent_fleet_playbook.md` peger hertil. Oprettet efter natbølge 3-postmortem (PC i Modern Standby 4 min efter claim → 0 agenter kørte).

## Pipeline (7 trin — rækkefølgen er ikke valgfri)

| # | Trin | Kommando/handling | Gate |
|---|---|---|---|
| 1 | **Preflight** | `pwsh -File scripts/preflight-night-wave.ps1 -Fix` | Skal printe `[GO]`. NO-GO → løs årsager, kør igen. Aldrig launch på NO-GO. |
| 2 | **Bølgeplan + ejer-go** | Orkestrator poster plan: spor, issues, merge-policy (auto-merge grønne? SQL-policy?), antal agenter | Ejer siger eksplicit go. Go til "kør bølgen" dækker IKKE merge (se trin 5). |
| 3 | **Launch i SAMME tur som go** | Workflow spawnes i samme svar som ejer-go modtages — turen må IKKE slutte mellem claim-commit og launch (natbølge 3-død) | Workflow-kald afsendt |
| 4 | **Launch-bevis** | Ejer SER "Workflow kører — N agenter aktive" på skærmen før maskinen forlades | Intet bevis = bølgen er IKKE startet. Fuld stop, ingen antagelser. |
| 5 | **Merge-protokol** (morgen) | Ejer-go pr. bølge; >5 PR'er = eksplicit bulk-go ([fleet-playbook](../.claude/learnings/) bølge 2). Rækkefølge: backend/lav-konflikt → store UI-PR'er → bredeste PR (med migration) sidst; snapshots refreshes i DENS worktree. `database/2026-*.sql` auto-applies på prod ved merge — review SQL FØR merge. Mellemliggende deploy-verify-fails i en merge-salve er støj; kun SIDSTE merges deploy-verify + auto-migrate tæller. | Alle merges har ejer-go |
| 5b | **Done-flip pr. merged issue (OBLIGATORISK)** | Umiddelbart efter HVER merge: `gh issue edit <N> --add-label claude:done --remove-label claude:todo` + kort shipped-kommentar med PR-nr (via gh-retry-wrapper). Gør det PR-for-PR i merge-løkken — ikke som et separat "til sidst"-trin der glemmes. | **Nul af bølgens merged issues må stå tilbage som `claude:todo`.** Den hyppigste close-out-fejl: PR merges, issue glemmes → backlog fyldes med done-men-åbne issues (ejer-frustration 2026-06-21: ~14 done issues stod stadig som todo). |
| 6 | **Bølge-artifact + done-verifikation** | Orkestrator skriver `docs/audits/night-wave-YYYY-MM-DD.md` (template nedenfor) ved close-out — inkl. udfyldt `Issues → claude:done`-række. | Artifact committet **og** done-flip verificeret: `gh issue list --label claude:todo` viser ingen af bølgens merged issues. |

## Preflight-detaljer

`scripts/preflight-night-wave.ps1` — idempotent, read-only default; `-Fix` retter kun powercfg-timeouts. JSON-state: `.codex.local/night-wave-preflight.json`.

| Check | NO-GO hvis | Note |
|---|---|---|
| Standby/hibernate AC-timeout | ≠ 0 | `-Fix` kører `powercfg /change standby-timeout-ac 0` + `hibernate-timeout-ac 0`. Kræver evt. elevated shell på nogle OEM-configs. `powercfg /a`-linjen i output afslører Modern Standby (S0) — S0-maskiner kan sove trods timeout 0; verificér første nat. |
| gh GraphQL-probe | Alle 5 forsøg fejler | 1. forsøg fejler ~40% af tiden (kendt) — agenter SKAL bruge 4-5× retry-wrapper med 3-4s pause på alle gh-kald. |
| `git fetch --prune origin` | Fetch fejler | Dirty main-checkout er kun warn (agenter brancher fra origin/main). |
| Ledig disk C: | < 10 GB | Kør `npm run cleanup:worktrees:run` først. |
| node på PATH | Mangler | node_modules-mangler er kun warn. |
| origin/main test-sanity (frontend `node --test`) | Basen fejler frontend `node --test` | Fanger en rød `origin/main` FØR en fleet brancher fra den (natbølge 23/6: ugyldig patch-notes-category brækkede `frontend-build` på ALLE 15 PR'er → unblocker-PR [#1772](https://github.com/NicolaiDolmer/CyclingZone/issues/1772)). Kører kun når arbejdstræets `frontend/` er identisk med `origin/main` (ellers WARN: synk checkout og kør igen). Holdt let (~2s): kun frontend `node --test` — build forbliver CI's required `frontend-build`-gate; backend udeladt (~17s). JSON-state: `originMainTest` = green/red/diverged/skip. |

## Agent-regler (fra fleet-playbook, bølge 1-3-læringer)

- **Branch fra origin/main som FØRSTE skridt:** `git checkout -b <branch> origin/main` (worktrees oprettet fra HEAD kan stå på en feature-branch).
- **PR-body:** `## Brugerverifikation` med mindst ét `- [x]` ELLER `backend-only`/`docs-only`-label — ellers fejler PR-checket.
- **PatchNotes:** agenter rører IKKE `PatchNotesPage.jsx`; orkestrator laver én konsolideret entry til sidst (undgår merge-konflikter).
- **Relaterede bugs (samme rod-domæne) = ÉN agent** — tjek fil-overlap før fan-out.
- **gh-retry:** alle gh-kald i 4-5× retry-loop (3-4s pause); GraphQL rammes hårdere end REST. Brug den delte wrapper i stedet for copy-paste (#1285): bash → `source scripts/lib/gh-retry.sh` + `gh_with_retry <args>`; PowerShell → `. scripts/lib/gh-retry.ps1` + `Invoke-GhWithRetry @('issue','comment','42','--body','...')`. Defaults: 5 forsøg, 3s pause (override via `GH_RETRY_ATTEMPTS`/`GH_RETRY_DELAY` i bash eller `-Attempts`/`-DelaySeconds` i PS). Preflight flagger desuden degraderet gh-auth som WARN (ikke NO-GO).
- **frontend-smoke-fejl klassificeres pr. PR:** `did not exit` = teardown-flake (advisory) vs `pixels`/`toHaveScreenshot` = ægte diff → refresh ALLE 3 playwright-projekter.
- **Semantiske kryds-PR-konflikter** (to agenter redesigner samme modul) løses centralt af orkestrator: MERGE intentionerne, vælg ikke side.
- **Agenter må IKKE selv spawne baggrunds-underagenter** — de ender i idle-vent på børn hvis notifikationer de aldrig ser (natbølge 12/7: oprydnings-agenten hang 2× sådan og skulle nudges). Skriv eksplicit "arbejd sekventielt, ingen under-agenter" i agent-prompts; orkestratoren ejer al fan-out.
- **Verify/review-agenter: brug `gh pr diff <url>` — ALDRIG `git checkout` i hoved-checkoutet** (eller giv dem også worktree-isolation). Natbølge 19/6: en verify-agent uden isolation checkede en `review/*`-branch ud i hoved-checkoutet og efterlod det dér, så orkestratoren måtte gendanne `main`. Read-only diff-review kræver ingen lokal branch-switch.

## Recovery (workflow dør med parent-session)

Detektion: `git worktree list` + `gh pr list --head <branch>` pr. spor. Genopretning i prioriteret rækkefølge:

| Tilstand | Handling |
|---|---|
| Branch pushet, ingen PR | Opret PR fra worktree'ets `.pr-body-*.md` |
| Uncommitted arbejde i worktree | Fortsæt agent i SAMME worktree (ikke ny worktree) |
| Untracked filer (agent-timeout) | Samme mønster — fortsæt i worktree'et |
| Intet spor | Re-spawn agenten fra issue (frisk) |

`resumeFromRunId` virker kun med uændret agent-rækkefølge — fortsættelser i worktrees er mere robuste.

## Anti-hang (stall-watchdog + chunking + keep-awake)

> **Indført efter natbølge 2026-07-03.** Maskinen gik i **S0 Modern Standby ~01:15** midt i kørslen (trods `standby-timeout-ac=0`) → 2 agenter frøs → `parallel()`-barrieren ventede evigt på dem → **ingen completion-notifikation**. Hanget blev først opdaget ~7 timer senere. 18/21 spor nåede i mål; de 2 frosne (+ 1 falsk-positiv) blev genoprettet manuelt. Tre lag lukker hullet:

1. **Keep-awake (rod-årsag).** `powercfg standby-timeout-ac=0` er IKKE nok på en S0-maskine. Kør `scripts/keep-awake.ps1` i sit EGET terminal-vindue for hele bølgens varighed (`SetThreadExecutionState(ES_SYSTEM_REQUIRED)` holder systemet vågent så længe processen kører). Preflightens `powercfg /a`-linje afslører om maskinen er S0 (Standby S0 Low Power Idle) — er den det, er keep-awake obligatorisk.
2. **Chunking (blast-radius).** Launch fleet'et i **flere Workflow-kald på ~6-8 agenter hver**, ikke ét stort 21-agent-`parallel()`-barrier. Et hang fryser da kun sit eget chunk; de øvrige chunks fuldfører + notificerer, så orkestratoren ser resultater inden for minutter og kan genoprette det frosne chunk uden at hele bølgen står stille. Checkpoint mellem chunks.
3. **Stall-watchdog (detektion).** Kør `scripts/night-wave-stall-watch.ps1` periodisk (hvert ~8-10 min) under bølgen. Den krydser to ground-truth-signaler: worktree-fremdrift (0 ahead + rent arbejdstræ = intet produceret) og transcript-mtime (frossen > StallMinutes). Flagede spor genoprettes per §Recovery **uden** at vente på barrieren. Auto-detekterer nyeste Workflow-run; `-Json` for maskinlæsbart output.

Kombinér: `status="running"` ≠ fremdrift (jf. memory `feedback_verify_background_progress`). En frossen transcript-mtime + 0 worktree-fremdrift = hang, ikke langsom agent.

> **Natbølge 17/7-læring (orkestratoren vågnede aldrig):** én frossen agent holdt chunk-barrieren åben → ingen completion-notifikation, og ScheduleWakeup-fallback-heartbeaten fyrede aldrig (tavs single point of failure). Maskinen sov IKKE (keep-awake virkede). Konsekvens: 4. lag er obligatorisk — **per-agent timeout i workflow-scriptet** så barrieren aldrig kan hænge evigt, og heartbeat må ALDRIG være eneste vækning. Keep-awake kan orkestratoren selv starte som baggrundsproces ved preflight-GO (bekræftet 17/7). Detaljer: `.claude/learnings/2026-07-17-night-wave-orchestrator-never-woke.md`.

## Vercel deploy-rate-limit (høj-tempo-bølger)

**Status 2026-06-23: projektet er på Vercel Pro** — det aggressive hobby-rate-limit ("retry in 24 hours", ramt 2026-06-20 efter ~13 hurtige merges) gælder derfor ikke længere i praksis. *Historisk på hobby-tier:* en høj-tempo-bølge kunne fryse **frontend-prod på sidste gode deploy** indtil reset/manuel re-deploy; **Railway (backend) var upåvirket**. Pro kan teoretisk stadig ramme et loft ved ekstreme bølger — overvåg, men forvent ikke 24t-frys.
- **Forebyg:** Pro løfter loftet markant; kun ved ekstreme bølger er det relevant at batche frontend-merges.
- **Detektér:** `gh api repos/<repo>/commits/main/status --jq '.statuses[]|select(.context|test("Vercel"))|.state+" | "+.description'` → "rate limited".
- **Håndtér:** bloker IKKE merges på Vercel-checken (advisory) — verificér frontend via CI `frontend-build` (required) i stedet. Prioritér backend-arbejde (Railway-deploybart) under lockout. Notér tydeligt i close-out at frontend venter deploy.

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
