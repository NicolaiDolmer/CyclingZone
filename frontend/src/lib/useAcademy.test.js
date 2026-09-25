// #5242 — fokuseret regressionsværn for netværksfejl-grenen i useAcademy.js.
//
// Reviewer-bemærkning fra skive A (PR #5372, kommentar 18/9): grenen manglede
// en dedikeret test. apiFetch KASTER ikke længere ved en transportfejl (#5322)
// — den returnerer `{ networkError: true }` — så et kaldsted der ikke skelner
// rammer sin egen `!res.ok`-gren og viser "failed" i stedet for "network".
// AcademyPage viser to forskellige beskeder for de to årsager.
//
// Hooket kan ikke køres uden React-runtime i node --test, så kontrakten testes
// på kilden — samme mønster som useBlockedAction.test.js/ui/*.source.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(dir, "useAcademy.js"), "utf8");

test("NETWORK_FAILURE-konstanten matcher catch-grenenes { ok:false, error:'network' }", () => {
  assert.match(
    src,
    /const NETWORK_FAILURE = \{ ok: false, error: "network" \};/,
    "konstanten skal have samme form som catch-fallbacken, ellers kan kaldstedet ikke skelne dem",
  );
});

test("refresh() returnerer TIDLIGT ved networkError, uden at røre roster/error-state", () => {
  const start = src.indexOf("const refresh = useCallback(async () => {");
  const end = src.indexOf("}, [refreshBalance]);", start);
  assert.ok(start >= 0 && end > start, "fandt ikke refresh()'s body");
  const body = src.slice(start, end);

  const networkBranchIdx = body.indexOf("if (res.networkError) { setLoading(false); return; }");
  assert.ok(networkBranchIdx >= 0, "refresh() skal tjekke res.networkError eksplicit");

  // Grenen skal ligge FØR body læses og FØR nogen af de andre setX-kald, så et
  // tabt netværk beholder den forrige visning i stedet for at nulstille den.
  const bodyReadIdx = body.indexOf("const body = res.data || {};");
  const setEnabledIdx = body.indexOf("setEnabled(data.enabled");
  const setErrorFailedIdx = body.indexOf('setError(body.error || "failed")');
  assert.ok(bodyReadIdx > networkBranchIdx, "networkError-tjekket skal ligge FØR kroppen læses");
  assert.ok(setEnabledIdx > networkBranchIdx, "networkError-tjekket skal ligge FØR roster-state sættes");
  assert.ok(setErrorFailedIdx > networkBranchIdx, "networkError-tjekket skal ligge FØR den generiske 'failed'-fejl sættes");
});

// De 7 skrivehandlinger der alle følger samme kontrakt: apiFetch → eksplicit
// networkError-gren (FØR data læses) → !res.ok-gren → succes.
const MUTATIONS = [
  { name: "signCandidate", start: "const signCandidate = useCallback(async (riderId) => {" },
  { name: "rejectCandidate", start: "const rejectCandidate = useCallback(async (riderId) => {" },
  { name: "resolveGraduate", start: "const resolveGraduate = useCallback(async (riderId, action," },
  { name: "promoteRider", start: "const promoteRider = useCallback(async (riderId) => {" },
  { name: "pullIntake", start: "const pullIntake = useCallback(async () => {" },
  { name: "moveRider", start: "const moveRider = useCallback(async (riderId, squad) => {" },
  { name: "releaseRider", start: "const releaseRider = useCallback(async (riderId) => {" },
];

function nextFunctionBody(source, startMarker, fromIndex = 0) {
  const start = source.indexOf(startMarker, fromIndex);
  assert.ok(start >= 0, `fandt ikke '${startMarker}'`);
  // Hver handling er sin egen useCallback — næste "}, [refresh])" (eller
  // "}, []);" for pullIntake, som ikke afhænger af refresh direkte) lukker den.
  const closeMarkers = ["}, [refresh]);", "}, []);"];
  let end = -1;
  for (const marker of closeMarkers) {
    const idx = source.indexOf(marker, start);
    if (idx >= 0 && (end === -1 || idx < end)) end = idx;
  }
  assert.ok(end > start, `fandt ikke afslutningen på '${startMarker}'`);
  return { body: source.slice(start, end), end };
}

let cursor = 0;
for (const { name, start } of MUTATIONS) {
  test(`${name}: networkError-grenen returnerer NETWORK_FAILURE FØR data læses/invalideres`, () => {
    const { body, end } = nextFunctionBody(src, start, cursor);
    cursor = end;

    const networkIdx = body.indexOf("if (res.networkError) return NETWORK_FAILURE;");
    assert.ok(networkIdx >= 0, `${name} skal returnere NETWORK_FAILURE eksplicit ved res.networkError`);

    const dataReadIdx = body.indexOf("const data = res.data || {};");
    assert.ok(dataReadIdx > networkIdx, `${name}: networkError-tjekket skal ligge FØR res.data læses`);

    // Sikkerhedsnet: falder apiFetch selv alligevel (fx en uventet exception i
    // ctx-laget), skal catch-grenen give SAMME fejl-form som NETWORK_FAILURE.
    assert.match(
      body,
      /catch \{\s*return \{ ok: false, error: "network" \};\s*\}/,
      `${name}: catch-grenen skal matche NETWORK_FAILURE-formen`,
    );
  });
}
