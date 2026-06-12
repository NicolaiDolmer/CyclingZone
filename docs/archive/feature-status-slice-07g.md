# Feature status archive: slice 07g

[Back to live feature status](../FEATURE_STATUS.md) | [Economy overhaul master](../slices/07-economy-overhaul-MASTER.md)

## Manager finance forecast and risk tier

**Delivered:** v2.96, 2026-05-09, [issue #85](https://github.com/NicolaiDolmer/CyclingZone/issues/85).

### Implementation notes

- Added a manager-scoped finance forecast endpoint.
- Forecasts sponsor, prize income, salary, loan interest, loan fees, projected net cashflow, and a confidence range.
- Added green, yellow, and red risk tiers based on projected cashflow and debt-ceiling exposure.
- Added compact dashboard presentation and a detailed Finance page breakdown.
- Kept forecast output advisory; no automated economy action depends on it.

### Archived acceptance criteria

- Forecast output clearly distinguishes projections from guaranteed values.
- Healthy, marginal, high-debt, and near-insolvent fixtures map to expected risk tiers.
- Manager data remains team-scoped.
- UI explains major inflow and outflow components and surfaces warnings.
- Forecast uses the same sponsor rules as season processing.
