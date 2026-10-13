// #6590 · Push: kryptering (RFC 8291), VAPID (RFC 8292), loft, stille timer
// (tidszoner), resumé-sammenlaegning og "slukket flag = intet sendt".
import test from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createHmac, createPublicKey, randomBytes, verify } from "node:crypto";

import { createFakeSupabase } from "./testUtils/fakeSupabase.js";
import { RFC8291_VECTOR } from "./testUtils/rfc8291Vector.js";
import {
  PUSH_CURSOR_KEY,
  PUSH_DAILY_CAP,
  RACE_DIGEST_SETTLE_MS,
  buildDigestPayload,
  buildInstantPayload,
  categoryForType,
  isDigestDue,
  isLastMinuteOutbid,
  isQuietHours,
  lastQuietEnd,
  normalizeTimeZone,
  parseSubscription,
  planUserNotifications,
  resolveCategoryPrefs,
  runPushSweep,
  sanitizeCategoryPatch,
  startOfLocalDay,
} from "./pushService.js";
import { b64urlDecode, b64urlEncode, buildVapidJwt, encryptPayload, readVapidConfig, sendWebPush } from "./webPush.ts";

const MIN = 60 * 1000;

// ── Hjaelpere ────────────────────────────────────────────────────────────────

function pad32(buf) {
  return buf.length >= 32 ? buf : Buffer.concat([Buffer.alloc(32 - buf.length), buf]);
}

function makeVapidEnv() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    VAPID_PUBLIC_KEY: b64urlEncode(ecdh.getPublicKey()),
    VAPID_PRIVATE_KEY: b64urlEncode(pad32(ecdh.getPrivateKey())),
    VAPID_SUBJECT: "mailto:push-test@example.invalid",
  };
}

function makeBrowserSubscription() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const authSecret = randomBytes(16);
  return { ecdh, authSecret, keys: { p256dh: b64urlEncode(ecdh.getPublicKey()), auth: b64urlEncode(authSecret) } };
}

function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

/** Modtager-siden af RFC 8291 (det browseren goer), kun til test. */
function decryptPayload(body, uaEcdh, authSecret) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const ecdhSecret = uaEcdh.computeSecret(asPublic);
  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaEcdh.getPublicKey(), asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  assert.equal(padded[padded.length - 1], 2, "sidste record slutter med 0x02");
  return padded.subarray(0, padded.length - 1).toString("utf8");
}

// ── RFC 8291 + RFC 8292 ──────────────────────────────────────────────────────

test("encryptPayload genskaber RFC 8291 bilag A byte-for-byte", () => {
  const vector = RFC8291_VECTOR;
  const out = encryptPayload(
    Buffer.from(vector.plaintext),
    { p256dh: vector.uaPub, auth: vector.uaAuth },
    { asPrivateKey: b64urlDecode(vector.asPriv), salt: b64urlDecode(vector.salt) },
  );
  assert.ok(out.equals(b64urlDecode(vector.body)), "krypteret krop matcher RFC-vektoren");
});

test("sendWebPush: browseren kan dekryptere, VAPID-JWT verificerer, headers er korrekte", async () => {
  const env = makeVapidEnv();
  const vapid = readVapidConfig(env);
  assert.ok(vapid);
  const browser = makeBrowserSubscription();
  let captured = null;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return { status: 201 };
  };
  const payload = JSON.stringify({ title: "Hej", body: "Du er overbudt", tag: "auctions" });
  const result = await sendWebPush(
    { endpoint: "https://push.example.invalid/send/abc", ...browser.keys },
    payload,
    vapid,
    { topic: "auctions", urgency: "high", ttlSeconds: 600, fetchImpl, nowSeconds: 1_800_000_000 },
  );
  assert.deepEqual(result, { status: 201, gone: false, ok: true });
  assert.equal(captured.init.headers["Content-Encoding"], "aes128gcm");
  assert.equal(captured.init.headers.TTL, "600");
  assert.equal(captured.init.headers.Urgency, "high");
  assert.equal(captured.init.headers.Topic, "auctions");
  assert.equal(decryptPayload(Buffer.from(captured.init.body), browser.ecdh, browser.authSecret), payload);

  const auth = captured.init.headers.Authorization;
  const match = /^vapid t=([^,]+), k=(.+)$/.exec(auth);
  assert.ok(match, "Authorization: vapid t=…, k=…");
  assert.equal(match[2], env.VAPID_PUBLIC_KEY);
  const [h, c, s] = match[1].split(".");
  const claims = JSON.parse(Buffer.from(c, "base64url").toString("utf8"));
  assert.equal(claims.aud, "https://push.example.invalid");
  assert.equal(claims.sub, env.VAPID_SUBJECT);
  assert.ok(claims.exp > 1_800_000_000 && claims.exp <= 1_800_000_000 + 24 * 3600);
  const pub = b64urlDecode(env.VAPID_PUBLIC_KEY);
  const publicKey = createPublicKey({
    key: { kty: "EC", crv: "P-256", x: b64urlEncode(pub.subarray(1, 33)), y: b64urlEncode(pub.subarray(33)) },
    format: "jwk",
  });
  assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")));
});

