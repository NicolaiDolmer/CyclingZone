// Arketype-mål-fordeling (#3458 fase 2 del 1) — ren FORMEL, ikke en tabel.
//
// Design-SSOT: docs/superpowers/specs/2026-08-06-ryttertype-fundament-v2-design.md
// (Del A + afsnit 6 "Research-grundlag"). Kravet fra spec'en (ejer 6/8): kalender
// og population må ALDRIG drifte fra hinanden — når S3-kalenderens målprofil
// justeres igen, skal fordelingen automatisk følge med, uden en ny hånd-tabel.
//
// Formlen har tre lag, der spejler spec'ens afsnit 2 punkt 1 (a-c):
//   1. computeCalendarDemand — MÅL-kalenderens efterspørgselsprofil (punkt b):
//      hver kalender-kategoris andel af løbsdage fordeles til typer via en
//      navngiven demand-mapping (flad→sprinter, bjerg→climber/gc, osv.).
//   2. SCARCITY_MULTIPLIER — virkelighedens kvalitative knapheds-rangering
//      (punkt a) + spillets egne design-principper (punkt c): rouleur er
//      pelotonens rygrad på tværs af ALLE formater (opvægtes ud over sin egen
//      kalender-kategori-andel), rene sprintere er en "truet art"
//      (nedvægtes), brosten er en bevidst prestige-vare (opvægtes over sin
//      6%-kalenderandel), gc/tt er knaphedsroller (nedvægtes yderligere).
//   3. Gulv (~8-9 %, punkt c): intet løbsformat må være "dødt" — typer under
//      gulvet løftes op, og overskuddet trækkes proportionalt fra resten så
//      summen forbliver 100.
//
// INGEN akademi-specifikke antagelser: modulet kender intet til ryttere,
// stats eller DB — det er en ren %-fordelings-formel + en seeded weighted-pick
// hjælper, genbrugelig af AI-fill/starter-stierne i #3458 fase 2 del 2 (PR 2).

import { RIDER_TYPE_KEYS } from "./riderTypes.js";

// De 8 arketyper modulet fordeler over — samme nøgler som RIDER_TYPE_KEYS
// (riderTypes.js er SSOT for typenøglerne; vi importerer i stedet for at
// duplikere listen og risikere drift).
export const ARCHETYPE_TYPES = Object.freeze([...RIDER_TYPE_KEYS]);

// ── Lag 1a: MÅL-kalenderens profilkomposition ─────────────────────────────────
// K-B gameplay-justeret, EJER-BESLUTTET 2026-08-05 (#3295, research-begrundet mod
// virkelige sæsoner 2023-2025). IKKE den nuværende kalender (#2177/#3326/#3371 —
// S3-kalenderen bygges om FØR 23/8 per #3295) — dette ER mål-profilen den nye
// kalender bygges mod. Procent af løbsdage, summer til 100.
export const TARGET_CALENDAR_PROFILE_KB = Object.freeze({
  flad: 24,
  kuperet: 30,
  bjerg: 28,
  itt: 8,
  brosten: 6,
  ttt: 4,
});

// ── Lag 1b: demand-mapping (design-spec §2 punkt 1b) ──────────────────────────
// Kalender-kategori → { arketype: andel af kategoriens efterspørgsel }. Andelene
// pr. kategori summer til 1. "rolling" og "udbrud" er IKKE en del af K-B (S3 har
// ingen af de to kategorier endnu) men holdes med i mappingen for fremtidig
// genbrug (kalenderen kan få dem senere, jf. spec'ens "rolling+udbruds-formater
// →rouleur/baroudeur") — de bidrager 0 til K-B-fordelingen i dag.
//
//   flad     → sprinter (rene flade dage er sprinternes eneste hjemmebane)
//   kuperet  → puncheur (hovedkategori, K-B's største segment) / baroudeur
//              (taktisk udbrudsterræn) / rouleur (rygrad i alle formater)
//   bjerg    → climber (primær) / gc (etapeløbsryttere skal også klare bjerget,
//              men kun en LILLE andel — resten er scarcity-modifikatoren i lag 2)
//              / baroudeur (bjerg-udbrud er en klassisk taktisk rolle)
//   itt/ttt  → tt (enkeltstart ren tt-efterspørgsel; TTT deler lidt med rouleur
//              — holdtempo er en holdmotor-disciplin, ikke ren tt-solo)
//   brosten  → brostensrytter (dedikeret prestige-format)
export const DEMAND_MAP = Object.freeze({
  flad: Object.freeze({ sprinter: 1 }),
  kuperet: Object.freeze({ puncheur: 0.45, baroudeur: 0.35, rouleur: 0.2 }),
  bjerg: Object.freeze({ climber: 0.82, gc: 0.1, baroudeur: 0.08 }),
  itt: Object.freeze({ tt: 1 }),
  ttt: Object.freeze({ tt: 0.7, rouleur: 0.3 }),
  brosten: Object.freeze({ brostensrytter: 1 }),
  rolling: Object.freeze({ rouleur: 0.55, baroudeur: 0.45 }),
  udbrud: Object.freeze({ baroudeur: 0.65, rouleur: 0.35 }),
});

