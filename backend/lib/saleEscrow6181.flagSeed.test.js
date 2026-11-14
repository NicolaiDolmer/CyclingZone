// #6181 · Vagt paa flag-seed-migrationen for saelgers laaste penge.
// Migrationen maa kun oprette raekken `sale_escrow_enabled` slukket, og den maa
// aldrig overskrive en eksisterende raekke. Ellers ville et replay (eller en senere
// "rettelse" til DO UPDATE) kunne slukke eller taende pengelaasen bag ejerens ryg.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = "../../database/2026-11-14-6181-sale-escrow-flag-seed.sql";

/** Fjerner `--`-kommentarer og strenge, saa kun selve SQL'en vurderes. */
function sqlBody(sql) {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\s+/g, " ")
    .trim();
}

const raw = readFileSync(join(__dirname, MIGRATION), "utf8");
const body = sqlBody(raw);

test("flag-seed: opretter kun raekken, ON CONFLICT DO NOTHING, aldrig DO UPDATE", () => {
  assert.match(body, /INSERT INTO public\.app_config \(key, value, description\)/i);
  assert.match(body, /ON CONFLICT \(key\) DO NOTHING/i, "et replay maa ikke roere en raekke, ejeren har flyttet");
  assert.doesNotMatch(body, /DO\s+UPDATE/i, "migrationen maa aldrig overskrive en eksisterende raekke");
  assert.doesNotMatch(body, /\bUPDATE\s+public\.app_config\b/i, "ingen UPDATE paa app_config");
  assert.doesNotMatch(body, /\bDELETE\s+FROM\b/i, "ingen DELETE (rollback staar kun som kommentar)");
  assert.doesNotMatch(body, /\bUPSERT\b|\bMERGE\s+INTO\b/i, "ingen anden overskrivende form");
  assert.equal((body.match(/\bINSERT INTO\b/gi) || []).length, 1, "praecis een INSERT");
});

test("flag-seed: noeglen er sale_escrow_enabled, og startstadiet er off", () => {
  assert.match(raw, /VALUES \(\s*'sale_escrow_enabled',\s*'"off"'::jsonb,/, "raekken skal oprettes slukket");
  assert.doesNotMatch(raw, /'"(on|beta)"'::jsonb/, "migrationen maa aldrig skrive on eller beta");
});

test("vagten fanger faktisk en DO UPDATE-variant (selvtest)", () => {
  const tampered = raw.replace(
    "ON CONFLICT (key) DO NOTHING",
    "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
  );
  assert.notEqual(tampered, raw, "selvtesten skal ramme migrationens ON CONFLICT-linje");
  assert.match(sqlBody(tampered), /DO\s+UPDATE/i);
  assert.doesNotMatch(sqlBody(tampered), /ON CONFLICT \(key\) DO NOTHING/i);
});
