import test from "node:test";
import assert from "node:assert/strict";

import { isJwt, currentRealtimeToken, subscribeAuthedChannelWith } from "./realtimeChannelCore.js";

// Fake Supabase-klient. Registrerer hvad realtime faktisk fik at vide, så
// testene kan holde fast i at api-nøglen ALDRIG når frem som access_token.
function makeClient({ session = null } = {}) {
  const calls = { setAuth: [], channels: [], subscribed: [], removed: [], unsubscribed: 0 };
  let authListener = null;

  const client = {
    calls,
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange(cb) {
        authListener = cb;
        return { data: { subscription: { unsubscribe: () => { calls.unsubscribed += 1; } } } };
      },
    },
    realtime: {
      setAuth: async (token) => { calls.setAuth.push(token); },
    },
    channel(name) {
      const ch = {
        name,
        handlers: [],
        on(...args) { ch.handlers.push(args); return ch; },
        subscribe() { calls.subscribed.push(name); return ch; },
      };
      calls.channels.push(ch);
      return ch;
    },
    removeChannel(ch) { calls.removed.push(ch.name); },
    // Testhjælpere
    setSession(next) { session = next; },
    emitAuth(event) { authListener?.(event); },
  };
  return client;
}

const JWT = "aaa.bbb.ccc";
const PUBLISHABLE_KEY = "sb_publishable_C83bkExample";

test("#4010 isJwt afviser den opake publishable key", () => {
  assert.equal(isJwt(JWT), true);
  assert.equal(isJwt(PUBLISHABLE_KEY), false, "sb_publishable_… er ikke en JWT");
  assert.equal(isJwt("sb_secret_AirP8Example"), false);
  assert.equal(isJwt(undefined), false);
  assert.equal(isJwt(null), false);
  assert.equal(isJwt("kun.to"), false);
});

test("#4010 currentRealtimeToken returnerer null uden session", async () => {
  assert.equal(await currentRealtimeToken(makeClient()), null);
});

test("#4010 currentRealtimeToken returnerer sessionens access token", async () => {
  const client = makeClient({ session: { access_token: JWT } });
  assert.equal(await currentRealtimeToken(client), JWT);
});

test("#4010 uden session abonneres der IKKE", async () => {
  // Kernen i fixet. Før abonnerede kaldstedet ubetinget, og supabase-js sendte
  // api-nøglen som access_token → MalformedJWT, 7.727 gange i døgnet.
  const client = makeClient();
  const teardown = subscribeAuthedChannelWith(client, "test-channel", (ch) => ch);
  await teardown.armed;

  assert.deepEqual(client.calls.channels, []);
  assert.deepEqual(client.calls.subscribed, []);
  assert.deepEqual(client.calls.setAuth, []);
  teardown();
});

test("#4010 med session sættes token FØR subscribe", async () => {
  const client = makeClient({ session: { access_token: JWT } });
  const teardown = subscribeAuthedChannelWith(client, "test-channel", (ch) =>
    ch.on("postgres_changes", { table: "notifications" }, () => {}));
  await teardown.armed;

  assert.deepEqual(client.calls.setAuth, [JWT]);
  assert.deepEqual(client.calls.subscribed, ["test-channel"]);
  assert.equal(client.calls.channels[0].handlers.length, 1, "configure skal have påført sin handler");
  teardown();
});

test("#4010 en session der først dukker op senere armer på auth-eventet", async () => {
  // INITIAL_SESSION er asynkron, så en komponent kan mounte før sessionen er
  // læst fra storage. Uden re-arm ville kanalen aldrig komme op.
  const client = makeClient();
  const teardown = subscribeAuthedChannelWith(client, "late-channel", (ch) => ch);
  await teardown.armed;
  assert.deepEqual(client.calls.subscribed, []);

  client.setSession({ access_token: JWT });
  client.emitAuth("INITIAL_SESSION");
  await new Promise((r) => setTimeout(r, 0));

  assert.deepEqual(client.calls.setAuth, [JWT]);
  assert.deepEqual(client.calls.subscribed, ["late-channel"]);
  teardown();
});

test("#4010 gentagne auth-events giver ikke dobbelt-abonnement", async () => {
  const client = makeClient({ session: { access_token: JWT } });
  const teardown = subscribeAuthedChannelWith(client, "once-channel", (ch) => ch);
  await teardown.armed;

  client.emitAuth("TOKEN_REFRESHED");
  client.emitAuth("TOKEN_REFRESHED");
  await new Promise((r) => setTimeout(r, 0));

  assert.deepEqual(client.calls.subscribed, ["once-channel"]);
  teardown();
});

test("#4010 SIGNED_OUT river kanalen ned", async () => {
  const client = makeClient({ session: { access_token: JWT } });
  const teardown = subscribeAuthedChannelWith(client, "out-channel", (ch) => ch);
  await teardown.armed;

  client.setSession(null);
  client.emitAuth("SIGNED_OUT");

  assert.deepEqual(client.calls.removed, ["out-channel"]);
  teardown();
});

test("#4010 cleanup fjerner kanalen og auth-lytteren", async () => {
  const client = makeClient({ session: { access_token: JWT } });
  const teardown = subscribeAuthedChannelWith(client, "cleanup-channel", (ch) => ch);
  await teardown.armed;

  teardown();

  assert.deepEqual(client.calls.removed, ["cleanup-channel"]);
  assert.equal(client.calls.unsubscribed, 1);
});

test("#4010 unmount før token'et er hentet abonnerer ikke bagefter", async () => {
  // Race-guarden: getSession() er asynkron, så cleanup kan nå at køre imens.
  // Uden guarden ville vi abonnere på en kanal ingen længere lytter på.
  const client = makeClient({ session: { access_token: JWT } });
  const teardown = subscribeAuthedChannelWith(client, "unmounted-channel", (ch) => ch);
  teardown();
  await teardown.armed;

  assert.deepEqual(client.calls.channels, []);
  assert.deepEqual(client.calls.subscribed, []);
});

test("#4244 configure uden return abonnerer stadig - ingen undefined.subscribe()", async () => {
  // Regressionen fra #4238: forum-abonnementets callback havde blok-body og
  // glemte `return channel`. `configure(...)` gav undefined, og
  // `undefined.subscribe()` kastede en unhandled rejection ved hver mount —
  // 8 spillere ramt på 12 minutter i prod 25/8 (Sentry CYCLINGZONE-4X).
  const client = makeClient({ session: { access_token: JWT } });
  const teardown = subscribeAuthedChannelWith(client, "forgot-return", (ch) => {
    ch.on("postgres_changes", { table: "forum_posts" }, () => {});
    // intet return — præcis kaldstilen fra Layout.jsx
  });
  await teardown.armed;

  assert.deepEqual(client.calls.subscribed, ["forgot-return"], "kanalen skal abonneres alligevel");
  assert.equal(client.calls.channels[0].handlers.length, 1, "handleren skal stadig sidde på");

  // Og cleanup skal kunne rive netop den kanal ned igen.
  teardown();
  assert.deepEqual(client.calls.removed, ["forgot-return"]);
});
