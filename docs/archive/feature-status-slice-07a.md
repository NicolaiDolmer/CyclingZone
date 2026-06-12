# Feature status archive: slice 07a

[Back to live feature status](../FEATURE_STATUS.md) | [Economy overhaul master](../slices/07-economy-overhaul-MASTER.md)

## Stale fallbacks and sponsor-default drift

**Delivered:** v2.50, 2026-05-07.

### Implementation notes

- Established shared economy constants for sponsor income, initial balance, market-value multiplier, prize rate, salary rate, interest, and division debt ceilings.
- Normalized the canonical sponsor base to 240K, matching the database default.
- Replaced stale economy fallbacks that could silently turn missing data into invalid zero or legacy values.
- Changed missing loan configuration from a permissive fallback to an explicit failure.

### Archived acceptance criteria

- One authoritative constant exists per economy concept.
- Runtime sponsor defaults agree at 240K across application and database paths.
- Economy null-state is not masked by stale `?? 0`, `?? 100`, or `?? 0.15` fallbacks.
- Economy and loan engine tests pass with a missing-config failure case.

### Historical sources

- [Economy audit, 2026-05-07](ECONOMY_AUDIT_2026-05-07.md)
- [Economy baseline simulation, 2026-04-29](ECONOMY_BASELINE_SIMULATION_2026-04-29.md)
