import test from "node:test";
import assert from "node:assert/strict";

import {
  getActiveContract,
  getPendingContract,
  getNegotiationState,
  getOffers,
  acceptOffer,
  acceptOfferImmediately,
  expireAndRenewContracts,
  recomputeActivationRate,
  resolveStageDivisor,
  evaluateSeasonObjectives,
  resolveContractForNewSeason,
  contractRaceDayPool,
  contractSigningBonus,
  DEFAULT_RENEW_VARIANT,
} from "./sponsorContractsService.js";
import { renownTarget } from "./renownEngine.js";
import { generateOffers, FULL_CALENDAR_DAYS } from "./sponsorOffers.js";
import { FINANCE_REASON } from "./economyConstants.js";

// ─── Faithful service_role-mock ────────────────────────────────────────────────
// Modelleret efter prizePayoutEngine.test.js. Dækker præcis de queries servicen
// laver (udvidet i #2948 "Sponsorvalg 2.0" med races/league_divisions/teams.in()
// for divisor-opslaget + rpc for signing/objective-bonus):
//   teams:            .select("id, division").eq("id", teamId).single()
//                      .select("id, division, league_division_id").in("id", teamIds)
//   seasons:          .select(...).eq("number", N).maybeSingle()  (renown + stageCounts)
//                      .select("race_days_total").eq("status","active").maybeSingle() (calendarDays)
//   season_standings: .select(...).eq("season_id", id)  (thenable → array)
//   races:            .select("league_division_id, stages").eq("season_id", id) (thenable)
//   league_divisions: .select("id, tier")  (thenable, ingen filter)
//   sponsor_contracts:
//     .select("*").eq("team_id").eq("status","active"|"pending").maybeSingle()
//     .select(...).eq("status","active")                 (thenable, bulk — evaluateSeasonObjectives)
//     .update({status}).eq("team_id").eq("status",...)   (registreres i state.updates)
//     .update({status}).eq("id", id)                     (registreres i state.updates)
//     .insert(row).select().single()                     (registreres i state.inserts)
//   rpc: increment_balance_with_audit (ægte incrementBalanceWithAudit-wrapper kører igennem)
function makeSupabase({
  team = { id: "t1", division: 2 },
  seasonsByNumber = {},       // { [number]: { id, number, race_days_total? } | null }
  activeSeason = null,        // { race_days_total } | null — seasons.eq("status","active")
  standingsBySeasonId = {},   // { [seasonId]: [rows] } — også season_standings for evaluateSeasonObjectives
  activeContractByTeam = {},  // { [teamId]: contractRow | null }
  pendingContractByTeam = {}, // { [teamId]: contractRow | null }
  teamsById: teamsByIdOverride = {}, // { [teamId]: { id, division, league_division_id } } — teams.in()
  racesBySeasonId = {},       // { [seasonId]: [{ league_division_id, stages }] }
  poolsList = [],             // [{ id, tier }] — league_divisions
  skipRpcKeys = new Set(),    // idempotency_keys der skal simulere 23505 (skip)
  failNotificationForUserIds = [], // #3315: simulerer en fejlende notifications-insert
} = {}) {
  const state = { updates: [], inserts: [], rpcCalls: [], notificationInserts: [], teamsInChunkSizes: [] };
  const failNotify = new Set(failNotificationForUserIds);
  const teamsById = {
    [team.id]: { id: team.id, division: team.division, league_division_id: null },
    ...teamsByIdOverride,
  };

  function seasonsBuilder() {
    const ctx = {};
    const b = {
      select: () => b,
      eq: (col, val) => {
        if (col === "number") ctx.number = val;
        if (col === "status") ctx.status = val;
        return b;
      },
      maybeSingle: () => {
        // loadCalendarDays: .select("race_days_total").eq("status","active")
        if (ctx.status === "active") {
          return Promise.resolve({ data: activeSeason, error: null });
        }
        // loadRenownTargetValue / loadSeasonStageCounts: .eq("number", N)
        const row = seasonsByNumber[ctx.number] ?? null;
        return Promise.resolve({ data: row, error: null });
      },
    };
    return b;
  }

  function teamsBuilder() {
    const ctx = {};
    const rowsForInVals = () =>
      (ctx.inVals || []).map(
        (id) => teamsById[id] || { id, division: null, league_division_id: null },
      );
    const b = {
      select: () => b,
      eq: (col, val) => {
        if (col === "id") ctx.id = val;
        return b;
      },
      in: (_col, vals) => {
        ctx.inVals = vals;
        state.teamsInChunkSizes.push(vals.length);
        return b;
      },
      // #3014: expireAndRenewContracts henter nu teams via fetchAllRowsChunkedIn
      // (.in(chunk).order("id") pr. chunk, derefter .range() pr. side).
      // order() er en no-op her (rowsForInVals følger allerede ids-rækkefølgen,
      // og hver chunk er langt under 1000 rækker), range() spejler fetchAllRows'
      // .range(from,to)-kontrakt så den delte helper virker uændret mod mocken.
      order: () => b,
      range: (from, to) => Promise.resolve({ data: rowsForInVals().slice(from, to + 1), error: null }),
      single: () => Promise.resolve({ data: team, error: null }),
      then: (resolve) => resolve({ data: rowsForInVals(), error: null }),
    };
    return b;
  }

  function standingsBuilder() {
    const ctx = {};
    const b = {
      select: () => b,
      eq: (col, val) => {
        if (col === "season_id") ctx.seasonId = val;
        return b;
      },
      then: (resolve) =>
        resolve({ data: standingsBySeasonId[ctx.seasonId] ?? [], error: null }),
    };
    return b;
  }

  function racesBuilder() {
    const ctx = {};
    const b = {
      select: () => b,
      eq: (col, val) => {
        if (col === "season_id") ctx.seasonId = val;
        return b;
      },
      then: (resolve) => resolve({ data: racesBySeasonId[ctx.seasonId] ?? [], error: null }),
    };
    return b;
  }

  function leagueDivisionsBuilder() {
    const b = {
      select: () => b,
      then: (resolve) => resolve({ data: poolsList, error: null }),
    };
    return b;
  }

  function contractsBuilder() {
    const ctx = {};
    const b = {
      _op: null,
      select: () => b,
      insert: (row) => {
        b._op = "insert";
        ctx.insertRow = row;
        return b;
      },
      update: (payload) => {
        b._op = "update";
        ctx.payload = payload;
        return b;
      },
      eq: (col, val) => {
        ctx[col] = val;
        return b;
      },
      maybeSingle: () => {
        // select active OR pending contract (gated på ctx.status).
        const map =
          ctx.status === "pending" ? pendingContractByTeam : activeContractByTeam;
        return Promise.resolve({
          data: map[ctx.team_id] ?? null,
          error: null,
        });
      },
      single: () => {
        // insert(...).select().single()
        state.inserts.push(ctx.insertRow);
        return Promise.resolve({ data: ctx.insertRow, error: null });
      },
    };
    // Make update(...).eq(...) resolve as a thenable (no .single()/.maybeSingle()),
    // OG en plain select uden team_id-filter (evaluateSeasonObjectives' bulk-fetch).
    b.then = (resolve) => {
      if (b._op === "update") {
        state.updates.push({
          payload: ctx.payload,
          team_id: ctx.team_id,
          status: ctx.status,
          id: ctx.id,
        });
        // update by (team_id + status): flip den matchende in-memory række væk så
        // et senere select ikke ser den igen.
        if (ctx.team_id && ctx.status === "active" && activeContractByTeam[ctx.team_id]) {
          activeContractByTeam[ctx.team_id] = null;
        }
        if (ctx.team_id && ctx.status === "pending" && pendingContractByTeam[ctx.team_id]) {
          pendingContractByTeam[ctx.team_id] = null;
        }
        // update by id: aktivering (pending->active) eller expired-flip. Find rækken
        // i begge maps og flyt/fjern den så efterfølgende selects er konsistente.
        if (ctx.id) {
          const newStatus = ctx.payload?.status;
          for (const k of Object.keys(activeContractByTeam)) {
            const row = activeContractByTeam[k];
            if (row && row.id === ctx.id) activeContractByTeam[k] = null;
          }
          for (const k of Object.keys(pendingContractByTeam)) {
            const row = pendingContractByTeam[k];
            if (row && row.id === ctx.id) {
              pendingContractByTeam[k] = null;
              if (newStatus === "active") {
                activeContractByTeam[k] = { ...row, ...ctx.payload };
              }
            }
          }
        }
        return resolve({ data: null, error: null });
      }
      if (b._op === null) {
        // Plain select awaited directly (evaluateSeasonObjectives: bulk-fetch
        // alle aktive kontrakter — mocken har kun ét aktivt hold-lag, så vi
        // returnerer alle ikke-null aktive rækker uanset ctx.team_id-fravær).
        const rows = Object.values(activeContractByTeam).filter(Boolean);
        return resolve({ data: rows, error: null });
      }
      return resolve({ data: null, error: null });
    };
    return b;
  }

  return {
    state,
    rpc(name, params) {
      state.rpcCalls.push({
        name,
        teamId: params.p_team_id,
        delta: params.p_delta,
        payload: params.p_finance_payload,
      });
      const key = params?.p_finance_payload?.idempotency_key;
      if (key && skipRpcKeys.has(key)) {
        return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
      }
      return Promise.resolve({ data: 100000, error: null });
    },
    from(table) {
      if (table === "teams") return teamsBuilder();
      if (table === "seasons") return seasonsBuilder();
      if (table === "season_standings") return standingsBuilder();
      if (table === "races") return racesBuilder();
      if (table === "league_divisions") return leagueDivisionsBuilder();
      if (table === "sponsor_contracts") return contractsBuilder();
      // #3315: sponsor_paid-notifikationen (signing/objective-bonus). notifyUser's
      // dedup-opslag returnerer altid tomt her — testene skelner kun på insert.
      if (table === "notifications") {
        return {
          select() {
            return {
              eq() { return this; },
              gte() { return this; },
              is() { return this; },
              order() { return this; },
              limit() { return Promise.resolve({ data: [], error: null }); },
            };
          },
          insert(row) {
            if (failNotify.has(row.user_id)) {
              return Promise.resolve({ data: null, error: { code: "23514", message: "notifications_type_check violation" } });
            }
            state.notificationInserts.push(row);
            return Promise.resolve({ data: row, error: null });
          },
        };
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
}

test("getActiveContract returnerer den aktive kontrakt", async () => {
  const active = {
    id: "c1",
    team_id: "t1",
    sponsor_name: "Meridian Bank",
    status: "active",
    expires_after_season: 3,
  };
  const supabase = makeSupabase({ activeContractByTeam: { t1: active } });

  const row = await getActiveContract({ supabase, teamId: "t1" });
  assert.deepEqual(row, active);
});

test("getActiveContract returnerer null når intet aktivt", async () => {
  const supabase = makeSupabase({ activeContractByTeam: { t1: null } });
  const row = await getActiveContract({ supabase, teamId: "t1" });
  assert.equal(row, null);
});

test("getPendingContract returnerer den pending kontrakt", async () => {
  const pending = {
    id: "p1",
    team_id: "t1",
    sponsor_name: "Alta Cycles",
    status: "pending",
    start_season: 3,
    expires_after_season: 5,
  };
  const supabase = makeSupabase({ pendingContractByTeam: { t1: pending } });

  const row = await getPendingContract({ supabase, teamId: "t1" });
  assert.deepEqual(row, pending);
});

test("getPendingContract returnerer null når intet pending", async () => {
  const supabase = makeSupabase({ pendingContractByTeam: { t1: null } });
  const row = await getPendingContract({ supabase, teamId: "t1" });
  assert.equal(row, null);
});

test("getOffers udleder 5 tilbud fra renown af holdets sidste-sæsons placering", async () => {
  // Hold i division 2; sidste sæson (sæson 1) → placering nr. 1 af 4 med flest point.
  const prevSeason = { id: "s1", number: 1 };
  const standings = [
    { season_id: "s1", team_id: "t1", division: 2, rank_in_division: 1, total_points: 500 },
    { season_id: "s1", team_id: "t2", division: 2, rank_in_division: 2, total_points: 300 },
    { season_id: "s1", team_id: "t3", division: 2, rank_in_division: 3, total_points: 200 },
    { season_id: "s1", team_id: "t4", division: 2, rank_in_division: 4, total_points: 100 },
  ];
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 1: prevSeason },
    standingsBySeasonId: { s1: standings },
  });

  const offers = await getOffers({ supabase, teamId: "t1", seasonNumber: 2 });

  // Forventet: samme renownTarget som motoren beregner direkte.
  const mine = standings.find((s) => s.team_id === "t1");
  const expectedTarget = renownTarget({
    division: 2,
    lastSeasonStanding: mine,
    divisionStandings: standings,
  });
  const expectedOffers = generateOffers({
    teamId: "t1",
    seasonNumber: 2,
    renownTargetValue: expectedTarget,
  });

  assert.equal(offers.length, 5);
  assert.deepEqual(offers, expectedOffers);
  // Top-hold → multiplier > 1.0 → target > division-base (400000).
  assert.ok(expectedTarget > 400000);
});

