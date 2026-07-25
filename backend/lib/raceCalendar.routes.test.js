import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #2861 — perf-invarianter for GET /api/races/calendar.
//
// Kilde-scan (samme mønster som riderPeakPlans.routes.test.js / boardBankGuard):
// låser de tre strukturelle fix så en regression fanges uden en live server.
// Baggrund: kalenderen sendte hele sæsonens race-ids til `.in("race_id", raceIds)`.
// 423 løb (S1) / 455 løb (S2) × 36-tegns UUID gav en ~16 KB GET-URL, som PostgREST-
// kanten afviser → undici "TypeError: fetch failed" EFTER ~7,9 s. Fejlen blev slugt
// (ingen error-check), så kalenderen brændte ~7,9 s pr. load OG satte entered/
// leaderSet tavst til false. Præcis samme klasse som #2516 (Sentry CYCLINGZONE-33).

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function calendarHandler() {
  const idx = apiSource.indexOf('router.get("/races/calendar"');
  assert.ok(idx !== -1, 'GET /races/calendar skal findes');
  const next = apiSource.indexOf("\nrouter.", idx + 1);
  return apiSource.slice(idx, next === -1 ? idx + 6000 : next);
}

function entryLoader() {
  const idx = apiSource.indexOf("async function fetchTeamSeasonRaceEntries");
  assert.ok(idx !== -1, "fetchTeamSeasonRaceEntries skal findes");
  return apiSource.slice(idx, apiSource.indexOf("\n}", idx) + 2);
}

test("kalenderen sender ALDRIG hele sæsonens race-id-liste i en .in()-filter (URL-overflow, #2861/#2516)", () => {
  const block = calendarHandler();
  assert.doesNotMatch(
    block,
    /\.in\(\s*["']race_id["']\s*,\s*raceIds\s*\)/,
    "en usegmenteret .in(\"race_id\", raceIds) med 400+ UUID'er giver en ~16 KB GET-URL → undici fetch failed efter ~8 s",
  );
  assert.doesNotMatch(
    block,
    /\.in\(\s*["']id["']\s*,\s*raceIds\s*\)/,
    "samme klasse: hele sæsonens id-liste må ikke lægges i en query-streng",
  );
});

test("holdets entries hentes sæson-scopet via inner-join, ikke via id-liste (#2861)", () => {
  const loader = entryLoader();
  assert.match(loader, /races!inner\(\)/, "relationen bruges som filter uden at hente løbs-kolonner med");
  assert.match(loader, /\.eq\(\s*["']races\.season_id["']\s*,\s*seasonId\s*\)/, "filteret er sæsonen, ikke en id-liste");
  assert.match(loader, /\.eq\(\s*["']team_id["']\s*,\s*teamId\s*\)/, "service-role bypasser RLS → team_id skal gentages eksplicit");
});

test("entry-loadet KASTER ved fejl i stedet for tavst at droppe mit-hold-flagene (#2861)", () => {
  const loader = entryLoader();
  assert.match(
    loader,
    /const \{ data, error \} = await supabase[\s\S]{0,400}if \(error\) throw new Error/,
    "en slugt fejl her satte entered/leaderSet tavst til false for alle hold",
  );
});

test("entry-loadet er range-pagineret med stabil sortering (PostgREST 1000-cap, #1798-klassen)", () => {
  const loader = entryLoader();
  assert.match(loader, /\.range\(\s*from\s*,\s*from \+ PAGE - 1\s*\)/, "et holds entries = ryttere × løb og nærmer sig 1000-caps");
  assert.match(loader, /\.order\(\s*["']race_id["']/, "pagination uden ORDER BY kan gentage/springe rækker over");
});

test("kalenderens uafhængige opslag køres parallelt, ikke i serie (#2861)", () => {
  const block = calendarHandler();
  const waves = block.match(/await Promise\.all\(\[/g) || [];
  assert.ok(waves.length >= 3, `kalenderen skal bruge 3 parallelle bølger, fandt ${waves.length}`);
  // Bølge 1 skal indeholde både sæson-listen og divisions-træet — de afhænger ikke
  // af sæson-opslaget og kostede før hver sin sekventielle round-trip.
  const wave1 = block.slice(block.indexOf("await Promise.all(["), block.indexOf("]);"));
  assert.match(wave1, /league_divisions/, "divisions-træet afhænger ikke af sæsonen og hører i første bølge");
});

test("kalenderen er response-cached per hold og trimmer payloaden til wire-formatet (#2861)", () => {
  const block = calendarHandler();
  assert.match(block, /cached\(\{[\s\S]{0,200}namespace:\s*["']calendar["']/, "kalenderen skal ligge i response-cachen");
  assert.match(block, /keyExtras:\s*\(req\)\s*=>[\s\S]{0,80}req\.team\?\.id/, "cachen skal scopes per hold — isMine/leaderSet er hold-specifikke");
  assert.match(block, /entries:\s*model\.entries\.map\(toCalendarWireEntry\)/, "kun de felter klienten læser må sendes");
  assert.doesNotMatch(block, /\.\.\.model,/, "spread af hele read-modellen sender 67-73 kB døde felter med");
});

test("hver race-muterende invalidering rammer også kalender-cachen (#2861)", () => {
  const racesHits = (apiSource.match(/invalidateNamespace\("races"\)/g) || []).length;
  const calendarHits = (apiSource.match(/invalidateNamespace\("calendar"\)/g) || []).length;
  assert.ok(racesHits > 0, "der skal findes race-invalideringer at spejle");
  assert.equal(
    calendarHits,
    racesHits,
    "et løb der ændrer sig ændrer kalenderen — hver invalidateNamespace(\"races\") skal have en \"calendar\"-makker",
  );
});
