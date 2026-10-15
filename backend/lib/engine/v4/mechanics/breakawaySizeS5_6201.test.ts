// backend/lib/engine/v4/mechanics/breakawaySizeS5_6201.test.ts
// #6201 (ejer 5/10, udbrudstrappen) under s5_profiles_v1: flad typisk 3-6 (loft 8),
// kuperet og rullende 5-9 (loft 12), bjerg og hoejfjeld 6-12 (loft 16).
//
// Under official_times_v3/v4 voksede bjergudbruddet med antallet af forsoeg, saa et
// felt med mange AI-hold og et taet klassement gav udbrud paa loftet. Under S5:
//   1. et overfyldt forsoeg giver et udbrud omkring profilens plads, uanset hvor
//      mange der forsoeger (traengslen skalerer med pladsen / forsoeg);
//   2. paa bjerg og hoejfjeld taeller et farligt forsoeg med i traengslen igen.
// Alle aeldre revisioner er uroerte (oldRevisionDigests6199 + digest-testene i
// breakawaySize6201.test.ts). Tallene bag kalibreringen: balance-internals/6201/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { S5_PROFILES_TUNING } from "../tuning.ts";
import { dangerousAttemptOutsideRoom, s5BreakawaySizeProfile } from "./breakaway.ts";
import { breakawaySizeProfileOfficialV3, resolveMorningBreakFormation, type FormationRider } from "./breakawayPermission.ts";
import type { ProfileType } from "../types.ts";
import { __resetRaceEngineV4Cache, loadRaceEngineV4 } from "../../../raceEngineV4Bridge.js";
import { TOUR_BENCHMARKS, breakawaySets, profileClass, runStagesInOrder as runStagesInOrderJs } from "../../../../scripts/dev/lib/tourScorecard.mjs";

const runStagesInOrder = runStagesInOrderJs as unknown as (opts: Record<string, unknown>) => unknown;

test("#6201 S5: profilens trin bevares; kun traengslens skalering er S5's", () => {
  for (const profile of ["flat", "hilly", "rolling", "mountain", "high_mountain"] as const) {
    const base = breakawaySizeProfileOfficialV3(profile)!;
    const s5 = s5BreakawaySizeProfile(base);
    assert.equal(s5.maxSize, base.maxSize, profile);
    assert.equal(s5.room, base.room, profile);
    assert.equal(s5.successBonus, base.successBonus, profile);
    assert.equal(s5.roomCrowdWeight, S5_PROFILES_TUNING.breakawaySize.roomCrowdWeight, profile);
  }
  // Input muteres aldrig.
  const base = breakawaySizeProfileOfficialV3("mountain")!;
  const before = { ...base };
  s5BreakawaySizeProfile(base);
  assert.deepEqual(base, before);
});

test("#6201 S5: et farligt forsoeg taeller i traengslen KUN paa S5-bjerg; alt andet som official_times_v3", () => {
  const ctx = (generation: 0 | 3, s5: boolean, profile: ProfileType) => ({
    sharedGroupTime: generation === 3 ? ({ timeModelGeneration: 3 } as never) : undefined,
    ...(s5 ? { s5ProfilesV1: true as const } : {}),
    route: { profile_type: profile } as never,
  });
  const all: ProfileType[] = ["flat", "rolling", "hilly", "mountain", "high_mountain", "cobbles", "gravel", "classic"];
  for (const p of all) {
    assert.equal(dangerousAttemptOutsideRoom(ctx(0, false, p)), false, `foer v3: ${p}`);
    assert.equal(dangerousAttemptOutsideRoom(ctx(3, false, p)), true, `official_times_v3/v4: ${p}`);
    const mountain = S5_PROFILES_TUNING.breakawaySize.dangerousInRoomProfiles.includes(p);
    assert.equal(dangerousAttemptOutsideRoom(ctx(3, true, p)), !mountain, `S5: ${p}`);
  }
  assert.deepEqual([...S5_PROFILES_TUNING.breakawaySize.dangerousInRoomProfiles].sort(), ["high_mountain", "mountain"]);
});

