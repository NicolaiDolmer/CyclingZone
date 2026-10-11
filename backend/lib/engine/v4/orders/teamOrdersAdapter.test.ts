// Tests for teamOrdersAdapter (#4030/#3855/#4246) — roller + DB-raekker →
// StageInput.orders.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rowToStageOverlay,
  rosterByTeam,
  teamOrderFor,
  toEngineTeamOrder,
  toEngineLeadoutOrder,
  buildStageOrders,
  buildStageOrderPlan,
} from "./teamOrdersAdapter.ts";
import { validateTeamOrder } from "../ai/teamOrderContract.ts";
import { parseBreakawayOrders } from "../mechanics/breakaway.ts";
import { parseLeadoutOrders } from "../mechanics/leadout.ts";
import type { TeamOrder as EngineTeamOrder } from "../types.ts";

/** Ét realistisk hold: kaptajn, spurt-kaptajn, jaeger, to hjaelpere, én fri. */
const ROSTER = [
  { team_id: "t1", rider_id: "cap", role: "captain" },
  { team_id: "t1", rider_id: "spr", role: "sprint_captain" },
  { team_id: "t1", rider_id: "hun", role: "hunter" },
  { team_id: "t1", rider_id: "hlp1", role: "helper" },
  { team_id: "t1", rider_id: "hlp2", role: "helper" },
  { team_id: "t1", rider_id: "fri", role: "free_role" },
];

function params(order: EngineTeamOrder) {
  return order.params as { breakaway_stance: string; riders: Array<Record<string, unknown>> };
}

// ── Rollen ER standardordren (#4246, ejer 2/9) ───────────────────────────────

test("#4246: rollen bliver standardordren — jaegeren proever udbruddet uden at spilleren roerer noget", () => {
  const [order] = buildStageOrders({ rows: [], stageNumber: 1, roster: ROSTER });
  const byRider = new Map(params(order).riders.map((r) => [r.rider_id as string, r]));
  assert.equal(byRider.get("hun")!.try_break, true, "hunter = try_break");
  assert.equal(byRider.get("cap")!.try_break, false, "kaptajnen er beskyttet, ikke udbrudsrytter");
  assert.equal(byRider.get("spr")!.try_break, false);
  assert.equal(byRider.get("fri")!.try_break, false);
});

test("#4246: hjaelpere koerer spurt-kaptajnens tog som standard; kaptajnen og maalet selv goer ikke", () => {
  const [order] = buildStageOrders({ rows: [], stageNumber: 1, roster: ROSTER });
  const byRider = new Map(params(order).riders.map((r) => [r.rider_id as string, r]));
  assert.equal(byRider.get("hlp1")!.leadout, true);
  assert.equal(byRider.get("hlp2")!.leadout, true);
  assert.equal(byRider.get("spr")!.leadout, false, "togets maal koerer ikke i sit eget tog");
  assert.equal(byRider.get("cap")!.leadout, false);
  assert.equal(byRider.get("hun")!.leadout, false);
});

test("#4246: uden spurt-kaptajn har hjaelperne intet tog at koere i (M6 har intet maal)", () => {
  const roster = ROSTER.filter((r) => r.role !== "sprint_captain");
  const orders = buildStageOrders({ rows: [], stageNumber: 1, roster });
  assert.equal(orders.length, 1, "ingen leadout-ordre uden et maal");
  const byRider = new Map(params(orders[0]).riders.map((r) => [r.rider_id as string, r]));
  assert.equal(byRider.get("hlp1")!.leadout, false);
});

test("standardordren giver ALDRIG en dyrere indsats end normal (aldrig gratis alt-ud)", () => {
  const [order] = buildStageOrders({ rows: [], stageNumber: 1, roster: ROSTER });
  for (const rider of params(order).riders) {
    assert.equal(rider.effort, "normal", `${rider.rider_id} skal staa paa rollens standard`);
  }
});

test("ukendt/manglende rolle falder til free_role, aldrig et kast", () => {
  const orders = buildStageOrders({
    rows: [],
    stageNumber: 1,
    roster: [
      { team_id: "t1", rider_id: "a", role: "chef" },
      { team_id: "t1", rider_id: "b", role: null },
      { team_id: "t1", rider_id: "c" },
    ],
  });
  assert.equal(orders.length, 1);
  for (const rider of params(orders[0]).riders) {
    assert.equal(rider.try_break, false);
    assert.equal(rider.leadout, false);
  }
});

