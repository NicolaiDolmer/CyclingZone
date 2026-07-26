import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #2863 — sæsonens bedste ryttere er ADDITIV til /seasons.
//
// Hvorfor det er en guard og ikke bare en kodegennemgang: season_ended-
// notifikationen deep-linker alle menneske-managere til præcis denne side i
// minutterne efter sæsonskiftet. Blokkens RPC applies EFTER merge, så der
// findes et vindue hvor funktionen ikke findes. Falder blokken ind i sidens
// fælles fejl-sti, mister ~150 managere slutstilling, kalender og
// pointudvikling for at vise en blok der endnu ikke er slået til.
//
// node --test uden DOM → kildekode-strukturel guard, samme mønster som
// SeasonEndPage.recapAggregate.test.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(__dirname, "SeasonEndPage.jsx"), "utf8");

// Mål KODEN, ikke prosaen: kommentarerne i filen beskriver med vilje de mønstre
// vi forbyder, og en naiv regex over råteksten ville fejle på dokumentationen.
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

test("#2863 siden henter listerne via get_season_honours(p_season_id)", () => {
  assert.match(
    code,
    /\.rpc\(\s*["'`]get_season_honours["'`]\s*,\s*\{\s*p_season_id:/,
    "listerne skal komme fra RPC'en, ikke fra en klient-side aggregering",
  );
});

test("#2863 blokken læser ALDRIG rå race_results eller rider_rankings_mv til klienten", () => {
  // Den klient-side vej (som /rider-rankings bruger) er 5.736 mv-rækker + hele
  // riders-tabellen i pagineret form. På DENNE side, med ~150 samtidige
  // managere ved cutover, er det præcis den fælde #2891 lige har lukket.
  assert.doesNotMatch(code, /from\(\s*["'`]rider_rankings_mv["'`]\s*\)/);
  assert.doesNotMatch(code, /from\(\s*["'`]race_results["'`]\s*\)/);
  assert.doesNotMatch(code, /fetchAllRows\s*\(/);
});

test("#2863 en manglende migration skjuler blokken, den fejler ikke siden", () => {
  assert.ok(
    code.includes("isMissingFunctionError"),
    "PGRST202 skal genkendes, så blokken udelades indtil RPC'en er applied",
  );
  assert.match(
    code,
    /status:\s*["'`]unavailable["'`]/,
    "der skal findes en eksplicit 'ikke deployet endnu'-tilstand",
  );
});

test("#2863 blokkens fejl går ALDRIG i sidens fælles error-state", () => {
  // setError({type:"season"}) river hele siden ned til ErrorState. Blokken har
  // sin egen state (setHonours) netop for ikke at kunne gøre det.
  const loadHonours = code.slice(
    code.indexOf("const loadHonours"),
    code.indexOf("const loadSeason"),
  );
  assert.ok(loadHonours.length > 0, "loadHonours skal ligge før loadSeason");
  assert.ok(loadHonours.includes("get_season_honours"), "udsnittet skal dække selve kaldet");
  assert.doesNotMatch(
    loadHonours,
    /setError\s*\(/,
    "blokken må ikke kunne sætte sidens fælles fejl-tilstand",
  );
  assert.match(loadHonours, /setHonours\(\s*\{\s*status:\s*["'`]failed["'`]/);
});

test("#2863 en ægte RPC-fejl bliver SET, den sluges ikke til en tom liste", () => {
  // #1851-klassen: en tom liste der ser bevidst ud er værre end en synlig fejl.
  assert.match(
    code,
    /console\.error\([\s\S]{0,80}get_season_honours/,
    "fejlen skal logges",
  );
  assert.match(
    code,
    /failed=\{honours\.status === ["'`]failed["'`]\}/,
    "fejl-tilstanden skal nå frem til komponenten",
  );
});

test("#2863 blokken er provisional så længe sæsonen ikke er completed", () => {
  // `Foreløbig`-chippen er det ENESTE der siger om tallene kan flytte sig endnu
  // (labels er ens før og efter, fordi "flest point" er lige sandt begge steder).
  // Den skal afgøres af sæsonens EGEN status, ikke af om der tilfældigvis er data
  // — ellers ville en fuldt talt sæson og en halvspillet se identiske ud.
  assert.match(
    code,
    /provisional=\{selectedSeason\?\.status !== ["'`]completed["'`]\}/,
  );
});

test("#2863 guarden kan stadig fejle (kommentar-strippen æder ikke koden)", () => {
  const mutated = code + '\nconst x = await fetchAllRows(() => supabase.from("rider_rankings_mv"));\n';
  assert.match(mutated, /fetchAllRows\s*\(/);
  assert.match(mutated, /from\(\s*["'`]rider_rankings_mv["'`]\s*\)/);
  assert.ok(code.includes("get_season_honours"), "strippen må ikke have ædt selve RPC-kaldet");
});
