// backend/lib/calendarS6PlacementRules5841.test.js
// #5841 (ejerbeslutninger 26/11): S6-kalenderens placeringsregler.
//
// Testene laaser REGLERNE, ikke den kalender kataloget tilfaeldigvis giver: hvornaar de er
// aktive (fra S6, aldrig foer), hvad gaten siger fra over, og at pakkeren holder
// monument-reglerne i S6-vinduet (27 datoer, 140 loebsdage), hvor R9 foer faldt bort.

import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarPlacementRulesForSeason, TIER_MULTI_RACE_DAY_SHARE_BAND, SQUAD_MULTI_RACE_DAY_SHARE_BAND,
  CALENDAR_PLACEMENT_RULES_FIRST_SEASON,
} from "./calendarTierCaps.js";
import { detectSeasonPlacementRuleViolations } from "./calendarPlacementGates.js";
import { enumeratePlacementSkeletons } from "./raceCalendarLanePacker.js";
import { SEASON_RACE_DAY_TARGET } from "./calendarRaceDayTargets.js";
import { SEASON_RACE_DATES, SEASON_RACE_DAYS_DEFAULT, resolveSeasonWindow } from "./calendarStartDate.js";
import { injuryEndGameDay } from "./injuryRaceDays.js";
import { runOfflineSeasonGates } from "../scripts/dev/seasonCalendarGatesOffline.mjs";

const rules6 = (tier = 1) => calendarPlacementRulesForSeason(6, tier);
const st = (pool_race_id, game_day, scheduled_at) => ({ pool_race_id, game_day, scheduled_at });
const one = (id, extra = {}) => ({ pool_race_id: id, name: id, race_type: "single", stages: 1, ...extra });
const sr = (id, stages, extra = {}) => ({ pool_race_id: id, name: id, race_type: "stage_race", stages, ...extra });
const day = (n) => `2026-11-${String(n).padStart(2, "0")}`;

test("#5841: reglerne gaelder kun fra S6 - S5, S3 og ukendt saeson er uroerte", () => {
  assert.equal(CALENDAR_PLACEMENT_RULES_FIRST_SEASON, 6);
  for (const n of [null, undefined, 3, 4, 5, "x"]) assert.equal(calendarPlacementRulesForSeason(n, 1), null);
  const r = rules6(1);
  assert.ok(r.monumentMinGapDays > 2 && r.monumentMinSpreadDays > 14, "S6 er strammere end de gamle tal");
  assert.equal(r.lastMonumentAfterGrandTours, true);
  assert.equal(r.seasonEndsWithOneDayRace, true);
  assert.equal("stageRaceEndsByGrandTourStart" in r, false, "R20 er udgaaet (ejer 26/11 aften, #8830)");
  assert.deepEqual(r.multiRaceShareBand, TIER_MULTI_RACE_DAY_SHARE_BAND[1]);
  assert.equal(calendarPlacementRulesForSeason(6, null).multiRaceShareBand, null);
});

test("#5841: overlap-baandet er et interval pr. seniorniveau; ungdom har intet overlap i S6 (#8830)", () => {
  for (const b of Object.values(TIER_MULTI_RACE_DAY_SHARE_BAND)) {
    assert.ok(b.min > 0 && b.min < b.max && b.max < 1);
  }
  assert.ok(TIER_MULTI_RACE_DAY_SHARE_BAND[3].max < TIER_MULTI_RACE_DAY_SHARE_BAND[1].min);
  for (const b of Object.values(SQUAD_MULTI_RACE_DAY_SHARE_BAND)) assert.deepEqual({ ...b }, { min: 0, max: 0 });
});

