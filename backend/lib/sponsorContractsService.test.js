import test from "node:test";
import assert from "node:assert/strict";

import {
  getActiveContract,
  getPendingContract,
  getNegotiationState,
  getOffers,
  acceptOffer,
  expireAndRenewContracts,
} from "./sponsorContractsService.js";
import { renownTarget } from "./renownEngine.js";
import { generateOffers } from "./sponsorOffers.js";

// ─── Faithful service_role-mock ────────────────────────────────────────────────
// Modelleret efter prizePayoutEngine.test.js. Dækker præcis de queries servicen
// laver:
//   teams:            .select("id, division").eq("id", teamId).single()
//   seasons:          .select("id, number").eq("number", N-1).maybeSingle()
//   season_standings: .select(...).eq("season_id", id)  (thenable → array)
//   sponsor_contracts:
//     .select("*").eq("team_id").eq("status","active").maybeSingle()
//     .select("*").eq("team_id").eq("status","pending").maybeSingle()
//     .update({status}).eq("team_id").eq("status",...)   (registreres i state.updates)
//     .update({status}).eq("id", id)                     (registreres i state.updates)
//     .insert(row).select().single()                     (registreres i state.inserts)
function makeSupabase({
  team = { id: "t1", division: 2 },
  seasonsByNumber = {},       // { [number]: { id, number } | null }
  activeSeason = null,        // { race_days_total } | null — seasons.eq("status","active")
  standingsBySeasonId = {},   // { [seasonId]: [rows] }
  activeContractByTeam = {},  // { [teamId]: contractRow | null }
  pendingContractByTeam = {}, // { [teamId]: contractRow | null }
} = {}) {
  const state = { updates: [], inserts: [] };

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
        // loadRenownTargetValue: .select("id, number").eq("number", N-1)
        const row = seasonsByNumber[ctx.number] ?? null;
        return Promise.resolve({ data: row, error: null });
      },
    };
    return b;
  }

  function teamsBuilder() {
    const b = {
      select: () => b,
      eq: () => b,
      single: () => Promise.resolve({ data: team, error: null }),
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
    // Make update(...).eq(...) resolve as a thenable (no .single()/.maybeSingle()).
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
                activeContractByTeam[k] = { ...row, status: "active" };
              }
            }
          }
        }
      }
      return resolve({ data: null, error: null });
    };
    return b;
  }

  return {
    state,
    from(table) {
      if (table === "teams") return teamsBuilder();
      if (table === "seasons") return seasonsBuilder();
      if (table === "season_standings") return standingsBuilder();
      if (table === "sponsor_contracts") return contractsBuilder();
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

test("getOffers udleder 3 tilbud fra renown af holdets sidste-sæsons placering", async () => {
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

  assert.equal(offers.length, 3);
  assert.deepEqual(offers, expectedOffers);
  // Top-hold → multiplier > 1.0 → target > division-base (400000).
  assert.ok(expectedTarget > 400000);
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

  // Sanity: guaranteed_base + per_dag × 40 rammer ≈ target for hver variant.
  for (const o of offers) {
    const reconstructed = o.guaranteedBase + o.perRaceDayRate * 40;
    // Afrunding pr. variant → tillad lille afvigelse (< 40, ét per-dag-trin).
    assert.ok(
      Math.abs(reconstructed - renownTargetValue) < 40,
      `variant ${o.variant}: ${reconstructed} bør være ≈ ${renownTargetValue}`,
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
  assert.equal(result.offers.length, 3);
  assert.equal(result.pendingVariant, null);
  // Tilbuddene er for den KOMMENDE sæson (3).
  const expected = generateOffers({
    teamId: "t1",
    seasonNumber: 3,
    renownTargetValue: 400000,
  });
  assert.deepEqual(result.offers, expected);
});

test("getNegotiationState — negotiable når INGEN aktiv kontrakt", async () => {
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 2: null },
    activeContractByTeam: { t1: null },
    pendingContractByTeam: { t1: null },
  });

  const result = await getNegotiationState({
    supabase,
    teamId: "t1",
    currentSeasonNumber: 2,
  });

  assert.equal(result.negotiable, true);
  assert.equal(result.offers.length, 3);
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

test("getNegotiationState — pendingVariant detekteres fra eksisterende pending-række", async () => {
  // Manager har allerede valgt 'long' for kommende sæson (3) → pending-række findes.
  const longOffer = generateOffers({
    teamId: "t1",
    seasonNumber: 3,
    renownTargetValue: 400000,
  }).find((o) => o.variant === "long");
  const pending = {
    id: "p1",
    team_id: "t1",
    status: "pending",
    start_season: 3,
    length_seasons: longOffer.lengthSeasons,
    guaranteed_base: longOffer.guaranteedBase,
    expires_after_season: 3 + longOffer.lengthSeasons - 1,
  };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 2: null },
    activeContractByTeam: { t1: null },
    pendingContractByTeam: { t1: pending },
  });

  const result = await getNegotiationState({
    supabase,
    teamId: "t1",
    currentSeasonNumber: 2,
  });

  assert.equal(result.negotiable, true);
  assert.equal(result.pendingVariant, "long");
});

