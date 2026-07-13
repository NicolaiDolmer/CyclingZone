import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Race Engine v3 (#2224) S5 — peak-planner CRUD wiring-guard.
//
// Kilde-scan (samme mønster som boardBankGuard.routes.test.js): låser de
// sikkerheds-kritiske invarianter i routes/api.js så en regression fanges uden en
// live server/supertest-harness. Den ÆGTE DB-kontrakt (kolonner + RLS + insert)
// verificeres separat via execute_sql mod prod (se PR-beskrivelse / NOW.md).

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function handlerBlock(marker) {
  const idx = apiSource.indexOf(marker);
  assert.ok(idx !== -1, `${marker} skal findes`);
  // Frem til næste route-registrering (groft handler-omfang).
  const next = apiSource.indexOf("\nrouter.", idx + 1);
  return apiSource.slice(idx, next === -1 ? idx + 4000 : next);
}

const ROUTES = [
  { name: "GET /peak-plans", marker: 'router.get("/peak-plans"' },
  { name: "POST /peak-plans", marker: 'router.post("/peak-plans"' },
  { name: "PATCH /peak-plans/:id", marker: 'router.patch("/peak-plans/:id"' },
  { name: "DELETE /peak-plans/:id", marker: 'router.delete("/peak-plans/:id"' },
];

for (const { name, marker } of ROUTES) {
  test(`${name} er registreret med requireAuth`, () => {
    const block = handlerBlock(marker);
    assert.match(block, /requireAuth/, `${name} skal kræve auth`);
  });
  test(`${name} gates bag peak_planner_enabled (launch-switch)`, () => {
    const block = handlerBlock(marker);
    assert.match(block, /isPeakPlannerEnabled/, `${name} skal tjekke launch-flaget`);
  });
}

// Writes bruger marketWriteLimiter (rate-limit) — GET er billig/uafgrænset.
for (const { name, marker } of ROUTES.filter((r) => !r.name.startsWith("GET"))) {
  test(`${name} har marketWriteLimiter`, () => {
    assert.match(handlerBlock(marker), /marketWriteLimiter/, `${name} skal rate-limites`);
  });
}

test("POST håndhæver ejerskab (egen rytter) + max-2/duplikat-guard", () => {
  const block = handlerBlock('router.post("/peak-plans"');
  assert.match(block, /not_own_rider/, "POST skal afvise fremmede ryttere");
  assert.match(block, /canCreatePeakPlan/, "POST skal bruge max-2/duplikat-guarden");
});

test("POST afleder vinduet server-side (snap), læser IKKE window fra body", () => {
  const block = handlerBlock('router.post("/peak-plans"');
  assert.match(block, /snapPeakWindow/, "POST skal snappe vinduet server-side");
  // Insert bruger det server-afledte vindue, ikke klient-input.
  assert.match(block, /window_start:\s*window\.window_start/, "insert skal bruge det snappede vindue");
  // Body destruktureres KUN til rider_id + target_race_id (ingen window-felter).
  const bodyLine = block.match(/const \{[^}]*\} = req\.body/)?.[0] ?? "";
  assert.doesNotMatch(bodyLine, /window/, "POST må ALDRIG læse et window-felt fra body");
});

test("POST kræver mål-løb i holdets kalender (division-tilhør)", () => {
  const block = handlerBlock('router.post("/peak-plans"');
  assert.match(block, /loadTargetRaceForPeak/, "POST skal validere mål-løbets kalender-tilhør");
});

test("PATCH + DELETE håndhæver ejerskab + lås-guard (kun redigerbar)", () => {
  for (const marker of ['router.patch("/peak-plans/:id"', 'router.delete("/peak-plans/:id"']) {
    const block = handlerBlock(marker);
    assert.match(block, /loadOwnedPeakPlan/, `${marker} skal verificere ejerskab`);
    assert.match(block, /lockGuardForWrite/, `${marker} skal afvise låste planer`);
    assert.match(block, /"locked"/, `${marker} skal svare 409 locked`);
  }
});