/** n forsoeg fra n hold med jaevnt spredte succes-rul; ingen modreaktion (ingen arbejdere). */
function crowdedMorning(n: number, sizeProfile: ReturnType<typeof s5BreakawaySizeProfile>): number {
  const riders: FormationRider[] = Array.from({ length: n }, (_, i) => ({
    rider_id: `r${String(i).padStart(3, "0")}`, team_id: `T${i}`, role: "hunter", effort: "normal",
    tryBreak: undefined, strength: 0.5, spontaneousChance: 0, engine: 0.5, freshness: 1,
  }));
  const rank = new Map(riders.map((r, i) => [r.rider_id, i]));
  const formation = resolveMorningBreakFormation({
    riders, stances: new Map(), maxSize: sizeProfile.maxSize, sizeProfile,
    roll: (_stream, id) => (rank.get(id)! + 0.5) / n,
  });
  return formation.escaped.length;
}

test("#6201 S5: et overfyldt forsoeg giver et udbrud omkring pladsen, uanset hvor mange der forsoeger", () => {
  const base = breakawaySizeProfileOfficialV3("mountain")!;
  const s5 = s5BreakawaySizeProfile(base);
  const s5Sizes = [base.room + 4, base.room * 2, base.room * 3].map((n) => crowdedMorning(n, s5));
  // Samme stoerrelse (+-1 for afrunding) fra lidt overfyldt til tre gange pladsen, og aldrig over pladsen.
  assert.ok(Math.max(...s5Sizes) - Math.min(...s5Sizes) <= 1, `S5: ${s5Sizes.join(", ")}`);
  for (const s of s5Sizes) assert.ok(s >= 1 && s <= base.room, `S5: ${s} uden for 1-${base.room}`);
  // Under official_times_v3 voksede udbruddet med antallet af forsoeg; det var fejlen.
  const v3Sizes = [base.room + 4, base.room * 2, base.room * 3].map((n) => crowdedMorning(n, base));
  assert.ok(v3Sizes[2] > s5Sizes[2], `v3 ${v3Sizes.join(", ")} mod S5 ${s5Sizes.join(", ")}`);
});

test("#6201 S5 trappen: Giro-feltet med kun AI-hold - medianen pr. profil i ejerens trappe og bjergets typiske udbrud aldrig paa loftet", async () => {
  const raw = JSON.parse(readFileSync(new URL("../../../../scripts/baselines/giro-field-6088-2026-10-02.json", import.meta.url), "utf8"));
  // Som S5-motor-benchen: alle hold er AI-hold (flest forsoeg, mest traengsel), ingen ordrer fra en anden rute.
  const data = { ...raw, orders: [], teams: raw.teams.map((t: Record<string, unknown>) => ({ ...t, is_ai: true })) };
  __resetRaceEngineV4Cache();
  const v4 = await loadRaceEngineV4();
  const sizes: Record<string, number[]> = {};
  for (let seed = 1; seed <= 3; seed++) {
    runStagesInOrder({
      v4, data, revision: "s5_profiles_v1", seedTag: `s5-staircase-${seed}`,
      onStage: ({ profile, res }: { profile: { profile_type: string }; res: { v4Output: unknown } }) => {
        if (["itt", "itt_hilly", "ttt"].includes(profile.profile_type)) return;
        (sizes[profileClass(profile.profile_type)] ??= []).push(breakawaySets(res.v4Output).formed.size);
      },
    });
  }
  const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) * p)]; };
  assert.ok(sizes.mountain?.length, "Giro-feltet skal have bjergetaper");
  for (const [cls, xs] of Object.entries(sizes)) {
    const band = TOUR_BENCHMARKS.breakawaySize.byClass[cls as "flat" | "hilly" | "mountain"];
    if (!band) continue;
    const m = q(xs, 0.5);
    assert.ok(m >= band.min && m <= band.max, `${cls}: median ${m} uden for ${band.min}-${band.max}`);
  }
  // Det typiske bjergudbrud (op til tredje kvartil) ligger inden for trappen, ikke paa loftet.
  const mountainBand = TOUR_BENCHMARKS.breakawaySize.byClass.mountain;
  assert.ok(q(sizes.mountain, 0.75) <= mountainBand.max, `bjerg: tredje kvartil ${q(sizes.mountain, 0.75)} over ${mountainBand.max}`);
});
