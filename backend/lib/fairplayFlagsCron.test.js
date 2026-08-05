import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFairplayReport,
  buildIdentityProfiles,
  computePairIdentitySignals,
  disposableEmailStrength,
  fetchAllRows,
  normalizeHandle,
  normalizeTransactions,
  runFairplayScoringSweep,
} from "./fairplayFlagsCron.js";

// ── Mock-supabase (chainable, pr.-tabel handlers) ───────────────────────────

function mockSupabase(handlers) {
  return {
    from(table) {
      const h = (handlers[table] ??= { rows: [] });
      const result = () => (h.error ? { data: null, error: h.error } : { data: h.rows ?? [], error: null });
      const builder = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        not: () => builder,
        order: () => builder,
        limit: () =>
          Promise.resolve(h.error ? { data: null, error: h.error } : { data: (h.rows ?? []).slice(0, 1), error: null }),
        maybeSingle: () => Promise.resolve({ data: h.single ?? null, error: h.error ?? null }),
        range: (from, to) =>
          Promise.resolve(
            h.error ? { data: null, error: h.error } : { data: (h.rows ?? []).slice(from, to + 1), error: null }
          ),
        upsert: (payload, opts) => {
          (h.upserts ??= []).push({ payload, opts });
          return Promise.resolve({ data: null, error: null });
        },
        // Ægte supabase-builders er thenable — await på en u-eksekveret kæde
        // (fx .select() uden .range()) skal give {data, error}, ikke builderen.
        then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
      };
      return builder;
    },
  };
}

// ── Fixture: #2221-formet par (jcarey-lighed + ensidig swap-strøm) ──────────

const NOW = new Date("2026-08-06T02:00:00Z");

function jcareyFixture() {
  return {
    teams: [
      { id: "team-a", name: "EvoPro", user_id: "user-a", is_ai: false, is_bank: false, is_test_account: false },
      { id: "team-b", name: "Barra CC", user_id: "user-b", is_ai: false, is_bank: false, is_test_account: false },
    ],
    users: [
      { id: "user-a", email: "jcarey071@gmail.com", username: "EvoManager", created_at: "2026-06-28T10:00:00Z", level: 5, xp: 2000, login_streak: 10 },
      { id: "user-b", email: "jcarey983@gmail.com", username: "BarraBoss", created_at: "2026-06-29T04:00:00Z", level: 5, xp: 2000, login_streak: 10 },
    ],
    swaps: [
      {
        id: "swap-1",
        proposing_team_id: "team-a",
        receiving_team_id: "team-b",
        cash_adjustment: 1000,
        counter_cash: null,
        created_at: "2026-07-01T12:00:00Z",
        updated_at: "2026-07-01T12:00:00Z",
        offered: { base_value: 5013, market_value: 5013, firstname: "Lille", lastname: "Rytter" },
        requested: { base_value: 772214, market_value: 772214, firstname: "Jack", lastname: "Marsh" },
      },
    ],
  };
}

// ── Rene hjælpere ───────────────────────────────────────────────────────────

test("normalizeHandle: tal-suffiks strippes, min. 4 tegn (jcarey071/983 → jcarey)", () => {
  assert.equal(normalizeHandle("jcarey071"), "jcarey");
  assert.equal(normalizeHandle("jcarey983"), "jcarey");
  assert.equal(normalizeHandle("abc1"), null); // "abc" er under 4 tegn
  assert.equal(normalizeHandle(null), null);
});

test("disposableEmailStrength: kerneliste 0.55, heuristik 0.30, normal 0", () => {
  assert.equal(disposableEmailStrength("x@gwshare.com"), 0.55);
  assert.equal(disposableEmailStrength("x@some-tempmail-thing.io"), 0.3);
  assert.equal(disposableEmailStrength("x@gmail.com"), 0);
  assert.equal(disposableEmailStrength(null), 0);
});

test("fetchAllRows: sider igennem over 1000 rækker uden tavs trunkering", async () => {
  const rows = Array.from({ length: 1500 }, (_, i) => ({ i }));
  const sb = mockSupabase({ big: { rows } });
  const all = await fetchAllRows(() => sb.from("big").select("i"));
  assert.equal(all.length, 1500);
  assert.equal(all[1499].i, 1499);
});

