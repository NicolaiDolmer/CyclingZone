# Feature status archive: slice 07h

[Back to live feature status](../FEATURE_STATUS.md) | [Economy overhaul master](../slices/07-economy-overhaul-MASTER.md)

## Season financial close-out report

**Delivered:** v2.97, [issue #86](https://github.com/NicolaiDolmer/CyclingZone/issues/86).

### Implementation notes

- Added a season-level finance report for the manager's own team, with admin access across teams.
- Summarizes net cashflow, major income and expense categories, largest transactions, sponsor development, and loan exposure.
- Reuses closed-season finance transactions rather than recalculating historical money movement.
- Links the report from the season-end experience.

### Archived acceptance criteria

- Report totals reconcile with the season's finance transactions.
- Managers can only view their own team; admins can inspect all teams.
- Repaired or adjusted seasons reflect the latest authoritative ledger state.
- Income and expense categories remain traceable to finance reason codes.
- The report is read-only and does not mutate economy state.
