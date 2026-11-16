import test from "node:test";
import assert from "node:assert/strict";

import { summarize, run } from "./dry-run-5865-season-injury-reset.mjs";

const rows = [
  { injured_until: "2026-11-30", injury_cause: "illness" },
  { injured_until: "2026-12-02", injury_cause: "race_crash" },
  { injured_until: "2026-12-04", injury_cause: "race_crash" },
  { injured_until: "2026-12-10", injury_cause: "training_overload" },
  { injured_until: "2026-11-01", injury_cause: "race_crash" }, // udløbet: tælles ikke
];

test("summarize: buckets og pr. mode, udløbne skader ignoreres", () => {
  const s = summarize({ rows, seasonStartDate: "2026-12-02", today: "2026-11-29", capDates: 1, lightMaxDates: 2 });
  assert.equal(s.activeNow, 4);
  assert.equal(s.stillInjuredAtStart, 3);
  assert.deepEqual(s.buckets, { endsBeforeStart: 1, dates1: 1, dates2to3: 1, dates4plus: 1 });
  assert.deepEqual(s.modes.off, { cleared: 0, shortened: 0, unchanged: 4 });
  assert.deepEqual(s.modes.clear, { cleared: 4, shortened: 0, unchanged: 0 });
  assert.deepEqual(s.modes.cap, { cleared: 0, shortened: 2, unchanged: 2 });
  assert.deepEqual(s.modes.light, { cleared: 2, shortened: 0, unchanged: 2 });
});

test("run: læser kun (ingen upsert/update/insert/delete på klienten)", async () => {
  const calls = [];
  const q = {
    select() { calls.push("select"); return q; },
    gte() { return q; },
    order() { return q; },
    range() { return Promise.resolve({ data: rows, error: null }); },
  };
  const supabase = { from: () => q };
  const out = await run({ supabase, seasonStartDate: "2026-12-02", today: "2026-11-29", log: () => {} });
  assert.equal(out.activeNow, 4);
  assert.deepEqual([...new Set(calls)], ["select"]);
});
