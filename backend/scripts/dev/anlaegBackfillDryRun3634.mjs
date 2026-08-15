#!/usr/bin/env node
// backend/scripts/dev/anlaegBackfillDryRun3634.mjs
// ============================================================================
// #3634 — READ-ONLY dry-run for BACKFILL af ryttere uden anlægs-sekundær.
// Rører ALDRIG databasen. Selve kørslen er ejer-gated og findes ikke her.
//
//   infisical run --env=prod -- node scripts/dev/anlaegBackfillDryRun3634.mjs
//
// SPØRGSMÅLET
//
// Generator-fixet i #3634 lukker KILDEN: nye ryttere fødes med et fuldt anlæg.
// Det efterlader de ryttere der allerede ER født uden. Målt i prod 16/8: 72
// ryttere, alle på menneskeejede hold, alle født efter #3632-merget — og 0 helt
// uden `archetype_draw` (#3593's oprydning holder).
//
// De 72 har `archetype_draw = { primary: X, secondary: null }`. Følgen er at de
// to skrivestier er UENIGE om hvilken sekundær der former loftet:
//   derive-stien (backfillCores.js trin 3) bruger `draw.secondary ?? null`
//   motor-stien  (dailyTrainingEngine.js:314) bruger `riders.secondary_type`
// Det er præcis #3593's fund, her på en ny årgang.
//
// TO KANDIDATER (rapporten sammenligner dem — den vælger ikke)
//
//   A «frys gættet»   secondary := riders.secondary_type (klassifikatorens
//                     nuværende valg). Samme metode som #3593 brugte. Spilleren
//                     ser INGEN ændring; de to skrivestier bliver enige.
//                     Prisen: gættets skævhed fryses ind som identitet.
//   B «frisk træk»    secondary := drawSecondaryArchetype(seed=rytter-id) mod
//                     DEFAULT_DISTRIBUTION. Retter skævheden, men ÆNDRER hvad
//                     72 spillere ser på ryttere de ejer → spiller-vendt indgreb,
//                     kræver særskilt ejer-go (jf. #3631's egen afgrænsning).
//
// TRE LOFT-SÆT PR. RYTTER (buildYouthCaps = det ABSOLUTTE loft anlægget sætter)
//   i dag : buildYouthCaps(potentiale, draw.primary, null)
//   A     : buildYouthCaps(potentiale, draw.primary, secondary_type)
//   B     : buildYouthCaps(potentiale, draw.primary, friskTraek)
//
// Rapporten viser hvor mange loft-point hver kandidat flytter, og hvordan de to
// fordeler sekundær-typerne. Ingen mutation, ingen skrivning, exit 0.

import { createClient } from "@supabase/supabase-js";

import { buildYouthCaps } from "../../lib/riderProgression.js";
import { fetchAllRows } from "../../lib/supabasePagination.js";
import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { makeRng } from "../../lib/fictionalRiderGenerator.js";
import { drawSecondaryArchetype, ARCHETYPE_TYPES } from "../../lib/archetypeDistribution.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE secrets (kør via: infisical run --env=prod -- node ...)");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Deterministisk pr. rytter: seed fra UUID'ens hex, så en gentaget dry-run (og en
// senere kørsel) giver PRÆCIS samme kandidat B. Ingen Math.random.
function seedFromId(id) {
  let h = 0;
  for (const ch of String(id)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return h >>> 0;
}

const l1 = (a, b) => VISIBLE_ABILITIES.reduce((s, k) => s + Math.abs((a[k] ?? 0) - (b[k] ?? 0)), 0);
const median = (xs) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pctl = (xs, p) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[Math.floor(p * s.length)] : 0; };

// Pagineret (#3331): mængden er 72 i dag, men den er ikke bundet af noget — hele
// pointen med issuet er at den voksede med 24 i døgnet. Et utjekket select ville
// tie stille ved 1.000 og gøre rapporten forkert præcis når den betød mest.
const riders = await fetchAllRows(() => sb
  .from("riders")
  .select("id, potentiale, archetype_draw, primary_type, secondary_type, team_id, ai_team_id")
  .eq("is_retired", false)
  .not("archetype_draw->>primary", "is", null)
  .is("archetype_draw->>secondary", null)
  .order("id", { ascending: true }));
console.log(`\n=== #3634 backfill dry-run — READ-ONLY (${new Date().toISOString().slice(0, 10)}) ===`);
console.log(`Ryttere uden anlægs-sekundær: ${riders.length}`);
if (!riders.length) { console.log("Ingenting at backfille. Kilden er lukket af generator-fixet."); process.exit(0); }

