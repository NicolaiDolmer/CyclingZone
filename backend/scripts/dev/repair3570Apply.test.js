// backend/scripts/dev/repair3570Apply.test.js
// ============================================================================
// Tests for #3570-reparations-værktøjet. Mock-supabase i samme stil som
// lib/backfillCores.test.js, men med ægte tilstand: updates og inserts RAMMER
// de in-memory-tabeller, så idempotens og post-verify kan testes for alvor
// (en mock der kun logger skrivninger kan ikke bevise nogen af delene).
//
// NEGATIV-TEST er obligatorisk for de to sidste porte:
//   * backup-porten skal FEJRE en sund backup og FEJLE på en ufuldstændig,
//     og der må ikke være skrevet én rytter-række når den fejler.
//   * post-verify skal BESTÅ på et korrekt resultat og FEJLE på en indsat
//     afvigelse (saboteret primary_type, saboteret loft, ændret valuation_type).
//
// Refs #3570.

import test from "node:test";
import assert from "node:assert/strict";

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import {
  runRepair3570, buildPlan, runSelvtest, bevisIdempotens, diffModBaseline,
  parseArgs, backupDDL, backupTabeller, cphDateStamp, quotasFromPct, solveAssignment,
  recoverBirthArchetype, segmentOf, postVerify, sikreBackup, rollbackSQL,
  DRYRUN_FACIT, facitEfterDrift, MAAL, BACKUP_SKEMA, KANONISK_BACKUP_SUFFIX, FORSVUNDNE_GRAENSE_MIN,
  laesPlanFil, paalaegPlanFil, runPlanFilSelvtest, baselinePlan, hentFriskPopulation,
  BASELINE_SNAPSHOT_DIR, PLAN_SNAPSHOT_TAGET, foerPlanen,
} from "./repair3570Apply.mjs";
import { STAT_KEYS } from "../../lib/fictionalRiderGenerator.js";
import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { RIDER_TYPE_KEYS } from "../../lib/riderTypes.js";
import { buildCapsForRider } from "../../lib/riderProgression.js";

const STILLE = () => {};
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── U5: mocken håndhæver KOLONNENAVNE ───────────────────────────────────────
// Den gamle mock kastede `cols` væk (`select: () => selectBuilder()`) og lod insert
// skubbe vilkårlige nøgler ind. De 30 tests kunne derfor STRUKTURELT ikke fange et
// forkert kolonnenavn — præcis blokker B1′'s defekt-klasse, hvor rollback-filen
// oprettede backup-tabellen med nøglen `rider_id` mens værktøjet læste `id`.
//
// Skemaerne kommer IKKE fra værktøjets adgangs-kode (så ville porten være en
// tautologi), men fra de to uafhængige kilder der bestemmer virkeligheden:
//   * prod-tabellerne: katalog-opslaget mod prod 10/8 (information_schema),
//   * backup-tabellerne: DDL'en der faktisk opretter dem — parset som tekst.
const PROD_SKEMA = {
  seasons: ["number", "status", "start_date", "end_date", "race_days_completed", "race_days_total"],
  app_config: ["key", "value"],
  teams: ["id", "name", "division", "is_ai", "is_test_account", "is_frozen", "user_id"],
  users: ["id", "username"],
  riders: [
    "id", "firstname", "lastname", "birthdate", "height", "weight", "potentiale",
    "archetype_draw", "primary_type", "secondary_type", "valuation_type", "team_id",
    "pending_team_id", "base_value", "market_value", "current_production_value", "salary",
    "is_academy", "is_retired", "created_at", "updated_at", ...STAT_KEYS,
  ],
  rider_derived_abilities: ["rider_id", "ability_caps", "ability_progress", ...VISIBLE_ABILITIES],
};

/** Læs kolonnenavnene ud af en CREATE TABLE-DDL — tekstligt, uden at spørge koden. */
export function skemaFraDDL(ddl) {
  const ud = {};
  const re = /CREATE TABLE IF NOT EXISTS public\.(\w+)\s*\(([\s\S]*?)\n\);/g;
  let m;
  while ((m = re.exec(ddl)) !== null) {
    ud[m[1]] = m[2].split("\n").map((l) => l.trim().replace(/,$/, "")).filter(Boolean)
      .map((l) => l.split(/\s+/)[0]);
  }
  return ud;
}

// ── Mock-supabase med ægte in-memory-tilstand ───────────────────────────────
function makeDb({ riders, abilities, ekstraTabeller = {}, skema = {} } = {}) {
  const kolonner = { ...PROD_SKEMA, ...skema };
  const ukendtKolonne = (table, col) => ({ message: `column ${table}.${col} does not exist` });
  /** @returns {{cols:string[]}|{error:object}} */
  const vaelgKolonner = (table, cols) => {
    const skema_t = kolonner[table];
    if (!skema_t) return { cols: null };                 // ukendt tabel → håndteres af rows()
    if (cols == null || String(cols).trim() === "*") return { cols: [...skema_t] };
    const liste = String(cols).split(",").map((s) => s.trim()).filter(Boolean);
    const ukendt = liste.find((c) => !skema_t.includes(c));
    if (ukendt) return { error: ukendtKolonne(table, ukendt) };
    return { cols: liste };
  };
  const projicér = (row, cols) => (cols ? Object.fromEntries(cols.map((c) => [c, row[c]])) : { ...row });
  const tables = {
    seasons: [{ number: 2, status: "active", start_date: "2026-07-27", end_date: null, race_days_completed: 14, race_days_total: 28 }],
    app_config: [{ key: "race_day_engine_enabled", value: "off" }],
    teams: [
      { id: "team-human", name: "Menneskeholdet", division: 1, is_ai: false, is_test_account: false, is_frozen: false, user_id: "u1" },
      { id: "team-ai", name: "AI-holdet", division: 2, is_ai: true, is_test_account: false, is_frozen: false, user_id: null },
    ],
    users: [{ id: "u1", username: "nicolai" }],
    riders,
    rider_derived_abilities: abilities,
    ...ekstraTabeller,
  };
  const writes = { updates: [], inserts: [] };
  // Fejl-injektion: { select: {table, message}, insert: {table, message}, update: {table, message} }
  const fejl = {};
  // Saboteur: kaldes efter en update er anvendt, så en "indsat afvigelse" kan
  // opstå MELLEM skrivningen og post-verify — præcis den situation porten findes for.
  let saboteur = null;
  // Tabt-skrivning: får en insert til at droppe rækker uden at fejle.
  let dropInsert = null;

  const clone = (r) => JSON.parse(JSON.stringify(r));

  function from(table) {
    const rows = () => tables[table];
    const findes = () => !!rows();
    const relationsFejl = () => ({ data: null, error: { message: `relation "public.${table}" does not exist` } });
    const filterFejl = (col) => (kolonner[table] && !kolonner[table].includes(col)
      ? { data: null, error: ukendtKolonne(table, col) } : null);

    const selectBuilder = (cols) => {
      const valgt = vaelgKolonner(table, cols);
      const kolonneFejl = valgt.error ? { data: null, error: valgt.error } : null;
      return {
        range(a, b) {
          if (fejl.select?.table === table) return Promise.resolve({ data: null, error: { message: fejl.select.message } });
          if (!findes()) return Promise.resolve(relationsFejl());
          if (kolonneFejl) return Promise.resolve(kolonneFejl);
          return Promise.resolve({ data: rows().slice(a, b + 1).map((r) => projicér(clone(r), valgt.cols)), error: null });
        },
        in(col, ids) {
          if (fejl.select?.table === table) return Promise.resolve({ data: null, error: { message: fejl.select.message } });
          if (!findes()) return Promise.resolve(relationsFejl());
          if (kolonneFejl) return Promise.resolve(kolonneFejl);
          const ff = filterFejl(col);
          if (ff) return Promise.resolve(ff);
          const s = new Set(ids);
          return Promise.resolve({ data: rows().filter((r) => s.has(r[col])).map((r) => projicér(clone(r), valgt.cols)), error: null });
        },
        eq(col, val) {
          const b = selectBuilder(cols);
          const base = rows() ?? [];
          return {
            ...b,
            maybeSingle: () => {
              if (kolonneFejl) return Promise.resolve(kolonneFejl);
              const ff = filterFejl(col);
              if (ff) return Promise.resolve(ff);
              const fundet = base.find((r) => r[col] === val) ?? null;
              return Promise.resolve({ data: fundet ? projicér(clone(fundet), valgt.cols) : null, error: null });
            },
          };
        },
      };
    };

    const ukendtIRaekke = (row) => (kolonner[table] ? Object.keys(row).find((k) => !kolonner[table].includes(k)) : null);

    const applyUpdate = (patch, matcher, filterCol) => {
      if (fejl.update?.table === table) return { error: { message: fejl.update.message } };
      if (!findes()) return { error: { message: `relation "public.${table}" does not exist` } };
      const ff = filterFejl(filterCol);
      if (ff) return { error: ff.error };
      const ukendt = ukendtIRaekke(patch);
      if (ukendt) return { error: ukendtKolonne(table, ukendt) };
      const target = (rows() ?? []).filter(matcher);
      const effektiv = saboteur ? saboteur(table, patch, target) ?? patch : patch;
      for (const r of target) Object.assign(r, clone(effektiv));
      writes.updates.push({ table, patch: clone(patch), n: target.length });
      return { error: null };
    };

    return {
      select: (cols) => selectBuilder(cols),
      insert(newRows) {
        if (fejl.insert?.table === table) return Promise.resolve({ error: { message: fejl.insert.message } });
        if (!tables[table]) return Promise.resolve({ error: { message: `relation "public.${table}" does not exist` } });
        for (const r of newRows) {
          const ukendt = ukendtIRaekke(r);
          if (ukendt) return Promise.resolve({ error: ukendtKolonne(table, ukendt) });
        }
        const list = dropInsert?.table === table ? newRows.slice(0, Math.max(0, newRows.length - dropInsert.drop)) : newRows;
        tables[table].push(...list.map(clone));
        writes.inserts.push({ table, n: list.length });
        return Promise.resolve({ error: null });
      },
      update(patch) {
        return {
          in: (col, ids) => Promise.resolve(applyUpdate(patch, (r) => ids.includes(r[col]), col)),
          eq: (col, val) => Promise.resolve(applyUpdate(patch, (r) => r[col] === val, col)),
        };
      },
      delete() {
        // Prod sletter ryttere mens vi arbejder (aiTeamTrimHealSweep, blokker B5).
        return {
          in: (col, ids) => { const s = new Set(ids); tables[table] = rows().filter((r) => !s.has(r[col])); return Promise.resolve({ error: null }); },
          eq: (col, val) => { tables[table] = rows().filter((r) => r[col] !== val); return Promise.resolve({ error: null }); },
        };
      },
    };
  }

  return {
    from, tables, writes, kolonner,
    saetFejl(f) { Object.assign(fejl, f); },
    saetSaboteur(fn) { saboteur = fn; },
    saetDropInsert(d) { dropInsert = d; },
    /** Slet ryttere som prod gør det (AI-hold-trim): rækken forsvinder helt. */
    sletRyttere(ids) {
      const s = new Set(ids);
      tables.riders = tables.riders.filter((r) => !s.has(r.id));
      tables.rider_derived_abilities = tables.rider_derived_abilities.filter((a) => !s.has(a.rider_id));
    },
    ryttereOpdateret: () => writes.updates.filter((u) => u.table === "riders").reduce((a, u) => a + u.n, 0),
    lofterOpdateret: () => writes.updates.filter((u) => u.table === "rider_derived_abilities").reduce((a, u) => a + u.n, 0),
  };
}

