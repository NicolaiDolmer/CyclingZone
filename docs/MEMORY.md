# MEMORY — Kontekst til AI-assistenter

Git-tracked, synces via GitHub på tværs af PC'er. Opdateres løbende.
Codex-sessioner læser herfra; Claude-sessioner har supplerende auto-memory i `~/.claude/`.

---

## Feedback — arbejdsstil

### Push følger commit automatisk
Push efter commit uden at spørge. Commit → push er én operation.

**Why:** Bruger spurgte "hvorfor spørger du om dette?" ved bekræftelsesspørgsmål om push.

**How to apply:** Commit → push til remote med det samme. Ingen bekræftelsesspørgsmål.

---

## Projekt-kontekst

### Økonomi-principper (gældende fra v2.49 / 2026-05-07)
- `DEFAULT_BETA_BALANCE = 800.000 CZ$` (kode: `backend/lib/betaResetService.js`)
- Sponsor-base: **240.000 CZ$/sæson** per team (DB-default kanonisk, bekræftet 2026-05-07; pre-v1.76-doc om "260K-ramp" er drift). Multiplier = board satisfaction-modifier (0.80–1.20×). Sæson 1 = baseline-introsæson, modifier låst til 1.0×.
- `DEFAULT_SPONSOR_INCOME = 240000` eksporteret fra `backend/lib/economyEngine.js:63` siden v2.49.
- Rytterværdi = `uci_points × 4000` (generated column `price` i DB)
- `market_value = GREATEST(5, uci_points) × 4000 + prize_earnings_bonus` (generated)
- `salary` ER GENERATED siden v2.25 (2026-05-04): `max(1, round((max(5, uci_points) × 4000 + prize_earnings_bonus) × 0.10))`. Kan ikke skrives fra app-kode — ændres kun via `uci_points` eller `prize_earnings_bonus`.
- Prize money = `points × 1.500 CZ$` — `prizePayoutEngine.paySeasonPrizesToDate` er eneste payout-path.
- Gældsloft pr. division (fra `loan_config`): D1=1.200K · D2=900K · D3=600K.
- Loan fees/rates fra `loan_config`: short=5%, long=5%, emergency=10% (orig fee + interest pr. sæson). NB: `loanEngine.js:169-170` har `?? 0.15`-fallback der skal væk i 07a (samme bug-mønster som v2.49).
- Økonomi-target: **stram men fair** — aktive kompetente managers kan overleve uden automatisk gældsspiral.

### Sæson-state-baseline (kritisk for fremtidige sessioner)
- Open beta åbnet **2026-05-04**. **Sæson 1 aktiv. 0 sæsoner afsluttet.** ~19 managers.
- Pre-2026-05-04 archive-docs (`ECONOMY_BASELINE_SIMULATION_2026-04-29.md`, `SEASON_6_REPAIR_VERIFICATION_2026-04-29.md`, `RECENT_DONE_PROOF_2026-04-29.md`) refererer til "sæson 6 completed, sæson 7 active". **Det var TEST-database FØR beta-reset til open-beta-launch.** Ignorér ALLE sæson-numre i pre-2026-05-04 archive-docs. Verificér aktuel sæson-state mod live DB eller spørg brugeren.

### Rytter-import og UCI-data
- **Autoritativ kilde:** Google Sheet `1dE6v2zdmflzToGUHf3pA5mEk5Kn7YI2Wq8WsXbUX0Ic` (3000 ryttere, opdateres af GitHub Actions)
- Lokal kopi: `scripts/uci_top1000.csv` — overskriv ved re-import med ny CSV fra Sheet
- Import-script: `scripts/import_riders.py` — bruger 5-lags navnematch + PCM_UCI_OVERRIDE
- Se `docs/CONVENTIONS.md` → "Import af ryttere" for komplet algoritme og invarianter
- **Fejlmønster der kendes:** PCM sammensatte efternavne, UCI mellemnavne, polske ł/Ø-tegn, alternativ translitteration (Tesfazion/Tesfatsion) — alle håndteres nu i scriptet

