import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #1162/#1242 — forward-guard mod potentiale-lækage i backend-API'et.
//
// Den sande riders.potentiale må ALDRIG forlade serveren for ikke-admin-klienter.
// Klienter får kun det viewer-maskerede estimat ({lo, hi, exact, level}) fra
// POST /api/scouting/estimates. Disse tests scanner routes/api.js + migrationen
// som kildetekst (samme mønster som auctionSchemaContract.test.js) så en
// regression fanges uden at kræve en live DB.

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");
const migrationSource = readFileSync(
  resolve(__dirname, "../../database/2026-06-10-riders-potentiale-column-privilege.sql"),
  "utf8",
);

test("GET /riders/:id stripper potentiale for ikke-admins (#1162)", () => {
  // Routen selecter `*` (service_role ser alt) og SKAL derfor slette feltet
  // før res.json for ikke-admin-viewers.
  assert.match(
    apiSource,
    /if \(!viewerIsAdmin\) delete data\.potentiale;/,
    "GET /riders/:id skal slette data.potentiale for ikke-admins før response",
  );
});

test("POST /scouting/estimates er registreret FØR POST /scouting/:riderId (#1162)", () => {
  // Express matcher i registreringsrækkefølge — ellers fanges "estimates" som
  // riderId af param-routen og estimat-endpointet bliver dødt.
  const estimatesIdx = apiSource.indexOf('router.post("/scouting/estimates"');
  const paramIdx = apiSource.indexOf('router.post("/scouting/:riderId"');
  assert.ok(estimatesIdx !== -1, "POST /scouting/estimates skal findes");
  assert.ok(paramIdx !== -1, "POST /scouting/:riderId skal findes");
  assert.ok(estimatesIdx < paramIdx, "estimates-routen skal registreres før :riderId-routen");
});

test("kun scouting-interne selects i api.js læser potentiale-kolonnen (#1162)", () => {
  // Whitelist: de tre interne reads der føder estimat-beregningen (sendes aldrig
  // videre rå til klienten):
  //   1. POST /scouting/estimates — batch-estimater
  //   2. POST /scouting/:riderId   — enkelt-rytter scout
  //   3. GET  /academy/me          — akademi-kandidat potentiale-fetch (#1308)
  //   4. GET  /riders/:id/scouting-report — rapport-beregning (#1543); maskeres
  //      som bånd via buildScoutEstimate/buildTypeCeilingBands før response.
  // Dukker en femte select med potentiale op, skal den reviewes bevidst —
  // den må ikke ende i et klient-response.
  const matches = apiSource.match(/\.select\([^)]*\bpotentiale\b[^)]*\)/g) ?? [];
  assert.equal(
    matches.length,
    4,
    `forventede præcis 3 scouting-interne potentiale-selects i api.js, fandt ${matches.length}: ${matches.join(" | ")}`,
  );
  for (const m of matches) {
    assert.match(m, /id,\s*(team_id,\s*potentiale|potentiale)/, `uventet potentiale-select: ${m}`);
  }
});