test("getOffers bevarer renown fra forrige division når holdet er rykket op/ned (#2909)", async () => {
  // Holdets NYE division er 2 (D2), men sidste sæson (s1) kørte det i division 3
  // (D3) og vandt suverænt. Standings-tabellen indeholder BEGGE divisioner for
  // samme sæson (som den vil gøre efter det virkelige divisionsskifte). Før
  // #2909-fixet blev season_standings filtreret på holdets NYE division (2) FØR
  // opslag på team_id → t1's egen D3-række blev aldrig fundet, og renown faldt
  // til 1.0 (target = flad 400000). Fixet slår op UDEN divisionsfilter, ligesom
  // udbetalingsstien (economyEngine.js standingByTeamId).
  const prevSeason = { id: "s1", number: 1 };
  const standings = [
    // Holdets EGEN placering sidste sæson — i D3, suverænt førstepladset.
    { season_id: "s1", team_id: "t1", division: 3, rank_in_division: 1, total_points: 900 },
    { season_id: "s1", team_id: "t3b", division: 3, rank_in_division: 2, total_points: 200 },
    { season_id: "s1", team_id: "t3c", division: 3, rank_in_division: 3, total_points: 100 },
    // Andre holds D2-placeringer (holdets NYE division) — t1 er IKKE med her,
    // netop fordi det ikke kørte i D2 sidste sæson.
    { season_id: "s1", team_id: "t2a", division: 2, rank_in_division: 1, total_points: 500 },
    { season_id: "s1", team_id: "t2b", division: 2, rank_in_division: 2, total_points: 300 },
  ];
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 }, // NYE division efter oprykning
    seasonsByNumber: { 1: prevSeason },
    standingsBySeasonId: { s1: standings },
  });

  const offers = await getOffers({ supabase, teamId: "t1", seasonNumber: 2 });

  // Forventet renown: base for holdets NYE division (D2=400000) ganget med
  // multiplikatoren fra holdets EGEN (D3-)standing — IKKE 1.0.
  const mine = standings.find((s) => s.team_id === "t1");
  const divisionStandings = standings.filter((s) => s.division === 3);
  const expectedTarget = renownTarget({
    division: 2,
    lastSeasonStanding: mine,
    divisionStandings,
  });
  const expectedOffers = generateOffers({
    teamId: "t1",
    seasonNumber: 2,
    renownTargetValue: expectedTarget,
  });

  assert.deepEqual(offers, expectedOffers);
  // Kernen af regressions-testen: suveræn D3-vinder skal IKKE lande på den
  // flade 1.0-multiplikator (400000) — det ville bevise bugtilbagefald.
  assert.ok(
    expectedTarget > 400000,
    `renown skal afspejle D3-formen (>400000), fik ${expectedTarget}`,
  );
});

test("getOffers falder tilbage til division-base × 1.0 når intet sidste-sæsons-data", async () => {
  // Frisk hold: sæson 2, men ingen sæson-1-placering (eller sæson findes ikke).
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 1: null },
    standingsBySeasonId: {},
  });

  const offers = await getOffers({ supabase, teamId: "t1", seasonNumber: 2 });

  // renownTarget med null standing = base × 1.0 = 400000 (division 2).
  const expected = generateOffers({
    teamId: "t1",
    seasonNumber: 2,
    renownTargetValue: 400000,
  });
  assert.deepEqual(offers, expected);
});

test("getOffers bruger seasons.race_days_total som per-dag-divisor (#1663)", async () => {
  // Aktiv sæson har en 40-dages kalender (ikke default 60). Per-løbsdag-raten skal
  // derfor afledes med 40 som divisor, så guaranteed_base + per_dag × 40 ≈ renownTarget.
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 1: null }, // frisk hold → target 400000
    standingsBySeasonId: {},
    activeSeason: { race_days_total: 40 },
  });

  const offers = await getOffers({ supabase, teamId: "t1", seasonNumber: 2 });

  const renownTargetValue = 400000;
  // Forventning: samme tilbud som generateOffers med calendarDays=40.
  const expected = generateOffers({
    teamId: "t1",
    seasonNumber: 2,
    renownTargetValue,
    calendarDays: 40,
  });
  assert.deepEqual(offers, expected);

  // Og det adskiller sig fra default-60-tilbuddene (ellers tester vi ikke wiringen).
  const default60 = generateOffers({
    teamId: "t1",
    seasonNumber: 2,
    renownTargetValue,
  });
  assert.notDeepEqual(offers, default60);

  // Sanity: guaranteed_base + per_dag × 40 rammer ≈ target × (fraction+share) for hver variant.
  for (const o of offers) {
    const reconstructed = o.guaranteedBase + o.perRaceDayRate * 40;
    const expectedTotal = renownTargetValue * (o.guaranteedFraction + o.raceDayShare);
    assert.ok(
      Math.abs(reconstructed - expectedTotal) < 40,
      `variant ${o.variant}: ${reconstructed} bør være ≈ ${expectedTotal}`,
    );
  }
});

test("getOffers falder tilbage til FULL_CALENDAR_DAYS når ingen aktiv sæson (#1663)", async () => {
  // Ingen aktiv sæson (activeSeason=null) → divisor falder tilbage til default 60.
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 1: null },
    standingsBySeasonId: {},
    activeSeason: null,
  });

  const offers = await getOffers({ supabase, teamId: "t1", seasonNumber: 2 });

  // Identisk med generateOffers uden calendarDays (default 60).
  const expected = generateOffers({
    teamId: "t1",
    seasonNumber: 2,
    renownTargetValue: 400000,
  });
  assert.deepEqual(offers, expected);
});

