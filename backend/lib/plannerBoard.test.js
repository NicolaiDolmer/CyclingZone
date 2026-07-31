import test from "node:test";
import assert from "node:assert/strict";
import { RACE_V3_TUNING } from "./raceRoles.js";
import {
  scoreComponentToFormPoints,
  peakValueFormPoints,
  findPaybackCollisions,
  peakStatus,
  terrainKey,
  isSummitFinish,
  stageProfileStrip,
  raceProfileSummary,
  countRivalPeaks,
  teamDivisionKnownForSeason,
  raceCardPeakOverlay,
  PEAK_STATUS_ONTRACK_TQ,
} from "./plannerBoard.js";

test("peakStatus: optakt ikke begyndt → pending uanset tq", () => {
  // window_start = 100, leadup 14 → optakt starter dag 86. today 80 < 86.
  assert.equal(peakStatus({ trainingQuality: 0.95, todayOrdinal: 80, windowStartOrdinal: 100, leadupDays: 14 }), "pending");
});

test("peakStatus: optakt kører + høj tq → on_track", () => {
  assert.equal(peakStatus({ trainingQuality: 0.8, todayOrdinal: 90, windowStartOrdinal: 100, leadupDays: 14 }), "on_track");
});

test("peakStatus: optakt kører + lav tq → at_risk", () => {
  assert.equal(peakStatus({ trainingQuality: 0.44, todayOrdinal: 95, windowStartOrdinal: 100, leadupDays: 14 }), "at_risk");
});

test("peakStatus: tq lig tærsklen → on_track (inklusiv)", () => {
  assert.equal(peakStatus({ trainingQuality: PEAK_STATUS_ONTRACK_TQ, todayOrdinal: 95, windowStartOrdinal: 100, leadupDays: 14 }), "on_track");
});

test("peakStatus: manglende tq under optakt → pending", () => {
  assert.equal(peakStatus({ trainingQuality: null, todayOrdinal: 95, windowStartOrdinal: 100, leadupDays: 14 }), "pending");
});

test("terrainKey: mapper profiler til buckets, ukendt → flat", () => {
  assert.equal(terrainKey("high_mountain"), "mountain");
  assert.equal(terrainKey("rolling"), "hilly");
  assert.equal(terrainKey("itt"), "itt");
  assert.equal(terrainKey("cobbles"), "cobbles");
  assert.equal(terrainKey(undefined), "flat");
  assert.equal(terrainKey("nonsense"), "flat");
});

test("isSummitFinish: bjerg-profil ELLER lang-klatrings-finale", () => {
  assert.equal(isSummitFinish("mountain", null), true);
  assert.equal(isSummitFinish("high_mountain", "bunch_sprint"), true);
  assert.equal(isSummitFinish("hilly", "long_climb"), true);
  assert.equal(isSummitFinish("flat", "bunch_sprint"), false);
  assert.equal(isSummitFinish("rolling", "punch"), false);
});

test("stageProfileStrip: sorterer efter stage_number + markerer summit", () => {
  const strip = stageProfileStrip([
    { stage_number: 2, profile_type: "flat", finale_type: "bunch_sprint" },
    { stage_number: 1, profile_type: "mountain", finale_type: "long_climb" },
    { stage_number: 3, profile_type: "itt", finale_type: "solo_tt" },
  ]);
  assert.deepEqual(strip, [
    { stage: 1, terrain: "mountain", summit: true },
    { stage: 2, terrain: "flat", summit: false },
    { stage: 3, terrain: "itt", summit: false },
  ]);
});

test("raceProfileSummary: tæller etaper + summit finishes", () => {
  const strip = stageProfileStrip([
    { stage_number: 1, profile_type: "flat" },
    { stage_number: 2, profile_type: "mountain", finale_type: "long_climb" },
    { stage_number: 3, profile_type: "high_mountain" },
  ]);
  assert.deepEqual(raceProfileSummary(strip), { stages: 3, summitFinishes: 2 });
});

