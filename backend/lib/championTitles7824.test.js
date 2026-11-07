// #7824 · Titelreglerne for mestertrøjerne (ren beregning + kørslens gates).
import test from "node:test";
import assert from "node:assert/strict";

import {
  CHAMPION_TITLE,
  U23_BASIS,
  computeChampionTitles,
  tiedRiderIds,
  titlesForRider,
  winsOf,
  runChampionTitles,
} from "./championTitles7824.js";

// Sæson 3 svarer til referenceåret 2028: født 2006 = 22 (U23), født 2005 = 23.
const SEASON = 3;
const U23_BIRTH = "2006-05-01";
const SENIOR_BIRTH = "1998-05-01";

const continents = new Map([["DK", "Europe"], ["BE", "Europe"], ["CO", "Americas"], ["JP", "Asia"], ["XX", null]]);

function rider(id, nationality_code, birthdate = SENIOR_BIRTH) {
  return { id, nationality_code, birthdate };
}
function row(rider_id, points, extra = {}) {
  return { rider_id, points, stage_wins: 0, gc_wins: 0, classic_wins: 0, pts_wins: 0, mtn_wins: 0, young_wins: 0, ...extra };
}
function find(titles, title, scope = "") {
  return titles.find((t) => t.title === title && t.scope === scope);
}

test("verdensmester: flest ranglistepoint", () => {
  const titles = computeChampionTitles({
    seniorRows: [row("a", 100), row("b", 300), row("c", 200)],
    riders: [rider("a", "DK"), rider("b", "BE"), rider("c", "CO")],
    continentByCountry: continents,
    sourceSeasonNumber: SEASON,
  });
  assert.equal(find(titles, CHAMPION_TITLE.WORLD).rider_id, "b");
  assert.equal(find(titles, CHAMPION_TITLE.WORLD).points, 300);
});

test("en højere titel giver ikke de lavere titler videre", () => {
  const titles = computeChampionTitles({
    seniorRows: [row("b", 300), row("a", 100), row("d", 50)],
    riders: [rider("a", "BE"), rider("b", "BE"), rider("d", "BE")],
    continentByCountry: continents,
    sourceSeasonNumber: SEASON,
  });
  // b er verdensmester OG europamester OG belgisk mester; nummer to får intet.
  assert.equal(find(titles, CHAMPION_TITLE.WORLD).rider_id, "b");
  assert.equal(find(titles, CHAMPION_TITLE.CONTINENT, "Europe").rider_id, "b");
  assert.equal(find(titles, CHAMPION_TITLE.NATIONAL, "BE").rider_id, "b");
  assert.deepEqual(titlesForRider(titles, "a"), []);
  assert.deepEqual(
    titlesForRider(titles, "b").map((t) => t.title),
    [CHAMPION_TITLE.WORLD, CHAMPION_TITLE.CONTINENT, CHAMPION_TITLE.NATIONAL],
  );
});

test("kontinent via countries.continent og national pr. nation", () => {
  const titles = computeChampionTitles({
    seniorRows: [row("dk1", 90), row("dk2", 40), row("be1", 80), row("co1", 30), row("jp1", 10), row("xx1", 500)],
    riders: [rider("dk1", "DK"), rider("dk2", "dk"), rider("be1", "BE"), rider("co1", "CO"), rider("jp1", "JP"), rider("xx1", "XX")],
    continentByCountry: continents,
    sourceSeasonNumber: SEASON,
  });
  assert.equal(find(titles, CHAMPION_TITLE.CONTINENT, "Europe").rider_id, "dk1");
  assert.equal(find(titles, CHAMPION_TITLE.CONTINENT, "Americas").rider_id, "co1");
  assert.equal(find(titles, CHAMPION_TITLE.CONTINENT, "Asia").rider_id, "jp1");
  assert.equal(find(titles, CHAMPION_TITLE.NATIONAL, "DK").rider_id, "dk1");
  assert.equal(find(titles, CHAMPION_TITLE.NATIONAL, "BE").rider_id, "be1");
  // Et land uden kontinent giver stadig en national mester, men ingen kontinenttitel.
  assert.equal(find(titles, CHAMPION_TITLE.NATIONAL, "XX").rider_id, "xx1");
  assert.equal(titles.filter((t) => t.title === CHAMPION_TITLE.CONTINENT).length, 3);
});

