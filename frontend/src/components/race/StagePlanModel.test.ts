// #7003: etapeplanens UI-hjaelpere (kun gyldige valg, reparation, opsummering efter etapen).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ridersSplitKm, stagePlanContactFacts } from "../../lib/stageSplitTimes.ts";
import {
  clearRiderPlan,
  fallbackOrderKeys,
  nextLeg,
  removeLeg,
  setLegTask,
  setLegTrigger,
  stagePlanOutcomes,
  stagePlanRecap,
  stagePlanReplacesControls,
  stagePlanRouteFromRaw,
  taskOptions,
  triggerOptions,
  validateStagePlanLegs,
  withStagePlanFields,
  withoutStagePlans,
} from "./StagePlanModel.ts";
import { riderInFrontOrFieldAt } from "../../lib/stageSplitTimes.ts"; // #7636
import { stagePlanFeaturesFromRaw, stagePlanSwitchNoteText, stagePlanSwitchNotes } from "./StagePlanModel.ts"; // #7383
import { suggestStagePlan, suggestionReasonKey } from "./StagePlanModel.ts"; // #7369
import type { StagePlanLeg } from "./StagePlanModel.ts";

const ROUTE = stagePlanRouteFromRaw({
  distance_km: 150,
  profile_type: "mountain",
  climbs: [{ name: "Col A", crest_km: 60, category: "2" }, { name: "Col B", crest_km: 110, category: "1" }],
});
const HELPER: StagePlanLeg[] = [
  { task: "shelter_leader" },
  { task: "tempo", from: { at: "kom", kom_index: 0 } },
  { task: "grupetto", from: { at: "dropped" } },
];

test("#7003: valgene for et led er kun de logiske", () => {
  assert.ok(!taskOptions(HELPER, 1, "helper", ROUTE).includes("breakaway"), "udbrud kun foerst");
  assert.ok(taskOptions(HELPER, 0, "helper", ROUTE).includes("breakaway"));
  assert.ok(!taskOptions(HELPER, 0, "captain", ROUTE).includes("grupetto"));
  // Leddet efter Col A kan ikke skifte foer Col A; "naar sat" kun i sidste led.
  const opts = triggerOptions(HELPER, 1, "helper", ROUTE).map((f) => f.at === "kom" ? `kom:${f.kom_index}` : f.at);
  assert.ok(!opts.includes("kom:1") || opts.indexOf("kom:0") < opts.indexOf("kom:1"), "rutens orden");
  // "Naar sat" paa et midter-led goer det til sidste led (resten klippes af).
  assert.deepEqual(setLegTrigger(HELPER, 1, { at: "dropped" }, "helper", ROUTE), [HELPER[0], { task: "tempo", from: { at: "dropped" } }]);
  assert.deepEqual(triggerOptions([{ task: "shelter_leader" }, { task: "grupetto", from: { at: "final_km" } }], 1, "helper", ROUTE).map((f) => f.at), ["kom", "kom", "final_km", "dropped"]);
});

test("#7003: et valg der goer resten ugyldig, klipper kaeden til det gyldige praefiks", () => {
  // Grupetto i midten: alt efter det falder bort.
  assert.deepEqual(setLegTask(HELPER, 1, "grupetto", "helper", ROUTE), [HELPER[0], { task: "grupetto", from: { at: "kom", kom_index: 0 } }]);
  // Andet led flyttet til efter Col B: tredje led (sat) er stadig gyldigt.
  assert.deepEqual(setLegTrigger(HELPER, 1, { at: "kom", kom_index: 1 }, "helper", ROUTE)[1].from, { at: "kom", kom_index: 1 });
  assert.deepEqual(removeLeg(HELPER, 1, "helper", ROUTE), [HELPER[0], HELPER[2]]);
  assert.equal(removeLeg(HELPER, 0, "helper", ROUTE), HELPER, "foerste led fjernes aldrig");
  assert.equal(nextLeg(HELPER, "helper", ROUTE), null, "loftet er naaet");
  const added = [{ task: "shelter_leader" }, nextLeg([{ task: "shelter_leader" }], "helper", ROUTE)];
  assert.equal(validateStagePlanLegs(added, "helper", ROUTE), null);
});

test("#7003: gem udleder de gamle felter; kopi til naeste etape tager ikke planen med", () => {
  const order: { breakaway_stance: string; riders: Array<Record<string, unknown> & { rider_id: string; plan?: StagePlanLeg[] }> } = { breakaway_stance: "neutral", riders: [{ rider_id: "a", effort: "all_out", try_break: true, leadout: false, plan: HELPER }, { rider_id: "b", effort: "save" }] };
  assert.deepEqual(withStagePlanFields(order).riders![0], { rider_id: "a", effort: "normal", try_break: false, leadout: false, plan: HELPER });
  assert.deepEqual(withStagePlanFields(order).riders![1], { rider_id: "b", effort: "save" });
  assert.deepEqual(withoutStagePlans(order).riders![0], { rider_id: "a", effort: "all_out", try_break: true, leadout: false });
  // Rydning genskaber rollens felter (ingen skjulte overstyringer fra planen).
  assert.deepEqual(clearRiderPlan(order, "a", { rider_id: "a", effort: "normal", try_break: false, leadout: true }).riders![0], { rider_id: "a", effort: "normal", try_break: false, leadout: true, plan: null });
});

test("#7003: opsummeringen efter etapen laeses af stage_plan_leg-events", () => {
  const sat = [{ type: "stage_plan_leg", km: 64, params: { rider_id: "a", leg: 2, task: "grupetto", reason: "dropped" } }];
  assert.deepEqual(stagePlanRecap(HELPER, sat, "a").map((i) => [i.status, i.endReason]), [
    ["done", "dropped"],
    ["skipped", null],
    ["to_finish", "finish"],
  ]);
  const planned = [
    { type: "stage_plan_leg", km: 62, params: { rider_id: "a", leg: 1, task: "tempo", reason: "kom" } },
    { type: "stage_plan_leg", km: 101, params: { rider_id: "a", leg: 2, task: "grupetto", reason: "dropped" } },
    { type: "stage_plan_leg", km: 30, params: { rider_id: "other", leg: 1, task: "tempo", reason: "kom" } },
  ];
  assert.deepEqual(stagePlanRecap(HELPER, planned, "a").map((i) => [i.status, i.endReason, i.endKm]), [
    ["done", "kom", 62],
    ["done", "dropped", 101],
    ["to_finish", "finish", null],
  ]);
  const quit = [{ type: "incident", km: 80, params: { rider_id: "a", outcome: "abandoned" } }];
  assert.deepEqual(stagePlanRecap(HELPER, quit, "a").map((i) => i.status), ["abandoned", "not_reached", "not_reached"]);
});

