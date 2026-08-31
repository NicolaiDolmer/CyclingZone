import test from "node:test";
import assert from "node:assert/strict";

import { resolveDmTargetFromInput } from "./discordDmTarget.js";
import { notifyBoardUpdateDM, notifyAuctionWon, notifyDiscordDM, notifyPlayerFeedback, sendWebhook, isLiveDiscordAllowed, getBotToken, __buildEmbedForTests } from "./discordNotifier.js";
import { DISCORD_EMBED_LIMITS } from "./discordEmbedLimits.js";
import { flushDmRunGuard, __resetDmRunGuardForTests } from "./discordDmRateGuard.js";
import { __resetWebhookQueueForTests } from "./discordWebhookQueue.js";

// Live-guard (#3961): CI kører med SUPABASE_URL=https://example.supabase.co, så
// uden denne opt-in ville guarden no-op'e alle send-stier og testene herunder
// ville aldrig nå deres injicerede fetchFn. Guard-adfærden selv testes eksplicit
// i "live-guard"-blokken nederst (som fjerner denne env-var igen midlertidigt).
process.env.DISCORD_LIVE_MESSAGING = "allow";

function makeCaptureSpy() {
  const calls = [];
  const fn = (error, context) => calls.push({ error, context });
  fn.calls = calls;
  return fn;
}

// Minimal fake Supabase query builder keyed by userId, same shape as
// discordDmRecipient.test.js's fakeClient — .from("users").select().eq("id",
// uid).single() -> { data }. "teams" is never hit in these tests (no teamId
// passed), so it just returns null harmlessly if it were.
function fakeUsersClient(usersByUid) {
  return {
    from(table) {
      let matchId;
      const builder = {
        select() { return builder; },
        eq(_col, value) { matchId = value; return builder; },
        async single() {
          if (table === "users") return { data: usersByUid[matchId] ?? null };
          return { data: null };
        },
      };
      return builder;
    },
  };
}

// #203: DM-routing-logik. Pure function — tester valg af target uden Supabase.
test("resolveDmTargetFromInput — test-konto tvinger stdout uanset env", () => {
  assert.equal(resolveDmTargetFromInput({ envValue: undefined, isTestAccount: true }), "stdout");
  assert.equal(resolveDmTargetFromInput({ envValue: "webhook", isTestAccount: true }), "stdout");
  assert.equal(resolveDmTargetFromInput({ envValue: "test-channel", isTestAccount: true }), "stdout");
  assert.equal(resolveDmTargetFromInput({ envValue: "stdout", isTestAccount: true }), "stdout");
});

test("resolveDmTargetFromInput — ægte manager respekterer env-var", () => {
  assert.equal(resolveDmTargetFromInput({ envValue: undefined, isTestAccount: false }), "webhook");
  assert.equal(resolveDmTargetFromInput({ envValue: "webhook", isTestAccount: false }), "webhook");
  assert.equal(resolveDmTargetFromInput({ envValue: "stdout", isTestAccount: false }), "stdout");
  assert.equal(resolveDmTargetFromInput({ envValue: "test-channel", isTestAccount: false }), "test-channel");
});

test("resolveDmTargetFromInput — ukendt env-værdi falder tilbage til webhook (bagudkompat)", () => {
  assert.equal(resolveDmTargetFromInput({ envValue: "bogus", isTestAccount: false }), "webhook");
  assert.equal(resolveDmTargetFromInput({ envValue: "", isTestAccount: false }), "webhook");
  assert.equal(resolveDmTargetFromInput({ envValue: null, isTestAccount: false }), "webhook");
});

// #2602: in-game feedback-knap — Discord-mirror er guarded af
// DISCORD_FEEDBACK_WEBHOOK_URL og må ALDRIG falde tilbage til default-webhooken
// (i modsætning til getOpsWebhookUrl), da spillerfeedback er umodereret fritekst
// og ikke må lække ind i en offentlig kanal ved et uheld.
test("notifyPlayerFeedback — no-op (sender intet) når DISCORD_FEEDBACK_WEBHOOK_URL ikke er sat", async () => {
  const original = process.env.DISCORD_FEEDBACK_WEBHOOK_URL;
  delete process.env.DISCORD_FEEDBACK_WEBHOOK_URL;
  try {
    const calls = [];
    await notifyPlayerFeedback({
      category: "bug",
      message: "Something broke",
      pagePath: "/team",
      teamName: "Team CSC",
      sendWebhookFn: async (...args) => calls.push(args),
    });
    assert.equal(calls.length, 0);
  } finally {
    if (original !== undefined) process.env.DISCORD_FEEDBACK_WEBHOOK_URL = original;
  }
});

