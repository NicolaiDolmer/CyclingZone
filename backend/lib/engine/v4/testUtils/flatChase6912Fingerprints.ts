// #6912 / #7336: de fire fingeraftryk i test-data/flatChase6912Digests.json, regnet ét sted.
// Både flatChase6912Regression.test.ts (tjekker) og scripts/refresh-fingerprints.mjs
// (genberegner) importerer herfra, så de to aldrig kan regne forskelligt.
//
// Frosne nøgler (v1/v2) må aldrig genberegnes: flytter de sig, er det en regression.
// Kun v3-nøglerne må skrives igen, og kun når en ejer-godkendt tænding flytter motoren.
import { stageRaceRuns } from "./stageRaceField6804.ts";
import { digestOf, frozenDigests } from "./oldRevisionDigests6199.ts";

export const FLAT_CHASE_6912_SEEDS = ["6912-a", "6912-b"] as const;
export const FLAT_CHASE_6912_FROZEN_KEYS = ["oldRevisions", "oldStageRaces"] as const;
export const FLAT_CHASE_6912_RECOMPUTABLE_KEYS = ["otherTerrain", "otherOneDay"] as const;

export type FlatChase6912Key = (typeof FLAT_CHASE_6912_FROZEN_KEYS)[number] | (typeof FLAT_CHASE_6912_RECOMPUTABLE_KEYS)[number];
type Digests = Record<string, string>;

const OLD_REVISIONS = ["s5_profiles_v1", "s5_profiles_v2"] as const;
const runDigests = (revision: string, profiles: readonly string[], gc?: Parameters<typeof stageRaceRuns>[3]): Digests =>
  Object.fromEntries(stageRaceRuns(revision, profiles, FLAT_CHASE_6912_SEEDS, gc).map((r) => [r.key, digestOf(r.output)]));

/** Hver nøgle i fixturen og den funktion der regner den. */
export const FLAT_CHASE_6912_COMPUTE: Readonly<Record<FlatChase6912Key, () => unknown>> = Object.freeze({
  /** v1/v2 komplette etape-output (frosset). */
  oldRevisions: () => frozenDigests([...OLD_REVISIONS]),
  /** v1/v2 som etapeløbets første etape (frosset). */
  oldStageRaces: () => Object.fromEntries(OLD_REVISIONS.map((rev) => [rev, runDigests(rev, ["flat", "rolling", "hilly", "mountain", "high_mountain"])])),
  /** v3 bakket/bjerg som etapeløbets første etape. */
  otherTerrain: () => runDigests("s5_profiles_v3", ["hilly", "mountain", "high_mountain"]),
  /** v3 endagsløb. */
  otherOneDay: () => runDigests("s5_profiles_v3", ["hilly", "mountain", "high_mountain", "cobbles", "classic"], { status: "one_day" } as Parameters<typeof stageRaceRuns>[3]),
});

export function computeFlatChase6912(key: FlatChase6912Key): unknown {
  return FLAT_CHASE_6912_COMPUTE[key]();
}
