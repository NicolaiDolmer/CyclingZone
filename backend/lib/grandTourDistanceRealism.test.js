// #4288 — beviser at de tre Grand Tours rammer ejerens realisme-baand med DE TAL
// migrationen skriver.
//
// Hvorfor testen laeser migrationen i stedet for at hardkode 17/18/17: etapeantallet er
// katalogdata (race_pool.stages), og laengderne er generator-regler. De to kan drive fra
// hinanden uden at nogen opdager det — en migration der skriver 18 og en generator der er
// kalibreret til 17 giver et samlet snit uden for baandet, og INGEN test ville fange det,
// fordi hver halvdel er korrekt for sig. Testen henter derfor etapeantallet ud af
// database/2026-09-03-4288-gt-stage-counts-and-lengths.sql og genererer parcours'et med
// praecis de tal. Aendrer nogen migrationen, flytter testen sig med.
//
// INGEN PROD: alt input er literaler i denne fil. Maalingen er en ren funktion over
// profil-raekker (summarizeGrandTour nedenfor), saa den kan koere paa baade genererede
// raekker og paa raekker hentet fra databasen af et scorecard.
//
// Baandet er ejer-beslutningen 3/9, spejlet af GRAND_TOUR_DISTANCE_RULES i
// raceRouteRealismMetrics.js (#4709): samlet snit INKL. enkeltstart 155-170 km,
// landevejsetaper 165-185 km i snit, prolog mindst 8 km, enkeltstart mindst 25 km.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateRaceStageProfiles } from "./raceStageProfileGenerator.js";
import {
  GRAND_TOUR_DISTANCE_BANDS,
  GRAND_TOUR_PROLOGUE_DISTANCE_BAND,
  PROLOGUE_DISTANCE_BAND,
} from "./raceRouteGenerator.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATION = path.join(REPO_ROOT, "database", "2026-09-03-4288-gt-stage-counts-and-lengths.sql");
const SEED_CSV = path.join(REPO_ROOT, "scripts", "race_pool_seed.csv");

// Ejerens baand. Staar som literaler her med vilje: testen skal fejle hvis nogen loesner
// baandet i produktionskoden uden at have en ny ejer-beslutning.
const OVERALL_AVG_BAND = [155, 170];
const ROAD_AVG_BAND = [165, 185];
const PROLOGUE_BAND = [8, 14];
const ITT_BAND = [25, 40];

const TT_PROFILES = new Set(["itt", "itt_hilly", "ttt"]);

// De tre GT'er som de staar i kataloget (race_pool). external_id er seed-noeglen, saa
// tallene her er de samme parcours prod ville generere for den samme saeson.
const GRAND_TOURS = [
  { external_id: "d2045415269bc5a8", name: "Giro della Penisola", race_class: "GiroVuelta", csvName: "Giro della Penisola" },
  { external_id: "28d2e64796e82b54", name: "Tour de l'Hexagone", race_class: "TourFrance", csvName: "Tour de l'Hexagone" },
  { external_id: "93008619a50faeeb", name: "Vuelta Ibérica", race_class: "GiroVuelta", csvName: "Vuelta Ibérica" },
];

/**
 * Ren maaling af en Grand Tours etaperaekker. Ingen DB, ingen generator — tag imod de
 * raekker du har (genererede eller laeste) og giv de fire tal baandet handler om.
 * Prolog-klassifikationen er den samme som scorecardets: loebets FOERSTE etape, tempo-
 * profil, under enkeltstarts-gulvet. En kort tempoetape midt i loebet er ikke en prolog.
 * @param {Array<{stage_number:number, profile_type:string, distance_km:number}>} rows
 */
function summarizeGrandTour(rows) {
  const sorted = [...rows].sort((a, b) => a.stage_number - b.stage_number);
  const tt = sorted.filter((s) => TT_PROFILES.has(s.profile_type));
  const road = sorted.filter((s) => !TT_PROFILES.has(s.profile_type));
  const prologue = tt.find((s) => s.stage_number === sorted[0].stage_number && s.distance_km < ITT_BAND[0]) ?? null;
  const avg = (arr) => arr.reduce((sum, s) => sum + s.distance_km, 0) / arr.length;
  return {
    stageCount: sorted.length,
    totalKm: sorted.reduce((sum, s) => sum + s.distance_km, 0),
    overallAvgKm: avg(sorted),
    roadAvgKm: road.length ? avg(road) : null,
    prologueKm: prologue ? prologue.distance_km : null,
    ittKm: tt.filter((s) => s !== prologue).map((s) => s.distance_km),
  };
}

// Etapeantallet som migrationen faktisk skriver, laest ud af SQL'en. Formen er
// `update public.race_pool set stages = <n>, ... where external_id = '<id>' ...`.
function stagesFromMigration(sql, externalId) {
  const re = /update\s+public\.race_pool\s+set\s+stages\s*=\s*(\d+)[\s\S]*?where\s+external_id\s*=\s*'([0-9a-f]+)'/gi;
  for (const m of sql.matchAll(re)) {
    if (m[2] === externalId) return Number(m[1]);
  }
  return null;
}