test("getNegotiationState — negotiable når aktiv kontrakt udløber ved nuværende sæson", async () => {
  // Aktiv kontrakt udløber ved slutningen af nuværende sæson (2) → forhandl for 3.
  const active = {
    id: "c1",
    team_id: "t1",
    status: "active",
    expires_after_season: 2,
  };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 2: null }, // kommende sæson 3 → prev = 2; ingen standings → target 400000
    activeContractByTeam: { t1: active },
    pendingContractByTeam: { t1: null },
  });

  const result = await getNegotiationState({
    supabase,
    teamId: "t1",
    currentSeasonNumber: 2,
  });

  assert.equal(result.negotiable, true);
  assert.equal(result.upcomingSeasonNumber, 3);
  assert.equal(result.offers.length, 5);
  assert.equal(result.pendingVariant, null);
  assert.equal(result.immediate, false, "hold MED aktiv kontrakt bruger fornyelses-stien, ikke #3316-immediate");
  // Tilbuddene er for den KOMMENDE sæson (3).
  const expected = generateOffers({
    teamId: "t1",
    seasonNumber: 3,
    renownTargetValue: 400000,
  });
  assert.deepEqual(result.offers, expected);
});

test("getNegotiationState — negotiable når INGEN aktiv kontrakt (#3316: straks for INDEVÆRENDE sæson, ikke næste)", async () => {
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 1: null }, // currentSeasonNumber 2 -> prev 1
    activeContractByTeam: { t1: null },
    pendingContractByTeam: { t1: null },
  });

  const result = await getNegotiationState({
    supabase,
    teamId: "t1",
    currentSeasonNumber: 2,
  });

  assert.equal(result.negotiable, true);
  assert.equal(result.offers.length, 5);
  // #3316: intet aktiv kontrakt → forhandl for INDEVÆRENDE sæson (2), ikke
  // næste (3) — og markeret som en immediate-aktivering for accept-stien.
  assert.equal(result.upcomingSeasonNumber, 2);
  assert.equal(result.immediate, true);
  const expected = generateOffers({ teamId: "t1", seasonNumber: 2, renownTargetValue: 400000 });
  assert.deepEqual(result.offers, expected);
});

test("getNegotiationState — IKKE negotiable når aktiv kontrakt stadig dækker kommende sæson", async () => {
  const active = {
    id: "c1",
    team_id: "t1",
    status: "active",
    expires_after_season: 4, // > currentSeasonNumber 2 → låst
  };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    activeContractByTeam: { t1: active },
  });

  const result = await getNegotiationState({
    supabase,
    teamId: "t1",
    currentSeasonNumber: 2,
  });

  assert.equal(result.negotiable, false);
  assert.equal(result.upcomingSeasonNumber, 3);
  assert.deepEqual(result.offers, []);
  assert.equal(result.pendingVariant, null);
});

test("getNegotiationState — pendingVariant detekteres fra eksisterende pending-række (variant persisteret)", async () => {
  // Manager har en udløbende AKTIV kontrakt (fornyelses-sti, ikke #3316-immediate)
  // og har allerede valgt 'loyal' (3-sæsons plan) for kommende sæson (3).
  const loyalOffer = generateOffers({
    teamId: "t1",
    seasonNumber: 3,
    renownTargetValue: 400000,
  }).find((o) => o.variant === "loyal");
  const pending = {
    id: "p1",
    team_id: "t1",
    status: "pending",
    start_season: 3,
    length_seasons: loyalOffer.lengthSeasons,
    guaranteed_base: loyalOffer.guaranteedBase,
    variant: "loyal",
    expires_after_season: 3 + loyalOffer.lengthSeasons - 1,
  };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 2: null },
    activeContractByTeam: { t1: { id: "c1", team_id: "t1", status: "active", expires_after_season: 2 } },
    pendingContractByTeam: { t1: pending },
  });

  const result = await getNegotiationState({
    supabase,
    teamId: "t1",
    currentSeasonNumber: 2,
  });

  assert.equal(result.negotiable, true);
  assert.equal(result.pendingVariant, "loyal");
});

test("getNegotiationState — legacy pending UDEN variant-kolonne falder tilbage til length+base-match", async () => {
  const loyalOffer = generateOffers({
    teamId: "t1",
    seasonNumber: 3,
    renownTargetValue: 400000,
  }).find((o) => o.variant === "loyal");
  const legacyPending = {
    id: "p1",
    team_id: "t1",
    status: "pending",
    start_season: 3,
    length_seasons: loyalOffer.lengthSeasons,
    guaranteed_base: loyalOffer.guaranteedBase,
    variant: null, // legacy-række skrevet før #2948-kolonnen
  };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 2: null },
    activeContractByTeam: { t1: { id: "c1", team_id: "t1", status: "active", expires_after_season: 2 } },
    pendingContractByTeam: { t1: legacyPending },
  });

  const result = await getNegotiationState({
    supabase,
    teamId: "t1",
    currentSeasonNumber: 2,
  });

  assert.equal(result.pendingVariant, "loyal");
});

test("getNegotiationState — pending med forkert start_season giver pendingVariant null", async () => {
  const loyalOffer = generateOffers({
    teamId: "t1",
    seasonNumber: 3,
    renownTargetValue: 400000,
  }).find((o) => o.variant === "loyal");
  const stalePending = {
    id: "p1",
    team_id: "t1",
    status: "pending",
    start_season: 99, // matcher ikke upcomingSeasonNumber 3
    length_seasons: loyalOffer.lengthSeasons,
    guaranteed_base: loyalOffer.guaranteedBase,
    variant: "loyal",
  };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 2: null },
    activeContractByTeam: { t1: null },
    pendingContractByTeam: { t1: stalePending },
  });

  const result = await getNegotiationState({
    supabase,
    teamId: "t1",
    currentSeasonNumber: 2,
  });

  assert.equal(result.pendingVariant, null);
});

test("getNegotiationState — #3316: hold UDEN aktiv kontrakt men med en pending for NÆSTE sæson (de 5 D4-hold) forhandler stadig straks for INDEVÆRENDE sæson, uden at vise den fremtidige pending som 'valgt'", async () => {
  // Modellerer audit-fundet: 5 D4-hold har allerede valgt et tilbud under den
  // GAMLE pending-semantik (for sæson 3), men har INGEN aktiv kontrakt for
  // indeværende sæson (2) — de har spillet sponsorløst. Denne PR rører IKKE
  // deres eksisterende sæson-3-valg (ejer-scope), men lader dem ALLIGEVEL
  // forhandle en immediate sæson-2-kontrakt.
  const loyalOffer = generateOffers({ teamId: "t1", seasonNumber: 3, renownTargetValue: 400000 })
    .find((o) => o.variant === "loyal");
  const futurePending = {
    id: "p-future",
    team_id: "t1",
    status: "pending",
    start_season: 3,
    length_seasons: loyalOffer.lengthSeasons,
    guaranteed_base: loyalOffer.guaranteedBase,
    variant: "loyal",
  };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 1: null },
    activeContractByTeam: { t1: null },
    pendingContractByTeam: { t1: futurePending },
  });

  const result = await getNegotiationState({ supabase, teamId: "t1", currentSeasonNumber: 2 });

  assert.equal(result.negotiable, true);
  assert.equal(result.immediate, true);
  assert.equal(result.upcomingSeasonNumber, 2, "forhandler for INDEVÆRENDE sæson, ikke den fremtidige pending's sæson 3");
  // Den eksisterende sæson-3-pending må IKKE dukke op som "valgt" på sæson-2-tilbuddene.
  assert.equal(result.pendingVariant, null);
  const expected = generateOffers({ teamId: "t1", seasonNumber: 2, renownTargetValue: 400000 });
  assert.deepEqual(result.offers, expected);
});

test("acceptOffer skriver en PENDING kontrakt (ikke aktiv) for kommende sæson, med frosne #2948-felter", async () => {
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 2: null }, // kommende sæson 3 → prev 2; frisk → target 400000
    standingsBySeasonId: {},
    activeContractByTeam: { t1: { id: "c-old", team_id: "t1", status: "active", expires_after_season: 3 } },
    pendingContractByTeam: { t1: null },
  });

  const row = await acceptOffer({
    supabase,
    teamId: "t1",
    upcomingSeasonNumber: 3,
    variant: "loyal",
  });

  // Erstatter en evt. pending (her ingen) — flip gatet på status=pending, IKKE active.
  assert.equal(supabase.state.updates.length, 1);
  assert.equal(supabase.state.updates[0].payload.status, "replaced");
  assert.equal(supabase.state.updates[0].team_id, "t1");
  assert.equal(supabase.state.updates[0].status, "pending");

  // Den nye række er PENDING med korrekt start_season + variant-felter.
  const loyalVariant = generateOffers({
    teamId: "t1",
    seasonNumber: 3,
    renownTargetValue: 400000,
  }).find((o) => o.variant === "loyal");

  assert.equal(supabase.state.inserts.length, 1);
  const inserted = supabase.state.inserts[0];
  assert.equal(inserted.team_id, "t1");
  assert.equal(inserted.sponsor_name, loyalVariant.sponsorName);
  assert.equal(inserted.guaranteed_base, loyalVariant.guaranteedBase);
  assert.equal(inserted.per_race_day_rate, loyalVariant.perRaceDayRate);
  assert.equal(inserted.length_seasons, loyalVariant.lengthSeasons); // 3
  assert.equal(inserted.start_season, 3);
  assert.equal(inserted.expires_after_season, 3 + loyalVariant.lengthSeasons - 1); // 5
  assert.equal(inserted.status, "pending");

  // #2948: variant + frosne andele + klausuler skrives på rækken.
  assert.equal(inserted.variant, "loyal");
  assert.equal(inserted.guaranteed_fraction, 0.78);
  assert.equal(inserted.race_day_share, 0.18);
  assert.deepEqual(inserted.bonus_clauses, loyalVariant.clauses);
  assert.equal(inserted.bonus_clauses[0].type, "signing");

  assert.deepEqual(row, inserted);
});

