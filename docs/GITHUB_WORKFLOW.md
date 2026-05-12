# GitHub-workflow — Nicolai ↔ Claude

> Verdens bedste Claude+GitHub-opsætning. Ambition: agent-loop hvor Nicolai åbner et issue, Claude implementerer, GitHub merger, alt logges automatisk.

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
Auto-merge (når alt grønt)
        ↓
Nicolai får notifikation, verificerer i prod, lukker issue
```

Mål: Nicolai rører tastatur 2 gange (åbn issue, skriv `@claude`). Resten kører selv.

## Status 2026-05-08 — opbygning og drift

| # | Lag | Hvem | Status | Effekt |
|---|---|---|---|---|
| 1 | **Claude GitHub App** (`@claude`-trigger i issues/PRs) | Nicolai | ✅ LIVE | Async Claude fra browser/mobil |
| 2 | **Auto-PR-review** workflow | GitHub Actions | ✅ LIVE, advisory | Hver PR får risikobaseret Claude-review; auto-merge stopper hvis review fejler medmindre `skip-ai-review` er sat |
| 3 | **Auto-issue-triage** workflow | GitHub Actions | ✅ LIVE | Deterministiske labels først; AI-comment kun for high/investigation for at spare tokens |
| 4 | **GitHub Projects v2 board** | Claude (gh CLI + GraphQL) | ✅ LIVE 2026-05-10 | [`CyclingZone Roadmap`](https://github.com/users/NicolaiDolmer/projects/2) (#2) — 5 kolonner: 📋 Backlog · 🟢 Ready · 🟡 In Progress · 🔵 Review · ✅ Done. Auto-add via `.github/workflows/add-to-project.yml` (kræver `PROJECTS_PAT`-secret med `project`+`repo` scope; **rotér inden 2026-08-08**) |
| 5 | **Branch protection + auto-merge** | Claude (gh API) | ✅ LIVE 2026-05-08 | Main beskyttet; PR'er kan auto-merge via label eller ship-keyword |
| 6 | **Pre-commit/pre-push hooks lokalt** (`.githooks`) | Repo + `setup-local.ps1` | ✅ LIVE | Lint, secret-safety og PatchNotes-versioner fanges før push |
| 7 | **Dependabot + CodeQL + dependency review** | GitHub Actions | ✅ LIVE | Dep-PRs, code scanning og PR dependency gate |
| 8 | **MCP write-fix** (claude.ai GitHub-connector) | Nicolai (disconnect/reconnect) | 🔜 Pending | Min terminal-session skriver MCP direkte i stedet for `gh` CLI fallback |
| 9 | **Agent Dispatch Playbook** | Manus + GitHub issues | ✅ LIVE 2026-05-12 | `docs/AGENT_DISPATCH.md` gør GitHub issues til koordineringsbus, så brugeren ikke copy-paster prompts mellem Manus, Claude og Codex |


**Foundation (Lag 0) ✅ done**:
- Issue templates: `claude-task`, `claude-investigate`, `bug` + `config.yml` (disable blank issues)
- `PULL_REQUEST_TEMPLATE.md` med `Refs #X`, test plan og risk/auto-merge check
- 12 labels: `claude:{todo,in-progress,blocked,done}`, `priority:{high,med,low}`, `type:{bug,feature,refactor,docs,investigation}`
- `.claude/settings.json`: GitHub MCP read+write perms + `gh` CLI perms
- `CLAUDE.md` step 0d: tjek `claude:todo` issues ved session-start
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

## Risk-labels og auto-merge policy

Auto-merge er standard for lav-risiko PRs, men stoppes automatisk hvis en PR har en af disse labels:

- `risk:med`
- `risk:high`
- `security`
- `needs-decision`
- `manual-review`

Hvis auto-review fejler, stopper auto-merge også. Brug `skip-ai-review` kun som bevidst break-glass når fejlen er kendt og ufarlig.

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
| `Dispatch #N and ship` | Kun for lavrisiko-scope; Manus kan inkludere ship-keyword, så PR auto-merger når checks er grønne. |
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
| `claude:done` | Claude (på PR-merge) | PR merged, afventer brugerens verifikation før close |
| `priority:high\|med\|low` | Bruger | Pick-rækkefølge |
| `type:bug\|feature\|refactor\|docs\|investigation` | Auto via template | Filtrering |

