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
    { riderId: "cap", name: "Alpha", role: "captain", effort: "protect", tryBreak: true, leadout: false },
    { riderId: "hun", name: "Bravo", role: "hunter", effort: "normal", tryBreak: false, leadout: false },
    { riderId: "hel", name: "Charlie", role: "helper", effort: "normal", tryBreak: false, leadout: true },
  ]);
});

test("ingen gemt ordre = rollernes standard (T4)", () => {
  const recap = stageOrdersRecap({ context: CONTEXT, stageNumber: 2, riderIds: ["hun"], nameOf });
  assert.equal(recap?.saved, false);
  assert.equal(recap?.stance, "neutral");
  assert.deepEqual(recap?.riders[0], { riderId: "hun", name: "Bravo", role: "hunter", effort: "normal", tryBreak: true, leadout: false });
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
});

test("uden svar eller uden ryttere vises intet", () => {
  assert.equal(stageOrdersRecap({ context: null, stageNumber: 1 }), null);
  assert.equal(stageOrdersRecap({ context: { riders: [] }, stageNumber: 1 }), null);
});