### Launch-kontekst (2026-04-30)
- **17 aktive managers** i nuværende beta
- **Open beta target: ~1 uge** — data resettes inden launch
- Launch = offentlig open beta; spillet fortsætter direkte derfra til produktion
- Pre-launch must-haves: profile-fix (S2), prize-money (S3-S5), onboarding (S6)

### Token-disciplin (gælder alle sessioner)
- `docs/NOW.md`: **maks 30 linjer** — kun aktiv slice, næste handlinger, blockers, invarianter
- `docs/PRODUCT_BACKLOG.md`: kun fremadskuende — ingen done-historik
- Færdige detaljer → `docs/FEATURE_STATUS.md` + `docs/archive/`
- Læs kun ekstra docs-filer når den konkrete opgave kræver det
- `docs/MEMORY.md`: læs kun ved ny session eller eksplicit behov

---

## Deploy-regler (lært den hårde vej — 3 fejlede Vercel deploys 2026-05-02)

- Kør altid `npm run build` i frontend FØR push, når `package.json` eller devDeps er ændret
- **Kør `npm run lint --silent` i frontend/ og/eller backend/ FØR push** når kode-filer er ændret. Pre-push hook (`.githooks/pre-push`) blokerer ellers og efterlader push i confused state. Lærepenge fra S-02c (2026-05-05): unused import + unescaped JSX-quote slap igennem til push-attempt.
- Kør `pwsh -File scripts/verify-deploy.ps1` EFTER push og vent på READY
- Hvis verify-deploy.ps1 ikke er tilgængelig: brug Vercel MCP (`list_deployments` + `get_deployment_build_logs`)
- `npm install --legacy-peer-deps` kan bryde transitive deps i lockfilen — altid byg lokalt bagefter
- **PatchNotesPage er obligatorisk ved enhver commit** — selv rene tekniske ændringer. Aldrig stille fravalg.

---

## Remote routines (CCR) — best practice

Lært den hårde vej 2026-05-03: en Sonnet-routine "Dark mode S2" gennemførte alt arbejde (31 filer + build + docs + lokalt commit) men kunne ikke pushe pga. manglende write-permissions. Sandbox er ephemeral → arbejdet tabt.

**Før `RemoteTrigger create`:**
1. `mcp_connections` for GitHub-connectoren SKAL have `permitted_tools` med mindst `create_branch`, `push_files` (eller `create_or_update_file`), `create_pull_request`. Tomt array = read-only.
2. Prompt skal instruere agenten i at outputte fuld diff i sidste besked hvis push fejler — så vi kan recovere fra routine-siden.
3. Brug aldrig `persist_session: false` (default for run-once) til en task hvis push-pathen ikke er bombsikker.

**Efter routinen har fyret:**
1. `RemoteTrigger get` returnerer kun `run_once_fired` — det betyder IKKE at arbejdet landede.
2. Verificér via GitHub MCP `list_branches` + `list_pull_requests` at branchen og PR'en faktisk eksisterer.
3. Logs er kun synlige i `claude.ai/code/routines/<id>` i browser — ikke via API.

**Recovery:** hvis push fejlede og diff ikke blev outputtet → arbejde er tabt, kør lokalt forfra med samme prompt.

**Yderligere læring 2026-05-03:** GitHub MCP-integrationen er read-only i nuværende setup. `create_pull_request`, `push_files`, `create_branch` → 403. `git push` virker lokalt (bruger Git Credential Manager). PR-oprettelse er altid manuel via URL: `https://github.com/<owner>/<repo>/pull/new/<branch>`. Hvis vi skal automatisere PR-oprettelse, skal brugeren udvide GitHub-integrationens scope til `pull_request:write`.

---

## Branch- og worktree-hygiejne (cross-PC + multi-AI)

Lært 2026-05-03: 4 stale `claude/*`-branches kostede ~10-15 tool calls i én session at undersøge "er dette live arbejde eller færdig?". Skalerer dårligt over uger.