test("notifyPlayerFeedback — poster embed til DISCORD_FEEDBACK_WEBHOOK_URL når sat", async () => {
  const original = process.env.DISCORD_FEEDBACK_WEBHOOK_URL;
  process.env.DISCORD_FEEDBACK_WEBHOOK_URL = "https://discord.com/api/webhooks/test/feedback";
  try {
    const calls = [];
    await notifyPlayerFeedback({
      category: "bug",
      message: "Something broke",
      pagePath: "/team",
      teamName: "Team CSC",
      sendWebhookFn: async (...args) => calls.push(args),
    });
    assert.equal(calls.length, 1);
    const [url, payload] = calls[0];
    assert.equal(url, "https://discord.com/api/webhooks/test/feedback");
    const embed = payload.embeds[0];
    assert.match(embed.title, /Bug report/);
    assert.equal(embed.description, "Something broke");
    assert.deepEqual(embed.fields, [
      { name: "Team", value: "Team CSC" },
      { name: "Page", value: "/team" },
    ]);
  } finally {
    if (original === undefined) delete process.env.DISCORD_FEEDBACK_WEBHOOK_URL;
    else process.env.DISCORD_FEEDBACK_WEBHOOK_URL = original;
  }
});

// #2569: board-cronsene kalder notifyBoardUpdateDM({ userId }). Tog signaturen
// kun teamId, blev userId droppet tavst og HVER bestyrelses-DM døde i
// [discord-dm:no-recipient] — uden Sentry-capture. Guarden asserter at begge
// identifikatorer når notifyDiscordDM.
test("notifyBoardUpdateDM — userId føres videre til notifyDiscordDM (#2569)", async () => {
  const calls = [];
  await notifyBoardUpdateDM({
    userId: "user-1",
    type: "board_critical",
    title: "The Board Is Unhappy",
    description: "Satisfaction is down.",
    notifyFn: async (args) => { calls.push(args); },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, "user-1");
  assert.equal(calls[0].type, "board_critical");
  assert.equal(calls[0].title, "The Board Is Unhappy");
});

test("notifyBoardUpdateDM — teamId virker stadig + default-type er board_update (#2569)", async () => {
  const calls = [];
  await notifyBoardUpdateDM({
    teamId: "team-1",
    title: "Board Update",
    description: "Plan accepted.",
    notifyFn: async (args) => { calls.push(args); },
  });

  assert.equal(calls[0].teamId, "team-1");
  assert.equal(calls[0].userId, null);
  assert.equal(calls[0].type, "board_update");
});

// #2571: notifyBoardUpdateDM er i produktionen KUN kaldt fra cron.js (board
// auto-accept + mid-season review). Default cronRun:true fodrer no-recipient-
// rate-guarden uden at hvert kald skal huske flaget; caller kan stadig
// override'e det eksplicit.
test("notifyBoardUpdateDM — cronRun default er true, føres videre til notifyFn (#2571)", async () => {
  const calls = [];
  await notifyBoardUpdateDM({
    userId: "user-1",
    type: "board_update",
    title: "Board Update",
    description: "Plan accepted.",
    notifyFn: async (args) => { calls.push(args); },
  });

  assert.equal(calls[0].cronRun, true);
});

test("notifyBoardUpdateDM — cronRun kan overrides eksplicit (#2571)", async () => {
  const calls = [];
  await notifyBoardUpdateDM({
    userId: "user-1",
    type: "board_update",
    title: "Board Update",
    description: "Plan accepted.",
    notifyFn: async (args) => { calls.push(args); },
    cronRun: false,
  });

  assert.equal(calls[0].cronRun, false);
});

// #2571: notifyAuctionWon har to kaldere (cron.js' finalizer-tick + admin-
// request-scopet /finalize). Default cronRun:false (ikke sat) sikrer at KUN
// cron.js' eksplicitte cronRun:true kan fodre rate-guarden — bruger vi
// teamId:null rammer notifyDiscordDM den DB-fri no-recipient-gren
// (resolveDmRecipient returnerer null uden query når både teamId og userId
// mangler), så testen kører uden Supabase.
test("notifyAuctionWon — cronRun default false rører aldrig rate-guarden (#2571)", async () => {
  __resetDmRunGuardForTests();
  const captureExceptionFn = makeCaptureSpy();

  for (let i = 0; i < 3; i++) {
    await notifyAuctionWon({ riderName: "Rider", finalPrice: 1000, teamId: null });
    flushDmRunGuard(["auction_won"], { captureExceptionFn });
  }

  assert.equal(captureExceptionFn.calls.length, 0);
});

// #3072: hver kørsel skal ramme minimums-samplet (5 forsøg) før "alle blev
// skippet" er andet end lav-volumen-støj — derfor 5 auktioner pr. tick, ikke 1.
test("notifyAuctionWon — cronRun:true fodrer rate-guarden og capturer efter 3 all-skipped kørsler (#2571)", async () => {
  __resetDmRunGuardForTests();
  const captureExceptionFn = makeCaptureSpy();

  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 5; j++) {
      await notifyAuctionWon({ riderName: `Rider ${j}`, finalPrice: 1000, teamId: null, cronRun: true });
    }
    flushDmRunGuard(["auction_won"], { captureExceptionFn });
  }

  assert.equal(captureExceptionFn.calls.length, 1);
  assert.deepEqual(captureExceptionFn.calls[0].context.fingerprint, ["discord-dm-all-skipped", "auction_won"]);
});