test("ingen point = ingen titel; rytter uden nation får ingen national titel", () => {
  const titles = computeChampionTitles({
    seniorRows: [row("a", 0), row("b", 10)],
    riders: [rider("a", "DK"), rider("b", null)],
    continentByCountry: continents,
    sourceSeasonNumber: SEASON,
  });
  assert.equal(find(titles, CHAMPION_TITLE.WORLD).rider_id, "b");
  assert.equal(find(titles, CHAMPION_TITLE.NATIONAL, "DK"), undefined);
  assert.equal(titles.filter((t) => t.title === CHAMPION_TITLE.NATIONAL).length, 0);
});

test("lighed: flest sejre, derefter bedste placering", () => {
  const base = {
    seniorRows: [row("a", 100, { stage_wins: 1 }), row("b", 100, { stage_wins: 1, gc_wins: 1 }), row("c", 100, { stage_wins: 2 })],
    riders: [rider("a", "DK"), rider("b", "DK"), rider("c", "DK")],
    continentByCountry: continents,
    sourceSeasonNumber: SEASON,
  };
  // b og c har begge 2 sejre; placering afgør.
  const tied = tiedRiderIds(base);
  assert.deepEqual(tied.senior, ["b", "c"]);
  assert.deepEqual(tied.u23, []);
  const titles = computeChampionTitles({ ...base, bestRank: { senior: new Map([["b", 2], ["c", 1]]) } });
  assert.equal(find(titles, CHAMPION_TITLE.WORLD).rider_id, "c");
  assert.equal(find(titles, CHAMPION_TITLE.NATIONAL, "DK").rider_id, "c");
  // Uden placering (fx manglende data) er resultatet stadig fast: id afgør.
  assert.equal(find(computeChampionTitles(base), CHAMPION_TITLE.WORLD).rider_id, "b");
});

test("winsOf tæller samme sejre som sæsonens hædersliste", () => {
  assert.equal(winsOf(row("a", 0, { stage_wins: 2, gc_wins: 1, classic_wins: 1, pts_wins: 1, mtn_wins: 1, young_wins: 1 })), 7);
  assert.equal(winsOf(row("a", 0, { stage_wins: "3", gc_wins: null })), 3);
});

test("U23-verdensmester: sæsonens U23-rangliste, kun ryttere under 23", () => {
  const titles = computeChampionTitles({
    seniorRows: [row("old", 900), row("young", 50)],
    u23Rows: [row("u1", 40), row("u2", 70), row("over", 999)],
    riders: [
      rider("old", "DK"), rider("young", "DK", U23_BIRTH),
      rider("u1", "DK", U23_BIRTH), rider("u2", "BE", U23_BIRTH), rider("over", "BE", "2005-01-01"),
    ],
    continentByCountry: continents,
    sourceSeasonNumber: SEASON,
  });
  const u23 = find(titles, CHAMPION_TITLE.U23_WORLD);
  assert.equal(u23.rider_id, "u2");
  assert.equal(u23.basis, U23_BASIS.U23_RANKING);
});

test("U23-reserve: uden U23-point tæller verdensranglisten blandt ryttere under 23", () => {
  const titles = computeChampionTitles({
    seniorRows: [row("old", 900), row("y1", 50), row("y2", 80)],
    u23Rows: [row("u1", 0)],
    riders: [rider("old", "DK"), rider("y1", "DK", U23_BIRTH), rider("y2", "BE", U23_BIRTH), rider("u1", "DK", U23_BIRTH)],
    continentByCountry: continents,
    sourceSeasonNumber: SEASON,
  });
  const u23 = find(titles, CHAMPION_TITLE.U23_WORLD);
  assert.equal(u23.rider_id, "y2");
  assert.equal(u23.basis, U23_BASIS.WORLD_RANKING);
});

test("der er altid en U23-verdensmester, også når ingen under 23 har point", () => {
  const titles = computeChampionTitles({
    seniorRows: [row("old", 900), row("y1", 0), row("y2", 0, { stage_wins: 1 })],
    riders: [rider("old", "DK"), rider("y1", "DK", U23_BIRTH), rider("y2", "BE", U23_BIRTH)],
    continentByCountry: continents,
    sourceSeasonNumber: SEASON,
  });
  assert.equal(find(titles, CHAMPION_TITLE.U23_WORLD).rider_id, "y2");
});

