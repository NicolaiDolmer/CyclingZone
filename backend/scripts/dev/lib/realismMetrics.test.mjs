// #7588 realisme-gate PR 1: målemodulet. Syntetiske timelines og rækker (hard
// rule 17): ingen målte tal, alle værdier er opdigtede testværdier.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DECILES, MEASUREMENT_CONTRACT, PLATEAU_DECILE, ROW_FIELDS, breakawayTrajectory, breakawayTrajectoryRowFacts,
  cellKeysOf, computeRealismMetrics, finishOf, gcGroupOf, quantile, stageCellOf,
} from "./realismMetrics.mjs";
import { shortStageRaceGroup, stageMetrics } from "./tourScorecard.mjs";
import { REALISM_FINISHES, parseCellKey } from "../../../lib/realismGateBands.ts";

const formed = (km, groupId = "breakaway-0", extra = {}) => ({ km, type: "breakaway_formed", params: { group_id: groupId, rider_ids: ["a", "b"], ...extra } });
const gap = (km, sep, groupId = "breakaway-0") => ({ km, type: "gap_update", params: { group_id: groupId, gap_seconds: 0, chase_group_id: "peloton-0", separation_seconds: sep } });
const caught = (km, exactKm, groupId = "breakaway-0") => ({ km, type: "breakaway_caught", params: { group_id: groupId, rider_ids: ["a", "b"], ...(exactKm === undefined ? {} : { exact_km: exactKm }) } });

const SURVIVED = [
  formed(5),
  gap(10, 60), gap(20, 200), gap(30, 300), gap(40, 250), gap(55, 250), gap(70, 120), gap(90, 60),
  { km: 100, type: "finish", params: {} },
];

test("#7588 forløb: tiendedele, top og plateau ud fra motorens gap_update", () => {
  const t = breakawayTrajectory(SURVIVED, 100);
  assert.equal(t.formed, true);
  assert.equal(t.measured, true);
  assert.equal(t.maxLead, 300);
  assert.equal(t.peakFrac, 0.3);
  // d0: dannet, men intet punkt endnu. Et punkt PAA stykkets start erstatter forspringet fra før.
  assert.deepEqual(t.leadByDecile, [null, 60, 200, 300, 250, 250, 250, 120, 120, 60]);
  assert.equal(t.plateau, 250 / 300);
  assert.equal(t.caughtKm, null);
  assert.equal(t.caughtKmToGo, null);
});

test("#7588 forløb: hentet udbrud findes ikke efter indhentningen; exact_km vinder over km", () => {
  const events = [formed(5), gap(10, 100), gap(30, 200), gap(45, 50), caught(50, 45.5), gap(50, 0)];
  const t = breakawayTrajectory(events, 100);
  assert.equal(t.caughtKm, 45.5);
  assert.equal(t.caughtKmToGo, 54.5);
  assert.deepEqual(t.leadByDecile.slice(5), [null, null, null, null, null]);
  assert.equal(t.leadByDecile[4], 200);
  assert.equal(t.plateau, 0, "hentet før plateauet = intet forspring holdt");
});

test("#7588 forløb: kun morgenudbruddet; et nyt udbrud og andre grupper tæller ikke", () => {
  const events = [
    formed(5), gap(10, 100), caught(20, 20),
    formed(30, "breakaway-500", { reformation: true }), gap(40, 900, "breakaway-500"),
    { km: 40, type: "gap_update", params: { group_id: "peloton-0", gap_seconds: 900 } },
  ];
  const t = breakawayTrajectory(events, 100);
  assert.equal(t.maxLead, 100);
  assert.equal(t.caughtKm, 20);
});

test("#7588 forløb: intet udbrud, ingen punkter eller ingen distance er ikke en nul-måling", () => {
  assert.deepEqual(breakawayTrajectory([], 100), { formed: false, measured: false, maxLead: null, peakFrac: null, leadByDecile: null, plateau: null, caughtKm: null, caughtKmToGo: null });
  const noSamples = breakawayTrajectory([formed(5), caught(60, 60)], 100);
  assert.equal(noSamples.formed, true);
  assert.equal(noSamples.measured, false);
  assert.equal(noSamples.leadByDecile, null);
  assert.equal(noSamples.caughtKmToGo, 40, "fangsten er motorens event og måles uden forløb");
  assert.equal(breakawayTrajectory(SURVIVED, null).measured, false);
  assert.equal(breakawayTrajectory(null, 100).formed, false);
});

test("#7588 forløb: dannet sent er null i stykkerne før", () => {
  const t = breakawayTrajectory([formed(35), gap(40, 80), gap(60, 150)], 100);
  assert.deepEqual(t.leadByDecile.slice(0, 3), [null, null, null]);
  assert.equal(t.leadByDecile[3], null, "dannet i stykket, men intet punkt endnu");
  assert.equal(t.leadByDecile[4], 80);
});