// Etapeantallet i seed-CSV'en (spejlet, saa seedRacePool.js ikke ruller migrationen
// tilbage). Kolonner: Dato,Løb,Etaper,Kategori,Type.
function stagesFromSeedCsv(csv, raceName) {
  for (const line of csv.split(/\r?\n/)) {
    const cells = line.split(",");
    if (cells[1] !== raceName) continue;
    return Number(cells[2]);
  }
  return null;
}

const migrationSql = fs.readFileSync(MIGRATION, "utf8");
const seedCsv = fs.readFileSync(SEED_CSV, "utf8");

// Etapeantallet pr. GT: migrationen for de to der aendres, CSV'en for den der ikke gOEr.
const stagesFor = (gt) => stagesFromMigration(migrationSql, gt.external_id) ?? stagesFromSeedCsv(seedCsv, gt.csvName);

// Deterministiske saeson-noegler. Samme saet hver koersel → ingen flakiness.
const SEASON_KEYS = Array.from({ length: 200 }, (_, i) => `4288-season-${i}`);

function drawsFor(gt) {
  const stages = stagesFor(gt);
  return SEASON_KEYS.map((seasonId) => summarizeGrandTour(generateRaceStageProfiles({
    id: `test-race-${gt.external_id}`,
    external_id: gt.external_id,
    name: gt.name,
    race_class: gt.race_class,
    race_type: "stage_race",
    terrain_archetype: "grand_tour",
    stages,
    season_id: seasonId,
  })));
}

test("#4288: migrationen og seed-CSV'en er enige om etapeantallet 17/18/17", () => {
  assert.equal(stagesFromMigration(migrationSql, "d2045415269bc5a8"), 17, "Giro skal saettes til 17 i migrationen");
  assert.equal(stagesFromMigration(migrationSql, "28d2e64796e82b54"), 18, "Tour skal saettes til 18 i migrationen");
  assert.equal(stagesFromMigration(migrationSql, "93008619a50faeeb"), null, "Vueltaen er uaendret og maa ikke staa i migrationen");

  assert.equal(stagesFromSeedCsv(seedCsv, "Giro della Penisola"), 17);
  assert.equal(stagesFromSeedCsv(seedCsv, "Tour de l'Hexagone"), 18);
  assert.equal(stagesFromSeedCsv(seedCsv, "Vuelta Ibérica"), 17);
});

test("#4288: migrationen roerer kun kommende saesoner og aldrig haandredigerede etaper", () => {
  // S3 koerer. Sikkerhedsnettene skal vaere afgraenset praecis som i #4105's migration —
  // ellers ville en kOErt saeson kunne skifte etapelaengde midt i spillet.
  const stageProfileUpdates = migrationSql
    .split(/;\s*(?:\r?\n)/)
    .filter((stmt) => /update\s+public\.race_stage_profiles/i.test(stmt));
  assert.ok(stageProfileUpdates.length >= 2, "der skal vaere sikkerhedsnet for baade prolog og enkeltstart");
  for (const stmt of stageProfileUpdates) {
    assert.match(stmt, /s\.status\s*=\s*'upcoming'/, "hver etape-opdatering skal vaere laast til upcoming-saesoner");
    assert.match(stmt, /p\.is_manual\s*=\s*false/, "hver etape-opdatering skal fredes haandredigerede raekker");
  }
});

test("#4288: baandene i generatoren er ejerens tal (prolog 8-14, enkeltstart 25-40)", () => {
  assert.deepEqual([...GRAND_TOUR_PROLOGUE_DISTANCE_BAND], PROLOGUE_BAND);
  assert.deepEqual([...GRAND_TOUR_DISTANCE_BANDS.itt], ITT_BAND);
  // itt_hilly ligger i den korte ende af samme baand, men aldrig under gulvet.
  assert.ok(GRAND_TOUR_DISTANCE_BANDS.itt_hilly[0] >= ITT_BAND[0]);
  assert.ok(GRAND_TOUR_DISTANCE_BANDS.itt_hilly[1] <= ITT_BAND[1]);
  // Landevejs-baandene maa BEVIDST stikke uden for 165-185 i begge ender: ejerens baand
  // gaelder SNITTET, ikke den enkelte etape. En 190-195 km flad etape og en 160 km
  // hoejbjergsetape er begge realistiske — det er variationen der gOEr en GT til en GT.
  // Det der skal holde, er at hver etapetypes MIDTPUNKT ligger i baandet (saa snittet
  // trakker mod midten uanset terraen-multisaet), og at ingen GT-landevejsetape bliver
  // kortere end 155 km. Det faktiske udfald maales af testen "landevejssnittet ligger i
  // 165-185 km i hver eneste traekning" nedenfor.
  for (const type of ["flat", "rolling", "hilly", "mountain", "high_mountain"]) {
    const [lo, hi] = GRAND_TOUR_DISTANCE_BANDS[type];
    assert.ok(lo >= 155, `${type}-gulvet ${lo} km er for kort til en Grand Tour-etape`);
    const mid = (lo + hi) / 2;
    assert.ok(mid >= ROAD_AVG_BAND[0] && mid <= ROAD_AVG_BAND[1],
      `${type}-midtpunktet ${mid} ligger uden for ${ROAD_AVG_BAND.join("-")}`);
  }
  // Et almindeligt etapeloeb beholder sin korte prolog — GT-baandet maa ikke smitte.
  assert.deepEqual([...PROLOGUE_DISTANCE_BAND], [5, 8]);
});

