# #7878 current-HEAD verification and cross-path fixes

Owner mandate 8/11: after #7875, bring draft #7878 from 484f908e6 up against
main, fix actual failures and obtain Codex review on HEAD. Do not wait for four
unavailable old Claude notes. Dirigent supplies fresh independent review and
Claude marker; PC1/owner retains merge, apply and activation. Flags remain off.

1. Fetch and merge origin/main via FETCH_HEAD, without rebase/force-push.
   Old backend/smoke red summaries came from cancelled change-detection jobs;
   fresh CI must execute the actual checks. Inspect the security result too.
2. Read SSOT §5.1 and review the full runtime diff. Regression-first fixes for
   failed flag reads and transfer/start floor/seat claims; preserve off paths.
   Add reproducible real PG17 evidence and registry flag/SSOT linkage.
3. Verify focused JS/SQL, full verify-local, lint, migration/registry guards,
   frontend E2E and preflight under the shared verify semaphore. On preflight
   failure rerun only that check. Independent diff review before guarded
   commit/push; Codex cloud review and CI must match final HEAD. Two CI failures
   with the same symptom park the track with exact issue status.
4. PR body follows template with Refs #7873, commands/output and limitations.
   Report HEAD/CI/review/missing steps on issue and PR for dirigent marker.

Owner continuation 8/11: integrate PR5 8242a48fa after fresh main e21924749,
preserving M2's release fixture and M3's atomic proxy fixture. Match the shared
SQL fixture's proxy uniqueness constraint to production and exercise the real
proxy RPC on an auto-started auction, including transactional rejection.
Repeat combined JS/SQL/PG17, preflight, full verification and HEAD-bound review.
PR5 stays untouched while dirigenten reviews it. After PR6 handoff, resolve
PR3's main conflict and verify that separate worktree under the same gates.

9/11 continuation: integrate technically green PR5 ad8872a52 after its final
handoff. Preserve M2 runtime/migration and the audit-log test correction. Combine
the key-specific flag fixture/release RPC with locked bid contexts and the real
notification builders. Match service-role config reads in the SQL fixture and
exercise the full receipt plus atomic matching on an auto-created auction.
Run combined JS/SQL/PG17, preflight, independent review and guarded push. Freeze
the new HEAD for full verification, all three browser projects, CI and Codex.
