# Feature status archive: slice 07f

[Back to live feature status](../FEATURE_STATUS.md) | [Economy overhaul master](../slices/07-economy-overhaul-MASTER.md)

## Variable sponsor tied to results

**Delivered:** v3.12, 2026-05-11, [issue #84](https://github.com/NicolaiDolmer/CyclingZone/issues/84).

### Implementation notes

- Added a shared sponsor engine used by season start, transition preview, and finance forecast.
- Kept season one at a fixed 240K introductory sponsor.
- From season two, calculates 200K base plus up to 150K variable income from prior-season points and division rank.
- Applies board budget modifiers and sponsor-pullout effects after the shared base calculation.
- Uses the same sponsor contract in previews and actual payouts.

### Archived acceptance criteria

- Season one remains unchanged at 240K.
- Later-season sponsor stays within the 200K to 350K range before board and pullout modifiers.
- Performance inputs produce differentiated sponsor values.
- Forecast, transition plan, and payout paths agree.
- The feature activates naturally when season-two input data exists.

### Historical source

- [Economy baseline simulation, 2026-04-29](ECONOMY_BASELINE_SIMULATION_2026-04-29.md)
