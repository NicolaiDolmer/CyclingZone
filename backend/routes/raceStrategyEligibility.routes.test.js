import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #2616 — regressionsvagt for det duplikerede eligibility-filter i de tre
// /races/strategy*-routes.
//
// PR #2610 (#2579) indførte `applyRiderEligibilityFilter` som DEN delte gate for
// "hvilke ryttere må vælges nu" — den udelukker OGSÅ en rytter der er solgt, men
// hvis holdskifte er parkeret (`pending_team_id`) pga. et aktivt etapeløb hos
// sælger (#1995). PR'en fixede de reelle skrive-/udtagelses-stier (raceSelection.js,
// raceEntryGenerator.js, raceRunner.js) + regenerate-endpointet i api.js, men tre
// identiske rå eligibility-queries i GET/PUT/POST /races/strategy* (roster-visning,
// a_chain/kaptajn-prioriteter, preview-generatoren) blev overset — de manglede
// `pending_team_id`-udelukkelsen, så en solgt-pending rytter stadig kunne vises i
// strategi-roster-UI'et og gemmes ind i a_chain/kaptajn-prioriteter.
//
// Kilde-scan (samme mønster som riderPeakPlans.routes.test.js/
// seasonCalendarGenerateRoute.test.js): låser wiring uden en live server/
// supertest-harness. Selve `applyRiderEligibilityFilter`s pending_team_id-adfærd
// (inkl. den nøjagtige eq/or/is-kæde) er allerede dækket af riderEligibility.test.js
// — denne fil dækker KUN at de tre strategi-routes rent faktisk bruger DEN delte
// gate i stedet for en dupliceret rå akademi/pensioneret-kæde.

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "api.js"), "utf8");

function handlerBlock(marker) {
  const idx = apiSource.indexOf(marker);
  assert.ok(idx !== -1, `${marker} skal findes`);
  const next = apiSource.indexOf("\nrouter.", idx + 1);
  return apiSource.slice(idx, next === -1 ? idx + 5000 : next);
}

// Den tidligere duplikerede rå kæde (uden pending_team_id) — skal IKKE længere stå
// i nogen af de tre roster-queries. Hvis den dukker op igen (fx en fremtidig ny
// route der kopi-indsætter mønsteret), skal denne test fange det.
const RAW_ELIGIBILITY_CHAIN = /\.eq\("is_academy",\s*false\)\.or\("is_retired\.is\.null,is_retired\.eq\.false"\)/;

const ROUTES = [
  { name: "GET /races/strategy", marker: 'router.get("/races/strategy"' },
  { name: "PUT /races/strategy", marker: 'router.put("/races/strategy"' },
  { name: "POST /races/strategy/preview", marker: 'router.post("/races/strategy/preview"' },
];

for (const { name, marker } of ROUTES) {
  test(`${name} bruger den delte applyRiderEligibilityFilter til roster-queriet`, () => {
    const block = handlerBlock(marker);
    assert.match(
      block,
      /applyRiderEligibilityFilter\(\s*\n?\s*supabase\.from\("riders"\)/,
      `${name} skal hente riders via applyRiderEligibilityFilter(...), ikke en rå query`,
    );
  });

  test(`${name} har IKKE den gamle duplikerede rå eligibility-kæde (uden pending_team_id)`, () => {
    const block = handlerBlock(marker);
    assert.doesNotMatch(
      block,
      RAW_ELIGIBILITY_CHAIN,
      `${name} skal IKKE længere indeholde den dupliktede rå .eq/.or-kæde — ` +
        "den manglede pending_team_id-udelukkelsen (#2579-guard-hullet for solgt-pending-ryttere)",
    );
  });
}

test("applyRiderEligibilityFilter er importeret i routes/api.js", () => {
  assert.match(
    apiSource,
    /import\s*\{\s*applyRiderEligibilityFilter\s*\}\s*from\s*"\.\.\/lib\/riderEligibility\.js"/,
  );
});