test("countRivalPeaks: distinkte rival-hold pr. løb, mit hold ekskluderet", () => {
  const rows = [
    { target_race_id: "r1", team_id: "me" },     // mit — tælles ikke
    { target_race_id: "r1", team_id: "rivalA" },
    { target_race_id: "r1", team_id: "rivalB" },
    { target_race_id: "r1", team_id: "rivalA" },  // dublet-hold → tælles én gang
    { target_race_id: "r2", team_id: "rivalA" },
    { target_race_id: null, team_id: "rivalC" },   // intet mål — ignoreres
  ];
  const counts = countRivalPeaks(rows, "me");
  assert.equal(counts.get("r1"), 2);
  assert.equal(counts.get("r2"), 1);
  assert.equal(counts.has("r3"), false);
});

test("countRivalPeaks: løb hvor kun mit hold topper → ingen entry", () => {
  const counts = countRivalPeaks([{ target_race_id: "r1", team_id: "me" }], "me");
  assert.equal(counts.has("r1"), false);
});

// ── #3018 · holdets division er ikke afgjort for en kommende sæson ────────────

test("teamDivisionKnownForSeason: 'upcoming' → divisionen er IKKE afgjort", () => {
  // Kernen i #3018: teams.league_division_id beskriver den AKTIVE sæson. For en
  // sæson der ikke er startet, afgøres divisionen først ved sæsonskiftet, så den
  // nuværende division må ikke bruges til at markere "mine løb".
  assert.equal(teamDivisionKnownForSeason("upcoming"), false);
});

test("teamDivisionKnownForSeason: aktiv/afsluttet sæson → divisionen ER afgjort", () => {
  assert.equal(teamDivisionKnownForSeason("active"), true);
  assert.equal(teamDivisionKnownForSeason("completed"), true);
});

test("teamDivisionKnownForSeason: gaten ophæver sig selv ved cutoveren", () => {
  // compressPyramid.js skriver de nye league_division_id FØR transitionen
  // promoverer sæsonen 'upcoming' → 'active'. I det øjeblik status flipper er
  // divisionen både opdateret og korrekt, uden ny deploy.
  assert.equal(teamDivisionKnownForSeason("upcoming"), false);
  assert.equal(teamDivisionKnownForSeason("active"), true);
});

test("teamDivisionKnownForSeason: ukendt/manglende status blokerer ikke planlægning", () => {
  // Fail-open er det rigtige her: kun 'upcoming' er den kendte usikre tilstand.
  // En uventet status må ikke låse den aktive sæsons planlægger ned.
  assert.equal(teamDivisionKnownForSeason(null), true);
  assert.equal(teamDivisionKnownForSeason(undefined), true);
});

// ── Konsekvens i formpoint (#2905) ──────────────────────────────────────────
// Assertions bindes til KONSTANTERNE, ikke til hardkodede tal. Tunes balancen
// (PEAK_MAX m.fl. er startkandidater indtil S5-harness-sweepet, jf. raceRoles.js),
// skal testene følge med af sig selv i stedet for at blive falsk røde — og en
// hardkodet forventning her ville være præcis den divergens omregningen findes for.

test("scoreComponentToFormPoints: ét formpoint er FORM_RACE_WEIGHT_V3/50 i score-space", () => {
  const w = RACE_V3_TUNING.FORM_RACE_WEIGHT_V3;
  assert.equal(scoreComponentToFormPoints(w / 50), 1);
  assert.equal(scoreComponentToFormPoints(w), 50, "fuld vægt = halvdelen af 0-100-spændet");
  assert.equal(scoreComponentToFormPoints(0), 0);
  assert.equal(scoreComponentToFormPoints(-w / 50), -1, "fortegn bevares");
});

test("scoreComponentToFormPoints: ugyldig vægt eller komponent → null (ingen division med nul)", () => {
  assert.equal(scoreComponentToFormPoints(0.02, { FORM_RACE_WEIGHT_V3: 0 }), null);
  assert.equal(scoreComponentToFormPoints(0.02, { FORM_RACE_WEIGHT_V3: -1 }), null);
  assert.equal(scoreComponentToFormPoints(Number.NaN), null);
  assert.equal(scoreComponentToFormPoints(undefined), null);
});

