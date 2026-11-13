// #8097 — dagens etaper maa aldrig paastaa noget om den samlede stilling, naar
// data blot mangler (detailsUnavailable). Rene hjaelpere, saa node --test kan
// bevise adfaerden uden DOM-renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { secondaryLineKind, carryKnownProfiles } from "./dashboardTodayStages.js";

test("#8097 manglende data: ingen linje, hverken for etapeloeb eller endagsloeb", () => {
  assert.equal(secondaryLineKind({ isStageRace: true, detailsUnavailable: true, standing: null }), "none");
  assert.equal(secondaryLineKind({ isStageRace: false, detailsUnavailable: true, entryCount: null }), "none");
});

test("#8097 stillingen er reelt ikke afgjort: linjen vises som foer", () => {
  assert.equal(secondaryLineKind({ isStageRace: true, standing: null }), "standingPending");
});

test("#8097 oevrige tilstande er uaendrede", () => {
  assert.equal(secondaryLineKind({ isStageRace: true, enriching: true }), "skeleton");
  assert.equal(secondaryLineKind({ isStageRace: true, standing: { rank: 2, total: 9 } }), "standing");
  assert.equal(secondaryLineKind({ isStageRace: false, entryCount: 12 }), "entries");
});

test("#8097 profil-kaldet fejler ved opdatering: den kendte profil beholdes", () => {
  const known = { raceId: "r1", stageNumber: 1, profile: { climbs: [] }, profileType: "hilly" };
  const fresh = { raceId: "r1", stageNumber: 1, profile: null, profileType: null };
  const out = carryKnownProfiles([fresh], [known], true);
  assert.equal(out[0].profile, known.profile);
  assert.equal(out[0].profileType, "hilly");
});

test("#8097 profil-kaldet lykkes: nye data vinder, og uden fejl roeres intet", () => {
  const known = { raceId: "r1", stageNumber: 1, profile: { old: true }, profileType: "hilly" };
  const fresh = { raceId: "r1", stageNumber: 1, profile: { fresh: true }, profileType: "flat" };
  assert.equal(carryKnownProfiles([fresh], [known], false)[0].profile.fresh, true);
  const none = { raceId: "r1", stageNumber: 1, profile: null, profileType: null };
  assert.equal(carryKnownProfiles([none], [known], false)[0].profile, null);
});

test("#8097 ingen kendt profil: kortet er uaendret ved fejl", () => {
  const fresh = { raceId: "r2", stageNumber: 3, profile: null, profileType: null };
  assert.equal(carryKnownProfiles([fresh], [], true)[0].profile, null);
});
