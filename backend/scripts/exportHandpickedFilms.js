#!/usr/bin/env node
// backend/scripts/exportHandpickedFilms.js
//
// Race Engine v4 head-to-head-scorecard (#4030, #3855, 23/8-ejer-gate):
// eksporterer 5 HAANDPLUKKEDE v4-etape-film fra DEN AEGTE S3-kalender + AEGTE
// population (samme input som headToHeadV4.js's fulde koersel) — ikke de
// syntetiske --films-fixtures. Genbruger headToHeadV4.js's runHeadToHead()
// (samme motor-kald, samme seed-konvention) + formatFilmText() (samme
// tekst-format som --films) for at undgaa duplikeret formaterings-/koersels-
// logik.
//
// 100% READ-ONLY mod filsystemet — laeser kun de allerede eksporterede JSON-
// snapshots (exportPopulationSnapshot.js / exportSeasonStageProfiles.js's
// output), ingen DB-kald her.
//
// Feltstoerrelse: hovedscorecardet koerer paa HELE population'en (6328
// ryttere, statistisk styrke). For FILM er det bevidst anderledes — en 6328-
// rytters tidslinje er ulaeselig (peloton_splits-events dumper hele rider-id-
// lister) OG urealistisk (et rigtigt loeb har ~150-200 startere). Hver film
// traekker derfor et DETERMINISTISK sample paa FILM_FIELD_SIZE ryttere fra
// den samme aegte population (samme sampleField-helper som resten af
// harnessen, seedet pr. etape saa samplingen er reproducerbar) — dokumenteret
// her, ikke skjult, jf. filens egen metodologi-disciplin.
//
// Usage:
//   node backend/scripts/exportHandpickedFilms.js \
//     --population=<population-snapshot.json> \
//     --stages=<season-stage-profiles.json> \
//     --out=<mappe>

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { runHeadToHead, formatFilmText } from "./headToHeadV4.js";
import { stableSeed } from "../lib/raceSimulator.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { sampleField } from "./lib/headToHeadStats.js";

function argValue(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : fallback;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// De 5 haandplukkede arketyper (mor-spec §6 punkt 3 "haandplukkede skygge-
// film set med egne oejne") — valgt 23/8 blandt S3-kalenderens 392 unikke
// etaper (jf. scorecard-dokumentets metodologi-afsnit for udvaelgelses-
// begrundelse pr. etape).
const HANDPICKED = [
  {
    label: "01-flad-sprint-etape",
    race_id: "0009a768-0c2c-400a-acb3-caa566faab94",
    stage_number: 4,
    context: "Giro della Penisola, etape 4 (200km, flat/bunch_sprint, 0 stigninger)",
  },
  {
    label: "02-bjergetape",
    race_id: "0009a768-0c2c-400a-acb3-caa566faab94",
    stage_number: 16,
    context: "Giro della Penisola, etape 16 (160km, high_mountain/long_climb, 4 stigninger)",
  },
  {
    label: "03-monument",
    race_id: "426702d4-60cf-4b47-9b5e-1ade683a2154",
    stage_number: 1,
    context: "Polynormande Nouvelle (220km, classic/long_climb, enkeltdags-monument-analog)",
  },
  {
    label: "04-brostensklassiker",
    race_id: "745268dc-4b98-4882-a794-4dd8fe3a94c4",
    stage_number: 1,
    context: "L'Enfer du Nord (255km, cobbles/breakaway, enkeltdags-brostensmonument-analog)",
  },
  {
    label: "05-itt",
    race_id: "02c08272-24e6-4a87-b83e-d90cbf2a71b6",
    stage_number: 5,
    context: "Volta Algarvia, etape 5 (39km, itt/solo_tt)",
  },
];

const FILM_FIELD_SIZE = 180; // realistisk WorldTour-etape-feltstoerrelse

function main() {
  const populationPath = argValue("population");
  const stagesPath = argValue("stages");
  const outDir = argValue("out");
  if (!populationPath || !stagesPath || !outDir) {
    console.error("Usage: node backend/scripts/exportHandpickedFilms.js --population=<fil> --stages=<fil> --out=<mappe>");
    process.exit(2);
  }

  const fullPopulation = readJson(populationPath);
  const stagesFile = readJson(stagesPath);
  const allStages = Array.isArray(stagesFile) ? stagesFile : stagesFile.stages;

  const picked = [];
  for (const pick of HANDPICKED) {
    const row = allStages.find((s) => s.race_id === pick.race_id && s.stage_number === pick.stage_number);
    if (!row) {
      console.error(`ADVARSEL: fandt ikke ${pick.label} (race_id=${pick.race_id} stage=${pick.stage_number}) i --stages — springes over.`);
      continue;
    }
    picked.push({ ...pick, row });
  }

  if (picked.length === 0) {
    console.error("Ingen af de haandplukkede etaper blev fundet i --stages-filen.");
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  const paths = [];
  for (const pick of picked) {
    // Deterministisk sample pr. etape (seedet af race_id+stage_number, saa
    // samplingen er reproducerbar men uafhaengig paa tvaers af de 5 film).
    const rng = makeRng(stableSeed(`head-to-head-v4-films-2026-08-23:${pick.race_id}:${pick.stage_number}`));
    const sampledRiders = sampleField(rng, fullPopulation.riders, FILM_FIELD_SIZE);
    const sampledPopulation = { riders: sampledRiders };

    const [row] = runHeadToHead({
      population: sampledPopulation,
      stages: [pick.row],
      seedInput: "head-to-head-v4-films-2026-08-23",
    });

    const scenario = {
      name: `${pick.label} — ${pick.context}`,
      input: {
        route: row.raw.route,
        seed: `head-to-head-v4-films-2026-08-23:${row.raw.stageRow.stage_number}`,
        startlist: sampledRiders,
      },
    };
    const text = formatFilmText(scenario, row.raw.v4Output)
      + `

(Feltet er et deterministisk ${FILM_FIELD_SIZE}-rytter-sample af den fulde ${fullPopulation.riders.length}-rytters `
      + `S3-population — realistisk etape-feltstoerrelse. Hovedscorecardets §5-ankre er maalt paa den FULDE population.)`;
    const filePath = `${outDir}/${pick.label}.txt`;
    writeFileSync(filePath, text);
    paths.push(filePath);
    console.log(`  ${filePath}`);
  }
  console.log(`${paths.length} film-filer skrevet.`);
}

main();