test("sendWebPush: 410 = abonnementet er vaek; netvaerksfejl kaster ikke", async () => {
  const vapid = readVapidConfig(makeVapidEnv());
  const sub = { endpoint: "https://push.example.invalid/x", ...makeBrowserSubscription().keys };
  assert.deepEqual(await sendWebPush(sub, "{}", vapid, { fetchImpl: async () => ({ status: 410 }) }), { status: 410, gone: true, ok: false });
  assert.deepEqual(
    await sendWebPush(sub, "{}", vapid, { fetchImpl: async () => { throw new Error("ECONNRESET"); } }),
    { status: 0, gone: false, ok: false },
  );
});

test("readVapidConfig: mangler, forkert subject eller noeglepar der ikke haenger sammen = null", () => {
  const env = makeVapidEnv();
  assert.ok(readVapidConfig(env));
  assert.equal(readVapidConfig({ ...env, VAPID_PRIVATE_KEY: "" }), null);
  assert.equal(readVapidConfig({ ...env, VAPID_SUBJECT: "push-test@example.invalid" }), null);
  assert.equal(readVapidConfig({ ...env, VAPID_PUBLIC_KEY: makeVapidEnv().VAPID_PUBLIC_KEY }), null);
  assert.ok(buildVapidJwt("https://a.invalid", readVapidConfig(env)).split(".").length === 3);
});

// ── Kategorier og praeferencer ───────────────────────────────────────────────

test("kategorier: standarder efter opt-in (akademi fra), ukendte typer har ingen kategori", () => {
  assert.deepEqual(resolveCategoryPrefs({}), { auctions: true, races: true, transfers: true, deadlines: true, academy: false });
  assert.deepEqual(resolveCategoryPrefs({ categories: { academy: true, races: false } }).academy, true);
  assert.equal(categoryForType("salary_paid"), null);
  assert.equal(categoryForType("stage_result").key, "races");
  assert.deepEqual(sanitizeCategoryPatch({ auctions: false, bogus: true }).unknownKeys, ["bogus"]);
  assert.equal(sanitizeCategoryPatch({ auctions: "no" }).invalid, true);
});

test("parseSubscription afviser http-endpoints og skaeve noegler", () => {
  const keys = makeBrowserSubscription().keys;
  assert.ok(parseSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys }));
  assert.equal(parseSubscription({ endpoint: "http://fcm.googleapis.com/x", keys }), null);
  assert.equal(parseSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { ...keys, auth: "short" } }), null);
});

// ── Stille timer og tidszoner ────────────────────────────────────────────────

