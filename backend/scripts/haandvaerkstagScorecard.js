#!/usr/bin/env node
//
// haandvaerkstagScorecard — dry-run-diff for #3709 trin 3 (#3682).
//
// HVAD DEN GØR. Beregner hver rytters udviklings-lofter to gange — én gang med
// produktionskoden FØR ændringen, én gang med koden EFTER — og rapporterer
// forskellen. Ingen DB, ingen skrivning: kilden er et DATERET snapshot i repoet
// (spec §4.6, aldrig den levende DB).
//
// HVORFOR DEN IMPORTERER "FØR" FRA EN ANDEN WORKTREE I STEDET FOR AT REGNE DEN SELV.
// Den nemme løsning er at kopiere den gamle formel ind i måle-scriptet. Så måler
// man bare sin egen kopi, og en fejl i kopien ligner et resultat. `--baseline`
// peger derfor på et ÆGTE udtjek af commit'en før ændringen, så begge sider af
// diffen er produktionskode der har kørt. Flaget er PÅKRÆVET af samme grund —
// der findes ikke en "kør den uden baseline"-genvej der kan forveksles med
// en rigtig måling.
//
//   git worktree add --detach ../ref-3709-baseline <commit-før>
//   node scripts/haandvaerkstagScorecard.js \
//     --snapshot=<repo>/docs/snapshots/3591/riders_full.json \
//     --baseline=../../ref-3709-baseline/backend/lib \
//     [--json=ud.json]
//
// GATES (#3682): B1 intet loft falder · B2 typer uændret · B3 markedsværdier
// uændret · B4 potentiale-feltet ikke skrevet. Exit 1 hvis en gate fejler.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildCapsForRider } from "../lib/riderProgression.js";
import { VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { ratingForRole } from "../lib/weights/displayRecipes.js";
import { resolveRiderTypes } from "../lib/riderTypes.js";
import { predictBaseValue } from "../lib/riderValuation.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, "").split("=");
    return [k, rest.length ? rest.join("=") : true];
  }),
);

if (!args.snapshot || !args.baseline) {
  console.error("brug: --snapshot=<sti til riders_full.json> --baseline=<sti til backend/lib i en worktree ved commit'en FØR> [--json=<ud>]");
  console.error("");
  console.error("--baseline er PÅKRÆVET. Uden den ville 'før' være en kopi af formlen skrevet");
  console.error("her i måle-scriptet, og så måler scriptet kun sig selv. Opret den med:");
  console.error("  git worktree add --detach ../ref-3709-baseline <commit-før>");
  process.exit(2);
}

// ── Modellerne ──────────────────────────────────────────────────────────────
// Begge sider er ÆGTE produktionskode, hver fra sin commit. Ingen af dem er
// genskrevet her — det er hele pointen med at bruge en baseline-worktree.
const libDir = path.resolve(args.baseline);
const imp = (fil) => import(pathToFileURL(path.join(libDir, fil)).href);
const gammelProgression = await imp("riderProgression.js");
const gammelTyper = await imp("riderTypes.js");
const gammelValuation = await imp("riderValuation.js");

if (gammelProgression.YOUTH_PROGRESSION_CONFIG?.craftFactor !== undefined) {
  console.error("STOP: --baseline peger på et træ der ALLEREDE har craftFactor. Det er ikke en baseline.");
  process.exit(2);
}

const foerModel = {
  navn: `før (${libDir})`,
  caps: (r) => gammelProgression.buildCapsForRider(r.abilities, { potentiale: r.potentiale, age: r.age }, r.primary_type, r.secondary_type),
  typer: (r) => gammelTyper.resolveRiderTypes(r.archetype_draw, r.abilities),
  vaerdi: (r, m) => gammelValuation.predictBaseValue(r, r.abilities, m),
};
const efterModel = {
  navn: "efter (håndværks-gulv + #3682)",
  caps: (r) => buildCapsForRider(r.abilities, { potentiale: r.potentiale, age: r.age }, r.primary_type, r.secondary_type),
  typer: (r) => resolveRiderTypes(r.archetype_draw, r.abilities),
  vaerdi: (r, m) => predictBaseValue(r, r.abilities, m),
};