test("acceptOffer erstatter en eksisterende pending", async () => {
  const oldPending = {
    id: "p-old",
    team_id: "t1",
    status: "pending",
    start_season: 3,
  };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 2: null },
    pendingContractByTeam: { t1: oldPending },
  });

  await acceptOffer({
    supabase,
    teamId: "t1",
    upcomingSeasonNumber: 3,
    variant: "safe",
  });

  // Den gamle pending blev flippet til 'replaced'.
  assert.equal(supabase.state.updates.length, 1);
  assert.equal(supabase.state.updates[0].payload.status, "replaced");
  assert.equal(supabase.state.updates[0].status, "pending");
  // Den nye pending er indsat.
  assert.equal(supabase.state.inserts.length, 1);
  assert.equal(supabase.state.inserts[0].status, "pending");
  assert.equal(supabase.state.inserts[0].variant, "safe");
});

test("acceptOffer kaster ved ukendt variant", async () => {
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 2: null },
  });
  await assert.rejects(
    () => acceptOffer({ supabase, teamId: "t1", upcomingSeasonNumber: 3, variant: "nonsense" }),
    /Ukendt variant/,
  );
});

// ─── #3316: acceptOfferImmediately — mid-season sponsor-onboarding ────────────

test("acceptOfferImmediately skriver en AKTIV kontrakt (ikke pending) for INDEVÆRENDE sæson med activated_at sat, og krediterer INGEN guaranteed_base", async () => {
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 1: null }, // seasonNumber 2 → prev 1; frisk → target 400000
    activeContractByTeam: { t1: null },
    pendingContractByTeam: { t1: null },
  });

  const before = Date.now();
  const contract = await acceptOfferImmediately({
    supabase,
    teamId: "t1",
    seasonNumber: 2,
    variant: "safe",
  });
  const after = Date.now();

  const safeOffer = generateOffers({ teamId: "t1", seasonNumber: 2, renownTargetValue: 400000 })
    .find((o) => o.variant === "safe");

  assert.equal(supabase.state.inserts.length, 1);
  const inserted = supabase.state.inserts[0];
  assert.equal(inserted.team_id, "t1");
  assert.equal(inserted.status, "active", "aktiveres straks — IKKE pending");
  assert.equal(inserted.start_season, 2);
  assert.equal(inserted.expires_after_season, 2 + safeOffer.lengthSeasons - 1);
  assert.equal(inserted.variant, "safe");
  // guaranteed_base er kontraktens FROSNE sandhed (bruges af næste rigtige
  // sæson-starts udbetaling) — men INGEN rpc-kald sker her for den (se nedenfor).
  assert.equal(inserted.guaranteed_base, safeOffer.guaranteedBase);

  assert.ok(inserted.activated_at, "activated_at skal være sat");
  const activatedAtMs = new Date(inserted.activated_at).getTime();
  assert.ok(
    activatedAtMs >= before && activatedAtMs <= after,
    "activated_at skal være 'nu' på aktiveringstidspunktet",
  );

  assert.deepEqual(contract, inserted);

  // #3316-rammen: INGEN base-udbetaling for indeværende sæson — 'safe' har
  // heller ingen signing-klausul, så der sker slet ingen kreditering her.
  assert.equal(supabase.state.rpcCalls.length, 0);
});

test("acceptOfferImmediately genberegner per_race_day_rate mod holdets EGEN etape-divisor for INDEVÆRENDE sæson (#2913) og krediterer signing bonus", async () => {
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    teamsById: { t1: { id: "t1", division: 2, league_division_id: "pool-a" } },
    seasonsByNumber: {
      1: null, // renown-opslag (prev season for target 400000)
      2: { id: "s2", number: 2, race_days_total: 60 }, // stageCounts-opslag for seasonNumber 2
    },
    racesBySeasonId: { s2: [
      { league_division_id: "pool-a", stages: 3 },
      { league_division_id: "pool-a", stages: 2 },
      { league_division_id: "pool-b", stages: 5 },
    ] },
    poolsList: [{ id: "pool-a", tier: 2 }, { id: "pool-b", tier: 3 }],
    activeContractByTeam: { t1: null },
    pendingContractByTeam: { t1: null },
  });

  const loyalOffer = generateOffers({ teamId: "t1", seasonNumber: 2, renownTargetValue: 400000 })
    .find((o) => o.variant === "loyal");
  const signingAmount = loyalOffer.clauses.find((c) => c.type === "signing").amount;

  const contract = await acceptOfferImmediately({
    supabase,
    teamId: "t1",
    seasonNumber: 2,
    variant: "loyal",
  });

  // Pool-a's etapetal er 3+2=5 — IKKE race_days_total (60) og IKKE tilbuddets
  // egen display-projektion (som brugte en anden divisor).
  assert.equal(
    contract.per_race_day_rate,
    Math.round((400000 * 0.18) / 5),
    "divisoren skal være holdets EGEN pulje-etapetal (5), ikke sæson-kalenderen (60)",
  );

  assert.equal(supabase.state.rpcCalls.length, 1, "signing bonus krediteres ved aktivering, ligesom expireAndRenewContracts");
  const call = supabase.state.rpcCalls[0];
  assert.equal(call.teamId, "t1");
  assert.equal(call.delta, signingAmount);
  assert.equal(call.payload.type, "sponsor_signing_bonus");
  assert.equal(call.payload.idempotency_key, `sponsor_signing:${contract.id}`);
});

test("acceptOfferImmediately flipper KUN en pending der peger på DENNE sæson — rører ALDRIG en pending for en SENERE sæson (#3316, de 5 D4-hold)", async () => {
  const futurePending = { id: "p-future", team_id: "t1", status: "pending", start_season: 3 };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 1: null },
    activeContractByTeam: { t1: null },
    pendingContractByTeam: { t1: futurePending },
  });

  await acceptOfferImmediately({ supabase, teamId: "t1", seasonNumber: 2, variant: "safe" });

  // Ingen update-kald overhovedet — sæson-3-pendingen er urørt.
  assert.equal(supabase.state.updates.length, 0, "en pending for en SENERE sæson må ALDRIG flippes af den immediate accept-sti");
  assert.equal(supabase.state.inserts.length, 1);
  assert.equal(supabase.state.inserts[0].status, "active");
});

test("acceptOfferImmediately flipper en dangling pending der PEGER PÅ DENNE sæson (defensiv oprydning)", async () => {
  const stalePendingSameSeason = { id: "p-stale", team_id: "t1", status: "pending", start_season: 2 };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 1: null },
    activeContractByTeam: { t1: null },
    pendingContractByTeam: { t1: stalePendingSameSeason },
  });

  await acceptOfferImmediately({ supabase, teamId: "t1", seasonNumber: 2, variant: "safe" });

  assert.equal(supabase.state.updates.length, 1);
  assert.equal(supabase.state.updates[0].payload.status, "replaced");
  assert.equal(supabase.state.updates[0].id, "p-stale");
});

test("acceptOfferImmediately kaster ved ukendt variant", async () => {
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 1: null },
    activeContractByTeam: { t1: null },
    pendingContractByTeam: { t1: null },
  });
  await assert.rejects(
    () => acceptOfferImmediately({ supabase, teamId: "t1", seasonNumber: 2, variant: "nonsense" }),
    /Ukendt variant/,
  );
});

test("expireAndRenewContracts beholder en stadig-låst kontrakt", async () => {
  const stillLocked = {
    id: "c-locked",
    team_id: "t1",
    status: "active",
    expires_after_season: 4, // >= newSeasonNumber 3 → behold
  };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    activeContractByTeam: { t1: stillLocked },
  });

  await expireAndRenewContracts({ supabase, newSeasonNumber: 3, teamIds: ["t1"] });

  // Ingen update, ingen insert, ingen rpc — kontrakten er låst.
  assert.equal(supabase.state.updates.length, 0);
  assert.equal(supabase.state.inserts.length, 0);
  assert.equal(supabase.state.rpcCalls.length, 0);
});

// #4515 · resultat-loftet er et SÆSON-loft, ikke et kontrakt-loft. En 2-sæsoners
// 'results'-kontrakt der brugte loftet op i sit første år gav 0 i resultat-bonus
// hele det andet år, mens base og løbsdagsrate blev fornyet som normalt (målt i
// prod 31/8: Team WolkerWessels, 238.000 af 238.000 brugt i S2 → 0 i S3).
// Nulstillingen hører til her fordi det er det ENESTE sted en flersæsons-kontrakt
// krydser en sæsongrænse — aktiverings-/default-stierne opretter altid en frisk
// række med results_bonus_paid = 0.
test("expireAndRenewContracts nulstiller resultat-loftets forbrug på en låst flersæsons-kontrakt (#4515)", async () => {
  const stillLocked = {
    id: "c-locked",
    team_id: "t1",
    status: "active",
    expires_after_season: 4, // >= newSeasonNumber 3 → behold kontrakten
    results_bonus_paid: 238000, // loftet brugt op i den forrige sæson
  };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    activeContractByTeam: { t1: stillLocked },
  });

  await expireAndRenewContracts({ supabase, newSeasonNumber: 3, teamIds: ["t1"] });

  assert.equal(supabase.state.updates.length, 1, "præcis én update — loft-nulstillingen");
  assert.deepEqual(supabase.state.updates[0].payload, { results_bonus_paid: 0 });
  assert.equal(supabase.state.updates[0].id, "c-locked", "rammer kontrakten via id");
  // Kontrakten skal IKKE udløbes eller genoprettes — kun loftet ryddes.
  assert.equal(supabase.state.inserts.length, 0);
  assert.equal(supabase.state.rpcCalls.length, 0);
});