// ── Fixture ─────────────────────────────────────────────────────────────────
// 16 ryttere: 8 menneske-ejede, 4 AI, 4 frie. Stat-profilerne varieres, så
// segmenteringen ikke degenererer til én bøtte.
function makeFixture({ n = 16, medDraw = 0 } = {}) {
  const riders = [];
  const abilities = [];
  for (let i = 0; i < n; i++) {
    const id = `r${String(i).padStart(2, "0")}`;
    const owner = i < 8 ? "team-human" : i < 12 ? "team-ai" : null;
    const r = {
      id, firstname: "Rytter", lastname: id,
      birthdate: i % 4 === 0 ? "2007-03-01" : "1999-05-12",   // nogle under 22 i sæson-alder
      height: 173 + (i % 8) * 3,
      weight: null,
      potentiale: 2 + (i % 5) * 0.5,
      archetype_draw: i < medDraw ? { primary: RIDER_TYPE_KEYS[i % 8], secondary: RIDER_TYPE_KEYS[(i + 3) % 8] } : null,
      primary_type: "baroudeur", secondary_type: "rouleur", valuation_type: "baroudeur",
      team_id: owner, base_value: 50_000 + i * 1_000, market_value: 55_000 + i * 1_000,
      current_production_value: 1_000, salary: 900, is_academy: false, is_retired: false,
    };
    // Krops-relationen generatoren bruger: weight = round(bmi · (h/100)²).
    const bmi = [22.8, 22.2, 19.5, 21.0, 23.2, 21.3, 21.8, 21.6][i % 8];
    r.weight = Math.round(bmi * (r.height / 100) ** 2);
    for (const k of STAT_KEYS) r[k] = 52;
    // Giv hver rytter en signatur, så fødsels-modellen har noget at arbejde med.
    r[STAT_KEYS[i % STAT_KEYS.length]] = i % 3 === 0 ? 62 : 56;
    r[STAT_KEYS[(i + 5) % STAT_KEYS.length]] = 50;
    riders.push(r);

    const a = { rider_id: id, ability_caps: {}, ability_progress: { climbing: 0.5 } };
    for (const k of VISIBLE_ABILITIES) a[k] = 40 + ((i * 3 + k.length) % 20);
    for (const k of VISIBLE_ABILITIES) a.ability_caps[k] = a[k] + 25;
    abilities.push(a);
  }
  // To pensionerede: de er uden for skrive-scopet, men SKAL med i backuppen.
  for (let i = 0; i < 2; i++) {
    const id = `pens${i}`;
    const r = { ...riders[i], id, lastname: id, is_retired: true, archetype_draw: null, team_id: null };
    riders.push(r);
    abilities.push({ ...abilities[i], rider_id: id });
  }
  return { riders, abilities };
}

function tommeBackupTabeller(suffix) {
  const t = backupTabeller(suffix);
  return { [t.riders]: [], [t.abilities]: [] };
}

const SUFFIX = "20260816";
/**
 * Backup-tabellernes skema i mocken kommer fra DDL-TEKSTEN — den samme streng
 * operatøren kører i prod for at oprette dem. Havde værktøjet læst en kolonne
 * DDL'en ikke opretter (B1′), ville PostgREST svare `column … does not exist`,
 * og det gør mocken nu også.
 */
const BACKUP_SKEMA_FRA_DDL = skemaFraDDL(backupDDL(SUFFIX));

const APPLY = { apply: true, ejerBekraeftet: true, backupSuffix: SUFFIX, log: STILLE, ingenBaseline: true };
const DRY = { backupSuffix: SUFFIX, log: STILLE, ingenBaseline: true };

function nyDb(opts = {}) {
  const { riders, abilities } = makeFixture(opts);
  return makeDb({ riders, abilities, ekstraTabeller: tommeBackupTabeller(SUFFIX), skema: BACKUP_SKEMA_FRA_DDL });
}

// ── 1. Dry-run skriver intet ────────────────────────────────────────────────
test("dry-run (default) skriver ingenting og rapporterer hvad den ville skrive", async () => {
  const db = nyDb();
  const res = await runRepair3570(db, DRY);

  assert.equal(res.tilstand, "DRY-RUN");
  assert.equal(db.writes.updates.length, 0, "dry-run må ikke opdatere");
  assert.equal(db.writes.inserts.length, 0, "dry-run må ikke fylde backup-tabeller");
  assert.ok(res.skriveScope.identitet > 0, "der er faktisk noget at skrive");
  assert.equal(res.skrevet.identitet, 0);
  assert.equal(res.skrevet.lofter, 0);
  assert.equal(res.backup.dryRun, true);
  assert.equal(res.postVerify, undefined, "post-verify kører ikke i dry-run");
  // De 2 pensionerede er ikke i planen.
  assert.equal(res.frisk.pensionerede, 2);
  assert.equal(res.plan.skrives + res.skriveScope.udeladt, 16);
});

test("dry-run beviser idempotens (anden kørsel ville skrive 0 rækker)", async () => {
  const db = nyDb();
  const res = await runRepair3570(db, DRY);
  assert.equal(res.idempotens.ok, true);
  assert.equal(res.idempotens.andenKoerselSkriver, 0);
  assert.equal(res.idempotens.andenKoerselIdentitet, 0);
  assert.equal(res.idempotens.andenKoerselCaps, 0);
});

// ── 2. --apply uden ejer-flag ───────────────────────────────────────────────
test("--apply uden --jeg-har-set-dry-runnet skriver intet og kaster", async () => {
  const db = nyDb();
  await assert.rejects(
    () => runRepair3570(db, { ...DRY, apply: true }),
    /jeg-har-set-dry-runnet/,
  );
  assert.equal(db.writes.updates.length, 0);
  assert.equal(db.writes.inserts.length, 0);
});

test("parseArgs: ejer-gaten er to separate flag", () => {
  assert.deepEqual(
    [parseArgs([]).apply, parseArgs([]).ejerBekraeftet],
    [false, false],
  );
  // --plan-fil er nu obligatorisk sammen med --apply, saa de to gater maales sammen.
  const a = parseArgs(["--apply", "--plan-fil", "p.json"]);
  assert.equal(a.apply, true);
  assert.equal(a.ejerBekraeftet, false);
  const b = parseArgs(["--apply", "--jeg-har-set-dry-runnet", "--plan-fil", "p.json", "--lofter=menneske"]);
  assert.equal(b.ejerBekraeftet, true);
  assert.equal(b.lofter, "menneske");
  assert.throws(() => parseArgs(["--lofter=noget-andet"]), /alle\|menneske\|ingen/);
});

// ── 3. Backup-porten — positiv og NEGATIV ───────────────────────────────────
test("apply fylder og verificerer BEGGE backup-tabeller før første rytter-skrivning", async () => {
  const db = nyDb();
  const res = await runRepair3570(db, APPLY);
  const t = backupTabeller(SUFFIX);

  assert.equal(res.backup.verificeret, true);
  // Backuppen dækker ALLE ryttere, også de 2 pensionerede.
  assert.equal(res.backup.kopi.riders, 18);
  assert.equal(res.backup.kopi.abilities, 18);
  assert.equal(db.tables[t.riders].length, 18);
  assert.equal(db.tables[t.abilities].length, 18);

  // Backup-inserts kom FØR den første riders-update.
  const foersteRiderUpdate = db.writes.updates.findIndex((u) => u.table === "riders");
  assert.ok(foersteRiderUpdate >= 0, "der blev faktisk skrevet");
  assert.ok(db.writes.inserts.length >= 2, "begge backup-tabeller blev fyldt");
  // Backuppen bærer FØR-tilstanden, ikke efter.
  assert.equal(db.tables[t.riders].every((r) => r.primary_type === "baroudeur"), true);
});

