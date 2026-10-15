import { test } from "node:test";
import assert from "node:assert/strict";
import {
  terrainKind, bucketProfileType, raceTerrain, TERRAIN_KINDS, raceDateRange,
  isGrandTour, myRaceStatus, teamFit, selectionDayOrdinal, selectionHref,
} from "./racePeek.ts";

test("#6514 terrainKind: kalenderens kategorier, ukendt er sprint", () => {
  assert.equal(terrainKind("high_mountain"), "mountain");
  assert.equal(terrainKind("medium_mountain"), "mountain");
  assert.equal(terrainKind("itt_hilly"), "itt");
  assert.equal(terrainKind("gravel"), "cobbles");
  assert.equal(terrainKind("classic"), "hilly");
  assert.equal(terrainKind("rolling"), "sprint");
  assert.equal(terrainKind("nope"), "sprint");
  assert.equal(terrainKind(undefined), "sprint");
});

test("#6514 bucketProfileType: kalender-bucket til glyffens profile_type", () => {
  assert.equal(bucketProfileType("sprint"), "flat");
  assert.equal(bucketProfileType("mountain"), "mountain");
  assert.equal(bucketProfileType("ttt"), "ttt");
  assert.equal(bucketProfileType("weird"), "flat");
});

test("#6514 raceTerrain: hver type én gang, hårdeste først, antal kun som tal (ejer 14:06/14:43)", () => {
  const types = ["flat", "high_mountain", "itt", "high_mountain", "flat", "high_mountain", "itt", "high_mountain", "hilly"];
  assert.deepEqual(raceTerrain(types), [
    { kind: "mountain", profileType: "high_mountain", count: 4 },
    { kind: "itt", profileType: "itt", count: 2 },
    { kind: "hilly", profileType: "hilly", count: 1 },
  ]);
});

test("#6514 raceTerrain: højst 3 typer, rækkefølge bjerg, enkeltstart, brosten, kuperet, sprint", () => {
  const types = ["flat", "cobbles", "hilly", "itt", "mountain"];
  assert.deepEqual(raceTerrain(types).map((x) => x.kind), ["mountain", "itt", "cobbles"]);
  assert.deepEqual(raceTerrain(types, { max: 5 }).map((x) => x.kind), ["mountain", "itt", "cobbles", "hilly", "sprint"]);
  assert.deepEqual(TERRAIN_KINDS, ["mountain", "itt", "ttt", "cobbles", "hilly", "sprint"]);
});

test("#6514 raceTerrain: glyffen er kategoriens hyppigste profile_type; ukendt tæller som fladt", () => {
  assert.deepEqual(raceTerrain(["flat", "rolling", "flat", "mystery"]), [{ kind: "sprint", profileType: "flat", count: 4 }]);
  assert.deepEqual(raceTerrain(["mountain", "high_mountain", "high_mountain"]), [{ kind: "mountain", profileType: "high_mountain", count: 3 }]);
  assert.deepEqual(raceTerrain([]), []);
});

test("#6514 raceDateRange: etapeplanen først, ellers entry.date", () => {
  assert.deepEqual(raceDateRange({ id: "x", stageSchedule: [{ stage: 2, date: "2026-10-20" }, { stage: 1, date: "2026-10-18" }] }), { start: "2026-10-18", end: "2026-10-20" });
  assert.deepEqual(raceDateRange({ id: "x", date: "2026-10-05" }), { start: "2026-10-05", end: "2026-10-05" });
  assert.equal(raceDateRange({ id: "x" }), null);
});

test("#6514 isGrandTour: kun de to GT-klasser", () => {
  assert.equal(isGrandTour("TourFrance"), true);
  assert.equal(isGrandTour("GiroVuelta"), true);
  assert.equal(isGrandTour("Monuments"), false);
});

const TODAY = "2026-10-15";
const gt = { id: "gt", isMine: true, entered: true, raceClass: "GiroVuelta", stageSchedule: [{ stage: 1, date: "2026-10-16" }, { stage: 2, date: "2026-10-22" }] };

test("#6514 myRaceStatus: andres løb og kørte løb har ingen status", () => {
  assert.equal(myRaceStatus({ id: "a", isMine: false, date: "2026-10-20" }, [], TODAY), null);
  assert.equal(myRaceStatus({ id: "a", isMine: true, entered: false, date: "2026-10-01" }, [], TODAY), null);
});

