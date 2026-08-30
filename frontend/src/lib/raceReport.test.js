// #2356 (S2: race-recap v2) — raceReport.js unit-tests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRaceReport,
  selectHeadlineMoment,
  ledeKeyForWinMoment,
  selectBeats,
  variantIndex,
  HEADLINE_VARIANT_COUNTS,
  LEDE_VARIANT_COUNTS,
  BEAT_VARIANT_COUNTS,
} from "./raceReport.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = join(__dirname, "..", "..", "public", "locales");
const enRaces = JSON.parse(readFileSync(join(localesDir, "en", "races.json"), "utf8"));
const daRaces = JSON.parse(readFileSync(join(localesDir, "da", "races.json"), "utf8"));

function m({ key, riderIds = [], teamIds = [], significance = 30, stage_number = 1, params = {} }) {
  return { moment_key: key, params, significance, rider_ids: riderIds, team_ids: teamIds, stage_number };
}

// ── i18n-parity: variant-tal-konstanterne SKAL matche de faktiske v1..vN-nøgler
// i races.json, begge sprog. Fanger en glemt v2 eller et sprog der er kommet ud
// af trit, FØR runtime (i stedet for at variantIndex vælger en variant der ikke
// findes → tom streng i UI).
function assertVariantCountsMatchLocale(counts, group, label) {
  for (const [key, expected] of Object.entries(counts)) {
    for (const [lang, doc] of [["en", enRaces], ["da", daRaces]]) {
      const entry = doc?.detail?.report?.[group]?.[key];
      assert.ok(entry, `${label} '${key}' mangler i ${lang}/races.json detail.report.${group}`);
      const actual = Object.keys(entry).length;
      assert.equal(actual, expected, `${label} '${key}' (${lang}): forventede ${expected} varianter, races.json har ${actual}`);
    }
  }
}

test("i18n-parity: HEADLINE_VARIANT_COUNTS matcher races.json (en+da)", () => {
  assertVariantCountsMatchLocale(HEADLINE_VARIANT_COUNTS, "headline", "headline");
});
test("i18n-parity: LEDE_VARIANT_COUNTS matcher races.json (en+da)", () => {
  assertVariantCountsMatchLocale(LEDE_VARIANT_COUNTS, "lede", "lede");
});
test("i18n-parity: BEAT_VARIANT_COUNTS matcher races.json (en+da)", () => {
  assertVariantCountsMatchLocale(BEAT_VARIANT_COUNTS, "beat", "beat");
});

// ── selectHeadlineMoment ─────────────────────────────────────────────────────

test("selectHeadlineMoment: ren spurtsejr uden andre momenter → vindermomentet selv", () => {
  const win = m({ key: "sprint_win", riderIds: ["r1"], significance: 50 });
  assert.equal(selectHeadlineMoment([win], win), win);
});

test("selectHeadlineMoment: gc_takeover med højere significance end vinderen slår etapesejren", () => {
  const win = m({ key: "close_win", riderIds: ["r1"], significance: 50 });
  const takeover = m({ key: "gc_takeover", riderIds: ["r1", "r2"], significance: 80 });
  assert.equal(selectHeadlineMoment([win, takeover], win), takeover);
});

test("selectHeadlineMoment: gc_takeover med LAVERE significance end vinderen taber til etapesejren", () => {
  const win = m({ key: "solo_win", riderIds: ["r1"], significance: 55 });
  const takeover = m({ key: "gc_takeover", riderIds: ["r1", "r2"], significance: 40 });
  assert.equal(selectHeadlineMoment([win, takeover], win), win);
});

test("selectHeadlineMoment: final_gc vinder ALTID, uanset significance på de øvrige", () => {
  const win = m({ key: "sprint_win", riderIds: ["r1"], significance: 90 });
  const finalGc = m({ key: "final_gc", riderIds: ["r1", "r2", "r3"], significance: 10 });
  assert.equal(selectHeadlineMoment([win, finalGc], win), finalGc);
});

test("selectHeadlineMoment: vinderen ER udbryderen → breakaway_survived kan blive rubrikken", () => {
  const win = m({ key: "solo_win", riderIds: ["r1"], significance: 55 });
  const survived = m({ key: "breakaway_survived", riderIds: ["r1"], significance: 55 });
  assert.equal(selectHeadlineMoment([win, survived], win), survived);
});

// ── ledeKeyForWinMoment ──────────────────────────────────────────────────────

test("ledeKeyForWinMoment: solo_win → solo, close_win → reduced_sprint, sprint_win → bunch_sprint", () => {
  assert.equal(ledeKeyForWinMoment(m({ key: "solo_win", riderIds: ["r1"] }), []), "solo");
  assert.equal(ledeKeyForWinMoment(m({ key: "close_win", riderIds: ["r1"] }), []), "reduced_sprint");
  assert.equal(ledeKeyForWinMoment(m({ key: "sprint_win", riderIds: ["r1"] }), []), "bunch_sprint");
});

