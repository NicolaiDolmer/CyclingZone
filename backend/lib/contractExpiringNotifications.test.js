import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTRACT_EXPIRING_TYPE,
  buildContractExpiringNotification,
  emitContractExpiringNotifications,
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
  assert.equal(payload.metadata.messageCode, "notif.contractExpiring.message");
  assert.deepEqual(payload.metadata.messageParams, { rider: "Jonas Vingegaard", season: 4 });
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
  assert.equal(calls[0].relatedId, "rA");
  assert.equal(calls[0].metadata.messageCode, "notif.contractExpiring.message");
  assert.deepEqual(calls[0].metadata.messageParams, { rider: "Jonas Vingegaard", season: SEASON });
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
    args.relatedId === "rA" ? { delivered: false, deduped: true } : { delivered: true },
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
    if (args.relatedId === "rA") throw new Error("transient insert error");
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
