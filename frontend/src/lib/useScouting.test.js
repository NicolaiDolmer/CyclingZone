// #5242 — fokuseret regressionsværn for netværksfejl-grenen i startTargetJob()
// og scoutLegacy() (useScouting.js).
//
// Reviewer-bemærkning fra skive A (PR #5372, kommentar 18/9): grenen manglede
// en dedikeret test. Kontrakten (se kildens egne #5242-kommentarer) er strengt
// rækkefølge-afhængig: apiFetch KASTER ikke længere ved en transportfejl
// (#5322), og uden en eksplicit `if (res.networkError)`-gren FØR
// `sharedRequestCache.invalidate(...)` ville et tabt netværk stadig invalidere
// den delte scout-state-cache, selvom scout-handlingen aldrig nåede serveren —
// næste mount ville så tvinges til at hente på ny for INTET (samme klasse
// bug som #3619, men på cache-siden i stedet for på telemetri-siden).
//
// Hooket kan ikke køres uden React-runtime i node --test, så kontrakten testes
// på kilden — samme mønster som useBlockedAction.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(dir, "useScouting.js"), "utf8");

const HANDLERS = [
  {
    name: "startTargetJob",
    start: "const startTargetJob = useCallback(async (riderId) => {",
    end: "const scoutLegacy = useCallback(async (riderId) => {",
  },
  {
    name: "scoutLegacy",
    start: "const scoutLegacy = useCallback(async (riderId) => {",
    end: "const scout = useCallback((riderId) =>",
  },
];

for (const { name, start, end } of HANDLERS) {
  test(`${name}(): res.networkError returnerer { ok:false, error:'network' } FØR sharedRequestCache.invalidate()`, () => {
    const startIdx = src.indexOf(start);
    const endIdx = src.indexOf(end, startIdx);
    assert.ok(startIdx >= 0 && endIdx > startIdx, `fandt ikke ${name}()'s body`);
    const body = src.slice(startIdx, endIdx);

    const networkIdx = body.indexOf('if (res.networkError) return { ok: false, error: "network" };');
    const invalidateIdx = body.indexOf("sharedRequestCache.invalidate(SHARED_KEYS.scoutingMe)");
    assert.ok(networkIdx >= 0, `${name} skal tjekke res.networkError eksplicit`);
    assert.ok(invalidateIdx >= 0, `${name} skal invalidere den delte scout-cache ved et REELT svar`);
    assert.ok(
      networkIdx < invalidateIdx,
      `${name}: networkError-tjekket SKAL ligge før cache-invalideringen — et kald der aldrig nåede ` +
        "serveren må ikke tvinge næste mount til at hente forfra",
    );

    // Sikkerhedsnet: fejler apiFetch alligevel (uventet exception), skal
    // catch-grenen give samme fejlform, og finally skal altid rydde scoutingId
    // (ellers sidder rytteren fast i "scouter lige nu"-visningen).
    assert.match(body, /catch \{\s*return \{ ok: false, error: "network" \};\s*\}/);
    assert.match(body, /finally \{\s*setScoutingId\(null\);\s*\}/);
  });
}

test("scout()-dispatcheren vælger mellem de to uden selv at duplikere netværksfejl-håndtering", () => {
  assert.match(
    src,
    /const scout = useCallback\(\(riderId\) => \(\s*scoutSystemEnabled \? startTargetJob\(riderId\) : scoutLegacy\(riderId\)\s*\),/,
  );
});
