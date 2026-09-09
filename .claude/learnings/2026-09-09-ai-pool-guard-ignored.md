# #4753: a correct alarm without an enforced response

The failure was operational as well as technical. League-size audit reported real
excess, but merges continued. Read-only evidence on 9 September: PR #5057 had a
failed league audit, another unrelated successful check named `audit`, and branch
protection did not require the league check. The merge queue checked only required
contexts before using its admin merge path. A red check alone was no barrier.

Issue #4233 had also been closed during an audit while the underlying decision remained
open. Closure and `claude:done` are not evidence of resolution. Always verify the
decision, the delivered runtime behavior and the live invariant separately.

The owner's initial C request rested on 4 September's figures. The required fresh
measurement found retirement already deployed (#4762), 14 pools at 24 and D4 F at
25 with no pending marker. The sweep only discovered marked teams. We stopped and
obtained a new explicit design-go: preserve history, transactional reservation and
retirement, draining, discovery of every pool and enforced audit. The historical
cause of the missing marker was not proven; do not present a plausible signup
interruption as an observed cause.

Evidence must exercise the real guard: a fresh marker with no live obligation
must still fail audit; concurrent retirement must stop at the pool target; a
stage-one claim must protect entries before stages_completed increments. Local
SQL tests also caught listing-status and negotiation-field mismatches, and review
found an entry-batch lock-order conflict before release.

Release gate: owner sees a fresh read-only candidate list before any prod change.
After release, record all 15 pools at 24 and a new PR's genuinely green unique
league check, require it in GitHub, and retain the failure/ignored evidence in
GUARD_INVENTORY. Until observed, the incident stays open and enforcement is unproven.

Review follow-up: test actual effects, not the intention written above a migration.
The suggested existing feature flag was already ON in production: reusing it would
not make deployment safe. A separate absent/off release gate now protects SQL and
backend entry draining. A secret-based PR audit must support Dependabot without a
false-green skip or executing untrusted PR code with production credentials.
The trusted default-branch publisher still needs a real post-merge event test.

The owner also caught an incorrect assumption in our proposed waiting policy:
AI teams must receive no prize cash. Read-only finance/result joins proved existing
AI credits; new payout plans now exclude AI/bank teams. Historical records remain.
Review comments are hypotheses to verify, including comments that are partly right.
Fixture tests exercise real migration SQL, but do not reproduce the complete prod
RLS/trigger stack; an isolated overhead benchmark cannot establish a production SLA.