// ── Taktik-kortet er dagens overlay ──────────────────────────────────────────

test("#4246: etapens raekke er et OVERLAY paa rollen — ikke en erstatning", () => {
  const rows = [{
    team_id: "t1",
    stage_number: 2,
    breakaway_stance: "chase",
    // Kun to ryttere naevnes; resten skal beholde rollens standard.
    riders: [
      { rider_id: "hun", try_break: false }, // jaegeren bliver i feltet i dag
      { rider_id: "cap", effort: "all_out" },
    ],
  }];
  const [order] = buildStageOrders({ rows, stageNumber: 2, roster: ROSTER });
  const byRider = new Map(params(order).riders.map((r) => [r.rider_id as string, r]));
  assert.equal(params(order).breakaway_stance, "chase");
  assert.equal(byRider.get("hun")!.try_break, false, "overlayet vinder for dagen");
  assert.equal(byRider.get("cap")!.effort, "all_out");
  assert.equal(byRider.get("hlp1")!.leadout, true, "urort rytter beholder rollens standard");
  assert.equal(byRider.get("hlp1")!.effort, "normal");
});

test("#4246: overlayet kan hverken tilfoeje eller fjerne ryttere (rollen ejer startlisten)", () => {
  const rows = [{
    team_id: "t1",
    stage_number: 1,
    riders: [{ rider_id: "ikke-udtaget", try_break: true }],
  }];
  const [order] = buildStageOrders({ rows, stageNumber: 1, roster: ROSTER });
  const ids = params(order).riders.map((r) => r.rider_id);
  assert.deepEqual(ids, ROSTER.map((r) => r.rider_id));
});

test("#4246: race_role i en gammel raekke ignoreres — rollen kommer fra holdudtagelsen", () => {
  const rows = [{
    team_id: "t1",
    stage_number: 1,
    riders: [{ rider_id: "cap", race_role: "hunter", effort: "normal", try_break: false }],
  }];
  const [order] = buildStageOrders({ rows, stageNumber: 1, roster: ROSTER });
  const cap = params(order).riders.find((r) => r.rider_id === "cap")!;
  assert.equal(cap.try_break, false, "en raekke kan ikke goere kaptajnen til jaeger");
  assert.ok(!("race_role" in cap), "rollen findes ikke i motorens ordre");
});

test("rowToStageOverlay: defensiv mod jsonb-drift — ulaeselige felter falder til rollens standard", () => {
  const overlay = rowToStageOverlay({
    team_id: "t1",
    stage_number: 1,
    breakaway_stance: "ATTACK!!",
    riders: [
      null,
      42,
      { race_role: "helper" }, // mangler rider_id → droppes
      { rider_id: "hun", effort: "turbo", try_break: "ja", leadout: "ja" },
    ] as unknown[],
  });
  assert.equal(overlay.breakaway_stance, undefined, "ukendt stance = ikke valgt");
  assert.deepEqual(overlay.riders, [{ rider_id: "hun" }]);
  // …og den korrupte raekke maa ikke kunne aflyse rollens standard:
  const [order] = buildStageOrders({
    rows: [{ team_id: "t1", stage_number: 1, breakaway_stance: "ATTACK!!", riders: [{ rider_id: "hun", try_break: "ja" }] as unknown[] }],
    stageNumber: 1,
    roster: ROSTER,
  });
  assert.equal(params(order).breakaway_stance, "neutral");
  assert.equal(params(order).riders.find((r) => r.rider_id === "hun")!.try_break, true);
});

// ── Sprint-toget som ordre (#4246 b) ─────────────────────────────────────────

test("#4246: spilleren kan saette sit sprint-tog — leadout-ordren afledes af ordren + rollen", () => {
  const rows = [{
    team_id: "t1",
    stage_number: 1,
    riders: [
      { rider_id: "hlp1", leadout: true },
      { rider_id: "hlp2", leadout: false }, // taget UD af toget i dag
      { rider_id: "fri", leadout: true }, // sat IND i toget i dag
    ],
  }];
  const orders = buildStageOrders({ rows, stageNumber: 1, roster: ROSTER });
  const leadout = orders.find((o) => o.kind === "leadout")!;
  assert.ok(leadout, "leadout-ordre findes");
  assert.deepEqual(leadout.params, { captain_rider_id: "spr", leadout_rider_ids: ["hlp1", "fri"] });
});

