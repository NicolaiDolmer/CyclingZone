#!/usr/bin/env node
//
// spillervendteGates3709 — gates på de tal SPILLEREN aflæser, ikke på simulerede
// slutresultater.
//
// ═══ HVORFOR DEN FINDES ══════════════════════════════════════════════════════
// To fejl ramte spillerne 14.-15./8, og begge slap forbi et grønt scorecard:
//
//   • 751 ryttere fik en evne over 95, hvor løftet i Discord 11/8 var "det bliver
//     voldsomt få, der lander deroppe". Tallet VAR målt (gates-rapporten 14/8 §3
//     skrev 1.840 pladser på 99), men det stod som "Nyt fund" ved siden af fem
//     grønne gates i stedet for at være en gate. Et fund uden gate stopper intet.
//   • Ryttere sprang +2 og +3 point på én dag. Det var aldrig målt af noget.
//
// `rytterudviklingScorecard.js` måler rating efter 14 simulerede sæsoner, agens-
// spænd og andel af taget nået. Alle tre er rigtige mål, og ingen af dem er det
// spilleren kigger på om morgenen. Denne fil måler netop dét, mod ejerens egne
// tal fra 15/8.
//
// ═══ GRÆNSERNE ER EJERENS, IKKE MINE ═════════════════════════════════════════
// Hvert tal nedenfor er svaret på et spørgsmål stillet direkte 15/8. De må kun
// ændres af ejeren, og en ændring skal skrives ned her med dato og begrundelse —
// samme regel som FACIT_MODELDRIFT i repair3570Apply.mjs.
//
//   node scripts/spillervendteGates3709.mjs [--json=ud.json]

import { readFileSync, writeFileSync } from "node:fs";

import { VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import {
  YOUTH_PROGRESSION_CONFIG, buildYouthCaps, taperedAbsoluteCap, peakAgeForType,
} from "../lib/riderProgression.js";
import { dailyAbilityDelta } from "../lib/dailyTraining.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...r] = a.replace(/^--/, "").split("=");
  return [k, r.length ? r.join("=") : true];
}));

// Snapshottet er IKKE committet (det er 8.717 ryttere med evner og lofter), så
// stien er et argument. Uden den kan gate S1 og S2 ikke måles, og scriptet skal
// sige det højlydt i stedet for at rapportere grønt på et tomt grundlag.
const SNAPSHOT = args.snapshot ?? "C:/Dev/CyclingZone/docs/snapshots/3591/riders_full.json";
const DAGE_PR_SAESON = 28;

