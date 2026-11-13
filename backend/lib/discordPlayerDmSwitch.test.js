// #8149 trin 1 · Hovedafbryderen for bottens private Discord-beskeder.
//
// Tre lag:
//   1. Kontakten selv (værdier, sidst kendte værdi ved læsefejl, husketid).
//   2. De fire steder i discordNotifier/discordRaceDigestSweep, med kontakten
//      off og on. Kontakten læses her gennem den ÆGTE vej: modulets egen
//      supabase-klient → readFlagStage → app_config, via en netværks-router der
//      er installeret FØR modulet importeres (klienten fanger globalThis.fetch
//      ved oprettelse). Routeren svarer selv på alt; intet når netværket.
//   3. "on er som i dag": samme Discord-kald (adresser og indhold) og samme
//      databasekald pr. besked som uden kontakten, bortset fra én husket læsning.
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";
process.env.DISCORD_LIVE_MESSAGING = "allow";
process.env.DISCORD_BOT_TOKEN = "test-bot-token";
delete process.env.DISCORD_TOKEN;
delete process.env.DISCORD_DM_TARGET;

const SUPABASE_REST = "https://example.supabase.co/rest/v1/";
const DISCORD_OPEN_DM = "https://discord.com/api/v10/users/@me/channels";
const DISCORD_POST_DM = /^https:\/\/discord\.com\/api\/v10\/channels\/[^/]+\/messages$/;

/** Hvad app_config svarer for discord_player_dm. `undefined` = ingen række. */
const net = { appConfigValue: "on", appConfigFails: false, calls: [] };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : (input?.url ?? String(input));
  const method = String(init.method || input?.method || "GET").toUpperCase();
  const body = typeof init.body === "string" ? init.body : null;
  net.calls.push({ url, method, body });
  if (url.startsWith(SUPABASE_REST)) {
    const table = new URL(url).pathname.slice("/rest/v1/".length);
    if (table === "app_config") {
      if (net.appConfigFails) return jsonResponse({ message: "simulated read failure", code: "XX000" }, 400);
      const rows = net.appConfigValue === undefined ? [] : [{ value: net.appConfigValue }];
      const accept = new Headers(init.headers || {}).get("accept") || "";
      if (accept.includes("vnd.pgrst.object")) return rows.length ? jsonResponse(rows[0]) : jsonResponse({ message: "0 rows" }, 406);
      return jsonResponse(rows);
    }
    return jsonResponse([]); // users-opdatering, outbox-select m.m.: tomt svar
  }
  if (url === DISCORD_OPEN_DM) return jsonResponse({ id: "dm-channel-1" });
  if (DISCORD_POST_DM.test(url)) return jsonResponse({ id: "message-1" });
  throw new Error(`uventet netværkskald i test: ${method} ${url}`);
};

const { isDiscordPlayerDmEnabled, __resetDiscordPlayerDmSwitchForTests, DISCORD_PLAYER_DM_KEY } = await import("./discordPlayerDmSwitch.js");
const { FLAG_CACHE_TTL_MS, FRESH_FLAG_KEYS, clearFlagStageCache, readFlagStage } = await import("./featureStage.js");
const notifier = await import("./discordNotifier.js");
const { runDiscordRaceDigestSweep } = await import("./discordRaceDigestSweep.js");
const { flushDmRunGuard, __resetDmRunGuardForTests } = await import("./discordDmRateGuard.js");
const { findStageFlag } = await import("./stageFlagCatalog.js");

function reset({ value = "on", fails = false } = {}) {
  clearFlagStageCache();
  __resetDiscordPlayerDmSwitchForTests();
  net.appConfigValue = value;
  net.appConfigFails = fails;
  net.calls.length = 0;
}

const discordCalls = () => net.calls.filter((c) => c.url.startsWith("https://discord.com/"));
const dbCalls = (table) => net.calls.filter((c) => c.url.startsWith(`${SUPABASE_REST}${table}`));
const allDbCalls = () => net.calls.filter((c) => c.url.startsWith(SUPABASE_REST));

async function withConsoleCapture(fn) {
  const lines = [];
  const saved = { warn: console.warn, error: console.error, info: console.info, log: console.log };
  for (const level of Object.keys(saved)) console[level] = (...args) => lines.push({ level, text: args.map(String).join(" ") });
  try {
    return { result: await fn(), lines };
  } finally {
    Object.assign(console, saved);
  }
}

const PAYLOAD = { embeds: [{ title: "Outbid", description: "test", color: 1 }] };

// ── 1. Kontakten selv ───────────────────────────────────────────────────────