// #2571 post-merge-review (adversarisk gennemgang af #2609): recordDmAttempt
// blev talt FØR per-type-mute-tjekket og FØR selve sendDM-forsøget. Konsekvens
// i en blandet population: muted brugere talte som "leveret", hvilket udvander
// no-recipient-skip-raten væk fra 100% — guarden mod #2569-klassen ("alt
// fejler tavst") kunne derfor gå under radaren, selv når ALLE reelt
// afsendelige DM'er fejlede, blot fordi én bruger i kørslen havde muted typen.
//
// Denne test kører notifyDiscordDM (den ægte funktion, ikke notifyFn-stubbet)
// via en injiceret fake Supabase-client, og blander tre kategorier pr.
// "cron-kørsel":
//   - 2 muted brugere (per-type-toggle off) — må IKKE tælle med i det hele taget.
//   - 3 reelle no-recipients (mangler discord_id) — skal tælle som skip (uændret).
//   - 3 reelle modtagere hvor selve sendDM fejler (intet bot-token i env) — skal
//     tælle som skip, IKKE som leveret (#2571(b)-fixet).
// Skip-raten blandt de REELLE forsøg (6 af 8 pr. kørsel) skal stadig ramme
// 100% og udløse sentryCapture efter 3 kørsler i træk. De 6 reelle forsøg er
// samtidig over #3072's minimums-sample, så alarmen er signal og ikke støj —
// havde de muted brugere talt med i nævneren, ville raten være 6/8 = 75%.
test("notifyDiscordDM — muted tælles ikke med, sendDM-fejl tælles som skip, blandet population rammer stadig 100%-tærsklen (#2571)", async () => {
  __resetDmRunGuardForTests();
  const captureExceptionFn = makeCaptureSpy();

  // Fjern bot-token deterministisk så sendDM's "intet token"-gren rammes uden
  // netværkskald eller outbox-skrivning, uanset hvad lokal backend/.env har.
  const savedBotToken = process.env.DISCORD_BOT_TOKEN;
  const savedToken = process.env.DISCORD_TOKEN;
  delete process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_TOKEN;

  try {
    const client = fakeUsersClient({
      "muted-1": { discord_id: "d-muted-1", discord_dm_enabled: true, discord_dm_prefs: { board_update: false } },
      "muted-2": { discord_id: "d-muted-2", discord_dm_enabled: true, discord_dm_prefs: { board_update: false } },
      "real-1": { discord_id: "d-real-1", discord_dm_enabled: true, discord_dm_prefs: {} },
      "real-2": { discord_id: "d-real-2", discord_dm_enabled: true, discord_dm_prefs: {} },
      "real-3": { discord_id: "d-real-3", discord_dm_enabled: true, discord_dm_prefs: {} },
      "no-recipient-1": { discord_id: null, discord_dm_enabled: true, discord_dm_prefs: {} },
      "no-recipient-2": { discord_id: null, discord_dm_enabled: true, discord_dm_prefs: {} },
      "no-recipient-3": { discord_id: null, discord_dm_enabled: true, discord_dm_prefs: {} },
    });

    async function runOneCronTick() {
      for (const userId of [
        "muted-1", "muted-2",
        "real-1", "real-2", "real-3",
        "no-recipient-1", "no-recipient-2", "no-recipient-3",
      ]) {
        await notifyDiscordDM({
          userId,
          type: "board_update",
          title: "Board Update",
          description: "Plan accepted.",
          cronRun: true,
          client,
        });
      }
      flushDmRunGuard(["board_update"], { captureExceptionFn });
    }

    for (let i = 0; i < 3; i++) {
      await runOneCronTick();
    }

    assert.equal(captureExceptionFn.calls.length, 1);
    const { context } = captureExceptionFn.calls[0];
    assert.deepEqual(context.fingerprint, ["discord-dm-all-skipped", "board_update"]);
    // Kun de 6 reelle forsøg (real-1..3 + no-recipient-1..3) pr. kørsel tæller —
    // muted-1/muted-2 er slet ikke i nævneren. Ville de tælle som "leveret"
    // (den gamle bug), ville raten være 6/8 = 75% og aldrig udløse capture.
    assert.equal(context.extra.attempted, 6);
    assert.equal(context.extra.skipped, 6);
  } finally {
    if (savedBotToken === undefined) delete process.env.DISCORD_BOT_TOKEN; else process.env.DISCORD_BOT_TOKEN = savedBotToken;
    if (savedToken === undefined) delete process.env.DISCORD_TOKEN; else process.env.DISCORD_TOKEN = savedToken;
  }
});

