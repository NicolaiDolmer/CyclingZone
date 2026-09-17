// #5330 — seniorlæserne af race_pool.
//
// Tre ting låses fast her:
//  1. Dommen: NULL/manglende squad = senior; 'u23'/'junior' = ikke senior.
//  2. Mekanikken: PostgREST-filteret lægges på, og DEN dag kolonnen ikke findes
//     (før #5262's migration er applied) falder læsningen tilbage til et select uden
//     squad i stedet for at vælte kalender-genereringen.
//  3. Resultatet: seniorkalenderen er BIT-IDENTISK mod S3-fixturen før og efter
//     ungdomsløb findes i kataloget — dry-run-beviset fra issuets accept-punkt 2.
//
// Plus en forward-guard: enhver ny race_pool-LÆSNING i api.js/tierCalendarMaterializer.js
// skal gå gennem en af helperne, ellers fælder testen den.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  SENIOR_SQUAD,
  SENIOR_SQUAD_OR_FILTER,
  fetchRacePoolWithSquad,
  filterSeniorSquadRows,
  isMissingSquadColumnError,
  isSeniorSquad,
  selectRacePoolWithSquad,
  selectSeniorRacePool,
  withSeniorSquadColumns,
} from "./racePoolCatalog.js";
import { buildTierMaterializationPlan, TIER_DENSITY } from "./tierCalendarMaterializer.js";
import { buildS3OfflineCalendarPlan, FIXTURE_PATH, OFFLINE_REAL_DAYS } from "../scripts/dev/lib/s3OfflineCalendarPlan.mjs";
import { offlineCalendarFrom } from "../scripts/dev/lib/devCalendarArgs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Dommen ────────────────────────────────────────────────────────────────────

test("#5330 isSeniorSquad: NULL/undefined/'senior' er senior, u23+junior er ikke", () => {
  assert.equal(isSeniorSquad(null), true);
  assert.equal(isSeniorSquad(undefined), true);
  assert.equal(isSeniorSquad(SENIOR_SQUAD), true);
  assert.equal(isSeniorSquad("u23"), false);
  assert.equal(isSeniorSquad("junior"), false);
  // Ukendte værdier er IKKE senior — CHECK-constrainten i #5262 forbyder dem, og
  // et fejl-tolerant "alt andet er senior" ville lade en fremtidig trup sive ind.
  assert.equal(isSeniorSquad("elite"), false);
});

test("#5330 filterSeniorSquadRows: beholder kun seniorrækker, tåler ikke-array", () => {
  const rows = [
    { id: "a" },
    { id: "b", squad: null },
    { id: "c", squad: "senior" },
    { id: "d", squad: "u23" },
    { id: "e", squad: "junior" },
  ];
  assert.deepEqual(filterSeniorSquadRows(rows).map((r) => r.id), ["a", "b", "c"]);
  assert.deepEqual(filterSeniorSquadRows(null), []);
  assert.deepEqual(filterSeniorSquadRows(undefined), []);
});

test("#5330 withSeniorSquadColumns: squad tilføjes én gang, aldrig to", () => {
  assert.equal(withSeniorSquadColumns("id, name"), "id, name, squad");
  assert.equal(withSeniorSquadColumns("id,name"), "id, name, squad");
  assert.equal(withSeniorSquadColumns("id, squad"), "id, squad");
  assert.equal(withSeniorSquadColumns("*"), "*, squad");
});

test("#5330 filteret dækker BÅDE NULL og 'senior' (NULL ville ellers falde ud af .eq)", () => {
  assert.equal(SENIOR_SQUAD_OR_FILTER, "squad.is.null,squad.eq.senior");
});

// ── Manglende kolonne (vinduet før #5262's migration) ─────────────────────────

test("#5330 isMissingSquadColumnError: 42703/PGRST204 om squad — og intet andet", () => {
  assert.equal(isMissingSquadColumnError({ code: "42703", message: 'column race_pool.squad does not exist' }), true);
  assert.equal(isMissingSquadColumnError({ code: "PGRST204", message: "Could not find the 'squad' column of 'race_pool' in the schema cache" }), true);
  assert.equal(isMissingSquadColumnError({ message: "column race_pool.squad does not exist" }), true);
  // Ikke om squad → boble op uændret.
  assert.equal(isMissingSquadColumnError({ code: "42703", message: 'column race_pool.country does not exist' }), false);
  // Rigtige driftsfejl må ALDRIG udløse et fallback der tavst dropper filteret.
  assert.equal(isMissingSquadColumnError({ code: "42501", message: "permission denied for table race_pool (squad)" }), false);
  assert.equal(isMissingSquadColumnError({ message: "fetch failed" }), false);
  assert.equal(isMissingSquadColumnError(null), false);
});

