// backend/lib/calendarSeasonWindow.test.js
// #4270: laaser §2's saesonvindue — "saesonen slutter altid en soendag" (ejer-laast 23/8,
// #4131) og "antal loebsdatoer = slutdato − startdato + 1".
//
// Hvorfor testen findes: S3's 31 loebsdatoer er blevet laest som en KONSTANT flere gange
// (docs/CALENDAR_RULES.md §1b beskriver tre indbyrdes uenige kvote-tal af praecis den
// grund). 31 er dét de to regler gav for en FREDAGS-start. Starter S4 paa en MANDAG, kan
// 31 slet ikke lade sig goere — og en kalender bygget paa det tal ville slutte paa en
// onsdag. Testen goer den fejl umulig at lave i stilhed.

import test from "node:test";
import assert from "node:assert/strict";

import { resolveSeasonWindow, sundayEndCandidates, REFERENCE_SEASON_RACE_DAYS } from "./calendarStartDate.js";

test("§2: S3's egen ramme går op — fredag 28/8 + 31 løbsdatoer slutter søndag 27/9", () => {
  const w = resolveSeasonWindow({ firstRaceDay: "2026-08-28", raceDays: 31 });
  assert.equal(w.lastRaceDay, "2026-09-27");
  assert.equal(w.raceDays, 31);
});

test("§2: en mandags-start kan KUN have længder der er hele uger", () => {
  const c = sundayEndCandidates("2026-09-28", { minRaceDays: 21, maxRaceDays: 42 });
  assert.deepEqual(c.map((x) => x.raceDays), [21, 28, 35, 42]);
  assert.equal(c.find((x) => x.raceDays === 28).lastRaceDay, "2026-10-25");
  assert.equal(c.find((x) => x.raceDays === 35).lastRaceDay, "2026-11-01");
});

test("§2: 31 dage er UMULIGT fra mandag 28/9 — reglen siger fra i stedet for at afrunde", () => {
  assert.throws(
    () => resolveSeasonWindow({ firstRaceDay: "2026-09-28", raceDays: REFERENCE_SEASON_RACE_DAYS }),
    /ikke en søndag/,
  );
});

test("§2: uden et eksplicit valg foreslås den lovlige længde tættest på S3's 31", () => {
  const w = resolveSeasonWindow({ firstRaceDay: "2026-09-28" });
  assert.equal(w.derived, true, "forslaget skal være mærket som udledt, ikke som et valg");
  assert.equal(w.raceDays, 28, "|28-31| = 3 mod |35-31| = 4");
  assert.equal(w.lastRaceDay, "2026-10-25");
});

test("§2: en eksplicit slutdato bestemmer længden — og skal selv være en søndag", () => {
  const w = resolveSeasonWindow({ firstRaceDay: "2026-09-28", lastRaceDay: "2026-11-01" });
  assert.equal(w.raceDays, 35);
  assert.equal(w.derived, false);

  assert.throws(
    () => resolveSeasonWindow({ firstRaceDay: "2026-09-28", lastRaceDay: "2026-10-31" }),
    /ikke en søndag/,
  );
});

test("§2: en slutdato før startdatoen er en fejl, ikke et negativt vindue", () => {
  assert.throws(
    () => resolveSeasonWindow({ firstRaceDay: "2026-09-28", lastRaceDay: "2026-09-20" }),
    /ligger FØR/,
  );
});

test("§2: vinduet regnes over et månedsskifte uden at drifte", () => {
  const w = resolveSeasonWindow({ firstRaceDay: "2026-09-28", raceDays: 35 });
  assert.equal(w.lastRaceDay, "2026-11-01");
});
