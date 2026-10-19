// #6795: preflight-season-cutover.ps1's pulje-/kalender-SQL ma ikke vise puljer der
// pensioneres ved maalstrukturen (calendarTargetStructure.js) som kalenderhuller.
//
// Testen koerer de FAKTISKE SQL-blokke fra preflight-scriptet (udtrukket af here-strings)
// mod en lille in-memory Postgres (PGlite) og sammenligner klassificeringen med
// resolveCutoverPoolRetirement, saa SQL-reglen og JS-reglen ikke kan glide fra hinanden.
//
//   node --test scripts/preflight-season-cutover.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CALENDAR_TARGET_STRUCTURES,
  resolveCutoverPoolRetirement,
} from "../backend/lib/calendarTargetStructure.js";
import {
  applicableTargetStructures,
  cutoverRetirementSqlCondition,
  seniorPoolsCte,
} from "./preflight-season-cutover-structure.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ps1 = readFileSync(join(root, "scripts/preflight-season-cutover.ps1"), "utf8");
const s4 = CALENDAR_TARGET_STRUCTURES.s4;

test("maalstrukturen gaelder kun fra sin foerste saeson, med tier og antal fra calendarTargetStructure.js", () => {
  assert.deepEqual(applicableTargetStructures(s4.firstSeason - 1), []);
  assert.equal(cutoverRetirementSqlCondition(s4.firstSeason - 1), "false");
  for (const season of [s4.firstSeason, s4.firstSeason + 1, s4.firstSeason + 5]) {
    assert.deepEqual(applicableTargetStructures(season), [{ key: s4.key, tier: s4.tier, activePools: s4.activePools }]);
  }
  const condition = cutoverRetirementSqlCondition(s4.firstSeason);
  assert.ok(condition.includes(`d.tier = ${s4.tier}`));
  assert.ok(condition.includes(`> ${s4.activePools}`));
  assert.match(condition, /partition by d\.tier order by d\.pool_index/);
});

test("CLI udskriver samme CTE som modulet", () => {
  const out = execFileSync(process.execPath, [join(root, "scripts/preflight-season-cutover-structure.mjs"), "5"], { encoding: "utf8" });
  assert.equal(out.trim(), seniorPoolsCte(5));
});

test("CLI afviser en ugyldig saeson", () => {
  assert.throws(
    () => execFileSync(process.execPath, [join(root, "scripts/preflight-season-cutover-structure.mjs"), "x"], { stdio: "pipe" }),
    (err) => err.status === 2,
  );
});

test("preflight-scriptet bygger pulje-SQL-blokkene paa CTE'en fra hjaelpemodulet", () => {
  assert.match(ps1, /preflight-season-cutover-structure\.mjs/);
  for (const name of ["sqlCalendar", "sqlDivisions"]) {
    const block = hereString(name);
    assert.ok(block.includes("$seniorPoolsCte"), `${name} bruger ikke $seniorPoolsCte`);
    assert.ok(block.includes("senior_pools"), `${name} laeser ikke fra senior_pools`);
  }
  assert.equal(hereString("sqlDivisions").split("$seniorPoolsCte").length - 1, 2, "pulje-traeet og D4-destinationerne bruger hver CTE'en");
});

function hereString(name) {
  const m = ps1.match(new RegExp(`\\$${name} = @"\\r?\\n([\\s\\S]*?)\\r?\\n"@`));
  assert.ok(m, `here-string $${name} findes ikke i preflight-scriptet`);
  return m[1];
}

function renderSql(name, toSeasonNumber) {
  const uuid = `00000000-0000-0000-0000-${toSeasonNumber.toString(16).padStart(12, "0")}`;
  return hereString(name)
    .replaceAll("$seniorPoolsCte", seniorPoolsCte(toSeasonNumber))
    .replaceAll("$toSeasonId", uuid)
    .replaceAll("$ToSeasonNumber", String(toSeasonNumber))
    .replaceAll("$fromSeasonId", "00000000-0000-0000-0000-000000000000");
}

let PGlite = null;
try {
  ({ PGlite } = await import("../backend/node_modules/@electric-sql/pglite/dist/index.js"));
} catch {
  PGlite = null;
}

const SCHEMA = `
  create table league_divisions (id int primary key, tier int not null, pool_index int, label text, squad text, retired_at timestamptz);
  create table teams (id serial primary key, league_division_id int, division int, is_ai boolean not null default false,
    is_bank boolean, is_frozen boolean, is_test_account boolean);
  create table races (id serial primary key, league_division_id int, season_id uuid);
`;

// Seniorpyramiden som den staar foer/efter pensioneringen af D4 E-H: D1 x1, D2 x2, D3 x4, D4 x8.
// D4 E-H = pool_index 4-7. Alle puljer har en rigtig manager og (undtagen `without`) et loeb.
async function seed(db, { season, retireD4EH, withoutRaces = [] }) {
  await db.exec("truncate league_divisions, teams, races restart identity");
  const uuid = `00000000-0000-0000-0000-${season.toString(16).padStart(12, "0")}`;
  const pools = [];
  let id = 1;
  const add = (tier, count) => { for (let i = 0; i < count; i++) pools.push({ id: id++, tier, pool_index: i, label: `D${tier}-${i}` }); };
  add(1, 1); add(2, 2); add(3, 4); add(4, 8);
  for (const p of pools) {
    const retired = retireD4EH && p.tier === 4 && p.pool_index >= 4;
    p.retired_at = retired ? "2026-10-01T00:00:00Z" : null;
    await db.query("insert into league_divisions (id, tier, pool_index, label, squad, retired_at) values ($1,$2,$3,$4,'senior',$5)", [p.id, p.tier, p.pool_index, p.label, p.retired_at]);
    await db.query("insert into teams (league_division_id, division, is_ai) values ($1,$2,false)", [p.id, p.tier]);
    // Foer pensioneringen (kalender bygget med --target-structure, fra S4): E-H har ingen loeb.
    // Ellers faar hver aktiv pulje et loeb, undtagen dem testen selv udtager.
    const targetStructureCalendar = !retireD4EH && p.tier === 4 && p.pool_index >= 4 && season >= s4.firstSeason;
    if (!retired && !targetStructureCalendar && !withoutRaces.includes(p.label)) {
      await db.query("insert into races (league_division_id, season_id) values ($1,$2)", [p.id, uuid]);
    }
  }
  return pools;
}