test("buildIdentityProfiles + computePairIdentitySignals: fan-out>2 dræber IP-signalet (CGNAT-lektien)", () => {
  const users = [
    { id: "u1", email: "a@x.dk", username: "alpha", created_at: "2026-07-01T00:00:00Z" },
    { id: "u2", email: "b@y.dk", username: "bravo", created_at: "2026-07-20T00:00:00Z" },
    { id: "u3", email: "c@z.dk", username: "charlie", created_at: "2026-07-21T00:00:00Z" },
  ];
  const sharedIp = { ip: "152.233.12.241", ip_prefix: "152.233.12" };
  const identityEvents = [
    { user_id: "u1", ...sharedIp, event_type: "login", first_seen_at: null },
    { user_id: "u2", ...sharedIp, event_type: "login", first_seen_at: null },
    { user_id: "u3", ...sharedIp, event_type: "login", first_seen_at: null }, // fan-out = 3
  ];
  const profiles = buildIdentityProfiles({ users, identityEvents, signupAttribution: [] });
  const signals = computePairIdentitySignals(profiles.get("u1"), profiles.get("u2"));
  assert.equal(signals.ip_exact_low_fanout, false);
  assert.equal(signals.ip_prefix_low_fanout, false);

  // Fjern u3 → fan-out 2 → signal tændt
  const profiles2 = buildIdentityProfiles({
    users: users.slice(0, 2),
    identityEvents: identityEvents.slice(0, 2),
    signupAttribution: [],
  });
  const signals2 = computePairIdentitySignals(profiles2.get("u1"), profiles2.get("u2"));
  assert.equal(signals2.ip_exact_low_fanout, true);
});

test("computePairIdentitySignals: first_seen_at-arv fra signup_attribution (#2776-signalet)", () => {
  const users = [
    { id: "u1", email: "a@x.dk", username: "alpha", created_at: "2026-07-01T00:00:00Z" },
    { id: "u2", email: "b@y.dk", username: "bravo", created_at: "2026-07-19T23:20:18Z" },
  ];
  const profiles = buildIdentityProfiles({
    users,
    identityEvents: [],
    signupAttribution: [
      { user_id: "u1", first_seen_at: "2026-06-28T09:00:00.000Z" },
      { user_id: "u2", first_seen_at: "2026-06-28T09:00:00.000Z" }, // arvet localStorage-stempel
    ],
  });
  const signals = computePairIdentitySignals(profiles.get("u1"), profiles.get("u2"));
  assert.equal(signals.first_seen_at_match, true);
  assert.equal(signals.signup_proximity, false); // 18+ dage imellem
});

test("normalizeTransactions: swap-flow og begge ben-ratioer (#2221-swappen)", () => {
  const { swaps } = jcareyFixture();
  const [tx] = normalizeTransactions({ transfers: [], auctions: [], swaps });
  assert.equal(tx.toTeam, "team-a");
  assert.equal(tx.flowToRecipient, 772214 - 5013 - 1000); // 766.201 mod EvoPro
  assert.equal(tx.swapLegRatios.length, 2);
  assert.ok(tx.swapLegRatios[0] < 0.01 && tx.swapLegRatios[1] > 150);
});

test("normalizeTransactions: selv-handler udelukkes (auto_squad_purchase-bogføring)", () => {
  const txs = normalizeTransactions({
    transfers: [],
    auctions: [
      { seller_team_id: "t1", current_bidder_id: "t1", current_price: 500, actual_end: "2026-08-01T00:00:00Z", rider: { base_value: 1000 } },
    ],
    swaps: [],
  });
  assert.equal(txs.length, 0);
});

// ── buildFairplayReport (ren, uden supabase) ────────────────────────────────

