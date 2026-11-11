# Weekly SEO recovery implementation plan

> For agentic workers: use superpowers:executing-plans inline, with one independent branch review. Steps below are checkpoints, not merge authorization.

**Goal:** Restore the weekly review's GitHub authentication and include its SEO-drop issues in the Monday report.

**Architecture:** Pass the existing job token to the pinned Claude action. A small read-only GitHub adapter supplies a dated issue list to the existing Monday report. Unknown or capped input remains explicit.

**Tech stack:** GitHub Actions, Node built-ins, existing Supabase-backed reporting CLI (database queries unchanged).

**Spec:** [Owner design and current plan, #7440](https://github.com/NicolaiDolmer/CyclingZone/issues/7440#issuecomment-6800767551); `docs/GROWTH_STACK.md` section 1.3.

## Constraints

- One issue/PR; no merge, production apply, activation or manual Discord/email send.
- Existing workflow token permissions, pinned action, public measurement URLs and thresholds stay authoritative.
- Inject an explicit `now` and GitHub reader into tests. Never treat unavailable input as an empty successful result.
- Draft after this first commit; push each meaningful checkpoint and at least every half hour during coding.
- All heavy verification uses `verify-lock.ps1 -Runtime codex -Max 1`, coordinated with the other chat.
- No player copy or behavior changes. Patch notes, Help and FEATURE_REGISTRY are not applicable.

## Review focus

- The action input must use its supported provided-token path; Claude OAuth and GitHub authentication are distinct.
- A missing GitHub CLI/login, invalid JSON or invalid row must report unknown, without raw credential-bearing errors.
- A capped result cannot claim a complete count; zero issues does not assert healthy Lighthouse scores.
- Include open and closed drop issues within the explicit reporting period, deduplicated and linked to this repository.
- Real scheduled operation remains Claude's post-merge verification; local fixtures are not production evidence.

## Task 1: Publish the plan

- [x] Verify current source, owner scope, prior merged #7442 and failing weekly run 42627528452.
- [x] Create isolated worktree from main ef5cdbe2e; bootstrap behind the single heavy slot.
- [x] Baseline existing Monday/SEO tests: 17/17 passed.
- [ ] Independent read-only plan review, guarded commit, push and immediate draft PR.

## Task 2: Reproduce and implement

**Files:** `.github/workflows/perf-seo-review.yml`, new `scripts/weekly-seo-report.mjs`, `scripts/monday-numbers.mjs`, `scripts/monday-numbers.test.mjs`.

**Interfaces:** `readWeeklySeoDrops({ now, runGh })` returns a complete, unavailable or incomplete issue-source result; `renderWeeklySeoDrops(result)` renders only that evidence. The CLI passes its captured `now` explicitly and includes the result in JSON and text.

- [ ] Add tests to the existing Monday CI entry: period boundaries, open/closed issues, deduplication, empty complete input, unavailable/invalid/capped input and rendering.
- [ ] Observe meaningful RED against a minimal adapter, then implement the read-only adapter and observe GREEN.
- [ ] Wire the adapter into the report; pass `secrets.GITHUB_TOKEN` through the action's documented `github_token` input.
- [ ] Update GROWTH_STACK and add a bug learning. Database queries and dependencies are unchanged.
- [ ] Review and push the meaningful implementation checkpoint; keep the draft body current.

## Task 3: Verify and hand off

- [ ] Run focused Monday/SEO tests, syntax and workflow checks.
- [ ] Run FULL and preflight behind the single heavy slot; preserve receipts privately.
- [ ] Independent whole-diff review, fix findings, push, and obtain clean current-head Codex review.
- [ ] Mark ready; observe technical CI. Record the separate genuine Claude marker requirement for this workflow change.
- [ ] Update #7440 with PR/SHA/evidence and post-merge verification instructions. Production verification stays pending until Claude observes an actual successful weekly run and report path.