// ── sendWebhook — #2882: 429-retry + synlig fejl-logning ────────────────────
// Rod-årsag 24/7: 1 af 4 tier-3-puljers resultatpost forsvandt tavst efter en
// Discord 429 — den gamle sendWebhook havde ingen retry og loggede kun med
// console.error. Disse tests dækker den fulde sendWebhook-sti (URL-safety +
// serialisering + attemptWebhookDelivery + Sentry-capture), ikke kun de rene
// delivery-modulers egne unit-tests.

function makeFetchSequence(responses) {
  const calls = [];
  let i = 0;
  const fetchFn = async (url, opts) => {
    calls.push({ url, opts });
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    if (next instanceof Error) throw next;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async () => JSON.stringify(next.body ?? {}),
      headers: { get: (name) => (next.headers && next.headers[name]) ?? null },
    };
  };
  return { fetchFn, calls };
}

const RESULT_WEBHOOK = "https://discord.com/api/webhooks/1/tier3-summary";
const noSleep = async () => {};

test.beforeEach(() => __resetWebhookQueueForTests());

test("sendWebhook — 429 med Retry-After → retry → succes, INGEN Sentry-capture ved endelig succes", async () => {
  const { fetchFn, calls } = makeFetchSequence([
    { status: 429, body: { retry_after: 0.001 } },
    { status: 204 },
  ]);
  const captureExceptionFn = makeCaptureSpy();

  await sendWebhook(RESULT_WEBHOOK, { embeds: [{ title: "Tour des Fjords" }] }, {
    fetchFn,
    sleepFn: noSleep,
    captureExceptionFn,
  });

  assert.equal(calls.length, 2);
  assert.equal(captureExceptionFn.calls.length, 0);
});

test("sendWebhook — permanent config-fejl (404, dødt webhook #2395) → Sentry-capture, uændret opførsel", async () => {
  const { fetchFn } = makeFetchSequence([{ status: 404, body: { message: "Unknown Webhook" } }]);
  const captureExceptionFn = makeCaptureSpy();

  await sendWebhook(RESULT_WEBHOOK, { embeds: [] }, { fetchFn, sleepFn: noSleep, captureExceptionFn });

  assert.equal(captureExceptionFn.calls.length, 1);
  assert.match(captureExceptionFn.calls[0].error.message, /404.*persistent config\/routing error/);
  assert.equal(captureExceptionFn.calls[0].context.tags.status, "404");
});