**Pr. session — obligatorisk efter fast-forward push til main:**
- `git push origin --delete <feature-branch>` — slet feature-branchen på origin (gælder ikke branches med åben PR)
- `git worktree remove <path>` + `git branch -D <branch>` — fjern lokal worktree + branch på den PC du arbejder på

**Cross-PC adfærd:**
- Origin-branch deletion er global → den anden PC får det automatisk via `git fetch --prune` (kør altid ved session-start på en ny PC)
- Lokale worktrees er per-PC → den anden PC har sine egne stale worktrees som skal ryddes der

**Multi-AI compatibility:**
- Reglen er git-niveau (ikke Claude-specifik) → Codex følger samme konvention
- Begge AI'er læser denne fil og GUARDRAILS_CORE.md → konvention håndhæves automatisk

**GitHub repo-setting (one-time):** `Settings → General → Pull Requests → Automatically delete head branches` ✅ — auto-cleanup når PRs merges. Dækker IKKE direkte fast-forward pushes (de skal stadig manuel slettes per reglen ovenfor).

---

## Worktree path unreliable — verificér git-state ved session-start

Lært 2026-05-05 i S-02c-sessionen: jeg skrev 3 filer (`boardArchetypes.js`, SQL-migration, `boardMembers.js`) til `.claude/worktrees/<name>/`-paths. Alle rapporterede "File created successfully", men ved næste verifikation var de første 2 sporløst forsvundet — kun den seneste fil overlevede. `git worktree list` bekræftede at worktreen ikke fandtes som ægte git worktree. `git rev-parse --abbrev-ref HEAD` returnerede `main`, ikke `claude/<name>` som system context påstod. Hypotese: OneDrive-sync på den ikke-registrerede `.claude/worktrees/<name>/` directory eller usynlig harness-cleanup. Spildt arbejde: ~30k tokens.

**Default-antagelse:** Hvis system context claimer worktree-branch men `git rev-parse HEAD` viser `main`, er du IKKE i en faktisk worktree. Skift straks til main-repo absolute paths.

**Verifikations-rækkefølge ved session-start (60 sekunder):**
1. `git rev-parse --abbrev-ref HEAD` — er branch som system context siger?
2. `git worktree list` — er denne worktree listed?
3. `pwd` — matcher det system contextens "Primary working directory"?

