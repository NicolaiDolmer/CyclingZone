import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultTeamOrder,
  mergeOrderWithRoster,
  stanceI18nKey,
  effortCounts,
  setRiderEffort,
  toggleTryBreak,
  setBreakawayStance,
  isOrderLocked,
  teamPlanKey,
  roleDefaultFor,
  riderIntentKeys,
  toggleLeadout,
  hasSprintCaptain,
} from "./tacticsPlan.js";

test("defaultTeamOrder — neutrale defaults for hver rytter (T4)", () => {
  const order = defaultTeamOrder(["r1", "r2"]);
  assert.equal(order.breakaway_stance, "neutral");
  assert.deepEqual(order.riders, [
    { rider_id: "r1", effort: "normal", try_break: false, leadout: false },
    { rider_id: "r2", effort: "normal", try_break: false, leadout: false },
  ]);
});

test("mergeOrderWithRoster — beholder kendte ordrer, tilføjer neutrale for nye ryttere", () => {
  const saved = { team_id: "t1", breakaway_stance: "chase", riders: [{ rider_id: "r1", effort: "protect", try_break: true }] };
  const merged = mergeOrderWithRoster(saved, ["r1", "r2"]);
  assert.equal(merged.breakaway_stance, "chase");
  assert.deepEqual(merged.riders, [
    { rider_id: "r1", effort: "protect", try_break: true, leadout: false },
    { rider_id: "r2", effort: "normal", try_break: false, leadout: false },
  ]);
});

test("mergeOrderWithRoster — dropper ryttere der ikke længere er i truppen", () => {
  const saved = { team_id: "t1", breakaway_stance: "neutral", riders: [{ rider_id: "r1", effort: "save", try_break: false }] };
  const merged = mergeOrderWithRoster(saved, ["r2"]);
  assert.equal(merged.riders.length, 1);
  assert.equal(merged.riders[0].rider_id, "r2");
});

test("stanceI18nKey — let_go mappes til letGo, resten uændret", () => {
  assert.equal(stanceI18nKey("let_go"), "letGo");
  assert.equal(stanceI18nKey("chase"), "chase");
  assert.equal(stanceI18nKey("neutral"), "neutral");
});

test("effortCounts — tæller pr. niveau", () => {
  const riders = [
    { rider_id: "a", effort: "protect" },
    { rider_id: "b", effort: "normal" },
    { rider_id: "c", effort: "normal" },
    { rider_id: "d", effort: "save" },
  ];
  assert.deepEqual(effortCounts(riders), { protect: 1, normal: 2, save: 1 });
});

test("setRiderEffort / toggleTryBreak / setBreakawayStance — muterer aldrig input", () => {
  const order = defaultTeamOrder(["r1", "r2"]);
  const withEffort = setRiderEffort(order, "r1", "protect");
  assert.equal(order.riders[0].effort, "normal", "originalen er urørt");
  assert.equal(withEffort.riders[0].effort, "protect");

  const withBreak = toggleTryBreak(withEffort, "r2");
  assert.equal(withBreak.riders[1].try_break, true);
  const toggledBack = toggleTryBreak(withBreak, "r2");
  assert.equal(toggledBack.riders[1].try_break, false);

  const withStance = setBreakawayStance(order, "let_go");
  assert.equal(withStance.breakaway_stance, "let_go");
  assert.equal(order.breakaway_stance, "neutral", "originalen er urørt");
});

test("isOrderLocked — sammenligner mod now, ingen lock-tid = ulåst", () => {
  assert.equal(isOrderLocked(null, 1000), false);
  assert.equal(isOrderLocked("2026-08-25T09:00:00.000Z", new Date("2026-08-25T08:00:00.000Z").getTime()), false);
  assert.equal(isOrderLocked("2026-08-25T09:00:00.000Z", new Date("2026-08-25T09:00:00.000Z").getTime()), true);
  assert.equal(isOrderLocked("2026-08-25T09:00:00.000Z", new Date("2026-08-25T10:00:00.000Z").getTime()), true);
});

test("teamPlanKey — ingen kaptajn giver noCaptain-nøglen uden params", () => {
  assert.deepEqual(teamPlanKey("chase", null), { key: "tacticsOrders.plan.noCaptain", params: {} });
});

test("teamPlanKey — stance + kaptajnnavn giver den rette planbesked-nøgle", () => {
  assert.deepEqual(teamPlanKey("let_go", "Ada Pedersen"), { key: "tacticsOrders.plan.letGo", params: { captain: "Ada Pedersen" } });
  assert.deepEqual(teamPlanKey("neutral", "Mikkel Hansen"), { key: "tacticsOrders.plan.neutral", params: { captain: "Mikkel Hansen" } });
});

// ── #4246: rollen er standardordren, kortet er dagens overlay ────────────────