/** Minimal PostgREST-dobbelt: registrerer kolonner + or-filter, svarer som konfigureret. */
function fakeQuery({ rows = [], error = null, calls }) {
  return (columns) => {
    const call = { columns, or: null };
    calls.push(call);
    const builder = {
      or(expr) { call.or = expr; return builder; },
      then(res, rej) { return Promise.resolve({ data: error ? null : rows, error }).then(res, rej); },
    };
    return builder;
  };
}

test("#5330 selectSeniorRacePool: lægger or-filteret på og filtrerer også i JS", async () => {
  const calls = [];
  const rows = [{ id: "a", squad: "senior" }, { id: "b" }, { id: "c", squad: "u23" }];
  const { data, error } = await selectSeniorRacePool(fakeQuery({ rows, calls }), { columns: "id, name" });
  assert.equal(error, null);
  assert.equal(calls.length, 1, "ingen unødig ekstra rundtur når kolonnen findes");
  assert.equal(calls[0].columns, "id, name, squad");
  assert.equal(calls[0].or, SENIOR_SQUAD_OR_FILTER);
  // JS-filteret er defense-in-depth: en PostgREST-dobbelt der ignorerer or'en må ikke
  // kunne lade en u23-række slippe igennem til kalenderen.
  assert.deepEqual(data.map((r) => r.id), ["a", "b"]);
});

test("#5330 selectSeniorRacePool: manglende squad-kolonne → ét fallback-kald uden squad", async () => {
  const calls = [];
  let attempt = 0;
  const buildQuery = (columns) => {
    const call = { columns, or: null };
    calls.push(call);
    attempt += 1;
    const first = attempt === 1;
    const builder = {
      or(expr) { call.or = expr; return builder; },
      then(res, rej) {
        return Promise.resolve(first
          ? { data: null, error: { code: "42703", message: "column race_pool.squad does not exist" } }
          : { data: [{ id: "a" }, { id: "b" }], error: null }).then(res, rej);
      },
    };
    return builder;
  };
  const { data, error } = await selectSeniorRacePool(buildQuery, { columns: "id, name" });
  assert.equal(error, null);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].columns, "id, name", "fallback må ikke selecte squad");
  assert.equal(calls[1].or, null, "fallback må ikke filtrere på en kolonne der ikke findes");
  assert.deepEqual(data.map((r) => r.id), ["a", "b"], "uden kolonnen er HELE kataloget senior");
});

test("#5330 selectSeniorRacePool: en rigtig DB-fejl returneres uændret (intet fallback)", async () => {
  const calls = [];
  const error = { code: "42501", message: "permission denied for table race_pool" };
  const res = await selectSeniorRacePool(fakeQuery({ error, calls }), { columns: "id" });
  assert.equal(calls.length, 1, "et ufiltreret fallback-kald ville skjule fejlen");
  assert.deepEqual(res.error, error);
});

test("#5330 selectRacePoolWithSquad: henter squad UDEN at filtrere (så kaldstedet kan afvise højlydt)", async () => {
  const calls = [];
  const rows = [{ id: "a", squad: "senior" }, { id: "b", squad: "u23" }];
  const { data } = await selectRacePoolWithSquad(fakeQuery({ rows, calls }), { columns: "id, race_type" });
  assert.equal(calls[0].columns, "id, race_type, squad");
  assert.equal(calls[0].or, null);
  assert.deepEqual(data.map((r) => r.id), ["a", "b"]);
});

test("#5330 fetchRacePoolWithSquad: kastende hentere får samme fallback", async () => {
  const seen = [];
  const rows = await fetchRacePoolWithSquad(async (columns) => {
    seen.push(columns);
    if (seen.length === 1) throw Object.assign(new Error("column race_pool.squad does not exist"), { code: "42703" });
    return [{ id: "a" }];
  }, { columns: "id, name" });
  assert.deepEqual(seen, ["id, name, squad", "id, name"]);
  assert.deepEqual(rows, [{ id: "a" }]);

  // En rigtig fejl skal kastes videre, ikke maskeres af et ekstra forsøg.
  await assert.rejects(
    () => fetchRacePoolWithSquad(async () => { throw new Error("fetch failed"); }, { columns: "id" }),
    /fetch failed/,
  );
});

// ── Dry-run mod S3-fixturen: identisk seniorkalender før/efter ─────────────────