// ── Lag 2: scarcity/design-modifikatorer (design-spec §2 punkt 1a + 1c) ───────
// Multiplikeres på den rå kalender-efterspørgsel FØR renormalisering. >1 = løftet
// ud over sin kalender-andel, <1 = nedvægtet. Kilder: spec'ens afsnit 6
// (research-grundlag) + ejer-designvalg for K-B (#3295).
//
//   rouleur (2.20)         "pelotonens rygrad i alle kilder" — til stede som
//                          hjælperytter/holdmotor i ALLE formater, ikke kun sin
//                          egen kalender-kategori-andel (theconversation.com,
//                          inrng.com, radmarkt.com — domestique-tætheden i en
//                          WT-trup langt overstiger enhver enkelt terrænandel).
//   brostensrytter (1.65)  bevidst prestige-vare: K-B løfter selv brostens
//                          kalenderandel til 6% (over virkelighedens ~4%, jf.
//                          egen kalender-måling §6) — "Flandrien som knap
//                          markedsvare" skal have en fyldig, konkurrencedygtig
//                          pulje, ikke kun en tynd biprodukt-andel af 6%.
//   sprinter (0.60)        "Pure Sprinters: Endangered Species" (Astana 2022 uden
//                          én ren sprinter, velo.outsideonline.com) — flade dages
//                          kalenderandel overvurderer ægte spurt-specialister
//                          (mange deltagere på flade dage er rouleurs/lead-out,
//                          ikke rene sprintere).
//   climber (0.70)         bjergetaper dækkes af HELE klatre-hold (rygrad +
//                          udbrud), ikke kun rene klatrere — kalenderandelen
//                          alene overvurderer den rene arketype.
//   gc (0.85)               } knaphedsroller (spec: "virkelighedens sjældneste
//   tt (0.93)                } rolle, 1-2 pr. WT-hold" / "strategisk afgørende,
//                             knap og værdifuld") — nedvægtes yderligere ud over
//                             den allerede lave demand-map-andel (gc's 3 % er
//                             derfor primært et GULV-produkt, ikke et kalender-
//                             produkt, jf. §2 punkt 1c).
//   puncheur/baroudeur (~1) allerede tæt på deres arbejdstal via demand-map alene
//                          — ingen yderligere korrektion nødvendig.
export const SCARCITY_MULTIPLIER = Object.freeze({
  sprinter: 0.6,
  climber: 0.7,
  puncheur: 0.96,
  baroudeur: 0.94,
  rouleur: 2.2,
  brostensrytter: 1.65,
  gc: 0.85,
  tt: 0.93,
});

// ── Lag 3: gulv ─────────────────────────────────────────────────────────────
// Spec §2 punkt 1c: "gulv ~8-9 % så intet løbsformat er dødt". 8.5 er midtpunktet.
export const FLOOR_PCT = 8.5;

const clamp01 = (n) => Math.max(0, Math.min(1, n));

// ── Lag 1: rå kalender-efterspørgsel pr. arketype (før scarcity/gulv) ─────────
// Summerer til 100 hvis calendarProfile summerer til 100 og hver kategoris
// demand-map-andele summerer til 1 (begge sande for TARGET_CALENDAR_PROFILE_KB).
export function computeCalendarDemand(
  calendarProfile = TARGET_CALENDAR_PROFILE_KB,
  demandMap = DEMAND_MAP,
  types = ARCHETYPE_TYPES,
) {
  const demand = Object.fromEntries(types.map((t) => [t, 0]));
  for (const [category, pct] of Object.entries(calendarProfile)) {
    const shares = demandMap[category];
    if (!shares) continue; // ukendt kategori → ingen efterspørgsel bidraget (defensivt)
    for (const [type, share] of Object.entries(shares)) {
      if (!(type in demand)) continue; // demand-map kan referere typer uden for `types`-scopet
      demand[type] += pct * share;
    }
  }
  return demand;
}