test("peakValueFormPoints: gulv og loft følger PEAK_MAX × PEAK_TQ_FLOOR..1", () => {
  const v = peakValueFormPoints({});
  assert.equal(v.ceiling, scoreComponentToFormPoints(RACE_V3_TUNING.PEAK_MAX));
  assert.equal(v.floor, scoreComponentToFormPoints(RACE_V3_TUNING.PEAK_MAX * RACE_V3_TUNING.PEAK_TQ_FLOOR));
  assert.equal(v.payback, scoreComponentToFormPoints(-RACE_V3_TUNING.PEAK_PAYBACK));
  assert.ok(v.ceiling > v.floor, "loftet skal ligge over gulvet, ellers er peaken meningsløs");
  assert.ok(v.payback < 0, "payback er en omkostning");
});

test("peakValueFormPoints: ukendt træningskvalitet → current er null, spændet står alene", () => {
  // Den ærlige tilstand på planlægningstidspunktet: optakten er ikke redet endnu,
  // så et konkret estimat ville være opdigtet.
  assert.equal(peakValueFormPoints({}).current, null);
  assert.equal(peakValueFormPoints({ trainingQuality: null }).current, null);
  assert.equal(peakValueFormPoints({ trainingQuality: Number.NaN }).current, null);
});

test("peakValueFormPoints: current skalerer med træningskvalitet og clampes som motoren", () => {
  const v = peakValueFormPoints({});
  assert.equal(peakValueFormPoints({ trainingQuality: 1 }).current, v.ceiling);
  assert.equal(peakValueFormPoints({ trainingQuality: RACE_V3_TUNING.PEAK_TQ_FLOOR }).current, v.floor);
  // Under gulvet clampes op (computeTrainingQuality gør det samme), så UI'et aldrig
  // lover en værdi motoren ikke ville realisere.
  assert.equal(peakValueFormPoints({ trainingQuality: 0 }).current, v.floor);
  assert.equal(peakValueFormPoints({ trainingQuality: -5 }).current, v.floor);
  assert.equal(peakValueFormPoints({ trainingQuality: 99 }).current, v.ceiling);
  // Monotont: bedre optakt er aldrig værd mindre.
  const mid = peakValueFormPoints({ trainingQuality: 0.75 }).current;
  assert.ok(mid > v.floor && mid < v.ceiling, "midt-optakt ligger mellem gulv og loft");
});

test("findPaybackCollisions: kun løb i vinduet EFTER peaken tæller", () => {
  const paybackDays = RACE_V3_TUNING.PEAK_PAYBACK_DAYS;
  const windows = [{ targetRaceId: "peak-race", endOrdinal: 100 }];
  const otherRaces = [
    { raceId: "before", ord: 99 },            // før peaken
    { raceId: "same-day", ord: 100 },         // selve peak-vinduets sidste dag
    { raceId: "first-day-after", ord: 101 },  // første payback-dag
    { raceId: "last-day-after", ord: 100 + paybackDays },
    { raceId: "just-outside", ord: 100 + paybackDays + 1 },
  ];
  const hits = findPaybackCollisions({ windows, otherRaces });
  assert.deepEqual(hits.map((h) => h.raceId), ["first-day-after", "last-day-after"]);
  assert.equal(hits[0].daysAfterPeak, 1);
  assert.equal(hits[0].peakTargetRaceId, "peak-race");
  assert.equal(hits[1].daysAfterPeak, paybackDays);
});

test("findPaybackCollisions: tomt/ugyldigt input giver tom liste, ikke et brag", () => {
  assert.deepEqual(findPaybackCollisions({}), []);
  assert.deepEqual(findPaybackCollisions({ windows: [{ endOrdinal: Number.NaN }], otherRaces: [{ raceId: "r", ord: 5 }] }), []);
  assert.deepEqual(findPaybackCollisions({ windows: [{ endOrdinal: 10 }], otherRaces: [{ raceId: "r", ord: Number.NaN }] }), []);
  assert.deepEqual(
    findPaybackCollisions({ windows: [{ endOrdinal: 10 }], otherRaces: [{ raceId: "r", ord: 11 }], tuning: { PEAK_PAYBACK_DAYS: 0 } }),
    [], "payback-vindue på 0 dage kan ikke kollidere"
  );
});

test("findPaybackCollisions: flere peaks rapporteres hver for sig, kronologisk", () => {
  const windows = [
    { targetRaceId: "peak-b", endOrdinal: 200 },
    { targetRaceId: "peak-a", endOrdinal: 100 },
  ];
  const otherRaces = [{ raceId: "after-b", ord: 203 }, { raceId: "after-a", ord: 102 }];
  const hits = findPaybackCollisions({ windows, otherRaces });
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.daysAfterPeak), [2, 3], "sorteret på afstand til peaken");
  assert.equal(hits.find((h) => h.raceId === "after-a").peakTargetRaceId, "peak-a");
  assert.equal(hits.find((h) => h.raceId === "after-b").peakTargetRaceId, "peak-b");
});