test("#7588 rækkefelterne er tre navngivne felter fra forløbet", () => {
  const facts = breakawayTrajectoryRowFacts(SURVIVED, 100);
  assert.deepEqual(Object.keys(facts).sort(), ["breakawayCaughtKmToGo", "breakawayLeadByDecile", "breakawayPeakFrac"]);
  assert.equal(facts.breakawayLeadByDecile.length, DECILES);
});

test("#7588 tourScorecard.stageMetrics bærer forløbet på vejetaper, ikke på enkeltstart", () => {
  const out = { results: [], timeline: { events: SURVIVED }, groupSnapshots: [] };
  const res = { v4Output: out, ranked: [], timeline: out.timeline };
  const road = stageMetrics({ res, profile: { stage_number: 1, profile_type: "flat", finale_type: "flat_sprint", distance_km: 100 }, gcBefore: [], abilitiesById: new Map(), teamByRider: new Map() });
  assert.equal(road.breakawayLeadByDecile.length, DECILES);
  assert.equal(road.breakawayPeakFrac, 0.3);
  assert.equal(road.breakawayCaughtKmToGo, null);
  const itt = stageMetrics({ res, profile: { stage_number: 2, profile_type: "itt", finale_type: "solo_tt", distance_km: 20 }, gcBefore: [], abilitiesById: new Map(), teamByRider: new Map() });
  assert.equal("breakawayLeadByDecile" in itt, false);
});

test("#7588 celler: afslutnings-spande, løbsgrupper og jokertegn", () => {
  assert.equal(finishOf({ profile_type: "mountain", finale_type: "long_climb" }), "summit");
  assert.equal(finishOf({ profile_type: "high_mountain", finale_type: "descent" }), "descent");
  assert.equal(finishOf({ profile_type: "flat", finale_type: "bunch_sprint" }), "sprint", "alias opløses");
  assert.equal(finishOf({ profile_type: "hilly", finale_type: "wall_finish" }), "punch");
  assert.equal(finishOf({ profile_type: "itt", finale_type: null }), "tt");
  assert.equal(finishOf({ profile_type: "flat", finale_type: null }), "other");
  for (const f of ["summit", "descent", "sprint", "punch", "tt", "other"]) assert.ok(REALISM_FINISHES.includes(f));
  assert.deepEqual(stageCellOf({ stageCount: 1, profile: { profile_type: "cobbles", finale_type: "flat_sprint" } }), { group: "one_day", terrain: "cobbles", finish: "sprint" });
  assert.equal(stageCellOf({ stageCount: 21, profile: { profile_type: "flat" } }).group, "gt");
  assert.equal(stageCellOf({ stageCount: 1, raceGroup: "monument", profile: { profile_type: "classic" } }).group, "monument");
  const keys = cellKeysOf({ group: "stage_race", terrain: "mountain", finish: "summit" });
  assert.equal(keys.length, 8);
  assert.ok(keys.includes("stage_race|mountain|summit") && keys.includes("*|*|*") && keys.includes("*|mountain|*"));
  for (const k of keys) assert.ok(parseCellKey(k), `schemaet kender ${k}`);
});

test("#7588 klassements-grupper har samme grænser som tourScorecard", () => {
  for (let n = 1; n <= 25; n++) {
    const sr = shortStageRaceGroup(n);
    if (sr) assert.equal(gcGroupOf(n), sr, `n=${n}`);
    else assert.ok(gcGroupOf(n) === null || gcGroupOf(n) === "gt", `n=${n}`);
  }
  assert.equal(gcGroupOf(1), null);
  assert.equal(gcGroupOf(21), "gt");
});

test("#7588 kvantil: lineær interpolation, tomme lister er null", () => {
  assert.equal(quantile([], 0.9), null);
  assert.equal(quantile([5], 0.9), 5);
  assert.equal(quantile([0, 10], 0.9), 9);
  assert.equal(quantile([3, 1, 2, null, "x"], 0.5), 2);
});

// ── Aggregering ──────────────────────────────────────────────────────────────

const deciles = (peak, caughtAt = null) => Array.from({ length: DECILES }, (_, d) => (caughtAt !== null && d >= caughtAt ? null : d === 2 ? peak : peak / 2));
const row = (over) => ({ stage: 1, profile_type: "mountain", finale_type: "long_climb", gapTo10: 100, breakawayWon: false, breakawaySize: 5, winnerId: "w1", ...over });