// Gør nulstillingen betinget: uden denne guard ville HVER sæsonovergang skrive en
// række pr. låst kontrakt (200+ writes i prod) udelukkende for at sætte 0 til 0.
test("expireAndRenewContracts skriver ikke når en låst kontrakt intet loft-forbrug har (#4515)", async () => {
  const stillLocked = {
    id: "c-locked",
    team_id: "t1",
    status: "active",
    expires_after_season: 4,
    results_bonus_paid: 0,
  };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    activeContractByTeam: { t1: stillLocked },
  });

  await expireAndRenewContracts({ supabase, newSeasonNumber: 3, teamIds: ["t1"] });

  assert.equal(supabase.state.updates.length, 0, "intet at nulstille → ingen write");
});

test("expireAndRenewContracts: #3014 — chunker teams.in() når teamIds overstiger URL-cap-grænsen (250 hold → 3 chunks af maks 100)", async () => {
  const teamIds = Array.from({ length: 250 }, (_, i) => `t${i}`);
  const activeContractByTeam = Object.fromEntries(
    teamIds.map((id) => [id, {
      id: `c-${id}`,
      team_id: id,
      status: "active",
      expires_after_season: 99, // langt over newSeasonNumber → alle forbliver låst, ingen ekstra queries
    }]),
  );
  const teamsById = Object.fromEntries(
    teamIds.map((id) => [id, { id, division: 2, league_division_id: null }]),
  );
  const supabase = makeSupabase({
    team: { id: teamIds[0], division: 2 },
    activeContractByTeam,
    teamsById,
  });

  await expireAndRenewContracts({ supabase, newSeasonNumber: 3, teamIds });

  assert.deepEqual(
    supabase.state.teamsInChunkSizes,
    [100, 100, 50],
    "250 hold skal chunkes i 2×100 + 1×50, ikke ét samlet .in() med 250 id'er",
  );
  // Alle 250 var stadig-låste — ingen update/insert/rpc, ligesom enkelt-holds-testen ovenfor.
  assert.equal(supabase.state.updates.length, 0);
  assert.equal(supabase.state.inserts.length, 0);
  assert.equal(supabase.state.rpcCalls.length, 0);
});

test("expireAndRenewContracts AKTIVERER en matchende pending (manager-valg, legacy-række uden guaranteed_fraction)", async () => {
  const expiring = {
    id: "c-exp",
    team_id: "t1",
    status: "active",
    expires_after_season: 2, // < newSeasonNumber 3 → udløb
  };
  const pending = {
    id: "p-choice",
    team_id: "t1",
    status: "pending",
    start_season: 3, // matcher newSeasonNumber → aktivér
    length_seasons: 2,
    guaranteed_base: 220000,
    expires_after_season: 4,
  };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 2: null },
    activeContractByTeam: { t1: expiring },
    pendingContractByTeam: { t1: pending },
  });

  await expireAndRenewContracts({ supabase, newSeasonNumber: 3, teamIds: ["t1"] });

  // Den gamle aktive blev udløbet (by id).
  const expiredFlip = supabase.state.updates.find((u) => u.payload.status === "expired");
  assert.ok(expiredFlip, "forventede en 'expired'-flip");
  assert.equal(expiredFlip.id, "c-exp");

  // Den pending række blev aktiveret (pending -> active, by id) — IKKE en ny insert.
  const activatedFlip = supabase.state.updates.find((u) => u.payload.status === "active");
  assert.ok(activatedFlip, "forventede en 'active'-aktivering af pending");
  assert.equal(activatedFlip.id, "p-choice");

  // Ingen default-insert: managerens valg blev brugt.
  assert.equal(supabase.state.inserts.length, 0);
  // Ingen bonus_clauses på denne legacy-pending → ingen signing-bonus krediteres.
  assert.equal(supabase.state.rpcCalls.length, 0);

  // Pending er nu aktiv (mock-state afspejler aktivering).
  const nowActive = await getActiveContract({ supabase, teamId: "t1" });
  assert.ok(nowActive, "den aktiverede kontrakt skal nu være aktiv");
  assert.equal(nowActive.id, "p-choice");
  assert.equal(nowActive.status, "active");
  // Ingen pending tilbage efter aktivering.
  const stillPending = await getPendingContract({ supabase, teamId: "t1" });
  assert.equal(stillPending, null);
});

test("expireAndRenewContracts falder tilbage til default 'safe' når ingen matchende pending (#2914)", async () => {
  const expiring = {
    id: "c-exp",
    team_id: "t1",
    status: "active",
    expires_after_season: 2, // < newSeasonNumber 3 → udløb + forny
  };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 2: null }, // sæson 3 - 1 = 2; ingen standings → target 400000
    standingsBySeasonId: {},
    activeContractByTeam: { t1: expiring },
    pendingContractByTeam: { t1: null },
  });

  await expireAndRenewContracts({ supabase, newSeasonNumber: 3, teamIds: ["t1"] });

  // Den gamle blev udløbet (by id).
  const expiredFlip = supabase.state.updates.find((u) => u.payload.status === "expired");
  assert.ok(expiredFlip, "forventede en 'expired'-flip");
  assert.equal(expiredFlip.id, "c-exp");

  // Default-forny med 'safe' (aktiv) for sæson 3 — direkte insert, ingen pending.
  assert.equal(supabase.state.inserts.length, 1);
  const inserted = supabase.state.inserts[0];
  const safeVariant = generateOffers({
    teamId: "t1",
    seasonNumber: 3,
    renownTargetValue: 400000,
  }).find((o) => o.variant === "safe");
  assert.equal(inserted.variant, "safe");
  assert.equal(inserted.length_seasons, safeVariant.lengthSeasons); // 1
  assert.equal(inserted.start_season, 3);
  assert.equal(inserted.expires_after_season, 3 + safeVariant.lengthSeasons - 1); // 3
  assert.equal(inserted.status, "active");
  assert.equal(inserted.guaranteed_fraction, 0.92);
  assert.equal(inserted.race_day_share, 0.08);
  assert.deepEqual(inserted.bonus_clauses, []);
});

test("expireAndRenewContracts default-fornyer med ELEVERET renown for et hold der skiftede division (#2909)", async () => {
  // Hold der IKKE selv valgte sponsor (ingen pending) → default-forny rammer
  // getOffers → loadRenownTargetValue. Holdets nye division er 2; sidste sæson
  // kørte det suverænt i D3. Regressions-fælden: hvis renewal-stien filtrerer
  // season_standings på holdets NYE division FØR opslag, findes t1's egen
  // række aldrig, og den fornyede kontrakts guaranteed_base falder til den
  // flade 1.0-multiplikator-værdi i stedet for at afspejle D3-formen.
  const expiring = { id: "c-exp", team_id: "t1", status: "active", expires_after_season: 2 };
  const prevSeason = { id: "s1", number: 2 };
  const standings = [
    { season_id: "s1", team_id: "t1", division: 3, rank_in_division: 1, total_points: 900 },
    { season_id: "s1", team_id: "t3b", division: 3, rank_in_division: 2, total_points: 200 },
    { season_id: "s1", team_id: "t2a", division: 2, rank_in_division: 1, total_points: 500 },
  ];
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 }, // NYE division efter oprykning fra D3
    seasonsByNumber: { 2: prevSeason },
    standingsBySeasonId: { s1: standings },
    activeContractByTeam: { t1: expiring },
    pendingContractByTeam: { t1: null },
  });

  await expireAndRenewContracts({ supabase, newSeasonNumber: 3, teamIds: ["t1"] });

  assert.equal(supabase.state.inserts.length, 1);
  const inserted = supabase.state.inserts[0];
  assert.equal(inserted.status, "active");
  assert.equal(inserted.variant, "safe");

  // Facit: samme renownTarget som motoren beregner direkte fra holdets EGEN
  // (D3-)standing — ikke den flade division-2-base (400000).
  const mine = standings.find((s) => s.team_id === "t1");
  const divisionStandings = standings.filter((s) => s.division === 3);
  const expectedTarget = renownTarget({ division: 2, lastSeasonStanding: mine, divisionStandings });
  const safeVariant = generateOffers({
    teamId: "t1",
    seasonNumber: 3,
    renownTargetValue: expectedTarget,
  }).find((o) => o.variant === "safe");

  assert.equal(inserted.guaranteed_base, safeVariant.guaranteedBase);
  assert.ok(
    inserted.guaranteed_base > Math.round(400000 * 0.92),
    `guaranteed_base skal afspejle D3-formen, fik ${inserted.guaranteed_base}`,
  );
});

test("expireAndRenewContracts fornyer et hold helt uden kontrakt (default 'safe')", async () => {
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 2: null },
    activeContractByTeam: { t1: null },
    pendingContractByTeam: { t1: null },
  });

  await expireAndRenewContracts({ supabase, newSeasonNumber: 3, teamIds: ["t1"] });

  // Ingen 'expired'-flip (intet at udløbe), men en ny 'safe'-kontrakt (aktiv) indsættes.
  assert.equal(supabase.state.updates.filter((u) => u.payload.status === "expired").length, 0);
  assert.equal(supabase.state.inserts.length, 1);
  assert.equal(supabase.state.inserts[0].status, "active");
  assert.equal(supabase.state.inserts[0].variant, "safe");
  assert.equal(supabase.state.inserts[0].start_season, 3);
});

