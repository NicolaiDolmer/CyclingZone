import test from "node:test";
import assert from "node:assert/strict";
import {
  TIRED_FATIGUE_FROM,
  buildOverview,
  canRunToday,
  idsForFilter,
  isTired,
  primaryActionFor,
  pruneSelection,
  tourRunStepKey,
  tourRunTarget,
  visibleIdsFor,
  type OverviewDayType,
} from "./trainingOverview.ts";

const riders: Record<string, { day: OverviewDayType; racing?: boolean; fatigue: number | null }> = {
  a: { day: "training", fatigue: 12 },
  b: { day: null, fatigue: 40 },
  c: { day: "rest", fatigue: TIRED_FATIGUE_FROM + 4 },
  d: { day: "skill", racing: true, fatigue: TIRED_FATIGUE_FROM },
  e: { day: "recovery", fatigue: TIRED_FATIGUE_FROM - 1 },
  f: { day: null, racing: true, fatigue: null },
};

function overview() {
  return buildOverview({
    riderIds: Object.keys(riders),
    hasDay: (id) => riders[id].day != null,
    isRacing: (id) => Boolean(riders[id].racing),
    dayType: (id) => riders[id].day,
    fatigue: (id) => riders[id].fatigue,
  });
}

test("#5485 overblikket: mangler en dag, loeb, traening og traet taelles hver for sig", () => {
  const o = overview();
  assert.deepEqual(o.needsDay, ["b", "f"]);
  assert.deepEqual(o.racing, ["d", "f"]);
  // Loeb slaar traening: d har en skill-dag, men koerer loeb i dag.
  assert.deepEqual(o.training, ["a"]);
  assert.equal(o.resting, 1);
  assert.equal(o.recovering, 1);
});

test("#5485 traethed foelger skaderegelens graense, ikke mockuppets", () => {
  assert.equal(isTired(TIRED_FATIGUE_FROM), true);
  assert.equal(isTired(TIRED_FATIGUE_FROM - 1), false);
  assert.equal(isTired(null), false);
  assert.deepEqual(overview().tired, ["c", "d"]);
});

test("#5485 et tryk paa en celle filtrerer til netop dens ryttere, og null viser alle", () => {
  const o = overview();
  assert.equal(idsForFilter(o, null), null);
  assert.deepEqual([...(idsForFilter(o, "needsDay") ?? [])], ["b", "f"]);
});

test("#5485 A2: guld-knappen skifter med situationen og staar aldrig graa", () => {
  const base = { trainedToday: false, enabled: true, dayClose: null };
  assert.deepEqual(primaryActionFor({ ...base, needsDay: 3 }), { kind: "setDays", riders: 3 });
  assert.deepEqual(primaryActionFor({ ...base, needsDay: 0 }), { kind: "run" });
  // Dagen er koert: ingen knap, kun statuslinjen.
  assert.deepEqual(primaryActionFor({ ...base, needsDay: 2, trainedToday: true }), { kind: "none" });
  // Slukket traening: programmer kan stadig saettes, men intet koeres.
  assert.deepEqual(primaryActionFor({ ...base, needsDay: 0, enabled: false }), { kind: "none" });
});

test("#5485 turens trin 2 peger paa det tryk der KOERER dagen, aldrig paa 'Set days'", () => {
  // Guld-knappen beder om dage og koerer ikke traening: turen peger paa Run now.
  assert.equal(tourRunTarget({ kind: "setDays", riders: 15 }, true), "runNow");
  // Guld-knappen koerer dagen: turen peger paa den.
  assert.equal(tourRunTarget({ kind: "run" }, true), "primary");
  // Intet kan koere dagen lige nu (koert, slukket, venter): statuslinjen.
  assert.equal(tourRunTarget({ kind: "setDays", riders: 2 }, false), "status");
  assert.equal(tourRunTarget({ kind: "none" }, false), "status");
});

test("#5485 turens tekst: med dayClose (ingen bonus, koerer af sig selv) faar knapperne deres egen tekst", () => {
  assert.equal(tourRunStepKey("primary", false), "runToday");
  assert.equal(tourRunStepKey("runNow", false), "runNow");
  assert.equal(tourRunStepKey("primary", true), "runTodayDayClose");
  assert.equal(tourRunStepKey("runNow", true), "runNowDayClose");
  // Statuslinjen lover intet om bonus, saa den er den samme med og uden.
  assert.equal(tourRunStepKey("status", true), "runStatus");
  assert.equal(tourRunStepKey("status", false), "runStatus");
});

test("#5485 markeringen skaeres ned til filterets ryttere, ogsaa naar en rytter faar en dag", () => {
  const selected = new Set(["a", "b", "c"]);
  // Intet filter: alt bevares.
  assert.deepEqual([...pruneSelection(selected, null)], ["a", "b", "c"]);
  // A har faaet en dag og hoerer ikke laengere til "Needs a day".
  assert.deepEqual([...pruneSelection(selected, new Set(["b", "c", "x"]))], ["b", "c"]);
});

test("#5485 en rytter der lige har faaet sin dag, vises et oejeblik endnu, men er ikke med i markeringen", () => {
  assert.equal(visibleIdsFor(null, new Set(["a"])), null);
  assert.deepEqual([...(visibleIdsFor(new Set(["b"]), new Set(["a"])) ?? [])].sort(), ["a", "b"]);
});

test("#5485/#4847 dayClose-gaten gaelder guld-knappen og den sekundaere Run now", () => {
  const waiting = { open: false };
  assert.deepEqual(primaryActionFor({ needsDay: 0, trainedToday: false, enabled: true, dayClose: waiting }), { kind: "none" });
  assert.deepEqual(primaryActionFor({ needsDay: 0, trainedToday: false, enabled: true, dayClose: { open: true } }), { kind: "run" });
  assert.equal(canRunToday({ trainedToday: false, enabled: true, dayClose: waiting }), false);
  assert.equal(canRunToday({ trainedToday: false, enabled: true, dayClose: null }), true);
  assert.equal(canRunToday({ trainedToday: true, enabled: true, dayClose: null }), false);
});