test("scouting-report returnerer aldrig rå potentiale eller ability_caps (#1543)", () => {
  const idx = apiSource.indexOf('"/riders/:id/scouting-report"');
  assert.ok(idx !== -1, "scouting-report-routen skal findes");
  const block = apiSource.slice(idx, idx + 4000);
  assert.doesNotMatch(
    block,
    /res\.json\([^)]*\b(potentiale|ability_caps)\b/,
    "rå potentiale/ability_caps må ikke indgå i payloaden",
  );
  assert.match(block, /buildTypeCeilingBands\(/, "skal bruge bånd-beregningen");
  assert.match(block, /buildScoutEstimate\(/, "stjerne-båndet skal komme fra buildScoutEstimate");
});

test("development-projection returnerer aldrig rå potentiale eller ability_caps (#2100)", () => {
  const idx = apiSource.indexOf('"/riders/:id/development-projection"');
  assert.ok(idx !== -1, "development-projection-routen skal findes");
  const block = apiSource.slice(idx, idx + 3000);
  assert.doesNotMatch(
    block,
    /res\.json\([^)]*\b(potentiale|ability_caps)\b/,
    "rå potentiale/ability_caps må ikke indgå i projektions-payloaden",
  );
  // Projektionen skal bygge på det MASKEREDE loft-bånd + den rene projektions-funktion —
  // ikke rå caps direkte til klienten.
  assert.match(block, /buildTypeCeilingBands\(/, "projektionen skal bruge det maskerede loft-bånd");
  assert.match(block, /projectCeilingBand\(/, "projektionen skal komme fra projectCeilingBand");
  // Routen må IKKE selecte potentiale (loft-båndet bærer den allerede maskeret).
  const selectBlock = block.slice(0, block.indexOf(".maybeSingle()"));
  assert.doesNotMatch(selectBlock, /\bpotentiale\b/, "development-projection må ikke selecte potentiale");
});

test("migrationen maskerer både riders.potentiale og rider_derived_abilities.hidden_potential (#1162)", () => {
  assert.match(migrationSource, /REVOKE SELECT ON public\.riders FROM anon, authenticated/);
  assert.match(migrationSource, /column_name <> 'potentiale'/);
  assert.match(migrationSource, /REVOKE SELECT ON public\.rider_derived_abilities FROM anon, authenticated/);
  assert.match(migrationSource, /column_name <> 'hidden_potential'/);
});

test("#2244: nye scouting-central/assignments-endpoints emitter aldrig potentiale/exact-felter", () => {
  // GET /scouting/central + POST /scouting/assignments(/:id/cancel) returnerer
  // KUN assignment-metadata (rider_id-referencer, cost, dates, status) — aldrig
  // rå potentiale eller det udfasede `exact`-felt (#2244 A3 fjernede exact helt).
  for (const marker of ['"/scouting/central"', '"/scouting/assignments"', '"/scouting/assignments/:id/cancel"']) {
    const idx = apiSource.indexOf(marker);
    assert.ok(idx !== -1, `${marker}-routen skal findes`);
    const block = apiSource.slice(idx, idx + 1000);
    assert.doesNotMatch(block, /\bpotentiale\b/, `${marker} må ikke referere potentiale`);
    assert.doesNotMatch(block, /\bexact\b/, `${marker} må ikke referere det udfasede exact-felt`);
  }
});

test("#2244: POST /scouting/:riderId (slots) er kill-switch-gatet bag scout_system_enabled", () => {
  const idx = apiSource.indexOf('router.post("/scouting/:riderId"');
  assert.ok(idx !== -1, "POST /scouting/:riderId skal findes");
  const block = apiSource.slice(idx, idx + 1000);
  assert.match(block, /isScoutSystemEnabled\(req\)/, "routen skal tjekke scout_system_enabled-flaget (m. admin-preview, A4b-moenster)");
  assert.match(block, /410/, "routen skal returnere 410 når job-modellen er slået til");
});

test("scout-svaret returnerer kun det maskerede estimat — aldrig rå potentiale (#1162)", () => {
  // POST /scouting/:riderId returnerer estimate: buildScoutEstimate(...) — find
  // response-blokken og verificér at rå rider.potentiale ikke er i payloaden.
  const block = apiSource.slice(
    apiSource.indexOf('router.post("/scouting/:riderId"'),
    apiSource.indexOf('router.post("/scouting/:riderId"') + 2500,
  );
  assert.match(block, /estimate:\s*buildScoutEstimate\(/, "scout-svaret skal indeholde det maskerede estimat");
  assert.doesNotMatch(
    block,
    /potentiale:\s*rider\.potentiale|rider\.potentiale\s*,?\s*\n?\s*\}\);?\s*$/m,
    "scout-svaret må ikke indeholde rå rider.potentiale",
  );
});