// Kerne-regressionstesten for selve #2882-bugreporten: en 429 der overlever
// ALLE retry-forsøg (permanent rate-limit, fx en vedvarende byge) må ikke
// forsvinde tavst — før #2882 gjorde den præcis det, med kun console.error.
//
// #3545 flyttede REDNINGEN et trin videre: beskeden droppes ikke længere, den
// lægges i discord_webhook_outbox og genforsøges over ~27 timer. Sentry-capturen
// flyttes tilsvarende til det tidspunkt hvor beskeden REELT er tabt (drainen,
// dækket i discordWebhookOutbox.test.js), så en kortvarig 5xx-krusning ikke
// længere ser ud som datatab.
test("sendWebhook — 429 overlever alle forsøg → lagt i outbox (#3545), ingen for tidlig capture", async () => {
  const { fetchFn, calls } = makeFetchSequence([{ status: 429, body: { retry_after: 0 } }]);
  const captureExceptionFn = makeCaptureSpy();
  const enqueued = [];

  await sendWebhook(RESULT_WEBHOOK, { embeds: [{ title: "Koerse van Nokere" }] }, {
    fetchFn,
    sleepFn: noSleep,
    captureExceptionFn,
    enqueueWebhookFn: async (args) => {
      enqueued.push(args);
      return { enqueued: true };
    },
  });

  assert.equal(calls.length, 4); // default maxAttempts i attemptWebhookDelivery
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].webhookUrl, RESULT_WEBHOOK);
  assert.deepEqual(enqueued[0].payload, { embeds: [{ title: "Koerse van Nokere" }] });
  assert.equal(enqueued[0].lastStatus, 429);
  assert.equal(captureExceptionFn.calls.length, 0, "beskeden er ikke tabt endnu — outbox'en har den");
});

// Hændelsen 7/8 22:21-22:23 i ren form: Discord svarer 503 i hele inline-vinduet
// og 8 auktions-annonceringer blev droppet permanent. Nu skal payloaden overleve.
test("sendWebhook — Discord-5xx-udfald (#3545-hændelsen) tabes ikke længere, men gemmes til genforsøg", async () => {
  const { fetchFn } = makeFetchSequence([{ status: 503, body: { message: "service unavailable" } }]);
  const captureExceptionFn = makeCaptureSpy();
  const enqueued = [];

  await sendWebhook(RESULT_WEBHOOK, { embeds: [{ title: "New Auction: Naoki Goto" }] }, {
    fetchFn,
    sleepFn: noSleep,
    captureExceptionFn,
    enqueueWebhookFn: async (args) => {
      enqueued.push(args);
      return { enqueued: true };
    },
  });

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].lastStatus, 503);
  assert.deepEqual(enqueued[0].payload, { embeds: [{ title: "New Auction: Naoki Goto" }] });
  assert.equal(captureExceptionFn.calls.length, 0);
});

// Fallback: hvis outbox-insertet selv fejler (defekt tabel, RLS-drift), falder vi
// tilbage til den gamle SYNLIGE adfærd frem for at fejle tavst.
test("sendWebhook — outbox-enqueue fejler → Sentry-capture som før #3545", async () => {
  const { fetchFn } = makeFetchSequence([{ status: 503, body: {} }]);
  const captureExceptionFn = makeCaptureSpy();

  await sendWebhook(RESULT_WEBHOOK, { embeds: [] }, {
    fetchFn,
    sleepFn: noSleep,
    captureExceptionFn,
    enqueueWebhookFn: async () => ({ enqueued: false }),
  });

  assert.equal(captureExceptionFn.calls.length, 1);
  const { error, context } = captureExceptionFn.calls[0];
  assert.match(error.message, /Discord webhook dropped after 4 attempt\(s\)/);
  assert.equal(context.tags.reason, "discord-5xx");
  assert.equal(context.extra.enqueued, false);
});

