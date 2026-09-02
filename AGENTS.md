# AGENTS.md

_Arbejdsregler for Claude i cycling-manager-repo'et. Single source of truth for de discipliner hver session skal følge. (Tidligere multi-AI-koordineringsfil; solo Claude-operation siden 2026-06-12 — Codex/Manus udfaset.)_

> **Lean core (split 2026-05-29, [#733](https://github.com/NicolaiDolmer/CyclingZone/issues/733)).** Denne fil holder kun det der reelt skal i HVER session — hard rules (fuld tekst), start-sekvens og delt handoff-format. Rolle-matrix, cross-PC-detaljer, session-rytme-signaler, token-effektivitets-vejledning og loops-quick-ref er flyttet til **[`docs/AI_OPS_REFERENCE.md`](docs/AI_OPS_REFERENCE.md)** (WARM, on-demand). Intet indhold er slettet — kun flyttet.

---

## Hard rules

> **Håndhævelse:** 🔒 = mekanisk håndhævet (hook/CI — kan ikke glemmes). ✍️ = honor-system (prosa; afhænger af disciplin — disse er dem der drifter, hold dem korte).
> Pr. regel nedenfor: 1 ✍️ · 2 ✍️ · 3 ✍️ · 4 ✍️ · 5 🔒 (pre-push hook + `leak-check` CI) · 6 ✍️ · 7 ✍️ (auto-push hook hvis installeret) · 8 ✍️ · 9 ✍️ (idempotens-delen 🔒 via migration-idempotency-CI) · 10-13 + 15 ✍️ (orkestrering) · 14 🔒 (worktree-isolation, [#3367](https://github.com/NicolaiDolmer/CyclingZone/issues/3367)) · 16 🔒 (nightly `clock-drift-test-check.yml`, detektor på frontend + backend, ikke pr.-PR-gate) · 18 🔒 (`scripts/guard-commit-branch.sh`, blokerende) · 19-23 ✍️ (kvalitetsproces-regler, ejer-godkendt 18/8 pr. [#3661](https://github.com/NicolaiDolmer/CyclingZone/issues/3661)) · 31-32 ✍️ (build-konventioner, [#4329](https://github.com/NicolaiDolmer/CyclingZone/issues/4329)).

1. **Repo-root verification:** Brug kun den aktuelle bekræftede repo-root fra `git rev-parse --show-toplevel`. Aldrig andre lokale kopier, sync-kopier eller zip-udpakninger. Hvis repo-root ikke matcher den workspace-mappe brugeren aktuelt har angivet → stop og bed om realignment.

2. **Delt context er GitHub/OneDrive — aldrig lokal-only.** Varig projekt-state, handoff, beslutninger, næste skridt og læringer skal ligge i GitHub (issues, `docs/NOW.md`, `docs/slices/`, repo-docs) eller i OneDrive-context-hardlinks. Lokale agent-filer (`.codex.local/SESSION_CONTEXT.md`, Claude transcripts, Codex memories, tool caches) er kun regenererbare caches/pointers og må aldrig være eneste sted et fremskridt findes. Hvis du opdager lokal-only context, migrér den til GitHub/OneDrive før session-slut.

3. **Verificér runtime FØR du listet noget som TODO/bug/mangler.** Dokumenter (Noter-til-spiller.txt, gamle session-notater, brugerens hukommelse) kan være måneder forældede mens koden er rettet. Grep mindst én relevant fil eller tjek `git log --grep=<keyword>` før du committer påstanden til en plan. Markér eksplicit "❓ ikke runtime-verificeret" på antagede status-stempler. Etableret 2026-05-04 efter Noter-fil-stale-incidenten.

4. **Bliv ved med at stille spørgsmål når i tvivl.** 70-95% sikkerhed → spørg, antag ikke. Også for proaktive forbedringsforslag. AskUserQuestion-tool foretrækkes til strukturerede valg.

5. **Patch notes er obligatoriske ved enhver brugerrettet ændring.** Opdatér `frontend/src/pages/PatchNotesPage.jsx` ELLER skriv eksplicit hvorfor det ikke er nødvendigt. Pre-push hook (loop B i AIDEFS/FAQALLOWLIST/EXEMPT i scriptet med begrundelse.

6. **Slice close-out kræver:**
   - `docs/NOW.md` opdateret + relevante GitHub-issues lukket eller opdateret med status (`gh issue comment N --body "..."` / `gh issue close N --reason completed`)
   - `docs/FEATURE_STATUS.md` afstemt
   - PatchNotesPage opdateret
   - Postmortem-entry i `.claude/learnings/` hvis slice fiksede en bug (loop C)
   - Doc-drift sweep: grep for nye env vars, deploy-targets, route-navne, tabel-navne mod `ARCHITECTURE.md` og åbne issues

7. **Auto-push efter commit:** Push til GitHub automatisk efter hvert commit (Vercel deployer kun ved push).

8. **OneDrive-context hardlinks (siden 2026-05-07, scope reduceret 2026-05-12 per #327):** Memory og `.codex.local/SUPABASEPC_SETUP.md` + `docs/HOOKS.md`.

9. **SQL/migrations-mandat (ejer 18/7, [#2642](https://github.com/NicolaiDolmer/CyclingZone/issues/2642)) — afløser "ejer applier"-reglen:** Claude kører selv SQL/migrationer mod prod (`apply_migration`/`execute_sql`) under disse rammer:
   - **Rækkefølge:** migration committes i PR → PR merges → apply. Aldrig apply af u-merget SQL (eneste undtagelse: additiv/idempotent fil hvor featuren ellers er brudt live — dokumentér i issue/PR).
   - **Idempotens:** alle filer følger `IF NOT EXISTS`/`DROP POLICY IF EXISTS`-mønstret (håndhævet af migration-idempotency-CI).
   - **Post-apply-verifikation:** read-only-tjek (`information_schema`/`pg_*`) + notér resultatet i issue- eller PR-kommentar. ⚠️ Skaber migrationen en NY tabel/kolonne der tilgås via supabase-js/PostgREST: kør OGSÅ `NOTIFY pgrst, 'reload schema';` — API'ets schema-cache genindlæser IKKE selv efter MCP-apply (bidt 19/7: drip-boot fandt ikke `academy_intake_ticks` trods verificeret CREATE; auto-migrate/psql-stien har samme hul).
   - **Destruktive klasser er FORTSAT ejer-gated pr. tilfælde:** `DROP TABLE`/kolonne, masse-DELETE/UPDATE af spillerdata, RLS-lempelser — jf. "ejer ser live-tilstand før atombomber".
   - **Mekanik:** filer i `database/2026-*.sql` (top-niveau) auto-applies desuden af `auto-migrate.yml` ved push til main (~3 min delay). MCP-apply bruges til at fremrykke/verificere en merged migration samt til one-off data-SQL under rammerne ovenfor — begge veje er idempotente via `schema_migrations`-tracking hhv. filkonventionen. ⚠️ **"Forberedt-men-ikke-kørt" SQL må derfor ALDRIG committes som `database/2026-*.sql`** — den KØRER ved merge uanset kommentarer i filen (bidt 18/7: backfill-2623 auto-applied trods "IKKE KØRT"-header). Udkast/forslag til ejer-review → `database/proposals/` (uden for auto-migrate-globben). **Anvender du en fil derfra i hånden, SKAL den flyttes til top-niveau bagefter** — ellers er den ikke længere til at skelne fra et uanvendt udkast (kostede #3765). Håndhæves hver 6. time af `scripts/proposals-reconcile.mjs`.
   - **Backup-forudsætning:** Supabase-org er på Pro-plan (daglige automatiske backups) — verificeret 2026-07-18. PITR-add-on-status kan ikke aflæses via MCP; ejer bekræfter i dashboard.

### Orkestrering af parallelle agenter (ejer-godkendt 2026-08-05)

Gælder når en session kører flere agenter/spor ad gangen (natbølger, dagbølger, fleets).

> **Hændelserne bag reglerne 10-30 står i [`docs/NIGHT_WAVE_RUNBOOK.md`](docs/NIGHT_WAVE_RUNBOOK.md) under "Hændelserne bag hard rules 10-30".** De blev flyttet dertil 31/8 ([#4502](https://github.com/NicolaiDolmer/CyclingZone/issues/4502)) fordi denne fil brød sit token-loft. **Reglen uden hændelsen bliver til prosa der drifter** — læs dem når du skal forstå hvorfor en regel er skarp, eller når du overvejer at bøje den. Reglerne selv er låst af `agents-md-required-rules` i `scripts/check-agent-token-hygiene.ps1`: en fremtidig trim kan ikke købe tokens ved at slette et krav.

10. **Enhver agent har en terminal-tilstand du har SET.** En agent er ikke færdig fordi dens arbejde er reddet — den er færdig når du har set den stoppe. Redning af et spor SKAL afsluttes med `TaskStop`.

11. **Påstande om systemtilstand kræver en positiv observation.** "Jeg fandt ingen" er ikke "der er ingen". Brug det værktøj der ser den tilstand du udtaler dig om, og sig hvilket.

12. **Loft på igangværende arbejde: maks 5 åbne PR'er.** Er køen fuld, merges før der startes nyt.

13. **Ingen påstand uden en måling. Issue-tal ældre end en uge GENMÅLES, de citeres ikke.**

14. **Isolation er infrastruktur, ikke disciplin.** Et spor må ikke kunne ødelægge et andet ved et uheld. **Lukket 5/8 ([#3367](https://github.com/NicolaiDolmer/CyclingZone/issues/3367)):** worktrees junctioner nu til en lockfile-hashet cache i `%LOCALAPPDATA%`, ikke til hoved-checkoutet — der findes ingen sti fra et worktree ind i mains `node_modules`. `preflight-night-wave.ps1` advarer hvis en legacy-junction alligevel dukker op. _Delt `node_modules` ramte 4 af 20 spor og kostede verifikations-dækning på en sikkerheds-PR. `npm ci` gennem en junction tømte hoved-checkoutets install midt i bølgen._

15. **Mennesket beslutter, AI'en fremskaffer beviset.** Bed aldrig om godkendelse af et gæt — mål først, præsentér så.

16. **En test må aldrig læse vægur-tiden.** Injicér altid et eksplicit `now`/`today` til produktionskoden i stedet for at stole på en `now = new Date()`-default. Nightly `clock-drift-test-check.yml` kører **både frontend- og backend-testene** med klokken skubbet 6 måneder frem og fanger drift ([#3385](https://github.com/NicolaiDolmer/CyclingZone/issues/3385): main blev rød uden en commit, fordi en fast test-konstant passerede vægur-tiden). Detektoren var frontend-only indtil 25/8, hvor præcis samme klasse ramte backend uset ([#4222](https://github.com/NicolaiDolmer/CyclingZone/issues/4222): en hardkodet `firstRaceDate` lod `resolveCalendarFrom` falde tilbage på vægur-tiden og gjorde 6 tests røde på selve datoen).

17. **Offentlighedspolitik for balance-tal (ejer-godkendt 6/8, jf. [#3436](https://github.com/NicolaiDolmer/CyclingZone/issues/3436)).** Repoet er offentligt. Kvalitativ omtale af mekanikker er OK overalt ("nedkørsel vægter for tungt", "lønnen skaleres med markedsværdi"). Præcise vægte, formler, eksponenter, konstanter og motor-interne tærskler må ALDRIG stå i issues, PR-bodies, kommentarer, patch notes eller Discord — de hører hjemme i private filer (`balance-internals/`, chat-sessioner, `database/proposals/`-headere er også offentlige!). En agent der skal dele et balance-tal med ejeren gør det i chatten, aldrig på GitHub.

18. **Commit i hoved-checkoutet kun bag den blokerende branch-guard.** Kør `bash scripts/guard-commit-branch.sh <forventet-branch> && git commit ...`. Guarden exiter 1 ved mismatch og ved detached HEAD. `git branch --show-current` er IKKE en guard: den printer branchen og exiter altid 0, så en `&&`-kæde fortsætter uanset hvad. Blokerer guarden, så gentag ALDRIG uden den; en blokeret guard er signalet om at checkoutet står forkert. Er der fremmed ucommitteret arbejde i træet, så skift ikke branch (et `checkout` bærer deres filer med) men commit via `git worktree add <tmp> <branch>`.

19. **Aldrig skip-logik på prod-deploy-grenen.** main bygger ALTID. Enhver "spring buildet over"-optimering (ignoreCommand, diff-gates) hører til på branches, aldrig på main.GIT_PREVIOUS

20. **Deploy-verify er en del af merge-handlingen.** En merge er ikke færdig før det NÆSTE production-deploy er SET i READY (Vercel) — efter hver merge-salve, ikke ved close-out. _18/8: prod-frontend sad fast på sidste gode deploy i timevis mens merges fortsatte ovenpå den knækkede ignoreCommand._

21. **Per-agent-timeout dimensioneres efter samtidighed.** En timeout der er rimelig for én agent alene er forkert under fuldt tryk: skalér med antal samtidige agenter eller launch i forskudte chunks.

22. **Dispatch-forfilter før HVER spawn.** `gh issue view N --json state,labels` + tjek om en merged PR allerede dækker scopet. Masterplan-/NOW-/promptlinjer er KILDER, ikke facts.

23. **Post-merge guard-tjek af main.** Efter en salve verificeres at required checks OG de bløde vagter (warning-budget, feature-liveness, patch-note-guard) stadig er grønne på main-HEAD — en PR kan være grøn på egen base og alligevel knække main i kombination. _18/8 morgen: to vagter knækkede på main efter formiddagens merges og blokerede hele merge-køen (fix `6d5a232c`)._

24. **Orkestratoren ejer e2e-slottet ved parallelle workers** (ejer 18/8, KS3). Spawn-prompter tildeler verifikations-niveau eksplicit; ingen worker kører fuld lokal e2e-suite på egen hånd; maks 3 tunge verifikationer samtidig.

25. **Design-gate før build** (ejer-mandat 13/8, [#3661](https://github.com/NicolaiDolmer/CyclingZone/issues/3661)). En ny spillervendt funktion implementeres ALDRIG uden forudgående design-blok med ejeren: problem, løsningsskitse (mockup/show_widget/artboard/preview) og et eksplicit "godkendt til build". Godkendelsen refereres i PR-body ("Design-go: dato/link"). Refactors og bugfixes uden ny adfærd er undtaget.

26. **Visuelt bevis før release** (#3661). Alt brugerrettet vises visuelt for ejeren FØR merge: rigtige screenshots (`pr-screens/`) eller preview-link, mobil OG desktop ved layoutændringer. Ingen tekst-beskrivelser som godkendelsesgrundlag — dette skærper UI-merge-reglen til også at gælde små ændringer (copy-only undtaget når teksten er citeret ordret).
    **Dev-/preview-serveren hentes ALDRIG over HTTP** ([#3024](https://github.com/NicolaiDolmer/CyclingZone/issues/3024)): Vite injicerer `import.meta.env` — inkl. `VITE_SUPABASE_ANONpage` er fine; skal du inspicere kode, læs kildefilen fra disk. Se tabel H i [`docs/SECRET_LEAK_VECTORS.md`](docs/SECRET_LEAK_VECTORS.md).

27. **Spørgsmål med anbefaling FØR udarbejdelse** (#3661). Valg med spilleroplevelses-konsekvens forelægges ejeren som beslutningskort (ét ad gangen, kontekst i kortet, A/B + anbefaling) FØR der bygges — ikke efter. Rent tekniske valg uden oplevelses-konsekvens træffes selv.

28. **Testplan er en del af designet** (#3661). Design-blokken afsluttes med en eksplicit verifikationsplan: test-tier (#3556), hvad ejeren skal se på preview/staging, og for store pakker en tester-runde på staging som norm (som trin 7 20/8). En funktion uden testplan er ikke "godkendt til build".

29. **`docs/NOW.md` læses FØR enhver udtalelse om projektets tilstand, tidsplan eller prioritet.** Blokken "Aktiv styring" (🎯 Next action + 🤖 Working agent) er source of truth for hvad der sker hvornår — ikke DB-kolonner, ikke fil-datoer, ikke din egen udledning. Udled ALDRIG en tidsplan af data når NOW.md udtaler sig om den. Viser "Working agent" en anden aktiv session → STOP og spørg før pick-up ([#559](https://github.com/NicolaiDolmer/CyclingZone/issues/559)). Reglen gælder også når opgaven virker uafhængig af tidsplanen: en forkert tidsakse forgifter enhver anbefaling der bygges ovenpå den. _23/8: en session læste `seasons.start_date = 2026-08-24` og konkluderede at sæsonskiftet var "i morgen", mens NOW.md's første linje sagde "CUTOVER S2→S3 I AFTEN 23/8". Hele designsessionen blev bygget på den forkerte tidsakse, og der blev foreslået en implementeringsplan 70 minutter før cutover-vinduet åbnede._

30. **Områdets SSOT læses, citeres og opdateres i samme PR** (ejer-mandat 25/8, [#4221](https://github.com/NicolaiDolmer/CyclingZone/issues/4221)). Rører opgaven et område med et SSOT-dokument, gælder fire ting: **(a)** dokumentet læses FØR der røres kode, data, prod eller design; **(b)** ethvert nyt design-dokument citerer sit områdes SSOT eksplicit — et design uden citat er ikke godkendt til build; **(c)** ændrer arbejdet en regel, en konstant eller en kontrakt, opdateres SSOT'en i SAMME PR som ændringen; **(d) et nyt område eller en ny kernefunktion fødes med sit SSOT-dokument** — dokumentet er en betingelse for at feature'en må lukkes, ikke et efterslæb (ejer-direktiv 25/8, [#4266](https://github.com/NicolaiDolmer/CyclingZone/issues/4266)). En regel der kun står i en spec er en parallel plan.
    **Områder og deres SSOT:** kalender → [`docs/CALENDAR_RULES.md`](docs/CALENDAR_RULES.md) · race-motor, ruter og taktik → [`docs/RACE_ENGINE_RULES.md`](docs/RACE_ENGINECENTER_RULES.md`](docs/PLANNING_CENTER_RULES.md) · økonomi, værdi og løn → [`docs/ECONOMY_RULES.md`](docs/ECONOMYRULES.md`](docs/SPONSORRULES.md`](docs/BOARDRULES.md`](docs/PROGRESSION_RULES.md) · rytter-generering → [`docs/RIDER_GENERATION.md`](docs/RIDER_GENERATION.md) · forum → [`docs/FORUM_RULES.md`](docs/FORUM_RULES.md) · dashboard → [`docs/DASHBOARD_RULES.md`](docs/DASHBOARD_RULES.md) · spil-invarianter → [`docs/GAME_INVARIANTS.md`](docs/GAME_INVARIANTS.md) · delte kontrakter → [`docs/GUARDRAILS_CORE.md`](docs/GUARDRAILS_CORE.md) · **assistenten → [`docs/ASSISTANT_RULES.md`](docs/ASSISTANT_RULES.md)** · **træning → [`docs/TRAINING_RULES.md`](docs/TRAININGMARKET_RULES.md`](docs/TRANSFER_MARKET_RULES.md)** · **sociale features → [`docs/SOCIAL_RULES.md`](docs/SOCIAL_RULES.md)** · **ungdom, akademi og trupper (junior/U23/senior) → [`docs/YOUTH_RULES.md`](docs/YOUTH_RULES.md)**.
    **Et gulv er aldrig en godkendelse.** Rapporteres et tal som OK, skal det stå hvilken regel det måles mod, og om det er et ejer-godkendt MÅL eller et regressions-GULV. Findes der intet godkendt mål, siges det eksplicit og spørges — det rapporteres aldrig grønt. _25/8: `CALENDAR

### Build-konventioner ([#4329](https://github.com/NicolaiDolmer/CyclingZone/issues/4329))

31. **Nye frontend-filer skrives i `.ts`/`.tsx`.** TypeScript er allerede i brug i repoet (`backend/lib/engine/v4`: 25 non-test `.ts`-filer under `tsconfig.engine.json` med `strict: true`) — frontend har til sammenligning kun 2 `.ts`/`.tsx` mod ca. 880 `.js`/`.jsx`. Konventionen gælder kun NYE filer; ingen big-bang-migrering af de eksisterende ca. 880.

32. **"Kan en type fange det?" — spørg FØR du foreslår en ny CI-guard.** `.github/workflows/ci.yml` har allerede ca. 15 håndbyggede ratchet-guard-jobs. Kan compileren fange fejlen (forkert felt-navn, manglende case, forkert type), tilføj typen i stedet. Guards reserveres til det compileren IKKE kan se: invarianter, RLS, paginerings-lofter, patch-notes-dækning, feature-liveness.

### §LOKAL lokal-only-state (legacy — Codex-æra)

`.codex.local/`-whitelisten og `cross-pc-forensic-audit.ps1` blev bygget til at fange lokal-only state Codex efterlod på tværs af PC'er. Med solo Claude-operation er rutinen ikke længere en per-session-gate — kør kun auditen ad hoc hvis du mistænker drift (fx efter længere ophold på en sekundær PC). Detaljer: [`docs/CROSS_PC_LOCAL_STATE.md`](docs/CROSS_PC_LOCAL_STATE.md).

---

## Start-sekvens (hver session)

1. Kør `git rev-parse --show-toplevel` — bekræft repo-root
2. Kør `git fetch --prune origin && git status -sb` — hvis `[behind N]`, kør `git pull --ff-only` før edit (user-level SessionStart-hook gør dette automatisk hvis installeret)
3. Læs `.codex.local/SESSION_CONTEXT.md` hvis den findes, men behandl den som regenererbar cache fra GitHub-issues — ikke som source of truth. Hvis den er stale/mangler, brug `docs/NOW.md` + `gh issue list/view`.
4. Læs `docs/GUARDRAILS_CORE.md` KUN hvis issue-labels indeholder `needs-contract` eller `shared-refactor` (~80% af sessioner skipper — samme regel som CLAUDE.md "Start (eksplicit)" trin 3; alignet per #1097)
5. Læs `docs/NOW.md`
6. Aktivt issue: `gh issue list --label "claude:todo" --state open --limit 10` — første `#N` i NOW.md er typisk det aktive
7. Hvis arbejde matcher en slice i `docs/slices/<slug>.md` → læs den slice-brief (komplet kontrakt på 30-50 linjer)
8. Hvis nye loop-implementeringer → læs `docs/AI_LOOPS.md` afsnittet for den specifikke loop

**Token-effektiv kontekst-tabel** (hvilken doc læses hvornår) + **cold-start-recipe** + anti-patterns: [`docs/AI_OPS_REFERENCE.md §Token-effektiv kontekst`](docs/AI_OPS_REFERENCE.md#token-effektiv-kontekst).

---

## Delt handoff-format (alle agents)

Varigt handoff skrives i GitHub/OneDrive, ikke lokal-only. Brug denne form i `docs/NOW.md`, en GitHub issue-kommentar eller en slice-doc ved session-slut, maks 15 linjer.

```
# Session context — [dato]

Aktiv slice: [slice-navn / slug fra docs/slices/]
Status: [in_progress | completed]

Seneste handlinger:
- [hvad der blev gjort]

Næste handlinger:
- [konkret næste skridt]

Kritiske facts:
- Economy: DEFAULT_BETA_BALANCE=800000, sponsor=240000, SALARY_RATE=0.10
- [andet relevant for næste session]
```

---

24. **Orkestratoren ejer e2e-slottet ved parallelle workers.** Ved 2+ samtidige frontend-workers på samme PC tildeles verifikations-niveauet i SPAWN-prompten: workers kører unit-tests + lint + check:i18n + verify-affected + build + screenshots — ALDRIG den fulde lokale e2e-suite (CI bærer den på PR'en; fravalget noteres i PR-body med henvisning til denne regel). Max 3 samtidige tunge frontend-workers; backend-workers er billige og undtaget. Fuld lokal suite er kravet igen ved SERIELT arbejde (én worker ad gangen) i TIER FULL. _18/8 (KS3): 7 frontend-workers kørte hver fuld suite samtidig og serialiserede på CPU'en — timers spild før orkestratoren omdirigerede midt i bølgen. Ejer-mandat 18/8: må ikke gentages._

## Worktree-disciplin (Claude-specifik)

- Worktrees i `.claude/worktrees/<navn>/` cleanes efter ship via SessionStart-hook
- Manuel fallback hvis hook fejler: `git worktree remove <path>` + `git branch -D <branch>` på PC'en der oprettede worktreen
- Per-PC handling — gentages på den anden PC ved næste session der
- **Parallel-sessions samme PC:** se [`docs/AGENT_ARCHITECTURE.md §Parallel-session-safety`](docs/AGENT_ARCHITECTURE.md#parallel-session-safety-samme-pc-flere-claude-sessions-samtidigt) for kollisions-matrix + worktree-recipe
- ⚠️ **Sti-baserede hard-blocks SKAL stå i `permissions.deny`, ikke kun hooks (#684):** På Claude Code ≥2.1.154 bypasser `permissions.allow` PreToolUse-hookenes `exit 2` OG JSON-`permissionDecision: deny` ([anthropics/claude-code#18312](https://github.com/anthropics/claude-code/issues/18312)). Fix D (verificeret 2026-05-29 i frisk acceptEdits-session): statiske `permissions.deny`-globs overlever allow-listen (`deny > allow`-precedence) — `Write`/`Edit`/`NotebookEdit(docs/archive/**)` er nu i `permissions.deny`, så arkiv-beskyttelsen håndhæves selvom de tre tools er allow-listede (#591). **Tilbageværende gap:** indholds-baserede guardrails (NOW.md 30-linjers-grænse, dynamisk secret-pattern) kan ikke udtrykkes som deny-globs → stadig hook-only og afvæbnede for allow-listede tools indtil #18312. Hold dem i menneske-review ved autonome parallel-runs — se [`docs/PARALLEL_WORKTREE_ORCHESTRATION.md`](docs/PARALLEL_WORKTREE_ORCHESTRATION.md) top-note.

---

## On-demand reference (ikke auto-load)

Resten af AI-ops-disciplinen er flyttet til **[`docs/AI_OPS_REFERENCE.md`](docs/AI_OPS_REFERENCE.md)** — læs efter behov:

- **Token-effektiv kontekst** — doc-til-trigger-tabel + cold-start-recipe + anti-patterns
- **Rolle-fordeling mellem AI-assistenter** — Manus / Claude / Codex / Clarity (kort version; fuld council-kontrakt i [`docs/AI_COUNCIL.md`](docs/AI_COUNCIL.md))
- **Hvornår skifter AI-ejerskab** — scenarie→AI-tabel + konflikt-resolution
- **Cross-PC setup** — repo-placering, synk-arkitektur, drift-protokol, ikke-rør-for-Codex
- **Session-rytme & token-effektivitet** — 🟢/🟡/🔴/🆕-signaler, close-out-tjeklister, hvornår man starter ny session
- **Reference til loops** — quick-ref A-I (fuld spec: [`docs/AI_LOOPS.md`](docs/AI_LOOPS.md))

---

_Sidst opdateret: 2026-05-29 — split i lean core + `docs/AI_OPS
