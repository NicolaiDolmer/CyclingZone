// backend/scripts/dev/generateEngineV4Fixtures.mjs
// Race Engine v4 F2 (#4030), Fase C: genererer de 4 golden fixtures i
// backend/lib/engine/v4/fixtures/ (input.json + expected.json pr. scenarie).
// SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md §7.
//
// Kører simulateStageV4 mod haandbyggede, realistiske StageInput'er og
// fryser det FULDE StageOutput som expected.json. Kør igen for at
// regenerere expected.json hvis input.json aendres bevidst (fixtures.test.ts
// forudsaetter deep-equal med den frosne expected.json — se filens header).
//
// Ingen import fra oevrigt backend udover selve v4-kernen (renheds-graensen
// gaelder motoren, ikke dette dev-script).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { simulateStageV4 } from "../../lib/engine/v4/index.ts";
import { RACE_V4_TUNING } from "../../lib/engine/v4/tuning.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(scriptDir, "../../lib/engine/v4/fixtures");

// Deep-klon af default-tuning (JSON-serialiserbar, ingen funktioner) saa hvert
// scenarie baerer sin EGEN kopi i input.json — golden fixtures maa ikke stille
// implicit krav om at forbrugeren importerer RACE_V4_TUNING.
function cloneTuning() {
  return JSON.parse(JSON.stringify(RACE_V4_TUNING));
}

// ── Ability-helper ────────────────────────────────────────────────────────
const ABILITY_KEYS = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function abilities(base, overrides = {}) {
  const out = {};
  for (const key of ABILITY_KEYS) out[key] = base;
  for (const [key, value] of Object.entries(overrides)) out[key] = value;
  return out;
}

function entrant(riderId, role, abilityRecord) {
  return { rider_id: riderId, abilities: abilityRecord, role, effort: "normal", condition: 1 };
}

function idNum(prefix, n) {
  return `${prefix}${String(n).padStart(2, "0")}`;
}

// ── Scenarie 1: flat-massespurt ─────────────────────────────────────────────
// Flad rute, felt samlet (ingen climb/descent-segmenter => M2/M3 kan ikke
// splitte feltet), sprinter vinder via M4's bunch_sprint-demandvektor
// (sprint 0.5, acceleration 0.2, positioning 0.2, flat 0.1).
function buildFlatMassespurt() {
  const riders = [];
  // 4 rene sprintere — r01 er den klart staerkeste (hoejeste vaegtede score).
  riders.push(entrant(idNum("r", 1), "sprint_captain", abilities(55, {
    sprint: 96, acceleration: 88, positioning: 85, flat: 78, punch: 60,
    tempo: 62, endurance: 60, recovery: 58, durability: 55, climbing: 22, time_trial: 48,
  })));
  riders.push(entrant(idNum("r", 2), "sprint_captain", abilities(55, {
    sprint: 91, acceleration: 84, positioning: 80, flat: 75, punch: 58,
    tempo: 60, endurance: 58, recovery: 56, durability: 54, climbing: 24, time_trial: 46,
  })));
  riders.push(entrant(idNum("r", 3), "helper", abilities(52, {
    sprint: 86, acceleration: 79, positioning: 76, flat: 70, punch: 55,
    tempo: 58, endurance: 56, climbing: 20, time_trial: 44,
  })));
  riders.push(entrant(idNum("r", 4), "helper", abilities(52, {
    sprint: 80, acceleration: 74, positioning: 70, flat: 66, punch: 52,
    tempo: 56, endurance: 55, climbing: 22, time_trial: 42,
  })));
  // 6 leadout-/rouleur-domestiques: hoej tempo/endurance (dominerer "front"-
  // rollen i kollektiv-CP'en), lav sprint saa de ikke konkurrerer om sejren.
  for (let i = 5; i <= 10; i++) {
    riders.push(entrant(idNum("r", i), "helper", abilities(58, {
      tempo: 72 + (i % 3), endurance: 70 + (i % 4), sprint: 30 + (i % 5),
      acceleration: 40, positioning: 45, punch: 42, climbing: 30, time_trial: 55,
    })));
  }
  // 3 klatrere (irrelevante paa flad rute, med for realistisk feltbredde).
  for (let i = 11; i <= 13; i++) {
    riders.push(entrant(idNum("r", i), "captain", abilities(50, {
      climbing: 85 + (i % 3), endurance: 68, tempo: 60, sprint: 22, acceleration: 35,
    })));
  }
  // 3 all-round free_role.
  for (let i = 14; i <= 16; i++) {
    riders.push(entrant(idNum("r", i), "free_role", abilities(56, {
      sprint: 45, acceleration: 48, tempo: 58, endurance: 58, climbing: 45,
    })));
  }

  const route = {
    distance_km: 178,
    profile_type: "flat",
    finale_type: "bunch_sprint",
    segments: [
      { kind: "flat", from_km: 0, to_km: 95 },
      { kind: "flat", from_km: 95, to_km: 165 },
      { kind: "flat", from_km: 165, to_km: 178 },
    ],
    weather: { kind: "sun", wind_exposure: 0.1 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 178 }],
  };

  return {
    route,
    startlist: riders,
    orders: [],
    seed: "fixture-flat-massespurt-v1",
    tuning: cloneTuning(),
  };
}

