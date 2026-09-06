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