test("ledeKeyForWinMoment: sprint_win + breakaway_survived på SAMME rytter → breakaway (den stærkere historie)", () => {
  const win = m({ key: "sprint_win", riderIds: ["r1"] });
  const survived = m({ key: "breakaway_survived", riderIds: ["r1"] });
  assert.equal(ledeKeyForWinMoment(win, [win, survived]), "breakaway");
});

// ── selectBeats ──────────────────────────────────────────────────────────────

test("selectBeats: FAST fase-orden (udbrud før selektion) uafhængigt af significance", () => {
  const headline = m({ key: "sprint_win", riderIds: ["r1"], significance: 50 });
  const formPeak = m({ key: "form_peak", riderIds: ["r1"], significance: 95 }); // selektions-fase, høj significance
  const caught = m({ key: "breakaway_caught", significance: 20 }); // udbrud-fase, lav significance
  const beats = selectBeats([headline, formPeak, caught], headline);
  assert.deepEqual(beats.map((b) => b.moment_key), ["breakaway_caught", "form_peak"], "udbrud-fasen skal komme FØR selektions-fasen uanset significance");
});

test("selectBeats: udelader rubrikkens eget moment", () => {
  const headline = m({ key: "gc_takeover", riderIds: ["r1", "r2"], significance: 80 });
  const beats = selectBeats([headline], headline);
  assert.equal(beats.length, 0);
});

test("selectBeats: tag_aggression_no_cost udelades hvis rytteren allerede er rubrikkens hovedperson", () => {
  const headline = m({ key: "breakaway_survived", riderIds: ["r1"], significance: 55 });
  const noCost = m({ key: "tag_aggression_no_cost", riderIds: ["r1"] });
  assert.equal(selectBeats([headline, noCost], headline).length, 0);
});

test("selectBeats: tag_aggression_no_cost for EN ANDEN rytter end rubrikken vises", () => {
  const headline = m({ key: "sprint_win", riderIds: ["r1"], significance: 50 });
  const noCost = m({ key: "tag_aggression_no_cost", riderIds: ["r2"] });
  const beats = selectBeats([headline, noCost], headline);
  assert.equal(beats.length, 1);
  assert.equal(beats[0].rider_ids[0], "r2");
});

test("selectBeats: højst 4 beats", () => {
  const headline = m({ key: "sprint_win", riderIds: ["r1"] });
  const many = [
    headline,
    m({ key: "breakaway_caught" }),
    m({ key: "form_peak", riderIds: ["r2"] }),
    m({ key: "tag_aggression_no_cost", riderIds: ["r3"] }),
    m({ key: "gc_takeover", riderIds: ["r1", "r4"] }),
  ];
  const beats = selectBeats(many, headline);
  assert.ok(beats.length <= 4);
});

// ── variantIndex: determinisme + variation over seeds ───────────────────────

test("variantIndex: samme input giver bit-identisk output ved gentagne kald", () => {
  const a = variantIndex("race-1", 3, "headline.sprint_win", 3);
  const b = variantIndex("race-1", 3, "headline.sprint_win", 3);
  assert.equal(a, b);
});

test("variantIndex: variantCount < 1 giver altid 0", () => {
  assert.equal(variantIndex("race-1", 3, "lede.generic", 0), 0);
  assert.equal(variantIndex("race-1", 3, "lede.generic", 1), 0);
});

test("variantIndex: varierer over etaper (samme løb, forskellige stageNumber rammer flere forskellige varianter)", () => {
  const seen = new Set();
  for (let stage = 1; stage <= 30; stage++) {
    seen.add(variantIndex("race-variation-check", stage, "headline.sprint_win", 3));
  }
  assert.ok(seen.size > 1, `forventede variation over 30 etaper, fik kun ${[...seen]}`);
});

test("variantIndex: varierer over løb (samme etape-nr, forskelligt raceId rammer flere forskellige varianter)", () => {
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    seen.add(variantIndex(`race-${i}`, 1, "headline.sprint_win", 3));
  }
  assert.ok(seen.size > 1, `forventede variation over 30 løb, fik kun ${[...seen]}`);
});

// ── buildRaceReport (integration af ovenstående) ────────────────────────────

test("buildRaceReport: ingen vindermoment for etapen → null (degradér til v1)", () => {
  assert.equal(buildRaceReport({ raceId: "r", stageNumber: 1, moments: [] }), null);
  assert.equal(buildRaceReport({ raceId: "r", stageNumber: 1, moments: [m({ key: "team_day" })] }), null);
});

test("buildRaceReport: filtrerer moments til DENNE etape (stage_number)", () => {
  const winStage1 = m({ key: "sprint_win", riderIds: ["r1"], stage_number: 1 });
  const winStage2 = m({ key: "solo_win", riderIds: ["r2"], stage_number: 2 });
  const report = buildRaceReport({ raceId: "r", stageNumber: 2, moments: [winStage1, winStage2] });
  assert.equal(report.headline.moment.moment_key, "solo_win");
  assert.equal(report.headline.moment.rider_ids[0], "r2");
});