test("toEngineLeadoutOrder: intet tog uden mandskab, og maalet kan aldrig vaere sit eget tog", () => {
  const roster = [
    { rider_id: "spr", role: "sprint_captain" as const },
    { rider_id: "hlp1", role: "helper" as const },
  ];
  const empty = toEngineLeadoutOrder(
    { team_id: "t1", breakaway_stance: "neutral", riders: [{ rider_id: "hlp1", effort: "normal", try_break: false, leadout: false }] },
    roster,
  );
  assert.equal(empty, null);
  const selfOnly = toEngineLeadoutOrder(
    { team_id: "t1", breakaway_stance: "neutral", riders: [{ rider_id: "spr", effort: "normal", try_break: false, leadout: true }] },
    roster,
  );
  assert.equal(selfOnly, null, "spurt-kaptajnen alene er ikke et tog");
});

// ── Kaeden ind i mekanikkerne ────────────────────────────────────────────────

test("#4246: adapterens output parses af BEGGE mekanikker (M5 udbrud + M6 tog)", () => {
  const orders = buildStageOrders({ rows: [], stageNumber: 1, roster: ROSTER });
  const breakaway = parseBreakawayOrders(orders);
  assert.equal(breakaway.length, 1);
  assert.deepEqual(
    breakaway[0].riders.filter((r) => r.try_break).map((r) => r.rider_id),
    ["hun"],
  );
  const leadout = parseLeadoutOrders(orders);
  assert.equal(leadout.length, 1);
  assert.equal(leadout[0].captain_rider_id, "spr");
  assert.deepEqual(leadout[0].leadout_rider_ids, ["hlp1", "hlp2"]);
});

test("#4246: adapterens holdordre bestaar motorens EGEN kontrakt (ingen fjerde kopi)", () => {
  const order = teamOrderFor("t1", rosterByTeam(ROSTER).get("t1")!, {
    team_id: "t1",
    stage_number: 1,
    breakaway_stance: "let_go",
    riders: [{ rider_id: "cap", race_role: "hunter", effort: "save", try_break: true }],
  });
  assert.deepEqual(validateTeamOrder(order), { ok: true }, JSON.stringify(order));
});

// ── Determinisme + afgraensning ──────────────────────────────────────────────

test("buildStageOrders: etape-filter, ukendte hold droppes, hold uden raekke faar rollernes standard", () => {
  const rows = [
    { team_id: "t1", stage_number: 2, breakaway_stance: "chase", riders: [] },
    { team_id: "t1", stage_number: 3, breakaway_stance: "let_go", riders: [] }, // anden etape → ignoreres
    { team_id: "ukendt", stage_number: 2, breakaway_stance: "chase", riders: [] }, // ikke i startlisten
  ];
  const roster = [
    ...ROSTER,
    { team_id: "t2", rider_id: "x", role: "free_role" },
  ];
  const orders = buildStageOrders({ rows, stageNumber: 2, roster });
  const tactics = orders.filter((o) => o.kind === "team_tactics");
  assert.deepEqual(tactics.map((o) => o.team_id), ["t1", "t2"]);
  assert.equal(params(tactics[0]).breakaway_stance, "chase");
  assert.equal(params(tactics[1]).breakaway_stance, "neutral");
});

test("buildStageOrders: deterministisk orden (team_id stigende, tactics foer leadout)", () => {
  const roster = [
    { team_id: "b", rider_id: "b1", role: "sprint_captain" },
    { team_id: "b", rider_id: "b2", role: "helper" },
    { team_id: "a", rider_id: "a1", role: "captain" },
  ];
  const orders = buildStageOrders({ rows: [], stageNumber: 1, roster });
  assert.deepEqual(
    orders.map((o) => `${o.team_id}:${o.kind}`),
    ["a:team_tactics", "b:team_tactics", "b:leadout"],
  );
});

test("toEngineTeamOrder: pakker T3-formen i konvolutten (kind=team_tactics)", () => {
  const eng = toEngineTeamOrder({ team_id: "t1", breakaway_stance: "neutral", riders: [] });
  assert.equal(eng.team_id, "t1");
  assert.equal(eng.kind, "team_tactics");
  assert.deepEqual(eng.params, { breakaway_stance: "neutral", riders: [] });
});

test("rosterByTeam: hold-loese ryttere droppes, holdorden er deterministisk", () => {
  const grouped = rosterByTeam([
    { team_id: "b", rider_id: "b1", role: "captain" },
    { team_id: null as unknown as string, rider_id: "loes", role: "captain" },
    { team_id: "a", rider_id: "a1", role: "captain" },
  ]);
  assert.deepEqual([...grouped.keys()], ["a", "b"]);
});

