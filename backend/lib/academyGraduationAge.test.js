import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ageForSeason } from "./riderSeasonAge.js";

// #5943: Graduation Day viste alder 16 for 19-aarige. /api/academy/me regnede
// graduate-alderen paa wall-clock (kalenderaar minus foedselsaar), mens resten af
// spillet bruger saeson-alderen (riderSeasonAge.js). Kildetekst-vagt (samme moenster
// som potentialeHiding.routes.test.js) + en adfaerdstest af SSOT'en.
const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

test("GET /academy/me regner graduate-alder som saeson-alder, ikke wall-clock (#5943)", () => {
  const block = apiSource.slice(apiSource.indexOf("const graduations = (gradRows ?? []).map"));
  const mapBody = block.slice(0, block.indexOf("return {"));
  assert.match(mapBody, /ageForSeason\(r\.birthdate, graduationSeasonNumber\)/);
  assert.doesNotMatch(mapBody, /currentYear/);
  assert.match(apiSource, /const graduationSeasonNumber = await getActiveSeasonNumber\(\);/);
});

test("saeson-alder foelger saesonen: samme rytter er aeldre i en senere saeson", () => {
  assert.equal(ageForSeason("2007-05-01", 1), 19);
  assert.equal(ageForSeason("2007-05-01", 4), 22);
  assert.equal(ageForSeason("2007-05-01", null), null);
});
