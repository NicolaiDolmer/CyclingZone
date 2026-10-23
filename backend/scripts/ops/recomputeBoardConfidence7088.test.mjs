import test from "node:test";
import assert from "node:assert/strict";

import {
  applyPlan,
  buildCorrectedSource,
  buildPlan,
  histogram,
  parseArgs,
  replayTeamConfidence,
} from "./recomputeBoardConfidence7088.mjs";
import { computeMilestoneHitReward, computeMilestoneMissPenalty } from "../../lib/boardMandate.js";
import { resolveRelationSeasonAnchor } from "../../lib/boardMandateEngine.js";

const S3 = "season-3";
const S4 = "season-4";
const activeSeason = { id: S4, number: 4 };
const seasonNumberById = new Map([[S3, 3], [S4, 4]]);
const goal = { type: "stage_wins", target: 5, satisfaction_bonus: 10, satisfaction_penalty: 8 };

test("#7088 replay: ingen historik → uændret", () => {
  const row = replayTeamConfidence({ relation: { team_id: "t", confidence: 100 }, activeSeason, seasonNumberById });
  assert.equal(row.status, "no_history");
  assert.equal(row.after, 100);
});

test("#7088 replay: dom = anker + 1yr-delta, milepæle med ægte belønning, aktiv sæson fra planens delta", () => {
  const row = replayTeamConfidence({
    relation: { team_id: "t", confidence: 100 }, // mættet af den additive fejl
    activeSeason,
    seasonNumberById,
    firstEvent: { season_id: S3, satisfaction_before: 50, reason_category: "weekend_update" },
    verdictEvents: [
      { season_id: S3, reason_category: "season_end", satisfaction_before: 100, satisfaction_after: 100 },
      { season_id: S3, reason_category: "mandate.milestone.achieved", milestone_id: "m1", satisfaction_delta: 0 },
      { season_id: S3, reason_category: "mandate.milestone.missed", milestone_id: "m2", satisfaction_delta: 0 },
    ],
    oneYearDeltaBySeasonNumber: new Map([[3, 6]]),
    milestonesById: new Map([["m1", { goal, weight: 1 }], ["m2", { goal, weight: 1 }]]),
    lastActiveWeekend: { satisfaction_before: 100, satisfaction_after: 100 },
    oneYearBoard: { satisfaction: 61, season_start_satisfaction: 55, season_start_anchor_season_id: S4 },
  });
  const afterS3 = 50 + 6 + computeMilestoneHitReward(goal, 1) - computeMilestoneMissPenalty(goal, 1);
  assert.equal(row.status, "replayed");
  assert.equal(row.anchor, afterS3);
  assert.equal(row.active_delta, 6);
  assert.equal(row.after, afterS3 + 6);
  assert.ok(row.flags.includes("active_delta_from_plan"));
});

test("#7088 replay: umættet seneste løbs-kvittering giver den eksakte aktive delta", () => {
  const row = replayTeamConfidence({
    relation: { team_id: "t", confidence: 30 },
    activeSeason,
    seasonNumberById,
    firstEvent: { season_id: S4, satisfaction_before: 50, reason_category: "weekend_update" },
    lastActiveWeekend: { satisfaction_before: 34, satisfaction_after: 30 },
    oneYearBoard: { satisfaction: 90, season_start_satisfaction: 50, season_start_anchor_season_id: S4 },
  });
  assert.equal(row.anchor, 50);
  assert.equal(row.active_delta, -4);
  assert.equal(row.after, 46);
});

test("#7088 replay: efter deploy er kvitteringen kun et loft-skridt → motorens gemte season_delta bruges", () => {
  const row = replayTeamConfidence({
    relation: {
      team_id: "t",
      confidence: 8,
      // Den rettede motor ankrede på den fejlagtige 0 og tog ét skridt mod 0 + 40.
      confidence_source: { season_anchor: { season_id: S4, confidence: 0 }, season_delta: 40 },
    },
    activeSeason,
    seasonNumberById,
    firstEvent: { season_id: S4, satisfaction_before: 50 },
    lastActiveWeekend: { satisfaction_before: 0, satisfaction_after: 8 },
    oneYearBoard: { satisfaction: 100, season_start_satisfaction: 70, season_start_anchor_season_id: S4 },
  });
  assert.equal(row.active_delta, 40, "ikke kvitteringens skridt (8) og ikke planens grænse (30)");
  assert.equal(row.after, 90);
  assert.ok(row.flags.includes("active_delta_from_engine"));
});

