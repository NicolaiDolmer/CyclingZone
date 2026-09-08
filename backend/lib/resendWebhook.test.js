import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  handleResendWebhook,
  verifyResendSignature,
  isHardBounce,
  statusAdvances,
  SIGNATURE_TOLERANCE_MS,
} from "./resendWebhook.js";

const SECRET_BYTES = Buffer.from("cycling-zone-webhook-secret-0123", "utf8");
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;

function sign({ id, timestampSec, body }) {
  return `v1,${createHmac("sha256", SECRET_BYTES).update(`${id}.${timestampSec}.${body}`).digest("base64")}`;
}

/** Byg et helt request/response-par som Express ville levere det. */
function makeReqRes({ id = "msg_1", now = new Date(), body, skewMs = 0, badSignature = false, headers = {} } = {}) {
  const raw = Buffer.from(JSON.stringify(body), "utf8");
  const timestampSec = Math.floor((now.getTime() + skewMs) / 1000);
  const built = {
    "svix-id": id,
    "svix-timestamp": String(timestampSec),
    "svix-signature": badSignature ? "v1,bm90LWEtc2lnbmF0dXJlLWF0LWFsbC0wMDAwMA==" : sign({ id, timestampSec, body: raw.toString("utf8") }),
    ...headers,
  };
  const statuses = [];
  return {
    statuses,
    req: { body: raw, get: (name) => built[name.toLowerCase()] },
    res: { sendStatus: (code) => { statuses.push(code); return code; } },
  };
}

/**
 * Supabase-dobbelt for de fire tabeller webhooken roerer. `eventInsertError`
 * simulerer UNIQUE-conflict (idempotens-testen).
 */