test("stille timer 22-08 regnes i spillerens egen tidszone", () => {
  const evening = new Date("2026-10-13T20:30:00.000Z"); // CEST 22:30 · NY 16:30 · Tokyo 05:30
  assert.equal(isQuietHours(evening, "Europe/Copenhagen"), true);
  assert.equal(isQuietHours(evening, "America/New_York"), false);
  assert.equal(isQuietHours(evening, "Asia/Tokyo"), true);
  const morning = new Date("2026-10-13T06:30:00.000Z"); // CEST 08:30 · NY 02:30
  assert.equal(isQuietHours(morning, "Europe/Copenhagen"), false);
  assert.equal(isQuietHours(morning, "America/New_York"), true);
  // Graenserne: 21:59 er aaben, 22:00 er stille, 07:59 stille, 08:00 aaben (CEST = UTC+2).
  assert.equal(isQuietHours(new Date("2026-10-13T19:59:00.000Z"), "Europe/Copenhagen"), false);
  assert.equal(isQuietHours(new Date("2026-10-13T20:00:00.000Z"), "Europe/Copenhagen"), true);
  assert.equal(isQuietHours(new Date("2026-10-13T05:59:00.000Z"), "Europe/Copenhagen"), true);
  assert.equal(isQuietHours(new Date("2026-10-13T06:00:00.000Z"), "Europe/Copenhagen"), false);
});

test("ugyldig eller manglende tidszone falder tilbage til Europe/Copenhagen", () => {
  assert.equal(normalizeTimeZone(null), "Europe/Copenhagen");
  assert.equal(normalizeTimeZone("Mars/Olympus_Mons"), "Europe/Copenhagen");
  assert.equal(normalizeTimeZone("America/Sao_Paulo"), "America/Sao_Paulo");
});

test("lastQuietEnd og startOfLocalDay haandterer sommertid", () => {
  // 07:00 CEST: stille timer sluttede i GAAR kl. 08.
  assert.equal(lastQuietEnd(new Date("2026-10-13T05:00:00.000Z"), "Europe/Copenhagen").toISOString(), "2026-10-12T06:00:00.000Z");
  assert.equal(lastQuietEnd(new Date("2026-10-13T10:00:00.000Z"), "Europe/Copenhagen").toISOString(), "2026-10-13T06:00:00.000Z");
  // Dagen efter vintertid (CET = UTC+1): kl. 08 lokal = 07:00Z.
  assert.equal(lastQuietEnd(new Date("2026-10-26T10:00:00.000Z"), "Europe/Copenhagen").toISOString(), "2026-10-26T07:00:00.000Z");
  // Skiftedagen selv starter stadig i sommertid: lokal midnat = 22:00Z dagen foer.
  assert.equal(startOfLocalDay(new Date("2026-10-25T12:00:00.000Z"), "Europe/Copenhagen").toISOString(), "2026-10-24T22:00:00.000Z");
  assert.equal(startOfLocalDay(new Date("2026-10-13T03:00:00.000Z"), "America/New_York").toISOString(), "2026-10-12T04:00:00.000Z");
});

// ── Planlaegning: loft, stille timer, digest ─────────────────────────────────

const DAYTIME = new Date("2026-10-13T12:00:00.000Z"); // 14:00 i Koebenhavn
const PREFS = resolveCategoryPrefs({});

function note(id, type, extra = {}) {
  return { id, type, title: `t-${id}`, message: `m-${id}`, related_id: null, created_at: DAYTIME.toISOString(), metadata: null, ...extra };
}

test("loft: ved 5 sendte i dag gaar kun én kategori igennem, resten venter som 'cap'", () => {
  const plan = planUserNotifications({
    notifications: [note("a", "auction_won"), note("b", "transfer_offer_received"), note("c", "selection_warning")],
    prefs: PREFS,
    timeZone: "Europe/Copenhagen",
    sentToday: PUSH_DAILY_CAP - 1,
    now: DAYTIME,
  });
  assert.deepEqual(plan.send.map((s) => s.category.key), ["auctions"]);
  assert.deepEqual(plan.queue.map((q) => [q.notification.id, q.reason]), [["b", "cap"], ["c", "cap"]]);
});

test("loft naaet: intet sendes, alt venter til naeste resumé", () => {
  const plan = planUserNotifications({
    notifications: [note("a", "auction_won")], prefs: PREFS, timeZone: "Europe/Copenhagen", sentToday: PUSH_DAILY_CAP, now: DAYTIME,
  });
  assert.equal(plan.send.length, 0);
  assert.deepEqual(plan.queue.map((q) => q.reason), ["cap"]);
});