test("NEGATIV: backup-tabellen findes ikke → afbryder før skrivning, med DDL i fejlen", async () => {
  const { riders, abilities } = makeFixture();
  const db = makeDb({ riders, abilities });        // ingen backup-tabeller
  await assert.rejects(
    () => runRepair3570(db, APPLY),
    (err) => {
      assert.match(err.message, /kunne ikke læses/);
      assert.match(err.message, /CREATE TABLE IF NOT EXISTS public\.riders_3570_backup_20260816/);
      return true;
    },
  );
  assert.equal(db.ryttereOpdateret(), 0, "ingen rytter-række må være skrevet");
  assert.equal(db.lofterOpdateret(), 0);
});

test("NEGATIV: insert i backup-tabellen fejler → afbryder før skrivning", async () => {
  const db = nyDb();
  db.saetFejl({ insert: { table: backupTabeller(SUFFIX).abilities, message: "permission denied" } });
  await assert.rejects(() => runRepair3570(db, APPLY), /INSERT .*permission denied/);
  assert.equal(db.ryttereOpdateret(), 0);
  assert.equal(db.lofterOpdateret(), 0);
});

test("NEGATIV: backup taber rækker tavst → verifikationen fanger det, intet skrives", async () => {
  const db = nyDb();
  db.saetDropInsert({ table: backupTabeller(SUFFIX).riders, drop: 3 });
  await assert.rejects(
    () => runRepair3570(db, APPLY),
    /backup ikke verificeret[\s\S]*IKKE skrevet én rytter-række/,
  );
  assert.equal(db.ryttereOpdateret(), 0);
  assert.equal(db.lofterOpdateret(), 0);
});

test("NEGATIV: en backup taget EFTER en skrivning afvises af data-spærren", async () => {
  const db = nyDb();
  const t = backupTabeller(SUFFIX);
  // Simulér en kopi taget efter reparationen: alle bærer et archetype_draw.
  db.tables[t.riders] = db.tables.riders.map((r) => ({
    id: r.id, archetype_draw: { primary: "climber", secondary: "gc" },
    primary_type: "climber", secondary_type: "gc", valuation_type: r.valuation_type,
    base_value: r.base_value, market_value: r.market_value, is_retired: r.is_retired,
  }));
  // Spærren tæller på DATA, ikke tidsstempel — men den kræver flere end
  // baseline-antallet, så fixture'en skaleres op til over spærren.
  for (let i = 0; i < 60; i++) {
    db.tables[t.riders].push({ id: `x${i}`, archetype_draw: { primary: "gc", secondary: "tt" } });
  }
  await assert.rejects(() => runRepair3570(db, APPLY), /taget EFTER en reparation/);
  assert.equal(db.ryttereOpdateret(), 0);
});

test("data-spærren skelner NYFØDTE med draw fra en halv reparation", async () => {
  // Kernen i rettelsen. FØR skæringspunktet talte spærren ALLE ryttere med et draw
  // mod 50. Nyfødte fødes med et draw (#3606), så prod stod 10/8 på 740 — hvoraf 722
  // var født samme aften. Spærren ville have afvist en fuldstændig gyldig før-kopi
  // og gjort reparationen ukørbar af helt almindelig vækst.
  const efterPlanen = "2026-08-10T17:47:17.060Z";   // de 722 fra 10/8 kl. 19:47
  const foerPlanenTs = "2026-08-01T09:00:00.000Z";

  // Spejler prod: de ekstra ryttere står i public.riders, ikke i en kopi. De har
  // allerede et draw, så de falder ud af skrive-scopet — præcis som de 722 gør.
  const nyDbMedDraws = (createdAt) => {
    const db = nyDb();
    const skabelon = db.tables.riders[0];
    for (let i = 0; i < 300; i++) {
      db.tables.riders.push({
        ...JSON.parse(JSON.stringify(skabelon)),
        id: `n${i}`, lastname: `n${i}`, created_at: createdAt,
        archetype_draw: { primary: "gc", secondary: "tt" },
        primary_type: "gc", secondary_type: "tt", valuation_type: "gc",
      });
      db.tables.rider_derived_abilities.push({
        ...JSON.parse(JSON.stringify(db.tables.rider_derived_abilities[0])), rider_id: `n${i}`,
      });
    }
    return db;
  };

  // 300 nyfødte med draw — langt over 50, men alle født EFTER planen. Må ikke fyre.
  const db = nyDbMedDraws(efterPlanen);
  const ud = await runRepair3570(db, APPLY);
  assert.ok(ud.skrevet.identitet > 0, "300 nyfødte med draw må ikke kunne spærre kørslen");

  // Samme 300, men født FØR planen: det ER signaturen på en halv reparation.
  // Delvis-kørsel-spærren (trin 3) fyrer før backup-spærren (trin 6) — begge er
  // ægte afvisninger; det er rækkefølgen der afgør hvilken besked operatøren ser.
  await assert.rejects(
    () => runRepair3570(nyDbMedDraws(foerPlanenTs), APPLY),
    /fra før planens snapshot har allerede et archetype_draw/,
  );

  // Og en rytter uden created_at tælles med — fail-closed.
  await assert.rejects(
    () => runRepair3570(nyDbMedDraws(null), APPLY),
    /fra før planens snapshot har allerede et archetype_draw/,
  );

  // foerPlanen() sammenligner som tidspunkter, ikke strenge: PostgREST's
  // `+00:00`-form og snapshottets `Z`-form skal give samme svar.
  assert.equal(foerPlanen({ created_at: "2026-08-10T17:47:17.060037+00:00" }), false);
  assert.equal(foerPlanen({ created_at: "2026-08-09T22:30:17.000000+00:00" }), true);
  assert.equal(foerPlanen({ created_at: null }), true);
  assert.equal(foerPlanen({ created_at: "vrøvl" }), true);
  assert.ok(PLAN_SNAPSHOT_TAGET.startsWith("2026-08-09T22:30:17"));
});

test("rollbackSQL bager skæringspunktet ind i BEGGE spærrer, og afviser et ugyldigt", () => {
  const sql = rollbackSQL(SUFFIX);
  const cutoff = PLAN_SNAPSHOT_TAGET;
  const a0 = sql.slice(sql.indexOf("-- A0."), sql.indexOf("-- A1."));
  const b0 = sql.slice(sql.indexOf("-- B0."), sql.indexOf("-- B1."));
  for (const [navn, blok] of [["A0", a0], ["B0", b0]]) {
    assert.match(blok, new RegExp(`created_at < '${cutoff.replace(/[.]/g, "\\.")}'::timestamptz`), `${navn} mangler skæringspunktet`);
  }
  // Operatøren må ikke kunne komme til at køre A0 og B0 med hver sit skæringspunkt.
  assert.equal(a0.match(/'2026-[^']+Z'::timestamptz/g).length, b0.match(/'2026-[^']+Z'::timestamptz/g).length);
  assert.throws(() => rollbackSQL(SUFFIX, { foer: "i går" }), /ugyldigt skæringspunkt/);
});

// ── 4. Idempotens — anden kørsel skriver 0 rækker ───────────────────────────
test("to kørsler i træk: anden kørsel skriver 0 rækker", async () => {
  const db = nyDb();
  const foerste = await runRepair3570(db, APPLY);
  assert.ok(foerste.skrevet.identitet > 0, "første kørsel skriver");
  assert.ok(foerste.skrevet.lofter > 0);

  const skrevetEfterFoerste = { r: db.ryttereOpdateret(), c: db.lofterOpdateret() };
  const insertsEfterFoerste = db.writes.inserts.length;

  // Anden kørsel — samme DB, samme flag. Alle ryttere bærer nu et anlæg, så de
  // er alle uden for scope, og hverken backup eller skrivning bliver nødvendig.
  const anden = await runRepair3570(db, { ...APPLY, fortsaetDelvis: true });
  assert.equal(anden.skrevet.identitet, 0, "anden kørsel må ikke skrive identitet");
  assert.equal(anden.skrevet.lofter, 0, "anden kørsel må ikke skrive lofter");
  assert.equal(anden.skriveScope.identitet, 0);
  assert.equal(anden.skriveScope.lofter, 0);
  assert.equal(db.writes.inserts.length, insertsEfterFoerste, "ingen ny backup for 0 rækker");
  assert.equal(db.ryttereOpdateret(), skrevetEfterFoerste.r, "ingen nye riders-updates");
  assert.equal(db.lofterOpdateret(), skrevetEfterFoerste.c, "ingen nye caps-updates");
});

test("bevisIdempotens fanger en planlægger der ikke stabiliserer", () => {
  const { riders, abilities } = makeFixture({ n: 8 });
  const abById = new Map(abilities.map((a) => [a.rider_id, a]));
  const rows = riders.filter((r) => !r.is_retired).map((r) => {
    const a = abById.get(r.id);
    const ab = {};
    for (const k of VISIBLE_ABILITIES) ab[k] = a[k];
    return { ...r, rider_id: r.id, age: 27, owner_kind: "human", abilities: ab, ability_caps: a.ability_caps, har_abilities_raekke: true };
  });
  const plan = buildPlan(rows, { seasonNumber: 2 });
  assert.equal(bevisIdempotens(rows, plan).ok, true);

  // NEGATIV: en plan der "glemmer" at skrive draw'et stabiliserer aldrig.
  const daarlig = { ...plan, poster: plan.poster.map((p) => ({ ...p, draw: null })) };
  const res = bevisIdempotens(rows, daarlig);
  assert.equal(res.ok, false);
  assert.ok(res.andenKoerselSkriver > 0);
});