function makeSupabase({ logRow = null, userRow = { email_prefs: {} }, userByEmail = null, eventInsertError = null } = {}) {
  const state = { eventInserts: [], eventUpdates: [], logUpdates: [], userUpdates: [], userEmailLookups: [] };
  return {
    state,
    from(table) {
      if (table === "email_events") {
        return {
          insert: async (row) => {
            state.eventInserts.push(row);
            return { error: eventInsertError };
          },
          update(row) {
            return { eq: async () => { state.eventUpdates.push(row); return { error: null }; } };
          },
        };
      }
      if (table === "email_log") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: logRow, error: null }) }) }),
          update(row) {
            return { eq: async (_col, id) => { state.logUpdates.push({ id, row }); return { error: null }; } };
          },
        };
      }
      if (table === "users") {
        return {
          // `eq`-kolonnen skiller de to opslag ad: 'email' er
          // recipient-fallbacken i findUserForEvent, 'id' er prefs-laesningen
          // i suppressUser.
          select: () => ({
            eq: (col, value) => ({
              maybeSingle: async () => {
                if (col === "email") {
                  state.userEmailLookups.push(value);
                  return { data: userByEmail, error: null };
                }
                return { data: userRow, error: null };
              },
            }),
          }),
          update(row) {
            return { eq: async (_col, id) => { state.userUpdates.push({ id, row }); return { error: null }; } };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

const bouncedBody = (bounce) => ({
  type: "email.bounced",
  created_at: "2026-09-08T10:00:00Z",
  data: { email_id: "re_123", to: ["player@example.com"], subject: "Welcome", bounce },
});

// ─── signatur ────────────────────────────────────────────────────────────────

test("gyldig signatur accepteres og returnerer svix-id'et", () => {
  const now = new Date("2026-09-08T10:00:00Z");
  const body = JSON.stringify({ type: "email.sent" });
  const timestampSec = Math.floor(now.getTime() / 1000);
  const headers = {
    "svix-id": "msg_ok",
    "svix-timestamp": String(timestampSec),
    "svix-signature": sign({ id: "msg_ok", timestampSec, body }),
  };
  const res = verifyResendSignature({
    getHeader: (n) => headers[n], rawBody: Buffer.from(body, "utf8"), secret: SECRET, now,
  });
  assert.deepEqual(res, { ok: true, eventId: "msg_ok" });
});

test("forkert signatur afvises med 401 og roerer aldrig databasen", async () => {
  const supabase = { from() { throw new Error("maa ikke ramme databasen"); } };
  const { req, res, statuses } = makeReqRes({ body: { type: "email.sent" }, badSignature: true });
  await handleResendWebhook({ req, res, supabase, secret: SECRET, captureExceptionFn: () => {} });
  assert.deepEqual(statuses, [401]);
});

test("manglende svix-headere afvises med 401", async () => {
  const supabase = { from() { throw new Error("maa ikke ramme databasen"); } };
  const raw = Buffer.from(JSON.stringify({ type: "email.sent" }), "utf8");
  const statuses = [];
  await handleResendWebhook({
    req: { body: raw, get: () => undefined },
    res: { sendStatus: (c) => statuses.push(c) },
    supabase, secret: SECRET, captureExceptionFn: () => {},
  });
  assert.deepEqual(statuses, [401]);
});

test("usat RESEND_WEBHOOK_SECRET afviser alt med 401 (fail-closed)", async () => {
  const supabase = { from() { throw new Error("maa ikke ramme databasen"); } };
  const { req, res, statuses } = makeReqRes({ body: { type: "email.sent" } });
  await handleResendWebhook({ req, res, supabase, secret: undefined, captureExceptionFn: () => {} });
  assert.deepEqual(statuses, [401]);
});

test("replay: et timestamp aeldre end tolerancen afvises med 400, selv med korrekt signatur", async () => {
  const supabase = { from() { throw new Error("maa ikke ramme databasen"); } };
  const { req, res, statuses } = makeReqRes({
    body: { type: "email.sent" }, skewMs: -(SIGNATURE_TOLERANCE_MS + 60_000),
  });
  await handleResendWebhook({ req, res, supabase, secret: SECRET, captureExceptionFn: () => {} });
  assert.deepEqual(statuses, [400]);
});

test("replay: et timestamp langt FORUD afvises ogsaa (ur-drift i begge retninger)", async () => {
  const supabase = { from() { throw new Error("maa ikke ramme databasen"); } };
  const { req, res, statuses } = makeReqRes({
    body: { type: "email.sent" }, skewMs: SIGNATURE_TOLERANCE_MS + 60_000,
  });
  await handleResendWebhook({ req, res, supabase, secret: SECRET, captureExceptionFn: () => {} });
  assert.deepEqual(statuses, [400]);
});

// ─── idempotens ──────────────────────────────────────────────────────────────

test("gen-levering af samme svix-id (UNIQUE-conflict) kvitteres 200 uden sideeffekter", async () => {
  const supabase = makeSupabase({
    logRow: { id: "log-1", user_id: "user-1", email_type: "welcome", status: "sent" },
    eventInsertError: { code: "23505", message: "duplicate key" },
  });
  const { req, res, statuses } = makeReqRes({ body: bouncedBody({ type: "Permanent", subType: "General" }) });
  await handleResendWebhook({ req, res, supabase, secret: SECRET, captureExceptionFn: () => {} });

  assert.deepEqual(statuses, [200]);
  assert.equal(supabase.state.userUpdates.length, 0, "ingen undertrykkelse ved gen-levering");
  assert.equal(supabase.state.logUpdates.length, 0, "ingen status-opdatering ved gen-levering");
});

// ─── bounce ──────────────────────────────────────────────────────────────────

test("haard bounce undertrykker brugeren og loefter email_log til 'bounced'", async () => {
  const supabase = makeSupabase({
    logRow: { id: "log-1", user_id: "user-1", email_type: "welcome", status: "sent" },
    userRow: { email_prefs: { day1: false } },
  });
  const { req, res, statuses } = makeReqRes({ body: bouncedBody({ type: "Permanent", subType: "General", message: "no such user" }) });
  await handleResendWebhook({ req, res, supabase, secret: SECRET, captureExceptionFn: () => {} });

  assert.deepEqual(statuses, [200]);
  assert.equal(supabase.state.logUpdates[0].row.status, "bounced");
  const prefs = supabase.state.userUpdates[0].row.email_prefs;
  assert.equal(prefs.all, false);
  assert.equal(prefs.suppressed_reason, "bounce");
  assert.ok(prefs.suppressed_at, "suppressed_at skal saettes");
  assert.equal(prefs.day1, false, "eksisterende opt-outs skal bevares (merge, ikke overskrivning)");
});

test("bloed bounce logges men undertrykker ALDRIG brugeren", async () => {
  const supabase = makeSupabase({ logRow: { id: "log-1", user_id: "user-1", email_type: "welcome", status: "sent" } });
  const { req, res, statuses } = makeReqRes({ body: bouncedBody({ type: "Transient", subType: "MailboxFull" }) });
  await handleResendWebhook({ req, res, supabase, secret: SECRET, captureExceptionFn: () => {} });

  assert.deepEqual(statuses, [200]);
  assert.equal(supabase.state.userUpdates.length, 0);
  assert.equal(supabase.state.eventInserts.length, 1, "eventet skal stadig vaere logget");
});

test("isHardBounce vurderer type og subType hver for sig", () => {
  // Regressionen fund 8/9 fangede: subType "General" er den generiske default
  // og optraeder paa BEGGE sider. Transient/General er den almindeligste
  // BLOEDE bounce der findes; en flad markoer-liste gjorde den haard og
  // undertrykte gyldige spillere permanent.
  assert.equal(isHardBounce({ type: "Transient", subType: "General" }), false);
  assert.equal(isHardBounce({ type: "Permanent", subType: "General" }), true);
  assert.equal(isHardBounce({ type: "Permanent", subType: "NoEmail" }), true);
  assert.equal(isHardBounce({ type: "Transient", subType: "MailboxFull" }), false);
  assert.equal(isHardBounce({ type: "Undetermined", subType: "Undetermined" }), false);
  // subType alene raekker for de tre "adressen findes ikke"-varianter.
  assert.equal(isHardBounce({ type: "Undetermined", subType: "NoEmail" }), true);
  assert.equal(isHardBounce({ type: "Undetermined", subType: "Suppressed" }), true);
  assert.equal(isHardBounce({ type: "Transient", subType: "OnAccountSuppressionList" }), true);
  // Normalisering: mellemrum/underscore/bindestreg og versalier er ligegyldige.
  assert.equal(isHardBounce({ type: "permanent" }), true);
  assert.equal(isHardBounce({ type: "Transient", sub_type: "no_email" }), true);
  assert.equal(isHardBounce({ type: "Transient", subType: "ContentRejected" }), false);
  assert.equal(isHardBounce({}), false);
  assert.equal(isHardBounce(null), false);
});

test("bloed Transient/General bounce undertrykker ALDRIG brugeren", async () => {
  const supabase = makeSupabase({ logRow: { id: "log-1", user_id: "user-1", email_type: "welcome", status: "sent" } });
  const { req, res, statuses } = makeReqRes({ body: bouncedBody({ type: "Transient", subType: "General" }) });

  await handleResendWebhook({ req, res, supabase, secret: SECRET, captureExceptionFn: () => {} });

  assert.deepEqual(statuses, [200]);
  assert.equal(supabase.state.userUpdates.length, 0, "en bloed bounce maa aldrig saette email_prefs.all = false");
});

test("bounce paa EMAIL_REPLY_FORWARD_TO rammer ALDRIG ejerens egen konto", async () => {
  // En `Fwd:`-videresendelse af et spillersvar skrives aldrig i email_log. Uden
  // guarden faldt en bounce/klage paa den igennem til recipient-fallbacken,
  // fandt ejerens brugerraekke paa email og undertrykte ham fra hele
  // mail-loopet (fund 8/9, review-runde 2).
  const supabase = makeSupabase({ logRow: null, userByEmail: { id: "owner-1" } });
  const { req, res, statuses } = makeReqRes({
    body: {
      type: "email.bounced",
      created_at: "2026-09-08T10:00:00Z",
      data: { email_id: "re_fwd", to: ["Dolmer@Example.com"], bounce: { type: "Permanent", subType: "General" } },
    },
  });

  await handleResendWebhook({
    req, res, supabase, secret: SECRET, forwardTo: "dolmer@example.com", captureExceptionFn: () => {},
  });

  assert.deepEqual(statuses, [200]);
  assert.equal(supabase.state.userEmailLookups.length, 0, "fallbacken maa slet ikke slaa op paa forward-adressen");
  assert.equal(supabase.state.userUpdates.length, 0, "ejeren maa ALDRIG undertrykkes af sin egen videresendelse");
  assert.equal(supabase.state.eventInserts.length, 1, "eventet skal stadig vaere logget");
});

test("bounce paa en almindelig modtager bruger stadig recipient-fallbacken", async () => {
  const supabase = makeSupabase({ logRow: null, userByEmail: { id: "user-9" } });
  const { req, res } = makeReqRes({ body: bouncedBody({ type: "Permanent", subType: "General" }) });

  await handleResendWebhook({
    req, res, supabase, secret: SECRET, forwardTo: "dolmer@example.com", captureExceptionFn: () => {},
  });

  assert.deepEqual(supabase.state.userEmailLookups, ["player@example.com"]);
  assert.equal(supabase.state.userUpdates.length, 1);
  assert.equal(supabase.state.userUpdates[0].row.email_prefs.all, false);
});

// ─── klage ───────────────────────────────────────────────────────────────────

test("klage undertrykker brugeren og sender ÉN ops-alarm med mention", async () => {
  const supabase = makeSupabase({ logRow: { id: "log-1", user_id: "user-1", email_type: "race_digest", status: "sent" } });
  const posts = [];
  const { req, res, statuses } = makeReqRes({
    body: {
      type: "email.complained",
      created_at: "2026-09-08T10:00:00Z",
      data: { email_id: "re_9", to: ["angry@example.com"], subject: "Digest" },
    },
  });
  await handleResendWebhook({
    req, res, supabase, secret: SECRET, captureExceptionFn: () => {},
    sendWebhookFn: async (url, payload) => posts.push({ url, payload }),
    getOpsWebhookFn: async () => "https://discord.example/ops",
  });

  assert.deepEqual(statuses, [200]);
  assert.equal(supabase.state.userUpdates[0].row.email_prefs.suppressed_reason, "complaint");
  assert.equal(supabase.state.logUpdates[0].row.status, "complained");
  assert.equal(posts.length, 1, "praecis én alarm pr. klage");
  assert.ok(posts[0].payload.embeds[0].title.includes("klage"));
});

// ─── status-raekkefoelge + ukendt event ──────────────────────────────────────

test("statusAdvances flytter kun fremad", () => {
  assert.equal(statusAdvances("sent", "delivered"), true);
  assert.equal(statusAdvances("delivered", "bounced"), true);
  assert.equal(statusAdvances("bounced", "delivered"), false, "en forsinket 'delivered' maa ikke overskrive en bounce");
  assert.equal(statusAdvances("complained", "delivered"), false);
});

test("delivered loefter email_log fra sent til delivered", async () => {
  const supabase = makeSupabase({ logRow: { id: "log-1", user_id: "user-1", email_type: "welcome", status: "sent" } });
  const { req, res, statuses } = makeReqRes({
    body: { type: "email.delivered", created_at: "2026-09-08T10:00:00Z", data: { email_id: "re_1", to: ["a@b.dk"] } },
  });
  await handleResendWebhook({ req, res, supabase, secret: SECRET, captureExceptionFn: () => {} });
  assert.deepEqual(statuses, [200]);
  assert.equal(supabase.state.logUpdates[0].row.status, "delivered");
});

test("ukendt event logges i email_events og kvitteres 200 uden sideeffekt", async () => {
  const supabase = makeSupabase({ logRow: { id: "log-1", user_id: "user-1", email_type: "welcome", status: "sent" } });
  const { req, res, statuses } = makeReqRes({
    body: { type: "email.opened", created_at: "2026-09-08T10:00:00Z", data: { email_id: "re_1", to: ["a@b.dk"] } },
  });
  await handleResendWebhook({ req, res, supabase, secret: SECRET, captureExceptionFn: () => {} });

  assert.deepEqual(statuses, [200]);
  assert.equal(supabase.state.eventInserts.length, 1);
  assert.equal(supabase.state.logUpdates.length, 0);
  assert.equal(supabase.state.userUpdates.length, 0);
});

// ─── indgaaende svar ─────────────────────────────────────────────────────────

test("email.received videresender til EMAIL_REPLY_FORWARD_TO med replyTo = afsenderen", async () => {
  const supabase = makeSupabase({});
  const sends = [];
  const resendFactory = () => ({
    emails: {
      receiving: {
        get: async () => ({
          data: { id: "in_1", subject: "Spoergsmaal om mit hold", from: "player@example.com", text: "Hej Dolmer, hvordan ...", html: null },
          error: null,
        }),
      },
      send: async (payload) => { sends.push(payload); return { data: { id: "re_out" }, error: null }; },
    },
  });
  const { req, res, statuses } = makeReqRes({
    body: { type: "email.received", created_at: "2026-09-08T10:00:00Z", data: { email_id: "in_1", from: "player@example.com", to: ["hej@cyclingzone.org"] } },
  });

  await handleResendWebhook({
    req, res, supabase, secret: SECRET, resendFactory, forwardTo: "dolmer@example.com", captureExceptionFn: () => {},
  });

  assert.deepEqual(statuses, [200]);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].subject, "Fwd: Spoergsmaal om mit hold");
  assert.deepEqual(sends[0].to, ["dolmer@example.com"]);
  // camelCase: det er SDK-feltet resend@6 mapper til wire-feltet reply_to.
  assert.deepEqual(sends[0].replyTo, ["player@example.com"]);
  assert.equal(sends[0].reply_to, undefined, "et snake_case-felt ville blive smidt vaek af SDK'et");
  assert.ok(supabase.state.eventUpdates[0].payload.inbound_excerpt.startsWith("Hej Dolmer"));
});

test("email.received uden EMAIL_REPLY_FORWARD_TO springes over uden at kaste", async () => {
  const supabase = makeSupabase({});
  const resendFactory = () => { throw new Error("maa ikke kalde Resend uden forward-adresse"); };
  const { req, res, statuses } = makeReqRes({
    body: { type: "email.received", created_at: "2026-09-08T10:00:00Z", data: { email_id: "in_1", from: "p@e.dk", to: ["hej@cyclingzone.org"] } },
  });
  await handleResendWebhook({
    req, res, supabase, secret: SECRET, resendFactory, forwardTo: "", captureExceptionFn: () => {},
  });
  assert.deepEqual(statuses, [200]);
  assert.equal(supabase.state.eventInserts.length, 1);
});
