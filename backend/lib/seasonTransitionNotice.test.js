import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSeasonTransitionRiskNotification,
  emitSeasonTransitionRiskNotice,
  SEASON_TRANSITION_RISK_TYPE,
} from "./seasonTransitionNotice.js";

// #2700 · Varsel til managere FØR sæsonskiftet (kontraktudløb #2744 + pensionsrisiko
// #2748). fetchTeamRiskRows injiceres (samme mønster som contractExpiringNotifications
// og contractExpiryRelease) — disse tests beviser BESKED-INDHOLD + dry-run/live-
// adfærd, ikke selve DB-forespørgslen (som deler klassifikation med squadRiskGuard.js,
// allerede testet dér).

function makeNotifyRecorder(behavior = () => ({ delivered: true })) {
  const calls = [];
  const notify = async (args) => { calls.push(args); return behavior(args); };
  return { notify, calls };
}

// ─── buildSeasonTransitionRiskNotification — copy-kontrakt ────────────────────

test("build: begge tal > 0 → messageBoth, ingen em-tankestreger, ingen opfundet indhold", () => {
  const payload = buildSeasonTransitionRiskNotification({ expiringCount: 2, retirementRiskCount: 3 });
  assert.equal(payload.type, SEASON_TRANSITION_RISK_TYPE);
  assert.equal(payload.metadata.messageCode, "notif.seasonTransitionRisk.messageBoth");
  assert.match(payload.message, /2 rider\(s\)/);
  assert.match(payload.message, /3 rider\(s\)/);
  assert.match(payload.message, /age 36\+/);
  assert.doesNotMatch(payload.message, /—/, "ingen em-tankestreger i player-facing copy");
  assert.deepEqual(payload.metadata.messageParams, { expiringCount: 2, retirementRiskCount: 3 });
});

test("build: kun kontraktudløb → messageExpiringOnly (ingen '0 rytter(e)'-formulering)", () => {
  const payload = buildSeasonTransitionRiskNotification({ expiringCount: 1, retirementRiskCount: 0 });
  assert.equal(payload.metadata.messageCode, "notif.seasonTransitionRisk.messageExpiringOnly");
  assert.match(payload.message, /1 rider\(s\)/);
  assert.doesNotMatch(payload.message, /retiring/);
});

test("build: kun pensionsrisiko → messageRetirementOnly", () => {
  const payload = buildSeasonTransitionRiskNotification({ expiringCount: 0, retirementRiskCount: 4 });
  assert.equal(payload.metadata.messageCode, "notif.seasonTransitionRisk.messageRetirementOnly");
  assert.match(payload.message, /4 rider\(s\)/);
  assert.doesNotMatch(payload.message, /contract expires/);
});

// ─── emitSeasonTransitionRiskNotice ────────────────────────────────────────────

const TEAM_ROWS = [
  { teamId: "t1", userId: "u1", teamName: "Guinness Cycling Team", expiringCount: 1, retirementRiskCount: 1 },
  { teamId: "t2", userId: "u2", teamName: "The wild ducks", expiringCount: 0, retirementRiskCount: 3 },
];

test("dry-run (default): sender INTET, men returnerer korrekt modtager-antal + eksempel", async () => {
  const { notify, calls } = makeNotifyRecorder();
  const stats = await emitSeasonTransitionRiskNotice({
    supabase: { from: () => {} },
    activeSeasonNumber: 1,
    notify,
    fetchTeamRiskRows: async () => TEAM_ROWS,
  });

  assert.equal(stats.dryRun, true);
  assert.equal(calls.length, 0, "dry-run må ALDRIG kalde notify");
  assert.equal(stats.teamsAffected, 2);
  assert.equal(stats.totalExpiring, 1);
  assert.equal(stats.totalRetirementRisk, 4);
  assert.equal(stats.sample.length, 2);
  assert.match(stats.sample[0].message, /rider\(s\)/);
});

test("--live: sender én notifikation pr. berørt hold, til holdets user_id", async () => {
  const { notify, calls } = makeNotifyRecorder();
  const stats = await emitSeasonTransitionRiskNotice({
    supabase: { from: () => {} },
    activeSeasonNumber: 1,
    dryRun: false,
    notify,
    fetchTeamRiskRows: async () => TEAM_ROWS,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].userId, "u1");
  assert.equal(calls[0].type, SEASON_TRANSITION_RISK_TYPE);
  assert.equal(calls[1].userId, "u2");
  assert.deepEqual(stats, {
    dryRun: false, teamsAffected: 2, totalExpiring: 1, totalRetirementRisk: 4,
    delivered: 2, deduped: 0, failed: 0, sample: stats.sample,
  });
});

test("ingen berørte hold → nul-stats, ingen kald", async () => {
  const { notify, calls } = makeNotifyRecorder();
  const stats = await emitSeasonTransitionRiskNotice({
    supabase: { from: () => {} }, activeSeasonNumber: 1, dryRun: false, notify,
    fetchTeamRiskRows: async () => [],
  });
  assert.equal(calls.length, 0);
  assert.equal(stats.teamsAffected, 0);
});

test("dedupe + fejl tælles separat (samme robusthed som contract-expiring-notifikationen)", async () => {
  const { notify } = makeNotifyRecorder((args) => {
    if (args.userId === "u1") return { delivered: false, deduped: true };
    if (args.userId === "u2") throw new Error("transient insert error");
    return { delivered: true };
  });
  const stats = await emitSeasonTransitionRiskNotice({
    supabase: { from: () => {} }, activeSeasonNumber: 1, dryRun: false, notify,
    fetchTeamRiskRows: async () => TEAM_ROWS,
  });
  assert.equal(stats.delivered, 0);
  assert.equal(stats.deduped, 1);
  assert.equal(stats.failed, 1);
});

test("manglende activeSeasonNumber kaster i stedet for at sende et meningsløst varsel", async () => {
  await assert.rejects(() => emitSeasonTransitionRiskNotice({ supabase: { from: () => {} }, activeSeasonNumber: undefined }));
});
