# 2026-05-07 — Automation-workflow-hardening efter natlig fail-audit

## Bug

3 stuck items efter natlige Claude-runs:
- **PR #110** (overnight Dependabot/CodeQL-pilot fra claude.ai/code session): auto-review fejlede med `Reached maximum number of turns (8)` — multi-fil PR kunne ikke nå at blive reviewet inden cap
- **Issues #89, #93** (`@claude`-trigger via GitHub Action): bot pushede branch + commits, men oprettede IKKE PR — efterlod kun "Create PR ➔" link i comment
- **`main`-branch var ikke protected** — alle workflows kunne theoretisk pushe direkte uden CI-gate

## Root cause

1. **`claude-review.yml` havde `--max-turns 8`** — for lavt til multi-fil PR-reviews. Reviewer brugte alle turns på at læse filer; ingen tilbage til at skrive review-comments.
2. **`claude.yml` havde ingen custom prompt** — default-flow for `anthropics/claude-code-action@v1` på issue-comments er "implementér + commit + push branch", IKKE "opret PR". PR-creation kræver eksplicit instruktion.
3. **To forskellige mekanismer** med forskellig autonomi: `claude-code-action` (begrænset, branch-only) vs `claude.ai/code remote session` (fuld autonomy inkl. `gh pr create` via brugerens auth). Mekanismerne kunne se identiske ud udefra, men opførte sig forskelligt.
4. **Branch protection var aldrig sat op** — Lag 5 i `docs/GITHUB_WORKFLOW.md` markeret "🔜 Senere".

## Fix

PR [#113](https://github.com/NicolaiDolmer/CyclingZone/pull/113) (squash `31b7777`):
- `claude.yml`: custom prompt der eksplicit instruerer `gh pr create` efter push; `--max-turns 25`; Sonnet 4.6 default; `--allowed-tools` udvidet med `gh pr/issue/label`; failure-comment-step
- `claude-review.yml`: `--max-turns 8 → 20`; `exclude_comments_by_actor: claude[bot]` (anti-loop); skip drafts; failure-comment-step
- `claude-triage.yml`: `--max-turns 6 → 15`; skip claude[bot]-issues; allowed-tools eksplicit; failure-comment-step

Branch protection på `main` via `gh api PUT branches/main/protection`:
- `required_status_checks`: backend-tests + frontend-build (strict: false)
- `allow_force_pushes: false`, `allow_deletions: false`
- `enforce_admins: false` (admin-bypass som escape hatch for hot-fixes/docs)
- `required_pull_request_reviews: null` (user-merge-klik er gate, ingen formel review-required)

## Læring

**1. Workflow-defaults er sjældent det man vil have.** `claude-code-action`'s default-flow på issue-events stopper ved "branch pushed". For 24/7-automation skal man eksplicit instruere PR-creation i `prompt`-feltet. Reading af `action.yml` direkte (ikke kun docs/usage.md) afslørede alle ~30 input-parametre — `track_progress`, `branch_name_template`, `exclude_comments_by_actor` osv. var skjult i action.yml-source.

**2. GitHub auto-close-keywords matcher ANYWHERE i PR-body, ikke kun ved issue-reference.** PR #110's body indeholdt instruktiv tekst "Close #90 once UI step done" — meningen var "husk at lukke manuelt", men GitHub auto-lukkede #90 ved merge. Tilsvarende: squash-merge bærer original commit-body med ind i merge-commit, så `Closes #N` i bot's første commit overlever selv hvis PR-bodyen kun bruger `Refs`. Memory opdateret ([feedback_github_close_protocol.md](../../../OneDrive/CyclingZone-context/memory/feedback_github_close_protocol.md)).

**3. `--max-turns` er en stille single-point-of-failure.** Hvis en workflow rammer cap, fejler den hårdt uden delvis output. For reviews specifikt: cost ved 20 turns ≈ $0.80 (Opus); cost ved at gå glip af et review = manuel læsning af hver PR. 20 er klar vinder. For triage (Sonnet, billigere): 15 giver luft til grep + investigation-comment uden at koste meget.

**4. Bootstrapping: hvis fix til workflow ligger i workflow-PR'en selv, kører den nye workflow ikke før merge.** PR #113 blev reviewet af det GAMLE max-turns-8-flow → fejlede igen. Fix: hav bootstrapping-strategi (manuel merge med admin-bypass, eller pre-merge med temporary disable af review-workflow). Vi merged manuelt — fungerede fordi auto-review er non-gating.

**5. Failure-notification = comment-back på issue/PR rækker.** Bruger ville først have Discord-webhook; vi forenklede til "bot kommenterer på issue/PR ved failure → GitHub mobile/email-notif håndterer resten". Ingen ny infrastruktur, samme effekt. Spørg om eksisterende notification-kanaler før man bygger nye.

**6. Konfirmér før branch protection — men accepter når brugeren beder om automatik.** Branch protection er en stor state-ændring per `feedback_confirm_before_state_change.md`. Jeg foreslog det først, fik OK ("igangsætte starten af dine forslag"), og applied. Husk: brugerens preference for kontrol = manuel approval-gate IKKE auto-merge, ikke "spørg om hver eneste tweak".