async function calendarRows(db, season) {
  const results = await db.exec(renderSql("sqlCalendar", season));
  return results[results.length - 1].rows;
}

const gaps = (rows) => rows.filter((r) => r.kraever_kalender && Number(r.loeb) === 0).map((r) => r.label);

test("SQL: foer pensioneringen er D4 E-H markeret og aldrig et hul; reglen matcher resolveCutoverPoolRetirement", { skip: !PGlite && "PGlite mangler (backend/node_modules)" }, async () => {
  const db = new PGlite();
  try {
    await db.exec(SCHEMA);
    const pools = await seed(db, { season: 4, retireD4EH: false });
    const rows = await calendarRows(db, 4);
    assert.equal(rows.length, 15, "alle 15 aktive seniorpuljer foer pensioneringen");
    assert.deepEqual(gaps(rows), [], "ingen huller: E-H er ikke en fejl");
    const flagged = rows.filter((r) => r.pensioneres_ved_skiftet).map((r) => Number(r.id)).sort((a, b) => a - b);
    const expected = [...resolveCutoverPoolRetirement({ pools }).retireIds].map(Number).sort((a, b) => a - b);
    assert.deepEqual(flagged, expected, "SQL-reglen og JS-reglen er enige om hvem der pensioneres");
    assert.equal(flagged.length, 4);
    assert.ok(rows.filter((r) => r.pensioneres_ved_skiftet).every((r) => r.kraever_kalender === false));
  } finally {
    await db.close();
  }
});

test("SQL: efter pensioneringen giver samme regel samme resultat (idempotent), og hverken E-H eller aktive puljer er huller", { skip: !PGlite && "PGlite mangler (backend/node_modules)" }, async () => {
  const db = new PGlite();
  try {
    await db.exec(SCHEMA);
    const pools = await seed(db, { season: 5, retireD4EH: true });
    const rows = await calendarRows(db, 5);
    assert.equal(rows.length, 11, "11 aktive seniorpuljer (S4-formen)");
    assert.deepEqual(gaps(rows), []);
    assert.ok(rows.every((r) => r.pensioneres_ved_skiftet === false), "ingen aktiv pulje er markeret");
    // De pensionerede puljer taeller stadig med i rangen: JS-reglen kender dem som alreadyRetired.
    const { retire } = resolveCutoverPoolRetirement({ pools });
    assert.equal(retire.length, 4);
    assert.ok(retire.every((p) => p.alreadyRetired));
  } finally {
    await db.close();
  }
});

test("SQL: et aegte hul i en beholdt pulje findes stadig, foer og efter pensioneringen", { skip: !PGlite && "PGlite mangler (backend/node_modules)" }, async () => {
  const db = new PGlite();
  try {
    await db.exec(SCHEMA);
    await seed(db, { season: 4, retireD4EH: false, withoutRaces: ["D4-1"] });
    assert.deepEqual(gaps(await calendarRows(db, 4)), ["D4-1"]);
    await seed(db, { season: 5, retireD4EH: true, withoutRaces: ["D4-1"] });
    assert.deepEqual(gaps(await calendarRows(db, 5)), ["D4-1"]);
  } finally {
    await db.close();
  }
});

test("SQL: overgange uden maalstruktur (S2->S3) udelader ingen pulje", { skip: !PGlite && "PGlite mangler (backend/node_modules)" }, async () => {
  const db = new PGlite();
  try {
    await db.exec(SCHEMA);
    await seed(db, { season: 3, retireD4EH: false });
    const rows = await calendarRows(db, 3);
    assert.equal(rows.length, 15);
    assert.ok(rows.every((r) => r.pensioneres_ved_skiftet === false));
    assert.deepEqual(gaps(rows), [], "alle puljer har loeb i fixturen");
    await db.exec("delete from races where league_division_id in (select id from league_divisions where tier = 4 and pool_index >= 4)");
    assert.equal(gaps(await calendarRows(db, 3)).length, 4, "uden maalstruktur er E-H uden loeb stadig huller");
  } finally {
    await db.close();
  }
});

test("SQL: pulje-traeet og D4-destinationerne udelader de pensionerende puljer", { skip: !PGlite && "PGlite mangler (backend/node_modules)" }, async () => {
  const db = new PGlite();
  try {
    await db.exec(SCHEMA);
    await seed(db, { season: 4, retireD4EH: false });
    const results = await db.exec(renderSql("sqlDivisions", 4));
    const tree = results[results.length - 2].rows;
    const destinations = results[results.length - 1].rows;
    assert.equal(tree.filter((r) => r.pensioneres_ved_skiftet).length, 4, "traeet viser E-H, men markeret");
    assert.deepEqual(destinations.map((r) => Number(r.pool_index)), [0, 1, 2, 3], "kun de fire beholdte D4-puljer er destinationer");
  } finally {
    await db.close();
  }
});