// ── #5571: AI-holdene faar M14 gennem samme TeamOrder-type ───────────────────

function ab(overrides: Record<string, number> = {}) {
  return { climbing: 20, sprint: 20, aggression: 20, tempo: 20, punch: 20, time_trial: 20, cobblestone: 20, ...overrides };
}

/**
 * To hold med SAMME trup: "ai" (AI-styret) og "hum" (menneske). Holdenes
 * kaptajn er feltets bedste klatrer, sprint-kaptajnen feltets bedste sprinter.
 */
function mixedField() {
  const team = (teamId: string, isAi: boolean) => [
    { team_id: teamId, rider_id: `${teamId}-cap`, role: "captain", is_ai: isAi, abilities: ab({ climbing: 60 }) },
    { team_id: teamId, rider_id: `${teamId}-spr`, role: "sprint_captain", is_ai: isAi, abilities: ab({ sprint: 60, climbing: 10 }) },
    { team_id: teamId, rider_id: `${teamId}-train`, role: "helper", is_ai: isAi, abilities: ab({ sprint: 40, climbing: 15 }) },
    { team_id: teamId, rider_id: `${teamId}-dom`, role: "helper", is_ai: isAi, abilities: ab({ climbing: 45, sprint: 10 }) },
    { team_id: teamId, rider_id: `${teamId}-hun`, role: "hunter", is_ai: isAi, abilities: ab({ aggression: 50 }) },
  ];
  const others = Array.from({ length: 20 }, (_, i) => ({
    team_id: `o${String(i).padStart(2, "0")}`,
    rider_id: `o${i}`,
    role: "free_role",
    abilities: ab({ climbing: 5 + i, sprint: 5 + i }),
  }));
  return [...team("ai", true), ...team("hum", false), ...others];
}

const MOUNTAIN_CTX = { route: { profile_type: "mountain" as const, finale_type: "long_climb" as const } };

test("#5571: et AI-hold faar M14's ordre — jagt, beskyttet kaptajn, hjaelper ved kaptajnen", () => {
  const plan = buildStageOrderPlan({ rows: [], stageNumber: 1, roster: mixedField(), context: MOUNTAIN_CTX });
  const ai = plan.orders.find((o) => o.team_id === "ai" && o.kind === "team_tactics")!;
  assert.equal(params(ai).breakaway_stance, "chase");
  const byRider = new Map(params(ai).riders.map((r) => [r.rider_id as string, r]));
  assert.equal(byRider.get("ai-cap")!.effort, "normal"); // #6055: kaptajnen gemmer sig til finalen
  assert.equal(byRider.get("ai-dom")!.effort, "protect");
  assert.equal(plan.aiEffortByRider.get("ai-cap"), "normal");
});

test("#5571: aldrig autopilot for mennesker — et menneskehold beholder rollernes standard", () => {
  const plan = buildStageOrderPlan({ rows: [], stageNumber: 1, roster: mixedField(), context: MOUNTAIN_CTX });
  const hum = plan.orders.find((o) => o.team_id === "hum" && o.kind === "team_tactics")!;
  const humanDefault = buildStageOrders({
    rows: [],
    stageNumber: 1,
    roster: mixedField().filter((r) => r.team_id === "hum"),
  })[0];
  assert.deepEqual(params(hum), params(humanDefault));
  for (const riderId of plan.aiEffortByRider.keys()) {
    assert.ok(riderId.startsWith("ai-"), `${riderId} er ikke et AI-holds rytter`);
  }
  assert.equal(plan.aiEffortByRider.size, 5);
});

test("#5571: uden rute-kontekst falder AI-holdet tilbage paa rollernes standard (T4)", () => {
  const plan = buildStageOrderPlan({ rows: [], stageNumber: 1, roster: mixedField() });
  const ai = plan.orders.find((o) => o.team_id === "ai" && o.kind === "team_tactics")!;
  assert.equal(params(ai).breakaway_stance, "neutral");
  assert.equal(plan.aiEffortByRider.size, 0);
  assert.deepEqual(buildStageOrders({ rows: [], stageNumber: 1, roster: mixedField() }), plan.orders);
});