test("stille timer: ingen undtagelser, heller ikke en auktion der vindes kl. 23", () => {
  const night = new Date("2026-10-13T21:00:00.000Z"); // 23:00 CEST
  const plan = planUserNotifications({
    notifications: [note("a", "auction_won", { created_at: night.toISOString() })],
    prefs: PREFS, timeZone: "Europe/Copenhagen", sentToday: 0, now: night,
  });
  assert.equal(plan.send.length, 0);
  assert.deepEqual(plan.queue.map((q) => q.reason), ["quiet"]);
  // Samme minut er det eftermiddag i New York: dér sendes den.
  const ny = planUserNotifications({
    notifications: [note("a", "auction_won", { created_at: night.toISOString() })],
    prefs: PREFS, timeZone: "America/New_York", sentToday: 0, now: night,
  });
  assert.equal(ny.send.length, 1);
});

test("loeb og akademi sendes aldrig enkeltvis; flere i samme kategori = ét push", () => {
  const plan = planUserNotifications({
    notifications: [note("s1", "stage_result"), note("t1", "transfer_offer_received"), note("t2", "transfer_counter")],
    prefs: PREFS, timeZone: "Europe/Copenhagen", sentToday: 0, now: DAYTIME,
  });
  assert.deepEqual(plan.queue.map((q) => [q.notification.id, q.reason]), [["s1", "digest"]]);
  assert.equal(plan.send.length, 1);
  assert.deepEqual(plan.send[0].notifications.map((n) => n.id), ["t1", "t2"]);
  assert.equal(buildInstantPayload({ ...plan.send[0], language: "en" }).body, "m-t2", "den nyeste vinder");
});

test("fravalgt kategori og akademi (standard fra) giver intet", () => {
  const plan = planUserNotifications({
    notifications: [note("x", "academy_intake_ready"), note("y", "transfer_offer_received")],
    prefs: resolveCategoryPrefs({ categories: { transfers: false } }),
    timeZone: "Europe/Copenhagen", sentToday: 0, now: DAYTIME,
  });
  assert.equal(plan.send.length + plan.queue.length, 0);
  assert.equal(plan.skipped, 2);
});

test("overbudt giver kun push i sidste minut", () => {
  const at = DAYTIME.getTime();
  const outbid = note("o", "auction_outbid", { related_id: "auc-1" });
  assert.equal(isLastMinuteOutbid(outbid, { calculated_end: new Date(at + 10 * MIN).toISOString() }), true);
  assert.equal(isLastMinuteOutbid(outbid, { calculated_end: new Date(at + 3 * 60 * MIN).toISOString() }), false);
  assert.equal(isLastMinuteOutbid(outbid, null), false);
  const plan = planUserNotifications({
    notifications: [outbid], prefs: PREFS, timeZone: "Europe/Copenhagen", sentToday: 0, now: DAYTIME,
    auctions: new Map([["auc-1", { calculated_end: new Date(at + 3 * 60 * MIN).toISOString() }]]),
  });
  assert.equal(plan.send.length + plan.queue.length, 0);
});

// ── Resumé ───────────────────────────────────────────────────────────────────

test("resumé: kategorier laegges sammen i én besked, EN og DA", () => {
  const en = buildDigestPayload({ countsByCategory: { races: 3, transfers: 1 }, language: "en" });
  assert.equal(en.title, "Since you last looked");
  assert.equal(en.body, "3 race results · 1 transfer offer");
  assert.equal(en.tag, "digest");
  assert.equal(en.url, "/notifications");
  const da = buildDigestPayload({ countsByCategory: { races: 1, deadlines: 2 }, language: "da" });
  assert.equal(da.title, "Siden sidst");
  assert.equal(da.body, "1 løbsresultat · 2 frister");
  const single = buildDigestPayload({ countsByCategory: { races: 2 }, language: "en" });
  assert.equal(single.tag, "races", "én kategori = kategoriens eget tag");
});