test("kontakten: on, true og beta sender; off og false sender intet", async () => {
  const client = {};
  for (const [value, expected] of [["on", true], [true, true], ["beta", true], ["off", false], [false, false]]) {
    __resetDiscordPlayerDmSwitchForTests();
    assert.equal(await isDiscordPlayerDmEnabled(client, { read: async () => value }), expected, `værdi ${JSON.stringify(value)}`);
  }
});

test("kontakten: læsefejl ved opstart = on (som i dag)", async () => {
  __resetDiscordPlayerDmSwitchForTests();
  assert.equal(await isDiscordPlayerDmEnabled({}, { read: async () => null }), true);
  // Den ægte læser på en klient der kaster: readFlagStage giver null, kontakten on.
  clearFlagStageCache();
  const broken = { from() { throw new Error("db nede"); } };
  assert.equal(await isDiscordPlayerDmEnabled(broken), true);
});

test("kontakten: læsefejl efter off holder off; efter on holder on (sidst kendte værdi)", async () => {
  __resetDiscordPlayerDmSwitchForTests();
  const offClient = {};
  assert.equal(await isDiscordPlayerDmEnabled(offClient, { read: async () => "off" }), false);
  assert.equal(await isDiscordPlayerDmEnabled(offClient, { read: async () => null }), false, "en fejl må aldrig tænde en slukket kontakt");
  const onClient = {};
  assert.equal(await isDiscordPlayerDmEnabled(onClient, { read: async () => "on" }), true);
  assert.equal(await isDiscordPlayerDmEnabled(onClient, { read: async () => null }), true);
  // Pr. klient: offClient er stadig off.
  assert.equal(await isDiscordPlayerDmEnabled(offClient, { read: async () => null }), false);
});

test("kontakten: husketid højst et minut, og nøglen er ikke tvunget frisk pr. besked", async () => {
  assert.equal(DISCORD_PLAYER_DM_KEY, "discord_player_dm");
  assert.ok(FLAG_CACHE_TTL_MS <= 60_000, "en slukning skal virke inden for cirka et minut");
  assert.equal(FRESH_FLAG_KEYS.has(DISCORD_PLAYER_DM_KEY), false, "ellers et databasekald pr. besked");
  clearFlagStageCache();
  let reads = 0;
  const client = {
    from() {
      reads += 1;
      const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: { value: "on" }, error: null }) };
      return b;
    },
  };
  await isDiscordPlayerDmEnabled(client);
  await isDiscordPlayerDmEnabled(client);
  await readFlagStage(client, DISCORD_PLAYER_DM_KEY);
  assert.equal(reads, 1, "tre opslag inden for husketiden = ét databasekald");
});

test("kontakten står i admin-kataloget under notifikationer", () => {
  const entry = findStageFlag(DISCORD_PLAYER_DM_KEY);
  assert.ok(entry, "discord_player_dm mangler i STAGE_FLAGS");
  assert.equal(entry.area, "notifications");
});

// ── 2. sendDM ───────────────────────────────────────────────────────────────

test("sendDM off: ingen besked, ingen udbakke, ingen token-advarsel", async () => {
  reset({ value: "off" });
  const { result, lines } = await withConsoleCapture(() => notifier.sendDM("discord-user-1", PAYLOAD));
  assert.equal(result, false);
  assert.equal(discordCalls().length, 0, "intet kald til Discord");
  assert.deepEqual(allDbCalls().map((c) => c.url.split("?")[0]), [`${SUPABASE_REST}app_config`], "kun kontakten læses");
  assert.equal(lines.length, 0, "ingen log-linjer pr. besked ved slukket kontakt");
});

test("sendDM on: leverer som i dag (åbn kanal + send)", async () => {
  reset({ value: "on" });
  const delivered = await notifier.sendDM("discord-user-1", PAYLOAD);
  assert.equal(delivered, true);
  const calls = discordCalls();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, DISCORD_OPEN_DM);
  assert.match(calls[1].url, DISCORD_POST_DM);
  assert.deepEqual(JSON.parse(calls[1].body), PAYLOAD);
});

