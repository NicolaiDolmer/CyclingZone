import test from "node:test";
import assert from "node:assert/strict";
import { stageOrdersRecap, type TeamOrdersContext } from "./stageOrdersRecap.ts";

// fetchTeamOrders-formen for et hold: kaptajn, jaeger, hjaelper, sprintkaptajn.
const CONTEXT: TeamOrdersContext = {
  riders: [
    { rider_id: "cap", race_role: "captain" },
    { rider_id: "hun", race_role: "hunter" },
    { rider_id: "hel", race_role: "helper" },
    { rider_id: "spr", race_role: "sprint_captain" },
  ],
  defaultOrder: {
    breakaway_stance: "neutral",
    riders: [
      { rider_id: "cap", effort: "normal", try_break: false, leadout: false },
      { rider_id: "hun", effort: "normal", try_break: true, leadout: false },
      { rider_id: "hel", effort: "normal", try_break: false, leadout: true },
      { rider_id: "spr", effort: "normal", try_break: false, leadout: false },
    ],
  },
  sprintTrainFlatOnly: false,
  orders: [
    { stage_number: 3, breakaway_stance: "chase", locked_at: "2026-10-20T10:00:00Z", riders: [
      { rider_id: "cap", effort: "protect", try_break: true, leadout: false },
      { rider_id: "hun", effort: "normal", try_break: false, leadout: false },
    ] },
  ],
};

const NAMES: Record<string, string> = { cap: "Alpha", hun: "Bravo", hel: "Charlie", spr: "Delta" };
const nameOf = (id: string) => NAMES[id] ?? null;

test("gemt etape-ordre: lagt oven paa rollens standard, rolle-raekkefoelge og holdets holdning", () => {
  const recap = stageOrdersRecap({ context: CONTEXT, stageNumber: 3, riderIds: ["hel", "hun", "cap"], nameOf });
  assert.equal(recap?.stance, "chase");
  assert.equal(recap?.saved, true);
  assert.deepEqual(recap?.riders, [
    { riderId: "cap", name: "Alpha", role: "captain", effort: "protect", plan: null, tryBreak: true, leadout: false, roleDefault: false },
    { riderId: "hun", name: "Bravo", role: "hunter", effort: "normal", plan: null, tryBreak: false, leadout: false, roleDefault: false },
    { riderId: "hel", name: "Charlie", role: "helper", effort: "normal", plan: null, tryBreak: false, leadout: true, roleDefault: false },
  ]);
});

test("ingen gemt ordre = rollernes standard (T4)", () => {
  const recap = stageOrdersRecap({ context: CONTEXT, stageNumber: 2, riderIds: ["hun"], nameOf });
  assert.equal(recap?.saved, false);
  // Motoren valgte selv holdningen (humanDefaultOrderV3 kan jagte): fladen siger "auto", ikke "neutral".
  assert.equal(recap?.stance, "auto");
  assert.deepEqual(recap?.riders[0], { riderId: "hun", name: "Bravo", role: "hunter", effort: "normal", plan: null, tryBreak: true, leadout: false, roleDefault: false });
});

test("toget er kun standard paa en flad etape naar loebets revision siger det (#6462)", () => {
  const ctx = { ...CONTEXT, sprintTrainFlatOnly: true };
  assert.equal(stageOrdersRecap({ context: ctx, stageNumber: 2, riderIds: ["hel"], profileType: "mountain" })?.riders[0].leadout, false);
  assert.equal(stageOrdersRecap({ context: ctx, stageNumber: 2, riderIds: ["hel"], profileType: "flat" })?.riders[0].leadout, true);
});

test("etapens rolle-override vinder over holdudtagelsen; stage-roles-indsats er fallback", () => {
  const recap = stageOrdersRecap({
    context: CONTEXT, stageNumber: 2, riderIds: ["hel"],
    stageRoles: { overrides: [{ stage_number: 2, rider_id: "hel", race_role: "hunter", effort: "save" }] },
  });
  assert.equal(recap?.riders[0].role, "hunter");
  assert.equal(recap?.riders[0].effort, "save");
  // Hjaelperens tog-standard gaelder ikke laengere; den nye rolles standard kender fladen ikke.
  assert.equal(recap?.riders[0].leadout, false);
  assert.equal(recap?.riders[0].tryBreak, false);
  assert.equal(recap?.riders[0].roleDefault, true);
});

test("rolle-override med gemt valg viser det gemte valg", () => {
  const ctx = { ...CONTEXT, orders: [{ stage_number: 2, breakaway_stance: "let_go", riders: [{ rider_id: "hel", try_break: true, leadout: false }] }] };
  const recap = stageOrdersRecap({
    context: ctx, stageNumber: 2, riderIds: ["hel"],
    stageRoles: { overrides: [{ stage_number: 2, rider_id: "hel", race_role: "hunter" }] },
  });
  assert.equal(recap?.stance, "let_go");
  assert.equal(recap?.riders[0].tryBreak, true);
  assert.equal(recap?.riders[0].leadout, false);
  assert.equal(recap?.riders[0].roleDefault, false);
});

test("#7333: en rytter med etapeplan viser planens opgaver, ikke foerste leds indsats", () => {
  const ctx = { ...CONTEXT, orders: [{ stage_number: 2, breakaway_stance: "neutral", riders: [
    { rider_id: "cap", effort: "save", plan: [{ task: "stay_sheltered" }, { task: "follow_moves", from: { at: "final_km" } }] },
  ] }] };
  const recap = stageOrdersRecap({ context: ctx, stageNumber: 2, riderIds: ["cap"], nameOf });
  assert.deepEqual(recap?.riders[0].plan, ["stay_sheltered", "follow_moves"]);
  assert.notEqual(recap?.riders[0].effort, "save", "aldrig 'Spar' som hele dagens ordre");
});

test("uden svar eller uden ryttere vises intet", () => {
  assert.equal(stageOrdersRecap({ context: null, stageNumber: 1 }), null);
  assert.equal(stageOrdersRecap({ context: { riders: [] }, stageNumber: 1 }), null);
});