// ── Scenarie 2: bjerg-selektion ─────────────────────────────────────────────
// Lang stigning (to klatre-segmenter), felt splittes via M2, klatrer vinder
// finalen (long_climb-demandvektor: climbing 0.55, endurance 0.3, tempo 0.15)
// med reelle gaps fra peloton_splits-events.
//
// KALIBRERINGS-NOTE (empirisk fundet ved generering, jf. opgavens "inspicér
// FOER frys"-krav): physiology.tickPhysiology's tick daekker HELE segmentets
// varighed i ét skridt (ingen sub-stepping) — er demand > cp saa taemmer det
// W' med (demand-cp)*dtSeconds, og dtSeconds er typisk flere tusinde sekunder
// paa et rigtigt segment. Det goer cp-vs-demand PRAKTISK TALT BINAERT: er cp
// bare marginalt under climb-segmenters demand (0.8 front / 0.72 hjul,
// tuning.terrain.baseDemand.climb=0.8 × work.frontWorkFactor/draftFactor),
// braender rytteren HELT ud i ét segment; er cp klart over, taerer segmentet
// slet ikke. Elite-klatrernes evner herunder er derfor bevidst kalibreret til
// cp ≈0.85-0.91 (komfortabel margin over 0.8) og de svagere ryttere til
// cp ≈0.45-0.60 (komfortabel margin under 0.72) — en tvetydig mellemzone gav
// tilfaeldige/urealistiske udfald (fx den bedste klatrer selv droppet af
// dagsforms-stoej paa en cp-vaerdi taet paa taerskel).
function buildBjergSelektion() {
  const riders = [];
  // 4 elite-klatrere — r01 er referencen (hoejeste climbing).
  riders.push(entrant(idNum("r", 1), "captain", abilities(50, {
    climbing: 99, endurance: 95, tempo: 90, recovery: 78, punch: 40,
    sprint: 20, acceleration: 35, time_trial: 55, durability: 65,
  })));
  riders.push(entrant(idNum("r", 2), "captain", abilities(50, {
    climbing: 93, endurance: 91, tempo: 86, recovery: 74, punch: 38,
    sprint: 20, acceleration: 33, time_trial: 52, durability: 62,
  })));
  riders.push(entrant(idNum("r", 3), "hunter", abilities(48, {
    climbing: 88, endurance: 87, tempo: 82, recovery: 70, punch: 36,
    sprint: 19, acceleration: 32, time_trial: 50, durability: 60,
  })));
  riders.push(entrant(idNum("r", 4), "hunter", abilities(48, {
    climbing: 83, endurance: 84, tempo: 79, recovery: 67, punch: 34,
    sprint: 18, acceleration: 30, time_trial: 48, durability: 58,
  })));
  // 5 mid-pack domestiques — cp klart under climb-demand (0.72/0.8), droppes
  // rent paa foerste stigning.
  for (let i = 5; i <= 9; i++) {
    riders.push(entrant(idNum("r", i), "helper", abilities(50, {
      climbing: 55 + (i % 5), endurance: 58 + (i % 4), tempo: 55 + (i % 5), recovery: 55, sprint: 30,
    })));
  }
  // 6 sprintere/rouleurs — svage klatrere, droppes samtidig paa foerste stigning.
  for (let i = 10; i <= 15; i++) {
    riders.push(entrant(idNum("r", i), "sprint_captain", abilities(50, {
      climbing: 20 + (i % 8), endurance: 44 + (i % 6), tempo: 48 + (i % 6), sprint: 82 + (i % 6),
      acceleration: 78, positioning: 70, recovery: 45,
    })));
  }

  const route = {
    distance_km: 105,
    profile_type: "mountain",
    finale_type: "long_climb",
    segments: [
      { kind: "flat", from_km: 0, to_km: 45 },
      { kind: "climb", from_km: 45, to_km: 65, category: "1", avg_gradient: 7.5, top_elevation_m: 1350 },
      { kind: "descent", from_km: 65, to_km: 82, technicality: 2 },
      { kind: "climb", from_km: 82, to_km: 105, category: "HC", avg_gradient: 9.2, top_elevation_m: 2050 },
    ],
    weather: { kind: "overcast", wind_exposure: 0.15 },
    waypoints: [
      { kind: "kom", index: 0, name: "1. kategori-stigning", km: 65, category: "1" },
      { kind: "finish", index: 1, name: "Bjergmaal", km: 105, summit_finish: true },
    ],
  };

  return {
    route,
    startlist: riders,
    orders: [],
    seed: "fixture-bjerg-selektion-v1",
    tuning: cloneTuning(),
  };
}