test("isDigestDue: loebs-resumé efter ro, morgen-resumé efter stille timer, aldrig i stille timer eller over loftet", () => {
  const now = new Date("2026-10-13T12:00:00.000Z"); // 14:00 CEST
  const tz = "Europe/Copenhagen";
  const race = (ago) => ({ category: "races", reason: "digest", queued_at: new Date(now.getTime() - ago).toISOString() });
  assert.equal(isDigestDue({ rows: [race(RACE_DIGEST_SETTLE_MS + MIN)], now, timeZone: tz, sentToday: 0 }), true);
  assert.equal(isDigestDue({ rows: [race(RACE_DIGEST_SETTLE_MS + MIN), race(10 * MIN)], now, timeZone: tz, sentToday: 0 }), false);
  assert.equal(isDigestDue({ rows: [race(RACE_DIGEST_SETTLE_MS + MIN)], now, timeZone: tz, sentToday: PUSH_DAILY_CAP }), false);
  const night = new Date("2026-10-13T21:00:00.000Z");
  assert.equal(isDigestDue({ rows: [race(5 * 60 * MIN)], now: night, timeZone: tz, sentToday: 0 }), false);
  // Loft-raekke fra i formiddags venter til i morgen; fra i gaar aftes er den klar nu.
  const capToday = { category: "transfers", reason: "cap", queued_at: "2026-10-13T09:00:00.000Z" };
  const quietYesterday = { category: "transfers", reason: "quiet", queued_at: "2026-10-12T21:30:00.000Z" };
  assert.equal(isDigestDue({ rows: [capToday], now, timeZone: tz, sentToday: 0 }), false);
  assert.equal(isDigestDue({ rows: [quietYesterday], now, timeZone: tz, sentToday: 0 }), true);
});

// ── Sweep mod fake-database ──────────────────────────────────────────────────

function recordingSupabase(state) {
  const fake = createFakeSupabase(state);
  const tables = [];
  return { state: fake.state, tables, from: (t) => { tables.push(t); return fake.from(t); } };
}

function baseState({ flag = "on", user = {}, subs = true, deliveries = [], queue = [], notifications = [] } = {}) {
  const browser = makeBrowserSubscription();
  return {
    app_config: [
      { key: "push_enabled", value: flag },
      { key: PUSH_CURSOR_KEY, value: { at: "2026-10-13T11:59:00.000Z", id: null }, updated_at: "v1" },
    ],
    users: [{ id: "u1", language: "en", timezone: "Europe/Copenhagen", push_prefs: {}, role: "manager", is_beta_tester: false, ...user }],
    push_subscriptions: subs
      ? [{ id: "s1", user_id: "u1", endpoint: "https://push.example.invalid/1", ...browser.keys, failure_count: 0 }]
      : [],
    push_deliveries: deliveries,
    push_queue: queue,
    notifications,
    auctions: [],
  };
}

function sentRecorder(result = { status: 201, gone: false, ok: true }) {
  const calls = [];
  const send = async (sub, payload, _vapid, opts) => {
    calls.push({ sub, payload: JSON.parse(payload), opts });
    return result;
  };
  return { calls, send };
}

const SWEEP_NOW = new Date("2026-10-13T12:00:00.000Z");
const freshNote = (id, type, extra = {}) => ({
  id, user_id: "u1", type, title: `T ${id}`, message: `M ${id}`, related_id: null,
  created_at: "2026-10-13T11:59:30.000Z", metadata: null, is_read: false, ...extra,
});

test("slukket flag: intet sendes og intet andet end flaget laeses", async () => {
  const supabase = recordingSupabase(baseState({ flag: "off", notifications: [freshNote("n1", "transfer_offer_received")] }));
  const { calls, send } = sentRecorder();
  const result = await runPushSweep({ supabase, now: SWEEP_NOW, env: makeVapidEnv(), send });
  assert.deepEqual(result, { skipped: "flag_off" });
  assert.equal(calls.length, 0);
  assert.deepEqual([...new Set(supabase.tables)], ["app_config"]);
  assert.equal(supabase.state.push_deliveries.length, 0);
});

