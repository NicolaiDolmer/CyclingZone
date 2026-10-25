// #6804 P2.4 (KUN s5_profiles_v3, slukket): klatre-jagten. Design:
// docs/superpowers/specs/2026-10-23-6804-v3-climb-chase-design.md. Kontrakter, ingen kalibrerede
// tal (hard rule 17): hvornaar den gaelder, at den kontrollerer og aldrig henter, hvem der jager,
// og at forspringet paa feltet holdes paa snoren i et etapeloeb med interesserede hold.
import test from "node:test";
import assert from "node:assert/strict";
import { s5V3ClimbChaseApplies, s5V3ClimbChaseClosing, s5V3ClimbChaseIntensity, s5V3ClimbChaseLeashSeconds, s5V3RealisticLeadCeilingSeconds } from "./breakawayV3_6804.ts";
import { climbChaseClimbers, climbChaseFieldBehind } from "./breakaway.ts";
import { stageRaceRuns } from "../testUtils/stageRaceField6804.ts";
import { breakawayLeadFacts } from "../../../../scripts/dev/lib/tourScorecard.mjs";
import type { Entrant, ProfileType, RaceGroup, RiderState } from "../types.ts";

test("P2.4: gaelder kun naar P2 gaelder, paa en stigning, efter lad-gaa-fasen og med jagt-km", () => {
  assert.equal(s5V3ClimbChaseApplies({ p2Lead: true, segmentKind: "climb", letGoKm: 0, chaseKm: 5 }), true);
  assert.equal(s5V3ClimbChaseApplies({ p2Lead: false, segmentKind: "climb", letGoKm: 0, chaseKm: 5 }), false, "kun hvor P2 gaelder");
  assert.equal(s5V3ClimbChaseApplies({ p2Lead: true, segmentKind: "flat", letGoKm: 0, chaseKm: 5 }), false, "kun paa stigning");
  assert.equal(s5V3ClimbChaseApplies({ p2Lead: true, segmentKind: "descent", letGoKm: 0, chaseKm: 5 }), false);
  assert.equal(s5V3ClimbChaseApplies({ p2Lead: true, segmentKind: "climb", letGoKm: 2, chaseKm: 3 }), false, "lad-gaa-fasen er ikke slut");
  assert.equal(s5V3ClimbChaseApplies({ p2Lead: true, segmentKind: "climb", letGoKm: 0, chaseKm: 0 }), false);
});

test("P2.4: snoren ligger over P2's mellemzone paa bjerg og hoejfjeld", () => {
  for (const p of ["mountain", "high_mountain"] as ProfileType[]) {
    assert.ok(s5V3ClimbChaseLeashSeconds(p) >= s5V3RealisticLeadCeilingSeconds(p, true), p);
  }
});

test("P2.4: en kontrol, aldrig en hentning og aldrig oveni den almindelige lukning", () => {
  const leash = 600;
  // Den almindelige lukning er nok: klatre-jagten goer intet.
  assert.deepEqual(s5V3ClimbChaseClosing({ grownSeconds: 700, baseClosingSeconds: 150, leashSeconds: leash }), { closing: 150, extra: 0 });
  // Under snoren: intet.
  assert.deepEqual(s5V3ClimbChaseClosing({ grownSeconds: 500, baseClosingSeconds: 0, leashSeconds: leash }), { closing: 0, extra: 0 });
  // Over snoren: ned TIL snoren, aldrig under.
  const r = s5V3ClimbChaseClosing({ grownSeconds: 900, baseClosingSeconds: 100, leashSeconds: leash });
  assert.equal(900 - r.closing, leash);
  assert.equal(r.extra, 900 - leash - 100);
});

test("P2.4: arbejdet foelger det klatre-jagten lukkede, i [0, 1], delt mellem holdene", () => {
  const base = { chaseKm: 10, closingSecondsPerKmPerUnit: 1, fullOrderForce: 1 };
  assert.equal(s5V3ClimbChaseIntensity({ ...base, extraClosingSeconds: 0, teams: 1 }), 0);
  const one = s5V3ClimbChaseIntensity({ ...base, extraClosingSeconds: 4, teams: 1 });
  const two = s5V3ClimbChaseIntensity({ ...base, extraClosingSeconds: 4, teams: 2 });
  assert.ok(one > 0 && two < one, "to hold deler prisen");
  assert.ok(s5V3ClimbChaseIntensity({ ...base, extraClosingSeconds: 1e6, teams: 1 }) <= 1);
});

const ent = (id: string, team: string, role: Entrant["role"], climbing: number): Entrant => ({ rider_id: id, team_id: team, role, effort: "normal", condition: 1, abilities: { climbing } } as unknown as Entrant);
const racing = (ids: string[]): Record<string, RiderState> => Object.fromEntries(ids.map((id) => [id, { status: "racing" } as RiderState]));

test("P2.4: holdets klatrere saetter farten; aldrig kaptajner, aldrig hold uden ryttere i gruppen", () => {
  const entrants = { c1: ent("c1", "A", "captain", 90), h1: ent("h1", "A", "helper", 70), h2: ent("h2", "A", "helper", 80), h3: ent("h3", "A", "helper", 60), x1: ent("x1", "B", "helper", 85) };
  const ids = Object.keys(entrants);
  const out = climbChaseClimbers({ teamIds: ["A", "C"], chaseGroupRiderIds: ids, entrants, riders: racing(ids) });
  assert.deepEqual([...out.keys()], ["A"], "hold C har ingen ryttere i gruppen, hold B er ikke interesseret");
  assert.deepEqual(out.get("A"), ["h2", "h1"], "de bedste klatrere, ikke kaptajnen");
  assert.equal(climbChaseClimbers({ teamIds: ["A"], chaseGroupRiderIds: ["c1"], entrants, riders: racing(ids) }).size, 0, "kun en kaptajn = ingen ryttere at jage med");
});

test("P2.4: feltet er den store gruppe bag jagtgruppen, aldrig udbruddet eller jagtgruppen selv", () => {
  const g = (id: string, kind: RaceGroup["kind"], n: number, gap: number): RaceGroup => ({ id, kind, rider_ids: Array.from({ length: n }, (_, i) => `${id}-${i}`), gap_seconds: gap, cohesion: 1 } as RaceGroup);
  const groups = [g("breakaway-0", "breakaway", 5, 0), g("solo-1", "solo", 1, 300), g("peloton-0", "peloton", 40, 900)];
  assert.equal(climbChaseFieldBehind(groups, "breakaway-0", "solo-1", 300)?.id, "peloton-0");
  assert.equal(climbChaseFieldBehind(groups, "breakaway-0", "peloton-0", 900), null, "feltet ER jagtgruppen");
});

test("P2.4 (G2): i et etapeloeb med interesserede hold holder v3 forspringet paa feltet paa snoren; ellers melder filmen hvorfor", () => {
  const runs = stageRaceRuns("s5_profiles_v3", ["rolling", "hilly", "mountain", "high_mountain"], ["a", "b", "c"]);
  let withBreak = 0;
  for (const run of runs) {
    const facts = breakawayLeadFacts(run.output);
    if (facts.breakawayMaxLead === null) continue;
    withBreak++;
    if (facts.breakawayMaxLead > s5V3ClimbChaseLeashSeconds(run.route.profile_type) + 15) {
      assert.ok(facts.breakawayUnchased, `${run.key}: ${Math.round(facts.breakawayMaxLead)} s over snoren uden en aarsag i filmen`);
    }
  }
  assert.ok(withBreak > 0, "etaperne har udbrud");
});