test("rapport: #2221-formet par flagges som pair_value_flow", () => {
  const fx = jcareyFixture();
  const report = buildFairplayReport({ ...fx, now: NOW });
  const flag = report.flags.find((f) => f.flag_type === "pair_value_flow");
  assert.ok(flag, "forventede et flag");
  assert.equal(flag.team_id_lo, "team-a");
  assert.equal(flag.team_id_hi, "team-b");
  assert.ok(flag.score >= 1.0, `score ${flag.score}`);
  assert.ok(flag.signals.some((s) => s.name === "email_username_similarity"));
  assert.ok(flag.signals.some((s) => s.name === "price_band_outlier"));
  assert.equal(flag.evidence.team_lo, "EvoPro");
  assert.equal(Math.abs(flag.evidence.net_value_flow), 766201);
});

test("rapport: whitelist undertrykker parret helt (#3135-backstoppen)", () => {
  const fx = jcareyFixture();
  const report = buildFairplayReport({
    ...fx,
    whitelistPairs: [{ team_id_lo: "team-a", team_id_hi: "team-b" }],
    now: NOW,
  });
  assert.equal(report.flags.length, 0);
  assert.equal(report.whitelistedPairsSkipped, 1);
});

test("rapport: husstandspar med lille handel flagges IKKE (TR↔LEGO-Vestas-casen)", () => {
  const report = buildFairplayReport({
    teams: [
      { id: "t1", name: "TR Cycling", user_id: "u1", is_ai: false, is_bank: false, is_test_account: false },
      { id: "t2", name: "LEGO-Vestas", user_id: "u2", is_ai: false, is_bank: false, is_test_account: false },
    ],
    users: [
      { id: "u1", email: "far@hjem.dk", username: "farmand", created_at: "2026-05-10T00:00:00Z", level: 8, xp: 9000, login_streak: 20 },
      { id: "u2", email: "soen@hjem.dk", username: "soenneke", created_at: "2026-05-11T00:00:00Z", level: 7, xp: 7000, login_streak: 15 },
    ],
    identityEvents: [
      { user_id: "u1", ip: "10.0.0.9", ip_prefix: "10.0.0", event_type: "login", first_seen_at: null },
      { user_id: "u2", ip: "10.0.0.9", ip_prefix: "10.0.0", event_type: "login", first_seen_at: null },
    ],
    auctions: [
      {
        seller_team_id: "t1",
        current_bidder_id: "t2",
        current_price: 40000,
        actual_end: "2026-07-30T00:00:00Z",
        rider: { base_value: 50539, market_value: 60000, firstname: "Ung", lastname: "Rytter" },
      },
    ],
    now: NOW,
  });
  assert.equal(report.flags.length, 0); // netto 10.539 er under 50k-værdigulvet
});

test("rapport: ejerens testkonti (@cyclingzone.dev) er helt uden for populationen", () => {
  const fx = jcareyFixture();
  fx.users[1].email = "test-b@cyclingzone.dev";
  const report = buildFairplayReport({ ...fx, now: NOW });
  assert.equal(report.flags.length, 0);
  assert.equal(report.population, 1);
});

test("rapport: livscyklus-tragt — frisk temp-mail-konto der straks køber stort, fair pris", () => {
  const report = buildFairplayReport({
    teams: [
      { id: "t-buyer", name: "Liverpool Racing", user_id: "u-buyer", is_ai: false, is_bank: false, is_test_account: false },
      { id: "t-seller", name: "Borregaard Racing", user_id: "u-seller", is_ai: false, is_bank: false, is_test_account: false },
    ],
    users: [
      { id: "u-buyer", email: "dekiwas835@gwshare.com", username: "liverpoolx", created_at: "2026-07-29T04:25:04Z", level: 1, xp: 0, login_streak: 0 },
      { id: "u-seller", email: "ok@gmail.com", username: "borregaard", created_at: "2026-05-15T00:00:00Z", level: 9, xp: 12000, login_streak: 30 },
    ],
    transfers: [
      {
        id: "tr-1",
        buyer_team_id: "t-buyer",
        offer_amount: 649853,
        counter_amount: null,
        created_at: "2026-07-29T04:28:56Z",
        updated_at: "2026-07-29T04:28:56Z",
        // fair pris (1,0×) — værdi-reglerne kan ikke se den; tragten skal.
        listing: { seller_team_id: "t-seller", rider: { base_value: 649853, market_value: 649853, firstname: "Stor", lastname: "Stjerne" } },
      },
    ],
    now: NOW,
  });
  const funnel = report.flags.find((f) => f.flag_type === "lifecycle_funnel");
  assert.ok(funnel, "forventede tragt-flag");
  assert.ok(funnel.score >= 0.35, `score ${funnel.score}`);
  assert.ok(funnel.signals.some((s) => s.name === "account_age_at_tx"));
  assert.ok(funnel.signals.some((s) => s.name === "disposable_email"));
  // …og PAR-reglen fyrer IKKE (netto-værdistrøm ≈ 0 ved fair pris):
  assert.ok(!report.flags.some((f) => f.flag_type === "pair_value_flow"));
});