// Loop-vagt: outbox-drainens EGEN dead-alarm sender via sendWebhook. Uden
// enqueueOnFailure:false ville en fejlende alarm lægge sig selv i outbox'en og
// producere en ny række pr. drain-runde.
test("sendWebhook — enqueueOnFailure:false lægger IKKE i outbox (drainens dead-alarm)", async () => {
  const { fetchFn } = makeFetchSequence([{ status: 503, body: {} }]);
  const captureExceptionFn = makeCaptureSpy();
  let enqueueCalls = 0;

  await sendWebhook(RESULT_WEBHOOK, { embeds: [] }, {
    fetchFn,
    sleepFn: noSleep,
    captureExceptionFn,
    enqueueOnFailure: false,
    enqueueWebhookFn: async () => {
      enqueueCalls++;
      return { enqueued: true };
    },
  });

  assert.equal(enqueueCalls, 0);
  assert.equal(captureExceptionFn.calls.length, 1, "alarmen skal stadig være synlig i Sentry");
});

// Et dødt/fejlkonfigureret webhook (#2395) er permanent — det må ALDRIG i
// outbox'en, ellers bruger vi 27 timer på at prøve noget der aldrig kan lykkes.
test("sendWebhook — permanent config-fejl går IKKE i outbox (#3545 x #2395)", async () => {
  const { fetchFn } = makeFetchSequence([{ status: 404, body: { message: "Unknown Webhook" } }]);
  const captureExceptionFn = makeCaptureSpy();
  let enqueueCalls = 0;

  await sendWebhook(RESULT_WEBHOOK, { embeds: [] }, {
    fetchFn,
    sleepFn: noSleep,
    captureExceptionFn,
    enqueueWebhookFn: async () => {
      enqueueCalls++;
      return { enqueued: true };
    },
  });

  assert.equal(enqueueCalls, 0);
  assert.equal(captureExceptionFn.calls.length, 1);
  assert.match(captureExceptionFn.calls[0].error.message, /persistent config\/routing error/);
});

// #2882: to resultat-poster til SAMME webhook-URL (fx to puljer der begge
// rammer tier-samlekanalen inden for samme sekund) må aldrig sendes som en
// samtidig byge — serializeByUrl skal tvinge dem efter hinanden.
test("sendWebhook — to samtidige kald mod samme URL sendes sekventielt, ikke som byge", async () => {
  // Deterministisk overlap-detektion frem for wall-clock-måling: ms-baserede
  // asserts flaker på belastede CI-runnere (fik 14ms hvor 15 var krævet, 25/7).
  let inFlight = 0;
  let maxInFlight = 0;
  let posts = 0;
  const fetchFn = async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    posts += 1;
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return { ok: true, status: 204, text: async () => "{}", headers: { get: () => null } };
  };
  const captureExceptionFn = makeCaptureSpy();

  await Promise.all([
    sendWebhook(RESULT_WEBHOOK, { embeds: [{ title: "Pulje A" }] }, { fetchFn, sleepFn: noSleep, captureExceptionFn }),
    sendWebhook(RESULT_WEBHOOK, { embeds: [{ title: "Pulje B" }] }, { fetchFn, sleepFn: noSleep, captureExceptionFn }),
  ]);

  assert.equal(posts, 2);
  // Den 2. POST må ikke starte mens den 1. stadig er i flight.
  assert.equal(maxInFlight, 1, `forventede sekventiel afsendelse (max 1 i flight), fik ${maxInFlight} samtidige`);
  assert.equal(captureExceptionFn.calls.length, 0);
});

// ── Live-guard (#3961, incident 18/8-2026) ────────────────────────────────────
// En staging-backend mod en Supabase-branch (med kopieret discord_settings)
// postede re-simulerede resultater til de rigtige spillerkanaler. Guarden skal:
// prod-URL → tilladt · alt andet → blokeret · eksplicit allow-override → tilladt.

test("isLiveDiscordAllowed — prod-URL tilladt, staging/tom blokeret, override vinder", () => {
  assert.equal(isLiveDiscordAllowed({ SUPABASE_URL: "https://ghwvkxzhsbbltzfnuhhz.supabase.co" }), true);
  assert.equal(isLiveDiscordAllowed({ SUPABASE_URL: "https://bircbxynabqnypdpoovd.supabase.co" }), false);
  assert.equal(isLiveDiscordAllowed({ SUPABASE_URL: "https://example.supabase.co" }), false);
  assert.equal(isLiveDiscordAllowed({}), false);
  assert.equal(isLiveDiscordAllowed({ SUPABASE_URL: "https://example.supabase.co", DISCORD_LIVE_MESSAGING: "allow" }), true);
});

