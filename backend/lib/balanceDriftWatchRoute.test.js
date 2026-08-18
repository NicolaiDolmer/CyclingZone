import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #3696 — Balance-drift-vagten (#2414) hentede rows faldende (nyeste først)
// fra `race_balance_drift_daily`, byggede en stigende kopi (`ascRows`) til
// breach-beregningerne, men mappede stadig de RÅ (faldende) `rows` til
// response-feltet `days`. Frontenden (BalanceDriftWatchSection.jsx) læser
// `days[days.length - 1]` som "seneste måling" og renderer dato-kolonnerne
// venstre mod højre — med faldende rækkefølge blev det den ÆLDSTE dag, og
// trenden løb baglæns.
//
// Kilde-scan (samme mønster som seasonCalendarGenerateRoute.test.js): låser
// wiring uden en live server/supertest-harness. findConsecutiveBreaches()'s
// egen sorterings-uafhængige logik er dækket af balanceDriftMetrics.test.js —
// denne fil dækker KUN at api.js sender `days` i samme (stigende) rækkefølge
// som breach-beregningerne bruger.

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function handlerBlock(marker) {
  const idx = apiSource.indexOf(marker);
  assert.ok(idx !== -1, `${marker} skal findes`);
  const next = apiSource.indexOf("\nrouter.", idx + 1);
  return apiSource.slice(idx, next === -1 ? idx + 4000 : next);
}

test("GET /admin/balance-drift er requireAdmin-gated", () => {
  assert.match(
    apiSource,
    /router\.get\(\s*"\/admin\/balance-drift"\s*,\s*requireAdmin/,
    "GET /admin/balance-drift skal kræve admin",
  );
});

test("GET /admin/balance-drift henter rows faldende men bygger ascRows til brug i responset", () => {
  const block = handlerBlock('router.get("/admin/balance-drift"');
  assert.match(
    block,
    /\.order\(\s*"metric_date"\s*,\s*\{\s*ascending:\s*false\s*\}\s*\)/,
    "queryen skal (fortsat) hente nyeste-først fra DB'en (LIMIT 14 tager de sidste 14 dage)",
  );
  assert.match(
    block,
    /const ascRows\s*=\s*\[\.\.\.\(rows \|\| \[\]\)\]\.reverse\(\)/,
    "ascRows skal være en stigende (reversed) kopi af de faldende rows",
  );
});

test("days i responset bygges fra ascRows, IKKE fra de rå (faldende) rows — #3696-regressionsguard", () => {
  const block = handlerBlock('router.get("/admin/balance-drift"');
  const daysMatch = block.match(/days:\s*(\w+)\.map\(/);
  assert.ok(daysMatch, "kunne ikke finde 'days:'-feltet i responset");
  assert.equal(
    daysMatch[1],
    "ascRows",
    "days skal mappes fra ascRows (stigende dato-orden) — mapping fra rå 'rows' er den bug #3696 fixede",
  );
});

test("breaches + tierBreaches bruger samme ascRows-kilde som days (ingen rækkefølge-uenighed mellem felterne)", () => {
  const block = handlerBlock('router.get("/admin/balance-drift"');
  assert.match(
    block,
    /findConsecutiveBreaches\(\s*ascRows\.map/,
    "findConsecutiveBreaches skal bruge ascRows",
  );
  assert.match(
    block,
    /const tierBreachRows\s*=\s*ascRows\.map/,
    "tierBreachRows skal afledes af ascRows",
  );
});