const paaMenneskehold = riders.filter((r) => r.team_id).length;
const paaAiHold = riders.filter((r) => r.ai_team_id).length;
console.log(`  heraf på menneskehold: ${paaMenneskehold} · på AI-hold: ${paaAiHold} · frie: ${riders.length - paaMenneskehold - paaAiHold}`);

const fordelingA = {};
const fordelingB = {};
const deltaA = [];
const deltaB = [];
let uenigeAB = 0;
let primaerAfvigerFraDraw = 0;

for (const r of riders) {
  const primary = r.archetype_draw?.primary;
  if (r.primary_type && r.primary_type !== primary) primaerAfvigerFraDraw++;

  // Kandidat A: klassifikatorens nuværende sekundær. Er den tom eller = primær,
  // findes der intet gæt at fryse — så falder A tilbage på B for netop den rytter.
  const gaet = (r.secondary_type && r.secondary_type !== primary) ? r.secondary_type : null;
  const frisk = drawSecondaryArchetype(makeRng(seedFromId(r.id)), primary);
  const a = gaet ?? frisk;
  const b = frisk;

  fordelingA[a] = (fordelingA[a] || 0) + 1;
  fordelingB[b] = (fordelingB[b] || 0) + 1;
  if (a !== b) uenigeAB++;

  const iDag = buildYouthCaps(r.potentiale, primary, null);
  deltaA.push(l1(buildYouthCaps(r.potentiale, primary, a), iDag));
  deltaB.push(l1(buildYouthCaps(r.potentiale, primary, b), iDag));
}

console.log(`  primary_type der afviger fra draw.primary: ${primaerAfvigerFraDraw} (forventet 0 — primæren er allerede forankret)`);
console.log(`  A og B ville vælge FORSKELLIG sekundær for ${uenigeAB}/${riders.length} ryttere`);

console.log("\n── Loft-flytning mod i dag (L1 over 15 evner, absolutte anlægs-lofter) ──");
console.log(`${"kandidat".padEnd(24)} | ${"median".padStart(7)} | ${"p90".padStart(7)} | ${"max".padStart(7)} | uændrede`);
console.log("-".repeat(70));
for (const [navn, d] of [["A frys gættet", deltaA], ["B frisk træk", deltaB]]) {
  console.log(
    `${navn.padEnd(24)} | ${String(median(d)).padStart(7)} | ${String(pctl(d, 0.9)).padStart(7)} | ` +
    `${String(Math.max(...d)).padStart(7)} | ${d.filter((x) => x === 0).length}`,
  );
}

console.log("\n── Sekundær-fordeling de to kandidater ville give ──");
console.log(`${"type".padEnd(16)} | ${"A frys %".padStart(8)} | ${"B frisk %".padStart(9)} | mål (DEFAULT_DISTRIBUTION)`);
console.log("-".repeat(72));
const { DEFAULT_DISTRIBUTION } = await import("../../lib/archetypeDistribution.js");
for (const t of ARCHETYPE_TYPES) {
  const pa = (100 * (fordelingA[t] || 0)) / riders.length;
  const pb = (100 * (fordelingB[t] || 0)) / riders.length;
  console.log(`${t.padEnd(16)} | ${pa.toFixed(1).padStart(8)} | ${pb.toFixed(1).padStart(9)} | ${DEFAULT_DISTRIBUTION[t].toFixed(2)}`);
}

const l1A = ARCHETYPE_TYPES.reduce((s, t) => s + Math.abs((100 * (fordelingA[t] || 0)) / riders.length - DEFAULT_DISTRIBUTION[t]), 0);
const l1B = ARCHETYPE_TYPES.reduce((s, t) => s + Math.abs((100 * (fordelingB[t] || 0)) / riders.length - DEFAULT_DISTRIBUTION[t]), 0);
console.log(`\n  L1 mod DEFAULT_DISTRIBUTION:  A ${l1A.toFixed(1)} pp  ·  B ${l1B.toFixed(1)} pp`);
console.log(
  "\nLæsning: A ændrer intet spilleren SER (samme sekundære type som i dag) men gør de to\n" +
  "skrivestier enige og stopper driften. B retter også fordelingen, men skifter den synlige\n" +
  "sekundære type på ryttere spillere ejer — et spiller-vendt indgreb med sit eget ejer-go.\n" +
  "BEGGE flytter loftet, fordi en forankret sekundær vejer 0,82 hvor 'ingen sekundær' vejer 0,45.\n" +
  "Dry-run. Ingen skrivning. Kørslen er ejer-gated.\n",
);