test("alder regnes efter kildesæsonens år, ikke kalenderåret", () => {
  const input = {
    seniorRows: [row("y", 50)],
    riders: [rider("y", "DK", "2006-12-31")],
    continentByCountry: continents,
  };
  // Sæson 3 (2028): 22 = U23. Sæson 4 (2029): 23 = ikke U23, så ingen kandidat.
  assert.equal(find(computeChampionTitles({ ...input, sourceSeasonNumber: 3 }), CHAMPION_TITLE.U23_WORLD).rider_id, "y");
  assert.equal(find(computeChampionTitles({ ...input, sourceSeasonNumber: 4 }), CHAMPION_TITLE.U23_WORLD), undefined);
});

test("U23-lighed på U23-ranglisten slås op i U23-løbene", () => {
  const tied = tiedRiderIds({
    seniorRows: [row("a", 10)],
    u23Rows: [row("u1", 40), row("u2", 40)],
    riders: [rider("a", "DK"), rider("u1", "DK", U23_BIRTH), rider("u2", "DK", U23_BIRTH)],
    continentByCountry: continents,
    sourceSeasonNumber: SEASON,
  });
  assert.deepEqual(tied.u23, ["u1", "u2"]);
  assert.deepEqual(tied.senior, []);
});

// ── Kørslens gates (ingen database: en lille falsk klient) ───────────────────

function fakeSupabase({ flag = '"off"', completed = { id: "s2", number: 2 }, existing = [], tables = {} } = {}) {
  const writes = [];
  const reads = [];
  function builder(table) {
    const q = { table, filters: [] };
    const result = () => {
      reads.push(table);
      if (table === "app_config") return { data: [{ key: "champion_jerseys_7824", value: JSON.parse(flag) }], error: null };
      if (table === "seasons") return { data: completed, error: null };
      if (table === "rider_champion_titles") return { data: existing, error: null };
      return { data: tables[table] ?? [], error: null };
    };
    const chain = {
      select: () => chain, eq: () => chain, gt: () => chain, in: () => chain, order: () => chain,
      limit: () => chain, range: () => chain,
      maybeSingle: () => Promise.resolve(table === "app_config"
        ? { data: { value: JSON.parse(flag) }, error: null }
        : result()),
      single: () => Promise.resolve(result()),
      then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
      upsert: (rows) => { writes.push({ table, rows }); return Promise.resolve({ error: null }); },
    };
    return chain;
  }
  return { from: (table) => builder(table), writes, reads };
}

test("kørslen: kontakten off = ingen læsning af ranglisten og ingen skrivning", async () => {
  const supabase = fakeSupabase({ flag: '"off"' });
  const result = await runChampionTitles({ supabase });
  assert.equal(result.ran, false);
  assert.equal(result.skipped, "flag_off");
  assert.equal(supabase.writes.length, 0);
  assert.ok(!supabase.reads.includes("rider_rankings_mv"));
});

test("kørslen: findes sæsonens titler allerede, sker intet (idempotent)", async () => {
  const supabase = fakeSupabase({ flag: '"beta"', existing: [{ title: "world" }] });
  const result = await runChampionTitles({ supabase });
  assert.equal(result.skipped, "already_computed");
  assert.equal(supabase.writes.length, 0);
});

test("kørslen: ingen afsluttet sæson = ingen titler", async () => {
  const supabase = fakeSupabase({ flag: '"on"', completed: null });
  const result = await runChampionTitles({ supabase });
  assert.equal(result.skipped, "no_completed_season");
  assert.equal(supabase.writes.length, 0);
});

test("kørslen: skriver sæsonens titler for sæsonen efter den afsluttede", async () => {
  const supabase = fakeSupabase({
    flag: '"beta"',
    tables: {
      rider_rankings_mv: [row("a", 300), row("b", 100)],
      riders: [rider("a", "DK"), rider("b", "BE", U23_BIRTH)],
      countries: [{ iso2: "DK", continent: "Europe" }, { iso2: "BE", continent: "Europe" }],
    },
  });
  const result = await runChampionTitles({ supabase });
  assert.equal(result.ran, true);
  assert.equal(result.seasonNumber, 3);
  assert.equal(supabase.writes.length, 1);
  const rows = supabase.writes[0].rows;
  assert.ok(rows.every((r) => r.season_number === 3 && r.source_season_id === "s2"));
  const titleOf = (title, scope = "") => rows.find((r) => r.title === title && r.scope === scope)?.rider_id;
  assert.equal(titleOf("world"), "a");
  assert.equal(titleOf("u23_world"), "b");
  assert.equal(titleOf("continent", "Europe"), "a");
  assert.equal(titleOf("national", "BE"), "b");
});