test("#5571: en gemt raekke er stadig et overlay oven paa AI'ens ordre", () => {
  const rows = [{ team_id: "ai", stage_number: 1, breakaway_stance: "let_go", riders: [{ rider_id: "ai-cap", effort: "save" }] }];
  const plan = buildStageOrderPlan({ rows, stageNumber: 1, roster: mixedField(), context: MOUNTAIN_CTX });
  const ai = plan.orders.find((o) => o.team_id === "ai" && o.kind === "team_tactics")!;
  assert.equal(params(ai).breakaway_stance, "let_go");
  assert.equal(plan.aiEffortByRider.get("ai-cap"), "save");
  // Resten af AI'ens beslutning staar urort.
  assert.equal(plan.aiEffortByRider.get("ai-dom"), "protect");
});

test("#5571: etapeloeb i bjergene — AI-sprinterne koerer grupetto og er ude af toget", () => {
  const context = {
    ...MOUNTAIN_CTX,
    race: { is_stage_race: true, later_stages: [{ profile_type: "flat" as const, finale_type: "bunch_sprint" as const }] },
  };
  const plan = buildStageOrderPlan({ rows: [], stageNumber: 1, roster: mixedField(), context });
  assert.equal(plan.aiEffortByRider.get("ai-spr"), "grupetto");
  assert.equal(plan.aiEffortByRider.get("ai-train"), "grupetto");
  // Sidste bjergetape i loebet: kaptajnen gemmer sig til finalen (#6055).
  assert.equal(plan.aiEffortByRider.get("ai-cap"), "normal");
  const aiTrain = plan.orders.find((o) => o.team_id === "ai" && o.kind === "leadout");
  assert.deepEqual(aiTrain?.params?.leadout_rider_ids, ["ai-dom"]);
  // Hele planen bestaar motorens egne parsere + kontrakten.
  for (const o of plan.orders.filter((x) => x.kind === "team_tactics")) {
    assert.deepEqual(
      validateTeamOrder({ team_id: o.team_id, breakaway_stance: params(o).breakaway_stance, riders: params(o).riders }),
      { ok: true },
    );
  }
  assert.equal(parseBreakawayOrders(plan.orders).length, plan.orders.filter((x) => x.kind === "team_tactics").length);
  assert.ok(parseLeadoutOrders(plan.orders).length >= 1);
});

// ── #6097: regel-revisionen naar M14 kun under orders_gc_v2 ─────────────────

/** Et svagt AI-hold (kaptajnen er outsider -> let_go) i et felt af staerkere klatrere. */
function weakAiField() {
  const ai = [
    { team_id: "ai", rider_id: "ai-cap", role: "captain", is_ai: true, abilities: ab({ climbing: 10 }) },
    { team_id: "ai", rider_id: "ai-dom", role: "helper", is_ai: true, abilities: ab({ climbing: 40, aggression: 60 }) },
    { team_id: "ai", rider_id: "ai-dom2", role: "helper", is_ai: true, abilities: ab({ climbing: 30, aggression: 30 }) },
  ];
  const others = Array.from({ length: 30 }, (_, i) => ({
    team_id: `o${String(i).padStart(2, "0")}`,
    rider_id: `o${i}`,
    role: "captain",
    abilities: ab({ climbing: 30 + i, aggression: 10 }),
  }));
  return [...ai, ...others];
}

function aiTryBreak(plan: ReturnType<typeof buildStageOrderPlan>) {
  const ai = plan.orders.find((o) => o.team_id === "ai" && o.kind === "team_tactics")!;
  return params(ai).riders.filter((r) => r.try_break === true).map((r) => r.rider_id as string);
}

test("#6097: under orders_gc_v2 sender et let_go-AI-hold sin bedste hjaelper i udbruddet", () => {
  const plan = buildStageOrderPlan({ rows: [], stageNumber: 1, roster: weakAiField(), context: { ...MOUNTAIN_CTX, rules_revision: "orders_gc_v2" } });
  assert.deepEqual(aiTryBreak(plan), ["ai-dom"]);
});

test("#6097: uden revision eller under orders_gc_v1 er AI-ordren uaendret", () => {
  const without = buildStageOrderPlan({ rows: [], stageNumber: 1, roster: weakAiField(), context: MOUNTAIN_CTX });
  assert.deepEqual(aiTryBreak(without), []);
  const v1 = buildStageOrderPlan({ rows: [], stageNumber: 1, roster: weakAiField(), context: { ...MOUNTAIN_CTX, rules_revision: "orders_gc_v1" } });
  assert.deepEqual(v1, without);
});