test("manglende flag-raekke og manglende VAPID-noegler sender heller intet", async () => {
  const noFlag = baseState({ notifications: [freshNote("n1", "transfer_offer_received")] });
  noFlag.app_config = noFlag.app_config.filter((r) => r.key !== "push_enabled");
  const a = sentRecorder();
  assert.deepEqual(await runPushSweep({ supabase: createFakeSupabase(noFlag), now: SWEEP_NOW, env: makeVapidEnv(), send: a.send }), { skipped: "flag_off" });
  const b = sentRecorder();
  const state = baseState({ notifications: [freshNote("n1", "transfer_offer_received")] });
  assert.deepEqual(await runPushSweep({ supabase: createFakeSupabase(state), now: SWEEP_NOW, env: {}, send: b.send }), { skipped: "vapid_missing" });
  assert.equal(a.calls.length + b.calls.length, 0);
});

test("flag on: transfertilbud sendes straks, etaperesultat lander i resumé-koeen, cursoren flytter", async () => {
  const state = baseState({
    notifications: [
      freshNote("n1", "transfer_offer_received", {
        metadata: { titleCode: "push.digest.title", titleParams: {}, messageCode: "push.digest.count.transfers", messageParams: { count: 1 } },
      }),
      freshNote("n2", "stage_result", { created_at: "2026-10-13T11:59:40.000Z" }),
      freshNote("n3", "salary_paid"),
    ],
  });
  const supabase = createFakeSupabase(state);
  const { calls, send } = sentRecorder();
  const result = await runPushSweep({ supabase, now: SWEEP_NOW, env: makeVapidEnv(), send });
  assert.equal(result.sent, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.tag, "transfers");
  assert.equal(calls[0].payload.title, "Since you last looked", "noeglen renderes paa spillerens sprog");
  assert.equal(calls[0].payload.body, "1 transfer offer");
  assert.equal(calls[0].opts.topic, "transfers");
  assert.deepEqual(state.push_queue.map((q) => [q.notification_id, q.reason]), [["n2", "digest"]]);
  assert.deepEqual(state.push_deliveries.map((d) => [d.category, d.status, d.notification_ids]), [["transfers", "sent", ["n1"]]]);
  const cursor = state.app_config.find((r) => r.key === PUSH_CURSOR_KEY);
  assert.equal(cursor.value.id, "n2");
  assert.ok(state.push_subscriptions[0].last_success_at);

  // Naeste tick ser intet nyt: samme notifikation sendes aldrig to gange.
  const again = await runPushSweep({ supabase, now: new Date(SWEEP_NOW.getTime() + MIN), env: makeVapidEnv(), send });
  assert.equal(again.sent, 0);
  assert.equal(calls.length, 1);
});

test("et andet tick har allerede taget cursoren: intet sendes (ingen dubletter under deploy)", async () => {
  const state = baseState({ notifications: [freshNote("n1", "transfer_offer_received")] });
  const fake = createFakeSupabase(state);
  // Simulér at den anden proces flytter cursoren mellem vores laesning og claim.
  const supabase = {
    from(table) {
      const q = fake.from(table);
      if (table !== "app_config") return q;
      return {
        ...q,
        update(payload) {
          state.app_config.find((r) => r.key === PUSH_CURSOR_KEY).updated_at = "v2";
          return q.update(payload);
        },
      };
    },
  };
  const { calls, send } = sentRecorder();
  const result = await runPushSweep({ supabase, now: SWEEP_NOW, env: makeVapidEnv(), send });
  assert.equal(result.scanned, 0);
  assert.equal(calls.length, 0);
});

test("stille timer i sweepen: notifikationen koees som 'quiet' og sendes ikke", async () => {
  const night = new Date("2026-10-13T21:00:00.000Z");
  const state = baseState({ notifications: [freshNote("n1", "transfer_offer_received", { created_at: "2026-10-13T20:59:30.000Z" })] });
  state.app_config[1].value.at = "2026-10-13T20:59:00.000Z";
  const { calls, send } = sentRecorder();
  await runPushSweep({ supabase: createFakeSupabase(state), now: night, env: makeVapidEnv(), send });
  assert.equal(calls.length, 0);
  assert.deepEqual(state.push_queue.map((q) => q.reason), ["quiet"]);
});