// ── 5. Post-verify — positiv og NEGATIV ─────────────────────────────────────
test("post-verify består på et korrekt resultat", async () => {
  const db = nyDb();
  const res = await runRepair3570(db, APPLY);
  assert.equal(res.postVerify.bestaaet, true);
  assert.equal(res.postVerify.kontrolleret, res.skrevet.identitet);
  for (const v of Object.values(res.postVerify.antal)) assert.equal(v, 0);
  // Invarianterne holder også målt direkte på tabellen.
  for (const r of db.tables.riders.filter((x) => !x.is_retired)) {
    assert.ok(r.archetype_draw, "alle levende har et anlæg");
    assert.equal(r.primary_type, r.archetype_draw.primary);
    assert.equal(r.valuation_type, "baroudeur", "valuation_type er urørt (#3345)");
  }
});

test("NEGATIV: post-verify fanger en saboteret primary_type", async () => {
  const db = nyDb();
  // Saboteren skriver en anden synlig type end draw'et for ÉN rytter.
  db.saetSaboteur((table, patch, target) => {
    if (table !== "riders" || !patch.archetype_draw) return null;
    if (!target.some((r) => r.id === "r03")) return null;
    return { ...patch, primary_type: patch.primary_type === "gc" ? "sprinter" : "gc" };
  });
  await assert.rejects(
    () => runRepair3570(db, APPLY),
    (err) => {
      assert.match(err.message, /POST-VERIFY FEJLEDE/);
      assert.ok(err.rapport.antal.typeMismatch > 0, "typeMismatch skal fyre");
      return true;
    },
  );
});

test("NEGATIV: post-verify fanger et saboteret loft (under rytterens nuværende evne)", async () => {
  const db = nyDb();
  db.saetSaboteur((table, patch) => {
    if (table !== "rider_derived_abilities" || !patch.ability_caps) return null;
    return { ability_caps: Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, 1])) };
  });
  await assert.rejects(
    () => runRepair3570(db, APPLY),
    (err) => {
      assert.match(err.message, /POST-VERIFY FEJLEDE/);
      assert.ok(err.rapport.antal.gulvBrud > 0, "gulv-brud skal fyre");
      assert.ok(err.rapport.antal.capsMismatch > 0, "caps-mismatch skal fyre");
      return true;
    },
  );
});

test("NEGATIV: post-verify fanger en ændret valuation_type", async () => {
  const db = nyDb();
  db.saetSaboteur((table, patch) => {
    if (table !== "riders" || !patch.archetype_draw) return null;
    return { ...patch, valuation_type: "sprinter" };   // #3345-frysningen brudt
  });
  await assert.rejects(
    () => runRepair3570(db, APPLY),
    (err) => {
      assert.ok(err.rapport.antal.valuationAendret > 0, "valuation_type-porten skal fyre");
      return true;
    },
  );
});

test("postVerify kaldt direkte: uskreven rytter fejler, forsvundet rytter gør ikke (B5)", async () => {
  const db = nyDb();
  const res = await runRepair3570(db, DRY);
  assert.equal(res.tilstand, "DRY-RUN");

  // (a) Ingen skrivning har fundet sted → rytteren FINDES, men bærer intet draw.
  //     Det er en fejlet skrivning, og porten skal fyre. Den positive kontrol af
  //     at porten overhovedet kan se forskel.
  const levende = db.tables.riders.filter((r) => !r.is_retired).slice(0, 4);
  await assert.rejects(
    () => postVerify(db, { poster: levende.map((r) => ({ rider_id: r.id, skrives: true, abilities: {}, row: r })) },
      { skrevneCaps: [], foerValuation: new Map(levende.map((r) => [r.id, r.valuation_type])), seasonNumber: 2 }),
    (err) => {
      assert.match(err.message, /POST-VERIFY FEJLEDE/);
      assert.equal(err.rapport.antal.udenDraw, 4);
      return true;
    },
  );

  // (b) En rytter der IKKE findes er slettet — forventet, ingen fejl.
  const ud = await postVerify(db, { poster: [{ rider_id: "findes-ikke", skrives: true, abilities: {}, row: {} }] },
    { skrevneCaps: [], foerValuation: new Map(), seasonNumber: 2 });
  assert.equal(ud.bestaaet, true);
  assert.equal(ud.forventet.forsvundetUnderKoerslen, 1);
  assert.equal(ud.kontrolleret, 0);
});

test("postVerify: sletning MELLEM riders- og abilities-laesningen er forventet, ikke fejl (B5)", async () => {
  // De to opslag i postVerify er ikke atomare. Lander aiTeamTrimHealSweeps sletning
  // imellem dem, staar rytteren i det FOERSTE svar og er vaek i det ANDET. Uden
  // trin 1b's selvstaendige eksistens-opslag blev det en haard fejl — et falsk
  // alarmsignal der ville sende ejeren i rollback paa en korrekt skrivning.
  const PV = "id, archetype_draw, primary_type, secondary_type, valuation_type, birthdate, potentiale";
  const draw = { primary: "sprinter", secondary: "rouleur", isHybrid: false };
  const lav = ({ slettesMellem }) => {
    let riders = [
      { id: "r1", archetype_draw: draw, primary_type: "sprinter", secondary_type: "rouleur", valuation_type: null, birthdate: "1999-01-01", potentiale: 3 },
      { id: "r2", archetype_draw: draw, primary_type: "sprinter", secondary_type: "rouleur", valuation_type: null, birthdate: "1999-01-01", potentiale: 3 },
    ];
    let ab = [{ rider_id: "r1", ability_caps: {}, ability_progress: {} }];  // r2 mangler sin raekke
    let sect = 0;
    return {
      from: (tab) => ({
        select: (cols) => ({
          in: async (_c, ids) => {
            if (tab === "riders" && cols === PV) { sect = 1; return { data: riders.filter((r) => ids.includes(r.id)), error: null }; }
            if (tab === "rider_derived_abilities") {
              if (sect === 1 && slettesMellem) riders = riders.filter((r) => r.id !== "r2");  // cron sletter praecis her
              sect = 2;
              return { data: ab.filter((a) => ids.includes(a.rider_id)), error: null };
            }
            return { data: riders.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id })), error: null };
          },
        }),
      }),
    };
  };
  const plan = { poster: [{ rider_id: "r1", skrives: true, abilities: {}, row: {} }, { rider_id: "r2", skrives: true, abilities: {}, row: {} }] };
  const opt = { skrevneCaps: [], foerValuation: new Map([["r1", null], ["r2", null]]), seasonNumber: 2 };

  // (a) Slettet imellem de to laesninger -> forventet, ingen fejl.
  const ud = await postVerify(lav({ slettesMellem: true }), plan, opt);
  assert.equal(ud.bestaaet, true);
  assert.equal(ud.antal.manglerAbilitiesRaekke, 0);
  assert.equal(ud.forventet.forsvundetUnderKoerslen, 1);

  // (b) Rytteren LEVER, men abilities-raekken er vaek -> stadig haard fejl.
  //     Uden dette ben ville (a) bare have slaaet vagten fra.
  await assert.rejects(
    () => postVerify(lav({ slettesMellem: false }), plan, opt),
    (err) => {
      assert.match(err.message, /POST-VERIFY FEJLEDE/);
      assert.equal(err.rapport.antal.manglerAbilitiesRaekke, 1);
      assert.equal(err.rapport.forventet.forsvundetUnderKoerslen, 0);
      return true;
    },
  );
});

test("parseArgs: --apply uden --plan-fil kastes (identiteten skal komme fra den godkendte plan)", () => {
  // Uden filen falder identiteten tilbage paa buildPlan = rev2s maalfunktion, som flytter
  // 2.211 navngivne ryttere anderledes end den godkendte D-plan. Fordelingstallene er ens,
  // saa fejlen ville ikke kunne ses paa nogen af de tal ejeren kigger paa.
  assert.throws(() => parseArgs(["--apply", "--jeg-har-set-dry-runnet"]), /--apply kræver --plan-fil/);
  // Og de tre lovlige former kaster IKKE — ellers ville porten bare vaere slaaet fra.
  assert.ok(parseArgs(["--apply", "--jeg-har-set-dry-runnet", "--plan-fil", "p.json"]).planFil === "p.json");
  assert.ok(parseArgs([]).apply === false);
  assert.ok(parseArgs(["--plan-fil", "p.json"]).apply === false);
});

// ── 6. --lofter-varianten (dry-runnets beslutning 2) ────────────────────────
test("--lofter=ingen skriver identiteten, men rører ikke ability_caps", async () => {
  const db = nyDb();
  const foerCaps = JSON.parse(JSON.stringify(db.tables.rider_derived_abilities));
  const res = await runRepair3570(db, { ...APPLY, lofter: "ingen" });
  assert.ok(res.skrevet.identitet > 0);
  assert.equal(res.skrevet.lofter, 0);
  assert.equal(db.lofterOpdateret(), 0);
  assert.deepEqual(db.tables.rider_derived_abilities, foerCaps, "lofterne er bit-identiske");
  assert.equal(res.postVerify.capsKontrolleret, 0);
});

test("--lofter=menneske skriver kun lofter for menneske-ejede hold", async () => {
  const db = nyDb();
  const res = await runRepair3570(db, { ...APPLY, lofter: "menneske" });
  assert.ok(res.skrevet.lofter > 0);
  assert.ok(res.skrevet.lofter < res.skrevet.identitet, "kun en delmængde får nye lofter");
  const menneskeIds = new Set(db.tables.riders.filter((r) => r.team_id === "team-human" && !r.is_retired).map((r) => r.id));
  for (const u of db.writes.updates.filter((x) => x.table === "rider_derived_abilities")) assert.equal(u.n, 1);
  assert.ok(res.skrevet.lofter <= menneskeIds.size);
});