test("#5841: S6-data - 140 loebsdage paa det laaste vindue 30/11-26/12, skader rundes op", () => {
  assert.equal(SEASON_RACE_DAY_TARGET[6], 140);
  assert.equal(SEASON_RACE_DATES[6], 27);
  assert.equal(SEASON_RACE_DAYS_DEFAULT[6], 27);
  const w = resolveSeasonWindow({ firstRaceDay: "2026-11-30", seasonNumber: 6, raceDays: SEASON_RACE_DAYS_DEFAULT[6] });
  assert.equal(w.lastRaceDay, "2026-12-26");
  // En skade paa een kalenderdag bliver aldrig kortere end dagens loebsdage.
  const end = injuryEndGameDay({ gameDay: 0, days: 1, seasonNumber: 6 });
  assert.ok(end >= 140 / 27 && Number.isInteger(end));
  assert.equal(injuryEndGameDay({ gameDay: 0, days: 27, seasonNumber: 6 }), 140);
  assert.equal(injuryEndGameDay({ gameDay: 3, days: 2, seasonNumber: 5 }), 3 + 2 * 5, "S5 er uaendret");
});

test("#5841: gaten tier naar reglerne ikke er sat (kalender bygget foer S6)", () => {
  const raceRows = [one("m1", { race_class: "Monuments" }), one("m2", { race_class: "Monuments" })];
  const stageRows = [st("m1", 0, day(1)), st("m2", 1, day(1))];
  assert.deepEqual(detectSeasonPlacementRuleViolations({ tier: 1, rules: null, raceRows, stageRows }), []);
});

test("#5841: monument-afstand, -spredning, raekkefoelge og Lombardiet efter sidste GT", () => {
  const raceRows = [
    sr("gt", 21),
    one("san", { race_class: "Monuments" }), one("ron", { race_class: "Monuments" }), one("lom", { race_class: "Monuments" }),
  ];
  const stageRows = [
    st("san", 0, day(1)), st("ron", 4, day(2)), // 1 kalenderdag imellem
    ...Array.from({ length: 21 }, (_, i) => st("gt", 10 + i, day(5 + Math.floor(i / 4)))),
    st("lom", 20, day(9)), // inde i GT'en og efter den i virkeligheden
  ];
  const realOrderByPoolRace = new Map([["san", 0.2], ["ron", 0.3], ["gt", 0.5], ["lom", 0.9]]);
  const brud = detectSeasonPlacementRuleViolations({ tier: 1, rules: rules6(), raceRows, stageRows, realOrderByPoolRace });
  assert.ok(brud.some((b) => b.includes("kalenderdag(e) fra hinanden")), brud.join("\n"));
  assert.ok(brud.some((b) => b.includes("fra første til sidste monument")));
  assert.ok(brud.some((b) => b.includes("efter den sidste Grand Tour")));
  // Byttet raekkefoelge doemmes ogsaa.
  const byttet = new Map([["san", 0.3], ["ron", 0.2], ["gt", 0.5], ["lom", 0.9]]);
  assert.ok(detectSeasonPlacementRuleViolations({ tier: 1, rules: rules6(), raceRows, stageRows, realOrderByPoolRace: byttet })
    .some((b) => b.includes("virkelige rækkefølge")));
});

test("#5841/#8830: saesonen slutter med endagsloeb; et etapeloeb maa gerne overlappe en GT (R20 udgaaet)", () => {
  const raceRows = [sr("gt", 21), sr("sr", 3), one("c")];
  const gt = Array.from({ length: 21 }, (_, i) => st("gt", 5 + i, day(2 + Math.floor(i / 4))));
  const lovlig = [st("sr", 3, day(1)), st("sr", 4, day(1)), st("sr", 5, day(2)), ...gt, st("c", 26, day(8))];
  assert.deepEqual(
    detectSeasonPlacementRuleViolations({ tier: 2, rules: { ...rules6(), multiRaceShareBand: null }, raceRows, stageRows: lovlig }), [],
    "etapeloebet slutter paa GT'ens foerste loebsdag, og sidste loebsdag er et endagsloeb",
  );
  const ulovlig = [st("sr", 6, day(2)), st("sr", 7, day(2)), st("sr", 8, day(3)), ...gt, st("c", 24, day(8))];
  const brud = detectSeasonPlacementRuleViolations({ tier: 2, rules: { ...rules6(), multiRaceShareBand: null }, raceRows, stageRows: ulovlig });
  assert.equal(brud.some((b) => b.includes("GT'ens start")), false, "et etapeloeb der koerer ind i GT'en er lovligt");
  assert.ok(brud.some((b) => b.includes("sæsonen skal slutte med endagsløb")), brud.join("\n"));
});

