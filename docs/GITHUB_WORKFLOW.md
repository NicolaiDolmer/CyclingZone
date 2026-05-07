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

## 8 lag — opbygning og status

| # | Lag | Hvem | Status | Effekt |
|---|---|---|---|---|
| 1 | **Claude GitHub App** (`@claude`-trigger i issues/PRs) | Nicolai (kør `/install-github-app`) | 🔜 Pending | Det vigtigste — async Claude fra browser/mobil |
| 2 | **Auto-PR-review** workflow | Claude | 🔜 Pending (efter Lag 1) | Hver PR får automatisk Claude-review |
| 3 | **Auto-issue-triage** workflow | Claude | 🔜 Pending (efter Lag 1) | Nye issues auto-labeles + første-pass-comment |
| 4 | **GitHub Projects v2 board** | Nicolai (UI) | 🔜 Senere | Visuelt kanban-overblik |
| 5 | **Branch protection + auto-merge** | Claude (gh API) | ✅ LIVE 2026-05-08 | Main beskyttet; PR'er kan auto-merge via label eller ship-keyword |
| 6 | **Pre-commit hooks lokalt** (husky + lint-staged) | Claude | 🔜 Senere | Ingen broken code pushes |
| 7 | **Dependabot + CodeQL** | Claude | ✅ Config committet — afventer manuel UI-aktivering | Auto-PRs for deps + sikkerhed |
| 8 | **MCP write-fix** (claude.ai GitHub-connector) | Nicolai (disconnect/reconnect) | 🔜 Pending | Min terminal-session skriver MCP direkte i stedet for `gh` CLI fallback |

**Foundation (Lag 0) ✅ done** (commit `f26f2e5`):
- Issue templates: `claude-task`, `claude-investigate`, `bug` + `config.yml` (disable blank issues)
- `PULL_REQUEST_TEMPLATE.md` med Closes #X + test plan
- 12 labels: `claude:{todo,in-progress,blocked,done}`, `priority:{high,med,low}`, `type:{bug,feature,refactor,docs,investigation}`
- `.claude/settings.json`: GitHub MCP read+write perms + `gh` CLI perms
- `CLAUDE.md` step 0d: tjek `claude:todo` issues ved session-start
- Demo-issue #3 oprettet (verificerer skriv-vej via `gh`)

## Status & næste skridt (læs FØRST ved session-start)

**Hvor vi står:** Foundation er live på `main`. MCP-read virker. MCP-write returnerer 403 (kræver Lag 8). `gh` CLI virker som fallback.

**Næste skridt — gør i denne rækkefølge:**

### Skridt 1: Lag 1 — Installer Claude GitHub App (Nicolai)
I Claude Code-terminalen, kør:
```
/install-github-app
```
Den guider gennem:
1. OAuth til Anthropic GitHub App (https://github.com/apps/claude)
2. Installation på `NicolaiDolmer/CyclingZone`
3. Tilføjer `ANTHROPIC_API_KEY` som repo-secret (brug eksisterende API-nøgle fra console.anthropic.com)
4. Dropper `.github/workflows/claude.yml` (basis trigger på `@claude`)

Test: Skriv `@claude hello` i en kommentar på issue #3. Du skal se en GitHub Actions-run starte og Claude svare i tråden inden for ~1 min.

### Skridt 2: Lag 8 — Fix MCP write (Nicolai, ~30 sek)
1. Gå til https://claude.ai/settings/connectors
2. Find "GitHub" → **Disconnect**
3. **Reconnect** → giv adgang til `NicolaiDolmer/CyclingZone` → accepter alle Read+Write permissions
4. Restart Claude Code så ny token loades

Verifikation: Bed Claude prøve at kommentere på et issue via MCP — hvis ingen 403, så virker det.

### Skridt 3: Lag 2 + 3 — Auto-review + auto-triage (Claude)
Når Lag 1 er gjort, dropper Claude:
- `.github/workflows/claude-review.yml` — kører på `pull_request: opened, synchronize`. Bruger `anthropics/claude-code-action@v1` med prompt: "Review this PR for code quality, correctness, security. Post findings as review comments."
- `.github/workflows/claude-triage.yml` — kører på `issues: opened`. Auto-tilføjer `priority:*` og `type:*` baseret på title/body keywords; poster en første-pass-investigation-comment hvis det er en bug.

Hver workflow = sin egen PR for klar review-historik.

### Skridt 4: Verifikation af agent-loop
Opret et test-issue via Claude task-template. Skriv `@claude løs dette` i comment. Følg loop'en igennem ende-til-ende. Hvis alt virker → Lag 1-3 + 8 er done; ryk videre til Lag 4-7.

### Skridt 5+: Lag 4-7 (senere, når 1-3 har kørt nogle dage)
Prioritér i denne rækkefølge baseret på smerte:
- Lag 5 (branch protection) hvis broken main bliver et problem
- Lag 6 (pre-commit) hvis CI fejler ofte på trivielle ting
- Lag 4 (Projects board) hvis issue-listen bliver uoverskuelig
- Lag 7 (Dependabot/CodeQL) før første eksterne brugere ud over open beta

## Sådan samarbejder vi via issues

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
- PR-body har `Closes #42` så GitHub auto-lukker issuet ved merge
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
- `.github/workflows/auto-merge.yml` — lytter på `pull_request: labeled` for `auto-merge`-label → kalder `gh pr merge --auto --squash --delete-branch`
- `.github/workflows/dependabot-auto-merge.yml` — auto-mærker lav-risiko dep-PRs som auto-merge
- `.github/workflows/deploy-verify.yml` — efter merge til main, venter på Vercel + Railway deploy, smoke-tester prod, kommenterer ✅/❌ på merged PR

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

**CodeQL** (`.github/workflows/codeql.yml`) — statisk sikkerhedsanalyse:
- Kører på hvert push til `main`
- Kører desuden ugentligt (mandag 04:00 UTC) uanset commits
- Sprog: `javascript-typescript` (dækker både backend og frontend)

### Manuel UI-aktivering (skal gøres én gang)

Gå til https://github.com/NicolaiDolmer/CyclingZone/settings/security_analysis og aktivér:
1. **Dependabot alerts** — notifikationer ved kendte sårbarheder
2. **Dependabot security updates** — automatiske sikkerhedsfix-PRs
3. **Code scanning** → **Set up** → vælg "Default" (CodeQL workflow er allerede committet)

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
