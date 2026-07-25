import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  buildPersonalSeasonEndedMessage,
  formatEnglishOrdinal,
  loadSeasonEndedPersonalization,
  SEASON_ENDED_MESSAGE_CODES,
} from "./seasonEndedPersonalization.js";
import { emitSeasonEndedNotifications } from "./seasonTransition.js";

// #2924 · Personlig sæsonslut-besked.
// To kontrakter testes her:
//   1. Byggeren laver den rigtige besked af komplette fakta (happy path) og
//      falder tilbage til null (= generisk besked) ved manglende data.
//   2. Hele kæden er fail-safe: uanset hvad der går galt i personaliseringen,
//      bliver season_ended-beskeden sendt til alle managere.

const FULL_FACTS = {
  rank: 4,
  poolSize: 24,
  division: 3,
  points: 1742,
  prize: 138224,
  riderName: "Mathias Vacek",
  riderPoints: 1120,
  nextDivision: 2,
};

// ─── 0. Engelske ordenstal (ejer-beslutning 25/7) ────────────────────────────

test("ordenstal: de almindelige former", () => {
  assert.equal(formatEnglishOrdinal(1), "1st");
  assert.equal(formatEnglishOrdinal(2), "2nd");
  assert.equal(formatEnglishOrdinal(3), "3rd");
  assert.equal(formatEnglishOrdinal(4), "4th");
  assert.equal(formatEnglishOrdinal(9), "9th");
  assert.equal(formatEnglishOrdinal(10), "10th");
});

test("ordenstal: teens er undtagelsen — 11th/12th/13th, ikke 11st/12nd/13rd", () => {
  assert.equal(formatEnglishOrdinal(11), "11th");
  assert.equal(formatEnglishOrdinal(12), "12th");
  assert.equal(formatEnglishOrdinal(13), "13th");
  assert.equal(formatEnglishOrdinal(14), "14th");
});

test("ordenstal: 21st/22nd/23rd følger mønstret igen", () => {
  assert.equal(formatEnglishOrdinal(21), "21st");
  assert.equal(formatEnglishOrdinal(22), "22nd");
  assert.equal(formatEnglishOrdinal(23), "23rd");
  assert.equal(formatEnglishOrdinal(24), "24th");
});

test("ordenstal: 111/112/113 er også teens (sidste TO cifre afgør)", () => {
  assert.equal(formatEnglishOrdinal(111), "111th");
  assert.equal(formatEnglishOrdinal(112), "112th");
  assert.equal(formatEnglishOrdinal(113), "113th");
  assert.equal(formatEnglishOrdinal(101), "101st");
  assert.equal(formatEnglishOrdinal(102), "102nd");
  assert.equal(formatEnglishOrdinal(103), "103rd");
});

// ─── 1. Byggeren ─────────────────────────────────────────────────────────────

test("bygger: komplette fakta → fuld besked med rytter og næste division", () => {
  const res = buildPersonalSeasonEndedMessage({ facts: FULL_FACTS, nextSeasonNumber: 2 });

  assert.equal(res.messageCode, SEASON_ENDED_MESSAGE_CODES.full);
  assert.equal(
    res.message,
    "You finished 4th of 24 in Division 3 with 1,742 points and CZ$ 138,224 in prize money. " +
      "Your best rider was Mathias Vacek with 1,120 points. You start Season 2 in Division 2.",
  );
  assert.deepEqual(res.messageParams, {
    rank: 4,
    rankOrdinal: "4th",
    poolSize: 24,
    division: 3,
    points: 1742,
    prize: 138224,
    rider: "Mathias Vacek",
    riderPoints: 1120,
    nextSeason: 2,
    nextDivision: 2,
  });
});

test("bygger: ukendt næste division → sætningen udelades helt (ingen gætterier)", () => {
  const res = buildPersonalSeasonEndedMessage({
    facts: { ...FULL_FACTS, nextDivision: null },
    nextSeasonNumber: 2,
  });

  assert.equal(res.messageCode, SEASON_ENDED_MESSAGE_CODES.noNextDivision);
  assert.doesNotMatch(res.message, /You start Season/);
  assert.match(res.message, /Your best rider was Mathias Vacek/);
  assert.equal(res.messageParams.nextDivision, undefined);
});

