# 6215: historical prize comparison, read-only 5 October 2026

The cohort uses S3 `season_standings.division`, joined to S3 prize-type
`finance_transactions` grouped by team. All standing teams are included,
including teams with no recorded prize payout. No player identifiers are saved.
This is a retrospective comparison, not approval of forecast calibration.

| S3 division | Cohort teams | Median paid CZ$ | Upper quartile paid CZ$ |
|---|---:|---:|---:|
| D1 | 25 | 423075 | 962400 |
| D2 | 48 | 123675 | 422569 |
| D3 | 100 | 27938 | 92906 |
| D4 | 222 | 10463 | 22950 |

The API's comparison sample instead sums current riders' rolling prize-earnings
estimates over a bounded set of current division teams. It is neither this S3
cohort nor a complete historical payout distribution. The first version of the
PR description overstated what that comparison proved. It cannot prove the
forecast range is a calibrated quality target. Strong-club interval design
(review point 7) remains an owner decision; no further interval change is made.

Refs #5916 #5940. Contract: ECONOMY_RULES.md / SPONSOR_RULES.md.
