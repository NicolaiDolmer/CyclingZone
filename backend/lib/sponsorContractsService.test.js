import test from "node:test";
import assert from "node:assert/strict";

import {
  getActiveContract,
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
//     .update({status}).eq(...)             (registreres i state.updates)
//     .update({status}).eq("id", id)        (registreres i state.updates)
//     .insert(row).select().single()        (registreres i state.inserts)
function makeSupabase({
  team = { id: "t1", division: 2 },
  seasonsByNumber = {},      // { [number]: { id, number } | null }
  standingsBySeasonId = {},  // { [seasonId]: [rows] }
  activeContractByTeam = {}, // { [teamId]: contractRow | null }
} = {}) {
  const state = { updates: [], inserts: [] };

  function seasonsBuilder() {
    const ctx = {};
    const b = {
      select: () => b,
      eq: (col, val) => {
        if (col === "number") ctx.number = val;
        return b;
      },
      maybeSingle: () => {
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
        // select active contract
        return Promise.resolve({
          data: activeContractByTeam[ctx.team_id] ?? null,
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
        // Flip the in-memory active contract away so a later select sees none.
        if (ctx.team_id && activeContractByTeam[ctx.team_id]) {
          activeContractByTeam[ctx.team_id] = null;
        }
        if (ctx.id) {
          for (const k of Object.keys(activeContractByTeam)) {
            if (activeContractByTeam[k] && activeContractByTeam[k].id === ctx.id) {
              activeContractByTeam[k] = null;
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

test("acceptOffer flipper gammel aktiv til 'replaced' og indsætter ny aktiv fra valgt variant", async () => {
  const oldActive = {
    id: "c-old",
    team_id: "t1",
    sponsor_name: "Old Sponsor",
    status: "active",
    expires_after_season: 2,
  };
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 1: null }, // frisk → target 400000
    standingsBySeasonId: {},
    activeContractByTeam: { t1: oldActive },
  });

  const row = await acceptOffer({
    supabase,
    teamId: "t1",
    seasonNumber: 2,
    variant: "long",
  });

  // Den gamle blev flippet til 'replaced'.
  assert.equal(supabase.state.updates.length, 1);
  assert.equal(supabase.state.updates[0].payload.status, "replaced");
  assert.equal(supabase.state.updates[0].team_id, "t1");
  assert.equal(supabase.state.updates[0].status, "active"); // gatet på status=active

  // Den nye række matcher den valgte 'long'-variant.
  const longVariant = generateOffers({
    teamId: "t1",
    seasonNumber: 2,
    renownTargetValue: 400000,
  }).find((o) => o.variant === "long");

  assert.equal(supabase.state.inserts.length, 1);
  const inserted = supabase.state.inserts[0];
  assert.equal(inserted.team_id, "t1");
  assert.equal(inserted.sponsor_name, longVariant.sponsorName);
  assert.equal(inserted.guaranteed_base, longVariant.guaranteedBase);
  assert.equal(inserted.per_race_day_rate, longVariant.perRaceDayRate);
  assert.equal(inserted.length_seasons, longVariant.lengthSeasons); // 3
  assert.equal(inserted.start_season, 2);
  assert.equal(inserted.expires_after_season, 2 + longVariant.lengthSeasons - 1); // 4
  assert.equal(inserted.status, "active");

  assert.deepEqual(row, inserted);
});

test("acceptOffer kaster ved ukendt variant", async () => {
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 1: null },
  });
  await assert.rejects(
    () => acceptOffer({ supabase, teamId: "t1", seasonNumber: 2, variant: "nonsense" }),
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

test("expireAndRenewContracts udløber en udløbet kontrakt og fornyer med default 'long'", async () => {
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
  });

  await expireAndRenewContracts({ supabase, newSeasonNumber: 3, teamIds: ["t1"] });

  // To updates: 'expired' på den gamle (by id) + 'replaced'-flip i acceptOffer
  // (men acceptOffer ser ingen aktiv tilbage, så kun expired-flippet rammer).
  const expiredFlip = supabase.state.updates.find((u) => u.payload.status === "expired");
  assert.ok(expiredFlip, "forventede en 'expired'-flip");
  assert.equal(expiredFlip.id, "c-exp");

  // Forny med 'long' for sæson 3.
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

test("expireAndRenewContracts fornyer et hold helt uden kontrakt", async () => {
  const supabase = makeSupabase({
    team: { id: "t1", division: 2 },
    seasonsByNumber: { 2: null },
    activeContractByTeam: { t1: null },
  });

  await expireAndRenewContracts({ supabase, newSeasonNumber: 3, teamIds: ["t1"] });

  // Ingen 'expired'-flip (intet at udløbe), men en ny 'long'-kontrakt indsættes.
  assert.equal(supabase.state.updates.filter((u) => u.payload.status === "expired").length, 0);
  assert.equal(supabase.state.inserts.length, 1);
  assert.equal(supabase.state.inserts[0].status, "active");
  assert.equal(supabase.state.inserts[0].start_season, 3);
});
