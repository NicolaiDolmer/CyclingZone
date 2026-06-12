# Feature status archive: slice 07c

[Back to live feature status](../FEATURE_STATUS.md) | [Economy overhaul master](../slices/07-economy-overhaul-MASTER.md)

## Atomic balance updates

**Delivered:** v2.91, 2026-05-09.

### Implementation notes

- Added the `increment_balance_with_audit` Postgres RPC.
- Refactored balance mutation paths to update team balance and insert the matching finance transaction in one database transaction.
- Routed auction, transfer, loan, prize, squad-enforcement, economy, and API balance changes through the shared helper.
- Added idempotency-key handling and before/after balance audit data.

### Archived acceptance criteria

- Concurrent balance mutations cannot overwrite one another.
- Balance update and finance-ledger insert succeed or roll back together.
- All identified balance callsites use the atomic path.
- Parallel delta tests preserve `baseline + sum(deltas)`.
- Live verification shows the audit invariant holds for generated finance rows.

### Historical source

- [Economy audit, 2026-05-07](ECONOMY_AUDIT_2026-05-07.md)