test("buildRaceReport: fuld happy-path — headline, lede, beats, alle variant-indekser er gyldige tal", () => {
  const win = m({ key: "close_win", riderIds: ["r1"], teamIds: ["t1"], significance: 50, stage_number: 4, params: { riderId: "r1", gapSeconds: 5 } });
  const captured = m({ key: "breakaway_caught", significance: 20, stage_number: 4, params: { count: 3 } });
  const formPeak = m({ key: "form_peak", riderIds: ["r2"], significance: 40, stage_number: 4, params: { riderId: "r2" } });
  const noCost = m({ key: "tag_aggression_no_cost", riderIds: ["r3"], stage_number: 4, params: { riderId: "r3" } });
  const report = buildRaceReport({ raceId: "race-9", stageNumber: 4, moments: [win, captured, formPeak, noCost] });

  assert.ok(report);
  assert.equal(report.headline.moment.moment_key, "close_win");
  assert.ok(Number.isInteger(report.headline.variant) && report.headline.variant >= 0);
  assert.equal(report.lede.key, "reduced_sprint");
  assert.ok(Number.isInteger(report.lede.variant) && report.lede.variant >= 0);
  assert.ok(report.beats.length >= 2, "forventede mindst udbrud- og selektions-beats");
  for (const b of report.beats) {
    assert.ok(Number.isInteger(b.variant) && b.variant >= 0);
    assert.ok(typeof b.beatKey === "string");
  }
});

test("buildRaceReport: determinisme — samme input giver bit-identisk plan", () => {
  const moments = [
    m({ key: "sprint_win", riderIds: ["r1"], significance: 50 }),
    m({ key: "team_day", teamIds: ["t1"], significance: 45 }),
  ];
  const a = buildRaceReport({ raceId: "race-det", stageNumber: 1, moments });
  const b = buildRaceReport({ raceId: "race-det", stageNumber: 1, moments });
  assert.deepEqual(a, b);
});

// ── #4373: tidskørsler har egen rubrik + lede ──────────────────────────────
// Regressionen: en itt-etape havde intet vindermoment raceReport kendte, så
// panelet faldt tilbage til v1-recappen — som selv kaldte enkeltstarten en spurt.

test("#4373: itt_win/ttt_win genkendes som vindermoment (rapporten degraderer ikke til v1)", () => {
  for (const [key, ledeKey] of [["itt_win", "time_trial"], ["ttt_win", "team_time_trial"]]) {
    const win = m({ key, riderIds: ["r1"], teamIds: ["t1"], significance: 55, params: { riderId: "r1", gapSeconds: 2 } });
    const report = buildRaceReport({ raceId: "race-1", stageNumber: 1, moments: [win] });
    assert.ok(report, `${key} skal give en rapport`);
    assert.equal(report.headline.moment.moment_key, key);
    assert.equal(report.lede.key, ledeKey);
  }
});

test("#4373: ledeKeyForWinMoment sender ALDRIG en tidskørsel til en spurt-lede", () => {
  const itt = m({ key: "itt_win", riderIds: ["r1"], params: { riderId: "r1", gapSeconds: 1 } });
  const ttt = m({ key: "ttt_win", riderIds: ["r1"], params: { riderId: "r1", gapSeconds: 1 } });
  assert.equal(ledeKeyForWinMoment(itt, [itt]), "time_trial");
  assert.equal(ledeKeyForWinMoment(ttt, [ttt]), "team_time_trial");
  // Selv hvis et udbruds-moment skulle findes på etapen, vinder disciplinen.
  const survived = m({ key: "breakaway_survived", riderIds: ["r1"] });
  assert.equal(ledeKeyForWinMoment(itt, [itt, survived]), "time_trial");
});

test("#4373: tidskørsels-copy nævner hverken spurt eller felt (en+da)", () => {
  const forbidden = { en: [/sprint/i, /bunch/i, /peloton/i], da: [/spurt/i, /massespurt/i, /feltet/i] };
  for (const [lang, doc] of [["en", enRaces], ["da", daRaces]]) {
    const texts = [
      ...Object.values(doc.detail.report.headline.itt_win),
      ...Object.values(doc.detail.report.headline.ttt_win),
      ...Object.values(doc.detail.report.lede.time_trial),
      ...Object.values(doc.detail.report.lede.team_time_trial),
      doc.detail.film.event.finish_itt_win,
      doc.detail.film.event.finish_ttt_win,
      doc.detail.film.event.stage_start_itt,
      doc.detail.film.event.stage_start_ttt,
      doc.detail.film.event.favorite_crack_tt,
      doc.detail.recap.ittWin,
      doc.detail.recap.tttWin,
      doc.detail.finalKm.winType.itt_win,
      doc.detail.finalKm.winType.ttt_win,
    ];
    for (const text of texts) {
      assert.ok(typeof text === "string" && text.length > 0, `${lang}: tom tidskørsels-tekst`);
      for (const pattern of forbidden[lang]) {
        assert.equal(pattern.test(text), false, `${lang}: "${text}" bruger feltsprog (${pattern})`);
      }
    }
  }
});
