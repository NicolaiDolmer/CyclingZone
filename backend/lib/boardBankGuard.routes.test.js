import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #1077 — board guard-hærdning.
//
// To invarianter hærdes her (kilde: board-audit 2026-06, Dim E):
//   1. Bank-pseudo-holdet (is_ai:false, is_bank:true) skal ekskluderes fra
//      økonomi-processeringen (loadHumanSeasonEndTeams + processSeasonStart).
//      service_role-klienten bypasser RLS, så filteret SKAL gentages eksplicit
//      i hver hold-selekterende query — samme diskriminator som cron.js:89.
//   2. De fire /board-handlere (status/sign/request/renew) skal afvise
//      is_ai/is_bank/is_frozen med 403 — spejler DNA-endpoint-guarden.
//
// Tests scanner kildeteksten (samme mønster som potentialeHiding.routes.test.js)
// så en regression fanges uden at kræve en live DB / supertest-harness.

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");
const economySource = readFileSync(resolve(__dirname, "./economyEngine.js"), "utf8");

// ── Invariant 1: bank ekskluderet fra økonomi-processering ──────────────────

test("loadHumanSeasonEndTeams ekskluderer bank-holdet (#1077)", () => {
  const start = economySource.indexOf("export async function loadHumanSeasonEndTeams");
  assert.ok(start !== -1, "loadHumanSeasonEndTeams skal findes");
  const block = economySource.slice(start, start + 800);
  assert.match(
    block,
    /\.eq\("is_ai",\s*false\)[\s\S]*\.eq\("is_bank",\s*false\)[\s\S]*\.eq\("is_frozen",\s*false\)/,
    "season-end team-filter skal chaine is_ai + is_bank + is_frozen",
  );
});

test("processSeasonStart ekskluderer bank-holdet (#1077)", () => {
  const start = economySource.indexOf("export async function processSeasonStart");
  assert.ok(start !== -1, "processSeasonStart skal findes");
  // Hold-query ligger efter sponsor-context-load — søg fra funktionsstart frem
  // til board_consequences-querien (næste from-kald).
  const end = economySource.indexOf('.from("board_consequences")', start);
  const block = economySource.slice(start, end === -1 ? start + 2000 : end);
  assert.match(
    block,
    /\.eq\("is_ai",\s*false\)[\s\S]*\.eq\("is_bank",\s*false\)[\s\S]*\.eq\("is_frozen",\s*false\)/,
    "season-start team-filter skal chaine is_ai + is_bank + is_frozen",
  );
});

// ── Invariant 2: de fire /board-handlere guarder is_ai/is_bank/is_frozen ────

const BOARD_HANDLERS = [
  { name: "GET /board/status", marker: 'router.get("/board/status"' },
  { name: "POST /board/sign", marker: 'router.post("/board/sign"' },
  { name: "POST /board/request", marker: 'router.post("/board/request"' },
  { name: "POST /board/renew", marker: 'router.post("/board/renew"' },
];

for (const { name, marker } of BOARD_HANDLERS) {
  test(`${name} afviser is_ai/is_bank/is_frozen med 403 (#1077)`, () => {
    const idx = apiSource.indexOf(marker);
    assert.ok(idx !== -1, `${name} skal findes`);
    // Guarden ligger øverst i handleren — kig på de første ~600 tegn.
    const block = apiSource.slice(idx, idx + 600);
    assert.match(
      block,
      /if \(req\.team\?\.is_ai \|\| req\.team\?\.is_bank \|\| req\.team\?\.is_frozen\)/,
      `${name} skal have is_ai/is_bank/is_frozen-guarden`,
    );
    assert.match(
      block,
      /res\.status\(403\)/,
      `${name} skal returnere 403 for ikke-manager-hold`,
    );
  });
}