test("#6514 myRaceStatus: udtaget, bundet af GT, mangler udtagelse", () => {
  assert.equal(myRaceStatus({ id: "a", isMine: true, entered: true, date: "2026-10-20" }, [], TODAY), "selected");
  const clash = { id: "b", isMine: true, entered: false, date: "2026-10-18" };
  assert.equal(myRaceStatus(clash, [gt, clash], TODAY), "gtBound");
  const free = { id: "c", isMine: true, entered: false, date: "2026-10-25" };
  assert.equal(myRaceStatus(free, [gt, free], TODAY), "missing");
  // Dagens løb er stadig åbent for udtagelse.
  assert.equal(myRaceStatus({ id: "d", isMine: true, entered: false, date: TODAY }, [], TODAY), "missing");
});

test("#6514 myRaceStatus: afmeldt loeb har ingen status og binder ikke som Grand Tour", () => {
  assert.equal(myRaceStatus({ id: "w", isMine: true, entered: true, date: "2026-10-20", withdrawn: true }, [], TODAY), null);
  const gt = { id: "gt", isMine: true, entered: true, withdrawn: true, raceClass: "TourFrance", date: "2026-10-20" };
  assert.equal(myRaceStatus({ id: "x", isMine: true, entered: false, date: "2026-10-20" }, [gt], TODAY), "missing");
});

test("#6514 myRaceStatus: frossen udtagelse (afviklet eller i gang) har ingen status, ogsaa paa dagens loeb", () => {
  assert.equal(myRaceStatus({ id: "e", isMine: true, entered: false, date: TODAY, lineupFrozen: true }, [], TODAY), null);
  assert.equal(myRaceStatus({ id: "f", isMine: true, entered: true, date: "2026-10-20", lineupFrozen: true }, [], TODAY), null);
});

test("#6514 myRaceStatus: en GT holdet ikke har udtaget til binder ingenting", () => {
  const openGt = { ...gt, entered: false };
  const clash = { id: "b", isMine: true, entered: false, date: "2026-10-18" };
  assert.equal(myRaceStatus(clash, [openGt, clash], TODAY), "missing");
});

const ab = (over: Record<string, number>) => ({ climbing: 50, time_trial: 50, sprint: 50, ...over });

test("#6514 teamFit: gennemsnit af de N bedste mod løbets demand, bedste bud er nr. 1", () => {
  const riders = [
    { id: "r1", name: "A", abilities: ab({ climbing: 99 }) },
    { id: "r2", name: "B", abilities: ab({ climbing: 70 }) },
    { id: "r3", name: "C", abilities: ab({ climbing: 40 }) },
  ];
  const fit = teamFit({ demandVector: { climbing: 1 }, riders, size: 2 });
  assert.ok(fit);
  assert.equal(fit.best.id, "r1");
  assert.equal(fit.best.score, 100);
  assert.equal(fit.counted, 2);
  assert.equal(fit.score, Math.round((100 + Math.round((70 / 99) * 100)) / 2));
});

test("#6514 teamFit: skadede, solgte og ryttere uden evner tæller ikke", () => {
  const riders = [
    { id: "r1", name: "A", abilities: ab({ climbing: 99 }), injured: true },
    { id: "r2", name: "B", abilities: ab({ climbing: 99 }), outgoing: true },
    { id: "r3", name: "C", abilities: null },
    { id: "r4", name: "D", abilities: ab({ climbing: 60 }) },
  ];
  const fit = teamFit({ demandVector: { climbing: 1 }, riders, size: 6 });
  assert.ok(fit);
  assert.equal(fit.best.id, "r4");
  assert.equal(fit.counted, 1);
});

test("#6514 teamFit: ingen demand eller ingen ryttere giver null (intet opdigtet tal)", () => {
  assert.equal(teamFit({ demandVector: null, riders: [{ id: "x", name: "X", abilities: ab({}) }] }), null);
  assert.equal(teamFit({ demandVector: { climbing: 1 }, riders: [] }), null);
});

test("#6514 selectionDayOrdinal: dag 1 = sæsonens tidligste dato", () => {
  const days = [{ gameDay: 3, date: "2026-10-03" }, { gameDay: 1, date: "2026-10-01" }];
  assert.equal(selectionDayOrdinal("2026-10-01", days), 1);
  assert.equal(selectionDayOrdinal("2026-10-10", days), 10);
  assert.equal(selectionDayOrdinal(null, days), null);
  assert.equal(selectionHref("2026-10-10", days), "/planning?tab=selection&day=10");
  assert.equal(selectionHref(null, days), "/planning?tab=selection");
});