test("bygger: ingen rytterdata → rytter-sætningen udelades, resten består", () => {
  const res = buildPersonalSeasonEndedMessage({
    facts: { ...FULL_FACTS, riderName: null, riderPoints: null },
    nextSeasonNumber: 2,
  });

  assert.equal(res.messageCode, SEASON_ENDED_MESSAGE_CODES.noRider);
  assert.doesNotMatch(res.message, /best rider/);
  assert.match(res.message, /You start Season 2 in Division 2\./);
});

test("bygger: hverken rytter eller næste division → minimal variant", () => {
  const res = buildPersonalSeasonEndedMessage({
    facts: { ...FULL_FACTS, riderName: null, riderPoints: null, nextDivision: null },
    nextSeasonNumber: 2,
  });

  assert.equal(res.messageCode, SEASON_ENDED_MESSAGE_CODES.minimal);
  assert.equal(
    res.message,
    "You finished 4th of 24 in Division 3 with 1,742 points and CZ$ 138,224 in prize money.",
  );
});

test("bygger: 0 point og 0 i præmier er gyldige tal (ikke 'manglende data')", () => {
  const res = buildPersonalSeasonEndedMessage({
    facts: { ...FULL_FACTS, points: 0, prize: 0 },
    nextSeasonNumber: 2,
  });
  assert.match(res.message, /with 0 points and CZ\$ 0 in prize money/);
});

test("bygger: manglende kernefelt → null (kalderen sender generisk besked)", () => {
  for (const missing of ["rank", "poolSize", "division", "points", "prize"]) {
    const facts = { ...FULL_FACTS, [missing]: null };
    assert.equal(
      buildPersonalSeasonEndedMessage({ facts, nextSeasonNumber: 2 }),
      null,
      `manglende ${missing} skal give null`,
    );
  }
  assert.equal(buildPersonalSeasonEndedMessage({ facts: null, nextSeasonNumber: 2 }), null);
  assert.equal(buildPersonalSeasonEndedMessage({}), null);
});

test("bygger: meningsløs placering (rank 0) → null i stedet for 'position 0 of 24'", () => {
  assert.equal(
    buildPersonalSeasonEndedMessage({ facts: { ...FULL_FACTS, rank: 0 }, nextSeasonNumber: 2 }),
    null,
  );
});

// Locale-guard: engelsk bruger ordenstal, dansk bruger det rå tal. Byttes de om,
// render dansk "plads 4th ud af 24" (eller engelsk "You finished 4 of 24").
test("locale-skabeloner: EN bruger {rankOrdinal}, DA bruger {rank}", () => {
  const localeDir = join(__dirname, "../../frontend/public/locales");
  const en = JSON.parse(readFileSync(join(localeDir, "en/backendMessages.json"), "utf8"));
  const da = JSON.parse(readFileSync(join(localeDir, "da/backendMessages.json"), "utf8"));

  const personalKeys = [
    "messagePersonal",
    "messagePersonalNoNextDivision",
    "messagePersonalNoRider",
    "messagePersonalMinimal",
  ];

  for (const key of personalKeys) {
    assert.ok(en.notif.seasonEnded[key], `EN mangler ${key}`);
    assert.ok(da.notif.seasonEnded[key], `DA mangler ${key}`);
    assert.match(en.notif.seasonEnded[key], /\{rankOrdinal\}/, `EN ${key} skal bruge ordenstal`);
    assert.doesNotMatch(en.notif.seasonEnded[key], /\{rank\}/, `EN ${key} må ikke bruge det rå tal`);
    assert.match(da.notif.seasonEnded[key], /\{rank\}/, `DA ${key} skal bruge det rå tal`);
    assert.doesNotMatch(
      da.notif.seasonEnded[key],
      /\{rankOrdinal\}/,
      `DA ${key} må ALDRIG bruge det engelske ordenstal ("plads 4th ud af 24")`,
    );
  }
});

// ─── 2. Loaderen ─────────────────────────────────────────────────────────────

