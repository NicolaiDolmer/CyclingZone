# #6971: Sparse progress snapshots were read as missing evidence

- Root cause: the engine stores sparse ability-progress maps and starts an absent
  ability at zero. The daily receipt required an explicit numeric key, so the first
  recorded contribution could be unknown while later contributions were visible.
- Fix: use the engine's sparse-map semantics for both settled daily contributions
  and the pending trained-now projection. Missing snapshots and invalid explicit
  values remain unknown. No engine, stored data, migration or player copy changes.
- Regression: new tests failed with null for documented first-time fractional and
  whole-point progress, then passed with the shared snapshot reader. Existing
  legacy, quarantine and incomplete-date coverage remains in place.
- Learning: distinguish a missing field inside a valid stored snapshot from a
  missing snapshot. Test first-time ability development, not only populated maps.
- The historical wording and black-page fixes already exist in #6018/#6314;
  this change fixes a remaining reproducible projection defect, not a live audit.
- NOW and patch notes are excluded by the owner's explicit mandate on 1/11.
