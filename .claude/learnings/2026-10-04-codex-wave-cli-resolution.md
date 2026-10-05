# Codex wave: app CLI hidden by npm shim

Refs #5893 #5467. SSOT: docs/PARALLEL_WORKTREE_ORCHESTRATION.md.

Cause: Windows Get-Command selected the first PATH entry only. On 4/10 that
was the npm PowerShell shim (CLI 0.153.4), while the running desktop app had
CLI 0.160.0 later on PATH. The committed wave plan also omitted lanes and
titles: read-only dry-run showed two lanes and four null titles.

Fix: discover all PATH commands and prefer the desktop app executable under
LOCALAPPDATA/OpenAI/Codex/bin, without pinning a release hash or changing models.
Preserve CLI-only and non-Windows fallback. Add the plan's four lanes/titles;
ownership and existing-PR/worktree admission remain unchanged.

Regression evidence: two selection tests failed with the old first-source
behavior (npm chosen instead of app). Six focused discovery tests cover app
priority, Windows spelling, false prefix matches, fallbacks and no CLI.
Real discovery/version and dry-run are checked before the PR handoff.

Scope: no real wave, old worker restart, merge, apply, prod write or player text.
Patch notes are unnecessary for this agent-runtime correction.