test("#7088 replay: mangler både kvittering og plan → anker, markeret", () => {
  const row = replayTeamConfidence({
    relation: { team_id: "t", confidence: 0 },
    activeSeason,
    seasonNumberById,
    firstEvent: { season_id: S4, satisfaction_before: 50 },
    lastActiveWeekend: { satisfaction_before: 0, satisfaction_after: 0 },
  });
  assert.equal(row.after, 50);
  assert.ok(row.flags.includes("active_delta_unknown"));
});

test("#7088 histogram tæller yderværdierne for sig", () => {
  const h = histogram([0, 0, 5, 50, 99, 100]);
  assert.equal(h.at_0, 2);
  assert.equal(h.at_100, 1);
  assert.equal(h.buckets[0].count, 3);
  assert.equal(h.buckets[9].count, 2);
  assert.equal(h.n, 6);
});

test("#7088 buildCorrectedSource: motoren læser det nye anker for den aktive sæson", () => {
  const source = buildCorrectedSource({ method: "weekend_update", season_end_season_id: S3 }, { before: 100, after: 62, anchor: 56, active_delta: 6 }, S4, "2026-10-24T10:00:00.000Z");
  assert.equal(source.method, "correction_7088");
  assert.equal(source.season_end_season_id, S3, "mærket for en tidligere sæson må gerne blive");
  assert.deepEqual(resolveRelationSeasonAnchor({ confidence: 62, confidence_source: source }, S4), { anchor: 56, reanchored: false });
});

test("#7088 parseArgs: --apply uden --owner-go opdages", () => {
  assert.deepEqual(parseArgs(["--apply"]), { apply: true, ownerGo: false, json: null, backupDir: null });
  assert.equal(parseArgs(["--apply", "--owner-go", "--json=x.json"]).json, "x.json");
});

test("#7088 applyPlan: backup FØR skrivning, optimistisk vagt, kvittering pr. flyttet tal", async () => {
  const order = [];
  const updates = [];
  const inserts = [];
  const supabase = {
    from(table) {
      if (table === "board_relations") {
        return {
          update(payload) {
            const filters = {};
            const chain = {
              eq(col, value) { filters[col] = value; return chain; },
              select: async () => {
                order.push("update");
                updates.push({ payload, filters });
                // r2 har flyttet sig siden dry-run → vagten rammer intet.
                return { data: filters.id === "r2" ? [] : [{ id: filters.id }], error: null };
              },
            };
            return chain;
          },
        };
      }
      if (table === "board_satisfaction_events") {
        return { insert: async (row) => { inserts.push(row); return { error: null }; } };
      }
      throw new Error(table);
    },
  };
  const rows = [
    { relation_id: "r1", team_id: "t1", status: "replayed", before: 100, after: 60, anchor: 55, active_delta: 5, flags: [] },
    { relation_id: "r2", team_id: "t2", status: "replayed", before: 0, after: 40, anchor: 40, active_delta: 0, flags: [] },
    { relation_id: "r3", team_id: "t3", status: "replayed", before: 50, after: 50, anchor: 50, active_delta: 0, flags: [] },
  ];
  const data = {
    activeSeason,
    perTeam: rows.map((r) => ({ relation: { id: r.relation_id, team_id: r.team_id, confidence: r.before, confidence_source: {} } })),
  };
  const files = [];
  const result = await applyPlan(supabase, {
    plan: buildPlan(rows),
    data,
    now: new Date("2026-10-24T10:00:00.000Z"),
    backupDir: "backup-dir",
    makeDir: () => { order.push("mkdir"); },
    writeFile: (path, body) => { order.push("backup"); files.push({ path, body: JSON.parse(body) }); },
    log: () => {},
  });
  assert.deepEqual(order.slice(0, 2), ["mkdir", "backup"]);
  assert.equal(files[0].body.length, 2, "kun rækker der flytter sig tages backup af");
  assert.equal(updates.length, 2, "uændrede rækker røres ikke");
  assert.equal(updates[0].filters.confidence, 100, "optimistisk vagt på dry-run-værdien");
  assert.equal(result.updated, 1);
  assert.equal(result.skipped, 1);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].reason_category, "correction_7088");
  assert.equal(inserts[0].satisfaction_delta, -40);
  assert.equal(inserts[0].mandate_id, undefined, "auditspor, ikke et formandscitat");
});
