# #7875 review follow-up implementation plan

> Execute inline with test-driven-development and one independent review before push. PC1 owns the Claude marker and merge.

**Goal:** Resolve the five owner-supplied remarks on f1d88d3 and provide measured verification on the final HEAD.
**Spec:** `docs/TRANSFER_MARKET_RULES.md` §8.1 and owner mandate on #7872 (8/11).
**Architecture:** Keep market flag semantics local to M3. A confirmed missing/off value follows the legacy path; an unreadable value must stop before a market mutation. A committed bid is a success even if its optional proxy is rejected; its existing localized error becomes a warning through the shared auction formatter.
**Constraints:** No activation, production writes or merge. No new player text. Fresh main merged without rebase/force-push. Two CI failures on the same symptom park the PR. Full verification and HEAD-bound Codex review; PC1 supplies Claude review.

## Tasks

1. Add failing behavior tests for failed/rejected flag reads and unchanged market states. Replace the permissive flag read only in `marketCommitment6181.js`; move bid/proxy gate reads before writes. Verify true/off/missing and query rejection.
2. Execute the actual bid route in a VM test harness (existing repository pattern), with explicit clock and real market helpers. Reproduce manual-bid success plus rejected proxy, then return the usual success payload with an existing-error warning. Extend `auctionLogic.formatBidWarning` to use `resolveApiError`; verify localized output without adding strings.
3. Add executable route cases for bid, PATCH proxy, auction start and rider release with on/off and unreadable flags. Test actual response/state behavior, not source-text matches.
4. Confirm local PG17 version. Strengthen concurrency-test outcome checks so only the expected gate rejections are accepted; emit a measured summary for eight independent connections over ten rounds. Run with MARKET_GATE_PG_BIN set and preserve command/output in PR body.
5. Reconcile generated feature status and document the existing missing market flag registry coverage as a known hole. Update §8.1 and bug learning. Run full local verification, preflight, lint/ratchet and relevant E2E, then independent review, guarded commit/push, CI and HEAD Codex review. Address at most two failed CI runs per symptom, then park with evidence and continue #7878.

## Review focus

- No writes when flag state is unknown, including the optional proxy path.
- Confirmed off uses legacy behavior and never calls M3 RPCs.
- A bid already persisted is not reported as failed; a rejected proxy is visibly reported using existing localized text.
- Route tests exercise the registered handler and relevant money/seat errors.
- PG17 concurrency permits one valid lead and rejects the other requests specifically through the intended gate; fixture servers are stopped.

## 9/11 owner correction: atomic proxy match

Keep generic equal-price bids subject to the existing-leader rule. A separate
service-only match RPC validates the exact proxy cap and expected auction price
and leader under team/advisory and auction/row locks. Validate money and the new
seat before moving leadership; the CAS and bid insert share one transaction.
Reject stale expected state without mutation. Preserve the off path.
The triggering bid/opening bid returns its predecessor from its own locked SQL
operation; this receipt binds the match context. Keep the earlier void proxy
signature as an additive wrapper. A rejected defending proxy is excluded from
both challenger selection and effective winner-proxy selection.

The gated cascade reloads on changed state, skips a money/seat-rejected bidder
for the current run, stops on inactive/expired state, and throws unknown errors.
Do not emit success side effects for a rejected write. Add deterministic JS and
PGlite regressions, and real PG17 equal-price proxy and row-lock CAS cases.
Run focused checks, preflight, full verification and independent HEAD reviews
before handoff. PR6 stays frozen until this dependency is pushed and CI clears.

Additional verified review boundary: settle acceptance and eligible matching in
one transaction. Acquire the extra incumbent lock with try-lock only; contention
rolls back acceptance rather than waiting in reverse lock order. Catch only
known counter money/seat rejections in a subtransaction. Receipts preserve match
outcomes, reject tracking and existing notifications once. Verify concurrent
repetitions and a held incumbent lock in PG17, then rerun HEAD reviews and CI.