// ── #3102 PR 2: peaks/payback-overlay pr. løbskort (Holdudtagelse) ───────────

test("raceCardPeakOverlay: ryttere der topper her + ryttere i payback her", () => {
  const plans = [
    { riderId: "r1", targetRaceId: "race-x", windowEndOrd: 100 },       // topper her
    { riderId: "r2", targetRaceId: "race-y", windowEndOrd: 97 },        // payback: 100-97=3 dage efter
    { riderId: "r3", targetRaceId: "race-z", windowEndOrd: 80 },        // for længe siden — ingen payback
  ];
  const out = raceCardPeakOverlay({ raceId: "race-x", raceOrdinal: 100, plans });
  assert.deepEqual(out.peakRiderIds, ["r1"]);
  assert.deepEqual(out.paybackRiders, [{ riderId: "r2", daysAfterPeak: 3 }]);
});

test("raceCardPeakOverlay: payback-intervallet er end+1 .. end+PEAK_PAYBACK_DAYS (samme grænse som findPaybackCollisions)", () => {
  const days = RACE_V3_TUNING.PEAK_PAYBACK_DAYS;
  const plan = (ord) => raceCardPeakOverlay({
    raceId: "race-x", raceOrdinal: ord,
    plans: [{ riderId: "r1", targetRaceId: "race-y", windowEndOrd: 100 }],
  }).paybackRiders.length;
  assert.equal(plan(100), 0, "løbsdag inde i vinduet er ikke payback");
  assert.equal(plan(101), 1, "dagen efter vindue-slut er payback");
  assert.equal(plan(100 + days), 1, "sidste payback-dag tæller med");
  assert.equal(plan(100 + days + 1), 0, "dagen efter payback-vinduet er fri");
});

test("raceCardPeakOverlay: en rytter der topper her vises ikke også som payback her", () => {
  const out = raceCardPeakOverlay({
    raceId: "race-x", raceOrdinal: 100,
    plans: [
      { riderId: "r1", targetRaceId: "race-x", windowEndOrd: 102 },
      { riderId: "r1", targetRaceId: "race-y", windowEndOrd: 97 },
    ],
  });
  assert.deepEqual(out.peakRiderIds, ["r1"]);
  assert.deepEqual(out.paybackRiders, [], "peak-bumpet definerer løbsdagen — ikke den anden peaks formhul");
});

test("raceCardPeakOverlay: to peaks i payback over samme dag → nærmeste (dybeste) afstand vises", () => {
  const out = raceCardPeakOverlay({
    raceId: "race-x", raceOrdinal: 100,
    plans: [
      { riderId: "r1", targetRaceId: "race-y", windowEndOrd: 98 },
      { riderId: "r1", targetRaceId: "race-z", windowEndOrd: 94 },
    ],
  });
  assert.deepEqual(out.paybackRiders, [{ riderId: "r1", daysAfterPeak: 2 }]);
});

test("raceCardPeakOverlay: defensiv mod manglende ordinaler/tuning", () => {
  assert.deepEqual(
    raceCardPeakOverlay({ raceId: "race-x", raceOrdinal: null, plans: [{ riderId: "r1", targetRaceId: "race-y", windowEndOrd: 97 }] }).paybackRiders,
    [], "uden løbs-ordinal ingen payback-gæt"
  );
  assert.deepEqual(
    raceCardPeakOverlay({ raceId: "race-x", raceOrdinal: 100, plans: [{ riderId: "r1", targetRaceId: "race-y", windowEndOrd: null }] }).paybackRiders,
    []
  );
  const out = raceCardPeakOverlay({ raceId: "race-x", raceOrdinal: 100, plans: [{ riderId: "r1", targetRaceId: "race-y", windowEndOrd: 97 }], tuning: { PEAK_PAYBACK_DAYS: 0 } });
  assert.deepEqual(out.paybackRiders, [], "payback-vindue på 0 dage kan ikke kollidere");
});