test("#5841: overlap-baandet doemmer baade gulv og loft", () => {
  const rules = { ...rules6(3), multiRaceShareBand: { min: 0.35, max: 0.45 } };
  const raceRows = [one("a"), one("b"), one("c"), one("d")];
  const alleSammen = [st("a", 0, day(1)), st("b", 0, day(1)), st("c", 1, day(1)), st("d", 1, day(1))];
  assert.ok(detectSeasonPlacementRuleViolations({ tier: 3, rules, raceRows, stageRows: alleSammen }).some((b) => b.includes("skal ligge i 35-45 %")));
  const ingen = [st("a", 0, day(1)), st("b", 1, day(1)), st("c", 2, day(1)), st("d", 3, day(1))];
  assert.ok(detectSeasonPlacementRuleViolations({ tier: 3, rules, raceRows, stageRows: ingen }).some((b) => b.includes("skal ligge i 35-45 %")));
});

test("#5841 R22: skeletterne holder afstand, spredning og Lombardiet efter sidste GT", () => {
  const gts = [{ id: "g1", stages: 17, seasonFraction: 0.4 }, { id: "g2", stages: 18, seasonFraction: 0.6 }, { id: "g3", stages: 17, seasonFraction: 0.75 }];
  const mons = [0.2, 0.28, 0.3, 0.35, 0.95].map((f, i) => ({ id: `m${i}`, stages: 1, seasonFraction: f }));
  const sk = enumeratePlacementSkeletons({
    gtsByPhase: gts, monumentsByPhase: mons, days: 27, gtEarliestStartDate: 2,
    minGapDays: 3, minSpreadDays: 20, monumentsAfterGts: 1, endWithOneDay: true, limit: 50,
  });
  assert.ok(sk.length > 0);
  for (const s of sk) {
    const m = s.monumentPins;
    for (let i = 1; i < m.length; i++) assert.ok(m[i] - m[i - 1] >= 3);
    assert.ok(m[m.length - 1] - m[0] >= 20);
    assert.ok(s.gtStartPins[0] >= 2);
    assert.ok(m[m.length - 1] > s.gtStartPins[2] + 4, "Lombardiet efter den sidste GT");
  }
  for (let i = 1; i < sk.length; i++) assert.ok(sk[i - 1].score <= sk[i].score, "mest virkelighedsnaere foerst");
});

test("#5841 mod prod-kataloget: S6 (27 datoer, 140) holder monument-reglerne og saesonens afslutning", { timeout: 600000 }, async () => {
  const r = await runOfflineSeasonGates({ seasonNumber: 6, firstDay: "2026-11-30", lastDay: "2026-12-26", raceDayTarget: 140, baseSeed: 1 });
  assert.deepEqual(Object.values(r.axisByTier), [140, 140, 140, 140]);
  const monumentBrud = r.hard.filter((h) => h.includes("monument") || h.includes("sidste løbsdag") || h.includes("GT-spænd"));
  assert.deepEqual(monumentBrud, [], monumentBrud.join("\n"));
  const d1 = r.plan.planTiers.find((t) => t.tier === 1);
  assert.ok(d1.monumentRulesHeld, "D1's pakning er fundet MED monument-reglerne");
  // D2-D4 holder overlap-baandet (D1: se PR'ens spoergsmaal til ejeren).
  const baandBrud = r.hard.filter((h) => h.includes("2+ samtidige løb") && !h.includes("tier 1:"));
  assert.deepEqual(baandBrud, [], baandBrud.join("\n"));
});