test("loft i sweepen: 6 sendte i dag = koe 'cap'", async () => {
  const deliveries = Array.from({ length: PUSH_DAILY_CAP }, (_, i) => ({
    id: `d${i}`, user_id: "u1", category: "transfers", status: "sent", notification_ids: [], sent_at: `2026-10-13T${String(i + 4).padStart(2, "0")}:00:00.000Z`,
  }));
  // En levering fra i gaar taeller ikke med i dagens loft.
  deliveries.push({ id: "old", user_id: "u1", category: "transfers", status: "sent", notification_ids: [], sent_at: "2026-10-12T20:00:00.000Z" });
  const state = baseState({ deliveries, notifications: [freshNote("n1", "auction_won")] });
  const { calls, send } = sentRecorder();
  await runPushSweep({ supabase: createFakeSupabase(state), now: SWEEP_NOW, env: makeVapidEnv(), send });
  assert.equal(calls.length, 0);
  assert.deepEqual(state.push_queue.map((q) => q.reason), ["cap"]);
});

test("resumé-flush: koeede loebsresultater samles i ét push, allerede laeste tælles ikke med", async () => {
  const queued = "2026-10-13T09:00:00.000Z";
  const state = baseState({
    queue: [
      { id: "q1", user_id: "u1", notification_id: "r1", category: "races", reason: "digest", queued_at: queued },
      { id: "q2", user_id: "u1", notification_id: "r2", category: "races", reason: "digest", queued_at: queued },
      { id: "q3", user_id: "u1", notification_id: "r3", category: "races", reason: "digest", queued_at: queued },
    ],
    notifications: [
      { id: "r1", user_id: "u1", type: "stage_result", is_read: false, created_at: "2026-10-13T08:00:00.000Z" },
      { id: "r2", user_id: "u1", type: "stage_result", is_read: false, created_at: "2026-10-13T08:10:00.000Z" },
      { id: "r3", user_id: "u1", type: "stage_result", is_read: true, created_at: "2026-10-13T08:20:00.000Z" },
    ],
  });
  const { calls, send } = sentRecorder();
  const result = await runPushSweep({ supabase: createFakeSupabase(state), now: SWEEP_NOW, env: makeVapidEnv(), send });
  assert.equal(result.digests, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.body, "2 race results");
  assert.equal(calls[0].payload.tag, "races");
  assert.equal(state.push_queue.length, 0);
  assert.deepEqual(state.push_deliveries[0].notification_ids, ["r1", "r2"]);
});

test("beta-stadie: kun beta-testere og admins faar push", async () => {
  const notifications = [freshNote("n1", "transfer_offer_received")];
  const plain = baseState({ flag: "beta", notifications });
  const a = sentRecorder();
  await runPushSweep({ supabase: createFakeSupabase(plain), now: SWEEP_NOW, env: makeVapidEnv(), send: a.send });
  assert.equal(a.calls.length, 0);
  const tester = baseState({ flag: "beta", notifications, user: { is_beta_tester: true } });
  const b = sentRecorder();
  await runPushSweep({ supabase: createFakeSupabase(tester), now: SWEEP_NOW, env: makeVapidEnv(), send: b.send });
  assert.equal(b.calls.length, 1);
});

test("404/410 fra push-tjenesten sletter abonnementet med det samme", async () => {
  const state = baseState({ notifications: [freshNote("n1", "transfer_offer_received")] });
  const { send } = sentRecorder({ status: 410, gone: true, ok: false });
  await runPushSweep({ supabase: createFakeSupabase(state), now: SWEEP_NOW, env: makeVapidEnv(), send });
  assert.equal(state.push_subscriptions.length, 0);
  assert.equal(state.push_deliveries[0].status, "gone");
});

test("spiller uden abonnement: ingen opslag af hans profil, intet koeet", async () => {
  const state = baseState({ subs: false, notifications: [freshNote("n1", "transfer_offer_received")] });
  const { calls, send } = sentRecorder();
  await runPushSweep({ supabase: createFakeSupabase(state), now: SWEEP_NOW, env: makeVapidEnv(), send });
  assert.equal(calls.length, 0);
  assert.equal(state.push_queue.length, 0);
});