**Hvis mismatch:**
- Opret feature-branch manuelt: `git checkout -b claude/<name>`
- Brug ABSOLUTE main-repo paths (`/c/Users/.../cycling-manager/...`) for ALLE Write/Edit-operationer
- Skriv aldrig til `.claude/worktrees/<name>/`-paths uden bekræftet ægte worktree
- Hvis phantom-paths opdages midt i session: Bash `cp` filerne til main-repo paths og fortsæt der; mappen kan ikke ryddes mens shell-cwd er der (SessionStart-hook'en håndterer det næste gang)

**Multi-AI compatibility:** Reglen er git-niveau, ikke Claude-specifik. Codex følger samme verifikations-rutine.

---

## Untracked filer i main repo — hash-tjek FØR dataloss-antagelse

Lært 2026-05-03: `backend/scripts/verifyRidersAgainstSheets.js` så ud som untracked dataloss-risiko ved session-start, men var byte-identisk med origin/main. Main repo's working tree var bare 8 commits bagud. Falsk alarm kostede ~5 tool-calls + en forkert "kritisk fund"-rapport.

**Default-antagelse i multi-worktree setup:** main repo's working tree er bagud, ikke at filen er tabt. Claude/Codex arbejder næsten altid i feature-worktrees, så main repo akkumulerer bagud-state.

**Tjek-rækkefølge når `git status` i main repo viser `??`:**
1. `git -C <main_repo> diff origin/main -- <fil>` for hver
2. Tom diff = identisk med origin/main = ikke dataloss → bare `rm` + `git pull --ff-only`
3. Reel diff = lokal arbejde der skal committes

**Why:** Eksisterende `git fetch --prune`-regel opdaterer kun refs, ikke working tree. Working tree opdateres kun af `git pull` / `git checkout`. Hullet skal eksplicit lukkes på begge PCs.

---

## Lokal PC-opsætning (kør ved første session på ny PC eller efter ny devDep)

```powershell
pwsh -File scripts/setup-local.ps1
```

Installerer `backend/node_modules` og `frontend/node_modules` (gitignored, skal køres lokalt).
Derefter virker: `npm run lint`, `npm run format`, `npm test`, `pwsh -File scripts/verify-invariants.ps1`.

**Hvad er installeret (v1.99):** ESLint + Prettier i backend og frontend · devDeps inkl. eslint-plugin-react/hooks · Supabase TypeScript types i `frontend/src/types/database.types.ts`.

---

## Windows: Undgå "command line too long"

Windows har 8191-tegns grænse for kommandolinjer. Overskrides ved meget lange inline PowerShell-kommandoer.

**Forebyggelse — altid:**
- Git commit-beskeder: brug PowerShell here-string `@'...'@`, maks 4 bullet points
- Aldrig bash heredoc-syntax (`$(cat <<'EOF'...)`) i PowerShell-tool — brug `@'...'@`
- Lange operationer: skriv til temp-fil med Write-tool, kør med `-File`

**Why:** Claude Code sender kommandoer som inline argument til `pwsh -Command "..."` — for lang tekst rammer Windows' grænse og fejler med exit code 1.

---

## Arbejdsmetode — effektive AI-sessioner

Disse mønstre viste sig særligt token-effektive og kvalitetsskabende i session 2026-05-02. Brug dem som default.

### Læs dybt før du foreslår noget
Læs 4–6 centrale filer (engine, routes, tests, schema) inden du foreslår arkitektur. I denne session afslørede det at infrastrukturen allerede var 80% færdig — det ændrede hele tilgangen fra "byg nyt" til "forbind eksisterende".

**Filer der altid er relevante at læse ved ny feature:**
- Den relevante engine-fil (`lib/xxxEngine.js`)
- `backend/lib/financeNotificationContract.test.js` — viser tilladte DB-typer
- `database/schema.sql` — faktisk tabelstruktur
- Eksisterende test-fil for den engine der skal ændres

### Migration sidst — ikke først
Kør aldrig migration før al kode er klar. En migration der er foran koden skaber inkonsistent state. Rækkefølge: skriv kode → tests grønne → kør migration → deploy. En enkelt deploy-begivenhed.

### Batch queries i engine-funktioner
Nye engine-funktioner skal hente al nødvendig data i 2–4 forespørgsler uanset antal løb/ryttere. Mønster fra `prizePayoutEngine.js`:
1. Hent alle relevante rækker med `.in("id", ids)` i én query
2. Group/aggregate i JavaScript, ikke i DB
3. Aldrig N+1 (én query per løb/rytter i en løkke)

### Cascading change detection
Når du fjerner et felt fra et return-objekt (f.eks. `teamsPaid`): søg alle kallers med Grep før du ændrer. Ret alle steder i samme commit. Kør tests umiddelbart efter hver fil-ændring — ikke samlet til sidst.

### Dekobler domæner i stedet for at tilføje betingelser
I stedet for at tilføje `if (shouldPay)` i eksisterende flow: opret en ny dedikeret funktion. Giver renere kode, lettere test, og administrativ kontrol som sideeffekt. Eksempel: `applyRaceResults` vs. `prizePayoutEngine.paySeasonPrizesToDate`.

---

## Arkitektur-beslutninger

### Præmieudbetaling (v1.98)
- `applyRaceResults` udbetaler **aldrig** præmier — kun resultater gemmes
- `prizePayoutEngine.paySeasonPrizesToDate(seasonId, adminUserId, supabase)` er den eneste vej til præmieudbetaling
- `races.prize_paid_at TIMESTAMPTZ` tracker hvornår et løb er udbetalt
- Re-import af resultater påvirker ikke allerede udbetalte præmier
- Preview (`getSeasonPrizePreview`) og udbetaling er adskilt — admin ser diff før godkendelse