**Brugeren** lukker issuet efter verifikation (`completed` reason). Claude lukker kun sine egne `not_planned`-issues (fx duplikater, scope-ændringer).

## Commit/PR-konvention
- Commit-besked nævner issue: `Fix: gæld vises i Min aktivitet (#42)`
- PR-body har `Refs #42` — brugeren lukker selv issuet efter manuel verifikation
- En PR = ét issue (med mindre flere er klart koblede — så `Closes #42, closes #43`)

## Session-start (Claude)
Per `CLAUDE.md` step 0d: Claude tjekker `gh issue list --label "claude:todo" --state open --repo NicolaiDolmer/CyclingZone` ved session-start og foreslår at tage den top-prioriterede hvis brugeren ikke selv peger på en konkret opgave.

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

## Mobile-first ship-loop (Lag 5 — LIVE 2026-05-08)

> **Status:** Verificeret end-to-end via demo-PR 2026-05-08. `deploy-verify` workflow kørte med `success` på første push — Vercel + Railway + smoke-test alle grønne.

**Mål:** Trigge en ændring fra mobilen og få den LIVE uden at åbne PC'en — uden manuel merge-klik.

### Sådan virker det

| Trigger | Effekt |
|---|---|
| `@claude implementer X **og ship**` | Claude opretter PR + tilføjer `auto-merge` label → PR auto-merger så snart CI grøn |
| `@claude implementer X` (uden ship-keyword) | Claude opretter PR; manuel merge påkrævet (safety-net for natlige autonome runs) |
| Tilføj `auto-merge` label til en eksisterende PR | PR sættes i auto-merge-kø — virker fra mobil GitHub-app (2 tryk) |
| Dependabot patch/minor PR | Auto-mærket med `auto-merge` af `dependabot-auto-merge.yml` → auto-merger |
| Dependabot major PR | Får IKKE label → manuel review krævet |

**Ship-keywords der trigger auto-merge** (case-insensitive, parsed af Claude-action fra issue/comment-body):
- ` ship` (med space foran, så det ikke matcher "shipper" osv.)
- `--ship`
- `send live`
- `auto-merge`
- `merge når grøn` / `merge naar groen`

### Workflows involveret

- `.github/workflows/claude.yml` — Claude-action; parser ship-keyword og tilføjer label efter PR-creation
- `.github/workflows/auto-merge.yml` — lytter på `pull_request: labeled` for `auto-merge`-label, stopper high-risk labels, venter på required checks + advisory AI-review, squash-merger og trigger deploy-verify
- `.github/workflows/dependabot-auto-merge.yml` — auto-mærker lav-risiko dep-PRs som auto-merge
- `.github/workflows/dependency-review.yml` — blokerer PRs der introducerer high+ dependency vulnerabilities
- `.github/workflows/deploy-verify.yml` — efter merge til main, venter på Vercel + Railway deploy, smoke-tester prod, upserter én ✅/❌ comment på merged PR

### Sikkerheds-net

Auto-merge fjerner IKKE branch protection — required status checks (`backend-tests` + `frontend-build`) skal stadig være grønne før merge sker. Auto-merge er essentielt en **conditional merge-queue**: PR parker sig selv indtil betingelser opfyldt.

Hvis CI fejler: PR forbliver åben, ingen merge sker, du får besked via GitHub-notifikation. Hvis prod-smoke-test fejler efter merge: `deploy-verify.yml` poster ❌-comment på den merged PR — du ved live er broken og kan rulle tilbage manuelt.

### Mobile workflow eksempel

1. Du sidder på toilettet, ser en bug-report i Discord
2. Mobil GitHub-app: opret issue eller åben eksisterende
3. Comment: `@claude fix dette og ship`
4. Luk telefonen
5. ~5-15 min senere: notifikation fra GitHub: "Deploy verificeret LIVE for #N"
6. Hvis ❌: åben mobilen og se hvad der gik galt; rul tilbage via revert-PR (også fra mobil)

### Hvornår SKAL du IKKE bruge ship-keyword

- **Større refaktoreringer** der påvirker delt runtime — kør CI lokalt først eller manuel review
- **Migrations** der ændrer DB-skema — verificer migration-ordre og rollback-plan først
- **Kontrakt-ændringer** mellem frontend/backend — skal koordineres
- **Nat / autonome opgaver** når du sover — eksisterende manuel-merge-pattern fra `feedback_24_7_automation` er bevidst safety-net

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
