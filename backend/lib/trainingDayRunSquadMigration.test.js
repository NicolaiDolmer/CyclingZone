// #4847: migrations-gate for trup-aksen paa traeningens loebsdags-noegle.
//
// HVORFOR EN TEST PAA SQL-TEKST. Idempotensen for #4620's tre loebsdags-akser pr.
// hold (senior/U23/junior) bor i et PARTIELT UNIKT INDEX i Postgres, ikke i JS.
// dailyTrainingEngine.test.js's mock kan bevise at MOTOREN sender `squad` — den kan
// ikke bevise at DATABASEN haandhaever det. Uden denne gate kunne migrationen blive
// aendret eller slettet, motoren ville fortsat sende squad, alle JS-tests ville
// vaere groenne, og produktionen ville tavst kassere U23-ticket som 23505 =
// alreadyRan (TRAINING_RULES.md §10's stille fejlklasse).
//
// Testen er ROED uden database/2026-09-15-4847-training-day-close-trigger.sql.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TRAINING_DAY_RUN_DEFAULT_SQUAD } from "./dailyTrainingEngine.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATION = join(repoRoot, "database", "2026-09-15-4847-training-day-close-trigger.sql");

function sql() {
  return readFileSync(MIGRATION, "utf8");
}

test("#4847: migrationen tilfoejer squad-kolonnen med 'senior' som default", () => {
  const text = sql();
  assert.match(
    text,
    /ADD COLUMN IF NOT EXISTS squad TEXT NOT NULL DEFAULT 'senior'/i,
    "kolonnen skal vaere additiv og defaulte, saa hver eksisterende raekke beholder sin plads i noeglen",
  );
  assert.equal(TRAINING_DAY_RUN_DEFAULT_SQUAD, "senior",
    "motorens default og skemaets default skal vaere det SAMME ord");
});

test("#4847: den unikke loebsdags-noegle indeholder truppen", () => {
  const text = sql();
  const match = text.match(
    /CREATE UNIQUE INDEX IF NOT EXISTS uniq_training_day_runs_team_season_squad_game_day\s+ON public\.training_day_runs\s*\(([^)]*\)[^;]*?)\)\s*\n\s*WHERE game_day IS NOT NULL/i,
  );
  assert.ok(match, "det udvidede unikke index mangler — U23-ticket ville kollidere med senior-ticket");
  const cols = match[1];
  assert.match(cols, /team_id/);
  assert.match(cols, /season_id/);
  assert.match(cols, /game_day/);
  assert.match(
    cols,
    /COALESCE\(\s*squad\s*,\s*'senior'\s*\)/i,
    "COALESCE er paakraevet: NULL er ikke lig sig selv i en unik noegle, saa to NULL-rader ville begge slippe igennem",
  );
});

test("#4847: #4846's gamle noegle uden squad droppes (ellers staar to noegler og slaas)", () => {
  assert.match(
    sql(),
    /DROP INDEX IF EXISTS public\.uniq_training_day_runs_team_season_game_day/i,
    "bliver den gamle staaende, afviser DEN stadig U23-ticket uanset det nye index",
  );
});

test("#4847: migrationen er idempotent (kan koeres igen uden at fejle)", () => {
  const text = sql();
  // auto-migrate.yml (#2642) koerer migrationer ved merge og kan koere dem igen.
  for (const stmt of ["ADD COLUMN", "CREATE UNIQUE INDEX", "CREATE INDEX"]) {
    const re = new RegExp(`${stmt}(?! IF (NOT )?EXISTS)`, "i");
    assert.ok(!re.test(text), `${stmt} uden IF [NOT] EXISTS — migrationen ville fejle ved anden koersel`);
  }
});
