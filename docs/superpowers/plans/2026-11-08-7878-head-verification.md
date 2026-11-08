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
