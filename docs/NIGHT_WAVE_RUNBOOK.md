# Natbølge-runbook — multiagent-fleet om natten

> **On-demand doc.** Auto-loader IKKE (bevidst: 0 cold-start-tokens — derfor doc, ikke skill/saved workflow; orkestreringen er konversationel med ejer-go pr. bølge). Læs FØR enhver natbølge claims. Kanonisk kilde for bølge-protokollen; memory `project_multiagent_fleet_playbook.md` peger hertil. Oprettet efter natbølge 3-postmortem (PC i Modern Standby 4 min efter claim → 0 agenter kørte).

## Pipeline (7 trin — rækkefølgen er ikke valgfri)

| # | Trin | Kommando/handling | Gate |
|---|---|---|---|
| 1 | **Preflight** | `pwsh -File scripts/preflight-night-wave.ps1 -Fix` | Skal printe `[GO]`. NO-GO → løs årsager, kør igen. Aldrig launch på NO-GO. |
| 2 | **Bølgeplan + ejer-go** | Orkestrator poster plan: spor, issues, merge-policy (auto-merge grønne? SQL-policy?), antal agenter | Ejer siger eksplicit go. Go til "kør bølgen" dækker IKKE merge (se trin 5). |
| 3 | **Launch i SAMME tur som go** | Workflow spawnes i samme svar som ejer-go modtages — turen må IKKE slutte mellem claim-commit og launch (natbølge 3-død) | Workflow-kald afsendt |
| 4 | **Launch-bevis** | Ejer SER "Workflow kører — N agenter aktive" på skærmen før maskinen forlades | Intet bevis = bølgen er IKKE startet. Fuld stop, ingen antagelser. |
| 5 | **Merge-protokol** (morgen) | Ejer-go pr. bølge; >5 PR'er = eksplicit bulk-go ([fleet-playbook](../.claude/learnings/) bølge 2). **Hurtig-merge (4/8, strict=false):** godkendte PRs merges med `gh pr merge --auto --squash` og lander når DERES egen CI er grøn — ingen update-branch/omkørsler. Kryds-PR-kombinationsfejl fanges først af main-CI EFTER merge, derfor: samme-fil-PRs sekvenseres stadig, og rød main = stop-alt-fix-først (se GITHUB_WORKFLOW.md §Hurtige merges). Rækkefølge (= kø-rækkefølge): backend/lav-konflikt → store UI-PR'er → bredeste PR (med migration) sidst; snapshots refreshes i DENS worktree. `database/2026-*.sql` auto-applies på prod ved merge — review SQL FØR merge; post-merge må Claude selv apply/verificere via MCP under #2642-rammerne (AGENTS.md hard rule 9; destruktivt = ejer-gated). Mellemliggende deploy-verify-fails i en merge-salve er støj; kun SIDSTE merges deploy-verify + auto-migrate tæller. | Alle merges har ejer-go |
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
- **Heredoc-forbud i ALLE spawn-prompter (F3-bølgen 21/8: en worker frøs PERMANENT i `<<'EOF'` og døde):** commit-beskeder og filer skrives med Write-værktøjet + `git commit -F <fil>` — aldrig heredoc/inline multi-line. Skriv forbuddet EKSPLICIT ind i hver worker-prompt; memory-reglen arver ikke af sig selv. Samme bølge: linter-/scriptkald der kan hænge (fx migrations-idempotens-linteren) køres som separat kommando med kort timeout — hænger den, skip + notér i PR-body.
- **Launch-bevis-tjek: tæl `started`-entries i workflow-journalen mod forventet antal workers** straks efter launch — en agent kan dø tavst ved spawn (transient classifier-fejl, F3-bølgen 21/8: 5/6 startede, sporet stod usynligt i kø). Manglende spor re-spawnes frisk med det samme.
- **PR-body:** `## Brugerverifikation` med mindst ét `- [x]` ELLER `backend-only`/`docs-only`-label — ellers fejler PR-checket.
- **PatchNotes:** agenter rører IKKE `frontend/src/data/patchNotes.js`; orkestrator laver én konsolideret entry til sidst (undgår merge-konflikter).
- **Relaterede bugs (samme rod-domæne) = ÉN agent** — tjek fil-overlap før fan-out.
- **gh-retry:** alle gh-kald i 4-5× retry-loop (3-4s pause); GraphQL rammes hårdere end REST. Brug den delte wrapper i stedet for copy-paste (#1285): bash → `source scripts/lib/gh-retry.sh` + `gh_with_retry <args>`; PowerShell → `. scripts/lib/gh-retry.ps1` + `Invoke-GhWithRetry @('issue','comment','42','--body','...')`. Defaults: 5 forsøg, 3s pause (override via `GH_RETRY_ATTEMPTS`/`GH_RETRY_DELAY` i bash eller `-Attempts`/`-DelaySeconds` i PS). Preflight flagger desuden degraderet gh-auth som WARN (ikke NO-GO).
- **frontend-smoke-fejl klassificeres pr. PR:** `did not exit` = teardown-flake (advisory) vs `pixels`/`toHaveScreenshot` = ægte diff → refresh ALLE 3 playwright-projekter.
- **Semantiske kryds-PR-konflikter** (to agenter redesigner samme modul) løses centralt af orkestrator: MERGE intentionerne, vælg ikke side.
- **Agenter må IKKE selv spawne baggrunds-underagenter** — de ender i idle-vent på børn hvis notifikationer de aldrig ser (natbølge 12/7: oprydnings-agenten hang 2× sådan og skulle nudges). Skriv eksplicit "arbejd sekventielt, ingen under-agenter" i agent-prompts; orkestratoren ejer al fan-out.
- **Verify/review-agenter: brug `gh pr diff <url>` — ALDRIG `git checkout` i hoved-checkoutet** (eller giv dem også worktree-isolation). Natbølge 19/6: en verify-agent uden isolation checkede en `review/*`-branch ud i hoved-checkoutet og efterlod det dér, så orkestratoren måtte gendanne `main`. Read-only diff-review kræver ingen lokal branch-switch.
- **Lagdelt verifikation (ejer-godkendt 8/8, #3556):** små, isolerede UI-diffs bruger `node scripts/verify-affected.mjs` til målrettede specs lokalt; CI's required checks bærer den fulde suite. TIER FULL-diffs kræver stadig fuld lokal suite. **Kun ÉN fuld e2e-suite ad gangen pr. maskine** (serial test-slot — parallelle `npm run test:e2e`-kørsler deler port/build-artefakter og gav falske fejl, natbølgens læring 7-8/8).

## Orkestrator-regler (ejer-godkendt 5/8 efter natbølge 4.-5./8)

Kanonisk formulering: [`AGENTS.md` §Orkestrering af parallelle agenter](../AGENTS.md) (hard rules 10-15). Den operationelle udgave:

- **Luk hvert spor eksplicit.** Redder du et spors arbejde manuelt, slutter redningen med `TaskStop` — ikke med at PR'en er oprettet. _4 agenter kørte 10-12 timer efter deres arbejde var reddet; >1 mio. tokens._
- **Tjek agent-tilstand med agent-værktøjet.** `TaskList` er todo-listen, ikke baggrundsopgaverne. Skriv hvilket værktøj konklusionen bygger på. _"Ingen agenter kører" var forkert i timevis, målt med det forkerte værktøj._
- **Maks 5 åbne PR'er ad gangen.** Fuld kø → merge før nyt startes. _Køen nåede 23; `patchNotes.js`-konflikterne voksede hurtigere end de blev lukket._
- **Genmål før du dispatcher.** Issue-tal >1 uge gamle er kilder, ikke facts. _247→225.947 · 807→1.399 · "grøn"→90× drift._
- **Dispatch-forfilter pr. kandidat-issue:** `gh issue view N --json state` + findes der en merged PR med `Refs #N`? _4 spor i nat var allerede løst; ét kald pr. kandidat havde fanget alle fire._
- **Isolation før skala:** ✅ lukket 5/8 ([#3367](https://github.com/NicolaiDolmer/CyclingZone/issues/3367)). Worktrees junctioner til en lockfile-hashet cache i `%LOCALAPPDATA%\CyclingZone\node-modules-cache\`, ikke til hoved-checkoutet. Preflight advarer hvis en legacy-junction ind i main dukker op igen. _Delt install ramte 4 af 20 spor; `npm ci` gennem junctionen tømte hoved-checkoutet midt i bølgen._
- **Beslutningsoplæg indeholder målinger, ikke gæt.** Mål først, præsentér så — ét spørgsmål ad gangen.

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
3. **Stall-watchdog (detektion).** Kør `scripts/night-wave-stall-watch.ps1` periodisk (hvert ~8-10 min) under bølgen. Den krydser to ground-truth-signaler: worktree-fremdrift (0 ahead + rent arbejdstræ = intet produceret) og transcript-mtime (frossen > StallMinutes). Flagede spor genoprettes per §Recovery **uden** at vente på barrieren. Auto-detekterer nyeste Workflow-run; `-Json` for maskinlæsbart output. Er en tynd wrapper (#3423) om `scripts/agent-stall-watch.ps1`, som bruges direkte til at overvåge almindelige (ikke-natbølge) worktree-sessioner uden for `.claude/worktrees`.

Kombinér: `status="running"` ≠ fremdrift (jf. memory `feedback_verify_background_progress`). En frossen transcript-mtime + 0 worktree-fremdrift = hang, ikke langsom agent.

> **Natbølge 17/7-læring (orkestratoren vågnede aldrig):** én frossen agent holdt chunk-barrieren åben → ingen completion-notifikation, og ScheduleWakeup-fallback-heartbeaten fyrede aldrig (tavs single point of failure). Maskinen sov IKKE (keep-awake virkede). Konsekvens: 4. lag er obligatorisk — **per-agent timeout i workflow-scriptet** så barrieren aldrig kan hænge evigt, og heartbeat må ALDRIG være eneste vækning. Keep-awake kan orkestratoren selv starte som baggrundsproces ved preflight-GO (bekræftet 17/7). Detaljer: `.claude/learnings/2026-07-17-night-wave-orchestrator-never-woke.md`.

## Læringer 2-3/9 (den store natbølge, 29 spor, 32 PR'er, 31 merget næste formiddag)

- **Lane-pool i stedet for chunk-barrierer:** to Workflow-kald (6 + 2 laner, cap pr. workflow = CPU−2) over én prioriteret kø, hver lane tager næste spor, per-spor `Promise.race`-timeout. Ingen tomme slots; et spor der døde tavst (anti-slop 00:22) kostede kun sin lane i 90 min. Skabelon: memory `project_night_wave_lane_pool_design`. Lette spor: 45-60 min timeout, ikke 90.
- **Merge INGEN drafts i launch-timen.** Ejerens seks merges kl. 23:44 (før launch-commit) gjorde main rød på fire vagter (canary, warning-budget, bundle-budget, feature-liveness) og alle 32 PR'er røde til kl. 08:42 (#4705). Merge drafts FØR launch med CI-fixup, eller efter bølgen.
- **Session-død er normalen, ikke undtagelsen:** begge workflows døde med sessionen; intet gik tabt fordi hvert spor pushede + oprettede sin PR. Monitor-scriptet (bash `sleep`-loop) døde ved start; `gh pr checks --watch` i baggrunds-Bash er det der vækker.
- **GitHub-runner-køen mætter** ved 30+ PR'er × 3 shards + main-kørsler: annullér mellemliggende main-runs (kun nyeste HEAD tæller, jf. §Merge-protokol), opdatér frontend-PR'er først når shard-CI'en (#4665) er inde, og merge den først.
- **Dry-run-rapporter skal bruge apply'ets predikat:** bestyrelses-scriptet listede 37 kandidater, 13 var reelle; apply-guarden var korrekt, rapporten ikke.
- **Go-kort bygges på diffen:** to kort blev afvist fordi parafrasen af PR-body var forkert (#4695 "markedsværdi", #4675 "19 / 25"). Citer locale-strengene ordret (memory `feedback_present_pr_from_diff_not_body`).
- **Rollback-SQL må ikke ligge i `database/2026-*.sql`** (auto-migrate ville køre den ved merge, #4677): manual-only-scripts i `database/manual/` med markøren `KOERES IKKE AUTOMATISK`.

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

## Haendelserne bag hard rules 10-30 (#4502)

> Flyttet hertil fra `AGENTS.md` 31/8. **Reglerne selv staar uaendret i AGENTS.md** og er laast af
> `agents-md-required-rules`-vagten i `scripts/check-agent-token-hygiene.ps1`, som exit 1'er hvis en af
> de 22 bindende regler forsvinder. Kun hændelses-begrundelserne er flyttet, fordi AGENTS.md brød sit
> token-loft (6.574 mod 6.500) da fire nye SSOT-omraader og dev-server-linjen landede samme morgen.
>
> Hændelsen er ikke pynt: en regel uden den hændelse der udloeste den bliver til prosa der drifter.
> Laes dem naar du skal forstaa HVORFOR en regel er skarp, eller naar du overvejer at boeje den.

**Regel 5 - **

- _LOOPS.md) håndhæver dette. **Samme rutine for Hjælp/FAQ** (#1171): ændrer eller tilføjer slicen en spilmekanik spillere skal forstå, opdatér `frontend/public/locales/{en,da}/help.json` (+ `HelpPage.jsx` SECTION_

- _KEYS ved nye blokke) eller skriv hvorfor ikke. **i18n leak-guard (#1068):** `scripts/i18n-check-leaks.mjs` (CI-job `leak-check` + pre-commit via lint-staged) blokerer NYE danske strenge i EN-locale-værdier og player-facing kode. Kendte leaks ligger i `scripts/i18n-leaks-baseline.json` — en ratchet der kun må skrumpe: fix leaks og stram med `node scripts/i18n-check-leaks.mjs --update-baseline` i en dedikeret commit; udvid den ALDRIG med nye leaks. Legitimt dansk (admin-flader, dual-page privacy, PatchNotes-data, brand-termer) tilføjes i stedet til LOCALE_

**Regel 8 - **

- _CONTEXT.md` + `supabase-readonly.env` er HARDLINKEDE til `~/OneDrive/CyclingZone-context/`, ikke kopier. Edit-tool BRYDER hardlinket → drift på næste PC. Efter manuel edit af disse filer: kør `pwsh -File scripts/link-onedrive-context.ps1` for at re-etablere. Ved drift-konflikt: læs INDHOLDET af begge versioner — antag ikke "nyeste timestamp vinder". Pure additive → tag den længere; sletning → STOP og spørg bruger. Default: OneDrive vinder. **Produktionssecrets (`*.env`, `.mcp.json`) er IKKE længere OneDrive-hardlinked** — bootstrappes nu via Infisical (`infisical export --env=dev > backend/.env`); se `docs/decisions/secret-management-adr.md`. Detaljer: `docs/CROSS_

**Regel 10 - Enhver agent har en terminal-tilstand du har SET**

- _Natbølge 4.-5./8: fire agenter kørte videre i 10-12 timer efter deres arbejde var reddet manuelt. Over 1 mio. tokens brændt på spor der var færdige._

**Regel 11 - Paastande om systemtilstand kraever en positiv observation**

- _Samme nat: `TaskList` blev brugt til at konkludere at ingen agenter kørte. TaskList er todo-listen, ikke baggrundsopgaverne — forkert værktøj gav en forkert konklusion der holdt i timevis._

**Regel 12 - Loft paa igangvaerende arbejde: maks 5 aabne PR'er**

- _Køen nåede 23. Konflikterne i `patchNotes.js` voksede hurtigere end de blev lukket, fordi hver ny PR konfliktede med alle de foregående._

**Regel 13 - Ingen paastand uden en maaling**

- _Næsten hvert tal i natbølgens issues var forkert med faktor 10-1000: 247 → 225.947 NULL-rækker · 807 → 1.399 udløbende ryttere · "grøn" økonomi → 90× drift._

**Regel 15 - Mennesket beslutter, AI'en fremskaffer beviset**

- _Gennemgående mønster: beslutningsoplæg byggede på issue-tekster i stedet for på prod._

**Regel 18 - Commit i hoved-checkoutet kun bag branch-guarden**

- _Fejlklassen har bidt 5 gange (11/6, 12/6, 13/6, 6/8, 18/8). Sidste gang skiftede hoved-checkoutets branch tre gange inden for én session, mens en parallel session havde ucommitteret arbejde i træet. Se `.claude/learnings/2026-08-06-shared-checkout-cross-session-commit.md`._

**Regel 19 - Aldrig skip-logik paa prod-deploy-grenen**

- _To hændelser på to dage: 17/8 mistede prod-deploys (skip-logikken åd ægte ændringer); 18/8 stod alle prod-deploys i ERROR fordi `VERCEL_

- _SHA` lå uden for Vercels shallow clone og exit 128 tolkes som deploy-fejl ([#3838](https://github.com/NicolaiDolmer/CyclingZone/issues/3838))._

**Regel 21 - Per-agent-timeout dimensioneres efter samtidighed**

- _Natbølge XL 18/8: 110 min klippede 15 af 32 agenter under 26+ samtidige; e-mail-kæden blev klippet to gange ved 110/150 og leverede på 16 min da maskinen var ledig._

**Regel 22 - Dispatch-forfilter foer HVER spawn**

- _Natbølgen 4.-5./8: fire spor allerede løst. 18/8 formiddag: #3682 lukket 3 dage før. 18/8 eftermiddag: #3066 stod som priority:high-punkt i sessionsprompten men var shipped+lukket 17/8 — ét kald sparede en hel worker._

**Regel 24 - Orkestratoren ejer e2e-slottet**

- _KS3 18/8: workers der selv valgte fuld suite spildte timer på et delt slot._

**Regel 26 - **

- _KEY` — i hvert modul den serverer, så `curl`/`fetch`/`Invoke-WebRequest` mod localhost:5173/5174 lækker nøglen til transcriptet uanset hvilket modul du henter. Screenshots og `read_

**Regel 30 - Omraadets SSOT laeses, citeres og opdateres i samme PR**

- _RULES.md) · holdudtagelse og sæsonplanlægning → [`docs/PLANNING_

- _RULES.md) · **sponsor, kontrakter og arketyper → [`docs/SPONSOR_

- _RULES.md)** · **bestyrelsen, mål og konsekvenser → [`docs/BOARD_

- _RULES.md)** · rytterudvikling, træning og rating → [`docs/PROGRESSION_

- _RULES.md)** · **transfermarked og auktioner → [`docs/TRANSFER_

- _RULES.md` fandtes, var opdateret samme dag og indeholdt ordret advarslen "gulvene er regressionsværn, ikke kvalitetsmål". Linjen var læst. Alligevel blev "1 fritstående enkeltstart OK" rapporteret, hvor 1 kun var et gulv. Ejeren opdagede det selv — ingen gate gjorde. Samme dag blev et Z1-design tegnet med et rollesæt der ville have kollideret med `TeamOrder`-kontrakten, fordi motorens SSOT ikke fandtes endnu._

**Regel 24 - Orkestratoren ejer e2e-slottet**

- _REFERENCE.md` per [#733](https://github.com/NicolaiDolmer/CyclingZone/issues/733) (token-reduktion; Codex cold-start). Indhold bevaret, kun flyttet._
