# #4753 bootstrap release evidence, 9 September 2026

SSOT: [GAME_INVARIANTS.md](../GAME_INVARIANTS.md),
[TRANSFER_MARKET_RULES.md](../TRANSFER_MARKET_RULES.md),
[ECONOMY_RULES.md](../ECONOMY_RULES.md). Activation and repair remain governed by
the [release runbook](../runbooks/4753-ai-pool-retirement-release.md).

## Authorized bootstrap

Owner review round 2 approved PR #5066, including the AI prize invariant fix
from #896 and patch note 7.268. The owner explicitly authorized this one squash
merge outside the merge queue: the new workflow_run publisher cannot exist on
the default branch until this PR merges. Missing league-size-invariant therefore
blocks its own bootstrap. This is not a precedent for ignoring the league check.
The authorization and rationale are recorded in
[issue comment](https://github.com/NicolaiDolmer/CyclingZone/issues/4753#issuecomment-5605921751).

Reviewed code SHA: `0b7e95d45a7f8fa030e6ddfe8184243964c639a9`.
Final PR SHA: `31fbcb0a1210b2acea1919fc6df38d4b0c98f614` (only NOW session claim added).
All checks had finished before merge. The only failing check was the existing
Feature-liveness audit with five findings (#3069). All three browser projects
passed in [the final run](https://github.com/NicolaiDolmer/CyclingZone/actions/runs/34382138154).
This does not erase the earlier local browser failures documented in #4925.

PR #5066 merged at 17:32:13 UTC (19:32 CEST), commit
`3759ab2e639ffcb3f4888e105338a97aad63484e`.

## Installation and read-only post-verification

Comparing repository migration filenames with schema_migrations before merge
showed exactly one pending migration. [Auto-migrate run 34383508698](https://github.com/NicolaiDolmer/CyclingZone/actions/runs/34383508698)
succeeded and applied only `database/2026-09-09-4753-ai-pool-retirement.sql`.
The production row records applied_at `2026-09-09 17:35:44.718141+00`.

| Observation | Before merge, 17:31:33 UTC | After apply, 17:36:05/23 UTC |
|---|---|---|
| Physical team count, pools 1-12 and 14-15 | 24 each | 24 each |
| Physical team count, pool 13 (Division 4 F) | 25 | 25 |
| Teams with pending_removal_at | 0 | 0 |
| Historically retired teams | 8 | 8 |
| ai_pool_retirement_v2_enabled config rows | 0 | 0 |
| ai_team_retire_enabled | on | on |
| ai_pool_retirement_enabled() | Not installed | false |

Measured through read-only Supabase execute_sql. No direct production mutation
was executed. The owner-authorized auto-migration installed the schema objects;
the retirement behavior remained inactive. This observation is bounded to these
snapshots and is not a general assertion that deployment changes nothing: future
AI prize eligibility intentionally changes with the backend release.

Both deployments were observed on the exact merge commit:

- [Vercel production](https://vercel.com/nicolai-dolmers-projects/cycling-zone/37QpLRJroyZybTy3CW98yRqa2xpx): READY.
- Railway production service CyclingZone, deployment `2c271a11-5f4e-4701-af8d-48f202b07d83`: SUCCESS, observed through Railway list_deployments.

The [main CI run](https://github.com/NicolaiDolmer/CyclingZone/actions/runs/34383508690)
passed. Main was not universally green: besides Feature-liveness (#3069),
[actionlint check 102573997019](https://github.com/NicolaiDolmer/CyclingZone/runs/102573997019)
reported SC2012 on `.github/workflows/restore-drill.yml:69`. The file is unchanged
by #5066; its last modification was `81f89864a` on 19 August. The finding is
recorded here without calling the new league publisher defective or fixing an
unrelated workflow in this release-evidence PR.

## Remaining gates

Both actual workflow_run executions used trusted main revision
`3759ab2e639ffcb3f4888e105338a97aad63484e`. Their checkout, production measurement
and PR-check publication steps all succeeded. The separate Fail if findings step
then correctly failed because Division 4 F still had 25 teams. There was no
credential skip, no PR-code execution with secrets, and no fabricated green result.

| PR | Exact PR head SHA | Unique GitHub Actions check | Trusted workflow_run |
|---|---|---|---|
| Ordinary #5071 | `a96c9960782eaa1d2dc6c9d05c99794e5380c188` | [102579954168](https://github.com/NicolaiDolmer/CyclingZone/runs/102579954168) | [34385281610](https://github.com/NicolaiDolmer/CyclingZone/actions/runs/34385281610) |
| Dependabot #5070 | `d5e6d63776b23a1c2e772caef8d40d34558a670c` | [102578723248](https://github.com/NicolaiDolmer/CyclingZone/runs/102578723248) | [34384904156](https://github.com/NicolaiDolmer/CyclingZone/actions/runs/34384904156) |

GitHub check-runs returned exactly one league-size-invariant check on each SHA,
with external_id `league-audit:<that SHA>`, app github-actions, completed/failure.
The public summaries measured all 15 pools, one finding and zero waiting cases
at 17:49:56 UTC (ordinary) and 17:46:21 UTC (Dependabot). These are observations
of named revisions; later documentation commits require their own check result.

Dependabot's real version-update job 1566595629 created #5070. Its unrelated
auto-merge workflow stopped because AUTO_MERGE_PAT was unavailable; no credentials
were changed. #5070 was converted to draft to retain it for review without a
dependency release. That auto-merge failure is distinct from the successful
production measurement in the trusted league workflow.

The real merge queue was exercised with `-Pr 5071 -DryRun`: exit 1, no merge.
Separately, `gh pr checks 5071 --required` returned 0, while the production
Get-LeagueCheckExitCode helper returned 1 for the observed check list. This proves
the league guard stopped a merge despite the existing required checks passing.
It does not prove GitHub branch protection enforces the context; that setting
remains unchanged. All-green population proof still awaits owner-gated repair.

Branch protection was read only: 26 existing required contexts, without
league-size-invariant. No setting was changed. Activation, pool repair and branch
protection each require a new owner go and an immediate fresh dry-run. #4753 stays
open. Deferred work #5067/#5068/#5069, #3069 and #4925 was not implemented here.

Patch notes: no additional note for this documentation-only follow-up. Release
note 7.268 already covers the AI prize fix; the pool-repair note remains withheld.

## 10 September re-verification

A 10 September handoff comment on #5071 called the league-size-invariant check
"stale-red" and claimed the invariant had measured green on every PR since
21:55 CEST on 9 September, with Division 4 F in `waiting` and zero findings.
That claim is not backed by a fresh check result. Read-only re-verification
against production on 10 September (this PR, via Supabase `execute_sql`) found:

- `league_divisions` id 13 (Division 4 — F, tier 4, pool_index 5) still has
  exactly 25 teams — unchanged from the 9 September measurement above.
- 14 teams repo-wide have `league_division_id IS NULL` (never pool-allocated).
  This sits outside the league-size-invariant's own scope by design (see the
  exclusion comment in `backend/scripts/audit-league-size-invariant.js`), so it
  does not change the check's pass/fail verdict, but it is a related
  data-quality gap worth tracking separately from #4753.

The finding is real, not stale. The check is still not a required GitHub
context (branch protection unchanged, see above), and any repair — pool 13's
surplus or the 14 unallocated teams — needs its own owner go per the release
runbook. This PR does not activate, repair or reconfigure branch protection.

## Process limitation observed during this session

For the NOW claim commit, bare bash was missing from PowerShell PATH. The shell
continued because a command-resolution error did not update LASTEXITCODE, so the
requested branch guard did not run before that commit. An immediate check with
the absolute Git Bash path passed; the commit changed only NOW on the correct
worktree branch. This is a process miss, not a successful pre-commit guard proof.
Subsequent commits use ErrorActionPreference=Stop and the absolute Git Bash path
with an explicit success-dependent commit. No general hook change is made here.
