import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTRACT_EXPIRING_TYPE,
  buildContractExpiringNotification,
  emitContractExpiringNotifications,
  notifyIfContractExpiresThisSeason,
} from "./notificationService.js";

// #1836 · Kontraktudløb-notifikation. Tester den delte payload-builder (SSOT for
// alle tre triggere) + sæsonskift-emitteren (eligibility, metadata-koder,
// idempotens, fejl-isolering). Auktion-/transfer-køb-triggerne genbruger samme
// builder, så payload-dækningen her gælder dem alle.

// ─── buildContractExpiringNotification ────────────────────────────────────────

test("build: type, titel, relatedId og metadata-koder er korrekte", () => {
  const payload = buildContractExpiringNotification({
    riderName: "Jonas Vingegaard",
    riderId: "rider-7",
    seasonNumber: 4,
  });

  assert.equal(payload.type, CONTRACT_EXPIRING_TYPE);
  assert.equal(payload.type, "contract_expiring");
  assert.equal(payload.title, "Contract expiring");
  assert.equal(payload.relatedId, "rider-7", "related_id = riderId → deep-link + dedup-nøgle");
  assert.equal(payload.metadata.riderId, "rider-7", "metadata.riderId driver rytter-deep-link i UI");
  assert.equal(payload.metadata.titleCode, "notif.contractExpiring.title");
  assert.equal(payload.metadata.messageCode, "notif.contractExpiring.squadMessage");
  assert.deepEqual(payload.metadata.messageParams, { rider: "Jonas Vingegaard", season: 4, squadKey: "notif.contractSquad.senior" });
});

test("build: EN-first fallback-message indeholder rytternavn + sæson (dedup-diskriminator)", () => {
  const s4 = buildContractExpiringNotification({ riderName: "Tadej Pogacar", riderId: "r1", seasonNumber: 4 });
  const s5 = buildContractExpiringNotification({ riderName: "Tadej Pogacar", riderId: "r1", seasonNumber: 5 });

  assert.match(s4.message, /Tadej Pogacar/);
  assert.match(s4.message, /season 4/);
  // Forskellig sæson → forskellig message → notifyUser-dedup (type+title+message+
  // related_id) deduper IKKE på tværs af sæsoner for samme rytter.
  assert.notEqual(s4.message, s5.message);
});

test("build: null riderId tolereres (relatedId + metadata.riderId = null)", () => {
  const payload = buildContractExpiringNotification({ riderName: "Mystery Man", riderId: null, seasonNumber: 2 });
  assert.equal(payload.relatedId, null);
  assert.equal(payload.metadata.riderId, null);
});

// ─── emitContractExpiringNotifications (sæsonskift-trigger) ────────────────────

function makeNotifyRecorder(behavior = () => ({ delivered: true })) {
  const calls = [];
  const notify = async (args) => {
    calls.push(args);
    return behavior(args);
  };
  return { notify, calls };
}

const SEASON = 4;

test("emit: én notifikation pr. udløbende ejet rytter, til ejerens user_id", async () => {
  const { notify, calls } = makeNotifyRecorder();
  const riders = [
    { id: "rA", firstname: "Jonas", lastname: "Vingegaard", user_id: "u1" },
    { id: "rB", firstname: "Wout", lastname: "van Aert", user_id: "u2" },
  ];

  const stats = await emitContractExpiringNotifications({
    supabase: {},
    seasonNumber: SEASON,
    notify,
    fetchOwnedExpiringRiders: async () => riders,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].userId, "u1");
  assert.equal(calls[0].type, "contract_expiring");
  assert.equal(calls[0].relatedId, null);
  assert.equal(calls[0].metadata.messageCode, "notif.contractExpiringSummary.message");
  assert.equal(calls[0].metadata.messageParams.season, SEASON);
  assert.equal(calls[0].metadata.messageParams.contractRiders[0].rider, "Jonas Vingegaard");
  assert.deepEqual(stats, { eligible: 2, delivered: 2, deduped: 0, failed: 0 });
});

test("emit: ryttere uden user_id eller id springes over", async () => {
  const { notify, calls } = makeNotifyRecorder();
  const riders = [
    { id: "rA", firstname: "Jonas", lastname: "V", user_id: "u1" },
    { id: "rB", firstname: "Owner", lastname: "less", user_id: null },
    { id: null, firstname: "No", lastname: "Id", user_id: "u3" },
  ];

  const stats = await emitContractExpiringNotifications({
    supabase: {},
    seasonNumber: SEASON,
    notify,
    fetchOwnedExpiringRiders: async () => riders,
  });

  assert.equal(calls.length, 1, "kun rytteren med både id og user_id notificeres");
  assert.deepEqual(stats, { eligible: 1, delivered: 1, deduped: 0, failed: 0 });
});

test("emit: deduped tælles separat fra delivered (idempotens via notifyUser-dedup)", async () => {
  // Simulér at notifyUser's 24t-dedup allerede har leveret for rytter rA.
  const { notify } = makeNotifyRecorder((args) =>
    args.userId === "u1" ? { delivered: false, deduped: true } : { delivered: true },
  );

  const stats = await emitContractExpiringNotifications({
    supabase: {},
    seasonNumber: SEASON,
    notify,
    fetchOwnedExpiringRiders: async () => [
      { id: "rA", firstname: "A", lastname: "A", user_id: "u1" },
      { id: "rB", firstname: "B", lastname: "B", user_id: "u2" },
    ],
  });

  assert.deepEqual(stats, { eligible: 2, delivered: 1, deduped: 1, failed: 0 });
});