// ── Scenarie 3: punch-finale-forspring (#3965) ──────────────────────────────
// Descent-attack skaber et solo-forspring med W'-reserve i behold; den korte
// afsluttende punch-stigning skal ikke kunne lukke hullet (M4's carried-gap-
// vs-chase-beregning) — foerste mand over toppen vinder.
//
// KALIBRERING (samme binaere cp-vs-demand-indsigt som scenarie 2): BAADE
// r01 (solo-forspring) og peloton skal have cp KLART over climb-segmentets
// demand (0.8 front / 0.72 hjul) paa den afsluttende stigning, ellers braender
// den ene eller begge grupper helt ud i stedet for at demonstrere M4's
// reelle jagt-vs-flugt-beregning (chasePower/leadDefend/W'-reserve). Begge
// grupper er derfor kalibreret til cp ≈0.82-0.88 (tempo/endurance/climbing
// hoejt og noget ens) — differentieringen ligger i r01's descending (attacken)
// og FLIGHT_KEYS (tempo/endurance/durability) vs. pelotonens CHASE_KEYS
// (tempo/endurance/aggression), IKKE i om nogen braender ud paa klatringen.
function buildPunchFinaleForspring() {
  const riders = [];
  // Rytteren med det store descending-forspring: hoej tempo/endurance/
  // durability (FLIGHT_KEYS, forsvarer forspringet) saetter leadDefend
  // tydeligt over pelotonens CHASE_KEYS-gennemsnit (se noten nedenfor).
  riders.push(entrant(idNum("r", 1), "hunter", abilities(55, {
    descending: 96, tempo: 90, endurance: 88, durability: 80, recovery: 72,
    punch: 62, climbing: 80, acceleration: 55, sprint: 35, aggression: 60,
  })));
  // 13 peloton-ryttere: hoej og ENSARTET tempo/endurance/climbing (cp klart
  // over climb-demand, saa gruppen forbliver samlet og reelt "jagter" i
  // stedet for at braende ud) — svag descending (25-38, under
  // minAbilityGapForAttack=15's spaend fra hinanden, saa INGEN sekundaer
  // attack opstaar INDE i pelotonen) og moderat aggression (CHASE_KEYS
  // klart under r01's FLIGHT_KEYS-gennemsnit).
  for (let i = 2; i <= 14; i++) {
    riders.push(entrant(idNum("r", i), i % 3 === 0 ? "sprint_captain" : "helper", abilities(52, {
      descending: 25 + (i % 13),
      tempo: 83 + (i % 5),
      endurance: 80 + (i % 5),
      climbing: 70 + (i % 5),
      aggression: 48 + (i % 10),
      punch: 45 + (i % 8),
      recovery: 55,
      durability: 55,
      sprint: 55 + (i % 15),
      acceleration: 50,
    })));
  }

  const route = {
    distance_km: 58,
    profile_type: "hilly",
    finale_type: "punch",
    segments: [
      { kind: "flat", from_km: 0, to_km: 32 },
      { kind: "descent", from_km: 32, to_km: 50, technicality: 3 },
      { kind: "climb", from_km: 50, to_km: 58, category: "4", avg_gradient: 5.5, top_elevation_m: 410 },
    ],
    weather: { kind: "wind", wind_exposure: 0.35 },
    waypoints: [{ kind: "finish", index: 0, name: "Punch-finale", km: 58 }],
  };

  return {
    route,
    startlist: riders,
    orders: [],
    seed: "fixture-punch-finale-forspring-v1",
    tuning: cloneTuning(),
  };
}