test("expireAndRenewContracts ignorerer pending der ikke matcher newSeasonNumber → default", async () => {
  // Pending med forkert start_season (fx en stale fra en tidligere fejl) → default-forny.
  const stalePending = {
    id: "p-stale",
    team_id: "t1",
    status: "pending",
    start_season: 99,
    length_seasons: 1,
    guaranteed_base: 1,
  };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 2: null },
    activeContractByTeam: { t1: null },
    pendingContractByTeam: { t1: stalePending },
  });

  await expireAndRenewContracts({ supabase, newSeasonNumber: 3, teamIds: ["t1"] });

  // Ingen aktivering af den stale pending; default 'safe' indsat i stedet.
  assert.equal(supabase.state.updates.filter((u) => u.payload.status === "active").length, 0);
  assert.equal(supabase.state.inserts.length, 1);
  assert.equal(supabase.state.inserts[0].status, "active");
  assert.equal(supabase.state.inserts[0].variant, "safe");
  assert.equal(supabase.state.inserts[0].start_season, 3);
});

// ─── #2589/#2948: per_race_day_rate genberegnes ved AKTIVERING ───────────────

test("recomputeActivationRate: (legacy) bruger den NYE sæsons kalenderlængde som divisor, ikke pick-tidens", () => {
  // "activity"-variant (legacy length_seasons=2 → guaranteedFraction=0.55). guaranteed_base
  // = 220000 → original renownTargetValue = 220000/0.55 = 400000. Ved pick var
  // kalenderen 60 dage (den daværende default); ved aktivering er den nye sæsons
  // reelle kalender 28 dage — raten SKAL låses til 28, ikke 60.
  const pending = { length_seasons: 2, guaranteed_base: 220000, per_race_day_rate: 3000 };
  const rate28 = recomputeActivationRate(pending, 28);
  const rate60 = recomputeActivationRate(pending, 60);
  assert.equal(rate60, 3000); // uændret hvis kalenderen (fejlagtigt) stadig var 60
  assert.equal(rate28, Math.round((400000 - 220000) / 28));
  assert.notEqual(rate28, rate60, "en anden kalenderlængde SKAL give en anden rate");
});

test("recomputeActivationRate: (legacy) robust mod season_standings-drift (matcher IKKE på guaranteed_base)", () => {
  // Reproducerer prod-eksemplet fra issue #2589-kommentaren (team 0a4ed517):
  // "long"-variant (legacy length_seasons=3 → guaranteedFraction=0.73), guaranteed_base
  // 248200 svarer til en original renownTargetValue på 340000 — IKKE den ~339109
  // en frisk regenerering ville give i dag (season_standings har flyttet sig siden
  // pick). Den gamle tilgang (match mod et regenereret tilbud) ville fejle her og
  // stille tavst raten urørt; baglæns-udledningen rammer korrekt uanset drift.
  const pending = { length_seasons: 3, guaranteed_base: 248200, per_race_day_rate: 1530 };
  const rate = recomputeActivationRate(pending, 28);
  assert.equal(rate, Math.round((340000 - 248200) / 28)); // = 3279
});

test("recomputeActivationRate: (legacy) IEEE-754-afrunding (0.55 er ikke eksakt repræsentérbar) giver stadig det korrekte heltal", () => {
  // Adversarielt review 23/7, prod-række sponsor_contracts.id=286250a9-56fb-
  // 4388-8fe2-04676c516dea: guaranteed_base=242550, length_seasons=2 (fraction
  // 0.55). 242550/0.55 er IKKE eksakt 441000 i IEEE-754 — det bliver
  // 440999.99999999994. Uden Math.round på originalRenownTarget FØR videre
  // regning ville (440999.99999999994-242550)/28 = 7087.499999999998 afrunde
  // NED til 7087 i stedet for det korrekte 7088 ((441000-242550)/28 = 7087.5,
  // som runder OP). Denne test låser at den lagrede per_race_day_rate (7088,
  // den faktiske prod-værdi) rammes eksakt.
  const pending = { length_seasons: 2, guaranteed_base: 242550, per_race_day_rate: 7088 };
  const rate = recomputeActivationRate(pending, 28);
  assert.equal(rate, 7088);
});

test("recomputeActivationRate: (legacy) ukendt length_seasons → behold den lagrede rate (ingen gætning)", () => {
  const pending = { length_seasons: 7, guaranteed_base: 100000, per_race_day_rate: 999 };
  assert.equal(recomputeActivationRate(pending, 28), 999);
});

test("recomputeActivationRate: (#2948 primær sti) bruger lagret guaranteed_fraction + race_day_share, ikke legacy-length-opslag", () => {
  // 'loyal'-arketype (fraction 0.78, raceDayShare 0.18). guaranteed_base = round(500000×0.78) = 390000.
  const pending = { guaranteed_fraction: 0.78, race_day_share: 0.18, guaranteed_base: 390000 };
  const rate = recomputeActivationRate(pending, 28);
  // originalRenownTarget = round(390000/0.78) = 500000; rate = round(500000×0.18/28).
  assert.equal(rate, Math.round((500000 * 0.18) / 28));
});

test("recomputeActivationRate: (#2948) manglende race_day_share falder tilbage til (1 - fraction)", () => {
  const pending = { guaranteed_fraction: 0.92, guaranteed_base: 460000 }; // 500000×0.92
  const rate = recomputeActivationRate(pending, 28);
  const share = 1 - 0.92;
  assert.equal(rate, Math.round((500000 * share) / 28));
});

test("expireAndRenewContracts: aktivering af en pending genberegner per_race_day_rate ud fra sæson-3-kalenderen (28 dage, legacy-fallback)", async () => {
  const expiring = { id: "c-exp", team_id: "t1", status: "active", expires_after_season: 2 };
  const pending = {
    id: "p-choice",
    team_id: "t1",
    status: "pending",
    start_season: 3,
    length_seasons: 2, // guaranteedFraction 0.55 (legacy-opslag, ingen guaranteed_fraction-kolonne)
    guaranteed_base: 220000,
    per_race_day_rate: 3000, // frosset ved pick med den daværende (60-dages) kalender
    expires_after_season: 4,
  };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 3: { id: "s3", number: 3, race_days_total: 28 } }, // den NYE sæsons faktiske kalenderlængde
    activeContractByTeam: { t1: expiring },
    pendingContractByTeam: { t1: pending },
  });

  await expireAndRenewContracts({ supabase, newSeasonNumber: 3, teamIds: ["t1"] });

  const activatedFlip = supabase.state.updates.find((u) => u.id === "p-choice");
  assert.ok(activatedFlip, "forventede en aktiverings-update på p-choice");
  assert.equal(activatedFlip.payload.status, "active");
  // 400000 = 220000 / 0.55 (original renownTargetValue); (400000-220000)/28 = 6429.
  assert.equal(activatedFlip.payload.per_race_day_rate, 6429);
  assert.notEqual(activatedFlip.payload.per_race_day_rate, pending.per_race_day_rate);
});

// ─── #2913: divisor = holdets FAKTISKE etapetal (races/league_divisions), ikke kalenderdage ─

test("expireAndRenewContracts: bruger holdets EGEN pulje-etapetal som divisor ved aktivering (#2913)", async () => {
  const expiring = { id: "c-exp", team_id: "t1", status: "active", expires_after_season: 2 };
  const loyalOffer = generateOffers({ teamId: "t1", seasonNumber: 3, renownTargetValue: 400000 })
    .find((o) => o.variant === "loyal");
  const pending = {
    id: "p-loyal",
    team_id: "t1",
    status: "pending",
    start_season: 3,
    length_seasons: loyalOffer.lengthSeasons,
    guaranteed_base: loyalOffer.guaranteedBase,
    guaranteed_fraction: loyalOffer.guaranteedFraction,
    race_day_share: loyalOffer.raceDayShare,
    bonus_clauses: [],
    expires_after_season: 5,
  };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    teamsById: { t1: { id: "t1", division: 2, league_division_id: "pool-a" } },
    seasonsByNumber: { 3: { id: "s3", number: 3, race_days_total: 60 } },
    racesBySeasonId: { s3: [
      { league_division_id: "pool-a", stages: 3 },
      { league_division_id: "pool-a", stages: 2 },
      { league_division_id: "pool-b", stages: 5 },
    ] },
    poolsList: [{ id: "pool-a", tier: 2 }, { id: "pool-b", tier: 3 }],
    activeContractByTeam: { t1: expiring },
    pendingContractByTeam: { t1: pending },
  });

  await expireAndRenewContracts({ supabase, newSeasonNumber: 3, teamIds: ["t1"] });

  const activatedFlip = supabase.state.updates.find((u) => u.id === "p-loyal");
  assert.ok(activatedFlip);
  // Pool-a's etapetal er 3+2=5 — IKKE den generelle sæson-kalender (60).
  assert.equal(
    activatedFlip.payload.per_race_day_rate,
    Math.round((400000 * 0.18) / 5),
    "divisoren skal være holdets EGEN pulje-etapetal (5), ikke race_days_total (60)",
  );
});

// ─── #2948: signing bonus krediteres ved aktivering af 'loyal'-pending ────────

