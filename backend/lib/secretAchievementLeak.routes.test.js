import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #1666 — forward-guard mod spoiler-lækage af hemmelige achievements i backend-API'et.
//
// GET /api/managers/:teamId selecter `*` fra achievements (service_role ser alt) og
// SKAL derfor redaktere title/description for låste, hemmelige achievements før
// res.json. Ellers ligger den rå tekst i payloaden (DevTools → Network) og kan
// spoile uoplåste secrets, selvom frontend masker dem visuelt med "???".
//
// Scanner routes/api.js som kildetekst (samme mønster som potentialeHiding.routes.test.js)
// så en regression fanges uden at kræve en live DB.

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

// Isolér achievements-mappingen i GET /api/managers/:teamId.
const achBlock = (() => {
  const start = apiSource.indexOf("const achievements = (allAchsRes.data || []).map");
  assert.ok(start !== -1, "achievements-mappingen i /managers/:teamId skal findes");
  const end = apiSource.indexOf("});", start);
  assert.ok(end !== -1, "achievements-mappingen skal afsluttes");
  return apiSource.slice(start, end);
})();

test("managers-profil redakterer hemmelige låste achievements' title (#1666)", () => {
  assert.match(
    achBlock,
    /title:\s*hideSecret\s*\?\s*null\s*:\s*a\.title/,
    "title skal sættes til null når achievement er hemmelig og låst",
  );
});

test("managers-profil redakterer hemmelige låste achievements' description (#1666)", () => {
  assert.match(
    achBlock,
    /description:\s*hideSecret\s*\?\s*null\s*:\s*a\.description/,
    "description skal sættes til null når achievement er hemmelig og låst",
  );
});

test("hideSecret gælder kun uoplåste, hemmelige achievements (#1666)", () => {
  assert.match(
    achBlock,
    /const hideSecret\s*=\s*!unlocked\s*&&\s*a\.is_secret/,
    "hideSecret skal være (ikke-oplåst OG hemmelig)",
  );
});
