#!/usr/bin/env node
// #3570 — måler om løkken type → ability_caps → type er BRUDT af den faste identitet.
//
// Baggrund (ejer-beslutning 10/8): klassifikationen var et lukket kredsløb.
// dailyTrainingEngine.js bygger ability_caps ud fra den PERSISTEREDE type hvert tick,
// og riderValueRefresh.js udleder typen igen af netop de caps hver nat (trainingSweep).
// Kritikeren målte 9/8 at de menneske-ejede ryttere konvergerer til baroudeur 53,5 % /
// puncheur 0,2 % mod ejer-målene 11 % / 13 % — stort set uafhængigt af hvilke
// RIDER_TYPES-vægte der shippes.
//
// Denne harness kører ÉN "nat" som: caps = buildCapsForRider(abilities, ..., type)
// derefter type = <klassifikator eller identitet>(caps). Live evner holdes FASTE
// (samme metode som kritikeren) — det gør tallene til en ØVRE grænse for driften,
// fordi ægte evne-vækst hæver gulvet og dæmper bevægelsen.
//
// To arme:
//   FØR   — computeRiderTypes(caps): dagens produktion
//   EFTER — resolveRiderTypes(draw, caps): rytteren bærer en fast identitet
//
// Identiteten for de EKSISTERENDE ryttere er deres label efter ÉN sidste
// klassifikation (= #3570-reparationen). Det er præcis den kontrakt reparationen
// skal skrive: klassificér en gang, frys derefter.
//
// INGEN mutation. Læser et dateret snapshot, skriver kun til scratchpad.
//   node scripts/dev/loopFixpoint3570.mjs [--runder=10] [--snapshot=<sti>]

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { buildCapsForRider } from "../../lib/riderProgression.js";
import { computeRiderTypes, resolveRiderTypes, RIDER_TYPE_KEYS } from "../../lib/riderTypes.js";
import { selectTypesBaseline } from "../../lib/riderTypesBaselineSelect.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || `--${n}=${d}`).split("=").slice(1).join("=");

const RUNDER = parseInt(arg("runder", "10"), 10);
const SNAPSHOT = arg(
  "snapshot",
  "C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/5ea4d8d3-1258-4104-a2c6-9f902b84d615/scratchpad/snap-3570-reclass/youth_16_21_full.json",
);

const adultBaseline = JSON.parse(readFileSync(join(__dirname, "../../lib/riderTypesBaseline.json"), "utf8"));
const youthBaseline = JSON.parse(readFileSync(join(__dirname, "../../lib/riderTypesBaselineYouth.json"), "utf8"));
const riders = JSON.parse(readFileSync(SNAPSHOT, "utf8"));

// Ejerens knaphedsmål (samme tabel som scorecard3570Phase2.mjs).
const MAAL = { sprinter: 15, tt: 9, climber: 17, puncheur: 13, brostensrytter: 9, baroudeur: 11, rouleur: 17, gc: 9 };

const pct = (n, tot) => (tot ? (n / tot) * 100 : 0);

function fordeling(typer) {
  const t = Object.fromEntries(RIDER_TYPE_KEYS.map((k) => [k, 0]));
  for (const k of typer) t[k] = (t[k] || 0) + 1;
  return Object.fromEntries(RIDER_TYPE_KEYS.map((k) => [k, pct(t[k], typer.length)]));
}
const afvigelse = (d) => RIDER_TYPE_KEYS.reduce((s, k) => s + Math.abs(d[k] - MAAL[k]), 0);

// Én rytter gennem N nætter. `identitet` = null ⇒ FØR-armen (klassificér hver nat).
function koer(r, identitet, runder) {
  const evner = {};
  for (const k of VISIBLE_ABILITIES) if (r.abilities?.[k] != null) evner[k] = Number(r.abilities[k]);
  const model = selectTypesBaseline(r.age, adultBaseline, youthBaseline);

  let primary = r.primary_type;
  let secondary = r.secondary_type;
  const spor = [];
  for (let i = 0; i < runder; i++) {
    const caps = buildCapsForRider(evner, { potentiale: r.potentiale, age: r.age }, primary, secondary);
    const t = identitet ? resolveRiderTypes(identitet, caps, model) : computeRiderTypes(caps, model);
    primary = t.primary.key;
    secondary = t.secondary.key;
    spor.push(primary);
  }
  return spor;
}

