import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #2449 — admin-endpoint der eksponerer den REPRODUCERBARE per-division kalender-
// generator (jf. #1125). Efter unify (#2449) er tierCalendarMaterializer den kanoniske
// generator: preview bygger den RENE plan (buildTierMaterializationPlan, ingen writes),
// apply materialiserer (materializeTierCalendars). Kilde-scan (samme mønster som
// seasonTransitionRoute.test.js): låser wiring uden en live server/supertest-harness.
// Generator-determinismen + tier/kaskade-korrektheden er dækket af
// tierCalendarMaterializer.test.js — denne fil dækker KUN at admin-fladen kalder dem
// korrekt (gate, dryRun-default, ingen writes i preview).

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function handlerBlock(marker) {
  const idx = apiSource.indexOf(marker);
  assert.ok(idx !== -1, `${marker} skal findes`);
  const next = apiSource.indexOf("\nrouter.", idx + 1);
  return apiSource.slice(idx, next === -1 ? idx + 5000 : next);
}

test("routes/api.js importerer buildTierMaterializationPlan + materializeTierCalendars", () => {
  assert.match(
    apiSource,
    /import\s*\{\s*buildTierMaterializationPlan\s*,\s*materializeTierCalendars\s*\}\s*from\s*"\.\.\/lib\/tierCalendarMaterializer\.js"/,
  );
});

test("GET /admin/seasons/:id/generate-calendar/preview er requireAdmin-gated og skriver ALDRIG", () => {
  const block = handlerBlock('router.get("/admin/seasons/:id/generate-calendar/preview"');
  assert.match(block, /requireAdmin/, "preview skal kræve admin");
  assert.match(block, /buildTierMaterializationPlan\(/, "preview skal bygge den rene plan direkte");
  assert.doesNotMatch(block, /materializeTierCalendars\(/, "preview må ALDRIG kalde materializeren (den kan skrive)");
  assert.doesNotMatch(block, /\.insert\(/, "preview må ALDRIG indeholde en insert-kode-sti");
});

test("POST /admin/seasons/:id/generate-calendar er requireAdmin + adminWriteLimiter-gated", () => {
  assert.match(
    apiSource,
    /router\.post\(\s*"\/admin\/seasons\/:id\/generate-calendar"\s*,\s*requireAdmin\s*,\s*adminWriteLimiter/,
  );
});

test("POST-handler dryRun-default er true (eksplicit ?dryRun=false kræves for writes)", () => {
  const block = handlerBlock('router.post("/admin/seasons/:id/generate-calendar"');
  assert.match(block, /dryRun\s*=\s*req\.query\.dryRun\s*!==\s*"false"/, "dryRun skal defaulte til true (samme mønster som generate-entries)");
  assert.match(block, /materializeTierCalendars\(\{[\s\S]*?dryRun/, "POST skal videresende dryRun til materializeren");
});

test("POST-handler logger kun til admin_log ved ægte writes (ikke dry-run)", () => {
  const block = handlerBlock('router.post("/admin/seasons/:id/generate-calendar"');
  assert.match(block, /if\s*\(!dryRun\)\s*\{[\s\S]*?logActivity\(\s*"season_calendar_generated"/, "logActivity skal stå inde i !dryRun-grenen");
});

test("POST-handler 404'er på ukendt sæson-id FØR nogen generator-kode kaldes", () => {
  const block = handlerBlock('router.post("/admin/seasons/:id/generate-calendar"');
  assert.match(block, /if\s*\(!season\)\s*return res\.status\(404\)/, "manglende sæson skal svare 404");
  assert.ok(
    block.indexOf("status(404)") < block.indexOf("materializeTierCalendars("),
    "404-guarden skal stå FØR materializeTierCalendars-kaldet",
  );
});