test("expireAndRenewContracts: krediterer signing bonus ved aktivering af 'loyal'-pending (idempotency_key sponsor_signing:<id>)", async () => {
  const expiring = { id: "c-exp", team_id: "t1", status: "active", expires_after_season: 2 };
  const loyalOffer = generateOffers({ teamId: "t1", seasonNumber: 3, renownTargetValue: 400000 })
    .find((o) => o.variant === "loyal");
  const signingAmount = loyalOffer.clauses.find((c) => c.type === "signing").amount;
  const pending = {
    id: "p-loyal",
    team_id: "t1",
    status: "pending",
    start_season: 3,
    length_seasons: loyalOffer.lengthSeasons,
    guaranteed_base: loyalOffer.guaranteedBase,
    guaranteed_fraction: loyalOffer.guaranteedFraction,
    race_day_share: loyalOffer.raceDayShare,
    bonus_clauses: loyalOffer.clauses,
    sponsor_name: loyalOffer.sponsorName,
    expires_after_season: 5,
  };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 2: null },
    activeContractByTeam: { t1: expiring },
    pendingContractByTeam: { t1: pending },
  });

  await expireAndRenewContracts({ supabase, newSeasonNumber: 3, teamIds: ["t1"] });

  assert.equal(supabase.state.rpcCalls.length, 1, "forventede præcis ét rpc-kald (signing bonus)");
  const call = supabase.state.rpcCalls[0];
  assert.equal(call.teamId, "t1");
  assert.equal(call.delta, signingAmount);
  assert.equal(call.payload.type, "sponsor_signing_bonus");
  assert.equal(call.payload.reason_code, FINANCE_REASON.SPONSOR_SIGNING_BONUS);
  assert.equal(call.payload.idempotency_key, "sponsor_signing:p-loyal");
  // #3198-fund-7b: metadata.code skal findes så FinancePage kan vise oversat
  // tekst i stedet for den rå engelske description.
  assert.equal(call.payload.metadata?.code, "tx.sponsor.signingBonus");
  assert.equal(call.payload.metadata?.params?.sponsorName, loyalOffer.sponsorName);
});

test("#3315: expireAndRenewContracts sender ÉN sponsor_paid-notifikation ved signing bonus", async () => {
  const expiring = { id: "c-exp", team_id: "t1", status: "active", expires_after_season: 2 };
  const loyalOffer = generateOffers({ teamId: "t1", seasonNumber: 3, renownTargetValue: 400000 })
    .find((o) => o.variant === "loyal");
  const signingAmount = loyalOffer.clauses.find((c) => c.type === "signing").amount;
  const pending = {
    id: "p-loyal",
    team_id: "t1",
    status: "pending",
    start_season: 3,
    length_seasons: loyalOffer.lengthSeasons,
    guaranteed_base: loyalOffer.guaranteedBase,
    guaranteed_fraction: loyalOffer.guaranteedFraction,
    race_day_share: loyalOffer.raceDayShare,
    bonus_clauses: loyalOffer.clauses,
    sponsor_name: loyalOffer.sponsorName,
    expires_after_season: 5,
  };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2, user_id: "user-1" },
    seasonsByNumber: { 2: null },
    activeContractByTeam: { t1: expiring },
    pendingContractByTeam: { t1: pending },
  });

  await expireAndRenewContracts({ supabase, newSeasonNumber: 3, teamIds: ["t1"] });

  assert.equal(supabase.state.notificationInserts.length, 1);
  const notif = supabase.state.notificationInserts[0];
  assert.equal(notif.user_id, "user-1");
  assert.equal(notif.type, "sponsor_paid");
  assert.match(notif.message, new RegExp(loyalOffer.sponsorName));
  assert.match(notif.message, new RegExp(String(signingAmount)));
  assert.equal(notif.metadata.titleCode, "notif.sponsorPaid.signingBonus.title");
  assert.equal(notif.metadata.messageCode, "notif.sponsorPaid.signingBonus.message");
  assert.deepEqual(notif.metadata.messageParams, { sponsor: loyalOffer.sponsorName, amount: signingAmount });
});

test("#3315: expireAndRenewContracts: 23505-idempotent skip på signing bonus sender INGEN notifikation", async () => {
  const expiring = { id: "c-exp", team_id: "t1", status: "active", expires_after_season: 2 };
  const loyalOffer = generateOffers({ teamId: "t1", seasonNumber: 3, renownTargetValue: 400000 })
    .find((o) => o.variant === "loyal");
  const pending = {
    id: "p-loyal",
    team_id: "t1",
    status: "pending",
    start_season: 3,
    length_seasons: loyalOffer.lengthSeasons,
    guaranteed_base: loyalOffer.guaranteedBase,
    guaranteed_fraction: loyalOffer.guaranteedFraction,
    race_day_share: loyalOffer.raceDayShare,
    bonus_clauses: loyalOffer.clauses,
    sponsor_name: loyalOffer.sponsorName,
    expires_after_season: 5,
  };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2, user_id: "user-1" },
    seasonsByNumber: { 2: null },
    activeContractByTeam: { t1: expiring },
    pendingContractByTeam: { t1: pending },
    skipRpcKeys: new Set(["sponsor_signing:p-loyal"]),
  });

  await expireAndRenewContracts({ supabase, newSeasonNumber: 3, teamIds: ["t1"] });

  assert.equal(supabase.state.notificationInserts.length, 0, "genkørsel må ikke sende en ny signing-bonus-besked");
});

test("expireAndRenewContracts: 'safe'-default-fornyelse (ingen signing-klausul) krediterer INGEN signing bonus", async () => {
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 2: null },
    activeContractByTeam: { t1: null },
    pendingContractByTeam: { t1: null },
  });

  await expireAndRenewContracts({ supabase, newSeasonNumber: 3, teamIds: ["t1"] });

  assert.equal(supabase.state.rpcCalls.length, 0, "default-forny sker via direkte insert (active), ikke aktivering — ingen signing-bonus-kald");
});

// ─── #2948: evaluateSeasonObjectives (sæsonmåls-klausul) ──────────────────────

test("evaluateSeasonObjectives: betaler kun hold med rank <= ceil(poolSize/2) (top_half)", async () => {
  const supabase = makeSupabase({
    seasonsByNumber: { 2: { id: "s2", number: 2 } },
    activeContractByTeam: {
      t1: { id: "c1", team_id: "t1", sponsor_name: "Larkin Brewing", bonus_clauses: [{ type: "season_objective", objective: "top_half", amount: 50000 }] },
      t2: { id: "c2", team_id: "t2", sponsor_name: "Brennan Whisky", bonus_clauses: [{ type: "season_objective", objective: "top_half", amount: 30000 }] },
      t3: { id: "c3", team_id: "t3", sponsor_name: "Safe Co", bonus_clauses: [] }, // ingen sæsonmåls-klausul
    },
    standingsBySeasonId: {
      s2: [
        { team_id: "t1", league_division_id: "pool-a", rank_in_division: 1 }, // top halvdel (pool på 4, ceil(4/2)=2)
        { team_id: "t2", league_division_id: "pool-a", rank_in_division: 4 }, // bund halvdel → ingen bonus
        { team_id: "t3", league_division_id: "pool-a", rank_in_division: 2 },
        { team_id: "t4", league_division_id: "pool-a", rank_in_division: 3 },
      ],
    },
  });

  const result = await evaluateSeasonObjectives({ supabase, finishedSeasonNumber: 2 });

  assert.equal(result.evaluated, 2, "kun de 2 kontrakter med en season_objective-klausul tælles");
  assert.equal(result.paid, 1, "kun t1 (rank 1 <= ceil(4/2)=2) opnåede målet");
  assert.equal(supabase.state.rpcCalls.length, 1);
  const call = supabase.state.rpcCalls[0];
  assert.equal(call.teamId, "t1");
  assert.equal(call.delta, 50000);
  assert.equal(call.payload.type, "sponsor_objective_bonus");
  assert.equal(call.payload.reason_code, FINANCE_REASON.SPONSOR_OBJECTIVE_BONUS);
  assert.equal(call.payload.idempotency_key, "sponsor_objective:c1:2");
  // #3198-fund-7b: metadata.code skal findes så FinancePage kan vise oversat
  // tekst i stedet for den rå engelske description.
  assert.equal(call.payload.metadata?.code, "tx.sponsor.objectiveBonus");
  assert.equal(call.payload.metadata?.params?.sponsorName, "Larkin Brewing");
});

test("#3315: evaluateSeasonObjectives sender sponsor_paid-notifikation til holdet der opnåede målet", async () => {
  const supabase = makeSupabase({
    team: { id: "t1", division: 2, user_id: "user-1" },
    seasonsByNumber: { 2: { id: "s2", number: 2 } },
    activeContractByTeam: {
      t1: { id: "c1", team_id: "t1", sponsor_name: "Larkin Brewing", bonus_clauses: [{ type: "season_objective", objective: "top_half", amount: 50000 }] },
    },
    standingsBySeasonId: {
      s2: [{ team_id: "t1", league_division_id: "pool-a", rank_in_division: 1 }],
    },
  });

  await evaluateSeasonObjectives({ supabase, finishedSeasonNumber: 2 });

  assert.equal(supabase.state.notificationInserts.length, 1);
  const notif = supabase.state.notificationInserts[0];
  assert.equal(notif.user_id, "user-1");
  assert.equal(notif.type, "sponsor_paid");
  assert.match(notif.message, /Larkin Brewing/);
  assert.match(notif.message, /50000/);
  assert.equal(notif.metadata.titleCode, "notif.sponsorPaid.objectiveBonus.title");
  assert.equal(notif.metadata.messageCode, "notif.sponsorPaid.objectiveBonus.message");
  assert.deepEqual(notif.metadata.messageParams, { sponsor: "Larkin Brewing", amount: 50000 });
});

