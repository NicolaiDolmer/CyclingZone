// #6804 G3: morgenudbruddets sammensaetning (klassements- og etapefavoritter, samme hold).
// Syntetiske data (hard rule 17): kun logikken testes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { breakawayCompositionFacts } from "./tourScorecard.mjs";

const abilitiesById = new Map([
  ["gc1", { climbing: 90, time_trial: 90, sprint: 10, punch: 50 }],
  ["sp1", { climbing: 10, time_trial: 20, sprint: 95, punch: 40 }],
  ["h1", { climbing: 40, time_trial: 40, sprint: 40, punch: 40 }],
  ["h2", { climbing: 30, time_trial: 30, sprint: 30, punch: 30 }],
  ["h3", { climbing: 20, time_trial: 20, sprint: 20, punch: 20 }],
]);
const teamByRider = new Map([["gc1", "A"], ["sp1", "B"], ["h1", "C"], ["h2", "C"], ["h3", "C"]]);
const riderIds = [...abilitiesById.keys()];
const out = (ids, extra = []) => ({ timeline: { events: [{ km: 5, type: "breakaway_formed", params: { rider_ids: ids } }, ...extra] } });

test("#6804 G3: 1. etape bruger klassementsevne; spurtfinalen bruger spurt-evne; samme hold taelles", () => {
  const f = breakawayCompositionFacts({ out: out(["gc1", "h1", "h2", "h3"]), profile: { profile_type: "flat", finale_type: "bunch_sprint" }, gcBefore: [], abilitiesById, teamByRider, riderIds, topN: 1 });
  assert.deepEqual(f, { breakawayGcFav: 1, breakawayStageFav: 0, breakawayMaxSameTeam: 3, breakawayMorningRiderIds: ["gc1", "h1", "h2", "h3"], breakawayGcFavourite: null });
  const g = breakawayCompositionFacts({ out: out(["sp1"]), profile: { profile_type: "flat", finale_type: "bunch_sprint" }, gcBefore: [], abilitiesById, teamByRider, riderIds, topN: 1 });
  assert.equal(g.breakawayStageFav, 1);
});

test("#6804 G3: med et klassement taeller klassementets forreste; uden udbrud ingen maaling", () => {
  const f = breakawayCompositionFacts({ out: out(["h3"]), profile: { profile_type: "mountain", finale_type: "long_climb" }, gcBefore: [{ rider_id: "h3" }], abilitiesById, teamByRider, riderIds, topN: 1 });
  assert.equal(f.breakawayGcFav, 1, "klassementets foerer i udbruddet");
  assert.deepEqual(breakawayCompositionFacts({ out: { timeline: { events: [] } }, profile: {}, abilitiesById, teamByRider, riderIds }), { breakawayGcFav: null, breakawayStageFav: null, breakawayMaxSameTeam: null, breakawayMorningRiderIds: [], breakawayGcFavourite: null });
});

test("#7258: i et etapeloeb er klassementets favoritter den faelles fremskrivning (top 5 til G3, top 3 til S4)", () => {
  // Fremskrivningen (raekkefoelge) vinder over klassementet foer etapen.
  const projectedGc = new Set(["h2", "h3", "h1", "sp1", "gc1"]);
  const f = breakawayCompositionFacts({ out: out(["h3", "gc1"]), profile: { profile_type: "mountain", finale_type: "long_climb" }, gcBefore: [{ rider_id: "gc1" }], abilitiesById, teamByRider, riderIds, topN: 1, projectedGc });
  assert.equal(f.breakawayGcFav, 0, "top 1 i fremskrivningen er h2, ikke klassementets foerer");
  assert.equal(f.breakawayGcFavourite, 1, "h3 er blandt fremskrivningens 3 bedste");
  const none = breakawayCompositionFacts({ out: { timeline: { events: [] } }, profile: {}, abilitiesById, teamByRider, riderIds, projectedGc });
  assert.equal(none.breakawayGcFavourite, 0, "intet morgenudbrud = ingen favorit i det");
});
