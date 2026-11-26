// #7645 (dalens selektion, SLUKKET): de frosne fingeraftryk i test-data/valleySelection7645OffDigests.json.
// Kontakten slukket skal vaere bit-identisk med koden foer kontakten. Skrevet fra merge-basen
// (sourceCommit i fixturen) med praecis disse funktioner; maa aldrig genberegnes med den nye kode.
// Daekker s5_profiles_v3 paa kuperet (hvor kontakten virker) og bjerg, som etapeloebets foerste
// etape og som endagsloeb. Hashes indeholder ingen balance-tal.
import { stageRaceRuns } from "./stageRaceField6804.ts";
import { digestOf } from "./oldRevisionDigests6199.ts";
import type { GcContext } from "../types.ts";

export const VALLEY_7645_OFF_SEEDS = ["7645-valley-a", "7645-valley-b"] as const;
export const VALLEY_7645_OFF_PROFILES = ["hilly", "mountain"] as const;

type Digests = Record<string, string>;
const runDigests = (gc?: GcContext): Digests =>
  Object.fromEntries(stageRaceRuns("s5_profiles_v3", VALLEY_7645_OFF_PROFILES, VALLEY_7645_OFF_SEEDS, gc).map((r) => [r.key, digestOf(r.output)]));

export const VALLEY_7645_OFF_COMPUTE = Object.freeze({
  /** s5_profiles_v3, etapeloebets foerste etape. */
  stageRace: () => runDigests(),
  /** s5_profiles_v3, endagsloeb. */
  oneDay: () => runDigests({ status: "one_day" } as GcContext),
});

export type Valley7645OffKey = keyof typeof VALLEY_7645_OFF_COMPUTE;