test("getNegotiationState — pending med forkert start_season giver pendingVariant null", async () => {
  const longOffer = generateOffers({
    teamId: "t1",
    seasonNumber: 3,
    renownTargetValue: 400000,
  }).find((o) => o.variant === "long");
  const stalePending = {
    id: "p1",
    team_id: "t1",
    status: "pending",
    start_season: 99, // matcher ikke upcomingSeasonNumber 3
    length_seasons: longOffer.lengthSeasons,
    guaranteed_base: longOffer.guaranteedBase,
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

test("acceptOffer skriver en PENDING kontrakt (ikke aktiv) for kommende sæson", async () => {
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
    variant: "long",
  });

  // Erstatter en evt. pending (her ingen) — flip gatet på status=pending, IKKE active.
  assert.equal(supabase.state.updates.length, 1);
  assert.equal(supabase.state.updates[0].payload.status, "replaced");
  assert.equal(supabase.state.updates[0].team_id, "t1");
  assert.equal(supabase.state.updates[0].status, "pending");

  // Den nye række er PENDING med korrekt start_season + variant-felter.
  const longVariant = generateOffers({
    teamId: "t1",
    seasonNumber: 3,
    renownTargetValue: 400000,
  }).find((o) => o.variant === "long");

  assert.equal(supabase.state.inserts.length, 1);
  const inserted = supabase.state.inserts[0];
  assert.equal(inserted.team_id, "t1");
  assert.equal(inserted.sponsor_name, longVariant.sponsorName);
  assert.equal(inserted.guaranteed_base, longVariant.guaranteedBase);
  assert.equal(inserted.per_race_day_rate, longVariant.perRaceDayRate);
  assert.equal(inserted.length_seasons, longVariant.lengthSeasons); // 3
  assert.equal(inserted.start_season, 3);
  assert.equal(inserted.expires_after_season, 3 + longVariant.lengthSeasons - 1); // 5
  assert.equal(inserted.status, "pending");

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
    variant: "predictable",
  });

  // Den gamle pending blev flippet til 'replaced'.
  assert.equal(supabase.state.updates.length, 1);
  assert.equal(supabase.state.updates[0].payload.status, "replaced");
  assert.equal(supabase.state.updates[0].status, "pending");
  // Den nye pending er indsat.
  assert.equal(supabase.state.inserts.length, 1);
  assert.equal(supabase.state.inserts[0].status, "pending");
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

  // Ingen update, ingen insert — kontrakten er låst.
  assert.equal(supabase.state.updates.length, 0);
  assert.equal(supabase.state.inserts.length, 0);
});

test("expireAndRenewContracts AKTIVERER en matchende pending (manager-valg)", async () => {
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

  // Pending er nu aktiv (mock-state afspejler aktivering).
  const nowActive = await getActiveContract({ supabase, teamId: "t1" });
  assert.ok(nowActive, "den aktiverede kontrakt skal nu være aktiv");
  assert.equal(nowActive.id, "p-choice");
  assert.equal(nowActive.status, "active");
  // Ingen pending tilbage efter aktivering.
  const stillPending = await getPendingContract({ supabase, teamId: "t1" });
  assert.equal(stillPending, null);
});

test("expireAndRenewContracts falder tilbage til default 'long' når ingen matchende pending", async () => {
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

  // Default-forny med 'long' (aktiv) for sæson 3 — direkte insert, ingen pending.
  assert.equal(supabase.state.inserts.length, 1);
  const inserted = supabase.state.inserts[0];
  const longVariant = generateOffers({
    teamId: "t1",
    seasonNumber: 3,
    renownTargetValue: 400000,
  }).find((o) => o.variant === "long");
  assert.equal(inserted.length_seasons, longVariant.lengthSeasons);
  assert.equal(inserted.start_season, 3);
  assert.equal(inserted.expires_after_season, 3 + longVariant.lengthSeasons - 1); // 5
  assert.equal(inserted.status, "active");
});

test("expireAndRenewContracts fornyer et hold helt uden kontrakt (default 'long')", async () => {
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 2: null },
    activeContractByTeam: { t1: null },
    pendingContractByTeam: { t1: null },
  });

  await expireAndRenewContracts({ supabase, newSeasonNumber: 3, teamIds: ["t1"] });

  // Ingen 'expired'-flip (intet at udløbe), men en ny 'long'-kontrakt (aktiv) indsættes.
  assert.equal(supabase.state.updates.filter((u) => u.payload.status === "expired").length, 0);
  assert.equal(supabase.state.inserts.length, 1);
  assert.equal(supabase.state.inserts[0].status, "active");
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

  // Ingen aktivering af den stale pending; default 'long' indsat i stedet.
  assert.equal(supabase.state.updates.filter((u) => u.payload.status === "active").length, 0);
  assert.equal(supabase.state.inserts.length, 1);
  assert.equal(supabase.state.inserts[0].status, "active");
  assert.equal(supabase.state.inserts[0].start_season, 3);
});
