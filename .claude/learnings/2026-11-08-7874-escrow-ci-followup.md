# #7874: escrow integration and CI follow-up

The PR's rider-state lookup already batches unique primary keys in groups of
200, but the pagination guard cannot prove that bound from the loop. Document
the existing bound at the query rather than extending the guard baseline.

The manual admin escrow list/resolution routes intentionally have no frontend
caller. Detector B needs an explicit operational-route classification; a
regression test now checks both routes and retains detection of unrelated
unwired admin actions. The new test failed before the classification change.

The earlier frontend-smoke failure came from a cancelled changes job, before
any E2E lane ran. A fresh CI run is required; this evidence does not establish
that the frontend suite passed.

The inherited WIP cd481f6ea tests passed locally (24/24) after merging main and
applying the test commit. Do not infer test status from the WIP commit message.
PGlite flush tests log missing race_entries fixture warnings from best-effort
cleanup; the escrow assertions pass, but those fixtures do not verify cleanup.

No feature flag, production state, UI or player text changes in this follow-up.

Local verification environment: verify-local stopped in the unchanged #5562
wave-lock test with Windows EPERM; that exact test passed on a direct rerun.
Two welcome-email tests assume EMAIL_UNSUB_SECRET is absent, but explicitly
passing undefined selects the production environment default. With Infisical
the key exists. Rerunning that file with the key removed only from the child
test process passed 13/13. Stored secrets and unrelated mail code were unchanged.