test("sendDM on er som i dag: samme Discord-kald og samme databasekald pr. besked, bortset fra én husket læsning", async () => {
  const run = async () => {
    for (let i = 0; i < 3; i++) await notifier.sendDM(`discord-user-${i}`, { ...PAYLOAD, embeds: [{ ...PAYLOAD.embeds[0], description: `msg ${i}` }] });
    return net.calls.map((c) => ({ ...c }));
  };

  // Med kontakten (ægte læsning, on).
  reset({ value: "on" });
  const withSwitch = await run();

  // Uden kontakten: læseren erstattet af "on", dvs. koden som før #8149.
  reset({ value: "on" });
  const restore = notifier.__setPlayerDmSwitchForTests(async () => true);
  let withoutSwitch;
  try {
    withoutSwitch = await run();
  } finally {
    restore();
  }

  const isSwitchRead = (c) => c.url.startsWith(`${SUPABASE_REST}app_config`);
  assert.equal(withSwitch.filter(isSwitchRead).length, 1, "tre beskeder = én husket læsning");
  assert.equal(withoutSwitch.filter(isSwitchRead).length, 0);
  assert.deepEqual(withSwitch.filter((c) => !isSwitchRead(c)), withoutSwitch, "alt andet er bit for bit ens");
});

test("sendDM: læsefejl efter off holder beskeden tilbage; læsefejl ved opstart sender som i dag", async () => {
  reset({ value: "off" });
  assert.equal(await notifier.sendDM("discord-user-1", PAYLOAD), false);
  clearFlagStageCache(); // husketiden udløbet
  net.appConfigFails = true;
  net.calls.length = 0;
  assert.equal(await notifier.sendDM("discord-user-1", PAYLOAD), false);
  assert.equal(discordCalls().length, 0, "sidst kendte værdi (off) holder");

  reset({ value: "on", fails: true });
  assert.equal(await notifier.sendDM("discord-user-1", PAYLOAD), true, "ingen kendt værdi = on");
  assert.equal(discordCalls().length, 2);
});

// ── 3. Udbakkens gentagelser ────────────────────────────────────────────────

test("drainDiscordDmOutbox off: rækkerne røres ikke, ingen levering, ingen alarm", async () => {
  reset({ value: "off" });
  const result = await notifier.drainDiscordDmOutbox({ now: new Date("2026-11-13T20:00:00Z") });
  assert.deepEqual(result, { processed: 0, sent: 0, rescheduled: 0, dead: 0, skippedReason: "discord_player_dm_off" });
  assert.equal(dbCalls("discord_dm_outbox").length, 0, "ingen select, ingen dead-markering");
  assert.equal(discordCalls().length, 0, "hverken levering eller død-alarm via webhook");
});

test("drainDiscordDmOutbox on: tømmer udbakken som i dag", async () => {
  reset({ value: "on" });
  const result = await notifier.drainDiscordDmOutbox({ now: new Date("2026-11-13T20:00:00Z") });
  assert.equal(result.processed, 0);
  assert.equal(result.skippedReason, undefined);
  assert.equal(dbCalls("discord_dm_outbox").length, 1, "udbakken læses");
});

// ── 4. Testknappen ──────────────────────────────────────────────────────────

test("sendTestDM off: venlig fejl i spillerens sprog, intet sendt", async () => {
  reset({ value: "off" });
  await assert.rejects(notifier.sendTestDM("discord-user-1", { language: "en" }), (err) => {
    assert.equal(err.message, "I've switched off Discord messages for now, so no test message was sent.");
    return true;
  });
  await assert.rejects(notifier.sendTestDM("discord-user-1", { language: "da" }), (err) => {
    assert.equal(err.message, "Jeg har slået Discord-beskeder fra indtil videre, så der blev ikke sendt en testbesked.");
    return true;
  });
  assert.equal(discordCalls().length, 0);
});

test("sendTestDM on: sender testbeskeden som i dag", async () => {
  reset({ value: "on" });
  await notifier.sendTestDM("discord-user-1", { language: "en" });
  const calls = discordCalls();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, DISCORD_OPEN_DM);
  assert.equal(JSON.parse(calls[1].body).embeds[0].title, "✅ Discord DM works");
});

// ── notifyDiscordDM: slukket er ikke en fejlet levering ─────────────────────

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

async function runThreeCronTicks() {
  __resetDmRunGuardForTests();
  const captured = [];
  const captureExceptionFn = (error, context) => captured.push({ error, context });
  // Blandet population: 5 koblede og 5 uden discord_id (no-recipient-grenen).
  const users = Object.fromEntries([
    ...[1, 2, 3, 4, 5].map((i) => [`u${i}`, { discord_id: `d${i}`, discord_dm_enabled: true, discord_dm_prefs: {} }]),
    ...[6, 7, 8, 9, 10].map((i) => [`u${i}`, { discord_id: null, discord_dm_enabled: true, discord_dm_prefs: {} }]),
  ]);
  const client = fakeUsersClient(users);
  for (let tick = 0; tick < 3; tick++) {
    for (const userId of Object.keys(users)) {
      await notifier.notifyDiscordDM({ userId, type: "board_update", title: "Board Update", description: "Plan accepted.", cronRun: true, client });
    }
    flushDmRunGuard(["board_update"], { captureExceptionFn });
  }
  return captured;
}

