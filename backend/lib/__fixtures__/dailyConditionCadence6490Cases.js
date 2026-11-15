// #6490 b2: the cadence guard in dailyTrainingEngine (read of the date's runs before a per-date
// tick) now selects only report->condition_per_date instead of the whole report. These are the
// stored report shapes the guard can meet; each case is the list of the date's rows.
// dailyConditionCadence6490Base.json holds the guard's answer per case computed with the merge-base
// line (whole report), and the test computes it with the new projection on the same rows in PG.
export const CADENCE_CASES = [
  [],
  [{ condition_per_date: true, riders: [{ rider_id: "x" }] }],
  [{ condition_per_date: true }, { condition_per_date: true, complete: true }],
  [{ condition_per_date: true }, { condition_per_date: false }],
  [{ condition_per_date: false }],
  [{ condition_per_date: "true" }],
  [{ condition_per_date: 1 }],
  [{ condition_per_date: null }],
  [{ condition_per_date: {} }],
  [{ pending: true }],
  [{}],
  [[]],
  ["text"],
  [7],
  [true],
  [{ riders: [], partial: true }],
];