function corpus() {
  return [
    {
      raceId: "race-A", stageCount: 3,
      perSeed: [
        { gcFinalTo10: 300, gcWinnerMargin: 20, rows: [
          row({ stage: 1, gapTo10: 100, breakawayLeadByDecile: deciles(400), breakawayPeakFrac: 0.25, breakawayCaughtKmToGo: 10 }),
          row({ stage: 2, gapTo10: 40, breakawayWon: true, breakawayLeadByDecile: deciles(800), breakawayPeakFrac: 0.35, breakawayCaughtKmToGo: null, winnerId: "w2" }),
          row({ stage: 3, profile_type: "itt", finale_type: "solo_tt", gapTo10: 60, ittGapTo10Per40Km: 80, breakawayWon: null, breakawaySize: null, winnerId: "w3" }),
        ] },
        { gcFinalTo10: 500, gcWinnerMargin: 40, rows: [
          row({ stage: 1, gapTo10: 200, breakawayLeadByDecile: deciles(600, 4), breakawayPeakFrac: 0.2, breakawayCaughtKmToGo: 60 }),
          row({ stage: 2, gapTo10: 300, breakawayLeadByDecile: null }), // dannet, men forløbet mangler
          row({ stage: 3, profile_type: "itt", finale_type: "solo_tt", ittGapTo10Per40Km: 120, breakawayWon: null, breakawaySize: null }),
        ] },
      ],
    },
    { raceId: "race-B", stageCount: 21, perSeed: [{ gcFinalTo10: 900, gcWinnerMargin: 100, rows: [row({ stage: 7, profile_type: "flat", finale_type: "flat_sprint", gapTo10: 0, breakawayLeadByDecile: deciles(200, 6), breakawayCaughtKmToGo: 15, breakawayPeakFrac: 0.3 })] }] },
  ];
}

test("#7588 M1-M8 pr. celle; effektiv n = distinkte ruter", () => {
  const out = computeRealismMetrics({ races: corpus(), params: { bigLeadSeconds: 500, hardCapSeconds: 700 } });
  const c = out.cells["stage_race|mountain|summit"];
  assert.equal(c.observations, 4);
  assert.equal(c.routes, 2, "to ruter x to seeds");
  const m = c.metrics;
  assert.deepEqual([m.gapTo10.n, m.gapTo10.median], [3, 200], "udbrudssejren er ude af M1");
  assert.deepEqual([m.breakawayWinShare.n, m.breakawayWinShare.share], [4, 0.25]);
  assert.deepEqual([m.breakawayMaxLead.n, m.breakawayMaxLead.median, m.breakawayMaxLead.missing], [3, 600, 1]);
  assert.deepEqual([m.bigLeadShare.share, m.bigLeadShare.missingParam], [2 / 3, false]);
  assert.equal(m.overHardCapCount.count, 1);
  assert.equal(m.breakawayPeakFrac.median, 0.25);
  // plateau: 400 -> (400/2)/400, 800 -> (800/2)/800, hentet i stykke 4 -> 0.
  assert.equal(m.breakawayPlateau.median, 0.5);
  assert.deepEqual([m.breakawayCaughtKmToGo.n, m.breakawayCaughtKmToGo.median], [2, 35]);
  assert.equal(c.leadByDecile.length, DECILES);
  assert.deepEqual(c.leadByDecile[2], { n: 3, median: 600 });
  assert.deepEqual(c.leadByDecile[PLATEAU_DECILE], { n: 2, median: 300 }, "kun etaper hvor udbruddet stadig findes");
});

test("#7588 M1: ukendt udbrudsudfald tæller som manglende, ikke i gabet", () => {
  const out = computeRealismMetrics({ races: [{ raceId: "race-U", stageCount: 1, perSeed: [{ rows: [
    row({ stage: 1, profile_type: "flat", finale_type: "flat_sprint", gapTo10: 5 }),
    row({ stage: 2, profile_type: "flat", finale_type: "flat_sprint", gapTo10: 400, breakawayWon: null }),
    row({ stage: 3, profile_type: "flat", finale_type: "flat_sprint", gapTo10: 300, breakawayWon: undefined }),
    row({ stage: 4, profile_type: "flat", finale_type: "flat_sprint", gapTo10: null }),
    row({ stage: 5, profile_type: "flat", finale_type: "flat_sprint", gapTo10: 900, breakawayWon: true }),
  ] }] }] });
  const m = Object.values(out.cells).find((c) => c.key.includes("flat")).metrics;
  assert.deepEqual([m.gapTo10.n, m.gapTo10.median, m.gapTo10.missing], [1, 5, 3], "kun kendt nej i M1; sejren er hverken med eller manglende");
});

test("#7588 enkeltstart: M1 pr. km, ude af udbrudsmålene", () => {
  const out = computeRealismMetrics({ races: corpus() });
  const m = out.cells["stage_race|itt|tt"].metrics;
  assert.deepEqual([m.ittGapTo10PerKm.n, m.ittGapTo10PerKm.median], [2, 2.5]);
  assert.equal(m.gapTo10.n, 0);
  assert.equal(m.breakawayWinShare.n, 0);
  assert.equal(m.breakawayWinShare.missing, 0);
  assert.equal(m.breakawayMaxLead.n, 0);
});