const YOUTH_FIXTURE_ROWS = [
  { id: "u23-001", external_id: "u23-001", name: "Ronde van Vlaanderen U23", race_class: "ProSeries", race_type: "single", stages: 1, terrain_archetype: "cobbled_classic", date_text: "5/4", squad: "u23" },
  { id: "u23-002", external_id: "u23-002", name: "Giro Next Gen", race_class: "Class1", race_type: "stage_race", stages: 8, terrain_archetype: "mountain_tour", date_text: "6/6 - 13/6", squad: "u23" },
  { id: "u23-003", external_id: "u23-003", name: "Tour de l'Avenir", race_class: "Class1", race_type: "stage_race", stages: 10, terrain_archetype: "mountain_tour", date_text: "15/8 - 24/8", squad: "u23" },
  { id: "jr-001", external_id: "jr-001", name: "Paris-Roubaix Juniors", race_class: "Class2", race_type: "single", stages: 1, terrain_archetype: "cobbled_classic", date_text: "12/4", squad: "junior" },
  { id: "jr-002", external_id: "jr-002", name: "Course de la Paix Juniors", race_class: "Class2", race_type: "stage_race", stages: 4, terrain_archetype: "hilly_tour", date_text: "20/5 - 23/5", squad: "junior" },
];

/** Præcis samme parametre som buildS3OfflineCalendarPlan, men med et katalog vi styrer. */
function offlinePlanForCatalog(catalog, pools) {
  const { from } = offlineCalendarFrom([]);
  const quotas = Object.fromEntries(Object.entries(TIER_DENSITY).map(([t, d]) => [t, d * OFFLINE_REAL_DAYS]));
  const { tierPlans } = buildTierMaterializationPlan({
    pools, catalog, from, realDays: OFFLINE_REAL_DAYS, quotas, baseSeed: 1,
  });
  return tierPlans;
}

const planFingerprint = (tierPlans) => tierPlans.map((tp) => ({
  tier: tp.tier,
  totalGameDays: tp.totalGameDays,
  races: (tp.pools?.[0]?.raceRows ?? []).map((r) => `${r.pool_race_id}|${r.name}|${r.stages}`),
  stages: (tp.pools?.[0]?.stageRows ?? []).map((s) => `${s.pool_race_id}|${s.stage_number}|${s.scheduled_at}`),
}));

test("#5330 S3-fixture dry-run: seniorkalenderen er identisk før og efter ungdomsløb i kataloget", () => {
  const { pools, catalog } = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  assert.ok(catalog.length > 100, `fixturen skal være prod-kataloget (${catalog.length} løb)`);
  assert.equal(
    catalog.filter((c) => !isSeniorSquad(c.squad)).length, 0,
    "S3-fixturen er ren senior (snapshot fra før #5262)",
  );

  const before = planFingerprint(offlinePlanForCatalog(catalog, pools));
  // Sådan ser det ud EFTER #5262: ungdomsrækker i samme tabel, filtreret af læseren.
  const after = planFingerprint(offlinePlanForCatalog(
    filterSeniorSquadRows([...catalog, ...YOUTH_FIXTURE_ROWS]), pools,
  ));
  assert.deepEqual(after, before);

  // Og den kalender ER den kanoniske offline-plan (#4123), ikke en parallel opskrift.
  assert.deepEqual(before, planFingerprint(buildS3OfflineCalendarPlan().tierPlans));

  // Kontrol: uden filteret ville de samme rækker ændre kalenderen.
  const unfiltered = planFingerprint(offlinePlanForCatalog([...catalog, ...YOUTH_FIXTURE_ROWS], pools));
  assert.notDeepEqual(unfiltered, before, "kontrol: ufiltreret katalog ændrer seniorkalenderen");
});

// ── Forward-guard: ingen ufiltreret race_pool-læsning slipper ind igen ─────────

test("#5330 forward-guard: alle race_pool-LÆSNINGER går gennem racePoolCatalog-helperne", () => {
  const files = [
    join(__dirname, "..", "routes", "api.js"),
    join(__dirname, "tierCalendarMaterializer.js"),
  ];
  const HELPERS = /selectSeniorRacePool\(|selectRacePoolWithSquad\(|fetchRacePoolWithSquad\(/;
  const offenders = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const marker = '.from("race_pool")';
    for (let i = src.indexOf(marker); i !== -1; i = src.indexOf(marker, i + 1)) {
      const after = src.slice(i, i + 200);
      // Skrive-stien (admin CSV-import) upserter hele kataloget og skal IKKE filtreres.
      if (/\.upsert\(|\.delete\(|\.update\(/.test(after)) continue;
      const before = src.slice(Math.max(0, i - 600), i);
      if (!HELPERS.test(before)) {
        offenders.push(`${file}: ...${src.slice(Math.max(0, i - 120), i + 60).replace(/\s+/g, " ")}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `ufiltreret race_pool-læsning:\n${offenders.join("\n")}`);
});
