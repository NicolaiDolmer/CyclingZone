# 2026-05-08 — Auto-merge label-flow: deploy-verify fyrede ikke pga GITHUB_TOKEN anti-loop-safeguard

## Bug

PR [#118](https://github.com/NicolaiDolmer/CyclingZone/pull/118) (lint-staged 15→17, mergede 2026-05-08T10:36:05Z via `auto-merge` label) fik INGEN `Deploy verify`-run. Brugeren fik ingen ✅/❌-bekræftelse på at prod-deployet lykkedes. For #118 var konsekvensen nul (dev-dep), men næste UI-feature shipped via label ville miste smoke-testen.

## Root cause

`auto-merge.yml` brugte `gh pr merge --auto` med `GITHUB_TOKEN`. Når CI blev grøn, mergede auto-merge-køen PR'en med `mergedBy = app/github-actions` (bot). GitHub's [anti-loop-safeguard](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#using-the-github_token-in-a-workflow) blokerer ALT downstream — `push`, `pull_request: closed`, `status` — fra `GITHUB_TOKEN`-aktivitet.

Smoking gun (verificeret via `gh pr view --json mergedBy`):

| PR | mergedBy | deploy-verify |
|----|----------|---------------|
| #116, #126, #140, #190 | NicolaiDolmer (manuel klik) | ✅ kørte |
| **#118** | **app/github-actions** | **❌ skipped** |

PR [#186](https://github.com/NicolaiDolmer/CyclingZone/pull/186)'s `pull_request: closed`-trigger virkede kun for non-`GITHUB_TOKEN`-mergers. Det er ironisk — fixet for "auto-merge bryder deploy-verify" testede aldrig den faktiske auto-merge-path, fordi alle dependabot-PRs siden 2026-05-07 var manuelt mergede.

## Fix

PR [#191](https://github.com/NicolaiDolmer/CyclingZone/pull/191):

`auto-merge.yml` + `dependabot-auto-merge.yml`:
- Venter synkront på required checks via `gh pr checks --watch --fail-fast --required`
- Merger uden `--auto` (vi bruger Action-minutes som tradeoff for korrekt downstream)
- Trigger `deploy-verify` eksplicit via `gh workflow run deploy-verify.yml --ref main -f sha=... -f pr_number=...`
- `concurrency` group cancel-in-progress på dependabot for at undgå parallelle instances ved synchronize-events

`deploy-verify.yml`:
- Tilføjede `workflow_dispatch` trigger med `sha` + `pr_number` inputs
- Opdaterede SHA-resolver til at handle workflow_dispatch case

## Læring

**1. `workflow_dispatch` er undtaget fra anti-loop-safeguard — det er den officielle workaround.** Per GitHub docs: "events triggered by the GITHUB_TOKEN, with the exception of workflow_dispatch and repository_dispatch, will not create a new workflow run." Når en workflow under `GITHUB_TOKEN` har brug for at trigge en anden workflow, er `gh workflow run` det rette værktøj — IKKE at håbe på `push`/`pull_request`.

**2. Verificér en workflow-fix på den FAKTISKE path den fixer, ikke en tilstødende.** PR #186 fixede `pull_request: closed`-triggers, men det var aldrig auto-merge-path'en der var problemet — det var GITHUB_TOKEN-merge-actor'en. Hver PR siden mergede manuelt (NicolaiDolmer), så bug'en gemte sig i 24+ timer indtil #118 blev første test-case.

**3. `mergedBy` er smoking gun for "hvorfor fyrede min workflow ikke".** Når et merge-trigger workflow uventet skipper, er `gh pr view N --json mergedBy` første query. `app/github-actions`/`dependabot[bot]` betyder GITHUB_TOKEN, ikke-user mergers, og safeguard gælder. Et user-login betyder at workflows fyrer normalt.

**4. `gh pr merge --auto` har misvisende success-semantik.** Den returnerer success når PR er sat i kø — IKKE når den faktisk merger. At trigge downstream-jobs fra slutningen af samme workflow virker derfor ikke som man tror — workflowet slutter inden mergen sker. Synkron `gh pr checks --watch + gh pr merge` koster Action-minutes (~$0.04/PR) men giver kontrolleret timing.

**5. Konkurrerende workflows kræver `concurrency` group.** Dependabot's `pull_request: synchronize` event fyrer hver gang dependabot pusher en rebase/fix-up til PR'en. Uden `concurrency.cancel-in-progress: true` ville flere instances af `gh pr checks --watch` køre parallelt for samme PR.