// Minimal PostgREST-agtig mock: hver tabel svarer med sine rækker uanset filtre.
// fetchAllRows kalder .range() til sidst, så builderen skal være thenable derfra.
function makeSupabase(tables, { failOn = null } = {}) {
  return {
    from(table) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        range: async () => {
          if (failOn === table) throw new Error(`boom: ${table}`);
          return { data: tables[table] || [], error: null };
        },
      };
      return builder;
    },
  };
}

const SEASON_ID = "season-1";

const TABLES = {
  season_standings: [
    { team_id: "t1", rank_in_division: 4, total_points: 1742, division: 3, league_division_id: 31 },
    { team_id: "t2", rank_in_division: 1, total_points: 9000, division: 3, league_division_id: 31 },
    { team_id: "ai1", rank_in_division: 9, total_points: 100, division: 3, league_division_id: 31 },
    { team_id: "other", rank_in_division: 1, total_points: 50, division: 4, league_division_id: 41 },
  ],
  team_standings_ext_mv: [
    { team_id: "t1", prize_earned: "138224" },
    { team_id: "t2", prize_earned: "1218675" },
  ],
  riders: [
    { id: "r1", firstname: "Mathias", lastname: "Vacek", team_id: "t1" },
    { id: "r2", firstname: "Jonas", lastname: "Bak", team_id: "t1" },
    { id: "r3", firstname: "Ove", lastname: "Nul", team_id: "t2" },
  ],
  rider_rankings_mv: [
    { rider_id: "r1", points: "1120" },
    { rider_id: "r2", points: "300" },
    { rider_id: "r3", points: "0" },
  ],
};

test("loader: samler placering, puljestørrelse, point, præmier og bedste rytter", async () => {
  const facts = await loadSeasonEndedPersonalization({
    supabase: makeSupabase(TABLES),
    seasonId: SEASON_ID,
    teams: [{ id: "t1", user_id: "u1", division: 2 }],
    includeNextDivision: true,
  });

  const t1 = facts.get("t1");
  assert.equal(t1.rank, 4);
  // Puljestørrelsen tælles på HELE feltet (også AI-hold) i samme pulje: 3 rækker
  // med league_division_id=31, ikke de 4 standings-rækker i alt.
  assert.equal(t1.poolSize, 3);
  assert.equal(t1.division, 3);
  assert.equal(t1.points, 1742);
  assert.equal(t1.prize, 138224, "numeric fra PostgREST kommer som string og skal normaliseres");
  assert.equal(t1.riderName, "Mathias Vacek");
  assert.equal(t1.riderPoints, 1120);
  assert.equal(t1.nextDivision, 2);
});

test("loader: includeNextDivision=false nulstiller næste division (flytning ikke kørt)", async () => {
  const facts = await loadSeasonEndedPersonalization({
    supabase: makeSupabase(TABLES),
    seasonId: SEASON_ID,
    teams: [{ id: "t1", user_id: "u1", division: 2 }],
    includeNextDivision: false,
  });
  assert.equal(facts.get("t1").nextDivision, null);
});

test("loader: hold uden point-scorende ryttere får ingen 'bedste rytter'", async () => {
  const facts = await loadSeasonEndedPersonalization({
    supabase: makeSupabase(TABLES),
    seasonId: SEASON_ID,
    teams: [{ id: "t2", user_id: "u2", division: 2 }],
    includeNextDivision: true,
  });
  const t2 = facts.get("t2");
  assert.equal(t2.riderName, null, "0-point-rytter er ikke en bedste rytter");
  assert.equal(t2.prize, 1218675);
});

test("loader: hold uden standings-række udelades (→ generisk besked)", async () => {
  const facts = await loadSeasonEndedPersonalization({
    supabase: makeSupabase(TABLES),
    seasonId: SEASON_ID,
    teams: [{ id: "ukendt", user_id: "u9", division: 2 }],
    includeNextDivision: true,
  });
  assert.equal(facts.size, 0);
});

test("loader: FAIL-SAFE — query-fejl giver tomt map, ikke en exception", async () => {
  for (const table of ["season_standings", "team_standings_ext_mv", "riders", "rider_rankings_mv"]) {
    const facts = await loadSeasonEndedPersonalization({
      supabase: makeSupabase(TABLES, { failOn: table }),
      seasonId: SEASON_ID,
      teams: [{ id: "t1", user_id: "u1", division: 2 }],
      includeNextDivision: true,
    });
    assert.equal(facts.size, 0, `fejl i ${table} må ikke kaste`);
  }
});