test("#4288: hver enkelt tempoetape i en GT overholder gulvene i alle 200 traekninger", () => {
  for (const gt of GRAND_TOURS) {
    for (const [i, d] of drawsFor(gt).entries()) {
      if (d.prologueKm !== null) {
        assert.ok(d.prologueKm >= PROLOGUE_BAND[0] && d.prologueKm <= PROLOGUE_BAND[1],
          `${gt.name} traek ${i}: prolog ${d.prologueKm} km uden for ${PROLOGUE_BAND.join("-")}`);
      }
      for (const km of d.ittKm) {
        assert.ok(km >= ITT_BAND[0] && km <= ITT_BAND[1],
          `${gt.name} traek ${i}: enkeltstart ${km} km uden for ${ITT_BAND.join("-")}`);
      }
    }
  }
});

test("#4288: landevejssnittet ligger i 165-185 km i hver eneste traekning", () => {
  for (const gt of GRAND_TOURS) {
    for (const [i, d] of drawsFor(gt).entries()) {
      assert.ok(d.roadAvgKm >= ROAD_AVG_BAND[0] && d.roadAvgKm <= ROAD_AVG_BAND[1],
        `${gt.name} traek ${i}: landevejssnit ${d.roadAvgKm.toFixed(1)} km uden for ${ROAD_AVG_BAND.join("-")}`);
    }
  }
});

test("#4288: det samlede snit rammer 155-170 km i mindst 95 % af traekningerne", () => {
  // Hvorfor en andel og ikke "hver gang": det samlede snit afhaenger af HVOR MANGE
  // tempoetaper filleren giver (1 eller 2) og af om aabningen bliver prolog eller rigtig
  // enkeltstart. De fire kombinationer har hver deres vindue, og et enkelt baand kan ikke
  // ramme alle fire 100 %. Foer #4288 laa andelen paa 46-53 % (og S3's Tour UNDER gulvet);
  // med GT-baandene er den 96-99 %. Traekningerne er deterministiske, saa tallet er
  // reproducerbart — ikke en flaky test.
  for (const gt of GRAND_TOURS) {
    const draws = drawsFor(gt);
    const inBand = draws.filter((d) => d.overallAvgKm >= OVERALL_AVG_BAND[0] && d.overallAvgKm <= OVERALL_AVG_BAND[1]);
    const share = inBand.length / draws.length;
    assert.ok(share >= 0.95, `${gt.name}: kun ${(share * 100).toFixed(1)} % af traekningerne rammer ${OVERALL_AVG_BAND.join("-")} km`);
    // Snittet af snittene skal ligge komfortabelt inde i baandet, ikke paa kanten.
    const mean = draws.reduce((sum, d) => sum + d.overallAvgKm, 0) / draws.length;
    assert.ok(mean >= 158 && mean <= 167, `${gt.name}: middelsnit ${mean.toFixed(1)} km ligger paa kanten af baandet`);
  }
});

test("#4288: etapeantallet i parcours'et er praecis det migrationen skriver", () => {
  const expected = { "Giro della Penisola": 17, "Tour de l'Hexagone": 18, "Vuelta Ibérica": 17 };
  for (const gt of GRAND_TOURS) {
    for (const d of drawsFor(gt)) assert.equal(d.stageCount, expected[gt.name]);
  }
});

test("#4288: GT-baandet smitter ikke af paa almindelige etapeloeb", () => {
  // Samme generator, samme kald — kun arketypen er en anden. En sprinter-uge skal stadig
  // have sine egne laengder (DISTANCE_BANDS), ellers har #4288 aendret hele kataloget.
  const rows = generateRaceStageProfiles({
    id: "test-race-sprinters-week",
    external_id: "cz4270-c2-twente",
    name: "Ronde van Overijssel",
    race_class: "Class2",
    race_type: "stage_race",
    terrain_archetype: "sprinters_week",
    stages: 5,
    season_id: "4288-season-0",
  });
  const road = rows.filter((s) => !TT_PROFILES.has(s.profile_type));
  assert.ok(road.length > 0);
  assert.ok(road.some((s) => s.distance_km < GRAND_TOUR_DISTANCE_BANDS.flat[0]
    || s.distance_km > GRAND_TOUR_DISTANCE_BANDS.hilly[1]
    || rows.some((r) => TT_PROFILES.has(r.profile_type) && r.distance_km < ITT_BAND[0])),
    "en ikke-GT skal kunne ligge uden for GT-baandet");
});