test("#6097: menneskeholdenes ordrer roeres ikke af orders_gc_v2", () => {
  const ctx = { ...MOUNTAIN_CTX, rules_revision: "orders_gc_v2" };
  const v2 = buildStageOrderPlan({ rows: [], stageNumber: 1, roster: mixedField(), context: ctx });
  const before = buildStageOrderPlan({ rows: [], stageNumber: 1, roster: mixedField(), context: MOUNTAIN_CTX });
  assert.deepEqual(v2.orders.filter((o) => o.team_id !== "ai"), before.orders.filter((o) => o.team_id !== "ai"));
});

// ── #6434 (KUN official_times_v3): sprintertoget forbundet i adapteren ────────
//
// sprintTrainLeadoutOrder (#6352) kaldes nu her for alle hold (menneske og AI):
// en kaptajn med sprinterprofil paa en flad etape faar holdets hjaelpere som tog.
// Aeldre revisioner (og intet kontekst-objekt) bruger den gamle regel, uaendret.

import { simulateStageV4 } from "../index.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import type { RouteV2 } from "../types.ts";

const FLAT_6434: RouteV2 = {
  distance_km: 178,
  profile_type: "flat",
  finale_type: "bunch_sprint",
  segments: [
    { kind: "flat", from_km: 0, to_km: 95 },
    { kind: "flat", from_km: 95, to_km: 165 },
    { kind: "flat", from_km: 165, to_km: 178 },
  ],
  weather: { kind: "sun", wind_exposure: 0.1 },
  waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 178 }],
};

const ABILITY_KEYS_6434 = ["flat", "climbing", "sprint", "time_trial", "punch", "cobblestone", "endurance", "tempo", "acceleration", "positioning", "recovery", "descending", "aggression", "tactics", "teamwork", "leadership"];
function abil6434(over: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of ABILITY_KEYS_6434) out[k] = 55;
  return { ...out, ...over };
}

/** Ti menneskehold a seks: kaptajnen er holdets sprinter (faldende spurt), fem hjaelpere. */
function roster6434(leaderRole: "captain" | "sprint_captain" = "captain") {
  const list: Array<{ team_id: string; rider_id: string; role: string; is_ai: boolean; abilities: Record<string, number> }> = [];
  for (let t = 0; t < 10; t++) {
    const sprint = 90 - t * 2;
    list.push({ team_id: `team-${t}`, rider_id: `s${t}`, role: t === 4 ? leaderRole : "captain", is_ai: false, abilities: abil6434({ sprint, acceleration: sprint - 4, flat: 72, positioning: 70, climbing: 50 }) });
    for (let h = 0; h < 5; h++) {
      list.push({ team_id: `team-${t}`, rider_id: `h${t}-${h}`, role: "helper", is_ai: false, abilities: abil6434({ flat: 70, tempo: 72, positioning: 66, acceleration: 62, sprint: 58, climbing: 40 }) });
    }
  }
  return list;
}

const plan6434 = (rules_revision: string, profile_type: RouteV2["profile_type"] = "flat", roster = roster6434()) => buildStageOrderPlan({
  rows: [], stageNumber: 1, roster,
  context: { route: { profile_type, finale_type: profile_type === "flat" ? "bunch_sprint" : "long_climb" }, race: { is_stage_race: false, later_stages: [] }, rules_revision },
});

test("#6434 v3: et menneskehold hvis kaptajn er sprinteren faar et tog i et fladt endagsloeb", () => {
  const train = parseLeadoutOrders(plan6434("official_times_v3").orders).find((o) => o.team_id === "team-4");
  assert.ok(train, "toget dannes for kaptajnen");
  assert.equal(train.captain_rider_id, "s4");
  assert.deepEqual([...train.leadout_rider_ids].sort(), ["h4-0", "h4-1", "h4-2", "h4-3", "h4-4"]);
});

test("#6434: official_times_v2 og uden kontekst - ingen ny tog-regel (byte-identiske ordrer)", () => {
  assert.equal(parseLeadoutOrders(plan6434("official_times_v2").orders).length, 0);
  const noContext = buildStageOrderPlan({ rows: [], stageNumber: 1, roster: roster6434() });
  assert.equal(parseLeadoutOrders(noContext.orders).length, 0);
});

