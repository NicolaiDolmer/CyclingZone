// Integrationstest for fiktiv-rytter-oprettelse (#669, Fase 4) mod en ægte
// Postgres-motor via PGlite (in-memory, ingen Docker, ingen cost). Erstatter den
// betalte Supabase preview-branch: beviser at generatorens payload faktisk kan
// INSERT'es mod prod-schemaet, at generated-kolonner beregnes korrekt, at fiktive
// ryttere er synlige + frie agenter, at eksisterende PCM-ryttere er urørte, og at
// en rytter kan refereres af en auktion (spilbar).
//
// riders-DDL'en spejler prod (database/schema.sql + verificerede generation_expr
// fra discovery 2026-05-31). uuid_generate_v4() → gen_random_uuid() (PGlite har
// ikke uuid-ossp; funktionelt ækvivalent for testen).

import test, { before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

import { generateFictionalRiders, toInsertPayload, STAT_KEYS } from "./fictionalRiderGenerator.js";

const REF_YEAR = 2026;

const RIDERS_DDL = `
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  is_ai BOOLEAN DEFAULT FALSE
);
CREATE TABLE riders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pcm_id INTEGER UNIQUE,
  firstname TEXT NOT NULL,
  lastname TEXT NOT NULL,
  birthdate DATE,
  nationality_code TEXT,
  height INTEGER,
  weight INTEGER,
  popularity INTEGER DEFAULT 0,
  uci_points INTEGER DEFAULT 1,
  prize_earnings_bonus INTEGER NOT NULL DEFAULT 0,
  base_value INTEGER,
  market_value INTEGER GENERATED ALWAYS AS (COALESCE(base_value, 1000) + prize_earnings_bonus) STORED,
  salary INTEGER GENERATED ALWAYS AS (
    (GREATEST((1)::numeric, round(((COALESCE(base_value, 1000) + prize_earnings_bonus))::numeric * 0.10)))::integer
  ) STORED,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  ai_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  pending_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  stat_fl INTEGER, stat_bj INTEGER, stat_kb INTEGER, stat_bk INTEGER,
  stat_tt INTEGER, stat_prl INTEGER, stat_bro INTEGER, stat_sp INTEGER,
  stat_acc INTEGER, stat_ned INTEGER, stat_udh INTEGER, stat_mod INTEGER,
  stat_res INTEGER, stat_ftr INTEGER,
  potentiale DECIMAL(3,1),
  is_u25 BOOLEAN DEFAULT FALSE,
  is_retired BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  acquired_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE auctions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID REFERENCES riders(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'active'
);
`;

// Insert via dynamisk kolonne-liste — samme form som supabase.insert(batch) i CLI'en.
async function insertRiders(db, payload) {
  const keys = Object.keys(payload[0]);
  const sql = `INSERT INTO riders (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})`;
  for (const row of payload) {
    await db.query(sql, keys.map((k) => row[k]));
  }
}

// Én delt PGlite-instans (WASM-init er dyrt); ryd tabellerne før hver test.
let db;
before(async () => {
  db = new PGlite();
  await db.exec(RIDERS_DDL);
});
beforeEach(async () => {
  await db.exec("TRUNCATE riders, auctions, teams CASCADE");
});

test("fiktive ryttere INSERT'es mod prod-schemaet uden fejl (NOT NULL/kolonner OK)", async () => {
  const { riders } = generateFictionalRiders({ seed: 669, count: 60, referenceYear: REF_YEAR });
  const payload = toInsertPayload(riders);
  await insertRiders(db, payload); // kaster hvis en kolonne/NOT NULL/constraint fejler
  const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM riders");
  assert.equal(rows[0].n, 60);
});

test("generated-kolonner (market_value/salary) beregnes korrekt af DB (#1101 cutover)", async () => {
  const { riders } = generateFictionalRiders({ seed: 7, count: 50, referenceYear: REF_YEAR });
  await insertRiders(db, toInsertPayload(riders));

  const { rows } = await db.query(
    "SELECT base_value, prize_earnings_bonus, market_value, salary FROM riders",
  );
  for (const r of rows) {
    const bonus = r.prize_earnings_bonus;
    assert.equal(r.prize_earnings_bonus, 0, "bonus skal defaulte til 0 (ikke sat af generator)");
    // Generatoren sætter ikke base_value (backfill gør) → fallback-økonomien 1000/100
    // dækker insert→backfill-vinduet uden NULL.
    assert.equal(r.base_value, null, "base_value sættes af backfill, ikke generatoren");
    assert.equal(r.market_value, 1000 + bonus, "market_value = COALESCE(base_value,1000) + bonus");
    assert.equal(r.salary, Math.max(1, Math.round((1000 + bonus) * 0.1)), "salary-formel");
  }

  // Efter backfill (her: direkte UPDATE) følger økonomien base_value.
  await db.query("UPDATE riders SET base_value = 50000");
  const { rows: after } = await db.query("SELECT market_value, salary FROM riders LIMIT 5");
  for (const r of after) {
    assert.equal(r.market_value, 50000, "market_value følger base_value efter backfill");
    assert.equal(r.salary, 5000, "salary = 10% af market_value");
  }
});

test("fiktive ryttere er synlige (is_retired=false) og frie agenter (team_id NULL)", async () => {
  const { riders } = generateFictionalRiders({ seed: 1, count: 40, referenceYear: REF_YEAR });
  await insertRiders(db, toInsertPayload(riders));

  // Samme filter som GET /riders.
  const visible = await db.query("SELECT COUNT(*)::int AS n FROM riders WHERE is_retired = false");
  assert.equal(visible.rows[0].n, 40);
  const free = await db.query("SELECT COUNT(*)::int AS n FROM riders WHERE team_id IS NULL");
  assert.equal(free.rows[0].n, 40);
  const own = await db.query("SELECT COUNT(*)::int AS n FROM riders WHERE pcm_id IS NULL");
  assert.equal(own.rows[0].n, 40, "alle fiktive har pcm_id NULL (egen-markør)");
});

test("eksisterende PCM-rytter er fuldstændig urørt af fiktiv insert", async () => {
  // Simulér en ægte PCM-rytter.
  await db.query(
    "INSERT INTO riders (pcm_id, firstname, lastname, uci_points) VALUES ($1,$2,$3,$4)",
    [9999, "Real", "Rider", 1500],
  );
  const before = await db.query("SELECT id, firstname, lastname, uci_points, market_value FROM riders WHERE pcm_id = 9999");

  const { riders } = generateFictionalRiders({ seed: 42, count: 50, referenceYear: REF_YEAR });
  await insertRiders(db, toInsertPayload(riders));

  const after = await db.query("SELECT id, firstname, lastname, uci_points, market_value FROM riders WHERE pcm_id = 9999");
  assert.deepEqual(after.rows[0], before.rows[0], "PCM-rytteren må ikke ændres");

  const pcmCount = await db.query("SELECT COUNT(*)::int AS n FROM riders WHERE pcm_id IS NOT NULL");
  assert.equal(pcmCount.rows[0].n, 1, "antal PCM-ryttere uændret");
  const ownCount = await db.query("SELECT COUNT(*)::int AS n FROM riders WHERE pcm_id IS NULL");
  assert.equal(ownCount.rows[0].n, 50, "kun de 50 fiktive tilføjet");
});

test("en fiktiv rytter kan refereres af en auktion (spilbar — FK-integritet)", async () => {
  const { riders } = generateFictionalRiders({ seed: 5, count: 10, referenceYear: REF_YEAR });
  await insertRiders(db, toInsertPayload(riders));

  const { rows } = await db.query("SELECT id FROM riders LIMIT 1");
  const riderId = rows[0].id;
  // Kaster ved FK-brud; lykkes hvis rytteren er et gyldigt auktions-mål.
  await db.query("INSERT INTO auctions (rider_id) VALUES ($1)", [riderId]);
  const a = await db.query("SELECT COUNT(*)::int AS n FROM auctions WHERE rider_id = $1", [riderId]);
  assert.equal(a.rows[0].n, 1);
});

test("payload indeholder ingen ukendte kolonner (alle keys findes i schemaet)", async () => {
  const cols = await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'riders'",
  );
  const schemaCols = new Set(cols.rows.map((r) => r.column_name));
  const { riders } = generateFictionalRiders({ seed: 3, count: 5, referenceYear: REF_YEAR });
  const [sample] = toInsertPayload(riders);
  for (const key of Object.keys(sample)) {
    assert.ok(schemaCols.has(key), `payload-kolonne '${key}' findes ikke i riders-schemaet`);
  }
  // Sanity: payload rører hverken generated-kolonner eller base_value (backfill ejer den).
  for (const gen of ["market_value", "salary", "base_value"]) {
    assert.ok(!(gen in sample), `payload må ikke sætte '${gen}'`);
  }
  // Sanity: alle 14 stats med.
  for (const s of STAT_KEYS) assert.ok(s in sample, `mangler ${s}`);
});