// ── Scenarie 4: nedkoerselsfinale ───────────────────────────────────────────
// Teknisk nedkoersel (T3) som SIDSTE segment, stor descending-forskel —
// descent attack (M3) afgoer finalen (finale_type "descent"-demandvektoren
// vaegter descending 0.5 tungest).
//
// KALIBRERING: den mellemliggende stigning (segment 1) maa IKKE selv
// selektere feltet (det ville forurene "descent afgoer"-historien) — alle
// ryttere har derfor hoej og ENSARTET tempo/endurance/climbing (cp klart
// over climb-demand 0.8/0.72, lille climbing-spaend => climbDeficitScaled
// under splitThreshold). Kun descending-evnen spreder sig bredt, og KUN de
// to attackere er over minAbilityGapForAttack=15 fra gruppens minimum —
// pelotonens eget descending-spaend (13 point) er bevidst under 15 for at
// undgaa en sekundaer attack INDE i den jagende gruppe.
//
// RUTE-NOTE (motor-afvigelse fundet ved generering — IKKE rettet, jf.
// opgavens "rør ikke tuning/mekanik"-krav, dokumenteret i sessionens
// rapport): naar det SIDSTE segment er BAADE en descent OG stedet hvor
// descentHook angriber, kalder segmentLoop.ts financeHook'en (M4) PAA DET
// URE-BASELINEDE state (rebaselineGroups koeres foerst EFTER finale-hooket,
// se segmentLoop.ts's step 3). DescentHook's angrebs-gruppe faar et
// NEGATIVT gap (den rykker FORAN kilde-gruppen, som selv beholder gap=0),
// og M4's frontPool-filter (`gap_seconds === 0`) genkender hverken det
// negative angrebs-gap (ikke ===0) eller kilde-gruppen som retvisende front
// (kilde-gruppen ER stadig gap=0, men reelt IKKE laengere fronten) — angribs-
// gruppen falder helt ud af finale-hookets output (hverken contender eller
// surviving), og dens ryttere beholder deres INITIALE group_id/time_seconds
// (0s). M2 (climbSelectionHook) rammer IKKE dette, fordi splittede ryttere
// altid faar et POSITIVT delta (rykker BAGUD, kilde-gruppens gap=0 forbliver
// korrekt) — kun M3's "ryk FORAN"-semantik kolliderer med M4 paa samme
// segment. Fixturen omgaar det her ved at laegge et kort fladt indkoersel-
// segment EFTER nedkoerslen som det faktiske sidste segment (almindeligt
// virkeligt rutemoenster: teknisk nedkoersel + kort ligestykke til stregen),
// saa descentHook's rebaseline naar at koere FOER financeHook kaldes.
function buildNedkoerselsfinale() {
  const riders = [];
  // 2 elite-nedkoersere.
  riders.push(entrant(idNum("r", 1), "hunter", abilities(52, {
    descending: 94, tempo: 85, endurance: 83, climbing: 72, aggression: 60, tactics: 64,
    positioning: 60, recovery: 68, durability: 76, punch: 48,
  })));
  riders.push(entrant(idNum("r", 2), "hunter", abilities(52, {
    descending: 90, tempo: 84, endurance: 81, climbing: 70, aggression: 56, tactics: 58,
    positioning: 55, recovery: 65, durability: 72, punch: 46,
  })));
  // 14 peloton-ryttere: samme hoeje cp-baseline som elite-nedkoerserne (saa
  // hele feltet overlever klatringen samlet), svag/moderat descending (25-37).
  for (let i = 3; i <= 16; i++) {
    riders.push(entrant(idNum("r", i), i % 4 === 0 ? "sprint_captain" : "helper", abilities(50, {
      descending: 25 + (i % 13),
      tempo: 84 + (i % 5),
      endurance: 81 + (i % 5),
      climbing: 69 + (i % 5),
      aggression: 45 + (i % 12),
      sprint: 50 + (i % 20),
      recovery: 55,
      durability: 55,
    })));
  }

  const route = {
    distance_km: 70,
    profile_type: "mountain",
    finale_type: "descent",
    segments: [
      { kind: "flat", from_km: 0, to_km: 40 },
      { kind: "climb", from_km: 40, to_km: 58, category: "3", avg_gradient: 5.5, top_elevation_m: 980 },
      { kind: "descent", from_km: 58, to_km: 68, technicality: 3 },
      { kind: "flat", from_km: 68, to_km: 70 },
    ],
    weather: { kind: "rain", wind_exposure: 0.2 },
    waypoints: [
      { kind: "kom", index: 0, name: "3. kategori-stigning", km: 58, category: "3" },
      { kind: "finish", index: 1, name: "Nedkoerselsmaal", km: 70 },
    ],
  };

  return {
    route,
    startlist: riders,
    orders: [],
    seed: "fixture-nedkoerselsfinale-v1",
    tuning: cloneTuning(),
  };
}