test("#6434 v3: en sprint_captain faar samme tog som under v2; ingen tog paa en bjergetape", () => {
  const sc = roster6434("sprint_captain");
  // Kun toget sammenlignes: stancen er #6441's v3-standard (se testene nedenfor).
  const team4 = (rev: string) => plan6434(rev, "flat", sc).orders.filter((o) => o.team_id === "team-4" && o.kind === "leadout");
  assert.equal(team4("official_times_v3").length, 1);
  assert.deepEqual(team4("official_times_v3"), team4("official_times_v2"));
  assert.equal(parseLeadoutOrders(plan6434("official_times_v3", "mountain").orders).length, 0);
});

test("#6434 v3: i et helt fladt endagsloeb koerer toget kaptajnen frem (aldrig daarligere, bedre i mindst halvdelen af 12 seeds)", () => {
  const roster = roster6434();
  const startlist = roster.map((r) => ({ rider_id: r.rider_id, team_id: r.team_id, role: r.role, effort: "normal", condition: 1, abilities: r.abilities }));
  const place = (orders: EngineTeamOrder[], seed: string) => {
    const out = simulateStageV4({ route: FLAT_6434, startlist: startlist as never, orders, seed, tuning: RACE_V4_TUNING, rules_revision: "official_times_v3" });
    return out.results.findIndex((r) => r.rider_id === "s4") + 1;
  };
  const withTrain = plan6434("official_times_v3").orders;
  const withoutTrain = withTrain.filter((o) => !(o.kind === "leadout" && o.team_id === "team-4"));
  let better = 0;
  for (let i = 0; i < 12; i++) {
    const a = place(withTrain, `lo-6434-${i}`);
    const b = place(withoutTrain, `lo-6434-${i}`);
    assert.ok(a <= b, `seed ${i}: med tog ${a}, uden ${b}`);
    if (a < b) better++;
  }
  assert.ok(better >= 6, `toget flytter placeringen i ${better} af 12 seeds`);
});

test("#6434 v3 (review): managerens eksplicitte 'intet tog' for dagen respekteres for en sprinter-kaptajn", () => {
  const roster = roster6434();
  const row = { team_id: "team-4", stage_number: 1, breakaway_stance: null, riders: roster.filter((r) => r.team_id === "team-4").map((r) => ({ rider_id: r.rider_id, leadout: false })) };
  const plan = buildStageOrderPlan({
    rows: [row as never], stageNumber: 1, roster,
    context: { route: { profile_type: "flat", finale_type: "bunch_sprint" }, race: { is_stage_race: false, later_stages: [] }, rules_revision: "official_times_v3" },
  });
  assert.equal(parseLeadoutOrders(plan.orders).find((o) => o.team_id === "team-4"), undefined);
  // Andre hold uden raekke faar stadig toget.
  assert.ok(parseLeadoutOrders(plan.orders).find((o) => o.team_id === "team-3"));
});

// ── #6441 (KUN official_times_v3, ejer 10/10 kl. 22:40) ───────────────────────
//
// Et menneskehold uden egen udbrudsordre for etapen faar AI-holdenes stance-
// regel (decideAiBreakawayStance) for jagten: kaptajnen favorit -> chase, ellers
// neutral. Ejer 11/10 kl. 00:50: et menneskehold uden ordre lader ALDRIG selv et
// udbrud gaa (M14s let_go bliver neutral). En stance manageren har gemt, vinder altid.

/** Ti menneskehold a seks paa en bjergetape: hold 0-8 har faldende klatrekaptajner, hold 9 en svag. */
function mountainRoster6441(isAi = false) {
  const list: Array<{ team_id: string; rider_id: string; role: string; is_ai: boolean; abilities: Record<string, number> }> = [];
  for (let t = 0; t < 10; t++) {
    const climbing = t === 9 ? 30 : 90 - t * 2;
    list.push({ team_id: `t${t}`, rider_id: `c${t}`, role: "captain", is_ai: isAi, abilities: abil6434({ climbing }) });
    for (let h = 0; h < 5; h++) {
      list.push({ team_id: `t${t}`, rider_id: `h${t}-${h}`, role: h === 0 ? "hunter" : "helper", is_ai: isAi, abilities: abil6434({ climbing: 40 }) });
    }
  }
  return list;
}

const MOUNTAIN_V3 = { route: { profile_type: "mountain" as const, finale_type: "long_climb" as const }, race: { is_stage_race: true, later_stages: [] }, rules_revision: "official_times_v3" };
const stanceByTeam = (orders: EngineTeamOrder[]) =>
  Object.fromEntries(parseBreakawayOrders(orders).map((o) => [o.team_id, o.breakaway_stance]));