// ── 7. Delvis-kørsel-spærren ────────────────────────────────────────────────
/** Kopien som den så ud FØR den afbrudte kørsel: ingen har et draw endnu. */
function foerKoerselBackup(suffix, n) {
  const t = backupTabeller(suffix);
  const { riders, abilities } = makeFixture({ n, medDraw: 0 });
  return {
    [t.riders]: riders.map((r) => ({
      id: r.id, archetype_draw: null, primary_type: r.primary_type, secondary_type: r.secondary_type,
      valuation_type: r.valuation_type, base_value: r.base_value, market_value: r.market_value, is_retired: r.is_retired,
    })),
    [t.abilities]: abilities.map((a) => ({ rider_id: a.rider_id, ability_caps: a.ability_caps, ability_progress: a.ability_progress })),
  };
}

test("en afbrudt kørsel (nogle har draw, ikke alle) kræver --fortsaet-delvis", async () => {
  const { riders, abilities } = makeFixture({ n: 80, medDraw: 60 });
  const db = makeDb({ riders, abilities, ekstraTabeller: tommeBackupTabeller(SUFFIX), skema: BACKUP_SKEMA_FRA_DDL });
  await assert.rejects(() => runRepair3570(db, APPLY), /ligner en afbrudt kørsel/);
  assert.equal(db.ryttereOpdateret(), 0);
});

test("B4 NEGATIV: --fortsaet-delvis må IKKE lave en frisk kopi af en halvt skrevet database", async () => {
  // Præcis blokkerens eget scenarie: 60 af 80 bærer et draw, backup-tabellen er TOM.
  // Den gamle spærre stod kun på en allerede fyldt tabel og sprang derfor over her —
  // værktøjet fyldte kopien fra efter-tilstanden og kaldte den `verificeret: true`.
  const { riders, abilities } = makeFixture({ n: 80, medDraw: 60 });
  const db = makeDb({ riders, abilities, ekstraTabeller: tommeBackupTabeller(SUFFIX), skema: BACKUP_SKEMA_FRA_DDL });
  await assert.rejects(
    () => runRepair3570(db, { ...APPLY, fortsaetDelvis: true }),
    (err) => {
      assert.match(err.message, /duer ikke som rollback-kilde/);
      assert.match(err.message, /Brug backup-tabellen fra FØR den afbrudte kørsel/);
      assert.doesNotMatch(err.message, /Vælg et nyt --backup-suffix/, "rådet der pegede ind i hullet er væk");
      return true;
    },
  );
  assert.equal(db.ryttereOpdateret(), 0, "ingen rytter-række rørt");
  assert.equal(db.tables[backupTabeller(SUFFIX).riders].length, 0, "kopien blev ikke fyldt fra efter-tilstanden");
});

test("B4: sikreBackup returnerer IKKE verificeret på en kopi taget efter en halv kørsel", async () => {
  const { riders, abilities } = makeFixture({ n: 80, medDraw: 60 });
  const db = makeDb({ riders, abilities, ekstraTabeller: tommeBackupTabeller(SUFFIX), skema: BACKUP_SKEMA_FRA_DDL });
  await assert.rejects(
    () => sikreBackup(db, { suffix: SUFFIX, dryRun: false, log: STILLE }),
    /indeholder 60 ryttere med archetype_draw/,
  );
});

test("B4: genoptagelse MED en gyldig før-kopi går igennem og genbruger den", async () => {
  const { riders, abilities } = makeFixture({ n: 80, medDraw: 60 });
  const db = makeDb({
    riders, abilities,
    ekstraTabeller: foerKoerselBackup(SUFFIX, 80),
    skema: BACKUP_SKEMA_FRA_DDL,
  });
  const insertsFoer = db.writes.inserts.length;
  const res = await runRepair3570(db, { ...APPLY, fortsaetDelvis: true });
  assert.ok(res.skrevet.identitet > 0, "resten af puljen skrives");
  assert.equal(res.backup.verificeret, true);
  assert.deepEqual(res.backup.genbrugt, { riders: true, abilities: true });
  assert.equal(db.writes.inserts.length, insertsFoer, "den gyldige før-kopi overskrives ikke");
  assert.equal(db.tables[backupTabeller(SUFFIX).riders].every((r) => r.archetype_draw === null), true,
    "kopien bærer stadig før-tilstanden");
});

test("ryttere med eksisterende archetype_draw udelades HELT (B2)", async () => {
  const db = nyDb({ medDraw: 3 });
  const foer = JSON.parse(JSON.stringify(db.tables.riders.slice(0, 3)));
  const foerCaps = JSON.parse(JSON.stringify(db.tables.rider_derived_abilities.slice(0, 3)));
  const res = await runRepair3570(db, APPLY);
  assert.equal(res.skriveScope.udeladt, 3);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(db.tables.riders[i], foer[i], "hverken draw, primary_type eller secondary_type rørt");
    assert.deepEqual(db.tables.rider_derived_abilities[i], foerCaps[i], "heller ikke lofterne");
  }
});

// ── 8. Selvtesten mod det daterede snapshot (paritets-porten) ───────────────
test("selvtest: planlæggeren reproducerer det godkendte dry-run præcist", () => {
  const res = runSelvtest();
  assert.equal(res.bestaaet, true, `afvigelser: ${JSON.stringify(res.afvigelser)}`);
  assert.deepEqual(res.plan.segmenter, { ...DRYRUN_FACIT.segmenter });
  assert.equal(res.plan.kilder["fødsel"], 2582);
  assert.equal(res.plan.kilder.tildelt, 5611);
  assert.equal(res.plan.kilder["eksisterende draw"], 6);
  assert.equal(res.tal.skrives, 8193);
  assert.ok(Math.abs(res.plan.loeser.gap) < 1e-6, "transport-løsningen er dual-certificeret optimal");
});

test("NEGATIV: selvtesten fyrer hvis planlæggeren driver væk fra facit", () => {
  // Perturbér det DRIFT-JUSTEREDE facit (facitEfterDrift), ikke rå DRYRUN_FACIT:
  // det er dét selvtesten sammenligner mod efter #3709 trin 3. Bruges rå-facit her,
  // fejler testen på to afvigelser i stedet for én — den bevidste model-drift OG
  // perturbationen — og beviser dermed ikke længere at ÉN drift giver ÉN afvigelse.
  const res = runSelvtest({ facit: { ...facitEfterDrift(), primaerSkift: 5964 } });
  assert.equal(res.bestaaet, false);
  assert.deepEqual(res.afvigelser, [{ navn: "primær-skift", faktisk: 5965, forventet: 5964 }]);
});

test("#3709 trin 3: model-drift-ledgeren er skrevet mod DET godkendte facit", () => {
  // facitEfterDrift kaster hvis en ledger-post ikke matcher `fra`-værdien i
  // DRYRUN_FACIT. Det er vagten mod at nogen retter facit OG ledgeren i samme
  // ombæring og dermed mister det historiske dokument.
  assert.equal(DRYRUN_FACIT.loftSaenketAntal, 7234, "det godkendte 10/8-tal må aldrig redigeres");
  assert.equal(DRYRUN_FACIT.saenkningMedian, 30, "det godkendte 10/8-tal må aldrig redigeres");
  assert.equal(facitEfterDrift().loftSaenketAntal, 7230, "ledgeren skal flytte tallet til den model der faktisk koerer");
  assert.equal(facitEfterDrift().saenkningMedian, 30, "ledgeren skal flytte tallet til den model der faktisk koerer");
  assert.throws(
    () => facitEfterDrift({ ...DRYRUN_FACIT, loftSaenketAntal: 9999 }),
    /Ledgeren er skrevet mod et andet facit/,
  );
});

test("runRepair3570 stopper før DB-adgang hvis selvtesten ikke kan køre", async () => {
  const db = nyDb();
  await assert.rejects(
    () => runRepair3570(db, { ...DRY, baselineDir: "C:/findes/ikke/3570" }),
    /ENOENT|no such file/i,
  );
  assert.equal(db.writes.updates.length, 0);
});

// ── 9. Diff mod 10/8-planen ─────────────────────────────────────────────────
test("diffModBaseline finder drift, nye og forsvundne ryttere", () => {
  const basis = [
    { rider_id: "a", firstname: "A", lastname: "A", primary_type: "climber", ability_caps: { climbing: 50 } },
    { rider_id: "b", firstname: "B", lastname: "B", primary_type: "gc", ability_caps: { climbing: 50 } },
  ];
  const mk = (rows, primaries) => ({
    poster: rows.map((r, i) => ({
      rider_id: r.rider_id, row: r, newPrimary: primaries[i], newSecondary: "rouleur",
      oldCaps: r.ability_caps, segment: "B", kilde: "tildelt",
    })),
  });
  const baseline = mk(basis, ["sprinter", "tt"]);
  const frisk = mk(
    [{ ...basis[0], primary_type: "rouleur" }, { rider_id: "c", firstname: "C", lastname: "C", primary_type: "gc", ability_caps: { climbing: 50 } }],
    ["puncheur", "gc"],
  );
  const d = diffModBaseline(frisk, baseline);
  assert.equal(d.labelDriftAntal, 1, "a's label drev fra climber til rouleur");
  assert.equal(d.primaerDiffAntal, 1, "a får en anden frossen type end 10/8-planen");
  assert.equal(d.nye.length, 1);
  assert.equal(d.forsvundne.length, 1);
});

