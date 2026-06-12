# Feature status archive: slice 07b

[Back to live feature status](../FEATURE_STATUS.md) | [Economy overhaul master](../slices/07-economy-overhaul-MASTER.md)

## TOCTOU fixes and idempotency keys

**Delivered:** 2026-05-07, commit [`a90128e`](https://github.com/NicolaiDolmer/CyclingZone/commit/a90128e), [issue #80](https://github.com/NicolaiDolmer/CyclingZone/issues/80).

### Implementation notes

- Added partial unique indexes for sponsor, salary, division bonus, and loan-interest transactions per season.
- Added `finance_transactions.related_loan_id` so loan interest is uniquely attributable per loan and season.
- Added the atomic `create_loan_atomic` database RPC with transaction-level serialization around debt-ceiling checks.
- Kept emergency-loan debt-ceiling handling soft: the loan is created, while a breach is logged and surfaced to the manager.
- Made cron retries tolerate database unique violations without double-paying or double-charging.

### Archived acceptance criteria

- Sponsor, salary, and bonus are recorded once per team and season.
- Loan interest is recorded once per loan and season.
- Concurrent standard-loan creation cannot independently pass the same debt-ceiling check.
- Re-running season payout paths does not create duplicate finance rows.
- Economy invariant tests cover parallel loan creation and payout idempotency.

### Historical source

- [Economy audit, 2026-05-07](ECONOMY_AUDIT_2026-05-07.md)