test("#6441 v3: menneskehold uden ordre: favorit jager, ellers neutral (aldrig let_go)", () => {
  const stances = stanceByTeam(buildStageOrderPlan({ rows: [], stageNumber: 1, roster: mountainRoster6441(), context: MOUNTAIN_V3 }).orders);
  assert.equal(stances.t0, "chase");
  assert.equal(stances.t7, "chase");
  assert.equal(stances.t8, "neutral");
  assert.equal(stances.t9, "neutral", "uden chance: neutral, ikke let_go (ejer 11/10)");
  assert.ok(!Object.values(stances).includes("let_go"));
});

test("#6441 v3: samme jagt-regel som et AI-hold; kun AI-holdet kan selv vaelge let_go", () => {
  const human = stanceByTeam(buildStageOrderPlan({ rows: [], stageNumber: 1, roster: mountainRoster6441(false), context: MOUNTAIN_V3 }).orders);
  const ai = stanceByTeam(buildStageOrderPlan({ rows: [], stageNumber: 1, roster: mountainRoster6441(true), context: MOUNTAIN_V3 }).orders);
  for (const team of Object.keys(ai)) {
    assert.equal(human[team], ai[team] === "let_go" ? "neutral" : ai[team], team);
  }
  assert.equal(ai.t9, "let_go", "AI-holdets egen beslutning er uaendret");
});

test("#6441 v3: kun stancen aendres; rytternes indsats, udbrudsforsoeg og tog er rollernes", () => {
  const plan = buildStageOrderPlan({ rows: [], stageNumber: 1, roster: mountainRoster6441(), context: MOUNTAIN_V3 });
  const v2 = buildStageOrderPlan({ rows: [], stageNumber: 1, roster: mountainRoster6441(), context: { ...MOUNTAIN_V3, rules_revision: "official_times_v2" } });
  // Hele rytter-ordren (indsats, udbrudsforsoeg, tog) + eventuelle tog-ordrer.
  const riders = (orders: EngineTeamOrder[]) => orders.map((o) => (o.kind === "team_tactics" ? o.params?.riders : o));
  assert.deepEqual(riders(plan.orders), riders(v2.orders));
  assert.equal(plan.aiEffortByRider.size, 0, "et menneskehold faar aldrig AI-indsats");
});

test("#6441 v3: en stance manageren selv har gemt for etapen vinder altid", () => {
  const rows = [
    { team_id: "t0", stage_number: 1, breakaway_stance: "let_go", riders: [] },
    { team_id: "t9", stage_number: 1, breakaway_stance: "neutral", riders: [] },
    { team_id: "t8", stage_number: 2, breakaway_stance: "let_go", riders: [] },
    { team_id: "t7", stage_number: 1, breakaway_stance: null, riders: [] },
  ];
  const stances = stanceByTeam(buildStageOrderPlan({ rows, stageNumber: 1, roster: mountainRoster6441(), context: MOUNTAIN_V3 }).orders);
  assert.equal(stances.t0, "let_go", "managerens let_go slaar favorit-jagten");
  assert.equal(stances.t9, "neutral", "managerens neutral staar");
  assert.equal(stances.t8, "neutral", "en raekke for en anden etape taeller ikke");
  assert.equal(stances.t7, "chase", "en raekke uden stance falder tilbage paa standarden");
});

test("#6441: official_times_v2, aeldre og uden kontekst er menneskeholdene neutrale (uaendret)", () => {
  for (const rules_revision of ["official_times_v2", "orders_gc_v3", "orders_gc_v2"]) {
    const stances = stanceByTeam(buildStageOrderPlan({ rows: [], stageNumber: 1, roster: mountainRoster6441(), context: { ...MOUNTAIN_V3, rules_revision } }).orders);
    assert.ok(Object.values(stances).every((s) => s === "neutral"), rules_revision);
  }
  const noCtx = stanceByTeam(buildStageOrderPlan({ rows: [], stageNumber: 1, roster: mountainRoster6441() }).orders);
  assert.ok(Object.values(noCtx).every((s) => s === "neutral"));
});

test("#6441 v3: et hold uden evner paa startlisten beholder den neutrale standard", () => {
  const roster = mountainRoster6441().map((r) => (r.team_id === "t0" ? { ...r, abilities: null } : r));
  const stances = stanceByTeam(buildStageOrderPlan({ rows: [], stageNumber: 1, roster: roster as never, context: MOUNTAIN_V3 }).orders);
  assert.equal(stances.t0, "neutral");
  assert.equal(stances.t1, "chase");
});