// ── 10. Byggeklodser ────────────────────────────────────────────────────────
test("quotasFromPct rammer ejerens mål og summer eksakt til n", () => {
  for (const n of [0, 1, 7, 100, 5611, 8193]) {
    const q = quotasFromPct(n, MAAL);
    assert.equal(q.reduce((a, b) => a + b, 0), n, `sum for n=${n}`);
  }
  const q = quotasFromPct(5611, MAAL);
  assert.deepEqual(Object.fromEntries(RIDER_TYPE_KEYS.map((k, i) => [k, q[i]])), DRYRUN_FACIT.kvoter);
});

test("solveAssignment respekterer kvoterne og er dual-certificeret optimal", () => {
  const S = Array.from({ length: 40 }, (_, i) => RIDER_TYPE_KEYS.map((_k, k) => Math.sin(i * 7 + k * 13)));
  const q = quotasFromPct(40, MAAL);
  const sol = solveAssignment(S, q);
  assert.deepEqual(sol.counts, q);
  assert.ok(Math.abs(sol.gap) < 1e-6, `dual-gap ${sol.gap}`);
  assert.throws(() => solveAssignment(S, [40, 0, 0, 0, 0, 0, 0, 1]), /kvoter summer til 41/);
});

test("segmentOf og fødsels-genfindingen følger F4's regler", () => {
  const base = Object.fromEntries(STAT_KEYS.map((k) => [k, 52]));
  assert.equal(segmentOf({ ...base, stat_bj: 48 }, "adult"), "D", "min < 49 → legacy");
  assert.equal(segmentOf({ ...base, stat_bj: 86 }, "adult"), "D", "max > 85 → legacy");
  assert.equal(segmentOf(base, "youth"), "C", "akademi-familien → C");
  assert.equal(segmentOf({ ...base, stat_bj: 70 }, "adult"), "A", "max > 57 → fri pyramide");
  assert.equal(segmentOf(base, "adult"), "B", "ellers trup-pulje");
  assert.equal(segmentOf({ ...base, stat_bj: null }, "adult"), "D", "manglende stats → legacy");

  const g = recoverBirthArchetype({ ...base, stat_sp: 64, stat_acc: 61, stat_fl: 58, height: 182, weight: Math.round(22.8 * 1.82 ** 2) });
  assert.ok(RIDER_TYPE_KEYS.includes(g.primary));
  assert.equal(g.ranked.length, 8);
  assert.equal(g.rankOf[g.primary], 1);
  assert.ok(g.confidence > 0 && g.confidence <= 1);
  assert.equal(recoverBirthArchetype({ height: 180, weight: 70 }), null, "uden stats: ingen evidens, ikke et gæt");
});

test("planen skriver BEGGE ben af anlægget (primær + sekundær)", async () => {
  const db = nyDb();
  await runRepair3570(db, APPLY);
  for (const r of db.tables.riders.filter((x) => !x.is_retired)) {
    assert.ok(RIDER_TYPE_KEYS.includes(r.archetype_draw.primary));
    assert.ok(RIDER_TYPE_KEYS.includes(r.archetype_draw.secondary));
    assert.notEqual(r.archetype_draw.primary, r.archetype_draw.secondary);
    assert.equal(r.secondary_type, r.archetype_draw.secondary);
  }
});

test("de skrevne lofter er præcis buildCapsForRider med produktionens kaldform", async () => {
  const db = nyDb();
  await runRepair3570(db, APPLY);
  const rById = new Map(db.tables.riders.map((r) => [r.id, r]));
  for (const a of db.tables.rider_derived_abilities) {
    const r = rById.get(a.rider_id);
    if (r.is_retired) continue;
    const evner = {};
    for (const k of VISIBLE_ABILITIES) evner[k] = Number(a[k]);
    const alder = 2027 - new Date(r.birthdate).getFullYear();
    const forventet = buildCapsForRider(evner, { potentiale: r.potentiale, age: alder }, r.primary_type, r.secondary_type);
    for (const k of VISIBLE_ABILITIES) assert.equal(Number(a.ability_caps[k]), forventet[k], `${a.rider_id}.${k}`);
  }
});

test("backup-DDL og datostempel", () => {
  const ddl = backupDDL("20260816");
  assert.match(ddl, /riders_3570_backup_20260816/);
  assert.match(ddl, /rider_derived_abilities_3570_backup_20260816/);
  assert.match(ddl, /rider_id uuid PRIMARY KEY/, "primærnøglen prod-præcedensen mangler");
  assert.match(ddl, /base_value integer/, "base_value/market_value skal med (§10.5)");
  assert.match(cphDateStamp(new Date("2026-08-16T23:30:00Z")), /^20260817$/, "dansk lokaltid, ikke UTC");
});

// ── 11. B1′ — ÉT skema, ét tabelnavn, tre artefakter ────────────────────────
test("B1′: DDL, rollback-SQL og værktøjets kolonne-lister deler nøjagtig ét skema", () => {
  const suffix = "20260816";
  const t = backupTabeller(suffix);
  const fraDDL = skemaFraDDL(backupDDL(suffix));
  const sql = rollbackSQL(suffix);

  // 1) DDL'ens kolonner ER skemaets kolonner (+ captured_at).
  assert.deepEqual(fraDDL[t.riders], [...BACKUP_SKEMA.riders.kolonner.map((k) => k.navn), "captured_at"]);
  assert.deepEqual(fraDDL[t.abilities], [...BACKUP_SKEMA.abilities.kolonner.map((k) => k.navn), "captured_at"]);

  // 2) De to nøgler er FORSKELLIGE og arvet fra kilde-tabellerne — det var kernen i B1′.
  assert.equal(BACKUP_SKEMA.riders.noegle, "id");
  assert.equal(BACKUP_SKEMA.abilities.noegle, "rider_id");

  // 3) rollback-SQL'en omdøber IKKE nøglen (`SELECT id AS rider_id` var defekten)
  //    og joiner på den samme nøgle værktøjet læser.
  assert.doesNotMatch(sql, /id\s+AS\s+rider_id/i, "riders-kopien må ikke omdøbe id → rider_id");
  assert.match(sql, new RegExp(`ADD CONSTRAINT ${t.riders}_pkey PRIMARY KEY \\(id\\)`));
  assert.match(sql, new RegExp(`ADD CONSTRAINT ${t.abilities}_pkey PRIMARY KEY \\(rider_id\\)`));
  assert.match(sql, /FROM public\.riders_3570_backup_20260816 b\nWHERE b\.id = r\.id/);

  // 4) ÉT tabelnavn. Det tredje navn fra skriveplan.json (`..._2026_08_16`) findes ingen steder.
  assert.doesNotMatch(sql, /_3570_backup_\d{4}_\d{2}_\d{2}/, "underscore-datoen er ude af omløb");
  assert.doesNotMatch(backupDDL(suffix), /_3570_backup_\d{4}_\d{2}_\d{2}/);
});

test("B1′: den checkede-ind repair3570Rollback.sql er ikke drevet fra generatoren", () => {
  // Linjeskift normaliseres. Repoet kører core.autocrlf=true, så git leverer filen
  // med CRLF i et Windows-checkout mens generatoren skriver LF — vagten ville da
  // fejle rødt på hver eneste rebase uden at én tegn af SQL havde flyttet sig.
  // .gitattributes holder filen på LF; dette er andet lag, så en dev med en anden
  // git-konfiguration ikke får et falsk STOP på skrivedagen.
  const lf = (s) => s.replace(/\r\n/g, "\n");
  const fil = readFileSync(join(__dirname, "repair3570Rollback.sql"), "utf8");
  assert.equal(lf(fil), lf(rollbackSQL(KANONISK_BACKUP_SUFFIX)),
    "kør: node scripts/dev/repair3570Apply.mjs --print-rollback-sql > scripts/dev/repair3570Rollback.sql");
});

test("B1′ NEGATIV: en backup-tabel oprettet med det GAMLE rollback-skema (rider_id) afbryder kørslen", async () => {
  // Sådan så verden ud før rettelsen: rollback.sql lavede riders-kopien med
  // `SELECT id AS rider_id`, mens værktøjet læste `id`. Mocken håndhæver nu
  // kolonnenavne, så den fejler præcis som PostgREST ville.
  const { riders, abilities } = makeFixture();
  const t = backupTabeller(SUFFIX);
  const gammeltSkema = {
    ...BACKUP_SKEMA_FRA_DDL,
    [t.riders]: BACKUP_SKEMA_FRA_DDL[t.riders].map((c) => (c === "id" ? "rider_id" : c)),
  };
  const db = makeDb({ riders, abilities, ekstraTabeller: tommeBackupTabeller(SUFFIX), skema: gammeltSkema });
  await assert.rejects(
    () => runRepair3570(db, APPLY),
    (err) => {
      assert.match(err.message, new RegExp(`column ${t.riders}\\.id does not exist`));
      return true;
    },
  );
  assert.equal(db.ryttereOpdateret(), 0, "0 rækker skrevet");
  assert.equal(db.lofterOpdateret(), 0);
});

// ── 12. B5 — prod sletter ryttere mens vi skriver ───────────────────────────
/** Lad prod slette ryttere midt i identitets-skrivningen, som AI-hold-trimmen gør. */
function sletMidtIKoerslen(db, ids) {
  let gjort = false;
  db.saetSaboteur((table, patch) => {
    if (table !== "riders" || !patch.archetype_draw || gjort) return null;
    gjort = true;
    db.sletRyttere(ids);
    return null;
  });
}