const DEFAULT_ORDER = {
  team_id: "t1",
  breakaway_stance: "neutral",
  riders: [
    { rider_id: "cap", effort: "normal", try_break: false, leadout: false },
    { rider_id: "hun", effort: "normal", try_break: true, leadout: false },
    { rider_id: "hlp", effort: "normal", try_break: false, leadout: true },
  ],
};

test("roleDefaultFor — serverens rolle-default pr. rytter, neutral for ukendte", () => {
  assert.deepEqual(roleDefaultFor(DEFAULT_ORDER, "hun"), { rider_id: "hun", effort: "normal", try_break: true, leadout: false });
  assert.deepEqual(roleDefaultFor(DEFAULT_ORDER, "ny"), { rider_id: "ny", effort: "normal", try_break: false, leadout: false });
  assert.deepEqual(roleDefaultFor(null, "ny"), { rider_id: "ny", effort: "normal", try_break: false, leadout: false });
});

test("#4246 mergeOrderWithRoster — en rytter uden gemt valg falder til ROLLENS standard", () => {
  const saved = { team_id: "t1", breakaway_stance: "chase", riders: [{ rider_id: "cap", effort: "save", try_break: false, leadout: false }] };
  const merged = mergeOrderWithRoster(saved, ["cap", "hun", "hlp"], DEFAULT_ORDER);
  assert.equal(merged.breakaway_stance, "chase");
  assert.equal(merged.riders[0].effort, "save", "dagens valg vinder");
  assert.equal(merged.riders[1].try_break, true, "jaegeren proever udbruddet uden at spilleren roerer noget");
  assert.equal(merged.riders[2].leadout, true, "hjaelperen koerer toget som standard");
});

test("#4246 mergeOrderWithRoster — dropper ryttere der ikke laengere er i truppen", () => {
  const saved = { team_id: "t1", breakaway_stance: "neutral", riders: [{ rider_id: "vaek", effort: "save", try_break: false }] };
  const merged = mergeOrderWithRoster(saved, ["hun"], DEFAULT_ORDER);
  assert.deepEqual(merged.riders.map((r) => r.rider_id), ["hun"]);
});

test("#4246 riderIntentKeys — ingen afvigelse = koerer sin rolle", () => {
  const base = roleDefaultFor(DEFAULT_ORDER, "hun");
  const intent = riderIntentKeys(base, base, "hunter");
  assert.equal(intent.roleKey, "tacticsOrders.roleDefault.hunter");
  assert.deepEqual(intent.todayKeys, []);
});

test("#4246 riderIntentKeys — 'Standard: jaeger. I dag: bliv i feltet'", () => {
  const base = roleDefaultFor(DEFAULT_ORDER, "hun");
  const intent = riderIntentKeys({ ...base, try_break: false }, base, "hunter");
  assert.equal(intent.roleKey, "tacticsOrders.roleDefault.hunter");
  assert.deepEqual(intent.todayKeys, ["tacticsOrders.today.stayInBunch"]);
});

test("#4246 riderIntentKeys — tog og indsats vises ogsaa, i fast raekkefoelge", () => {
  const base = roleDefaultFor(DEFAULT_ORDER, "hlp");
  const intent = riderIntentKeys({ ...base, try_break: true, leadout: false, effort: "protect" }, base, "helper");
  assert.deepEqual(intent.todayKeys, [
    "tacticsOrders.today.tryBreak",
    "tacticsOrders.today.leaveTrain",
    "tacticsOrders.today.effort.protect",
  ]);
});

test("#4246 toggleLeadout — muterer aldrig input", () => {
  const order = { breakaway_stance: "neutral", riders: [{ rider_id: "hlp", effort: "normal", try_break: false, leadout: false }] };
  const next = toggleLeadout(order, "hlp");
  assert.equal(order.riders[0].leadout, false, "originalen er uroert");
  assert.equal(next.riders[0].leadout, true);
});

test("#4246 hasSprintCaptain — toget kan kun saettes naar der er et maal", () => {
  assert.equal(hasSprintCaptain([{ role: "helper" }, { role: "sprint_captain" }]), true);
  assert.equal(hasSprintCaptain([{ role: "helper" }, { role: "captain" }]), false);
  assert.equal(hasSprintCaptain([]), false);
});

test("#4632 effortCounts — taeller mod serverens vokabular (tre eller fem trin)", () => {
  const riders = [{ effort: "all_out" }, { effort: "normal" }, { effort: "grupetto" }];
  assert.deepEqual(effortCounts(riders, ["grupetto", "save", "normal", "protect", "all_out"]), {
    grupetto: 1, save: 0, normal: 1, protect: 0, all_out: 1,
  });
  // Tre-trins-fallback ignorerer de to yderpunkter i staedet for at kaste.
  assert.deepEqual(effortCounts(riders), { protect: 0, normal: 1, save: 0 });
});