test("#6350: 'sat ved km' er hvor han reelt blev sat, aldrig foer det forrige skift i kaeden", () => {
  const sat = [
    { type: "stage_plan_leg", km: 62, params: { rider_id: "a", leg: 1, task: "tempo", reason: "kom", exact_km: 62 } },
    { type: "stage_plan_leg", km: 161, params: { rider_id: "a", leg: 2, task: "grupetto", reason: "dropped", exact_km: 147.31 } },
  ];
  assert.deepEqual(stagePlanRecap(HELPER, sat, "a").map((i) => [i.endReason, i.endKm]), [["kom", 62], ["dropped", 147.31], ["finish", null]]);
  const before = [sat[0], { ...sat[1], params: { ...sat[1].params, exact_km: 50 } }];
  assert.equal(stagePlanRecap(HELPER, before, "a")[1].endKm, 62);
});

test("#7368: et led slutter ved det led der faktisk afloeste det (ogsaa naar et led blev sprunget over)", () => {
  const legs: StagePlanLeg[] = [
    { task: "stay_sheltered" },
    { task: "follow_moves", from: { at: "kom", kom_index: 0 } },
    { task: "attack", from: { at: "kom", kom_index: 1 } },
  ];
  // Begge stigninger passeret ved samme skift: leddet "efter X" blev aldrig koert.
  const both = [{ type: "stage_plan_leg", km: 100, params: { rider_id: "a", leg: 2, task: "attack", reason: "kom" } }];
  assert.deepEqual(stagePlanRecap(legs, both, "a").map((i) => [i.status, i.endReason, i.endLeg]), [
    ["done", "kom", 2], // til toppen af Y (leddet der faktisk tog over), ikke X
    ["skipped", null, null],
    ["to_finish", "finish", null],
  ]);
  // Normal kaede: "efter X" gaelder til planens naeste punkt.
  const normal = [
    { type: "stage_plan_leg", km: 50, params: { rider_id: "a", leg: 1, task: "follow_moves", reason: "kom" } },
    { type: "stage_plan_leg", km: 100, params: { rider_id: "a", leg: 2, task: "attack", reason: "kom" } },
  ];
  assert.deepEqual(stagePlanRecap(legs, normal, "a").map((i) => [i.status, i.fromKm, i.endKm, i.endLeg]), [
    ["done", 0, 50, 1],
    ["done", 50, 100, 2],
    ["to_finish", 100, null, null],
  ]);
});

