// #8189 (kontakten hilly_finish_8189, SLUKKET): flad spurt paa kuperet/boelget efter dagens haardhed.
// Slukket = bit-identisk med en FROSSEN fixture skrevet af merge-base-koden (#7587), ikke af den
// nye kodes egen off-gren. Taendt flytter kun kuperede/boelgede flade spurter.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GOLDEN_8189_REVISIONS, golden8189Digests } from "./testUtils/hillyFinish8189Golden.ts";
import {
  hillyFinish8189Applies,
  hillyFinish8189ChaseScale,
  hillyFinish8189Demand,
  hillyFinish8189Hardness,
  hillyFinish8189LateAttackChance,
  hillyFinish8189LetGoScale,
  hillyFinish8189On,
} from "./mechanics/hillyFinish8189.ts";
import { lateAttackChance } from "./mechanics/lateAttack.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import type { RouteV2, Segment } from "./types.ts";

const fixture = JSON.parse(readFileSync(new URL("./test-data/hillyFinish8189Off.json", import.meta.url), "utf8")) as {
  merge_base: string;
  digests: Record<string, Record<string, string>>;
};

const APPLIES = /^(hilly|rolling)#\d+\/flat_sprint@/;

test("#8189: fixturen er fra merge-base og daekker begge revisioner og S5-spurtvarianterne", () => {
  assert.match(fixture.merge_base, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(fixture.digests), [...GOLDEN_8189_REVISIONS]);
  for (const revision of GOLDEN_8189_REVISIONS) {
    const keys = Object.keys(fixture.digests[revision]);
    assert.ok(keys.length >= 40, `${revision}: hele saettet`);
    assert.ok(keys.some((k) => /^hilly#\d+\/flat_sprint@/.test(k)), `${revision}: kuperet flad spurt er med`);
    assert.ok(keys.some((k) => /^rolling#\d+\/flat_sprint@/.test(k)), `${revision}: boelget flad spurt er med`);
  }
});

test("#8189: slukket (udeladt eller null) = bit-identisk med merge-base", () => {
  assert.deepEqual(golden8189Digests(), fixture.digests);
  assert.deepEqual(golden8189Digests({ hilly_finish_8189: null }), fixture.digests);
});

test("#8189: taendt under s5_profiles_v3 flytter kun kuperede/boelgede flade spurter; v2 er uroert", () => {
  const on = golden8189Digests({ hilly_finish_8189: true });
  assert.deepEqual(on.s5_profiles_v2, fixture.digests.s5_profiles_v2, "aeldre revision: kontakten virker ikke");
  const v3 = on.s5_profiles_v3;
  let moved = 0;
  for (const [key, digest] of Object.entries(fixture.digests.s5_profiles_v3)) {
    if (APPLIES.test(key)) {
      if (v3[key] !== digest) moved++;
    } else {
      assert.equal(v3[key], digest, `${key}: uden for kontaktens etaper`);
    }
  }
  assert.ok(moved > 0, "kontakten flytter mindst én kuperet/boelget flad spurt");
  assert.deepEqual(golden8189Digests({ hilly_finish_8189: true }).s5_profiles_v3, v3, "deterministisk");
});

test("#8189: kontakten kraever s5_profiles_v3 og et eksplicit true", () => {
  assert.equal(hillyFinish8189On({ rules_revision: "s5_profiles_v3", hilly_finish_8189: true }), true);
  assert.equal(hillyFinish8189On({ rules_revision: "s5_profiles_v3" }), false);
  assert.equal(hillyFinish8189On({ rules_revision: "s5_profiles_v3", hilly_finish_8189: null }), false);
  assert.equal(hillyFinish8189On({ rules_revision: "s5_profiles_v2", hilly_finish_8189: true }), false);
  assert.equal(hillyFinish8189On({ rules_revision: null, hilly_finish_8189: true }), false);
});

function climb(fromKm: number, toKm: number, category: "4" | "3" | "2" | "1" | "HC"): Segment {
  return { kind: "climb", from_km: fromKm, to_km: toKm, category, avg_gradient: 6, top_elevation_m: 800 };
}
function flat(fromKm: number, toKm: number): Segment {
  return { kind: "flat", from_km: fromKm, to_km: toKm } as Segment;
}
function route(segments: Segment[], over: Partial<RouteV2> = {}): RouteV2 {
  return { distance_km: 180, profile_type: "hilly", finale_type: "flat_sprint", segments, weather: { kind: "sun", wind_exposure: 0 }, waypoints: [], ...over };
}
const easy = route([flat(0, 60), climb(60, 65, "4"), flat(65, 180)]);
const hard = route([flat(0, 60), climb(60, 65, "4"), flat(65, 100), climb(100, 108, "3"), flat(108, 140), climb(140, 150, "2"), flat(150, 180)]);

test("#8189: haardheden er 0-1 og monoton (flere, haardere og senere stigninger goer aldrig dagen lettere)", () => {
  const h0 = hillyFinish8189Hardness(route([flat(0, 180)]));
  const h1 = hillyFinish8189Hardness(easy);
  const h2 = hillyFinish8189Hardness(hard);
  assert.equal(h0, 0);
  assert.ok(h1 >= 0 && h1 <= 1 && h2 >= 0 && h2 <= 1);
  assert.ok(h2 > h1, "flere og haardere stigninger");
  const harder = route([flat(0, 60), climb(60, 65, "4"), flat(65, 100), climb(100, 108, "3"), flat(108, 140), climb(140, 150, "1"), flat(150, 180)]);
  assert.ok(hillyFinish8189Hardness(harder) >= h2, "haardere kategori");
  const later = route([flat(0, 60), climb(60, 65, "4"), flat(65, 100), climb(100, 108, "3"), flat(108, 160), climb(160, 170, "2"), flat(170, 180)]);
  assert.ok(hillyFinish8189Hardness(later) >= h2, "taettere paa maal");
});

test("#8189: slukket eller uden for kuperet/boelget flad spurt giver de neutrale vaerdier", () => {
  const base = RACE_V4_TUNING.finale.demandVectorByFinaleType.flat_sprint;
  for (const on of [false, undefined]) {
    assert.equal(hillyFinish8189ChaseScale(on, hard), 1);
    assert.equal(hillyFinish8189LetGoScale(on, hard), 1);
    assert.equal(hillyFinish8189LateAttackChance(on, hard), undefined);
    assert.equal(hillyFinish8189Demand(on, hard, base), null);
  }
  for (const other of [route(hard.segments, { profile_type: "flat" }), route(hard.segments, { finale_type: "uphill_sprint" }), route(hard.segments, { profile_type: "mountain" })]) {
    assert.equal(hillyFinish8189Applies(other), false);
    assert.equal(hillyFinish8189ChaseScale(true, other), 1);
    assert.equal(hillyFinish8189LetGoScale(true, other), 1);
    assert.equal(hillyFinish8189LateAttackChance(true, other), undefined);
    assert.equal(hillyFinish8189Demand(true, other, base), null);
  }
  // Det sene angreb: slukket = lateAttack.ts' egen regel (flad spurt er udelukket).
  assert.equal(lateAttackChance(hard), 0);
  assert.equal(lateAttackChance(hard, false), 0);
});

test("#8189: taendt paa kuperet: mindre jagt, hoejere lad-gaa-loft og et sent angreb jo haardere dagen", () => {
  assert.ok(hillyFinish8189ChaseScale(true, hard) < hillyFinish8189ChaseScale(true, easy));
  assert.ok(hillyFinish8189ChaseScale(true, hard) >= 0);
  assert.ok(hillyFinish8189LetGoScale(true, hard) > hillyFinish8189LetGoScale(true, easy));
  const chance = hillyFinish8189LateAttackChance(true, hard);
  assert.ok(chance !== undefined && chance > 0 && chance <= 1);
  assert.equal(lateAttackChance(hard, true), chance);
  // Boelget: jagt-leddene gaelder ikke (P2-kontrollen ejer forspringet), kun placerings-kravet.
  const rolling = route(hard.segments, { profile_type: "rolling" });
  assert.equal(hillyFinish8189ChaseScale(true, rolling), 1);
  assert.equal(hillyFinish8189LetGoScale(true, rolling), 1);
  assert.equal(hillyFinish8189LateAttackChance(true, rolling), undefined);
});

test("#8189: reduceret spurt flytter sprint-vaegt til udholdenhed og punch, summen og fortegnene bevares", () => {
  const base = RACE_V4_TUNING.finale.demandVectorByFinaleType.flat_sprint!;
  const sum = (v: Record<string, number | undefined>) => Object.values(v).reduce<number>((s, x) => s + (x ?? 0), 0);
  const d = hillyFinish8189Demand(true, hard, base)!;
  assert.ok(d, "haard dag: kravet aendres");
  assert.ok(Math.abs(sum(d) - sum(base)) < 1e-12, "samme samlede vaegt");
  assert.ok((d.sprint ?? 0) < (base.sprint ?? 0));
  assert.ok((d.durability ?? 0) > 0 && (d.punch ?? 0) > 0);
  for (const w of Object.values(d)) assert.ok((w ?? 0) >= 0, "ingen negative vaegte");
  const e = hillyFinish8189Demand(true, easy, base);
  assert.ok(!e || (e.sprint ?? 0) >= (d.sprint ?? 0), "en let dag flytter hoejst lige saa meget");
  assert.equal(hillyFinish8189Demand(true, route([flat(0, 180)]), base), null, "ingen stigninger: ren spurt");
});
