import test from "node:test";
import assert from "node:assert/strict";

import {
  DISCORD_WELCOME_CLAIM_LEASE_MS,
  DISCORD_WELCOME_FALLBACK_WINDOW_MS,
  isDiscordWelcomeDue,
  isDiscordWelcomeSchemaPending,
  runDiscordWelcomeSweep,
} from "./discordWelcomeSweep.js";
import { DISCORD_WELCOME_TYPE } from "./discordWelcomeNotification.js";

// #5130 · Ren beslutningsfunktion: draft-taerskel ELLER 24t-fallback.

test("isDiscordWelcomeDue: naar loebs-klar taersklen er naaet (8 ryttere)", () => {
  const now = new Date("2026-09-14T12:00:00Z");
  assert.equal(
    isDiscordWelcomeDue({ team: { created_at: now.toISOString() }, activeRiders: 8, now }),
    true,
  );
});

test("isDiscordWelcomeDue: under taersklen OG under 24t → ikke moden endnu", () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const created = new Date(now.getTime() - 60 * 60 * 1000); // 1t siden
  assert.equal(
    isDiscordWelcomeDue({ team: { created_at: created.toISOString() }, activeRiders: 3, now }),
    false,
  );
});

test("isDiscordWelcomeDue: under taersklen men 24t+ gammel → fallback udloeser", () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const created = new Date(now.getTime() - DISCORD_WELCOME_FALLBACK_WINDOW_MS - 1000);
  assert.equal(
    isDiscordWelcomeDue({ team: { created_at: created.toISOString() }, activeRiders: 0, now }),
    true,
  );
});

test("isDiscordWelcomeDue: praecis paa 24t-graensen udloeser (>=)", () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const created = new Date(now.getTime() - DISCORD_WELCOME_FALLBACK_WINDOW_MS);
  assert.equal(
    isDiscordWelcomeDue({ team: { created_at: created.toISOString() }, activeRiders: 0, now }),
    true,
  );
});

test("isDiscordWelcomeDue: intet created_at → false (defensivt)", () => {
  assert.equal(isDiscordWelcomeDue({ team: {}, activeRiders: 8, now: new Date() }), false);
});

// #5130 haerdning 15/9 · schema-readiness-guard (CodeRabbit minor,
// discordWelcomeSweep.js:31) — samme recipe som
// isSelectionReminderMigrationPending/isMissingRetryColumnError.

test("isDiscordWelcomeSchemaPending: Postgres 42703 (undefined_column) → true", () => {
  assert.equal(isDiscordWelcomeSchemaPending({ code: "42703", message: "column does not exist" }), true);
});

test("isDiscordWelcomeSchemaPending: PostgREST PGRST204/PGRST205 → true", () => {
  assert.equal(isDiscordWelcomeSchemaPending({ code: "PGRST204" }), true);
  assert.equal(isDiscordWelcomeSchemaPending({ code: "PGRST205" }), true);
});

test("isDiscordWelcomeSchemaPending: besked naevner kolonnen/schema cache uden kendt kode → true", () => {
  assert.equal(
    isDiscordWelcomeSchemaPending({ code: "PGRST100", message: "column teams.discord_welcome_sent_at does not exist" }),
    true,
  );
  assert.equal(isDiscordWelcomeSchemaPending({ message: "schema cache is stale" }), true);
});

// WAVE-FOLLOWUP-fund 15/9: guarden daekker nu OGSAA claim-kolonnen
// (discord_welcome_claimed_at), ikke kun sent_at — samme deploy-vindue.
test("isDiscordWelcomeSchemaPending: besked naevner claim-kolonnen uden kendt kode → true", () => {
  assert.equal(
    isDiscordWelcomeSchemaPending({
      code: "PGRST100",
      message: "column teams.discord_welcome_claimed_at does not exist",
    }),
    true,
  );
});

test("isDiscordWelcomeSchemaPending: uafhaengig fejl → false", () => {
  assert.equal(isDiscordWelcomeSchemaPending({ code: "23505", message: "duplicate key" }), false);
  assert.equal(isDiscordWelcomeSchemaPending(null), false);
});

function makeNoopSupabase() {
  return { from: () => ({}) };
}

