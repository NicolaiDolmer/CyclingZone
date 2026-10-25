// #7160: maalefunktionen (udbrudssejre paa bjerg pr. loebsgruppe x afslutning). Syntetiske
// raekker, ingen balance-tal (hard rule 17): baandene i testen er vilkaarlige.
import test from "node:test";
import assert from "node:assert/strict";
import {
  measureMountainBreakawayWins,
  mountain7160Finish,
  mountain7160RaceGroup,
  mountain7160Verdict,
  type Mountain7160RaceResult,
} from "./breakawayInterest7160Measure.ts";
import { raceGroupOf } from "../../../../scripts/dev/lib/breakawayIntent.mjs";

const row = (profile_type: string, finale_type: string | null, breakawayWon: boolean | null) => ({ profile_type, finale_type, breakawayWon });
const race = (stages: number, rev: string, seeds: ReturnType<typeof row>[][]): Mountain7160RaceResult => ({ stages, runs: { [rev]: { perSeed: seeds.map((rows) => ({ rows })) } } });

test("#7160 maaling: loebsgruppen er testportens (endagsloeb taelles ikke)", () => {
  for (const n of [1, 2, 5, 14, 15, 21]) {
    const g = raceGroupOf(n);
    assert.equal(mountain7160RaceGroup(n), g === "one_day" ? null : g, `${n} etaper`);
  }
  assert.equal(mountain7160RaceGroup(undefined), null);
});

test("#7160 maaling: kun bjergprofilerne; topankomst = long_climb", () => {
  assert.equal(mountain7160Finish(row("mountain", "long_climb", true)), "summit");
  assert.equal(mountain7160Finish(row("high_mountain", "long_climb", true)), "summit");
  assert.equal(mountain7160Finish(row("mountain", "descent", false)), "non_summit");
  assert.equal(mountain7160Finish(row("high_mountain", null, false)), "non_summit");
  for (const p of ["hilly", "flat", "medium_mountain", "itt"]) assert.equal(mountain7160Finish(row(p, "long_climb", true)), null, p);
});

test("#7160 maaling: taeller pr. (etape, seed), pr. gruppe og afslutning, kun den valgte revision", () => {
  const rev = "s5_profiles_v3";
  const results = [
    race(21, rev, [
      [row("mountain", "long_climb", true), row("mountain", "long_climb", false), row("high_mountain", "descent", true), row("flat", "flat_sprint", true)],
      [row("mountain", "long_climb", false), row("high_mountain", "descent", false), row("itt", "solo_tt", null)],
    ]),
    race(7, rev, [[row("mountain", "descent", true), row("mountain", "long_climb", true)]]),
    race(1, rev, [[row("mountain", "long_climb", true)]]), // endagsloeb: ikke med
    race(7, "andet", [[row("mountain", "long_climb", true)]]), // anden revision: ikke med
    { stages: 7 }, // uden koersel
  ];
  const m = measureMountainBreakawayWins(results, rev);
  assert.deepEqual([m.gt.summit.n, m.gt.summit.breakawayWins], [3, 1]);
  assert.deepEqual([m.gt.non_summit.n, m.gt.non_summit.breakawayWins], [2, 1]);
  assert.deepEqual([m.gt.total.n, m.gt.total.breakawayWins], [5, 2]);
  assert.equal(m.gt.total.breakawayWinShare, 2 / 5);
  assert.deepEqual([m.stage_race.summit.n, m.stage_race.non_summit.n, m.stage_race.total.breakawayWins], [1, 1, 2]);
  assert.equal(m.gt.total.verdict, "-", "intet baand: ingen dom");
  const empty = measureMountainBreakawayWins([], rev);
  assert.deepEqual(empty.gt.total, { n: 0, breakawayWins: 0, breakawayWinShare: null, verdict: "-" });
});

test("#7160 maaling: dommen mod det private baand (fail closed uden baand eller maaling)", () => {
  const rev = "r";
  const results = [race(21, rev, [[row("mountain", "long_climb", true), row("mountain", "long_climb", false), row("mountain", "descent", false), row("mountain", "descent", false)]])];
  const m = measureMountainBreakawayWins(results, rev, { mountainBreakawayWinShareByGroup: { gt: { summit: { min: 0.4 }, non_summit: { min: 0.1, max: 0.9 }, total: { max: 0.2 } } } });
  assert.equal(m.gt.summit.verdict, "PASS");
  assert.equal(m.gt.non_summit.verdict, "FAIL");
  assert.equal(m.gt.total.verdict, "FAIL");
  assert.equal(m.stage_race.total.verdict, "-");
  assert.equal(mountain7160Verdict(null, { min: 0 }), "-");
  assert.equal(mountain7160Verdict(0.5, {}), "-");
  assert.equal(mountain7160Verdict(0.5, undefined), "-");
});