// ── EJERENS KRAV, 15/8 ──────────────────────────────────────────────────────
export const KRAV = Object.freeze({
  // "0 nu, under 10 efter fem sæsoner." Taget må ALDRIG i sig selv sætte nogen
  // over 95; kommer man derop skal det være fordi en manager har trænet rytteren
  // derhen. Derfor måles taget, ikke det nåede.
  maksRyttereOver95FraTaget: 0,

  // "Man skal aldrig kunne stige 3 på en dag. Det burde slet ikke kunne lade sig
  // gøre." Målt i det mest ekstreme lovlige scenarie.
  maksDagligtSpring: 2,

  // "52 uger i virkeligheden er cirka 12 sæsoner. I den periode må kun de bedste
  // af de bedste stige til 90 i en stat." 12 × 28 = 336 dage. Båndet er ±15 %:
  // hurtigere end 286 dage er for hurtigt, langsommere end 386 er for sejt.
  dageTil90Min: 286,
  dageTil90Maks: 386,

  // "Cirka 3 gange" hurtigere for det bedste talent end det dårligste.
  fartSpaendMin: 2.5,
  fartSpaendMaks: 3.5,
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function capsFor(rider, cfg) {
  const absolute = buildYouthCaps(rider.potentiale, rider.primary_type, rider.secondary_type, cfg);
  const peakAge = peakAgeForType(rider.primary_type);
  const caps = {};
  for (const ability of VISIBLE_ABILITIES) {
    const current = Math.round(Number(rider.abilities?.[ability]) || 0);
    caps[ability] = clamp(Math.max(taperedAbsoluteCap(absolute[ability] ?? 0, rider.age, peakAge), current), 0, 99);
  }
  return caps;
}

// GATE 1 + 2. Taget må ikke i sig selv sætte nogen over 95. Målt UDEN gulvet
// max(tag, current): en arvet rytter der allerede ER over 95 tæller ikke som en
// fejl i modellen (ejer-beslutning 15/8: behold evnen, ingen vækst). Det er
// FORMEL-taget der skal holde sig nede.
function gateTag(riders, cfg) {
  let ryttereOver95 = 0, pladserOver95 = 0, pladserPaa99 = 0;
  const potRatings = [];
  for (const r of riders) {
    if (!r.primary_type || r.potentiale == null) continue;
    const absolute = buildYouthCaps(r.potentiale, r.primary_type, r.secondary_type, cfg);
    const peakAge = peakAgeForType(r.primary_type);
    let over = false;
    for (const ability of VISIBLE_ABILITIES) {
      const tag = clamp(taperedAbsoluteCap(absolute[ability] ?? 0, r.age, peakAge), 0, 99);
      if (tag >= 95) { pladserOver95++; over = true; }
      if (tag >= 99) pladserPaa99++;
    }
    if (over) ryttereOver95++;
    const caps = capsFor(r, cfg);
    potRatings.push(median(VISIBLE_ABILITIES.map((a) => caps[a])));
  }
  return { ryttereOver95, pladserOver95, pladserPaa99, medianLoft: median(potRatings) };
}

// Simulér én evne dag for dag under BEDST MULIGE spil. Returnerer dage til målet.
function dageTil(maal, { potentiale, alder, start, tag, primaryType }) {
  let cur = start, dag = 0;
  while (cur < maal - 0.5 && dag < 5000) {
    const d = dailyAbilityDelta({
      ability: "sprint", current: cur, cap: tag, age: alder,
      program: { focus: "sprint", intensity: "hard" },
      conditionMult: 1, bonus: true, noise: 1, potentiale,
      primaryType, secondaryType: null,
    });
    if (d <= 0) break;
    cur += d; dag++;
  }
  return { dage: cur >= maal - 0.5 ? dag : Infinity, slut: cur };
}

// GATE 3. Største spring på ÉN dag, i det mest ekstreme lovlige scenarie:
// yngst mulig, højeste potentiale, størst muligt gap, hård træning, manager-bonus.
function gateSpring(cfg) {
  let maks = 0;
  for (const potentiale of [5, 5.5, 6]) {
    for (const alder of [16, 17, 18]) {
      const absolute = buildYouthCaps(potentiale, "sprinter", null, cfg);
      const tag = clamp(absolute.sprint ?? 0, 0, 99);
      for (const current of [1, 10, 20, 40]) {
        if (current >= tag) continue;
        // FACILITET OG STAFF SKAL MED. Uden dem måler gaten et scenarie ingen
        // spiller er i: `facilityTrainingMultiplier` og `staffTrainingBonus`
        // ganges SIDST i kæden, og det er dér spillernes +3 kom fra 15/8. En gate
        // der udelader dem ville have rapporteret grønt mens Discord fyldtes op.
        const d = dailyAbilityDelta({
          ability: "sprint", current, cap: tag, age: alder,
          program: { focus: "sprint", intensity: "hard" },
          conditionMult: 1.1, bonus: true, noise: 1.05, potentiale,
          primaryType: "sprinter", secondaryType: null,
          facilityTier: 5, riderLevel: "u23",
          staff: { training: { sprint: 5 }, chief: 5 },
        });
        maks = Math.max(maks, d);
      }
    }
  }
  return { maksRaaDelta: maks, maksHelePoint: Math.floor(maks) };
}

// GATE 4 + 5. Tid til 90 for spillets bedste, og fart-spændet mod det dårligste.
function gateFart(cfg) {
  const bedsteTag = clamp(buildYouthCaps(6, "sprinter", null, cfg).sprint ?? 0, 0, 99);
  const bedste = dageTil(90, { potentiale: 6, alder: 17, start: 20, tag: Math.max(bedsteTag, 90), primaryType: "sprinter" });

  // Fart-spænd: hvor langt når pot 1 på den tid pot 6 bruger på at nå 90?
  const svagTag = clamp(buildYouthCaps(1, "sprinter", null, cfg).sprint ?? 0, 0, 99);
  let cur = 20;
  const dage = Number.isFinite(bedste.dage) ? bedste.dage : 336;
  for (let d = 0; d < dage; d++) {
    const delta = dailyAbilityDelta({
      ability: "sprint", current: cur, cap: Math.max(svagTag, 90), age: 17,
      program: { focus: "sprint", intensity: "hard" },
      conditionMult: 1, bonus: true, noise: 1, potentiale: 1,
      primaryType: "sprinter", secondaryType: null,
    });
    if (delta <= 0) break;
    cur += delta;
  }
  const svagFremgang = cur - 20;
  const bedsteFremgang = 70;
  return {
    dageTil90: bedste.dage,
    saesonerTil90: Number.isFinite(bedste.dage) ? +(bedste.dage / DAGE_PR_SAESON).toFixed(1) : null,
    pointPrUge: Number.isFinite(bedste.dage) ? +((70 / bedste.dage) * 7).toFixed(2) : null,
    svagNaaerTil: +(20 + svagFremgang).toFixed(1),
    fartSpaend: svagFremgang > 0 ? +(bedsteFremgang / svagFremgang).toFixed(2) : Infinity,
  };
}

const riders = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
const cfg = YOUTH_PROGRESSION_CONFIG;

const tag = gateTag(riders, cfg);
const spring = gateSpring(cfg);
const fart = gateFart(cfg);

const gates = [
  {
    id: "S1",
    navn: "taget saetter ingen over 95",
    faktisk: `${tag.ryttereOver95} ryttere (${tag.pladserOver95} evne-pladser)`,
    krav: `<= ${KRAV.maksRyttereOver95FraTaget}`,
    ok: tag.ryttereOver95 <= KRAV.maksRyttereOver95FraTaget,
  },
  {
    id: "S2",
    navn: "taget rammer aldrig 99-klippet",
    faktisk: `${tag.pladserPaa99} evne-pladser paa 99`,
    krav: "= 0",
    ok: tag.pladserPaa99 === 0,
  },
  {
    id: "S3",
    navn: "stoerste spring paa en dag",
    faktisk: `+${spring.maksHelePoint} (raa ${spring.maksRaaDelta.toFixed(2)})`,
    krav: `<= +${KRAV.maksDagligtSpring}`,
    ok: spring.maksHelePoint <= KRAV.maksDagligtSpring,
  },
  {
    id: "S4",
    navn: "bedste rytter: 20 -> 90",
    faktisk: Number.isFinite(fart.dageTil90)
      ? `${fart.dageTil90} dage (${fart.saesonerTil90} saesoner, ${fart.pointPrUge} point/uge)`
      : "naar aldrig 90",
    krav: `${KRAV.dageTil90Min}-${KRAV.dageTil90Maks} dage`,
    ok: fart.dageTil90 >= KRAV.dageTil90Min && fart.dageTil90 <= KRAV.dageTil90Maks,
  },
  {
    id: "S5",
    navn: "fart-spaend bedste mod daarligste",
    faktisk: `${fart.fartSpaend}x (pot 1 naar ${fart.svagNaaerTil})`,
    krav: `${KRAV.fartSpaendMin}-${KRAV.fartSpaendMaks}x`,
    ok: fart.fartSpaend >= KRAV.fartSpaendMin && fart.fartSpaend <= KRAV.fartSpaendMaks,
  },
];

console.log("# Spillervendte gates (#3709 / #3746)\n");
console.log(`Population: ${riders.length} ryttere · signatur-tag ${cfg.naturalPrimaryFactor} · median-loft ${tag.medianLoft}\n`);
console.log("| # | gate | faktisk | krav | |");
console.log("|---|---|---|---|---|");
for (const g of gates) {
  console.log(`| ${g.id} | ${g.navn} | ${g.faktisk} | ${g.krav} | ${g.ok ? "OK" : "FEJL"} |`);
}

const fejlede = gates.filter((g) => !g.ok);
console.log(`\n${fejlede.length === 0 ? "Alle gates groenne." : `${fejlede.length} gate(s) fejlede: ${fejlede.map((g) => g.id).join(", ")}`}`);

if (args.json) writeFileSync(String(args.json), JSON.stringify({ gates, tag, spring, fart, krav: KRAV }, null, 2));

process.exit(fejlede.length === 0 ? 0 : 1);