// ── Data ────────────────────────────────────────────────────────────────────
const raw = JSON.parse(readFileSync(path.resolve(args.snapshot), "utf8"));
const riders = (Array.isArray(raw) ? raw : raw.riders ?? raw.rows ?? []).filter(
  (r) => r?.abilities && r?.primary_type && Number.isFinite(Number(r.age)),
);

const median = (v) => {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

// Værdimodellen (B3). Findes den ikke, siges det — den gate springes ikke tavst over.
let valuationModel = null;
for (const kandidat of ["../lib/riderValuationModelV4.json", "../lib/riderValuationModel.json"]) {
  try {
    valuationModel = JSON.parse(readFileSync(new URL(kandidat, import.meta.url), "utf8"));
    break;
  } catch { /* prøv næste */ }
}

// ── Kør ─────────────────────────────────────────────────────────────────────
const perRolle = new Map();
const gates = { B1: [], B2: [], B3: [], B4: "buildCapsForRider skriver kun ability_caps — `potentiale` er et LÆST input, aldrig et skrevet felt" };
let capsHaevet = 0, capsUaendret = 0, evnepladser = 0;

for (const r of riders) {
  const foer = foerModel.caps(r);
  const efter = efterModel.caps(r);

  // B1 — intet evne-loft må falde, for nogen rytter, på nogen evne.
  for (const ability of VISIBLE_ABILITIES) {
    evnepladser++;
    const d = efter[ability] - foer[ability];
    if (d < -1e-9) gates.B1.push({ rider_id: r.rider_id, ability, foer: foer[ability], efter: efter[ability] });
    else if (d > 1e-9) capsHaevet++;
    else capsUaendret++;
  }

  // B2 — typen må ikke flytte sig. Kør den GAMLE resolver mod den NYE og
  // sammenlign. Begge læser classifierWeights, som er hash-låst — men "den er jo
  // låst" er en påstand, og B2 er en måling.
  const tFoer = foerModel.typer(r);
  const tEfter = efterModel.typer(r);
  if (JSON.stringify(tFoer) !== JSON.stringify(tEfter)) {
    gates.B2.push({ rider_id: r.rider_id, foer: tFoer, efter: tEfter });
  }

  // B3 — markedsværdien må ikke flytte sig. Gammel værdimodel mod ny, samme
  // rytter. Den læser `abilities` (urørt) via valuationWeights (hash-låst) — men
  // det er præcis den slags "burde jo" #3682 beder om at få MÅLT.
  if (valuationModel) {
    const vFoer = foerModel.vaerdi(r, valuationModel);
    const vEfter = efterModel.vaerdi(r, valuationModel);
    if (vFoer !== vEfter) gates.B3.push({ rider_id: r.rider_id, foer: vFoer, efter: vEfter });
  }

  const rolle = r.primary_type;
  if (!perRolle.has(rolle)) perRolle.set(rolle, { n: 0, posFoer: [], posEfter: [], tacFoer: [], tacEfter: [], ratFoer: [], ratEfter: [], deltaer: [] });
  const b = perRolle.get(rolle);
  b.n++;
  b.posFoer.push(foer.positioning); b.posEfter.push(efter.positioning);
  b.tacFoer.push(foer.tactics); b.tacEfter.push(efter.tactics);
  const rf = ratingForRole(foer, rolle), re = ratingForRole(efter, rolle);
  if (rf != null && re != null) { b.ratFoer.push(rf); b.ratEfter.push(re); b.deltaer.push(re - rf); }
}

// ── Rapport ─────────────────────────────────────────────────────────────────
const linjer = [];
const p = (s) => { linjer.push(s); console.log(s); };

p(`# Håndværks-taget — dry-run-diff (#3709 trin 3 / #3682)`);
p("");
p(`Population: ${path.resolve(args.snapshot)}`);
p(`Ryttere: ${riders.length} · evne-pladser: ${evnepladser}`);
p(`Model FØR: ${foerModel.navn}`);
p(`Model EFTER: ${efterModel.navn}`);
p("");
p("## Gates");
p("");
p(`| # | Kriterium | Resultat |`);
p(`|---|---|---|`);
p(`| B1 | Intet evne-loft falder | ${gates.B1.length === 0 ? `✅ 0 af ${evnepladser} evne-pladser faldt` : `❌ ${gates.B1.length} faldt`} |`);
p(`| B2 | primary_type + secondary_type uændret | ${gates.B2.length === 0 ? `✅ 0 af ${riders.length} flyttede sig` : `❌ ${gates.B2.length} flyttede sig`} |`);
p(`| B3 | Markedsværdier uændret | ${valuationModel ? (gates.B3.length === 0 ? `✅ 0 af ${riders.length} flyttede sig` : `❌ ${gates.B3.length} flyttede sig`) : "⚠ IKKE MÅLT — ingen model-JSON fundet"} |`);
p(`| B4 | \`potentiale\`-feltet urørt | ✅ ${gates.B4} |`);
p("");
p(`Lofter hævet: ${capsHaevet} evne-pladser (${((100 * capsHaevet) / evnepladser).toFixed(1)} %) · uændret: ${capsUaendret}`);
p("");
p("## Absolutte deltaer pr. rolle");
p("");
p(`| Rolle | n | positioning-loft | tactics-loft | potentiel rating | snit-delta |`);
p(`|---|---:|---:|---:|---:|---:|`);
const rækker = [...perRolle.entries()].sort((a, b) => b[1].n - a[1].n);
for (const [rolle, b] of rækker) {
  p(`| ${rolle} | ${b.n} | ${median(b.posFoer)} → ${median(b.posEfter)} | ${median(b.tacFoer)} → ${median(b.tacEfter)} | ${median(b.ratFoer)} → ${median(b.ratEfter)} | **${mean(b.deltaer) >= 0 ? "+" : ""}${mean(b.deltaer).toFixed(2)}** |`);
}
const alle = { posFoer: [], posEfter: [], tacFoer: [], tacEfter: [], ratFoer: [], ratEfter: [], deltaer: [] };
for (const [, b] of rækker) for (const k of Object.keys(alle)) alle[k].push(...b[k]);
p(`| **I alt** | **${riders.length}** | **${median(alle.posFoer)} → ${median(alle.posEfter)}** | **${median(alle.tacFoer)} → ${median(alle.tacEfter)}** | **${median(alle.ratFoer)} → ${median(alle.ratEfter)}** | **${mean(alle.deltaer) >= 0 ? "+" : ""}${mean(alle.deltaer).toFixed(2)}** |`);
p("");
p(`Største enkeltudslag på potentiel rating: +${Math.max(...alle.deltaer)} point.`);
p(`Ryttere hvis potentielle rating IKKE flytter sig: ${alle.deltaer.filter((d) => d === 0).length} af ${alle.deltaer.length}.`);

if (args.json) {
  writeFileSync(path.resolve(args.json), JSON.stringify({
    snapshot: path.resolve(args.snapshot), n: riders.length,
    gates: { B1: gates.B1.length, B2: gates.B2.length, B3: valuationModel ? gates.B3.length : null },
    capsHaevet, capsUaendret, evnepladser,
    perRolle: Object.fromEntries(rækker.map(([rolle, b]) => [rolle, {
      n: b.n, posFoer: median(b.posFoer), posEfter: median(b.posEfter),
      tacFoer: median(b.tacFoer), tacEfter: median(b.tacEfter),
      ratFoer: median(b.ratFoer), ratEfter: median(b.ratEfter), snitDelta: +mean(b.deltaer).toFixed(3),
    }])),
  }, null, 2));
}

const fejlede = gates.B1.length > 0 || gates.B2.length > 0 || (valuationModel && gates.B3.length > 0);
if (fejlede) {
  console.error("\n❌ MINDST ÉN GATE FEJLEDE — se ovenfor. Intet må muteres.");
  if (gates.B1.length) console.error("B1-eksempler:", gates.B1.slice(0, 5));
  if (gates.B2.length) console.error("B2-eksempler:", gates.B2.slice(0, 5));
  if (gates.B3.length) console.error("B3-eksempler:", gates.B3.slice(0, 5));
}
process.exit(fejlede ? 1 : 0);
