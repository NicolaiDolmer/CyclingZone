import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// #5291: /api/races/distribution svarede HTTP 200 med en HTML-side (SPA-
// fallback), formentlig fordi API-basen var tom i klienten — kaldet ramte da
// frontend'ens egen vært i stedet for backend'en. RaceHubBoard's load() kastede
// en rå SyntaxError ved parsning i stedet for at fejle tydeligt.
//
// Ingen jsdom i denne kodebase (se silentFailureContract.4165.test.js), så
// selve komponent-wiringen pin'es som kildekode-guards her — den ægte
// klassifikations-LOGIK (Content-Type → JSON eller ej) er dækket af en rigtig
// unit-test med et mock fetch-svar i raceHubResponseGuard.test.ts.
const source = readFileSync(new URL("./RaceHubBoard.jsx", import.meta.url), "utf8");

test("load(): en tom API-base fejler tydeligt i stedet for at ramme et relativt path", () => {
  // Uden denne vagt bygger `${API}/api/races/distribution` til bare
  // "/api/races/distribution" når VITE_API_URL er tom — et relativt fetch der
  // rammer frontend'ens egen vært og får index.html tilbage (SPA-fallback).
  assert.match(source, /if \(!API\) \{/);
  const guardIdx = source.indexOf("if (!API) {");
  const urlIdx = source.indexOf("const url = `${API}/api/races/distribution`;");
  assert.ok(guardIdx > 0 && urlIdx > 0, "både API-guard og url-opbygning skal findes");
  assert.ok(guardIdx < urlIdx, "API-guarden skal ligge FØR url'en bygges, ellers rammer den aldrig");
  const guardBranch = source.slice(guardIdx, urlIdx);
  assert.match(guardBranch, /setLoadError\(\{ kind: "config" \}\)/);
  assert.match(guardBranch, /reportLoadFailure\("racehub_board", \{ kind: "config" \}\)/);
  assert.match(guardBranch, /setLoading\(false\);\s*\n\s*return;/, "guarden skal stoppe spinneren og returnere, ikke falde igennem til fetch");
});

test("load(): Content-Type tjekkes FØR res.json(), så en HTML-200 rammer parse-grenen direkte", () => {
  assert.match(
    source,
    /import \{ isJsonContentType, responseContentType \} from "\.\.\/\.\.\/lib\/raceHubResponseGuard\.ts"/,
  );
  const okIdx = source.indexOf("if (!res.ok) {");
  const jsonTryIdx = source.indexOf("let json;");
  assert.ok(okIdx > 0 && jsonTryIdx > 0);
  const branch = source.slice(okIdx, jsonTryIdx);
  assert.match(branch, /const contentType = responseContentType\(res\);/);
  assert.match(branch, /if \(!isJsonContentType\(res\)\) \{/);
  assert.match(branch, /setLoadError\(\{ kind: "parse", status: res\.status \}\)/);
  // Content-Type skal med i telemetrien (diagnose uden at gætte), ikke kun i UI'et.
  assert.match(
    branch,
    /reportLoadFailure\("racehub_board", \{ kind: "parse", status: res\.status, context: \{ contentType \} \}\)/,
  );
});

test("load(): JSON.parse-fejl (2xx men ugyldig JSON) rapporterer også content-type", () => {
  assert.match(
    source,
    /reportLoadFailure\("racehub_board", \{ kind: "parse", status: res\.status, cause, context: \{ contentType \} \}\)/,
  );
});

test("render: parse-kind viser den spillervendte 'genindlæs siden'-besked, ikke kun den generiske krops-tekst", () => {
  assert.match(source, /loadError\.kind === "parse" \? t\("racehub\.error\.parse"\)/);
});

test("i18n: racehub.error.parse findes i BEGGE sprog og er ikke identisk", () => {
  const en = JSON.parse(readFileSync(new URL("../../../public/locales/en/races.json", import.meta.url), "utf8"));
  const da = JSON.parse(readFileSync(new URL("../../../public/locales/da/races.json", import.meta.url), "utf8"));
  assert.ok(en.racehub.error.parse, "en mangler racehub.error.parse");
  assert.ok(da.racehub.error.parse, "da mangler racehub.error.parse");
  assert.notEqual(en.racehub.error.parse, da.racehub.error.parse);
  assert.equal(en.racehub.error.parse, "The race board could not be loaded. Please reload the page.");
  assert.equal(da.racehub.error.parse, "Løbstavlen kunne ikke hentes. Genindlæs siden.");
});
