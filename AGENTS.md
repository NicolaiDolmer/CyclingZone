# AGENTS.md

Fælles kontrakt. Codex læser **CLAUDE.md først**. Detaljer og begrundelser: [AGENT_RULE_DETAILS.md](docs/AGENT_RULE_DETAILS.md); rolle-/cross-PC-/session-reference: [AI_OPS_REFERENCE.md](docs/AI_OPS_REFERENCE.md). Læs relevante afsnit ved behov, ikke hele referencefiler ved hver start. Ejerens seneste mandat har forrang. Denne session (18/10): **Claude merger; Codex merger aldrig.**

## Hard rules

Numrene er stabile. Hver regels fulde uddybning findes som `docs/AGENT_RULE_DETAILS.md#regel-N`; nedenstående krav gælder altid. Hændelser bag 10-30: [NIGHT_WAVE_RUNBOOK.md](docs/NIGHT_WAVE_RUNBOOK.md). Mekanisk bevis: [GUARD_INVENTORY.md](docs/GUARD_INVENTORY.md).

1. **Repo-root:** `git rev-parse --show-toplevel` før arbejde. Matcher root ikke brugerens workspace eller den udtrykkeligt oprettede worktree, stop og bed om realignment. Ingen andre kopier.
2. **Delt context:** varig state, beslutninger, læring og handoff i GitHub/repo eller OneDrive-hardlinks. Lokale transcripts, memories og `.codex.local/SESSION_CONTEXT.md` er regenererbare caches, aldrig eneste bevis. Migrér lokal-only fremskridt før slut.
3. **Runtime før status:** læs relevant kode eller `git log --grep` før TODO-/bug-påstande fra gamle noter. Ubekræftet status mærkes **❓ ikke runtime-verificeret**.
4. **Teknisk tvivl undersøges:** reversible tekniske valg inden for mandat afgøres med opslag/test. Spilleroplevelse, balance, prioritet eller manglende mandat kræver beslutning med bevis, anbefaling og konsekvens. Genbrug godkendelser; hovedsessionen ejer afslutningen ([CODEX_WORKFLOWS](docs/CODEX_WORKFLOWS.md)).
5. **Patch notes:** enhver brugerrettet ændring dækkes i `frontend/src/pages/PatchNotesPage.jsx`, ellers begrundes undtagelsen eksplicit. Bølge-PR samler ved close-out og siger det i body. Versionsguard beviser ikke dækning. Codex skriver aldrig spillertekst.
6. **Slice close-out:** issue-status + NOW (Claude), FEATURE_REGISTRY afstemt + `node scripts/generate-feature-status.mjs`, patch notes, bug-postmortem i `.claude/learnings/`, doc-drift mod ARCHITECTURE/åbne issues. FEATURE_STATUS er genereret. [Detaljer](docs/AGENT_RULE_DETAILS.md#regel-6).
7. **Auto-push efter hvert commit.** Preflight før push; aldrig efterlad kun lokal leverance.
8. **OneDrive-hardlinks:** memory, `.codex.local/SUPABASEPC_SETUP.md`, `docs/HOOKS.md`; re-link efter manuel edit via `scripts/link-onedrive-context.ps1`.
9. **SQL/migrationer:** Claude applier efter merge, idempotent og med post-verifikation; destruktivt ejer-gated. Codex ingen prod-skrivning uden go. Læs [SQL-mandatet](docs/AI_OPS_REFERENCE.md#sql-migrations-mandat-detaljer) før handling.
10. **Terminaltilstand SET:** agent er først færdig ved observeret stop. Redning af et spor afsluttes med `TaskStop` (runtime-ækvivalent stop ved anden harness); bekræft terminaltilstand, aldrig antag den.
11. **Systemtilstand kræver positiv observation** fra værktøjet der ser tilstanden. Sig hvilket; fravær af fund beviser ikke fravær.
12. **PR-loftet er fjernet.** Laner pr. maskine og verify-semafor (2) begrænser arbejdet; se `scripts/wave-capacity.json`.
13. **Ingen påstand uden måling.** Issue-tal ældre end en uge GENMÅLES.
14. **Isolation er infrastruktur:** egne worktrees; `node_modules` må kun junctione til lockfile-hashet cache uden for main. Ingen `npm ci/install` gennem junction; dependency-baner bruger `-OwnNodeModules`. [WORKTREE_WORKFLOW](docs/WORKTREE_WORKFLOW.md).
15. **Mennesket beslutter, AI fremskaffer beviset.** Bed aldrig om godkendelse af et gæt; mål først.
16. **Tests læser aldrig vægur-tiden.** Injicér eksplicit `now`/`today` i produktionskoden; stol ikke på `new Date()`-defaults. Nightly tester frontend OG backend med forskudt ur.
17. **Offentlighedspolitik for balance-tal:** kvalitative mekanikker må deles; præcise vægte, formler, eksponenter, konstanter og interne tærskler ALDRIG i offentlige issues/PR'er/kommentarer/patch notes/Discord. Del privat i chat eller `balance-internals/`; `database/proposals/` er offentlig.
18. **Commit bag blokerende guard:** `bash scripts/guard-commit-branch.sh <branch> <worktree> && git -C <worktree> commit ...`. Samme mappe til guard og commit. Branch-print er ingen guard. Blokering omgås aldrig; ved fremmed ucommitteret arbejde må du ikke skifte branch.
19. **skip-logik på prod-deploy:** main følger sidste succesfulde deploy. Frontend, afhængigheder eller ukendt grundlag bygger. [VERCEL_BUILD_RULES](docs/VERCEL_BUILD_RULES.md).
20. **Deploy-verify er del af merge:** Railway success efter hver salve; Vercel READY ved frontend/byggeinput eller ukendt grundlag. Uafhængigt diff kan beholde seneste frontend-deploy. Claude ejer dette i denne session.
21. **Per-agent-timeout** skaleres med samtidighed eller forskudte launches.
22. **Dispatch-forfilter før HVER spawn:** `gh issue view N --json state,labels` og tjek merged PR'er for allerede leveret scope. NOW/masterplan/prompts er kilder, ikke facts.
23. **Post-merge guard-tjek:** required checks OG warning-budget, feature-liveness, patch-note-guard skal observeres grønne på main-HEAD efter salven.
24. **Orkestrator ejer e2e-slottet:** giv hver worker verify-niveau. Alt tungt wrappes i `scripts/verify-lock.ps1 -Max 2 -- <kommando>`. Byggeparallelitet kun via `wave.js`/`scripts/codex-wave.mjs`, fælles bølgelås og maskinloft. Worker starter aldrig fuld e2e selv.
25. **Design-gate før build:** alt der ændrer hvad spilleren ser, læser eller oplever kræver problem + løsningsskitse og eksplicit ejer-"godkendt til build" FØR byg, også copy/fixes. Registrér på issue og i PR-body (`Design-go: dato/link`). Kun usynlige tekniske ændringer undtaget.
26. **Visuelt bevis før release:** rigtige screenshots (`pr-screens/`) eller preview før merge; mobil OG desktop ved layout. Copy-only kan citeres ordret. **Hent aldrig dev-/preview-server over HTTP med curl/fetch/Invoke-WebRequest:** Vite-moduler lækker env-nøgler til transcript. Brug browser/screenshot/read_page eller kildefiler fra disk. [SECRET_LEAK_VECTORS](docs/SECRET_LEAK_VECTORS.md), tabel H.
27. **Beslutningskort FØR udarbejdelse:** ét spilleroplevelsesvalg ad gangen, selvstændig kontekst, A/B + anbefaling. Tekniske valg afgøres selv.
28. **Testplan er en del af designet:** test-tier, hvad ejeren ser på preview/staging og normalt tester-runde på staging ved store pakker. Uden testplan intet build-go.
29. **Læs NOW før enhver udtalelse om projektets tilstand**, tidsplan eller prioritet. 🎯 Next action + 🤖 Working agent er SSOT. Anden aktiv session: stop og spørg før pick-up, medmindre ejeren udtrykkeligt har godkendt samtidigheden. Udled aldrig tidsplan fra DB mod NOW. NOW-PR kræver titel `docs(now)`/`docs(close-out)`.
30. **Områdets SSOT:** læs FØR kode/data/prod/design; citér i design; opdatér ændrede regler/konstanter/kontrakter i SAMME PR. Nyt kerneområde fødes med SSOT. Flag-flip/retire/kernefeature opdaterer FEATURE_REGISTRY i samme PR. **Et gulv er aldrig en godkendelse:** mål mod navngiven ejer-godkendt målsætning eller kald det regressionsgulv; uden mål spørg. Områdekort nedenfor.
31. **Nye frontend-filer inkl. tests er `.ts`/`.tsx`.** Ingen massemigrering. Nye public-tabeller følger [DATA_API_GRANTS](docs/DATA_API_GRANTS.md) + `database/templates/new-public-table.sql`; RLS erstatter ikke grants.
32. **Kan en type fange det?** Brug compileren før ny CI-guard. Guards kun til det compileren ikke kan se (invarianter, RLS, pagination, patch notes, liveness).
33. **Før issue create:** søg både `gh issue list --search "ord" --state all` og `gh search issues --repo NicolaiDolmer/CyclingZone --match title,body "ord"`; læs hits. Kommentér/genåbn eksisterende uleveret emne frem for dublet. Nyt issue nævner tjekkede relaterede numre.
34. **MASTERPLAN ændret:** samme artifact-URL republiceres før slut, aldrig ny. [Artifact-sync](docs/AI_OPS_REFERENCE.md#masterplan-artifact-sync). Codex rører ikke MASTERPLAN.
35. **Merge-mandat:** følg [fuld regel 35](docs/AGENT_RULE_DETAILS.md#regel-35) + merge-kø/klassifikator, grøn CI/review-gate og uafhængigt diff-review. Ejer-go-markør slettes aldrig; kun ejerens "merge" løfter den. Efter 2. Codex-reviewrunde blokerer kun spillerdata/penge/sikkerhed/prod-nedbrud; øvrige fund i ét opfølgningsissue. **Sessionsmandatet ovenfor forbyder alle Codex-merges.**
36. **Teknisk design + målt baseline før byg:** DB/motor/samtidighed/ydelse kræver read-only gennemgang og lokal PG17-baseline før første PR; højst 2 stablede drafts; efter 4 t uden resultat stop med status, ingen polling. [Detaljer](docs/AGENT_RULE_DETAILS.md#regel-36).

## Sådan deler du arbejdet op

- Del læsetungt arbejde i uafhængige områder og giv én parallel `explorer` pr. område. Afgræns spørgsmål, filer og svarformat; brug korte isolerede prompts. Vent på ALLE, kontrollér beviserne og giv ét samlet svar. Ingen delegation for trivielt arbejde uden gevinst.
- Skrivearbejde: én opgave, ét claim, ét eget worktree via `scripts/new-worktree.ps1`; parallel byg via `node scripts/codex-wave.mjs`. Aldrig flere skrivende subagenter i samme checkout. Tildel filansvar og test-tier. Respektér aktive claims/låse og fælles loft, også Claudes forbrug.
- Kør en `reviewer` før push. Parent retter fund og ejer CI/handoff til Claude; worker/reviewer merger aldrig. `verifier` kører kun tildelt tier; `ui-checker` læser TASTE og leverer visuelt bevis inden for produktmandatet.
- Roller i `.codex/agents/*.toml`; modeller/effort eksplicit pr. rolle. Standarder installeres med `scripts/codex-setup.ps1` (dry-run; `-Apply` skriver). Roller arver parent-rettigheder: "kun læsning" er instruktion, ikke separat sandbox. [Opsætning og måling](docs/CODEX_AGENT_SETUP.md).

## Start-sekvens

0. Ikke Claude Code: læs `CLAUDE.md` ALLERFØRST (page templates/TASTE, PR-preflight-tiers, close-out, merge-kø); dernæst [OPERATING_PLAN §Codex](docs/OPERATING_PLAN.md#codex-dag) og [CODEX_WORKFLOWS](docs/CODEX_WORKFLOWS.md). Codex forfatter aldrig NOW, MASTERPLAN eller spillertekst.
1. Bekræft repo-root. Fetch `git fetch --prune origin`, `git status -sb`; behind → `git pull --ff-only` før edit i eget worktree. Rør aldrig ejerens/Claudes checkout. Lockfile ændret → projektets sync-deps-regler, aldrig gennem junction.
2. Læs SESSION_CONTEXT hvis den findes som cache, så `docs/NOW.md` og aktivt issue: `gh issue list --label claude:todo --state open --limit 10`. Claim på issue med `claude:in-progress` + plan; NOW-claim/close-out ejes af Claude.
3. GUARDRAILS_CORE kun ved labels `needs-contract`/`shared-refactor`. Læs relevant SSOT, matchende `docs/slices/<slug>.md` og AI_LOOPS-afsnit ved loop-implementering. Ingen bred doc-dump.
4. Verificér efter CLAUDE.md + [test-tiers](docs/AI_OPS_REFERENCE.md#pr-preflight-og-verifikations-tiers): preflight i forgrunden før push, tunge tests bag semafor. To CI-fejl på samme symptom → stop og spørg.

## Område → SSOT (regel 30)

Alle stier er under `docs/`: kalender → `CALENDAR_RULES.md`; motor/ruter/taktik → `RACE_ENGINE_RULES.md`; planlægning → `PLANNING_CENTER_RULES.md`; økonomi/værdi/løn → `ECONOMY_RULES.md`; sponsor → `SPONSOR_RULES.md`; bestyrelse → `BOARD_RULES.md`; progression → `PROGRESSION_RULES.md`; ryttergenerering → `RIDER_GENERATION.md`; forum → `FORUM_RULES.md`; dashboard → `DASHBOARD_RULES.md`; invarianter → `GAME_INVARIANTS.md`; delte kontrakter → `GUARDRAILS_CORE.md`; assistent → `ASSISTANT_RULES.md`; træning → `TRAINING_RULES.md`; transfer → `TRANSFER_MARKET_RULES.md`; sociale features → `SOCIAL_RULES.md`; ungdom/akademi/trupper → `YOUTH_RULES.md`; vækst → `GROWTH_STACK.md`; analytics → `ANALYTICS_STACK.md`; mail → `EMAIL_STACK.md`; spillerkommunikation → `COMMS_PLAYBOOK.md`.

## Handoff og oprydning

Handoff på issue/repo/OneDrive, maks 15 linjer: dato, slice, status, seneste handlinger, næste handlinger, kritiske facts, PR/SHA og bevis. Ingen hemmeligheder/balance-tal. Ingen lokal-only state. Token-hygiejne + close-out-cleanup dry-run; ryd kun egne processer/worktrees. Mistænkt cross-PC-drift → `cross-pc-forensic-audit.ps1`, se [CROSS_PC_LOCAL_STATE](docs/CROSS_PC_LOCAL_STATE.md). Status/NOW/masterplan-close-out koordineres med Claude.

## Review guidelines

P1 kun spillerdata, penge, sikkerhed, prod-drift, spilleroplevelse eller brud på 16-17. Patch note i bølge-PR, SSOT/docs, PR-billeder og filendelser er P2.
