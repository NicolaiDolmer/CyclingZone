// #6369 (KUN s5_profiles_v1): et nyt udbrud efter en tidlig indhentning.
// S5's trusselsmodel jager et morgenudbrud med en farlig klassementsrytter
// straks; uden et nyt udbrud koerte feltet samlet resten af en flad etape.
// Kontrakten: kun S5, hoejst ét nyt udbrud, kun tidligt paa etapen, uden det
// hentede udbruds ryttere, og deltagelses-historikken goer det til dagens udbrud.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { S5_REFORMATION_TUNING } from "./breakaway.ts";
import { deriveParticipationHistory } from "../../../raceParticipationHistory.ts";
import { loadRaceEngineV4 } from "../../../raceEngineV4Bridge.js";
import { runStagesInOrder, sortedStages, splitEntrants } from "../../../../scripts/dev/lib/tourScorecard.mjs";

test("#6369: S5_REFORMATION_TUNING er frosset og afgraenset", () => {
  assert.ok(Object.isFrozen(S5_REFORMATION_TUNING));
  assert.equal(S5_REFORMATION_TUNING.maxReformations, 1);
  assert.ok(S5_REFORMATION_TUNING.maxStageFraction > 0 && S5_REFORMATION_TUNING.maxStageFraction < 1);
  assert.ok(S5_REFORMATION_TUNING.afterCatchKm > 0);
});

test("#6369: historikken goer et nyt udbrud (reformation) til dagens udbrud; det hentede beholder sit udfald", () => {
  const events = [
    { km: 0, type: "stage_start", params: {} },
    { km: 12, type: "breakaway_formed", params: { group_id: "breakaway-0", rider_ids: ["a1", "a2"], drops_reported: true } },
    { km: 18, type: "breakaway_caught", params: { group_id: "breakaway-0", rider_ids: ["a1", "a2"], chase_group_id: "peloton-0", chase_group_kind: "peloton" } },
    { km: 18, type: "group_merged", params: { group_id: "breakaway-0", into_group_id: "peloton-0", rider_ids: ["a1", "a2"] } },
    { km: 23, type: "breakaway_formed", params: { group_id: "breakaway-1000", rider_ids: ["b1", "b2"], reformation: true } },
    { km: 150, type: "breakaway_survived", params: { group_id: "breakaway-1000", rider_ids: ["b1", "b2"] } },
    { km: 150, type: "finish", params: {} },
  ];
  const h = deriveParticipationHistory(events, ["a1", "a2", "b1", "b2", "p1"]);
  assert.deepEqual([...h.morningRiderIds].sort(), ["a1", "a2", "b1", "b2"]);
  assert.equal(h.riders.get("a1")?.caught, true);
  assert.equal(h.riders.get("b1")?.survived, true);
  assert.equal(h.riders.get("b1")?.caught, false);
  // Et andet udbrud UDEN maerket (aeldre motorer) er stadig ikke dagens udbrud.
  const old = deriveParticipationHistory(events.map((e) => (e.params?.reformation ? { ...e, params: { ...e.params, reformation: undefined } } : e)), ["a1", "a2", "b1", "b2", "p1"]);
  assert.deepEqual([...old.morningRiderIds].sort(), ["a1", "a2"]);
});

test("#6369: paa Giro-feltet faar S5 et nyt udbrud efter den tidlige indhentning; official_times_v5 er uroert", async () => {
  const data = JSON.parse(readFileSync(new URL("../../../../scripts/baselines/giro-field-6088-2026-10-02.json", import.meta.url), "utf8"));
  const stages = sortedStages(data).filter((s: { stage_number: number }) => s.stage_number <= 2);
  const { entrants } = splitEntrants(data);
  const v4 = await loadRaceEngineV4();
  const formedOn = (revision: string) => {
    let formed: Array<{ km: number; params: Record<string, unknown> }> = [];
    let distance = 0;
    runStagesInOrder({
      v4, data, revision, seedTag: "gate1", stages, entrants,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tourScorecard.mjs er utypet (som i resultChain6285)
      onStage: ({ profile, res }: any) => {
        if (profile.stage_number !== 2) return;
        distance = profile.distance_km;
        formed = (res.v4Output.timeline?.events ?? []).filter((e: { type: string }) => e.type === "breakaway_formed");
      },
    } as Parameters<typeof runStagesInOrder>[0]);
    return { formed, distance };
  };
  const v5 = formedOn("official_times_v5");
  assert.equal(v5.formed.some((e) => e.params.reformation === true), false, "official_times_v5 udsender aldrig et nyt udbrud");
  const s5 = formedOn("s5_profiles_v1");
  const reform = s5.formed.filter((e) => e.params.reformation === true);
  assert.equal(reform.length, 1, "hoejst ét nyt udbrud");
  assert.ok(reform[0].km <= s5.distance * S5_REFORMATION_TUNING.maxStageFraction + S5_REFORMATION_TUNING.afterCatchKm, "kun tidligt paa etapen");
  const first = new Set(s5.formed[0].params.rider_ids as string[]);
  assert.equal((reform[0].params.rider_ids as string[]).some((id) => first.has(id)), false, "uden det hentede udbruds ryttere");
});