test("B5: ryttere slettet under kørslen er FORVENTEDE — post-verify består og rapporterer dem", async () => {
  const db = nyDb();
  const ofre = ["r08", "r09", "r10"];        // AI-ejede, som trim-sweepen tager
  sletMidtIKoerslen(db, ofre);
  const res = await runRepair3570(db, APPLY);

  assert.equal(res.postVerify.bestaaet, true);
  assert.equal(res.postVerify.forventet.forsvundetUnderKoerslen, 3);
  assert.equal(res.postVerify.antal.manglerRaekke, 0, "en sletning er IKKE en manglende række");
  assert.equal(res.postVerify.kontrolleret, res.skriveScope.identitet - 3, "de slettede tælles ikke som kontrolleret");
  assert.deepEqual(res.postVerify.forsvundne.map((f) => f.rider_id).sort(), ofre);
  assert.equal(res.postVerify.forsvundne.every((f) => f.ejer === "ai"), true, "ejer-arten er med i rapporten");
});

test("B5 NEGATIV: en FEJLET skrivning fejler stadig højlydt (rytteren findes, draw'et mangler)", async () => {
  const db = nyDb();
  // Rytteren bliver IKKE slettet — updaten lander bare aldrig på ham.
  db.saetSaboteur((table, patch, target) => {
    if (table !== "riders" || !patch.archetype_draw) return null;
    const i = target.findIndex((r) => r.id === "r05");
    if (i < 0) return null;
    target.splice(i, 1);                      // r05 springes over i denne batch
    return null;
  });
  await assert.rejects(
    () => runRepair3570(db, APPLY),
    (err) => {
      assert.match(err.message, /POST-VERIFY FEJLEDE/);
      assert.equal(err.rapport.antal.udenDraw, 1, "en manglende skrivning fanges som udenDraw");
      assert.equal(err.rapport.forventet.forsvundetUnderKoerslen, 0, "og IKKE som en sletning");
      return true;
    },
  );
});

test("B5 NEGATIV: rytteren lever, men abilities-rækken er væk → hård fejl (FK'en er CASCADE)", async () => {
  const db = nyDb();
  let gjort = false;
  db.saetSaboteur((table, patch) => {
    if (table !== "riders" || !patch.archetype_draw || gjort) return null;
    gjort = true;
    db.tables.rider_derived_abilities = db.tables.rider_derived_abilities.filter((a) => a.rider_id !== "r02");
    return null;
  });
  await assert.rejects(
    () => runRepair3570(db, APPLY),
    (err) => {
      assert.match(err.message, /POST-VERIFY FEJLEDE/);
      assert.equal(err.rapport.antal.manglerAbilitiesRaekke, 1);
      assert.equal(err.rapport.forventet.forsvundetUnderKoerslen, 0);
      return true;
    },
  );
});

test("B5 NEGATIV: forsvinder flere end grænsen, er det ikke trim-sweepen længere → hård fejl", async () => {
  const { riders, abilities } = makeFixture({ n: 80 });
  const db = makeDb({ riders, abilities, ekstraTabeller: tommeBackupTabeller(SUFFIX), skema: BACKUP_SKEMA_FRA_DDL });
  const mange = riders.filter((r) => !r.is_retired).slice(0, 30).map((r) => r.id);
  assert.ok(mange.length > FORSVUNDNE_GRAENSE_MIN, "testen skal faktisk overskride gulvet");
  sletMidtIKoerslen(db, mange);
  await assert.rejects(
    () => runRepair3570(db, APPLY),
    (err) => {
      assert.match(err.message, /POST-VERIFY FEJLEDE/);
      assert.equal(err.rapport.antal.forsvundneOverGraense, 1);
      return true;
    },
  );
});

test("B5: skellet hviler på et SELVSTÆNDIGT eksistens-opslag, ikke på det brede opslags svar", async () => {
  const db = nyDb();
  const res = await runRepair3570(db, APPLY);
  assert.equal(res.postVerify.bestaaet, true);
  // Rækken findes, men det brede opslag "taber" den. Så er den IKKE slettet, og
  // porten skal kalde det en hård fejl — ikke en forventet sletning.
  const rigtigeIn = db.from;
  let brugt = false;
  const spion = {
    ...db,
    from(table) {
      const b = rigtigeIn.call(db, table);
      if (table !== "riders") return b;
      return {
        ...b,
        select: (cols) => {
          const s = b.select(cols);
          return {
            ...s,
            in: (col, ids) => {
              // Tab r01 én gang — kun i det brede opslag, ikke i eksistens-opslaget.
              if (!brugt && String(cols).includes("archetype_draw")) {
                brugt = true;
                return s.in(col, ids.filter((x) => x !== "r01"));
              }
              return s.in(col, ids);
            },
          };
        },
      };
    },
  };
  await assert.rejects(
    () => postVerify(spion, { poster: db.tables.riders.filter((r) => !r.is_retired).map((r) => ({ rider_id: r.id, skrives: true, abilities: {}, row: r })) },
      { skrevneCaps: [], foerValuation: new Map(db.tables.riders.map((r) => [r.id, r.valuation_type])), seasonNumber: 2 }),
    (err) => {
      assert.equal(err.rapport.antal.manglerRaekke, 1, "kom tilbage på anden forespørgsel → læsefejl, ikke sletning");
      assert.equal(err.rapport.forventet.forsvundetUnderKoerslen, 0);
      return true;
    },
  );
});

// ── --plan-fil: den GODKENDTE plan bestemmer identiteten ────────────────────
// Værktøjets egen løser bærer rev2's målfunktion. Ejeren låste indstilling D.
// De to giver samme typefordeling (kvoterne er ens) men flytter 2.211 navngivne
// ryttere hver sin vej, så uden --plan-fil skriver værktøjet rev2 — uanset hvilken
// fil der ligger på disken.
//
// Den POSITIVE prøve nedenfor er bevidst selv-refererende: plan-filen genereres ud
// af værktøjets egen baseline-plan, så den kan ikke bevise at D er rigtig. Det bevis
// ligger i kørslen mod den ægte D-fil (376.890 sammenligninger, 122.895 loft-celler,
// 0 afvigelser). Det disse tests beviser er MEKANIKKEN: at filen faktisk overtager
// identiteten, at lofterne stadig kommer fra friske evner, og at porten kan fejle.
function planFilFra(poster, kvoter) {
  return {
    revision: "test",
    regel: kvoter ? { kvoter } : {},
    ryttere: poster.map((p) => ({
      rider_id: p.rider_id,
      skrives: !!p.skrives,
      primary_efter: p.skrives ? p.newPrimary : null,
      secondary_efter: p.skrives ? p.newSecondary : null,
      skrives_ability_caps: p.skrives ? { ...p.newCaps } : null,
    })),
  };
}
function skrivPlanFil(objekt, navn) {
  const dir = mkdtempSync(join(tmpdir(), "planfil-"));
  const sti = join(dir, `${navn}.json`);
  writeFileSync(sti, JSON.stringify(objekt));
  return sti;
}

test("laesPlanFil læser den gzippede plan identisk med den rå", () => {
  const objekt = { revision: "T", ryttere: [
    { rider_id: "a", skrives: true, primary_efter: "gc", secondary_efter: "tt", skrives_ability_caps: { climbing: 70 } },
    { rider_id: "b", skrives: false, primary_efter: null, secondary_efter: null, skrives_ability_caps: null },
  ] };
  const raaSti = skrivPlanFil(objekt, "raa");
  const gzSti = `${raaSti}.gz`;
  writeFileSync(gzSti, gzipSync(readFileSync(raaSti)));

  const raa = laesPlanFil(raaSti);
  const gz = laesPlanFil(gzSti);
  assert.equal(gz.antal, raa.antal);
  assert.equal(gz.skrives, raa.skrives);
  assert.equal(gz.revision, raa.revision);
  assert.deepEqual([...gz.identitet.entries()], [...raa.identitet.entries()]);

  // .gz-grenen vælges på endelsen — en gzippet fil UDEN endelsen skal fejle som JSON,
  // ellers beviser testen ovenfor ikke at udpakningen faktisk skete.
  const forklaedt = join(dirname(gzSti), "forklaedt.json");
  writeFileSync(forklaedt, readFileSync(gzSti));
  assert.throws(() => laesPlanFil(forklaedt));
});

test("laesPlanFil afviser ugyldige planer (type, dublet, primær == sekundær)", () => {
  const en = (r) => skrivPlanFil({ ryttere: [r] }, "ugyldig");
  assert.throws(() => laesPlanFil(en({ rider_id: "a", skrives: true, primary_efter: "bjergged", secondary_efter: "gc" })), /ugyldig primary_efter/);
  assert.throws(() => laesPlanFil(en({ rider_id: "a", skrives: true, primary_efter: "gc", secondary_efter: "gc" })), /samme primær og sekundær/);
  assert.throws(() => laesPlanFil(en({ skrives: true, primary_efter: "gc", secondary_efter: "tt" })), /mangler rider_id/);
  assert.throws(() => laesPlanFil(skrivPlanFil({ ryttere: [
    { rider_id: "a", skrives: true, primary_efter: "gc", secondary_efter: "tt" },
    { rider_id: "a", skrives: true, primary_efter: "gc", secondary_efter: "tt" },
  ] }, "dublet")), /står to gange/);
  assert.throws(() => laesPlanFil(skrivPlanFil({ intet: 1 }, "tom")), /ingen "ryttere"-liste/);
});