// ── runFairplayScoringSweep (mock-supabase) ─────────────────────────────────

function sweepHandlers(fx, extra = {}) {
  return {
    fairplay_flags: { rows: [], ...extra.fairplay_flags },
    teams: { rows: fx.teams },
    users: { rows: fx.users },
    identity_events: { rows: [] },
    signup_attribution: { rows: [] },
    transfer_offers: { rows: [] },
    auctions: { rows: [] },
    swap_offers: { rows: fx.swaps ?? [] },
    loans: { rows: [] },
    fairplay_whitelisted_pairs: { rows: [] },
    app_config: { single: { value: 0.35 } },
    ...extra.overrides,
  };
}

test("sweep: manglende fairplay_flags-tabel → roligt skip (aktiverings-gaten)", async () => {
  const handlers = sweepHandlers(jcareyFixture(), {
    fairplay_flags: { error: { code: "42P01", message: 'relation "public.fairplay_flags" does not exist' } },
  });
  const r = await runFairplayScoringSweep({ supabase: mockSupabase(handlers), now: NOW });
  assert.equal(r.skipped, true);
  assert.match(r.reason, /migration/);
});

test("sweep: flag upsertes med dedup-nøgle og uden status/first_detected_at i payload", async () => {
  const handlers = sweepHandlers(jcareyFixture());
  const r = await runFairplayScoringSweep({ supabase: mockSupabase(handlers), now: NOW });
  assert.equal(r.skipped ?? false, false);
  assert.equal(r.upserted, 1);
  const [up] = handlers.fairplay_flags.upserts;
  assert.equal(up.opts.onConflict, "flag_type,team_id_lo,team_id_hi");
  assert.equal(up.payload.flag_type, "pair_value_flow");
  assert.ok(up.payload.score >= 1.0);
  // Ejerens felter må ALDRIG overskrives af sweepet:
  assert.ok(!("status" in up.payload));
  assert.ok(!("owner_note" in up.payload));
  assert.ok(!("first_detected_at" in up.payload));
});

test("sweep: dismissed-række gen-scores aldrig (ejerens dom står ved magt)", async () => {
  const handlers = sweepHandlers(jcareyFixture(), {
    fairplay_flags: {
      rows: [{ flag_type: "pair_value_flow", team_id_lo: "team-a", team_id_hi: "team-b", status: "dismissed" }],
    },
  });
  const r = await runFairplayScoringSweep({ supabase: mockSupabase(handlers), now: NOW });
  assert.equal(r.upserted, 0);
  assert.equal(r.skippedDismissed, 1);
  assert.equal(handlers.fairplay_flags.upserts ?? undefined, undefined);
});

test("sweep: manglende whitelist-tabel tolereres (tom liste + note)", async () => {
  const handlers = sweepHandlers(jcareyFixture(), {
    overrides: {
      fairplay_whitelisted_pairs: { error: { code: "PGRST205", message: "Could not find the table in schema cache" } },
    },
  });
  const r = await runFairplayScoringSweep({ supabase: mockSupabase(handlers), now: NOW });
  assert.equal(r.whitelistMissing, true);
  assert.equal(r.upserted, 1); // sweepet kører videre uden whitelist
});

test("sweep: dryRun rører aldrig databasen med writes", async () => {
  const handlers = sweepHandlers(jcareyFixture());
  const r = await runFairplayScoringSweep({ supabase: mockSupabase(handlers), now: NOW, dryRun: true });
  assert.equal(r.dryRun, true);
  assert.ok(r.flags.length >= 1);
  assert.equal(handlers.fairplay_flags.upserts ?? undefined, undefined);
});
