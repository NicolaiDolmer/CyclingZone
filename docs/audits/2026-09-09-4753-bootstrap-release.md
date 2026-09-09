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

This ordinary documentation PR exercises the trusted publisher after merge.
A real Dependabot GitHub Actions version-update job was requested through its
Check for updates UI. Neither request itself proves publication; record the
actual check ID, exact head SHA, trusted workflow revision and measurement result
in #4753 after each completes. A red measurement of the remaining surplus is the
correct result; green population and enforced protection remain separate proofs.

Branch protection was read only: 26 existing required contexts, without
league-size-invariant. No setting was changed. Activation, pool repair and branch
protection each require a new owner go and an immediate fresh dry-run. #4753 stays
open. Deferred work #5067/#5068/#5069, #3069 and #4925 was not implemented here.

Patch notes: no additional note for this documentation-only follow-up. Release
note 7.268 already covers the AI prize fix; the pool-repair note remains withheld.

## Process limitation observed during this session

For the NOW claim commit, bare bash was missing from PowerShell PATH. The shell
continued because a command-resolution error did not update LASTEXITCODE, so the
requested branch guard did not run before that commit. An immediate check with
the absolute Git Bash path passed; the commit changed only NOW on the correct
worktree branch. This is a process miss, not a successful pre-commit guard proof.
Subsequent commits use ErrorActionPreference=Stop and the absolute Git Bash path
with an explicit success-dependent commit. No general hook change is made here.