test("loader: tom holdliste rører slet ikke databasen", async () => {
  const facts = await loadSeasonEndedPersonalization({
    supabase: {}, // ville kaste hvis loaderen forsøgte et opslag
    seasonId: SEASON_ID,
    teams: [],
    includeNextDivision: true,
  });
  assert.equal(facts.size, 0);
});

// ─── 3. Kæden: emit falder tilbage, men sender ALTID ──────────────────────────

test("emit: personaliserede beskeder sendes pr. manager med egne tal", async () => {
  const calls = [];
  const stats = await emitSeasonEndedNotifications({
    supabase: makeSupabase(TABLES),
    endedSeason: { id: SEASON_ID, number: 1 },
    humanTeams: [
      { id: "t1", user_id: "u1", division: 2 },
      { id: "t2", user_id: "u2", division: 3 },
    ],
    notify: async (args) => {
      calls.push(args);
      return { delivered: true };
    },
    isDivisionMovementSkipped: async () => false, // flytningen ER kørt
  });

  assert.equal(stats.personalized, 2);
  assert.equal(stats.delivered, 2);
  assert.match(calls[0].message, /You finished 4th of 3 in Division 3/);
  assert.match(calls[0].message, /Mathias Vacek/);
  assert.match(calls[0].message, /You start Season 2 in Division 2\./);
  assert.equal(calls[0].metadata.messageCode, SEASON_ENDED_MESSAGE_CODES.full);
  // Hold 2 har ingen point-scorende rytter → variant uden rytter.
  assert.equal(calls[1].metadata.messageCode, SEASON_ENDED_MESSAGE_CODES.noRider);
});

test("emit: FAIL-SAFE — loader der kaster giver generisk besked til ALLE, ingen exception", async () => {
  const calls = [];
  const stats = await emitSeasonEndedNotifications({
    supabase: {},
    endedSeason: { id: SEASON_ID, number: 1 },
    humanTeams: [
      { id: "t1", user_id: "u1", division: 2 },
      { id: "t2", user_id: "u2", division: 3 },
    ],
    notify: async (args) => {
      calls.push(args);
      return { delivered: true };
    },
    loadPersonalization: async () => {
      throw new Error("personalization exploded");
    },
    isDivisionMovementSkipped: async () => false,
  });

  assert.equal(stats.delivered, 2, "begge managere får stadig besked");
  assert.equal(stats.personalized, 0);
  for (const call of calls) {
    assert.equal(call.metadata.messageCode, "notif.seasonEnded.message");
    assert.match(call.message, /The season is over/);
  }
});

test("emit: FAIL-SAFE — fejl i flag-opslaget udelader kun divisions-sætningen", async () => {
  const calls = [];
  await emitSeasonEndedNotifications({
    supabase: makeSupabase(TABLES),
    endedSeason: { id: SEASON_ID, number: 1 },
    humanTeams: [{ id: "t1", user_id: "u1", division: 2 }],
    notify: async (args) => {
      calls.push(args);
      return { delivered: true };
    },
    isDivisionMovementSkipped: async () => {
      throw new Error("app_config unreachable");
    },
  });

  assert.match(calls[0].message, /4th of 3/, "resten af personaliseringen består");
  assert.doesNotMatch(calls[0].message, /You start Season/, "usikker division loves ikke");
});

test("emit: divisions-flytning sprunget over (#2851) → ingen næste-division-sætning", async () => {
  const calls = [];
  await emitSeasonEndedNotifications({
    supabase: makeSupabase(TABLES),
    endedSeason: { id: SEASON_ID, number: 1 },
    humanTeams: [{ id: "t1", user_id: "u1", division: 3 }],
    notify: async (args) => {
      calls.push(args);
      return { delivered: true };
    },
    isDivisionMovementSkipped: async () => true, // komprimeringen flytter senere
  });

  assert.doesNotMatch(calls[0].message, /You start Season/);
  assert.equal(calls[0].metadata.messageCode, SEASON_ENDED_MESSAGE_CODES.noNextDivision);
});
