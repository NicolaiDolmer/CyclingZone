# Guard-inventory — aktivering kræver bevis

**Udkast i arbejdstræet, ikke færdig leverance (#5065).** Implementeringen blev
stoppet ved nyt runtime-fund 9/9. Git-bevisdatoerne nedenfor er reelle; de nye
installer-/launcher-/inventory-ændringer er endnu ikke committet. Se seneste
afsnit i `.claude/learnings/2026-09-09-codex-hooks-measured-cause-chain.md`.

## Målt bevisregister

Bevisdato er datoen for en positivt observeret blokering, ikke filens alder,
en grøn suite eller exit 0. Datoerne gælder denne PC; PC1 er ikke målt.
En deltest beviser kun den angivne dækning, aldrig automatisk hele guardens policy.

| Guard / lag | Bevist dækning | Sidst set blokere | Bevis |
|---|---|---|---|
| `.githooks/pre-commit` / Git | Staged fake-secret | 2026-09-09 | `git commit`: gitleaks BLOCKED, exit 1, HEAD uændret; installerens smoketest genkørt efter ændring |
| `.githooks/pre-push` / Git | Forbudt env-filnavn med harmløst indhold | 2026-09-09 | `git push` til lokalt test-remote afvist med specifik filnavnsbesked |
| `scripts/check-staged-docs.mjs` via pre-commit / Git | Arkivændring inkl. rename væk; staged NOW >30 linjer eller >1200 approx tokens | 2026-09-09 | Faktisk arkiv-commit afvist; budget-fixtures, CRLF/grænse/unstaged-kontrol i `test-staged-docs.mjs` |
| `block-dangerous-secret-commands.sh` / Codex | T1 gennem frisk runner | aldrig bevist | FEJL 9/9 efter trust: kommandoen kørte; Python3-alias fejler, direkte payload-prøve returnerer 0 |
| `block-blocking-shell-commands.sh` / Codex | T2 gennem frisk runner | aldrig bevist | FEJL 9/9 efter trust: git diff kørte; præcis runner-årsag uafklaret |
| `block-branch-switch-in-main-checkout.sh` / Codex | T3 gennem frisk runner | aldrig bevist | FEJL 9/9 efter trust: branch oprettet, straks returneret til main og slettet |
| `block-archived-edit.sh`, `check-now-md-edit.sh` / Codex | Inaktive for observeret apply_patch-payload | aldrig bevist | Matcher-aliaser findes, men payload mangler file_path; Git-laget giver staged beskyttelse |

**Hændelse 9/9 (#5065):** Git-hook-laget var bygget og tracked, beskrevet som
mekanisk håndhævet i AGENTS.md, men lokal core.hooksPath pegede på `.git/hooks`
med kun samples. Det blev først aktiveret og positivt bevist 2026-09-09 via
`scripts/install-git-hooks.ps1`. Ny-PC-rutinens manuelle slutcheckliste var et
observeret installationshul; historisk ophav til denne PCs config er ikke bevist.
Nu går setup-new-pc → setup-local → install-git-hooks automatisk med secret-smoketest.

## Installation og grænser

- Eksisterende PC1-checkout: `git pull --ff-only`, så `pwsh -File scripts/setup-local.ps1`
  fra repo-roden. Det installerer dependencies og aktiverer/smoke-tester Git-hooks.
- Codex: review `/hooks` og trust efter alle configændringer; start en frisk session
  og kør Del A i `docs/agents/CODEX_PROMPTS.md`. Ingen tidligere bevisdato gælder PC1.
- Ejeren kan ved bevidst undtagelse bruge `git commit --no-verify` eller
  `git push --no-verify`. Det omgår de lokale hooks, ikke CI. Agenter må aldrig bruge
  disse bypasses eller slukke hooks; fremlæg den konkrete blokering for ejeren.
- Git-budgetter læser staged blobs, ikke arbejdskopien. Docs-commits starter ikke
  lint-staged/ESLint når ingen konfigurerede filglobs matcher. Secret-scanningen bevares.
- Pre-push-lint og PatchNotes-versionstjek er ikke selvstændigt bevist i denne audit.
  Patch-notes-dækning er fortsat en arbejdsregel; en versionskontrol beviser ikke dækning.

## Ydelse

Før: reelt docs-commit 7,555 s (første måling); varm eksisterende hook 1,801 s.
Separat: Bash/merge 52 ms, staged-check 51 ms, gitleaks inkl. opstart 477 ms,
npx lint-staged 1621 ms, direkte lint-staged 642 ms / 408 ms med eksplicit config,
ESLint --version 3469 ms. Dette summeres ikke til en forklaring af den første
måling: proces-cache og belastning varierer. Under senere måling var npx 6363 ms.
Npx er fjernet, og samme installerede lint-staged-globs bestemmer den billige no-op.
Faktiske isolerede commits efter ændring: docs **1,263 s** (mål ≤1,5 s),
backend-kode **7,777 s** (mål ≤4 s, IKKE opfyldt). Kodeprøven kørte rigtig
ESLint plus lint-stageds backup/staging/cleanup; begge commits lykkedes.
Kompromis: kodekontroller og sikker staging bevares frem for at slå noget fra.
Dette er ikke et bevis for alle frontend-/SQL-committyper eller et latency-loft.

<!-- GENERATED GUARD SOURCES -->

## Kildeinventar

Én række per CI-job, hook-script/binding, eksplicit ESLint-regel og kontrolscript.
Importerede ESLint-regelsæt dækkes samlet af config-rækken. CI-job medtages også
hvor formålet er drift frem for blokering. Tabellen registrerer kilder, ikke
påstået runtime-dækning. Kun bevisregistret ovenfor tildeler en bevisdato;
"aldrig bevist" betyder ingen registreret positiv blokering i denne audit.
Regenerér efter staging med `node scripts/generate-guard-inventory.mjs`.

| Lag | Kilde | Dækning / binding | Senest set blokere i denne audit |
|---|---|---|---|
| CI | [.github/workflows/add-to-project.yml](../.github/workflows/add-to-project.yml) | add-to-project: Add to CyclingZone Roadmap | aldrig bevist |
| CI | [.github/workflows/auto-merge.yml](../.github/workflows/auto-merge.yml) | auto-merge: auto-merge | aldrig bevist |
| CI | [.github/workflows/auto-migrate.yml](../.github/workflows/auto-migrate.yml) | migrate: migrate | aldrig bevist |
| CI | [.github/workflows/balance-baseline-check.yml](../.github/workflows/balance-baseline-check.yml) | balance-baseline: balance-baseline (advisory) | aldrig bevist |
| CI | [.github/workflows/calendar-invariant-audit.yml](../.github/workflows/calendar-invariant-audit.yml) | audit: audit | aldrig bevist |
| CI | [.github/workflows/calendar-scorecard-gate.yml](../.github/workflows/calendar-scorecard-gate.yml) | calendar-scorecard: calendar-scorecard | aldrig bevist |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | backend-tests: backend-tests | aldrig bevist |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | frontend-build: frontend-build | aldrig bevist |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | warning-budget: warning-budget | aldrig bevist |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | static-guards: static-guards | aldrig bevist |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | migration-idempotency: migration-idempotency | aldrig bevist |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | workflow-output-guard: workflow-output-guard | aldrig bevist |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | dependabot-exceptions-guard: dependabot-exceptions-guard | aldrig bevist |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | postgrest-cap-guard: postgrest-cap-guard | aldrig bevist |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | maybesingle-unique-scope-guard: maybesingle-unique-scope-guard | aldrig bevist |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | getuser-guard: getuser-guard | aldrig bevist |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | rankings-fetch-guard: rankings-fetch-guard | aldrig bevist |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | riders-column-grant-guard: riders-column-grant-guard | aldrig bevist |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | swallowed-catch-guard: swallowed-catch-guard | aldrig bevist |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | silent-mutation-guard: silent-mutation-guard | aldrig bevist |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | finance-type-guard: finance-type-guard | aldrig bevist |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | dropped-supabase-error-guard: dropped-supabase-error-guard | aldrig bevist |
| CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) | calendar-invariant-ci-gate: calendar-invariant-ci-gate | aldrig bevist |
| CI | [.github/workflows/claude-triage.yml](../.github/workflows/claude-triage.yml) | triage: triage | aldrig bevist |
| CI | [.github/workflows/claude.yml](../.github/workflows/claude.yml) | claude: claude | aldrig bevist |
| CI | [.github/workflows/clock-drift-test-check.yml](../.github/workflows/clock-drift-test-check.yml) | run-suite: run-suite | aldrig bevist |
| CI | [.github/workflows/clock-drift-test-check.yml](../.github/workflows/clock-drift-test-check.yml) | report: report | aldrig bevist |
| CI | [.github/workflows/codeql.yml](../.github/workflows/codeql.yml) | analyze: Analyze (${{ matrix.language }}) | aldrig bevist |
| CI | [.github/workflows/db-health.yml](../.github/workflows/db-health.yml) | health: health | aldrig bevist |
| CI | [.github/workflows/dependabot-auto-merge.yml](../.github/workflows/dependabot-auto-merge.yml) | dependabot-auto-merge: dependabot-auto-merge | aldrig bevist |
| CI | [.github/workflows/dependency-review.yml](../.github/workflows/dependency-review.yml) | dependency-review: dependency-review | aldrig bevist |
| CI | [.github/workflows/deploy-verify.yml](../.github/workflows/deploy-verify.yml) | verify: verify | aldrig bevist |
| CI | [.github/workflows/drift-monitor.yml](../.github/workflows/drift-monitor.yml) | audit: audit | aldrig bevist |
| CI | [.github/workflows/feature-liveness-audit.yml](../.github/workflows/feature-liveness-audit.yml) | audit: audit | aldrig bevist |
| CI | [.github/workflows/feature-registry-check.yml](../.github/workflows/feature-registry-check.yml) | registry-freshness: registry-freshness | aldrig bevist |
| CI | [.github/workflows/feature-registry-check.yml](../.github/workflows/feature-registry-check.yml) | registry-flags: registry-flags | aldrig bevist |
| CI | [.github/workflows/feature-registry-guard.yml](../.github/workflows/feature-registry-guard.yml) | registry-guard: feature-registry-guard (advisory) | aldrig bevist |
| CI | [.github/workflows/i18n-check.yml](../.github/workflows/i18n-check.yml) | key-coverage: key-coverage | aldrig bevist |
| CI | [.github/workflows/i18n-check.yml](../.github/workflows/i18n-check.yml) | delta-pending: delta-pending | aldrig bevist |
| CI | [.github/workflows/i18n-check.yml](../.github/workflows/i18n-check.yml) | namespace-inline: namespace-inline | aldrig bevist |
| CI | [.github/workflows/i18n-check.yml](../.github/workflows/i18n-check.yml) | nav-strings: nav-strings | aldrig bevist |
| CI | [.github/workflows/i18n-check.yml](../.github/workflows/i18n-check.yml) | page-untranslated: page-untranslated | aldrig bevist |
| CI | [.github/workflows/i18n-check.yml](../.github/workflows/i18n-check.yml) | lib-strings: lib-strings | aldrig bevist |
| CI | [.github/workflows/i18n-check.yml](../.github/workflows/i18n-check.yml) | terrain-coverage: terrain-coverage | aldrig bevist |
| CI | [.github/workflows/i18n-check.yml](../.github/workflows/i18n-check.yml) | error-code-coverage: error-code-coverage | aldrig bevist |
| CI | [.github/workflows/i18n-check.yml](../.github/workflows/i18n-check.yml) | leak-check: leak-check | aldrig bevist |
| CI | [.github/workflows/i18n-check.yml](../.github/workflows/i18n-check.yml) | tone-em-dash: tone-em-dash | aldrig bevist |
| CI | [.github/workflows/i18n-check.yml](../.github/workflows/i18n-check.yml) | tone-terms: tone-terms | aldrig bevist |
| CI | [.github/workflows/league-size-invariant-audit.yml](../.github/workflows/league-size-invariant-audit.yml) | audit: audit | aldrig bevist |
| CI | [.github/workflows/lighthouse-ci-skip-stub.yml](../.github/workflows/lighthouse-ci-skip-stub.yml) | perf-gate: perf-gate | aldrig bevist |
| CI | [.github/workflows/lighthouse-ci.yml](../.github/workflows/lighthouse-ci.yml) | perf-gate: perf-gate | aldrig bevist |
| CI | [.github/workflows/lockfile-drift-check.yml](../.github/workflows/lockfile-drift-check.yml) | lockfile-drift: npm ci + install-parity | aldrig bevist |
| CI | [.github/workflows/patch-notes-coverage-check.yml](../.github/workflows/patch-notes-coverage-check.yml) | patch-notes-coverage: patch-notes-coverage (advisory) | aldrig bevist |
| CI | [.github/workflows/perf-seo-review.yml](../.github/workflows/perf-seo-review.yml) | review: review | aldrig bevist |
| CI | [.github/workflows/playwright-smoke.yml](../.github/workflows/playwright-smoke.yml) | changes: changes | aldrig bevist |
| CI | [.github/workflows/playwright-smoke.yml](../.github/workflows/playwright-smoke.yml) | e2e-shard: e2e-shard | aldrig bevist |
| CI | [.github/workflows/playwright-smoke.yml](../.github/workflows/playwright-smoke.yml) | frontend-smoke: frontend-smoke | aldrig bevist |
| CI | [.github/workflows/pr-verification-check.yml](../.github/workflows/pr-verification-check.yml) | check-verification: check-verification | aldrig bevist |
| CI | [.github/workflows/quality-inbox.yml](../.github/workflows/quality-inbox.yml) | doctor: doctor | aldrig bevist |
| CI | [.github/workflows/railway-log-watch.yml](../.github/workflows/railway-log-watch.yml) | watch: watch | aldrig bevist |
| CI | [.github/workflows/reset-fk-audit.yml](../.github/workflows/reset-fk-audit.yml) | audit: audit | aldrig bevist |
| CI | [.github/workflows/restore-drill.yml](../.github/workflows/restore-drill.yml) | drill: drill | aldrig bevist |
| CI | [.github/workflows/rls-audit.yml](../.github/workflows/rls-audit.yml) | audit: audit | aldrig bevist |
| CI | [.github/workflows/season3-calendar-apply.yml](../.github/workflows/season3-calendar-apply.yml) | apply: apply | aldrig bevist |
| CI | [.github/workflows/secret-scan.yml](../.github/workflows/secret-scan.yml) | gitleaks: gitleaks | aldrig bevist |
| CI | [.github/workflows/security-grants-audit.yml](../.github/workflows/security-grants-audit.yml) | lint: Statisk REVOKE-lint (ændrede SQL-filer) | aldrig bevist |
| CI | [.github/workflows/security-grants-audit.yml](../.github/workflows/security-grants-audit.yml) | live: Live grant-tjek mod prod | aldrig bevist |
| CI | [.github/workflows/supabase-advisor-sweep.yml](../.github/workflows/supabase-advisor-sweep.yml) | sweep: sweep | aldrig bevist |
| CI | [.github/workflows/supabase-log-watch.yml](../.github/workflows/supabase-log-watch.yml) | watch: watch | aldrig bevist |
| CI | [.github/workflows/yaml-validate.yml](../.github/workflows/yaml-validate.yml) | actionlint: actionlint (workflow YAML) | aldrig bevist |
| CI | [.github/workflows/yaml-validate.yml](../.github/workflows/yaml-validate.yml) | yamllint-issue-templates: yamllint (issue templates) | aldrig bevist |
| eslint | [backend/eslint.config.js](../backend/eslint.config.js) | Samlet config inkl. importerede recommended-regelsæt; filglobs/overrides står i kilden | aldrig bevist |
| eslint | [backend/eslint.config.js](../backend/eslint.config.js) | no-unused-vars: warn (warning; kun blokerende via warning-budget) | aldrig bevist |
| eslint | [backend/eslint.config.js](../backend/eslint.config.js) | no-useless-assignment: off (deaktiveret) | aldrig bevist |
| eslint | [backend/eslint.config.js](../backend/eslint.config.js) | no-console: off (deaktiveret) | aldrig bevist |
| eslint | [frontend/eslint.config.js](../frontend/eslint.config.js) | Samlet config inkl. importerede recommended-regelsæt; filglobs/overrides står i kilden | aldrig bevist |
| eslint | [frontend/eslint.config.js](../frontend/eslint.config.js) | react/react-in-jsx-scope: off (deaktiveret) | aldrig bevist |
| eslint | [frontend/eslint.config.js](../frontend/eslint.config.js) | react/prop-types: off (deaktiveret) | aldrig bevist |
| eslint | [frontend/eslint.config.js](../frontend/eslint.config.js) | no-unused-vars: warn (warning; kun blokerende via warning-budget) | aldrig bevist |
| eslint | [frontend/eslint.config.js](../frontend/eslint.config.js) | no-console: off (deaktiveret) | aldrig bevist |
| eslint | [frontend/eslint.config.js](../frontend/eslint.config.js) | react-hooks/set-state-in-effect: off (deaktiveret) | aldrig bevist |
| eslint | [frontend/eslint.config.js](../frontend/eslint.config.js) | no-restricted-syntax: error | aldrig bevist |
| eslint | [marketing/eslint.config.mjs](../marketing/eslint.config.mjs) | Samlet config inkl. importerede recommended-regelsæt; filglobs/overrides står i kilden | aldrig bevist |
| agent-hook | [.claude/hooks/block-dangerous-secret-commands.ps1](../.claude/hooks/block-dangerous-secret-commands.ps1) | PreToolUse hook (PowerShell version) | aldrig bevist |
| agent-hook | [.claude/hooks/block-dangerous-secret-commands.sh](../.claude/hooks/block-dangerous-secret-commands.sh) | PreToolUse hook (matcher: Bash\|PowerShell) | aldrig bevist |
| agent-hook | [.claude/hooks/sanitize-secrets.ps1](../.claude/hooks/sanitize-secrets.ps1) | PostToolUse hook (PowerShell version) | aldrig bevist |
| agent-hook | [.claude/hooks/sanitize-secrets.sh](../.claude/hooks/sanitize-secrets.sh) | PostToolUse hook (matcher: Bash\|PowerShell\|mcp__.*\|Read\|Write\|Edit\|Grep) | aldrig bevist |
| agent-hook | [scripts/hooks/block-archived-edit.sh](../scripts/hooks/block-archived-edit.sh) | PreToolUse hook (matcher: Edit\|Write). Blocks edits to archived paths | aldrig bevist |
| agent-hook | [scripts/hooks/block-blocking-shell-commands.sh](../scripts/hooks/block-blocking-shell-commands.sh) | PreToolUse hook (matcher: Bash). Blokerer shell-kald der er kendt for at | aldrig bevist |
| agent-hook | [scripts/hooks/block-branch-switch-in-main-checkout.sh](../scripts/hooks/block-branch-switch-in-main-checkout.sh) | PreToolUse hook (matcher: Bash). Blokerer branch-skift i det DELTE hoved-checkout. | aldrig bevist |
| agent-hook | [scripts/hooks/check-ci-before-push.sh](../scripts/hooks/check-ci-before-push.sh) | PreToolUse hook (matcher: Bash). Når brugeren forsøger at `git push` og | aldrig bevist |
| agent-hook | [scripts/hooks/check-memory-budget.sh](../scripts/hooks/check-memory-budget.sh) | check-memory-budget.sh — SessionStart hook: surfacer MEMORY.md HOT-tier budget-status. | aldrig bevist |
| agent-hook | [scripts/hooks/check-now-md-edit.sh](../scripts/hooks/check-now-md-edit.sh) | PreToolUse hook (matcher: Edit\|Write). Hard-blocks edits to docs/NOW.md | aldrig bevist |
| agent-hook | [scripts/hooks/check-preflight-before-push.sh](../scripts/hooks/check-preflight-before-push.sh) | PreToolUse hook (matcher: Bash). Naar der forsoeges `git push` paa en | aldrig bevist |
| agent-hook | [scripts/hooks/clear-active-sessions.sh](../scripts/hooks/clear-active-sessions.sh) | Stop hook: recomputes the "🤖 Aktive sessioner" field in docs/NOW.md when | aldrig bevist |
| agent-hook | [scripts/hooks/cycling-manager-cleanup.sh](../scripts/hooks/cycling-manager-cleanup.sh) | cycling-manager: SessionStart self-heal | aldrig bevist |
| agent-hook | [scripts/hooks/ensure-scheduled-tasks.sh](../scripts/hooks/ensure-scheduled-tasks.sh) | SessionStart hook. For hver canonical task-konfiguration i | aldrig bevist |
| agent-hook | [scripts/hooks/lint-gh-issue.sh](../scripts/hooks/lint-gh-issue.sh) | PreToolUse hook (matcher: Bash). Scans `gh issue ...` invocations for | aldrig bevist |
| agent-hook | [scripts/hooks/protect-claude-process.sh](../scripts/hooks/protect-claude-process.sh) | PreToolUse hook: block any Bash/PowerShell command that targets claude.exe | aldrig bevist |
| agent-hook | [scripts/hooks/run-codex-hook.ps1](../scripts/hooks/run-codex-hook.ps1) | Transport only: resolve Git Bash, forward raw stdin/stdout/stderr and exit code. | aldrig bevist |
| agent-hook | [scripts/hooks/set-active-sessions.sh](../scripts/hooks/set-active-sessions.sh) | SessionStart hook: auto-sets the "🤖 Aktive sessioner" (fka "Working | aldrig bevist |
| agent-hook | [scripts/hooks/setup-worktree-if-needed.sh](../scripts/hooks/setup-worktree-if-needed.sh) | SessionStart + PreToolUse(Bash) hook. Auto-setup af et worktree der mangler | aldrig bevist |
| script / CI eller manuel | [scripts/brand-contrast-check.mjs](../scripts/brand-contrast-check.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-agent-token-hygiene.ps1](../scripts/check-agent-token-hygiene.ps1) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-anti-slop.mjs](../scripts/check-anti-slop.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-asset-miss-behaviour.mjs](../scripts/check-asset-miss-behaviour.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-build-determinism.mjs](../scripts/check-build-determinism.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-bundle-budget.mjs](../scripts/check-bundle-budget.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-cdn-cache-headers.mjs](../scripts/check-cdn-cache-headers.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-database-types-drift.mjs](../scripts/check-database-types-drift.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-dependabot-exceptions.mjs](../scripts/check-dependabot-exceptions.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-discord-bot-token.mjs](../scripts/check-discord-bot-token.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-e2e-shard-budget.mjs](../scripts/check-e2e-shard-budget.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-email-stack-doc.mjs](../scripts/check-email-stack-doc.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-eslint-disable-count.mjs](../scripts/check-eslint-disable-count.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-eslint-warning-budget.mjs](../scripts/check-eslint-warning-budget.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-event-catalog.mjs](../scripts/check-event-catalog.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-feature-registry-flags.mjs](../scripts/check-feature-registry-flags.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-fetchallrows-order.mjs](../scripts/check-fetchallrows-order.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-frontend-env-keys.mjs](../scripts/check-frontend-env-keys.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-maybesingle-unique-scope.mjs](../scripts/check-maybesingle-unique-scope.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-memory-refs.ps1](../scripts/check-memory-refs.ps1) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-now-md.sh](../scripts/check-now-md.sh) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-patch-notes-coverage.js](../scripts/check-patch-notes-coverage.js) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-patch-notes-version.js](../scripts/check-patch-notes-version.js) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-pro-prices.mjs](../scripts/check-pro-prices.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-rate-limit-coverage.mjs](../scripts/check-rate-limit-coverage.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-required-ci-jobs.mjs](../scripts/check-required-ci-jobs.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-resend-key.mjs](../scripts/check-resend-key.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-rls-classification-coverage.mjs](../scripts/check-rls-classification-coverage.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-schema-snapshot-staleness.mjs](../scripts/check-schema-snapshot-staleness.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-secdef-revoke-lint.mjs](../scripts/check-secdef-revoke-lint.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-skew-protection.mjs](../scripts/check-skew-protection.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-staged-docs.mjs](../scripts/check-staged-docs.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/check-stale-branches.sh](../scripts/check-stale-branches.sh) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/cross-pc-stop-check.sh](../scripts/cross-pc-stop-check.sh) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/db-verify-restore.mjs](../scripts/db-verify-restore.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/generate-guard-inventory.mjs](../scripts/generate-guard-inventory.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/guard-commit-branch.sh](../scripts/guard-commit-branch.sh) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/guard-node-modules-junction.mjs](../scripts/guard-node-modules-junction.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/i18n-check-backend-player-strings.mjs](../scripts/i18n-check-backend-player-strings.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/i18n-check-delta-pending.mjs](../scripts/i18n-check-delta-pending.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/i18n-check-duplicate-keys.mjs](../scripts/i18n-check-duplicate-keys.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/i18n-check-error-codes.mjs](../scripts/i18n-check-error-codes.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/i18n-check-icu-braces.mjs](../scripts/i18n-check-icu-braces.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/i18n-check-keys.mjs](../scripts/i18n-check-keys.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/i18n-check-leaks.mjs](../scripts/i18n-check-leaks.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/i18n-check-lib-strings.mjs](../scripts/i18n-check-lib-strings.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/i18n-check-namespace-inline.mjs](../scripts/i18n-check-namespace-inline.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/i18n-check-nav-strings.mjs](../scripts/i18n-check-nav-strings.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/i18n-check-page-untranslated.mjs](../scripts/i18n-check-page-untranslated.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/i18n-check-terrain-coverage.mjs](../scripts/i18n-check-terrain-coverage.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-action-pinning.mjs](../scripts/lint-action-pinning.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-constraint-form.mjs](../scripts/lint-constraint-form.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-dropped-supabase-error.mjs](../scripts/lint-dropped-supabase-error.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-finance-types.mjs](../scripts/lint-finance-types.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-getuser-guard.mjs](../scripts/lint-getuser-guard.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-lazy-with-retry.mjs](../scripts/lint-lazy-with-retry.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-migration-idempotency.mjs](../scripts/lint-migration-idempotency.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-pagination-guard.mjs](../scripts/lint-pagination-guard.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-postgrest-in-cap.mjs](../scripts/lint-postgrest-in-cap.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-rankings-raceresults-fetch.mjs](../scripts/lint-rankings-raceresults-fetch.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-riders-column-grant.mjs](../scripts/lint-riders-column-grant.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-schema-columns.mjs](../scripts/lint-schema-columns.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-silent-mutations.mjs](../scripts/lint-silent-mutations.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-sql-insert-arity.mjs](../scripts/lint-sql-insert-arity.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-sql-policy-grants.mjs](../scripts/lint-sql-policy-grants.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-sql-strings.mjs](../scripts/lint-sql-strings.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-swallowed-catches.mjs](../scripts/lint-swallowed-catches.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-t2-container-guard.mjs](../scripts/lint-t2-container-guard.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-ui-slop.mjs](../scripts/lint-ui-slop.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-unchecked-supabase-mutation.mjs](../scripts/lint-unchecked-supabase-mutation.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-unguarded-fetch-in-handler.mjs](../scripts/lint-unguarded-fetch-in-handler.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/lint-workflow-output-masking.mjs](../scripts/lint-workflow-output-masking.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/preflight-check.ps1](../scripts/preflight-check.ps1) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/preflight-night-wave.ps1](../scripts/preflight-night-wave.ps1) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/preflight-pr.ps1](../scripts/preflight-pr.ps1) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/preflight-season-cutover.ps1](../scripts/preflight-season-cutover.ps1) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/run-staged-checks.mjs](../scripts/run-staged-checks.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/setup-sentry-and-verify.ps1](../scripts/setup-sentry-and-verify.ps1) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/test-guard-commit-branch.sh](../scripts/test-guard-commit-branch.sh) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/tone-check-em-dash.mjs](../scripts/tone-check-em-dash.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/tone-check-terms.mjs](../scripts/tone-check-terms.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/verify-affected.mjs](../scripts/verify-affected.mjs) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/verify-deploy.ps1](../scripts/verify-deploy.ps1) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/verify-infisical.ps1](../scripts/verify-infisical.ps1) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/verify-invariants.ps1](../scripts/verify-invariants.ps1) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| script / CI eller manuel | [scripts/verify-local.ps1](../scripts/verify-local.ps1) | Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | SessionStart:0:0; matcher=; bash scripts/session-prefetch-issue.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | SessionStart:0:1; matcher=; bash scripts/hooks/ensure-scheduled-tasks.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | SessionStart:0:2; matcher=; bash scripts/hooks/setup-worktree-if-needed.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | SessionStart:0:3; matcher=; bash scripts/hooks/set-active-sessions.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | PreToolUse:0:0; matcher=; bash .claude/hooks/block-dangerous-secret-commands.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | PreToolUse:1:0; matcher=Bash; bash scripts/hooks/block-branch-switch-in-main-checkout.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | PreToolUse:1:1; matcher=Bash; bash scripts/hooks/setup-worktree-if-needed.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | PreToolUse:1:2; matcher=Bash; bash scripts/hooks/lint-gh-issue.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | PreToolUse:1:3; matcher=Bash; bash scripts/hooks/check-ci-before-push.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | PreToolUse:1:4; matcher=Bash; bash scripts/hooks/check-preflight-before-push.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | PreToolUse:1:5; matcher=Bash; bash scripts/hooks/block-blocking-shell-commands.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | PreToolUse:2:0; matcher=Edit; bash scripts/hooks/check-now-md-edit.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | PreToolUse:2:1; matcher=Edit; bash scripts/hooks/block-archived-edit.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | PreToolUse:3:0; matcher=Write; bash scripts/hooks/check-now-md-edit.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | PreToolUse:3:1; matcher=Write; bash scripts/hooks/block-archived-edit.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | PreToolUse:4:0; matcher=NotebookEdit; bash scripts/hooks/check-now-md-edit.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | PreToolUse:4:1; matcher=NotebookEdit; bash scripts/hooks/block-archived-edit.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | PostToolUse:0:0; matcher=Bash; bash .claude/hooks/sanitize-secrets.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | PostToolUse:1:0; matcher=PowerShell; bash .claude/hooks/sanitize-secrets.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | PostToolUse:2:0; matcher=mcp__.*; bash .claude/hooks/sanitize-secrets.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | PostToolUse:3:0; matcher=Read\|Write\|Edit\|Grep; bash .claude/hooks/sanitize-secrets.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | Stop:0:0; matcher=; bash scripts/check-now-md.sh | aldrig bevist |
| agent-binding | [.claude/settings.json](../.claude/settings.json) | Stop:0:1; matcher=; bash scripts/hooks/clear-active-sessions.sh | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | Write(docs/archive/**) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | Edit(docs/archive/**) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | NotebookEdit(docs/archive/**) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | Write(./docs/archive/**) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | Edit(./docs/archive/**) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | NotebookEdit(./docs/archive/**) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | Read(**/.env*) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | Read(.env*) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | Bash(cat *.env*) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | Bash(*cat *.env*) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | Bash(head *.env*) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | Bash(*head *.env*) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | Bash(tail *.env*) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | Bash(*tail *.env*) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | Bash(less *.env*) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | Bash(more *.env*) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | Bash(sed *.env*) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | Bash(*sed *.env*) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | Bash(awk *.env*) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | Bash(strings *.env*) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | PowerShell(Get-Content *.env*) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | PowerShell(*Get-Content *.env*) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | PowerShell(gc *.env*) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | PowerShell(cat *.env*) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | PowerShell(type *.env*) | aldrig bevist |
| agent-deny | [.claude/settings.json](../.claude/settings.json) | PowerShell(Select-String *.env*) | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | PreToolUse:0:0; matcher=; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 .claude/hooks/block-dangerous-secret-commands.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | PreToolUse:1:0; matcher=Bash; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 scripts/hooks/block-branch-switch-in-main-checkout.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | PreToolUse:1:1; matcher=Bash; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 scripts/hooks/setup-worktree-if-needed.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | PreToolUse:1:2; matcher=Bash; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 scripts/hooks/lint-gh-issue.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | PreToolUse:1:3; matcher=Bash; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 scripts/hooks/check-ci-before-push.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | PreToolUse:1:4; matcher=Bash; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 scripts/hooks/check-preflight-before-push.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | PreToolUse:1:5; matcher=Bash; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 scripts/hooks/block-blocking-shell-commands.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | PreToolUse:2:0; matcher=Edit; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 scripts/hooks/check-now-md-edit.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | PreToolUse:2:1; matcher=Edit; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 scripts/hooks/block-archived-edit.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | PreToolUse:3:0; matcher=Write; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 scripts/hooks/check-now-md-edit.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | PreToolUse:3:1; matcher=Write; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 scripts/hooks/block-archived-edit.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | PreToolUse:4:0; matcher=NotebookEdit; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 scripts/hooks/check-now-md-edit.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | PreToolUse:4:1; matcher=NotebookEdit; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 scripts/hooks/block-archived-edit.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | PostToolUse:0:0; matcher=Bash; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 .claude/hooks/sanitize-secrets.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | PostToolUse:1:0; matcher=PowerShell; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 .claude/hooks/sanitize-secrets.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | PostToolUse:2:0; matcher=mcp__.*; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 .claude/hooks/sanitize-secrets.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | PostToolUse:3:0; matcher=Read\|Write\|Edit\|Grep; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 .claude/hooks/sanitize-secrets.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | SessionStart:0:0; matcher=; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 scripts/session-prefetch-issue.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | SessionStart:0:1; matcher=; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 scripts/hooks/ensure-scheduled-tasks.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | SessionStart:0:2; matcher=; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 scripts/hooks/setup-worktree-if-needed.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | SessionStart:0:3; matcher=; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 scripts/hooks/set-active-sessions.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | Stop:0:0; matcher=; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 scripts/check-now-md.sh | aldrig bevist |
| agent-binding | [.codex/hooks.json](../.codex/hooks.json) | Stop:0:1; matcher=; pwsh -NoProfile -File scripts/hooks/run-codex-hook.ps1 scripts/hooks/clear-active-sessions.sh | aldrig bevist |