test("#3315: evaluateSeasonObjectives: en fejlende sponsor_paid-notifikation vælter ikke evalueringen", async () => {
  const supabase = makeSupabase({
    team: { id: "t1", division: 2, user_id: "user-1" },
    seasonsByNumber: { 2: { id: "s2", number: 2 } },
    activeContractByTeam: {
      t1: { id: "c1", team_id: "t1", sponsor_name: "Larkin Brewing", bonus_clauses: [{ type: "season_objective", objective: "top_half", amount: 50000 }] },
    },
    standingsBySeasonId: {
      s2: [{ team_id: "t1", league_division_id: "pool-a", rank_in_division: 1 }],
    },
    failNotificationForUserIds: ["user-1"],
  });

  const result = await evaluateSeasonObjectives({ supabase, finishedSeasonNumber: 2 });

  assert.equal(result.paid, 1, "kreditering skal stå ved magt selvom notifikationen fejler");
  assert.equal(supabase.state.notificationInserts.length, 0);
});

test("evaluateSeasonObjectives: idempotent — 23505-skip (allerede betalt) tæller IKKE som paid", async () => {
  const supabase = makeSupabase({
    seasonsByNumber: { 2: { id: "s2", number: 2 } },
    activeContractByTeam: {
      t1: { id: "c1", team_id: "t1", sponsor_name: "Larkin Brewing", bonus_clauses: [{ type: "season_objective", objective: "top_half", amount: 50000 }] },
    },
    standingsBySeasonId: {
      s2: [{ team_id: "t1", league_division_id: "pool-a", rank_in_division: 1 }],
    },
    skipRpcKeys: new Set(["sponsor_objective:c1:2"]),
  });

  const result = await evaluateSeasonObjectives({ supabase, finishedSeasonNumber: 2 });

  assert.equal(result.evaluated, 1);
  assert.equal(result.paid, 0, "genkørsel (23505-dublet) må ikke tælle som en ny betaling");
  assert.equal(supabase.state.rpcCalls.length, 1, "rpc'en blev stadig forsøgt (idempotent no-op, ikke skippet FØR kaldet)");
});

test("evaluateSeasonObjectives: ingen sæson fundet → {evaluated:0, paid:0} uden at kaste", async () => {
  const supabase = makeSupabase({ seasonsByNumber: { 2: null } });
  const result = await evaluateSeasonObjectives({ supabase, finishedSeasonNumber: 2 });
  assert.deepEqual(result, { evaluated: 0, paid: 0 });
  assert.equal(supabase.state.rpcCalls.length, 0);
});

test("evaluateSeasonObjectives: ingen aktive kontrakter med season_objective-klausul → {evaluated:0, paid:0}", async () => {
  const supabase = makeSupabase({
    seasonsByNumber: { 2: { id: "s2", number: 2 } },
    activeContractByTeam: {
      t1: { id: "c1", team_id: "t1", bonus_clauses: [{ type: "signing", amount: 1000 }] }, // ikke season_objective
    },
    standingsBySeasonId: { s2: [{ team_id: "t1", league_division_id: "pool-a", rank_in_division: 1 }] },
  });
  const result = await evaluateSeasonObjectives({ supabase, finishedSeasonNumber: 2 });
  assert.deepEqual(result, { evaluated: 0, paid: 0 });
});

// ─── #2913: resolveStageDivisor fallback-kæde (pure) ──────────────────────────

test("resolveStageDivisor: bruger holdets EGEN pulje-etapetal når til stede", () => {
  const stageCounts = { byPool: { "pool-a": 21 }, byTier: { 2: 30 }, fallbackDays: 60 };
  const team = { league_division_id: "pool-a", division: 2 };
  assert.equal(resolveStageDivisor(stageCounts, team), 21);
});

test("resolveStageDivisor: falder tilbage til tier-gennemsnit når holdets EGEN pulje mangler", () => {
  const stageCounts = { byPool: {}, byTier: { 2: 30 }, fallbackDays: 60 };
  const team = { league_division_id: "pool-missing", division: 2 };
  assert.equal(resolveStageDivisor(stageCounts, team), 30);
});

test("resolveStageDivisor: falder tilbage til fallbackDays (seasons.race_days_total) når hverken pulje eller tier findes", () => {
  const stageCounts = { byPool: {}, byTier: {}, fallbackDays: 45 };
  const team = { league_division_id: "pool-x", division: 9 };
  assert.equal(resolveStageDivisor(stageCounts, team), 45);
});

test("resolveStageDivisor: falder tilbage til FULL_CALENDAR_DAYS (60) når fallbackDays også mangler", () => {
  const stageCounts = { byPool: {}, byTier: {}, fallbackDays: 0 };
  const team = { league_division_id: null, division: null };
  assert.equal(resolveStageDivisor(stageCounts, team), FULL_CALENDAR_DAYS);
});

test("resolveStageDivisor: håndterer manglende stageCounts/team helt (undefined) uden at kaste", () => {
  assert.equal(resolveStageDivisor(undefined, undefined), FULL_CALENDAR_DAYS);
});

// ─── #2926: resolveContractForNewSeason + afledte størrelser (pure) ───────────
// Samme regel som expireAndRenewContracts bruger i drift — previewet i
// seasonTransition.buildTransitionPlan kalder præcis denne funktion, så
// dry-runnets sponsortal ikke kan drive fra det der faktisk udbetales.

test("resolveContractForNewSeason: en aktiv kontrakt der stadig dækker sæsonen vinder ('locked')", () => {
  const active = { id: "c1", guaranteed_base: 400_000, expires_after_season: 3 };
  const pending = { id: "c2", guaranteed_base: 999_999, start_season: 2 };
  const { source, contract } = resolveContractForNewSeason({
    teamId: "t1", newSeasonNumber: 2, activeContract: active, pendingContract: pending,
    renownTargetValue: 500_000,
  });
  assert.equal(source, "locked");
  assert.equal(contract.guaranteed_base, 400_000);
});

test("resolveContractForNewSeason: en udløbende aktiv kontrakt viger for managerens pending valg", () => {
  const active = { id: "c1", guaranteed_base: 400_000, expires_after_season: 1 };
  const pending = { id: "c2", guaranteed_base: 238_000, start_season: 2, variant: "racing" };
  const { source, contract } = resolveContractForNewSeason({
    teamId: "t1", newSeasonNumber: 2, activeContract: active, pendingContract: pending,
    renownTargetValue: 476_000,
  });
  assert.equal(source, "pending");
  assert.equal(contract.guaranteed_base, 238_000);
});

test("resolveContractForNewSeason: pending for en ANDEN sæson tæller ikke — holdet auto-defaulter til 'safe'", () => {
  const pending = { id: "c2", guaranteed_base: 999_999, start_season: 4 };
  const { source, contract } = resolveContractForNewSeason({
    teamId: "t1", newSeasonNumber: 2, activeContract: null, pendingContract: pending,
    renownTargetValue: 400_000,
  });
  assert.equal(source, "default");
  assert.equal(contract.variant, DEFAULT_RENEW_VARIANT);
  assert.equal(contract.guaranteed_base, Math.round(400_000 * 0.92));
  assert.equal(contract.length_seasons, 1);
  assert.equal(contract.expires_after_season, 2);
  assert.equal(contract.simulated, true);
});

test("resolveContractForNewSeason: auto-default matcher generateOffers' 'safe'-tilbud 1:1", () => {
  const renownTargetValue = 476_000;
  const offer = generateOffers({ teamId: "t1", seasonNumber: 2, renownTargetValue })
    .find((o) => o.variant === DEFAULT_RENEW_VARIANT);
  const { contract } = resolveContractForNewSeason({
    teamId: "t1", newSeasonNumber: 2, renownTargetValue,
  });
  assert.equal(contract.guaranteed_base, offer.guaranteedBase);
  assert.equal(contract.sponsor_name, offer.sponsorName);
  assert.equal(contract.race_day_share, offer.raceDayShare);
});

test("contractRaceDayPool: udleder puljen baglæns fra guaranteed_base × race_day_share/fraction", () => {
  // racing: 0,50 garanteret / 0,58 pr. etape → target 476.000 → pulje 276.080
  assert.equal(
    contractRaceDayPool({ guaranteed_base: 238_000, guaranteed_fraction: 0.5, race_day_share: 0.58 }),
    276_080
  );
});

test("contractRaceDayPool: legacy-række uden race_day_share falder tilbage til (1 − fraction)", () => {
  assert.equal(
    contractRaceDayPool({ guaranteed_base: 352_000, guaranteed_fraction: 0.88 }),
    Math.round(400_000 * 0.12)
  );
});

test("contractRaceDayPool: ukendt/manglende data giver 0 i stedet for at gætte", () => {
  assert.equal(contractRaceDayPool(null), 0);
  assert.equal(contractRaceDayPool({ guaranteed_base: "n/a" }), 0);
  assert.equal(contractRaceDayPool({ guaranteed_base: 100_000, length_seasons: 99 }), 0);
});

test("contractSigningBonus: læser signing-klausulen, ellers 0", () => {
  assert.equal(contractSigningBonus({ bonus_clauses: [{ type: "signing", amount: 38_080 }] }), 38_080);
  assert.equal(contractSigningBonus({ bonus_clauses: [{ type: "podium", amount: 5_000 }] }), 0);
  assert.equal(contractSigningBonus({}), 0);
  assert.equal(contractSigningBonus(null), 0);
});