test("--plan-fil overtager identiteten, men lofterne kommer STADIG fra friske evner", async () => {
  const db = nyDb();
  const frisk = await hentFriskPopulation(db);
  const plan = buildPlan(frisk.rows, { seasonNumber: frisk.seasonNumber });
  const løserValg = new Map(plan.poster.map((p) => [p.rider_id, p.newPrimary]));

  // Filen vælger en ANDEN type end løseren for hver rytter i scopet — og bærer
  // bevidst forkerte lofter (99 overalt). Lofterne skal komme fra buildCapsForRider.
  const fil = planFilFra(plan.poster);
  const løgn = Object.fromEntries(VISIBLE_ABILITIES.map((a) => [a, 99]));
  for (const r of fil.ryttere) {
    if (!r.skrives) continue;
    r.primary_efter = RIDER_TYPE_KEYS.find((k) => k !== løserValg.get(r.rider_id));
    r.secondary_efter = RIDER_TYPE_KEYS.find((k) => k !== r.primary_efter);
    r.skrives_ability_caps = { ...løgn };
  }
  const pf = laesPlanFil(skrivPlanFil(fil, "andet-valg"));
  const plan2 = buildPlan(frisk.rows, { seasonNumber: frisk.seasonNumber });
  const rapport = paalaegPlanFil(plan2, pf);

  assert.equal(rapport.ikkeIFilen.length, 0);
  assert.ok(rapport.aendretFraLoeser > 0, "filen skal faktisk have overtaget noget");
  for (const p of plan2.poster.filter((x) => x.skrives)) {
    assert.equal(p.newPrimary, pf.identitet.get(p.rider_id).primary, "identiteten kommer fra filen");
    assert.equal(p.draw.primary, p.newPrimary, "draw'et følger med");
    const forventet = buildCapsForRider(p.abilities, { potentiale: p.row.potentiale, age: p.row.age }, p.newPrimary, p.newSecondary);
    assert.deepEqual(p.newCaps, forventet, "loftet er genberegnet ud af friske evner");
    assert.notDeepEqual(p.newCaps, løgn, "loftet er IKKE filens");
  }
  assert.ok(rapport.capsAfvigelser.length > 0, "filens forkerte lofter er rapporteret, ikke tiet ihjel");
});

test("--plan-fil er fail-closed: en rytter i scopet uden identitet i filen fanges", async () => {
  const db = nyDb();
  const frisk = await hentFriskPopulation(db);
  const fil = planFilFra(buildPlan(frisk.rows, { seasonNumber: frisk.seasonNumber }).poster);
  fil.ryttere.splice(fil.ryttere.findIndex((r) => r.skrives), 1);
  const pf = laesPlanFil(skrivPlanFil(fil, "mangler"));
  const plan2 = buildPlan(frisk.rows, { seasonNumber: frisk.seasonNumber });
  const rapport = paalaegPlanFil(plan2, pf);
  assert.equal(rapport.ikkeIFilen.length, 1);
  // Rytteren beholder løserens valg i objektet, men han er talt som udækket —
  // og kørslen kaster på netop det tal, i stedet for at skrive to målfunktioner.
  assert.equal(rapport.daekket, plan2.poster.filter((p) => p.skrives).length - 1);
});

test("runPlanFilSelvtest består på en gyldig plan og fejler på tre beskadigelser", () => {
  const { plan } = baselinePlan(BASELINE_SNAPSHOT_DIR);
  const gyldig = planFilFra(plan.poster, plan.kvoter);
  const ok = runPlanFilSelvtest({ dir: BASELINE_SNAPSHOT_DIR, planFil: laesPlanFil(skrivPlanFil(gyldig, "gyldig")) });
  assert.equal(ok.bestaaet, true, JSON.stringify(ok.afvigelser));
  assert.equal(ok.rapport.capsAfvigelser.length, 0);
  assert.ok(ok.rapport.capsCeller > 100_000, "hele loft-fladen er sammenlignet");

  const cellen = planFilFra(plan.poster, plan.kvoter);
  const r1 = cellen.ryttere.find((r) => r.skrives);
  r1.skrives_ability_caps.climbing = Number(r1.skrives_ability_caps.climbing) + 1;
  const n1 = runPlanFilSelvtest({ dir: BASELINE_SNAPSHOT_DIR, planFil: laesPlanFil(skrivPlanFil(cellen, "celle")) });
  assert.equal(n1.bestaaet, false);
  assert.ok(n1.afvigelser.some((a) => a.navn.includes("caps-celler")));

  const kvote = planFilFra(plan.poster, plan.kvoter);
  const r2 = kvote.ryttere.find((r) => r.skrives && r.primary_efter !== "gc");
  r2.primary_efter = "gc";
  if (r2.secondary_efter === "gc") r2.secondary_efter = "sprinter";
  const n2 = runPlanFilSelvtest({ dir: BASELINE_SNAPSHOT_DIR, planFil: laesPlanFil(skrivPlanFil(kvote, "kvote")) });
  assert.equal(n2.bestaaet, false);
  assert.ok(n2.afvigelser.some((a) => a.navn.startsWith("kvote ")));

  // En rytter der mangler er IKKE en paritets-fejl — filen kan være bygget på et
  // nyere snapshot. Den skal rapporteres, kvote-kontrollen skal falde bort (ellers
  // måles en delmængde mod et fuldt kvote-sæt), og dækningskravet håndhæves i
  // runRepair3570 mod den friske population. Se testen nedenfor.
  const mangler = planFilFra(plan.poster, plan.kvoter);
  mangler.ryttere.splice(mangler.ryttere.findIndex((r) => r.skrives), 1);
  const n3 = runPlanFilSelvtest({ dir: BASELINE_SNAPSHOT_DIR, planFil: laesPlanFil(skrivPlanFil(mangler, "mangler2")) });
  assert.equal(n3.bestaaet, true, "manglende dækning er ikke en paritets-fejl");
  assert.equal(n3.fuldDaekning, false);
  assert.equal(n3.ikkeIFilen, 1);
  assert.ok(!n3.afvigelser.some((a) => a.navn.startsWith("kvote ")), "kvoterne kontrolleres ikke på en delmængde");

  // NEGATIV 4: en fil uden ét eneste fælles navn kan ikke bevise noget.
  const fremmed = { revision: "fremmed", ryttere: [{ rider_id: "findes-ikke", skrives: true, primary_efter: "gc", secondary_efter: "tt", skrives_ability_caps: null }] };
  const n4 = runPlanFilSelvtest({ dir: BASELINE_SNAPSHOT_DIR, planFil: laesPlanFil(skrivPlanFil(fremmed, "fremmed")) });
  assert.equal(n4.bestaaet, false);
  assert.ok(n4.afvigelser.some((a) => a.navn.includes("fælles")));
});

test("dækningskravet håndhæves mod den FRISKE population, ikke mod 10/8-snapshottet", async () => {
  const db = nyDb();
  const frisk = await hentFriskPopulation(db);
  const plan = buildPlan(frisk.rows, { seasonNumber: frisk.seasonNumber });
  const { plan: bPlan } = baselinePlan(BASELINE_SNAPSHOT_DIR);

  const fil = planFilFra(bPlan.poster, bPlan.kvoter);
  const fixtur = planFilFra(plan.poster);
  fixtur.ryttere.splice(fixtur.ryttere.findIndex((r) => r.skrives), 1);   // én frisk rytter mangler
  for (const r of fixtur.ryttere) fil.ryttere.push(r);

  await assert.rejects(
    () => runRepair3570(db, { ...APPLY, planFil: skrivPlanFil(fil, "hul"), ingenBaseline: true }),
    /ingen godkendt identitet/,
  );
  assert.equal(db.writes.updates.length, 0, "der må ikke være skrevet én række");
  assert.equal(db.writes.inserts.length, 0, "og ingen backup taget");
});

test("hele kørslen med --plan-fil skriver filens identitet, ikke løserens", async () => {
  const db = nyDb();
  const frisk = await hentFriskPopulation(db);
  const plan = buildPlan(frisk.rows, { seasonNumber: frisk.seasonNumber });
  const { plan: bPlan } = baselinePlan(BASELINE_SNAPSHOT_DIR);

  // Filen dækker BÅDE baseline-snapshottet (selvtesten kræver det) og fixturen.
  const fil = planFilFra(bPlan.poster, bPlan.kvoter);
  const fixtur = planFilFra(plan.poster);
  for (const r of fixtur.ryttere) {
    if (r.skrives) {
      const anden = RIDER_TYPE_KEYS.find((k) => k !== r.primary_efter);
      if (r.secondary_efter === anden) r.secondary_efter = r.primary_efter;
      r.primary_efter = anden;
      r.skrives_ability_caps = null;
    }
    fil.ryttere.push(r);
  }
  const res = await runRepair3570(db, { ...APPLY, planFil: skrivPlanFil(fil, "union"), ingenBaseline: true });

  assert.equal(res.planFilSelvtest.bestaaet, true);
  assert.equal(res.planFil.ikkeIFilen, 0);
  assert.ok(res.planFil.aendretFraLoeser > 0);
  for (const r0 of fixtur.ryttere.filter((r) => r.skrives)) {
    const r = db.tables.riders.find((x) => x.id === r0.rider_id);
    assert.equal(r.primary_type, r0.primary_efter, `${r0.rider_id} skal bære filens type`);
    assert.equal(r.archetype_draw.primary, r0.primary_efter);
  }
  assert.equal(res.postVerify.bestaaet, true);
});

test("uden --plan-fil siger rapporten eksplicit at det er værktøjets egen løser", async () => {
  const linjer = [];
  await runRepair3570(nyDb(), { ...DRY, log: (s) => linjer.push(s) });
  const tekst = linjer.join("\n");
  assert.match(tekst, /INGEN --plan-fil/);
  assert.match(tekst, /VÆRKTØJETS EGEN løser/);
});
