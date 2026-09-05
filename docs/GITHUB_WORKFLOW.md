# GitHub-workflow — Nicolai ↔ Claude

> Verdens bedste Claude+GitHub-opsætning. Ambition: agent-loop hvor Nicolai åbner et issue, Claude implementerer, CI verificerer, alt logges automatisk. Merge-skridtet er bevidst IKKE automatisk (#4404, ejer-princip 4/9: "ingen andre end mig kan merge — kun mig og min Claude Code").

## Vision: Agent-loop

```
Nicolai opretter issue (template)
        ↓
Auto-triage workflow (labels, prioritet, første-pass-comment)
        ↓
Nicolai skriver "@claude implementer dette" i comment
        ↓
Claude GitHub Action (cloud) — laver branch + commits + PR
        ↓
Auto-review workflow (Claude reviewer egen PR for kvalitet/sikkerhed)
        ↓
CI passerer (lint + build + test)
        ↓
Manuel merge — ejeren eller Claude Code (`gh pr merge --admin`, #4404)
        ↓
Nicolai får notifikation, verificerer i prod, lukker issue
```

Mål: Nicolai rører tastatur 2 gange (åbn issue, skriv `@claude`). Resten kører selv.

## Status 2026-05-08 — opbygning og drift

| # | Lag | Hvem | Status | Effekt |
|---|---|---|---|---|
| 1 | **Claude GitHub App** (`@claude`-trigger i issues/PRs) | Nicolai | ✅ LIVE | Async Claude fra browser/mobil |
| 2 | **Auto-PR-review** workflow | GitHub Actions | ✅ LIVE, advisory | Hver PR får risikobaseret Claude-review; ren advisory-signal (ingen auto-merge til at reagere på den længere, #4404) medmindre `skip-ai-review` er sat |
| 3 | **Auto-issue-triage** workflow | GitHub Actions | ✅ LIVE | Deterministiske labels først; AI-comment kun for high/investigation for at spare tokens |
| 4 | **GitHub Projects v2 board** | Claude (gh CLI + GraphQL) | ✅ LIVE 2026-05-10 | [`CyclingZone Roadmap`](https://github.com/users/NicolaiDolmer/projects/2) (#2) — 5 kolonner: 📋 Backlog · 🟢 Ready · 🟡 In Progress · 🔵 Review · ✅ Done. Auto-add via `.github/workflows/add-to-project.yml` (kræver `PROJECTS_PAT`-secret med `project`+`repo` scope; **rotér inden 2026-08-08**) |
| 5 | **Branch protection** | Claude (gh API) | ✅ LIVE 2026-05-08 | Main beskyttet; ingen automatisk merge-vej — ejeren/Claude Code merger manuelt (`--admin`), se #4404 |
| 6 | **Pre-commit/pre-push hooks lokalt** (`.githooks`) | Repo + `setup-local.ps1` | ✅ LIVE | Lint, secret-safety og PatchNotes-versioner fanges før push |
| 7 | **Dependabot + CodeQL + dependency review** | GitHub Actions | ✅ LIVE | Dep-PRs, code scanning og PR dependency gate |
| 8 | **MCP write-fix** (claude.ai GitHub-connector) | Nicolai (disconnect/reconnect) | 🔜 Pending | Min terminal-session skriver MCP direkte i stedet for `gh` CLI fallback |
| 9 | **Agent Dispatch Playbook** | Manus + GitHub issues | ✅ LIVE 2026-05-12 | `docs/AGENT_DISPATCH.md` gør GitHub issues til koordineringsbus, så brugeren ikke copy-paster prompts mellem Manus, Claude og Codex |


**Foundation (Lag 0) ✅ done**:
- Issue templates: `claude-task`, `claude-investigate`, `bug` + `config.yml` (disable blank issues)
- `PULL_REQUEST_TEMPLATE.md` med `Refs #X`, test plan og risk-labels
- 12 labels: `claude:{todo,in-progress,blocked,done}`, `priority:{high,med,low}`, `type:{bug,feature,refactor,docs,investigation}` _(`claude:done` er valgfri — bruger kan også lukke direkte; se Note nedenfor)_
- `.claude/settings.json`: GitHub MCP read+write perms + `gh` CLI perms
- `CLAUDE.md` "Start (eksplicit)" trin 2: tjek `claude:todo` issues ved session-start
- Demo-issue #3 oprettet (verificerer skriv-vej via `gh`)

## Health check først

Kør dette før større workflow-/AI-arbejde:

```powershell
pwsh -File scripts/agent-doctor.ps1
```

Doctoren samler på få linjer:
- repo-root og local dirty state
- `gh auth`, `core.hooksPath`, tracked secret-filer
- GitHub security flags, branch protection, rulesets
- åbne Dependabot alerts, seneste Actions failures og issue-label schema

Brug `-FailOnWarning` i dedikerede DX-sessions hvor warnings skal fail'e lokalt.

## Hurtige merges uden strict (ejer-valgt 4/8)

Main kører med `strict=false`: en godkendt PR merges med `gh pr merge --auto --squash` og lander SÅ SNART dens egen CI er grøn — ingen `gh pr update-branch`, ingen omkørsler når andre PRs merger først. Alle 16 required checks består uændret på PR'ens egen HEAD.

Trade-offet (bevidst): to hver-for-sig-grønne PRs der tilsammen er røde, fanges nu først af CI'en på main EFTER merge. Discipliner der bærer det: (1) PRs der rører samme filer SEKVENSERES stadig af orkestratoren, (2) en rød main-CI efter en merge-salve er stop-alt-fix-først, (3) lokal preflight før push er fortsat obligatorisk.

Historik: GitHubs ægte Merge Queue blev forsøgt 4/8 men kræver et ORG-ejet repo (CyclingZone er bruger-ejet). CI'en er allerede kø-kompatibel (`merge_group`-triggere + pass-throughs, PR #3303, i dvale) — flyttes repoet til en organisation, kan køen tændes med ét ruleset (`scratchpad`-udkastet ligger i PR #3303's beskrivelse). Rollback af dagens ændring: `gh api .../branches/main/protection/required_status_checks -X PATCH -F strict=true`.

## Risk-labels

Der er ingen auto-merge længere (#4404) — alle merges er manuelle. Risk-labels er stadig triage-signal for mennesket der merger, og for `github-housekeeping`s auto-close-forbidden-zones (se `docs/GITHUB_WORKFLOW.md#autonom-close-policy-627-fra-2026-05-29`):

- `risk:med`
- `risk:high`
- `security`
- `needs-decision`
- `manual-review`

En PR med en af disse labels kræver ekstra opmærksomhed FØR manuel merge, ikke kun grøn CI. `skip-ai-review` er fortsat break-glass for en kendt/ufarlig advisory-review-fejl.

Typisk label-valg:

| Ændring | Label |
|---|---|
| Copy/docs/lokal DX uden runtime | ingen risk-label eller `risk:low` |
| Normal bugfix med tests | ingen risk-label eller `risk:low` |
| Frontend/backend kontrakt, større UX-flow, shared engine | `risk:med` |
| DB migration, auth/RLS, økonomi, secrets, dependency major, deploy workflow | `risk:high` eller `security` |
| Produktvalg mangler | `needs-decision` |
| AI må ikke shippe uden menneske | `manual-review` |

## Sådan samarbejder vi via issues

### Manus-dispatch uden copy-paste

Den anbefalede arbejdsgang er nu beskrevet i [`docs/AGENT_DISPATCH.md`](AGENT_DISPATCH.md). Kort fortalt skriver brugeren korte kommandoer som `Prepare #327`, `Dispatch #327`, `Review agent queue` eller `Block #328 pending #327`. Manus omsætter derefter beslutningen til GitHub issue-comments, labels og handoff, så Claude/Codex læser GitHub i stedet for lange videresendte chatbeskeder.

| Kommando | Effekt |
|---|---|
| `Prepare #N` | Manus skriver handoff-kommentar og labels, men trigger ikke agent. |
| `Dispatch #N` | Manus poster dispatch-kommentar. For Claude betyder det en `@claude` issue-comment, som trigger GitHub Action. |
| `Dispatch #N and ship` | Historisk ship-keyword — trigger ikke længere nogen auto-merge (#4404). PR oprettes som normalt og venter på manuel merge. |
| `Review agent queue` | Manus læser åbne issues/labels og anbefaler næste handling uden at brugeren skal samle status manuelt. |

### Du → Claude (du opretter issue)

1. Åbn https://github.com/NicolaiDolmer/CyclingZone/issues/new/choose
2. Vælg template: **Claude task**, **Claude investigation**, eller **Bug report**
3. Udfyld required-felter — issuet får automatisk `claude:todo` + `priority:*`
4. Næste session: bare sig "tjek mine issues" (eller jeg gør det selv ved start). **ELLER** når Lag 1 er live: skriv `@claude` direkte i issue-body, så starter Claude med det samme i cloud.

### Claude → Dig (jeg åbner issue)
- Når jeg opdager noget out-of-scope: opretter issue med `claude:todo` i stedet for at sidetracke nuværende arbejde
- Når jeg er blokeret af en beslutning du skal træffe: kommenterer på issue, sætter `claude:blocked`

## Label-state-maskine

| Label | Hvem sætter | Betydning |
|---|---|---|
| `claude:todo` | Bruger (auto via template) eller Claude | Klar til Claude pick-up |
| `claude:in-progress` | Claude | Aktiv arbejdssession |
| `claude:blocked` | Claude | Venter på input fra bruger (se nyeste comment) |
| `priority:high\|med\|low` | Bruger | Pick-rækkefølge |
| `type:bug\|feature\|refactor\|docs\|investigation` | Auto via template | Filtrering |

**Brugeren** lukker issuet med `completed` reason når PR er merged og verificeret. Issuet kan lukkes direkte fra `claude:todo`/`claude:in-progress`, eller via `claude:done` som mellem-state ("PR merged, afventer verifikation"). Begge mønstre er gyldige.

> **Note 2026-05-22 (revideret):** En audit 2026-05-18 markerede `claude:done` som deprecated (38/100 closed issues sprang step over), men faktisk opførsel post-audit viser fortsat ~60% brug af labelen. Den er derfor **valgfri, ikke deprecated** — AI sætter den efter PR-merge som signal til brugeren om at PR er klar til verifikation, men direct-close er også gyldigt. Claude lukker fortsat kun sine egne `not_planned`-issues (fx duplikater, scope-ændringer).

## Autonom close-policy (#627, fra 2026-05-29)

`github-housekeeping`-routinen kører **dagligt 05:00 UTC** og **lukker selv** de issues den kan verificere uafhængigt — du gennemgår ikke længere alt manuelt. Den arbejder efter en 3-tier tillidsmodel (fuld spec: [`.claude/skills/github-housekeeping/routine-prompt.md`](../.claude/skills/github-housekeeping/routine-prompt.md)):

| Tier | Hvad lukkes selv | Krav |
|---|---|---|
| **1** | Backend/docs/CI/security (uden `cat:user-feature`) | merged PR (`Refs/Closes #N`) + merge-commit på `main` + ≥24t + ingen forbidden label |
| **2** | `cat:user-feature` m. STRONG prod-evidens | Tier 1 + **uafhængigt maskin-match** (Vercel deployment READY / Supabase-query / Sentry resolved). Uden match → eskaleres |
| **3** | Alt usikkert | Eskaleres i daglig digest på #627 — du afgør |

**Forbidden zones (lukkes ALDRIG automatisk):** `needs-user-action`, `manual:user`, `needs-decision`, `manual-review`, `auto-close-veto`, `epic:*`, åbne `- [ ]`/`🟡`/`⚠️` i seneste comment, eller en "leveret"-PR der stadig er OPEN.

**Sikkerhedsnet:** Hver auto-close får en evidens-comment + label `auto-closed-by-routine` og lukkes med `state_reason=completed`. **Fejlede den?** Reopen issuet — næste kørsel opdager det (stateless `search_issues label:auto-closed-by-routine state:open`), sætter `auto-close-veto` (lukkes så aldrig automatisk igen) og rapporterer det i digesten. ≥3 reopens → circuit-breaker pauser Tier 2. Cap: max 20 closes/run. Alt er reversibelt (`gh issue reopen N`).

**Daglig digest:** comment på ledger-issue [#627](https://github.com/NicolaiDolmer/CyclingZone/issues/627) (auto-lukket / reopened / eskaleret / label-drift). Scan den om morgenen; håndtér kun Tier 3. Skip-create ved 0 actions.

## Commit/PR-konvention
- Commit-besked nævner issue: `Fix: gæld vises i Min aktivitet (#42)`
- PR-body har `Refs #42` — brugeren lukker selv issuet efter manuel verifikation
- En PR = ét issue (med mindre flere er klart koblede — så `Closes #42, closes #43`)

## Session-start (Claude)
Per `CLAUDE.md` "Start (eksplicit)" trin 2: Claude tjekker `gh issue list --label "claude:todo" --state open --repo NicolaiDolmer/CyclingZone` ved session-start og foreslår at tage den top-prioriterede hvis brugeren ikke selv peger på en konkret opgave.

## Cheatsheet
```bash
# Liste åbne todo-issues

gh issue list --label "claude:todo" --state open

# Læs et specifikt issue + comments
gh issue view 42 --comments

# Kommentér
gh issue comment 42 --body "..."

# Luk
gh issue close 42 --reason completed

# Trigger Claude i cloud (efter Lag 1)
# Skriv blot "@claude implementer X" i issue/PR-comment via browser eller mobil GitHub-app
```

## Mobile-first ship-loop (Lag 5 — LIVE 2026-05-08, auto-merge-del fjernet #4404)

> **Status 2026-09-05:** `auto-merge`-labelen og `.github/workflows/auto-merge.yml` er fjernet. Rod-årsag (#4404): branch protection kræver `require_code_owner_reviews`, og CODEOWNER er repo-ejeren selv — GitHub tillader aldrig at man godkender sin egen PR, så merge-skridtet fejlede altid uanset hvor grøn CI var. Ejer-princip 4/9: "Ingen andre end mig kan merge — kun mig og min Claude Code." En label-drevet merge med `GITHUB_TOKEN` (eller enhver anden automatisk merge-vej) ville netop være en tredje merge-vej og er derfor bevidst IKKE bygget som erstatning (se issue-kommentar 4/9 på #4404 for det fulde ejer-svar, inkl. hvorfor en admin-PAT-baseret erstatning også blev fravalgt).

**Mål (uændret):** Trigge en ændring fra mobilen. CI kører selv; merge-skridtet kræver stadig at ejeren (eller Claude Code på ejerens vegne) trykker igennem — men det er ét `gh pr merge --admin`-kald, ikke en app-genstart.

### Sådan virker det i dag

| Trigger | Effekt |
|---|---|
| `@claude implementer X` (med eller uden historisk ship-keyword) | Claude opretter PR; ship-keywords parses ikke længere til noget — PR venter altid på manuel merge |
| Dependabot patch/minor/major PR | Ingen af dem auto-merger længere; `dependabot-auto-merge.yml` er ikke fjernet i denne PR, men rammer efter alt at dømme SAMME rod-årsag (ingen code-owner-godkendelse mulig) — uverificeret, se separat issue-forslag |

**Ship-keywords fra tidligere** (` ship`, `--ship`, `send live`, `auto-merge`, `merge når grøn`/`merge naar groen`) er nu no-ops i `claude.yml` — dokumenteret der som "INGEN AUTO-MERGE (fjernet #4404)".

### Workflows involveret

- `.github/workflows/claude.yml` — Claude-action; opretter PR, forsøger IKKE længere at labelmærke eller auto-merge
- `.github/workflows/dependabot-auto-merge.yml` — venter stadig synkront på CI og forsøger `gh pr merge --squash` for patch/minor uden `--admin`; sandsynligvis også ramt af #4404's rod-årsag (ikke bekræftet/rettet i denne PR)
- `.github/workflows/dependency-review.yml` — blokerer PRs der introducerer high+ dependency vulnerabilities
- `.github/workflows/playwright-smoke.yml` — PR-check for frontendændringer; kører mocket Playwright smoke + desktop/mobile screenshot-baselines uden live secrets
- `.github/workflows/deploy-verify.yml` — efter merge til main, venter på Vercel + Railway deploy, smoke-tester prod, upserter én ✅/❌ comment på merged PR

### Merge-mekanik i dag

Branch protection er UÆNDRET (required review + code-owner-review, ingen løsnet gate). Merge sker manuelt: `gh pr merge <N> --repo NicolaiDolmer/CyclingZone --squash --delete-branch --admin`, én PR ad gangen, kørt af ejeren eller Claude Code — aldrig af et workflow med et repo-scopet token. `deploy-verify.yml` kører stadig automatisk efter merge og poster ✅/❌ på PR'en.

### Mobile workflow eksempel (opdateret)

1. Du sidder på toilettet, ser en bug-report i Discord
2. Mobil GitHub-app: opret issue eller åben eksisterende
3. Comment: `@claude fix dette`
4. Luk telefonen — Claude opretter PR og venter
5. Når CI er grøn: merge manuelt (mobil GitHub-app "Merge"-knap virker IKKE pga. code-owner-kravet — brug PC/Claude Code til selve merge-tryk)
6. `deploy-verify.yml` bekræfter LIVE bagefter; ❌ betyder rul tilbage via revert-PR

## Cross-PC notes
- `docs/GITHUB_WORKFLOW.md` (denne fil) er git-tracked — synkroniser via `git pull`
- `.claude/settings.json` er committed — MCP perms følger med automatisk
- På anden PC ved session-start: `git fetch --prune` for at rydde døde branches og se nye
- gh CLI auth er per-PC — kør `gh auth login` første gang

## Lag 7 — Dependabot + CodeQL

### Hvad kører og hvornår

**Dependabot** (`.github/dependabot.yml`) — opretter automatisk PRs for forældede afhængigheder:
- `npm` i `/` (rod), `/backend` og `/frontend` — ugentligt
- `github-actions` i `/` — ugentligt (holder workflow-actions som `actions/checkout` opdaterede)

**Dependency Review** (`.github/workflows/dependency-review.yml`) — PR-gate:
- Kører på alle PRs
- Fejler hvis PR'en introducerer high+ vulnerabilities i dependency diff

**CodeQL** (`.github/workflows/codeql.yml`) — statisk sikkerhedsanalyse:
- Kører på hvert push til `main`
- Kører desuden ugentligt (mandag 04:00 UTC) uanset commits
- Sprog: `javascript-typescript` (dækker både backend og frontend)

### Security settings

Kan verificeres med:

```powershell
pwsh -File scripts/agent-doctor.ps1
```

Kan forsøges aktiveret via API med:

```powershell
pwsh -File scripts/enable-github-security.ps1
```

Målstatus: Dependabot security updates, secret scanning og push protection enabled. Hvis GitHub-planen ikke tillader en setting, skal doctoren vise warning fremfor at blokere produktarbejde.

### Når Dependabot åbner en PR

1. Tjek at CI (lint + build + tests) er grøn på PR'en
2. Review ændringslog for den pågældende pakke for breaking changes
3. Merge direkte hvis minor/patch og CI er grøn
4. Koordinér med Claude ved major version bumps der kræver kodeændringer

### Når CodeQL finder et alert

1. Gå til **Security → Code scanning alerts** på GitHub
2. Vurdér severity (Critical/High skal fixes hurtigt; Medium/Low kan issues-tracktes)
3. Opret et issue med `type:bug` + `priority:high` label og vedhæft CodeQL-alert-linket
4. Claude tager issuet op i næste session

### Sådan deaktiveres midlertidigt

- **Dependabot:** kommenter den relevante sektion i `.github/dependabot.yml` ud
- **CodeQL schedule:** fjern `schedule:`-blokken i `.github/workflows/codeql.yml` (behold `push:`-triggeren)
- **CodeQL helt:** slet `.github/workflows/codeql.yml` (nemt at gendanne via git)