// Reparationen: ÉN sidste klassifikation mod de EKSISTERENDE caps — det er den
// identitet rytteren får skrevet, og som derefter står fast.
function reparationsLabel(r) {
  const model = selectTypesBaseline(r.age, adultBaseline, youthBaseline);
  const t = computeRiderTypes(r.ability_caps || {}, model);
  return { primary: t.primary.key, secondary: null, isHybrid: false };
}

const grupper = {
  alle: riders,
  human: riders.filter((r) => r.owner_kind === "human"),
};

const rapport = {};
for (const [navn, pop] of Object.entries(grupper)) {
  const foer = pop.map((r) => koer(r, null, RUNDER));
  const identiteter = pop.map(reparationsLabel);
  const efter = pop.map((r, i) => koer(r, identiteter[i], RUNDER));

  const foerRunde1 = fordeling(foer.map((s) => s[0]));
  const foerFiks = fordeling(foer.map((s) => s[s.length - 1]));
  const efterRunde1 = fordeling(efter.map((s) => s[0]));
  const efterFiks = fordeling(efter.map((s) => s[s.length - 1]));

  // Ustabilitet: hvor mange ryttere skifter type EFTER runde 1?
  const drift = (spor) => spor.filter((s) => s.slice(1).some((k) => k !== s[0])).length;

  rapport[navn] = {
    n: pop.length,
    foer: { runde1: foerRunde1, fikspunkt: foerFiks, afvigelseRunde1: afvigelse(foerRunde1), afvigelseFikspunkt: afvigelse(foerFiks), driftende: drift(foer) },
    efter: { runde1: efterRunde1, fikspunkt: efterFiks, afvigelseRunde1: afvigelse(efterRunde1), afvigelseFikspunkt: afvigelse(efterFiks), driftende: drift(efter) },
  };
}

const linje = (d) => RIDER_TYPE_KEYS.map((k) => `${k.slice(0, 4)} ${d[k].toFixed(1)}`).join(" · ");

console.log(`\n=== #3570 løkke-fikspunkt (${RUNDER} nætter, live evner faste = øvre grænse for drift) ===`);
for (const [navn, r] of Object.entries(rapport)) {
  console.log(`\n── ${navn.toUpperCase()} (n=${r.n}) ──`);
  console.log("FØR  (klassificér hver nat — dagens produktion)");
  console.log(`  runde 1     ${linje(r.foer.runde1)}`);
  console.log(`  fikspunkt   ${linje(r.foer.fikspunkt)}`);
  console.log(`  Σ afvigelse fra mål: ${r.foer.afvigelseRunde1.toFixed(1)} → ${r.foer.afvigelseFikspunkt.toFixed(1)} pp`);
  console.log(`  ryttere der driver efter runde 1: ${r.foer.driftende} (${pct(r.foer.driftende, r.n).toFixed(1)} %)`);
  console.log("EFTER (fast identitet)");
  console.log(`  runde 1     ${linje(r.efter.runde1)}`);
  console.log(`  fikspunkt   ${linje(r.efter.fikspunkt)}`);
  console.log(`  Σ afvigelse fra mål: ${r.efter.afvigelseRunde1.toFixed(1)} → ${r.efter.afvigelseFikspunkt.toFixed(1)} pp`);
  console.log(`  ryttere der driver efter runde 1: ${r.efter.driftende} (${pct(r.efter.driftende, r.n).toFixed(1)} %)`);
}

const ud = join(__dirname, "loopFixpoint3570.out.json");
writeFileSync(ud, JSON.stringify({ snapshot: SNAPSHOT, runder: RUNDER, maal: MAAL, rapport }, null, 2));
console.log(`\nRådata: ${ud}`);

// Porten: EFTER-armen må ikke have DRIFT. Identiteten skal stå fast pr. konstruktion.
const brud = Object.entries(rapport).filter(([, r]) => r.efter.driftende > 0);
if (brud.length) {
  console.log(`\n✗ PORT FEJLER: identiteten driver stadig for ${brud.map(([n, r]) => `${n}: ${r.efter.driftende}`).join(", ")}`);
  process.exit(1);
}
console.log("\n✓ PORT: 0 ryttere driver med fast identitet — løkken er brudt.");