test("notifyDiscordDM off: ingen falsk 'alle DM'er skippet'-alarm fra rate-guarden", async () => {
  reset({ value: "off" });
  const { result: captured } = await withConsoleCapture(() => runThreeCronTicks());
  assert.equal(captured.length, 0, "hverken koblede eller ukoblede modtagere tæller, når kontakten er slukket");
  assert.equal(discordCalls().length, 0);
});

test("notifyDiscordDM on: rate-guarden alarmerer stadig, når leveringen reelt fejler (som i dag)", async () => {
  reset({ value: "on" });
  const savedToken = process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_BOT_TOKEN;
  try {
    const { result: captured } = await withConsoleCapture(() => runThreeCronTicks());
    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0].context.fingerprint, ["discord-dm-all-skipped", "board_update"]);
    assert.equal(captured[0].context.extra.attempted, 10, "koblede og ukoblede tæller som i dag");
  } finally {
    process.env.DISCORD_BOT_TOKEN = savedToken;
  }
});

// ── 5. Løbsresuméet kl. 20 ──────────────────────────────────────────────────

const IN_WINDOW_NOW = new Date("2026-07-20T18:15:00Z"); // 20:15 i København (CEST)

function makeDigestSupabase({ switchValue }) {
  const touched = [];
  const digestLogInserts = [];
  return {
    touched,
    digestLogInserts,
    from(table) {
      touched.push(table);
      if (table === "app_config") {
        const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: { value: switchValue }, error: null }) };
        return b;
      }
      if (table === "discord_race_digest_log") {
        return {
          select: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }),
          insert: async (row) => { digestLogInserts.push(row); return { error: null }; },
        };
      }
      if (table === "users") {
        return { select() { return this; }, in: async () => ({ data: [{ id: "u1", discord_id: "d1", discord_dm_enabled: true }], error: null }) };
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
}

const digestRows = async () => [{
  race_id: "r1", stage_number: null, result_type: "gc", rank: 1,
  race: { id: "r1", name: "Race A" }, team: { user_id: "u1" },
}];

test("løbsresumé off: hele sweepen springes over, ingen logrækker, ingen besked", async () => {
  clearFlagStageCache();
  __resetDiscordPlayerDmSwitchForTests();
  const supabase = makeDigestSupabase({ switchValue: "off" });
  let sends = 0;
  let fetched = 0;
  const result = await runDiscordRaceDigestSweep({
    supabase,
    now: IN_WINDOW_NOW,
    fetchRows: async (...args) => { fetched += 1; return digestRows(...args); },
    fetchRaceNarrative: async () => null,
    sendDigestDM: async () => { sends += 1; },
  });
  assert.deepEqual(result, { candidates: 0, sent: 0, skipped: 0, failed: 0, skippedReason: "discord_player_dm_off" });
  assert.equal(fetched, 0, "intet læses, når kontakten er slukket");
  assert.equal(sends, 0);
  assert.equal(supabase.digestLogInserts.length, 0, "ingen logrække for et resumé, der aldrig blev sendt");
  assert.deepEqual(supabase.touched, ["app_config"]);
});

test("løbsresumé on: kører som i dag (samme resultat og samme logrække som uden kontakten)", async () => {
  const run = async (extra) => {
    clearFlagStageCache();
    __resetDiscordPlayerDmSwitchForTests();
    const supabase = makeDigestSupabase({ switchValue: "on" });
    const sent = [];
    const result = await runDiscordRaceDigestSweep({
      supabase,
      now: IN_WINDOW_NOW,
      fetchRows: digestRows,
      fetchRaceNarrative: async () => null,
      sendDigestDM: async (args) => { sent.push(args); },
      ...extra,
    });
    return { result, sent, inserts: supabase.digestLogInserts, touched: supabase.touched };
  };
  const withSwitch = await run({});
  const withoutSwitch = await run({ isPlayerDmEnabled: async () => true });
  assert.equal(withSwitch.result.sent, 1);
  assert.deepEqual(withSwitch.result, withoutSwitch.result);
  assert.deepEqual(withSwitch.sent, withoutSwitch.sent);
  assert.deepEqual(withSwitch.inserts, withoutSwitch.inserts);
  assert.deepEqual(withSwitch.touched.filter((t) => t !== "app_config"), withoutSwitch.touched);
  assert.equal(withSwitch.touched.filter((t) => t === "app_config").length, 1);
});
