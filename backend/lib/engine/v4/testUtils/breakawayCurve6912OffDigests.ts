// #6912 (forspringskurven, PR #7586): de frosne fingeraftryk i test-data/breakawayCurve6912OffDigests.json.
// Kontakten slukket skal vaere bit-identisk for alle revisioner. Revisionerne og formerne her
// daekkes ikke af de andre frosne filer (oldRevisionDigests6199, s5UntouchedDigests6363,
// flatChase6912Digests): official_times_v5's komplette output og s5_profiles_v1/v2 som
// endagsloeb og som etapeloeb paa brosten/klassiker. Skrevet fra koden FOER kurven
// (merge-basen); maa aldrig genberegnes. s5_profiles_v3 med kontakten slukket ligger som
// genberegnelig noegle i flatChase6912Digests.json (curveOffV3).
import { stageRaceRuns } from "./stageRaceField6804.ts";
import { digestOf, frozenDigests } from "./oldRevisionDigests6199.ts";

export const CURVE_6912_OFF_SEEDS = ["6912-curve-a", "6912-curve-b"] as const;
const OLD_S5 = ["s5_profiles_v1", "s5_profiles_v2"] as const;
const ALL_PROFILES = ["flat", "rolling", "hilly", "mountain", "high_mountain", "cobbles", "classic"] as const;

type Digests = Record<string, string>;
const runDigests = (revision: string, profiles: readonly string[], gc?: Parameters<typeof stageRaceRuns>[3]): Digests =>
  Object.fromEntries(stageRaceRuns(revision, profiles, CURVE_6912_OFF_SEEDS, gc).map((r) => [r.key, digestOf(r.output)]));

export const CURVE_6912_OFF_COMPUTE = Object.freeze({
  /** official_times_v5: komplet etape-output (ingen anden fil fryser det). */
  officialTimesV5: () => frozenDigests(["official_times_v5"]),
  /** s5_profiles_v1/v2 som endagsloeb, alle profiler. */
  oldOneDay: () => Object.fromEntries(OLD_S5.map((rev) => [rev, runDigests(rev, ALL_PROFILES, { status: "one_day" } as Parameters<typeof stageRaceRuns>[3])])),
  /** s5_profiles_v1/v2 som etapeloebets foerste etape paa brosten/klassiker. */
  oldStageRaceOther: () => Object.fromEntries(OLD_S5.map((rev) => [rev, runDigests(rev, ["cobbles", "classic"])])),
});

export type Curve6912OffKey = keyof typeof CURVE_6912_OFF_COMPUTE;

export function computeCurve6912Off(key: Curve6912OffKey): unknown {
  return CURVE_6912_OFF_COMPUTE[key]();
}
