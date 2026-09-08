// #4943 — kildetekst-guard for spørgeskema-resultaterne. Fladen viser hver
// eneste fritekst-besvarelse med holdnavn; den må aldrig kunne læses uden
// admin-rollen, og den må aldrig kunne skrive. Samme mønster som
// valueTransitionAdminRoute.test.js (scanner route-headeren i api.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "api.js"), "utf8");

test("GET /admin/surveys/:slug/results er registreret med requireAdmin", () => {
  const m = src.match(/router\.get\("\/admin\/surveys\/:slug\/results",([^)]*)/);
  assert.ok(m, "ruten /admin/surveys/:slug/results findes i api.js");
  assert.match(m[1], /requireAdmin/);
});

test("ruten er read-only: ingen POST/PUT/PATCH/DELETE på /admin/surveys", () => {
  assert.doesNotMatch(src, /router\.(post|put|patch|delete)\("\/admin\/surveys/);
});

test("segment-parameteren valideres mod SEGMENT_DIMENSIONS, ikke sendt videre rå", () => {
  const m = src.match(/router\.get\("\/admin\/surveys\/:slug\/results"[\s\S]*?\n\}\);/);
  assert.ok(m, "route-kroppen kan læses");
  assert.match(m[0], /SEGMENT_DIMENSIONS\.includes\(req\.query\.segment\)/);
});

test("aggregeringen kommer fra den rene lib, ikke fra inline-regning i routen", () => {
  assert.match(src, /import \{ buildSurveyResults, SEGMENT_DIMENSIONS \} from "\.\.\/lib\/surveyResults\.js"/);
});