test("#7003: rytter uden plan: boardet viser de valg han koerer paa, naar de ikke er rollens", () => {
  const helperDefault = { effort: "protect", try_break: false, leadout: false };
  assert.deepEqual(fallbackOrderKeys("normal", { rider_id: "a", try_break: false, leadout: false }, helperDefault), [], "helt paa rollen");
  assert.deepEqual(fallbackOrderKeys(undefined, { rider_id: "a" }, null), [], "intet sat = rollen");
  assert.deepEqual(fallbackOrderKeys("normal", { rider_id: "a", try_break: true }, helperDefault), ["intention.step.normal", "tacticsOrders.tryBreak"]);
  assert.deepEqual(fallbackOrderKeys("all_out", { rider_id: "a", leadout: true }, { leadout: true }), ["intention.step.all_out", "tacticsOrders.leadout"]);
  // Rollens eget udbrudsforsoeg er ikke et eget valg; at slaa det fra er.
  assert.deepEqual(fallbackOrderKeys("normal", { rider_id: "h", try_break: true }, { try_break: true }), []);
  assert.deepEqual(fallbackOrderKeys("normal", { rider_id: "h", try_break: false }, { try_break: true }), ["intention.step.normal"]);
  const board = readFileSync(new URL("./StagePlanBoard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(board, /t\(stageCompleted \? "stagePlan\.noPlanLocked" : "stagePlan\.noPlan"\)/, "teksten gaar gennem fallbackOrderKeys");
  assert.match(readFileSync(new URL("./RaceTacticsTab.jsx", import.meta.url), "utf8"), /effortFor=\{effortFor\}/);
});

test("#7003: enkeltstart og holdtidskoersel beholder de almindelige indsats-kontroller", () => {
  for (const tt of ["itt", "itt_hilly", "ttt"]) assert.equal(stagePlanReplacesControls(true, tt), false, tt);
  for (const road of ["flat", "rolling", "hilly", "mountain", undefined]) assert.equal(stagePlanReplacesControls(true, road), true, String(road));
  assert.equal(stagePlanReplacesControls(false, "mountain"), false);
  // Taktik-fanen gater boardet (og skjuler tabellen) paa netop denne regel for den aabne etape.
  const tab = readFileSync(new URL("./RaceTacticsTab.jsx", import.meta.url), "utf8");
  assert.match(tab, /const stagePlanOn = showOrders && stagePlanReplacesControls\(orders\?\.stagePlanEnabled === true, stageProfileType\);/);
  assert.match(tab, /const stageProfileType = profileByStage\[activeStage\]\?\.profile_type;/);
});

test("#7003 (spec §3): sprinttoget tilbydes ikke efter et udbrud", () => {
  const afterBreak: StagePlanLeg[] = [{ task: "breakaway" }, { task: "tempo", from: { at: "kom", kom_index: 0 } }];
  assert.ok(!taskOptions(afterBreak, 1, "helper", ROUTE).includes("sprint_train"));
  assert.equal(validateStagePlanLegs([{ task: "breakaway" }, { task: "sprint_train", from: { at: "final_km" } }], "helper", ROUTE), "stage_plan_train_after_breakaway");
  // Uden udbrud foerst er toget stadig et gyldigt slut-led.
  assert.equal(validateStagePlanLegs([{ task: "shelter_leader" }, { task: "sprint_train", from: { at: "final_km" } }], "helper", ROUTE), null);
});

// ── #7383: noten naar et valgt skift ikke kan naas ──────────────────────────
function noteRoute(raw: { distance_km: number; finale_type?: string; climbs?: unknown[]; sectors?: unknown[]; profile_type?: string; elevation_profile?: unknown }) {
  const full = { profile_type: "mountain", ...raw };
  return { route: stagePlanRouteFromRaw(full), features: stagePlanFeaturesFromRaw(full) };
}
const ATTACK_LAST_10: StagePlanLeg[] = [{ task: "stay_sheltered" }, { task: "attack", from: { at: "final_km" } }];
const TEMPO_LAST_10: StagePlanLeg[] = [{ task: "shelter_leader" }, { task: "tempo", from: { at: "final_km" } }];

test("#7383: de sidste 10 km paa aaben vej giver ingen note", () => {
  const { route, features } = noteRoute({ distance_km: 150, climbs: [{ name: "A", crest_km: 60, length_km: 8, category: "2" }] });
  assert.deepEqual(stagePlanSwitchNotes(ATTACK_LAST_10, route, features), []);
  assert.deepEqual(stagePlanSwitchNotes(TEMPO_LAST_10, route, features), []);
});

test("#7383: en stigning eller sektor over punktet giver ingen note (motoren deler den praecis dér)", () => {
  const cases = [
    noteRoute({ distance_km: 140, climbs: [{ name: "Top", crest_km: 140, length_km: 25, category: "1", summit_finish: true }] }),
    noteRoute({ distance_km: 150, climbs: [{ name: "A", crest_km: 146, length_km: 10, category: "2" }] }),
    noteRoute({ distance_km: 150, climbs: [{ name: "A", crest_km: 144, length_km: 10, category: "2" }] }),
    noteRoute({ distance_km: 150, profile_type: "cobbles", sectors: [{ name: "S", kind: "cobbles", start_km: 138, length_km: 4 }] }),
  ];
  for (const { route, features } of cases) {
    assert.ok(features.some((f) => f.kind !== "descent" && f.from_km < route.distance_km - 10 && route.distance_km - 10 < f.to_km), "fixturen: punktet inde i stykket");
    assert.deepEqual(stagePlanSwitchNotes(ATTACK_LAST_10, route, features), []);
    assert.deepEqual(stagePlanSwitchNotes(TEMPO_LAST_10, route, features), []);
  }
});

test("#7383: nedkoerselsfinalen deles aldrig: to skift paa samme sted", () => {
  const { route, features } = noteRoute({ distance_km: 150, finale_type: "descent", climbs: [{ name: "A", crest_km: 135, length_km: 12, category: "1" }] });
  assert.deepEqual(features.map((f) => [f.kind, f.from_km, f.to_km]), [["climb", 123, 135], ["descent", 135, 150]]);
  const legs: StagePlanLeg[] = [{ task: "stay_sheltered" }, { task: "follow_moves", from: { at: "kom", kom_index: 0 } }, { task: "attack", from: { at: "final_km" } }];
  assert.deepEqual(stagePlanSwitchNotes(legs, route, features), [{ kind: "feature", leg: 2, feature: "descent", place: "start" }, { kind: "same_point", leg: 1, next: 2 }]);
});

test("#7383: punktet paa nedkoerslens anden halvdel: foden for holdarbejde, finalen for angrebet", () => {
  const { route, features } = noteRoute({ distance_km: 150, finale_type: "descent", climbs: [{ name: "A", crest_km: 125, length_km: 12, category: "1" }] });
  assert.deepEqual(features.map((f) => [f.kind, f.from_km, f.to_km]), [["climb", 113, 125], ["descent", 125, 150]]);
  assert.deepEqual(stagePlanSwitchNotes(ATTACK_LAST_10, route, features), [{ kind: "feature", leg: 1, feature: "descent", place: "finale" }]);
  assert.deepEqual(stagePlanSwitchNotes(TEMPO_LAST_10, route, features), [{ kind: "feature", leg: 1, feature: "descent", place: "start" }]);
});

// #7625: nedkoerselsfinalen er et helt segment, men vejen er ofte flad paa den sidste del.
function fallingThenFlat(dropEndKm: number) {
  const h: number[] = [];
  for (let km = 0; km <= 150; km++) h.push(km <= 135 ? 600 : 600 - Math.min(km, dropEndKm) * 0 - Math.min(km - 135, dropEndKm - 135) * 40);
  return { v: 1, step_km: 1, h };
}

test("#7625: flad udkoersel efter en kort nedkoersel giver en note uden nedkoerselspaastand", () => {
  const { route, features } = noteRoute({ distance_km: 150, finale_type: "descent", climbs: [{ name: "A", crest_km: 135, length_km: 12, category: "1" }], elevation_profile: fallingThenFlat(139) });
  assert.equal(features.find((f) => f.kind === "descent")?.down_to_km, 139);
  assert.deepEqual(stagePlanSwitchNotes(ATTACK_LAST_10, route, features), [{ kind: "feature", leg: 1, feature: "flat", place: "start" }]);
  assert.deepEqual(stagePlanSwitchNotes(TEMPO_LAST_10, route, features), [{ kind: "feature", leg: 1, feature: "flat", place: "start" }]);
});

test("#7625: flad udkoersel, skiftet i nedkoerslens anden halvdel: noten siger at leddet foerst starter i finalen", () => {
  const { route, features } = noteRoute({ distance_km: 190, finale_type: "descent", climbs: [{ name: "A", crest_km: 169, length_km: 12, category: "1" }], elevation_profile: { v: 1, step_km: 1, h: Array.from({ length: 191 }, (_, km) => (km <= 169 ? 900 : 900 - Math.min(km - 169, 3) * 40)) } });
  assert.deepEqual(stagePlanSwitchNotes(ATTACK_LAST_10, route, features), [{ kind: "feature", leg: 1, feature: "flat", place: "finale" }]);
});

test("#7625: vejen falder stadig 10 km fra maal: noten staar som foer", () => {
  const { route, features } = noteRoute({ distance_km: 150, finale_type: "descent", climbs: [{ name: "A", crest_km: 135, length_km: 12, category: "1" }], elevation_profile: fallingThenFlat(150) });
  assert.deepEqual(stagePlanSwitchNotes(TEMPO_LAST_10, route, features), [{ kind: "feature", leg: 1, feature: "descent", place: "start" }]);
});

test("#7625: uden hoejdeprofil regnes hele finalen som nedkoersel (uaendret)", () => {
  const { route, features } = noteRoute({ distance_km: 150, finale_type: "descent", climbs: [{ name: "A", crest_km: 135, length_km: 12, category: "1" }] });
  assert.equal(features.find((f) => f.kind === "descent")?.down_to_km, undefined);
  assert.equal(stagePlanSwitchNotes(TEMPO_LAST_10, route, features).length, 1);
});

test("#7383 (Codex-review): overlappende stigning og sektor loeses som rutegeneratoren", () => {
  const { route, features } = noteRoute({ distance_km: 150, climbs: [{ name: "A", crest_km: 139, length_km: 9, category: "3" }], sectors: [{ name: "S", start_km: 134, length_km: 11 }] });
  assert.deepEqual(features.map((f) => [f.kind, f.from_km, f.to_km]), [["climb", 130, 139], ["sector", 139, 145]]);
  assert.deepEqual(stagePlanSwitchNotes(ATTACK_LAST_10, route, features), []);
});

test("#7383: notens tekst findes paa alle sprog", () => {
  const notes = [
    ...(["start", "finale"] as const).map((place) => ({ kind: "feature" as const, leg: 1, feature: "descent" as const, place })),
    ...(["start", "finale"] as const).map((place) => ({ kind: "feature" as const, leg: 1, feature: "flat" as const, place })),
    { kind: "same_point" as const, leg: 1, next: 2 },
  ];
  for (const lng of ["en", "da", "es", "fr", "nl"]) {
    const races = JSON.parse(readFileSync(new URL(`../../../public/locales/${lng}/races.json`, import.meta.url), "utf8"));
    for (const note of notes) {
      const { key, params } = stagePlanSwitchNoteText(note);
      const text = key.split(".").reduce((o: Record<string, unknown> | undefined, k) => o?.[k] as Record<string, unknown> | undefined, races) as unknown;
      assert.equal(typeof text, "string", `${lng} ${key}`);
      for (const p of Object.keys(params)) assert.ok((text as string).includes(`{${p}}`), `${lng} ${key} {${p}}`);
      assert.ok(!(text as string).includes("—"), `${lng} ${key}: ingen em-dash`);
    }
  }
});

// ── #7369: forslaget skal kunne kendes fra et valg (maerke + kort grund) ──
const ROLES_7369 = ["captain", "co_captain", "sprint_captain", "helper", "hunter", "free_role"] as const;
const PROFILES_7369 = ["flat", "rolling", "hilly", "medium_mountain", "mountain", "high_mountain", "cobbles", null];
const CLIMBS_7369 = [
  [],
  [{ crest_km: 60, category: "3" }],
  [{ crest_km: 60, category: "3" }, { crest_km: 110, category: "1" }],
  [{ crest_km: 40, category: "2" }, { crest_km: 90, category: "1" }, { crest_km: 150, category: "HC", summit_finish: true }],
];

test("#7369: hvert forslag paa en linjeetape har en kort grund, og grunden findes paa alle sprog", () => {
  const locales = Object.fromEntries(["en", "da", "es", "fr", "nl"].map((lng) => [lng, JSON.parse(readFileSync(new URL(`../../../public/locales/${lng}/races.json`, import.meta.url), "utf8"))]));
  for (const profile_type of PROFILES_7369) {
    for (const climbs of CLIMBS_7369) {
      const route = stagePlanRouteFromRaw({ distance_km: 150, profile_type, climbs });
      for (const role of ROLES_7369) {
        for (const teamHasSprintCaptain of [false, true]) {
          for (const luxuryHelper of role === "helper" ? [false, true] : [false]) {
            const legs = suggestStagePlan({ role, route, teamHasSprintCaptain, luxuryHelper });
            const key = suggestionReasonKey(legs, role, luxuryHelper);
            assert.ok(key, `${role} ${profile_type} ${JSON.stringify(climbs)} ${luxuryHelper}`);
            for (const [lng, races] of Object.entries(locales)) {
              const text = (key as string).split(".").reduce((o: Record<string, unknown> | undefined, k) => o?.[k] as Record<string, unknown> | undefined, races) as unknown;
              assert.equal(typeof text, "string", `${lng} ${key}`);
              assert.ok(!(text as string).includes("—"), `${lng} ${key}: ingen em-dash`);
            }
          }
        }
      }
    }
  }
});

test("#7369: lederens grund siger at angrebet er spillerens valg", () => {
  const legs = suggestStagePlan({ role: "captain", route: ROUTE, teamHasSprintCaptain: false });
  assert.deepEqual(legs, [{ task: "stay_sheltered" }, { task: "follow_moves", from: { at: "kom", kom_index: 0 } }]);
  assert.equal(suggestionReasonKey(legs, "captain"), "stagePlan.suggestionReason.followLastClimb");
  const flat = stagePlanRouteFromRaw({ distance_km: 150, profile_type: "flat", climbs: [] });
  assert.equal(suggestionReasonKey(suggestStagePlan({ role: "captain", route: flat, teamHasSprintCaptain: false }), "captain"), "stagePlan.suggestionReason.leaderFinal");
  assert.equal(suggestionReasonKey(null, "captain"), null, "enkeltstart: intet forslag, ingen grund");
  const en = JSON.parse(readFileSync(new URL("../../../public/locales/en/races.json", import.meta.url), "utf8"));
  assert.match(en.stagePlan.suggestionReason.followLastClimb, /your call/);
  assert.match(en.stagePlan.suggestionReason.leaderFinal, /your call/);
});

test("#7369: boardet viser maerket ved forslaget, ogsaa i editoren naar felterne viser forslaget", () => {
  const board = readFileSync(new URL("./StagePlanBoard.tsx", import.meta.url), "utf8");
  assert.match(board, /<SuggestionBadge t=\{t\} \/>[\s\S]{0,200}<PlanChain t=\{t\} legs=\{suggestion\}/);
  assert.match(board, /showsSuggestion=\{!saved\}/);
  assert.doesNotMatch(board, /<span className="sr-only">\{t\("stagePlan\.suggestion"\)\}<\/span>/, "mobil: maerket er synligt, ikke kun for skaermlaesere");
});

// ── #7636 (kontakten stage_plan_dropped_front_7635): resumeet modsiger aldrig filmen ──

const CAPTAIN: StagePlanLeg[] = [
  { task: "follow_moves" },
  { task: "attack", from: { at: "kom", kom_index: 1 } },
  { task: "ride_for_result", from: { at: "dropped" } },
];

/** Samme form som motorens finale_attack i mechanics/descent.ts. */
const descentAttack = (km: number, riderIds: string[]) => ({
  type: "finale_attack",
  km,
  params: { direction: "descent", rider_ids: riderIds, group_id: "breakaway-2000", gained_seconds: 6 },
});

/** Giro-moenstret: et nedkoerselsangreb faa sekunder foran, rytteren "a" i feltet hele dagen. */
const DESCENT_FILM = [
  { type: "stage_start", km: 0, params: { field_count: 8 } },
  { type: "finale_attack", km: 60, params: { direction: "descent", rider_ids: ["x", "y", "z"], group_id: "breakaway-2000", gained_seconds: 6 } },
  { type: "gap_update", km: 60, params: { group_id: "peloton-0", gap_seconds: 6 } },
  { type: "stage_plan_leg", km: 60, params: { rider_id: "a", leg: 2, task: "ride_for_result", reason: "dropped" } },
  { type: "group_merged", km: 64, params: { group_id: "breakaway-2000", into_group_id: "peloton-0", rider_ids: ["x", "y", "z"] } },
];

/** En rigtig opdeling: "a" falder af og ligger bag feltet paa stedet. */
const REAL_DROP_FILM = [
  { type: "stage_start", km: 0, params: { field_count: 6 } },
  { type: "peloton_splits", km: 60, params: { group_id: "gruppetto-3001", source_group_id: "peloton-0", rider_ids: ["a", "b"], cause: "climb_deficit" } },
  { type: "gap_update", km: 60, params: { group_id: "gruppetto-3001", gap_seconds: 240 } },
  { type: "stage_plan_leg", km: 60, params: { rider_id: "a", leg: 2, task: "ride_for_result", reason: "dropped" } },
];

const crossCheck = (film: Parameters<typeof riderInFrontOrFieldAt>[0]) => ({ inFrontOrFieldAt: (km: number) => riderInFrontOrFieldAt(film, "a", km) });

test("#7636: filmen viser ham i feltet: hverken 'sat' eller 'sprunget over, han var sat'", () => {
  assert.equal(riderInFrontOrFieldAt(DESCENT_FILM, "a", 60), true, "tidslinjen: rytteren i feltet");
  const items = stagePlanRecap(CAPTAIN, DESCENT_FILM, "a", crossCheck(DESCENT_FILM));
  assert.deepEqual(items.map((i) => [i.status, i.endReason, i.fromHidden ?? false]), [
    ["done", null, false],
    ["not_reached", null, false],
    ["to_finish", "finish", true],
  ]);
  assert.ok(!items.some((i) => i.endReason === "dropped" || i.status === "skipped"));
});

test("#7636: uden kontakten er resumeet som foer (ogsaa naar filmen modsiger det)", () => {
  assert.deepEqual(stagePlanRecap(CAPTAIN, DESCENT_FILM, "a").map((i) => [i.status, i.endReason, i.fromHidden ?? false]), [
    ["done", "dropped", false],
    ["skipped", null, false],
    ["to_finish", "finish", false],
  ]);
});

test("#7636: en rigtig opdeling i filmen beholder 'sat'", () => {
  assert.equal(riderInFrontOrFieldAt(REAL_DROP_FILM, "a", 60), false);
  assert.deepEqual(stagePlanRecap(CAPTAIN, REAL_DROP_FILM, "a", crossCheck(REAL_DROP_FILM)).map((i) => [i.status, i.endReason, i.fromHidden ?? false]), [
    ["done", "dropped", false],
    ["skipped", null, false],
    ["to_finish", "finish", false],
  ]);
});

test("#7636: ukendt gruppe (v3-tidslinje uden gruppe-gab) krydstjekker intet", () => {
  const v3 = [{ type: "stage_plan_leg", km: 60, params: { rider_id: "a", leg: 2, task: "ride_for_result", reason: "dropped" } }];
  assert.equal(riderInFrontOrFieldAt(v3, "a", 60), null);
  assert.deepEqual(stagePlanRecap(CAPTAIN, v3, "a", crossCheck(v3)).map((i) => i.endReason), ["dropped", null, "finish"]);
});

test("#7636: fladen laeser kontakten og skjuler et tomt slut-led (ingen ny spillertekst)", () => {
  const board = readFileSync(new URL("./StagePlanBoard.tsx", import.meta.url), "utf8");
  assert.match(board, /flags\?\.stage_plan_dropped_front_7635 === true/);
  assert.match(board, /crossCheck=\{crossCheck7636\}/);
  assert.match(board, /\{line \? <>\{", "\}/);
});

// #7706: markeringen er udfaldet. Flueben og fiasko kraever bevis; uden bevis staar der intet.
type RecapEvents = Parameters<typeof stagePlanRecap>[1];
type OutcomeOpts = NonNullable<Parameters<typeof stagePlanOutcomes>[3]>;
// Testene her giver filmens svar som tal; held = filmen viser intet fald (de rigtige film: filmOutcomes).
const results = (legs: StagePlanLeg[], events: RecapEvents, opts: OutcomeOpts = {}) =>
  stagePlanOutcomes(stagePlanRecap(legs, events, "a"), events, "a", { heldContact: () => (opts.lostContactKm === undefined ? null : true), ...opts });
const filmOutcomes = (legs: StagePlanLeg[], film: NonNullable<RecapEvents>, opts: OutcomeOpts = {}) =>
  stagePlanOutcomes(stagePlanRecap(legs, film, "a"), film, "a", { ...stagePlanContactFacts(film as Parameters<typeof stagePlanContactFacts>[0], "a"), ...opts })
    .map((o) => o.word && [o.mark, o.word.key.replace("stagePlan.recap.outcome.", ""), ...Object.values(o.word.params ?? {})].join(" "));
const outcomes = (legs: StagePlanLeg[], events: RecapEvents, lostContactKm?: number | null, opts: OutcomeOpts = {}) =>
  results(legs, events, { lostContactKm, ...opts }).map((o) => o.mark);
const words = (legs: StagePlanLeg[], events: RecapEvents, lostContactKm?: number | null, opts: OutcomeOpts = {}) =>
  results(legs, events, { lostContactKm, ...opts }).map((o) => o.word && [o.word.key.replace("stagePlan.recap.outcome.", ""), ...Object.values(o.word.params ?? {})].join(" "));
const leg = (km: number, n: number, task: string, reason: string) => ({ type: "stage_plan_leg", km, params: { rider_id: "a", leg: n, task, reason } });
const BREAK_PLAN: StagePlanLeg[] = [{ task: "breakaway" }, { task: "ride_for_result", from: { at: "dropped" } }];
const ATTACK_PLAN: StagePlanLeg[] = [{ task: "stay_sheltered" }, { task: "attack", from: { at: "final_km" } }];
const RIDE_IN: StagePlanLeg[] = [{ task: "shelter_leader" }, { task: "ride_in", from: { at: "dropped" } }];

test("#7706: 'Go in the break' uden udbrud er forsoegt uden held, ikke et flueben", () => {
  assert.deepEqual(outcomes(BREAK_PLAN, [leg(30, 1, "ride_for_result", "missed_break")], null), ["failed", "none"]);
  assert.deepEqual(outcomes(BREAK_PLAN, [leg(90, 1, "ride_for_result", "caught")], null), ["done", "none"]);
  assert.deepEqual(words(BREAK_PLAN, [leg(90, 1, "ride_for_result", "caught")], null, { rank: 14 }), ["inBreak", "rank 14"]);
});

test("#7706: udbrud som eneste led: filmen afgoer, og uden navn staar der intet", () => {
  const solo: StagePlanLeg[] = [{ task: "breakaway" }];
  assert.deepEqual(outcomes(solo, [{ type: "breakaway_formed", km: 10, params: { rider_ids: ["a"] } }], null), ["done"]);
  assert.deepEqual(outcomes(solo, [{ type: "breakaway_attempt", km: 10, params: { rider_ids: ["a"] } }], null), ["failed"]);
  assert.deepEqual(results(solo, [{ type: "breakaway_formed", km: 10, params: { rider_ids: ["x"] } }], { lostContactKm: null }), [{ mark: "none", word: null }]);
});

test("#7706: 'Attack' for en rytter der tabte kontakten er ikke et flueben", () => {
  const film = [leg(140, 1, "attack", "final_km")];
  assert.deepEqual(words(ATTACK_PLAN, film, 145), ["keptContact", "lostContact 145"]);
  assert.deepEqual(outcomes(ATTACK_PLAN, film, 145), ["done", "failed"]);
  assert.deepEqual(outcomes(ATTACK_PLAN, film, 100), ["info", "failed"], "faldt af i laeet: en kendsgerning, ingen fiasko");
  assert.deepEqual(outcomes(ATTACK_PLAN, film, null), ["done", "none"], "intet angreb i filmen: intet at vise");
  const attacked = [...film, { type: "finale_attack", km: 143, params: { kind: "late_attack", rider_id: "a" } }];
  assert.deepEqual(words(ATTACK_PLAN, attacked, null), ["keptContact", "attacked 143"]);
  assert.deepEqual(outcomes(ATTACK_PLAN, attacked, null), ["done", "done"]);
  const bookkeeping = [...film, { type: "finale_attack", km: 143, params: { kind: "stage_decided", rider_id: "a" } }];
  assert.deepEqual(outcomes(ATTACK_PLAN, bookkeeping, null), ["done", "none"]);
  const carried = [...film, { type: "finale_attack", km: 143, params: { kind: "carried_gap_held", rider_ids: ["a"] } }];
  assert.deepEqual(outcomes(ATTACK_PLAN, carried, null), ["done", "none"]);
  const atSwitch = [descentAttack(140, ["a"]), ...film];
  assert.deepEqual(outcomes(ATTACK_PLAN, atSwitch, null), ["done", "none"], "angrebet paa skiftets km var det forrige led");
});

test("#7706: et angreb paa nedkoersel i et Attack-led er et flueben, i motorens eget format", () => {
  const film = [leg(140, 1, "attack", "final_km")];
  assert.deepEqual(outcomes(ATTACK_PLAN, [...film, descentAttack(143, ["a", "x"])], null), ["done", "done"]);
  assert.deepEqual(outcomes(ATTACK_PLAN, [...film, descentAttack(143, ["x"])], null), ["done", "none"], "en andens angreb er ikke hans");
});

test("#7706: filmen navngiver ham i udbruddet, motoren siger missed_break: ingen paastand", () => {
  const film = [{ type: "breakaway_formed", km: 10, params: { rider_ids: ["a"] } }, leg(30, 1, "ride_for_result", "missed_break")];
  assert.deepEqual(outcomes(BREAK_PLAN, film, null), ["none", "none"]);
});

test("#7706: manglende film giver aldrig et flueben paa en opgave der kraever bevis", () => {
  assert.deepEqual(outcomes(ATTACK_PLAN, [leg(140, 1, "attack", "final_km")]), ["none", "none"]);
});

test("#7706: Koer for resultat viser hans placering, ogsaa filmens top, og ingen dom", () => {
  const plan: StagePlanLeg[] = [{ task: "stay_sheltered" }, { task: "ride_for_result", from: { at: "final_km" } }];
  const film = [leg(140, 1, "ride_for_result", "final_km")];
  assert.deepEqual(results(plan, film, { lostContactKm: null, rank: 23 })[1], { mark: "info", word: { key: "stagePlan.recap.outcome.rank", params: { rank: 23 } } });
  assert.deepEqual(outcomes(plan, film, 150, { rank: 23 }), ["done", "info"], "placeringen fortaeller det selv, ogsaa efter et tab");
  const top = [...film, { type: "finish", km: 168, params: { top: [{ gap: 0, rank: 3, rider_id: "a" }] } }];
  assert.deepEqual(words(plan, top, null), ["keptContact", "rank 3"]);
  assert.deepEqual(words(plan, film, 150), ["keptContact", "lostContact 150"], "uden placering: tabet staar tilbage");
  assert.deepEqual(words(plan, film, null), ["keptContact", null], "uden placering og tab: intet");
});

test("#7706: Koer i maal kraever en raekke i resultatet, ikke at filmen er tavs", () => {
  const film = [leg(64, 1, "ride_in", "dropped")];
  assert.deepEqual(words(RIDE_IN, film, 64, { rank: 88 }), ["lostContact 64", "finished"]);
  assert.deepEqual(outcomes(RIDE_IN, film, 64, { rank: 88 }), ["info", "done"]);
  assert.deepEqual(results(RIDE_IN, film, { lostContactKm: 64 })[1], { mark: "none", word: null }, "motorens tavshed beviser intet");
});

test("#7706: holdarbejde siger hvem han sad med, aldrig at han arbejdede", () => {
  const film = [leg(169, 1, "ride_in", "dropped")];
  const leader = (splitKm: number | null | undefined) => ({ name: "A. Rider", splitKm: () => splitKm });
  assert.deepEqual(words(RIDE_IN, film, 169, { leader: leader(null), rank: 40 }), ["withRider A. Rider", "finished"]);
  assert.deepEqual(words(RIDE_IN, film, 169, { leader: leader(120), rank: 40 }), ["withRiderTo A. Rider 120", "finished"]);
  assert.deepEqual(outcomes(RIDE_IN, film, 169, { leader: leader(null), rank: 40 }), ["info", "done"], "ingen flueben paa holdarbejde");
  assert.deepEqual(words(RIDE_IN, film, 169, { leader: leader(undefined), rank: 40 }), ["lostContact 169", "finished"], "filmen kan ikke svare: kun hans eget tab");
  assert.deepEqual(words(RIDE_IN, film, null, { rank: 40 }), [null, "finished"], "hverken leder eller tab: intet");
  const asked: number[][] = [];
  const spy = { name: "A. Rider", splitKm: (from: number, to: number) => { asked.push([from, to]); return null; } };
  results([{ task: "tempo" }], [{ type: "finish", km: 190, params: {} }], { lostContactKm: null, leader: spy });
  assert.deepEqual(asked, [[0, 190]], "et led til maal maales til maalstregen, ikke finalens grupper");
});

test("#7706: motorens form: hjaelperen sad med lederen, til han blev sat (fra en rigtig film, anonymiseret)", () => {
  const film = [
    { km: 0, type: "stage_start", params: { distance_km: 190, field_count: 163, profile_type: "hilly" } },
    { km: 12, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 0 } },
    { km: 55.13, type: "group_merged", params: { group_id: "peloton-0", rider_ids: ["leader", "a"], into_group_id: "solo-m10-1-0" } },
    { km: 169, type: "peloton_splits", params: { cause: "climb_deficit", group_id: "gruppetto-9001", rider_ids: ["a"], gap_seconds: 58.01, source_group_id: "solo-m10-1-0" } },
    { km: 169, type: "stage_plan_leg", params: { leg: 1, task: "ride_in", reason: "dropped", rider_id: "a" } },
    { km: 190, type: "group_merged", params: { group_id: "solo-m10-1-0", rider_ids: ["leader"], into_group_id: "finale-tier-2" } },
    { km: 190, type: "finish", params: { top: [] } },
  ];
  assert.equal(ridersSplitKm(film, "a", "leader", 0, 169), null, "skiftet paa slut-km er leddets slutning");
  assert.equal(ridersSplitKm(film, "a", "leader", 0, 190), 169);
  assert.equal(ridersSplitKm(film, "a", "leader", 170, 190), undefined, "ikke sammen fra start: ingen paastand");
  assert.equal(ridersSplitKm(film.filter((e) => e.type !== "gap_update"), "a", "leader", 0, 169), undefined, "uden gruppe-gab: filmen kan ikke svare");
  const quit = [...film.slice(0, 3), { km: 100, type: "incident", params: { rider_id: "leader", outcome: "abandoned" } }];
  assert.equal(ridersSplitKm(quit, "a", "leader", 0, 169), undefined, "lederen udgik: ingen paastand");
});

test("#7706: et styrt med tidstab tilbageholder 'holdt kontakten'", () => {
  const crash = [leg(140, 1, "attack", "final_km"), { type: "incident", km: 90, params: { rider_id: "a", kind: "crash", outcome: "time_loss" } }];
  assert.deepEqual(outcomes(ATTACK_PLAN, crash, null), ["none", "none"]);
});

const FIELD = [
  { km: 0, type: "stage_start", params: { distance_km: 190, field_count: 163 } },
  { km: 12, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 0 } },
];
const SHELTER_THEN_RESULT: StagePlanLeg[] = [{ task: "stay_sheltered" }, { task: "ride_for_result", from: { at: "final_km" } }];
const fall = (km: number, group = "gruppetto-1") => ({ km, type: "peloton_splits", params: { cause: "climb_deficit", group_id: group, rider_ids: ["a"], gap_seconds: 58, source_group_id: "peloton-0" } });
const back = (km: number) => ({ km, type: "group_merged", params: { group_id: "gruppetto-1", rider_ids: ["a"], into_group_id: "peloton-0" } });
const FINISH = { km: 190, type: "finish", params: { top: [] } };

test("#7706: sat i leddet og tilbage efter det er ikke 'holdt kontakten'", () => {
  const switched = leg(120, 1, "ride_for_result", "final_km");
  const film = [...FIELD, fall(100), switched, back(140), FINISH];
  assert.deepEqual(filmOutcomes(SHELTER_THEN_RESULT, film), [null, null], "faldet er vaek fra tidstabet, men filmen viser ham bagud ved km 120");
  const backInLeg = [...FIELD, fall(100), back(110), switched, FINISH];
  assert.deepEqual(filmOutcomes(SHELTER_THEN_RESULT, backInLeg), [null, null], "undervejs taeller ogsaa, selv om han var tilbage ved leddets slut");
  const noGap = film.filter((e) => e.type !== "gap_update");
  assert.deepEqual(filmOutcomes(SHELTER_THEN_RESULT, noGap), [null, null], "uden gruppe-gab: intet");
  assert.deepEqual(filmOutcomes(SHELTER_THEN_RESULT, [...FIELD, switched, FINISH]), ["done keptContact", null], "et rent led har stadig sit flueben");
  const later = [...FIELD, switched, fall(140), back(150), FINISH];
  assert.deepEqual(filmOutcomes(SHELTER_THEN_RESULT, later), ["done keptContact", null], "et fald efter leddet rammer ikke leddet");
});

test("#7706: et styrt foer leddet taeller i leddet", () => {
  const plan: StagePlanLeg[] = [{ task: "follow_moves" }, { task: "stay_sheltered", from: { at: "final_km" } }];
  const crash = { km: 50, type: "incident", params: { rider_id: "a", kind: "crash", outcome: "time_loss" } };
  const solo = { km: 55, type: "gap_update", params: { group_id: "solo-m10-1-0", gap_seconds: 180 } };
  const switched = leg(60, 1, "stay_sheltered", "final_km");
  assert.deepEqual(filmOutcomes(plan, [...FIELD, crash, solo, switched, FINISH], { rank: 120 }), [null, null], "180 sek. efter i en solo-gruppe");
  assert.deepEqual(filmOutcomes(plan, [...FIELD, crash, switched, FINISH], { rank: 120 }), [null, null], "ogsaa naar filmen aldrig viser solo-gruppen");
  const protectedCrash = { ...crash, params: { ...crash.params, outcome: "protected_three_km_rule" } };
  assert.deepEqual(filmOutcomes(plan, [...FIELD, protectedCrash, switched, FINISH], { rank: 120 }), ["done keptContact", "done keptContact"], "3-km-reglen koster ingen tid");
});

test("#7706: 'Med X til km Y' er den skilning der staar ved magt", () => {
  assert.equal(ridersSplitKm([...FIELD, fall(60), back(65)], "a", "leader", 0, 190), null, "samlet igen: ingen km");
  assert.equal(ridersSplitKm([...FIELD, fall(60), back(65), fall(100, "gruppetto-2")], "a", "leader", 0, 190), 100, "den sidste skilning");
  assert.equal(ridersSplitKm([...FIELD, fall(60), back(120)], "a", "leader", 0, 100), 60, "stadig skilt ved leddets slut");
});

test("#7706: holdarbejdet ser uheld: uden sikker gruppe siger teksten ikke hvem han sad med", () => {
  const plan: StagePlanLeg[] = [{ task: "tempo" }];
  const leader = (film: Parameters<typeof ridersSplitKm>[0]) => ({ name: "A. Rider", splitKm: (from: number, to: number) => ridersSplitKm(film, "a", "leader", from, to) });
  const crash = (rider: string) => ({ km: 50, type: "incident", params: { rider_id: rider, kind: "crash", outcome: "time_loss" } });
  const clean = [...FIELD, FINISH];
  assert.deepEqual(filmOutcomes(plan, clean, { leader: leader(clean), rank: 40 }), ["info withRider A. Rider"]);
  const hisCrash = [...FIELD, crash("a"), FINISH];
  assert.deepEqual(filmOutcomes(plan, hisCrash, { leader: leader(hisCrash), rank: 40 }), [null], "filmen viser ingen solo-gruppe, men han sad ikke med lederen");
  const leaderCrash = [...FIELD, crash("leader"), FINISH];
  assert.deepEqual(filmOutcomes(plan, leaderCrash, { leader: leader(leaderCrash), rank: 40 }), ["info keptContact"], "lederens styrt: intet om lederen, kun hans eget");
  const lost = [...FIELD, crash("a"), { km: 55, type: "gap_update", params: { group_id: "solo-m10-1-0", gap_seconds: 180 } }, FINISH];
  assert.deepEqual(filmOutcomes(plan, lost, { leader: leader(lost), rank: 40 }), [null], "heller ingen km fra en solo-gruppe");
});

test("#7706: at blive sat er ingen fiasko for hjaelperen eller sprinteren, men heller intet flueben", () => {
  const sat = [leg(64, 2, "grupetto", "dropped")];
  assert.deepEqual(outcomes(HELPER, sat, 64, { rank: 90 }), ["info", "not_reached", "done"]);
});

test("#7706: motoren siger sat, filmen viser intet tab: ingen paastand om fiasko (#7636)", () => {
  const legs: StagePlanLeg[] = [{ task: "follow_moves" }, { task: "ride_in", from: { at: "dropped" } }];
  const film = [leg(60, 1, "ride_in", "dropped")];
  assert.deepEqual(outcomes(legs, film, null, { rank: 50 }), ["none", "done"]);
  assert.deepEqual(outcomes(legs, film, 60, { rank: 50 }), ["failed", "done"]);
  assert.deepEqual(outcomes(legs, film, undefined, { rank: 50 }), ["failed", "done"], "uden gruppe-gab staar motorens ord alene");
  // Skjult af krydstjekket (ingen slutgrund): heller intet flueben.
  const hidden = stagePlanRecap(legs, film, "a", { inFrontOrFieldAt: () => true });
  assert.deepEqual(stagePlanOutcomes(hidden, film, "a", { lostContactKm: null, rank: 50 }).map((o) => o.mark), ["none", "done"]);
});

test("#7706: udgaaet og uden for tidsgraensen er fiasko; juryens genindsaettelse fjerner den", () => {
  const quit = [{ type: "incident", km: 80, params: { rider_id: "a", outcome: "abandoned" } }];
  assert.deepEqual(outcomes(HELPER, quit, null), ["failed", "not_reached", "not_reached"]);
  assert.deepEqual(words(HELPER, quit, null), [null, null, null], "linjen siger selv at han udgik");
  const late = [leg(64, 2, "grupetto", "dropped"), { type: "outside_time_limit", km: 150, params: { rider_ids: ["a"] } }];
  assert.deepEqual(outcomes(HELPER, late, 64), ["info", "not_reached", "failed"]);
  assert.equal(words(HELPER, late, 64)[2], "outOfTime");
  const back = [...late, { type: "jury_reinstated", km: 150, params: { rider_ids: ["a"] } }];
  assert.deepEqual(outcomes(HELPER, back, 64, { rank: 120 }), ["info", "not_reached", "done"]);
});

test("#7706: fladen viser kun ord med bevis; ingen 'ukendt', og alle fem sprog har ordene", () => {
  const board = readFileSync(new URL("./StagePlanBoard.tsx", import.meta.url), "utf8");
  assert.match(board, /stagePlanOutcomes\(items, events, riderId/);
  assert.match(board, /\{word && <span/);
  assert.match(board, /isOneDay \? "gc" : "stage"/, "et enkeltdagsloeb gemmer maalraekkefoelgen som gc");
  assert.doesNotMatch(board, /const ridden = /);
  const keys = ["failed", "finished", "attacked", "inBreak", "keptContact", "lostContact", "outOfTime", "rank", "withRider", "withRiderTo"].sort();
  for (const lang of ["en", "da", "es", "fr", "nl"]) {
    const races = JSON.parse(readFileSync(new URL(`../../../public/locales/${lang}/races.json`, import.meta.url), "utf8"));
    assert.deepEqual(Object.keys(races.stagePlan.recap.outcome).sort(), keys, lang);
    assert.doesNotMatch(JSON.stringify(races.stagePlan.recap.outcome), /—/, lang);
  }
});