// ── Generering ───────────────────────────────────────────────────────────

const SCENARIOS = [
  { name: "flat-massespurt", build: buildFlatMassespurt },
  { name: "bjerg-selektion", build: buildBjergSelektion },
  { name: "punch-finale-forspring", build: buildPunchFinaleForspring },
  { name: "nedkoerselsfinale", build: buildNedkoerselsfinale },
];

function summarize(name, input, output) {
  const top5 = output.results.slice(0, 5).map((r) => `${r.rank}.${r.rider_id}(${r.group_id},${r.time_seconds}s)`);
  const splitEvents = output.timeline.events.filter((e) => e.type === "peloton_splits").length;
  const attackEvents = output.timeline.events.filter((e) => e.type === "finale_attack").length;
  const groupsAtFinish = new Set(output.results.map((r) => r.group_id)).size;
  console.log(`\n=== ${name} ===`);
  console.log(`  top5: ${top5.join(", ")}`);
  console.log(`  peloton_splits-events: ${splitEvents}, finale_attack-events: ${attackEvents}, grupper ved maal: ${groupsAtFinish}`);
}

mkdirSync(fixturesDir, { recursive: true });

for (const { name, build } of SCENARIOS) {
  const input = build();
  const output = simulateStageV4(input);
  summarize(name, input, output);

  const dir = path.join(fixturesDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "input.json"), `${JSON.stringify(input, null, 2)}\n`, "utf8");
  writeFileSync(path.join(dir, "expected.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

console.log("\nFixtures skrevet til", fixturesDir);
