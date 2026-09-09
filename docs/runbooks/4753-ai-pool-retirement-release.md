# #4753: owner-gated release and verification

SSOT: TRANSFER_MARKET_RULES.md, GAME_INVARIANTS.md, CALENDAR_RULES.md, ECONOMY_RULES.md.
Design-go was given in the owner chat on 9 September. Production go is separate.
**Every remaining production step needs its own fresh owner go.** Auto-migrate runs on merge.

Owner review round 2 authorized PR #5066's bootstrap merge and automatic install
on 9 September; both are complete and [post-verified](../audits/2026-09-09-4753-bootstrap-release.md).
The ordinary-PR and Dependabot publishers are observed on exact head SHAs, and
the merge-queue dry-run correctly blocks the remaining surplus. This is not
authorization to enable v2, repair pool 13 or change branch protection. Each
requires a new explicit owner go and an immediately refreshed private dry-run.
The one-time merge-queue exception for #5066 must not be reused for follow-up PRs.

The old kill switch `ai_team_retire_enabled` is already on in production (read-only
9/9). It cannot double as a safe deployment gate. The NEW
`ai_pool_retirement_v2_enabled` is absent/off and is never enabled by this migration.
Both must be on for SQL reservation/draining/retirement and automatic entry draining.
The new gate makes installation behaviorally inactive for retirement; DDL still
takes locks, and deployment also changes future prize eligibility for AI teams.
Existing financial history is preserved. Never call the entire deployment inert.

1. Generate a fresh read-only preview with
   `node backend/scripts/preview-ai-pool-retirement-sql.mjs` and execute that SELECT
   against production. It inlines the exact migration planner without installing SQL.
   Privately show the owner team UUID/name, pool, rider count, preserved offers,
   zero deleted offers, future entry removals and all 15 physical pool counts.
   Also count the candidate riders' rider_watchlist rows read-only and show the
   owner their planned removal/notification; they are player data too.
2. Obtain explicit go for that live state and release. Any repair exception to a
   red invariant requires owner approval for an exact PR/SHA, reason and follow-up
   evidence in #4753. The merge queue has no bypass switch.
3. Merge only the reviewed PR. Observe auto-migrate completion, functions/grants
   and BOTH flags read-only, then the next backend/frontend deployments READY.
   Do not chain this with activation or a repair; inspect the observed state first.
4. Regenerate the private dry-run immediately before activation. A changed candidate
   or scope needs fresh owner approval. Activating the NEW gate allows the regular
   sweep to retire eligible teams automatically; it is itself a production mutation
   covered by the explicit go, never an innocuous configuration step.
5. Re-measure after activation. If manual repair remains necessary, obtain a matching
   approved dry-run and use `--apply --owner-go --team=<approved UUID>` for exactly one
   candidate per CLI invocation. Recheck the result before another action.
6. For the currently measured 15 active pools, verify all 15 physical counts are 24,
   no unexplained pending state, and preservation of team/rider/result/offer history.
   The general SSOT also permits zero in dormant tier 3/4 pools without real managers;
   a newly dormant pool is a changed live state to explain, not a silent relaxation
   of this incident's success criterion.
7. Observe a NEW PR's unique `league-size-invariant` check passing on its exact head.
   The trusted `workflow_run` publisher only exists after merge into main: local
   mocks cannot prove its deployed GitHub permissions/event wiring. Exercise both
   an ordinary PR and a Dependabot PR; no skipped credential check counts as proof.
8. Preserve existing main protection while adding `league-size-invariant` as required
   (GitHub Actions app); read it back and exercise the merge queue with `-DryRun`.
   Missing, skipped, pending, ambiguous and failed checks must block merging.
   **Owner policy: a red live league audit blocks ALL PRs, including unrelated
   docs and dependency updates.** Fix the invariant; do not disguise drift as green.
9. Record real failure/ignored evidence AND successful enforcement in GUARD_INVENTORY,
   replace local-only verification claims with release evidence, update #4753 and
   measured related issues. Never close because the implementation PR merely merged.
   The follow-up evidence PR also updates FEATURE_REGISTRY and the manual required-
   check mirror in scripts/ci-required-checks.json to the observed live settings.
   Clear NOW's session lock when the session ends; unresolved release work stays in
   the issue/runbook, not a permanently occupied session lock.

## Patch note held until successful activation

The deployment note covers the AI prize fix, which takes effect with the backend.
The pool repair note is deliberately withheld until step 6 has been observed.

EN: **League pools return to 24 teams.** Four pools had 25 teams instead of 24.
Surplus AI teams now leave automatically once their ongoing races and deals are
finished. Their history is preserved.

DA: **Ligapuljer vender tilbage til 24 hold.** Fire puljer havde 25 hold i stedet
for 24. Overskydende AI-hold forlader nu automatisk puljen, når deres igangværende
løb og handler er afsluttet. Deres historik bevares.
