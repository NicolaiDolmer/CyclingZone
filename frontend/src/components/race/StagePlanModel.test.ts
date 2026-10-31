// #7003: etapeplanens UI-hjaelpere (kun gyldige valg, reparation, opsummering efter etapen).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clearRiderPlan,
  fallbackOrderKeys,
  nextLeg,
  removeLeg,
  setLegTask,
  setLegTrigger,
  stagePlanRecap,
  stagePlanReplacesControls,
  stagePlanRouteFromRaw,
  taskOptions,
  triggerOptions,
  validateStagePlanLegs,
  withStagePlanFields,
  withoutStagePlans,
} from "./StagePlanModel.ts";
import { FINAL_KM_BOUNDARY_7383_ACTIVE, stagePlanFeaturesFromRaw, stagePlanSwitchNoteText, stagePlanSwitchNotes } from "./StagePlanModel.ts"; // #7383
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
function noteRoute(raw: { distance_km: number; finale_type?: string; climbs?: unknown[]; sectors?: unknown[]; profile_type?: string }) {
  const full = { profile_type: "mountain", ...raw };
  return { route: stagePlanRouteFromRaw(full), features: stagePlanFeaturesFromRaw(full) };
}
const ATTACK_LAST_10: StagePlanLeg[] = [{ task: "stay_sheltered" }, { task: "attack", from: { at: "final_km" } }];
const TEMPO_LAST_10: StagePlanLeg[] = [{ task: "shelter_leader" }, { task: "tempo", from: { at: "final_km" } }];

test("#7383: kontakten er taendt (ejer-go 31/10, samme kopi som motoren)", () => {
  assert.equal(FINAL_KM_BOUNDARY_7383_ACTIVE, true);
});

test("#7383: de sidste 10 km paa aaben vej giver ingen note", () => {
  const { route, features } = noteRoute({ distance_km: 150, climbs: [{ name: "A", crest_km: 60, length_km: 8, category: "2" }] });
  assert.deepEqual(stagePlanSwitchNotes(ATTACK_LAST_10, route, features), []);
  assert.deepEqual(stagePlanSwitchNotes(TEMPO_LAST_10, route, features), []);
});

test("#7383: de sidste 10 km inde i slutstigningen: foden for holdarbejde, finalen for angrebet (anden halvdel)", () => {
  const { route, features } = noteRoute({ distance_km: 140, climbs: [{ name: "Top", crest_km: 140, length_km: 25, category: "1", summit_finish: true }] });
  assert.deepEqual(stagePlanSwitchNotes(ATTACK_LAST_10, route, features, false), [{ kind: "feature", leg: 1, feature: "climb", place: "finale" }]);
  assert.deepEqual(stagePlanSwitchNotes(TEMPO_LAST_10, route, features, false), [{ kind: "feature", leg: 1, feature: "climb", place: "start" }]);
  assert.deepEqual(stagePlanSwitchNotes(ATTACK_LAST_10, route, features, true), [], "kontakten deler stigningen");
});

test("#7383: en stigning foer maal: naermeste ende (foden eller toppen)", () => {
  const foot = noteRoute({ distance_km: 150, climbs: [{ name: "A", crest_km: 146, length_km: 10, category: "2" }] });
  assert.deepEqual(stagePlanSwitchNotes(ATTACK_LAST_10, foot.route, foot.features, false).map((n) => n.kind === "feature" && n.place), ["start"]);
  const top = noteRoute({ distance_km: 150, climbs: [{ name: "A", crest_km: 144, length_km: 10, category: "2" }] });
  assert.deepEqual(stagePlanSwitchNotes(ATTACK_LAST_10, top.route, top.features, false).map((n) => n.kind === "feature" && n.place), ["end"]);
});

test("#7383: en sektor taeller som eet stykke", () => {
  const { route, features } = noteRoute({ distance_km: 150, profile_type: "cobbles", sectors: [{ name: "S", kind: "cobbles", start_km: 138, length_km: 4 }] });
  assert.deepEqual(stagePlanSwitchNotes(ATTACK_LAST_10, route, features, false), [{ kind: "feature", leg: 1, feature: "sector", place: "start" }]);
  assert.deepEqual(stagePlanSwitchNotes(ATTACK_LAST_10, route, features, true), []);
});

test("#7383: nedkoerselsfinalen: to skift paa samme sted, og noten bliver staaende med kontakten", () => {
  const { route, features } = noteRoute({ distance_km: 150, finale_type: "descent", climbs: [{ name: "A", crest_km: 135, length_km: 12, category: "1" }] });
  assert.deepEqual(features.map((f) => [f.kind, f.from_km, f.to_km]), [["climb", 123, 135], ["descent", 135, 150]]);
  const legs: StagePlanLeg[] = [{ task: "stay_sheltered" }, { task: "follow_moves", from: { at: "kom", kom_index: 0 } }, { task: "attack", from: { at: "final_km" } }];
  const expected = [{ kind: "feature", leg: 2, feature: "descent", place: "start" }, { kind: "same_point", leg: 1, next: 2 }];
  assert.deepEqual(stagePlanSwitchNotes(legs, route, features), expected);
  assert.deepEqual(stagePlanSwitchNotes(legs, route, features, true), expected, "nedkoerslen deles aldrig");
});

test("#7383 (Codex-review): overlappende stigning og sektor loeses som rutegeneratoren", () => {
  const { route, features } = noteRoute({ distance_km: 150, climbs: [{ name: "A", crest_km: 139, length_km: 9, category: "3" }], sectors: [{ name: "S", start_km: 134, length_km: 11 }] });
  assert.deepEqual(features.map((f) => [f.kind, f.from_km, f.to_km]), [["climb", 130, 139], ["sector", 139, 145]]);
  assert.deepEqual(stagePlanSwitchNotes(ATTACK_LAST_10, route, features, false), [{ kind: "feature", leg: 1, feature: "sector", place: "start" }], "starter ved 139 som motoren");
});

test("#7383: notens tekst findes paa alle sprog", () => {
  const notes = [
    ...(["climb", "sector", "descent"] as const).flatMap((feature) => (["start", "end", "finale"] as const).map((place) => ({ kind: "feature" as const, leg: 1, feature, place }))),
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