// Løft typer under gulvet til gulvet, og træk overskuddet proportionalt fra
// typerne over gulvet, så summen forbliver 100. Itereres til stabil (en type kan
// i teorien dykke under gulvet efter en rescale) — maks 5 runder er rigeligt for
// 8 typer med realistiske startværdier.
function applyFloor(dist, floorPct, types) {
  let out = { ...dist };
  for (let round = 0; round < 5; round++) {
    const below = types.filter((t) => out[t] < floorPct);
    if (below.length === 0) break;
    const deficit = below.reduce((s, t) => s + (floorPct - out[t]), 0);
    const above = types.filter((t) => !below.includes(t));
    const aboveSum = above.reduce((s, t) => s + out[t], 0);
    const next = { ...out };
    for (const t of below) next[t] = floorPct;
    if (aboveSum > 0) {
      for (const t of above) next[t] = out[t] - deficit * (out[t] / aboveSum);
    }
    out = next;
  }
  return out;
}

// Rund til 2 decimaler og korrigér afrundingsdrift på den STØRSTE andel, så
// summen er PRÆCIS 100 (vigtigt for G4/tests der summerer fordelingen).
function roundDistribution(dist, types) {
  const rounded = {};
  for (const t of types) rounded[t] = Math.round(dist[t] * 100) / 100;
  const sum = types.reduce((s, t) => s + rounded[t], 0);
  const drift = Math.round((100 - sum) * 100) / 100;
  if (drift !== 0) {
    const biggest = types.reduce((a, b) => (rounded[a] >= rounded[b] ? a : b));
    rounded[biggest] = Math.round((rounded[biggest] + drift) * 100) / 100;
  }
  return rounded;
}

/**
 * Beregn den fulde arketype-mål-fordeling (%, summer til 100) fra kalender +
 * demand-mapping + scarcity-modifikatorer + gulv. Ren funktion — ingen state.
 */
export function computeArchetypeDistribution({
  calendarProfile = TARGET_CALENDAR_PROFILE_KB,
  demandMap = DEMAND_MAP,
  scarcityMultiplier = SCARCITY_MULTIPLIER,
  floorPct = FLOOR_PCT,
  types = ARCHETYPE_TYPES,
} = {}) {
  const raw = computeCalendarDemand(calendarProfile, demandMap, types);
  const weighted = {};
  let wsum = 0;
  for (const t of types) {
    const w = Math.max(0, raw[t] * (scarcityMultiplier[t] ?? 1));
    weighted[t] = w;
    wsum += w;
  }
  const norm = {};
  for (const t of types) norm[t] = wsum > 0 ? (weighted[t] / wsum) * 100 : 100 / types.length;
  const floored = applyFloor(norm, floorPct, types);
  return roundDistribution(floored, types);
}

// Frosset default — beregnet ÉN gang mod K-B-kalenderen. Genererings-stierne
// (akademi-intake, senere AI-fill/starter) trækker mod DENNE, ikke en genberegnet
// live-værdi pr. kald (determinisme + performance — formlen ÆNDRER sig kun når
// en kalender-omlægning bevidst opdaterer TARGET_CALENDAR_PROFILE_KB).
export const DEFAULT_DISTRIBUTION = Object.freeze(computeArchetypeDistribution());

// ── Seeded weighted-pick (selvstændig — intet delt import med generator-koden) ─

/**
 * Træk ÉN arketype fra en fordeling (default DEFAULT_DISTRIBUTION) med ét
 * rng()-kald. Deterministisk (mulberry32-kompatibel rng, som resten af
 * generator-kæden).
 */
export function drawArchetype(rng, distribution = DEFAULT_DISTRIBUTION, types = ARCHETYPE_TYPES) {
  const total = types.reduce((s, t) => s + (distribution[t] ?? 0), 0);
  let roll = rng() * total;
  for (const t of types) {
    roll -= distribution[t] ?? 0;
    if (roll <= 0) return t;
  }
  return types[types.length - 1];
}

// ~15 % hybrid-andel (design-spec §2 punkt 2, ejer-mandat 6/8).
export const HYBRID_PROBABILITY = 0.15;

/**
 * Træk arketype med hybrid-støj (design-spec §2 punkt 2): ~15 % af nye ryttere
 * trækkes som to-arketype-blanding. Konsumerer altid ÉT rng()-kald til primær +
 * ét til hybrid-mønten; et TREDJE kald KUN når hybrid rammer (determinisme:
 * ikke-hybrid-grenen forbruger præcis 2 kald, hybrid-grenen 3).
 *
 * @returns {{ primary: string, secondary: string|null, isHybrid: boolean }}
 */
export function drawArchetypePair(rng, {
  distribution = DEFAULT_DISTRIBUTION,
  types = ARCHETYPE_TYPES,
  hybridProbability = HYBRID_PROBABILITY,
} = {}) {
  const primary = drawArchetype(rng, distribution, types);
  const isHybrid = rng() < clamp01(hybridProbability);
  if (!isHybrid) return { primary, secondary: null, isHybrid: false };
  const remaining = types.filter((t) => t !== primary);
  const secondary = drawArchetype(rng, distribution, remaining);
  return { primary, secondary, isHybrid: true };
}
