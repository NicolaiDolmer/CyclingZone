import { test } from "node:test";
import assert from "node:assert/strict";
import {
  profileGroup, bucketGroup, groupColor, stripSegments, decidedIn, raceDateRange,
  isGrandTour, myRaceStatus, teamFit, selectionDayOrdinal, selectionHref, PEEK_GROUPS,
} from "./racePeek.js";

test("#6514 profileGroup: tidskørsler samles, klassiker er kuperet, ukendt er fladt", () => {
  assert.equal(profileGroup("itt"), "itt");
  assert.equal(profileGroup("itt_hilly"), "itt");
  assert.equal(profileGroup("classic"), "hilly");
  assert.equal(profileGroup("medium_mountain"), "medium_mountain");
  assert.equal(profileGroup("nope"), "flat");
  assert.equal(profileGroup(undefined), "flat");
});

test("#6514 bucketGroup: kalenderens buckets peger på de samme grupper", () => {
  assert.equal(bucketGroup("sprint"), "flat");
  assert.equal(bucketGroup("mountain"), "mountain");
  assert.equal(bucketGroup("itt"), "itt");
  assert.equal(bucketGroup("weird"), "flat");
});

test("#6514 groupColor: kun chart-tokens, aldrig rå hex eller guld", () => {
  for (const g of PEEK_GROUPS) {
    assert.match(groupColor(g), /^rgb\(var\(--cz-chart-\d\)\)$/, g);
  }
});

test("#6514 stripSegments: sorteret på etapenummer, én blok pr. etape", () => {
  const segs = stripSegments([
    { stage_number: 3, profile_type: "itt" },
    { stage_number: 1, profile_type: "flat" },
    { stage_number: 2, profile_type: "high_mountain" },
  ]);
  assert.deepEqual(segs.map((s) => s.stage), [1, 2, 3]);
  assert.deepEqual(segs.map((s) => s.group), ["flat", "high_mountain", "itt"]);
});

test("#6514 decidedIn: hårdeste afgørende grupper først, med antal (ejerens eksempel)", () => {
  const groups = ["flat", "high_mountain", "itt", "high_mountain", "flat", "high_mountain", "itt", "high_mountain", "hilly"];
  assert.deepEqual(decidedIn(groups), [{ group: "high_mountain", count: 4 }, { group: "itt", count: 2 }]);
});

test("#6514 decidedIn: uden bjerg/tidskørsel/underlag vinder det mest udbredte terræn", () => {
  assert.deepEqual(decidedIn(["flat", "flat", "hilly"]), [{ group: "flat", count: 2 }]);
  assert.deepEqual(decidedIn(["rolling", "hilly"]), [{ group: "hilly", count: 1 }]);
  assert.deepEqual(decidedIn([]), []);
});

test("#6514 decidedIn: brosten afgør et endagsløb", () => {
  assert.deepEqual(decidedIn(["cobbles"]), [{ group: "cobbles", count: 1 }]);
});

test("#6514 raceDateRange: etapeplanen først, ellers entry.date", () => {
  assert.deepEqual(raceDateRange({ stageSchedule: [{ date: "2026-10-20" }, { date: "2026-10-18" }] }), { start: "2026-10-18", end: "2026-10-20" });
  assert.deepEqual(raceDateRange({ date: "2026-10-05" }), { start: "2026-10-05", end: "2026-10-05" });
  assert.equal(raceDateRange({}), null);
});

test("#6514 isGrandTour: kun de to GT-klasser", () => {
  assert.equal(isGrandTour("TourFrance"), true);
  assert.equal(isGrandTour("GiroVuelta"), true);
  assert.equal(isGrandTour("Monuments"), false);
});

const TODAY = "2026-10-15";
const gt = { id: "gt", isMine: true, entered: true, raceClass: "GiroVuelta", stageSchedule: [{ date: "2026-10-16" }, { date: "2026-10-22" }] };

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

test("#6514 myRaceStatus: en GT holdet ikke har udtaget til binder ingenting", () => {
  const openGt = { ...gt, entered: false };
  const clash = { id: "b", isMine: true, entered: false, date: "2026-10-18" };
  assert.equal(myRaceStatus(clash, [openGt, clash], TODAY), "missing");
});

const ab = (over) => ({ climbing: 50, time_trial: 50, sprint: 50, ...over });

test("#6514 teamFit: gennemsnit af de N bedste mod løbets demand, bedste bud er nr. 1", () => {
  const riders = [
    { id: "r1", name: "A", abilities: ab({ climbing: 99 }) },
    { id: "r2", name: "B", abilities: ab({ climbing: 70 }) },
    { id: "r3", name: "C", abilities: ab({ climbing: 40 }) },
  ];
  const fit = teamFit({ demandVector: { climbing: 1 }, riders, size: 2 });
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
  assert.equal(fit.best.id, "r4");
  assert.equal(fit.counted, 1);
});

test("#6514 teamFit: ingen demand eller ingen ryttere giver null (intet opdigtet tal)", () => {
  assert.equal(teamFit({ demandVector: null, riders: [{ id: "x", abilities: ab({}) }] }), null);
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