// Fake "mark sendt"-supabase: efterligner .update(...).eq("id", …).is(col,
// null) — det betingede skriv der SKER EFTER notify() i den nye raekkefoelge
// (rent bogfoering, ikke en laas). Registrerer forsoeg i rækkefølge sammen
// med notify-kald via et fælles `order`-array, så testene kan bevise at
// notify() altid kommer FØR markeringen (CodeRabbit major, linje ~105).
// CodeRabbit-fund (denne runde): de to array'er (order/marks) blev tidligere
// ført hver for sig, så en regression der markerede FØR notify() stadig
// kunne bestå begge assertions isoleret. `order` er nu det FÆLLES,
// delte bevis — marking pushes ind i det samme array som notify() —
// så assertion på `order` alene beviser den fulde rækkefølge.
function makeMarkingSupabase({ markError = null, order = null } = {}) {
  const marks = [];
  return {
    marks,
    supabase: {
      from(table) {
        if (table !== "teams") throw new Error(`uventet tabel: ${table}`);
        return {
          update(_patch) {
            return {
              eq(_col, id) {
                return {
                  is() {
                    order?.push(`mark:${id}`);
                    marks.push(id);
                    return Promise.resolve({ error: markError });
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}

// Langt de fleste tests i denne fil drejer sig om notify/mark-adfaerd, ikke
// selve claim-mekanikken — de injicerer denne no-op "claimet altid" for at
// holde fokus. Selve defaultClaimTeam (den ægte, atomiske query) har sin
// egen dedikerede test-gruppe nedenfor (makeClaimingSupabase).
const alwaysClaims = async () => true;

// Fake claim-supabase: efterligner den ÆGTE defaultClaimTeam-kaede
// .update(...).eq("id", …).is("discord_welcome_sent_at", null).or(…).select("id")
// — bruges KUN af testene der verificerer selve claim-mekanikken (query-form
// + vinder/taber-udfald), ikke af de oevrige notify/mark-fokuserede tests.
function makeClaimingSupabase({ claimedRows = [] } = {}) {
  const calls = [];
  return {
    calls,
    supabase: {
      from(table) {
        if (table !== "teams") throw new Error(`uventet tabel: ${table}`);
        return {
          update(patch) {
            return {
              eq(col, id) {
                if (col !== "id") throw new Error(`uventet .eq-kolonne: ${col}`);
                return {
                  is(col2, val2) {
                    if (col2 !== "discord_welcome_sent_at" || val2 !== null) {
                      throw new Error(`uventet .is-betingelse: ${col2}=${val2}`);
                    }
                    return {
                      or(orExpr) {
                        calls.push({ patch, id, orExpr });
                        return {
                          select(_cols) {
                            return Promise.resolve({ data: claimedRows, error: null });
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}

test("runDiscordWelcomeSweep: modne hold notify'es FOERST + markeres BAGEFTER, umodne springes over", async () => {
  const order = [];
  const { supabase, marks } = makeMarkingSupabase({ order });
  const now = new Date("2026-09-14T12:00:00Z");

  const stats = await runDiscordWelcomeSweep({
    supabase,
    now,
    claimTeam: alwaysClaims,
    notify: async (payload) => {
      order.push(`notify:${payload.userId}`);
      return { delivered: true };
    },
    fetchCandidateTeams: async () => [
      { id: "t1", user_id: "u1", created_at: now.toISOString() }, // moden via ryttertal
      { id: "t2", user_id: "u2", created_at: now.toISOString() }, // umoden, for ny
    ],
    fetchActiveRiderCounts: async () => new Map([["t1", 8], ["t2", 1]]),
  });

  assert.equal(stats.candidates, 2);
  assert.equal(stats.sent, 1);
  assert.equal(stats.skipped, 1);
  assert.equal(stats.failed, 0);
  assert.deepEqual(order, ["notify:u1", "mark:t1"], "beviser den FULDE raekkefoelge: notify FOER mark, i samme delte log");
  assert.deepEqual(marks, ["t1"], "markeringen skal ske EFTER notify, kun for det modne hold");
});

test("runDiscordWelcomeSweep: notify() returnerer deduped (selv-helet efter tidligere crash) → markeres stadig, ingen ny besked", async () => {
  const { supabase, marks } = makeMarkingSupabase();
  const now = new Date("2026-09-14T12:00:00Z");

  const stats = await runDiscordWelcomeSweep({
    supabase,
    now,
    claimTeam: alwaysClaims,
    notify: async () => ({ delivered: false, deduped: true, reason: "recent_duplicate" }),
    fetchCandidateTeams: async () => [{ id: "t1", user_id: "u1", created_at: now.toISOString() }],
    fetchActiveRiderCounts: async () => new Map([["t1", 8]]),
  });

  assert.equal(stats.sent, 1);
  assert.equal(stats.skipped, 0);
  assert.deepEqual(marks, ["t1"]);
});

test("runDiscordWelcomeSweep: notify() hverken leverer eller dedupliker (fx missing_user) → springes over, INGEN markering", async () => {
  const { supabase, marks } = makeMarkingSupabase();
  const now = new Date("2026-09-14T12:00:00Z");

  const stats = await runDiscordWelcomeSweep({
    supabase,
    now,
    claimTeam: alwaysClaims,
    notify: async () => ({ delivered: false, deduped: false, reason: "missing_user" }),
    fetchCandidateTeams: async () => [{ id: "t1", user_id: "u1", created_at: now.toISOString() }],
    fetchActiveRiderCounts: async () => new Map([["t1", 8]]),
  });

  assert.equal(stats.sent, 0);
  assert.equal(stats.skipped, 1);
  assert.deepEqual(marks, [], "uden leveret/deduplikeret notifikation skal der IKKE markeres");
});

test("runDiscordWelcomeSweep: ingen kandidater → tomt resultat, ingen kald", async () => {
  const stats = await runDiscordWelcomeSweep({
    supabase: makeNoopSupabase(),
    notify: async () => { throw new Error("skal ikke kaldes"); },
    fetchCandidateTeams: async () => [],
    fetchActiveRiderCounts: async () => { throw new Error("skal ikke kaldes"); },
  });
  assert.deepEqual(stats, { candidates: 0, sent: 0, skipped: 0, failed: 0 });
});

test("runDiscordWelcomeSweep: schema mangler endnu (kolonnen ikke migreret) → tomt resultat, log-varsel, intet kast", async () => {
  const now = new Date("2026-09-14T12:00:00Z");
  let fetchActiveCalled = false;

  const stats = await runDiscordWelcomeSweep({
    supabase: makeNoopSupabase(),
    now,
    notify: async () => { throw new Error("skal ikke kaldes"); },
    fetchCandidateTeams: async () => {
      const err = new Error('column teams.discord_welcome_sent_at does not exist');
      err.code = "42703";
      throw err;
    },
    fetchActiveRiderCounts: async () => { fetchActiveCalled = true; return new Map(); },
  });

  assert.deepEqual(stats, { candidates: 0, sent: 0, skipped: 0, failed: 0 });
  assert.equal(fetchActiveCalled, false);
});

test("runDiscordWelcomeSweep: en UKENDT fejl fra fetchCandidateTeams kastes videre (kun schema-pending haandteres tavst)", async () => {
  await assert.rejects(
    runDiscordWelcomeSweep({
      supabase: makeNoopSupabase(),
      fetchCandidateTeams: async () => { throw new Error("noget helt andet gik galt"); },
      fetchActiveRiderCounts: async () => new Map(),
    }),
    /noget helt andet gik galt/,
  );
});

test("runDiscordWelcomeSweep: notify() fejler (kastet) → isoleres som failed, INGEN markering, INGEN rollback noedvendig", async () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const { supabase, marks } = makeMarkingSupabase();
  let captured = null;

  const stats = await runDiscordWelcomeSweep({
    supabase,
    now,
    claimTeam: alwaysClaims,
    notify: async () => { throw new Error("Supabase midlertidigt nede"); },
    fetchCandidateTeams: async () => [{ id: "t1", user_id: "u1", created_at: now.toISOString() }],
    fetchActiveRiderCounts: async () => new Map([["t1", 8]]),
    captureExceptionFn: (err) => { captured = err; },
  });

  assert.equal(stats.failed, 1);
  assert.equal(stats.sent, 0);
  assert.deepEqual(marks, [], "et fejlet notify skal IKKE markere holdet som sendt");
  assert.match(captured?.message || "", /Supabase midlertidigt nede/);
});

test("runDiscordWelcomeSweep: markeringen fejler EFTER leveret notify → capture, men holdet taeller stadig som sendt", async () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const { supabase, marks } = makeMarkingSupabase({ markError: { message: "netvaerksfejl" } });
  let captured = null;

  const stats = await runDiscordWelcomeSweep({
    supabase,
    now,
    claimTeam: alwaysClaims,
    notify: async () => ({ delivered: true }),
    fetchCandidateTeams: async () => [{ id: "t1", user_id: "u1", created_at: now.toISOString() }],
    fetchActiveRiderCounts: async () => new Map([["t1", 8]]),
    captureExceptionFn: (err) => { captured = err; },
  });

  assert.equal(stats.sent, 1, "notifikationen ER leveret — en fejlet markering er ikke en fejlet afsendelse");
  assert.equal(stats.failed, 0);
  assert.deepEqual(marks, ["t1"], "markeringen SKAL vaere forsoegt");
  assert.match(captured?.message || "", /kunne ikke markere hold t1 som sendt/);
});

test("runDiscordWelcomeSweep: et fejlet hold isoleres, resten af sweepen fortsaetter", async () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const { supabase, marks } = makeMarkingSupabase();
  const notified = [];

  const stats = await runDiscordWelcomeSweep({
    supabase,
    now,
    claimTeam: alwaysClaims,
    notify: async (payload) => {
      if (payload.userId === "u1") throw new Error("boom");
      notified.push(payload);
      return { delivered: true };
    },
    fetchCandidateTeams: async () => [
      { id: "t1", user_id: "u1", created_at: now.toISOString() },
      { id: "t2", user_id: "u2", created_at: now.toISOString() },
    ],
    fetchActiveRiderCounts: async () => new Map([["t1", 8], ["t2", 8]]),
    captureExceptionFn: () => {},
  });

  assert.equal(stats.failed, 1);
  assert.equal(stats.sent, 1);
  assert.deepEqual(marks, ["t2"]);
  assert.equal(notified.length, 1);
  assert.equal(notified[0].userId, "u2");
  assert.equal(notified[0].type, DISCORD_WELCOME_TYPE);
});

// ─── WAVE-FOLLOWUP-fund 15/9: race-sikring (claim MED UDLOEB) ──────────────
// Reviewerens fund: raekkefoelge-haerdningen (notify FOER mark) fjernede den
// atomiske laas mod at to sweep-ticks BEGGE naar notify() for samme hold,
// uden at erstatte den — haerdnings-letterens punkt 1 kraevede netop dette
// bevaret. Disse tests beviser (a) at claimet reelt GATER notify (et tabt
// kapløb sender INGEN besked), og (b) at defaultClaimTeam bygger den
// forventede atomiske, betingede UPDATE med udloeb.

test("runDiscordWelcomeSweep: claim vundet → notify KALDES, i den rigtige raekkefoelge (claim FOER notify FOER mark)", async () => {
  const order = [];
  const { supabase, marks } = makeMarkingSupabase({ order });
  const now = new Date("2026-09-14T12:00:00Z");

  const stats = await runDiscordWelcomeSweep({
    supabase,
    now,
    claimTeam: async ({ teamId }) => { order.push(`claim:${teamId}`); return true; },
    notify: async (payload) => { order.push(`notify:${payload.userId}`); return { delivered: true }; },
    fetchCandidateTeams: async () => [{ id: "t1", user_id: "u1", created_at: now.toISOString() }],
    fetchActiveRiderCounts: async () => new Map([["t1", 8]]),
  });

  assert.equal(stats.sent, 1);
  assert.deepEqual(order, ["claim:t1", "notify:u1", "mark:t1"], "claim skal ske FOER notify, som igen skal ske FOER mark");
  assert.deepEqual(marks, ["t1"]);
});

test("runDiscordWelcomeSweep: TABT kapløb om claimet (en anden tick vandt) → INGEN notify, INGEN markering, ikke en fejl", async () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const { supabase, marks } = makeMarkingSupabase();
  let notifyCalled = false;
  let captured = null;

  const stats = await runDiscordWelcomeSweep({
    supabase,
    now,
    claimTeam: async () => false, // 0 raekker ramt af den betingede UPDATE
    notify: async () => { notifyCalled = true; return { delivered: true }; },
    fetchCandidateTeams: async () => [{ id: "t1", user_id: "u1", created_at: now.toISOString() }],
    fetchActiveRiderCounts: async () => new Map([["t1", 8]]),
    captureExceptionFn: (err) => { captured = err; },
  });

  assert.equal(stats.sent, 0);
  assert.equal(stats.skipped, 1);
  assert.equal(stats.failed, 0);
  assert.equal(notifyCalled, false, "notify() maa ALDRIG kaldes uden et vundet claim — det er selve race-sikringen");
  assert.deepEqual(marks, []);
  assert.equal(captured, null, "et tabt kapløb er normalt, ikke en fejl der skal raabes op om");
});

test("runDiscordWelcomeSweep: claim-kaldet fejler (fx netvaerksfejl) → isoleres som failed, INGEN notify", async () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const { supabase, marks } = makeMarkingSupabase();
  let notifyCalled = false;
  let captured = null;

  const stats = await runDiscordWelcomeSweep({
    supabase,
    now,
    claimTeam: async () => { throw new Error("claim-opslag fejlede"); },
    notify: async () => { notifyCalled = true; return { delivered: true }; },
    fetchCandidateTeams: async () => [{ id: "t1", user_id: "u1", created_at: now.toISOString() }],
    fetchActiveRiderCounts: async () => new Map([["t1", 8]]),
    captureExceptionFn: (err) => { captured = err; },
  });

  assert.equal(stats.failed, 1);
  assert.equal(stats.sent, 0);
  assert.equal(notifyCalled, false);
  assert.deepEqual(marks, []);
  assert.match(captured?.message || "", /claim-opslag fejlede/);
});

test("defaultClaimTeam (via runDiscordWelcomeSweep uden override): bygger korrekt atomisk UPDATE og vinder naar raekker rammes", async () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const { supabase, marks } = makeMarkingSupabase();
  const { supabase: claimSupabase, calls } = makeClaimingSupabase({ claimedRows: [{ id: "t1" }] });

  // Én supabase-instans skal daekke BEGGE tabeller ("teams" bruges af claim
  // OG mark) — kombinér de to fakes' "teams"-implementering vha. et lille
  // sekventielt-kald-flag, saa claim rammer claimSupabase's chain foerst,
  // og markeringen (som sker EFTER claimet i samme kaldsraekkefoelge for
  // samme hold) rammer markingSupabase's chain derefter.
  let updateCallCount = 0;
  const combined = {
    from(table) {
      updateCallCount += 1;
      // Foerste .from("teams") pr. hold er claimet, andet er markeringen —
      // matcher praecis raekkefoelgen defaultClaimTeam/mark-koden selv bruger.
      return updateCallCount === 1 ? claimSupabase.from(table) : supabase.from(table);
    },
  };

  const stats = await runDiscordWelcomeSweep({
    supabase: combined,
    now,
    notify: async () => ({ delivered: true }),
    fetchCandidateTeams: async () => [{ id: "t1", user_id: "u1", created_at: now.toISOString() }],
    fetchActiveRiderCounts: async () => new Map([["t1", 8]]),
  });

  assert.equal(stats.sent, 1);
  assert.deepEqual(marks, ["t1"]);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0].patch), ["discord_welcome_claimed_at"]);
  assert.equal(calls[0].patch.discord_welcome_claimed_at, now.toISOString());
  assert.equal(calls[0].id, "t1");
  const expectedCutoff = new Date(now.getTime() - DISCORD_WELCOME_CLAIM_LEASE_MS).toISOString();
  assert.equal(
    calls[0].orExpr,
    `discord_welcome_claimed_at.is.null,discord_welcome_claimed_at.lt.${expectedCutoff}`,
    "claimet skal acceptere BAADE aldrig-claimet (is.null) OG et claim aeldre end leasen (lt.<udloebstidspunkt>)",
  );
});

test("defaultClaimTeam (via runDiscordWelcomeSweep uden override): 0 raekker ramt → taber kapløbet, ingen notify", async () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const { supabase: claimSupabase, calls } = makeClaimingSupabase({ claimedRows: [] });
  let notifyCalled = false;

  const stats = await runDiscordWelcomeSweep({
    supabase: claimSupabase,
    now,
    notify: async () => { notifyCalled = true; return { delivered: true }; },
    fetchCandidateTeams: async () => [{ id: "t1", user_id: "u1", created_at: now.toISOString() }],
    fetchActiveRiderCounts: async () => new Map([["t1", 8]]),
  });

  assert.equal(stats.skipped, 1);
  assert.equal(stats.sent, 0);
  assert.equal(notifyCalled, false);
  assert.equal(calls.length, 1);
});