test("#7588 jokertegn-celler samler; uden tærskler er M4/M5 manglende, ikke 0", () => {
  const out = computeRealismMetrics({ races: corpus() });
  assert.equal(out.cells["*|*|*"].observations, 7);
  assert.equal(out.cells["*|*|*"].routes, 4);
  assert.equal(out.cells["gt|flat|sprint"].metrics.breakawayCaughtKmToGo.median, 15);
  const m = out.cells["stage_race|mountain|*"].metrics;
  assert.equal(m.bigLeadShare.share, null);
  assert.equal(m.bigLeadShare.missingParam, true);
  assert.equal(m.overHardCapCount.count, null);
  assert.equal(out.contractVersion, MEASUREMENT_CONTRACT.version);
});

test("#7588 M9: favoritandel kræver favoritterne pr. rute; ellers manglende", () => {
  const favourites = new Map([["race-A", new Map([[1, ["w1", "x", "y"]], [2, ["x", "w2", "y"]]])]]);
  const m = computeRealismMetrics({ races: corpus(), favourites }).cells["stage_race|mountain|summit"].metrics;
  assert.deepEqual([m.favouriteWinShare.n, m.favouriteWinShare.share], [4, 0.75]);
  assert.equal(m.bestRiderWinShare.share, 0.5);
  const none = computeRealismMetrics({ races: corpus() }).cells["stage_race|mountain|summit"].metrics;
  assert.equal(none.favouriteWinShare.share, null);
  assert.equal(none.favouriteWinShare.missing, 4);
  // Codex: et løb uden favoritter tæller som manglende, ikke tabt af nævneren.
  const partial = computeRealismMetrics({ races: corpus(), favourites }).cells["*|*|*"].metrics.favouriteWinShare;
  assert.equal(partial.missing, 3, "race-A's to enkeltstarter + race-B's etape mangler favoritter");
});

test("#7588 M8: fangsten måles også når forspringspunkterne mangler (Codex)", () => {
  const races = [{ raceId: "r", stageCount: 1, perSeed: [{ rows: [row({ profile_type: "flat", finale_type: "flat_sprint", breakawayLeadByDecile: null, breakawayCaughtKmToGo: 40 })] }] }];
  const m = computeRealismMetrics({ races }).cells["one_day|flat|sprint"].metrics;
  assert.deepEqual([m.breakawayCaughtKmToGo.n, m.breakawayCaughtKmToGo.median], [1, 40]);
  assert.equal(m.breakawayMaxLead.missing, 1);
});

test("#7588 M10/M11: klassementet pr. gruppe, pr. løb", () => {
  const out = computeRealismMetrics({ races: corpus() });
  assert.deepEqual(Object.keys(out.gcGroups).sort(), ["gt", "sr2-4"]);
  assert.deepEqual([out.gcGroups["sr2-4"].routes, out.gcGroups["sr2-4"].metrics.gcFinalTo10.median], [1, 400]);
  assert.equal(out.gcGroups["sr2-4"].metrics.gcWinnerMargin.median, 30);
  assert.equal(out.gcGroups.gt.metrics.gcFinalTo10.median, 900);
});

test("#7588 målekontrakt: felter uden for ROW_FIELDS (fx ordrens indsats) ændrer aldrig en måling", () => {
  const base = computeRealismMetrics({ races: corpus(), params: { bigLeadSeconds: 500, hardCapSeconds: 700 } });
  const noisy = corpus().map((race) => ({
    ...race,
    perSeed: race.perSeed.map((s) => ({ ...s, rows: s.rows.map((r) => ({ ...r, effort: "all_out", breakawayMaxLead: 99999, orders: [{ task: "x" }] })) })),
  }));
  assert.deepEqual(computeRealismMetrics({ races: noisy, params: { bigLeadSeconds: 500, hardCapSeconds: 700 } }), base);
  assert.ok(!ROW_FIELDS.includes("breakawayMaxLead"), "M3 læses af forløbet, ikke af snapshot-målingen");
  assert.equal(Object.isFrozen(MEASUREMENT_CONTRACT), true);
});

test("#7588 tomt korpus giver tomme celler, aldrig en undtagelse", () => {
  assert.deepEqual(computeRealismMetrics(), { contractVersion: MEASUREMENT_CONTRACT.version, cells: {}, gcGroups: {} });
  assert.deepEqual(computeRealismMetrics({ races: [{ raceId: "x", stageCount: 1, perSeed: [{ rows: [null, {}] }] }] }).cells, {});
});