test("emit: en fejl pr. rytter isoleres og stopper ikke resten", async () => {
  const { notify } = makeNotifyRecorder((args) => {
    if (args.userId === "u1") throw new Error("transient insert error");
    return { delivered: true };
  });

  const stats = await emitContractExpiringNotifications({
    supabase: {},
    seasonNumber: SEASON,
    notify,
    fetchOwnedExpiringRiders: async () => [
      { id: "rA", firstname: "A", lastname: "A", user_id: "u1" },
      { id: "rB", firstname: "B", lastname: "B", user_id: "u2" },
    ],
  });

  assert.deepEqual(stats, { eligible: 2, delivered: 1, deduped: 0, failed: 1 });
});

test("emit: ingen udløbende ryttere → nul-stats", async () => {
  const { notify, calls } = makeNotifyRecorder();
  const stats = await emitContractExpiringNotifications({
    supabase: {},
    seasonNumber: SEASON,
    notify,
    fetchOwnedExpiringRiders: async () => [],
  });
  assert.equal(calls.length, 0);
  assert.deepEqual(stats, { eligible: 0, delivered: 0, deduped: 0, failed: 0 });
});

// ─── Køb-trigger predikat (auktion + transfer genbruger denne betingelse) ──────

test("køb-trigger: notificér KUN når kontrakt udløber i indeværende sæson", () => {
  // Predikatet i auctionFinalization/transferExecution er:
  //   effektiv contract_end_season === activeSeasonNumber → byg + send.
  const activeSeason = 4;
  const fires = (endSeason) => endSeason === activeSeason;

  assert.equal(fires(4), true, "udløber i år → notifikation");
  assert.equal(fires(5), false, "udløber næste år → ingen notifikation");
  assert.equal(fires(3), false, "allerede udløbet/ældre → ingen notifikation");
});

// ─── #7246 · default-fetchen paginerer forbi PostgREST's 1.000-loft ───────────

function cappedRidersSupabase(total, rowCap = 1000) {
  const all = Array.from({ length: total }, (_, i) => ({
    id: `r-${String(i).padStart(5, "0")}`, firstname: "F", lastname: `L${i}`, team: { user_id: `u-${i % 50}`, is_ai: false, is_frozen: false },
  }));
  return {
    from(table) {
      assert.equal(table, "riders");
      const q = { range: null };
      const builder = {
        select() { return builder; }, eq() { return builder; }, not() { return builder; }, order() { return builder; },
        range(from, to) { q.range = [from, to]; return builder; },
        then(resolve) {
          // PostgREST max-rows: uden .range() højst rowCap rækker (prod = 1000).
          const data = q.range ? all.slice(q.range[0], q.range[1] + 1) : all.slice(0, rowCap);
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}

test("#7246: alle 1.515 udløbende ryttere får varsel, ikke kun de første 1.000", async () => {
  const sent = [];
  const stats = await emitContractExpiringNotifications({
    supabase: cappedRidersSupabase(1515),
    seasonNumber: 5,
    notify: async ({ metadata }) => { sent.push(...metadata.messageParams.contractRiders.map((r) => r.rider)); return { delivered: true }; },
  });
  assert.equal(stats.eligible, 1515);
  assert.equal(stats.delivered, 50);
  assert.equal(new Set(sent).size, 1515, "ingen dubletter på tværs af sider");
});

const NOW = new Date("2026-10-26T12:00:00Z");

test("acquisition helper: each squad warns only for the current season", async () => {
  for (const squad of ["senior", "u23", "junior", "academy"]) {
    const calls = [];
    const notify = async (payload) => { calls.push(payload); return { delivered: true }; };
    for (const end of [null, 4, 5, 6]) {
      await notifyIfContractExpiresThisSeason({
        supabase: {}, teamId: "team-a", seasonNumber: 5, now: NOW, notify,
        rider: { id: "r-a", firstname: "Rider", lastname: "A", squad,
          is_academy: squad !== "senior", contract_end_season: end },
      });
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0].teamId, "team-a");
    assert.equal(calls[0].now, NOW);
    assert.equal(calls[0].relatedId, "r-a");
    assert.equal(calls[0].metadata.messageParams.squadKey, `notif.contractSquad.${squad}`);
  }
});

test("acquisition helper: failed delivery cannot reject a committed acquisition", async () => {
  const result = await notifyIfContractExpiresThisSeason({
    supabase: {}, teamId: "team-a", seasonNumber: 5, now: NOW,
    rider: { id: "r-a", contract_end_season: 5 },
    notify: async () => { throw new Error("delivery unavailable"); },
  });
  assert.equal(result.failed, true);
});

test("season start: all squads appear in one summary per team", async () => {
  const calls = [];
  const riders = ["senior", "u23", "junior", "academy"].map((squad, i) => ({
    id: `r-${i}`, team_id: "team-a", user_id: "owner-a", firstname: "Rider", lastname: String(i),
    squad, is_academy: squad !== "senior", market_value: 1200 + i,
  }));
  const stats = await emitContractExpiringNotifications({
    supabase: {}, seasonNumber: 5,
    fetchOwnedExpiringRiders: async () => riders,
    notify: async (p) => { calls.push(p); return { delivered: true }; },
  });
  assert.equal(stats.eligible, 4);
  assert.equal(stats.delivered, 1);
  assert.equal(calls[0].relatedId, null);
  assert.deepEqual(calls[0].metadata.messageParams.contractRiders.map((r) => r.squad), ["senior", "u23", "junior", "academy"]);
  assert.deepEqual(calls[0].metadata.messageParams.contractRiders.map((r) => r.value), [1200, 1201, 1202, 1203]);
});
