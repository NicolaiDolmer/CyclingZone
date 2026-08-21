import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #4009 (ejer-ja 20/8): akademi-ryttere kunne hidtil KUN forlade akademiet via
// graduerings-vinduet (academy/graduate, kun ryttere ≥22 med en pending
// academy_graduation-row). Workaround var promote-til-senior → fyr, hvilket
// midlertidigt brugte en senior-plads for en rytter manageren slet ikke ville
// beholde. Denne testfil beviser (samme statiske source-contract-stil som
// riderActionsRoutes.test.js) at:
//   GET  /api/riders/:id/academy-release-quote — preview af buyout-gebyret
//   POST /api/riders/:id/academy-release        — udfør fyringen
// findes med de rigtige guards og kalder de rigtige delte helpers, UDEN at
// booте hele Express-stakken.

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function routeBlock(method, routePath) {
  const marker = `router.${method}("${routePath}"`;
  const start = apiSource.indexOf(marker);
  assert.notEqual(start, -1, `route ${method.toUpperCase()} ${routePath} findes ikke i api.js`);
  const end = apiSource.indexOf("\nrouter.", start + marker.length);
  return apiSource.slice(start, end === -1 ? start + 4000 : end);
}

function helperBlock(name) {
  const marker = `async function ${name}(`;
  const start = apiSource.indexOf(marker);
  assert.notEqual(start, -1, `helper ${name} findes ikke i api.js`);
  const end = apiSource.indexOf("\n}\n", start);
  return apiSource.slice(start, end === -1 ? start + 1500 : end);
}

test("loadOwnedAcademyRiderForAction guarder owner, retired og KRÆVER is_academy=true", () => {
  const block = helperBlock("loadOwnedAcademyRiderForAction");
  assert.match(block, /rider\.team_id !== req\.team\.id/, "guard skal owner-check'e team_id === req.team.id");
  assert.match(block, /is_retired/, "guard skal afvise pensionerede ryttere");
  assert.match(block, /!rider\.is_academy/, "guard skal kræve is_academy=true (modsat senior-guarden)");
});

test("GET /riders/:id/academy-release-quote findes med requireAuth + bruger academi-guarden + computeReleaseBuyoutFee", () => {
  const block = routeBlock("get", "/riders/:id/academy-release-quote");
  assert.match(block, /requireAuth/, "academy-release-quote skal bruge requireAuth");
  assert.match(block, /loadOwnedAcademyRiderForAction/, "academy-release-quote skal bruge den delte akademi-guard");
  assert.match(block, /computeReleaseBuyoutFee/, "academy-release-quote skal bruge SAMME gebyr-formel som senior-release");
});

test("POST /riders/:id/academy-release findes med requireAuth + marketWriteLimiter + akademi-guarden", () => {
  const block = routeBlock("post", "/riders/:id/academy-release");
  assert.match(block, /requireAuth/, "academy-release skal bruge requireAuth");
  assert.match(block, /marketWriteLimiter/, "academy-release skal bruge marketWriteLimiter");
  assert.match(block, /loadOwnedAcademyRiderForAction/, "academy-release skal bruge den delte akademi-guard");
});

test("POST /riders/:id/academy-release beregner gebyret via computeReleaseBuyoutFee + blokerer ved manglende balance", () => {
  const block = routeBlock("post", "/riders/:id/academy-release");
  assert.match(block, /computeReleaseBuyoutFee/, "academy-release skal bruge computeReleaseBuyoutFee-helperen");
  assert.match(block, /cannot_afford_release/, "academy-release skal blokere ved utilstrækkelig balance med samme fejlkode som senior-release");
  assert.match(block, /incrementBalanceWithAudit/, "academy-release skal bogføre gebyret via incrementBalanceWithAudit");
  assert.match(block, /team_id: null/, "academy-release skal sætte team_id = NULL");
  assert.match(block, /is_academy: false/, "academy-release skal sætte is_academy = false (rytteren er ikke længere i akademiet)");
  assert.match(block, /salary: null/, "academy-release skal nulstille salary");
});

// #3963/#4048-bevidst: en akademi-rytter der er sat på en graduerings-salgs-
// auktion (academy/graduate action=sell) forbliver is_academy=true indtil
// auktionens finalization. #4048 (merget 20/8, lige før denne PR) tilføjede
// assertRiderNotOnActiveAuction til senior-release/-release-quote efter en
// tilsvarende fantom-selv-byder-bug — samme delte guard genbruges her i
// stedet for at duplikere logikken. Se PR-beskrivelsen for #3963/#4033-vurderingen.
test("GET/POST /riders/:id/academy-release(-quote) genbruger den delte #3963/#4048-auktions-guard", () => {
  const quoteBlock = routeBlock("get", "/riders/:id/academy-release-quote");
  assert.match(quoteBlock, /assertRiderNotOnActiveAuction/, "academy-release-quote skal afvise en rytter med en aktiv auktion");
  const postBlock = routeBlock("post", "/riders/:id/academy-release");
  assert.match(postBlock, /assertRiderNotOnActiveAuction/, "academy-release skal afvise en rytter med en aktiv auktion");
});