test("live-guard — sendWebhook no-op'er i ikke-prod-miljø (fetchFn røres aldrig)", async () => {
  const savedAllow = process.env.DISCORD_LIVE_MESSAGING;
  const savedUrl = process.env.SUPABASE_URL;
  delete process.env.DISCORD_LIVE_MESSAGING;
  process.env.SUPABASE_URL = "https://bircbxynabqnypdpoovd.supabase.co";
  try {
    __resetWebhookQueueForTests();
    let fetchCalls = 0;
    const captureExceptionFn = makeCaptureSpy();
    await sendWebhook("https://discord.com/api/webhooks/123/abc", { embeds: [{ title: "Staging-løb" }] }, {
      fetchFn: async () => { fetchCalls++; return { ok: true, status: 204, text: async () => "" }; },
      sleepFn: async () => {},
      captureExceptionFn,
    });
    assert.equal(fetchCalls, 0, "blokeret miljø må aldrig nå Discord");
    assert.equal(captureExceptionFn.calls.length, 0, "et blokeret send er ikke en fejl");
  } finally {
    process.env.DISCORD_LIVE_MESSAGING = savedAllow;
    process.env.SUPABASE_URL = savedUrl;
  }
});

test("live-guard — getBotToken returnerer null i ikke-prod-miljø (DM/rolle-sync/token-check no-op'er)", () => {
  const savedAllow = process.env.DISCORD_LIVE_MESSAGING;
  const savedUrl = process.env.SUPABASE_URL;
  const savedToken = process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_LIVE_MESSAGING;
  process.env.SUPABASE_URL = "https://bircbxynabqnypdpoovd.supabase.co";
  process.env.DISCORD_BOT_TOKEN = "fake-token-til-test";
  try {
    assert.equal(getBotToken(), null, "bot-API må ikke eksponeres udenfor prod");
  } finally {
    process.env.DISCORD_LIVE_MESSAGING = savedAllow;
    process.env.SUPABASE_URL = savedUrl;
    if (savedToken === undefined) delete process.env.DISCORD_BOT_TOKEN; else process.env.DISCORD_BOT_TOKEN = savedToken;
  }
});

// ── Embed-grænser i DM-payloaden (#3483, review af PR #4460) ─────────────────
// buildEmbed interpolerer rytter- og holdnavne direkte ind i title/description,
// og felt-værdier kommer fra kaldere der ikke kender Discords grænser. Sprænges
// en grænse svarer Discord 400 med kode 50035 — og fejlen rammer ALLE modtagere
// af den notifikation samtidig, ikke én bruger. Uden klipningen her var det en
// åben flok-afkoblings-vej ind i dead-connection-tælleren (#3130).
test("buildEmbed — klipper title, description og felter til Discords grænser (#3483)", () => {
  const { embeds } = __buildEmbedForTests(
    "auction_won",
    "R".repeat(500),
    "D".repeat(9000),
    [
      { name: "N".repeat(500), value: "V".repeat(5000) },
      ...Array.from({ length: 40 }, (_, i) => ({ name: `f${i}`, value: `v${i}` })),
    ]
  );

  const embed = embeds[0];
  assert.equal(embed.title.length, DISCORD_EMBED_LIMITS.title);
  assert.equal(embed.description.length, DISCORD_EMBED_LIMITS.description);
  assert.equal(embed.fields.length, DISCORD_EMBED_LIMITS.fields);
  assert.equal(embed.fields[0].name.length, DISCORD_EMBED_LIMITS.fieldName);
  assert.equal(embed.fields[0].value.length, DISCORD_EMBED_LIMITS.fieldValue);
  // Farve, footer og timestamp overlever klipningen uændret.
  assert.equal(embed.footer.text, "Cycling Zone");
  assert.equal(typeof embed.color, "number");
  assert.ok(embed.timestamp);
});

test("buildEmbed — normale længder passerer helt urørt (#3483)", () => {
  const { embeds } = __buildEmbedForTests("auction_won", "Tadej Pogacar", "Du vandt budrunden", [
    { name: "Price", value: "1.200.000 CZ$" },
  ]);
  assert.ok(embeds[0].title.endsWith("Tadej Pogacar"));
  assert.equal(embeds[0].description, "Du vandt budrunden");
  assert.deepEqual(embeds[0].fields, [{ name: "Price", value: "1.200.000 CZ$", inline: true }]);
});
