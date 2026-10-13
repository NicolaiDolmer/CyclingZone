// #6574: tests af road book-kortets rene dele (params, geometri, elementtræ). Selve PNG-gengivelsen
// (satori/resvg) testes ikke her — det kræver @vercel/og's WASM; den ses på preview-deployet.
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseStageParams, parseClimbs, parseSprints, cleanText, buildStageOgUrl, OG_WIDTH, OG_HEIGHT,
} from "./params.js";
import { buildStageCard, layoutStage, gradeBand, fmtInt, COLORS } from "./card.js";
import { DEMO_STAGES } from "./demo.js";

const qs = (o) => new URLSearchParams(o);
const BASE = { race: "Ruta Cantabrica", km: "180", gain: "3400", type: "mountain", stage: "2", of: "5" };

test("parseStageParams: km og race er paakraevede", () => {
  assert.equal(parseStageParams(qs({ race: "X" })).ok, false);
  assert.equal(parseStageParams(qs({ km: "100" })).ok, false);
  assert.equal(parseStageParams(qs({ race: "X", km: "abc" })).ok, false);
  assert.equal(parseStageParams(qs({ race: "X", km: "0" })).ok, true, "0 klemmes til minimum 1");
});

test("parseStageParams: tal klemmes, ukendt type og sprog falder tilbage", () => {
  const r = parseStageParams(qs({ ...BASE, km: "9999", gain: "-5", stage: "99", of: "5", type: "evil", lang: "xx" }));
  assert.equal(r.ok, true);
  assert.equal(r.value.distance_km, 400);
  assert.equal(r.value.elevation_gain_m, 0);
  assert.equal(r.value.stage, 5);
  assert.equal(r.value.type, "hilly");
  assert.equal(r.value.lang, "en");
  assert.equal(parseStageParams(qs({ ...BASE, lang: "da" })).value.lang, "da");
});

test("cleanText: kontroltegn, whitespace og laengde", () => {
  assert.equal(cleanText("a\u0000b\n\tc   d", 40), "a b c d");
  assert.equal(cleanText("x".repeat(100), 10).length, 10);
  assert.equal(cleanText(undefined, 10), "");
  assert.equal(cleanText("<img src=x onerror=1>", 40), "<img src=x onerror=1>", "tekst renderes som tekst, aldrig som markup");
});

test("parseClimbs: ugyldige raekker droppes, max 8, sorteret, klemt", () => {
  const raw = ["108~6~6.1~2~B", "bad", "75~5~5.1~3~A", "0~5~5~3~Z", "999~99~99~9~C"].join(";");
  const out = parseClimbs(raw, 180);
  assert.deepEqual(out.map((c) => c.name), ["A", "B", "C"]);
  assert.equal(out[2].crest_km, 180);
  assert.equal(out[2].length_km, 40);
  assert.equal(out[2].avg_gradient, 20);
  assert.equal(out[2].category, "3", "ukendt kategori -> 3");
  assert.equal(parseClimbs(Array.from({ length: 20 }, (_, i) => `${i + 1}~1~5~4~n`).join(";"), 180).length, 8);
});

test("parseClimbs: navn med tilde bevares efter foerste fire felter", () => {
  assert.equal(parseClimbs("50~5~5~2~Alto~de~X", 100)[0].name, "Alto~de~X");
});

test("parseSprints: kun inden for etapen, max 3", () => {
  assert.deepEqual(parseSprints("40;999;-3;x;80;90;100", 120), [40, 80, 90]);
});

test("buildStageOgUrl -> parseStageParams er en rundtur", () => {
  const stage = {
    race: "Tour des Hauts Cols", route: "Bourg – Col du Loup", stage: 4, stageCount: 6, profile_type: "high_mountain",
    distance_km: 160, elevation_gain_m: 5200, lang: "da", seed: "abc",
    climbs: [{ crest_km: 52, length_km: 12.2, avg_gradient: 7.5, category: "1", name: "Col; du~Faucon" }],
    sprints: [{ km: 68, kind: "intermediate" }, { km: 160, kind: "finish" }],
  };
  const url = new URL(buildStageOgUrl("https://cyclingzone.org", stage));
  assert.equal(url.pathname, "/api/og/stage");
  const back = parseStageParams(url.searchParams);
  assert.equal(back.ok, true);
  assert.equal(back.value.race, stage.race);
  assert.equal(back.value.route, stage.route);
  assert.equal(back.value.type, "high_mountain");
  assert.equal(back.value.lang, "da");
  assert.equal(back.value.climbs.length, 1);
  assert.equal(back.value.climbs[0].name, "Col du Faucon", "; og ~ fjernes saa de ikke bryder formatet");
  assert.deepEqual(back.value.sprints, [68]);
});

test("gradeBand: faelles skala <3 / 3-6 / 6-8 / 8-10 / >10, nedkoersel daempet", () => {
  const cases = [[-8, -1], [-3, -1], [-2.9, 0], [0, 0], [2.99, 0], [3, 1], [5.99, 1], [6, 2], [7.99, 2], [8, 3], [9.99, 3], [10, 4], [14, 4], [NaN, 0]];
  for (const [pct, band] of cases) assert.equal(gradeBand(pct), band, `${pct} %`);
  assert.equal(COLORS.bands.length, 5);
});

test("fmtInt: tusindtalsseparator efter sprog", () => {
  assert.equal(fmtInt(3400, "en"), "3,400");
  assert.equal(fmtInt(3400, "da"), "3.400");
  assert.equal(fmtInt(999, "en"), "999");
  assert.equal(fmtInt(1234567, "en"), "1,234,567");
});

for (const [key, stage] of Object.entries(DEMO_STAGES)) {
  test(`layoutStage(${key}): gyldig geometri, ét flag pr. stigning, kun stigninger farves stejlt`, () => {
    const L = layoutStage(stage);
    assert.ok(L, "route data findes");
    assert.equal(L.flags.length, stage.climbs.length);
    for (const f of L.fills) {
      assert.match(f.d, /^M[\d.\-, LZ]+$/, "ingen NaN/undefined i path");
      assert.ok(f.band >= -1 && f.band <= 4);
    }
    assert.ok(L.outline.startsWith("M") && !L.outline.includes("NaN"));
    const spans = L.series.spans;
    for (const f of L.fills.filter((x) => x.band > 0)) {
      // et stejlt bånd skal ligge helt inden for en stigning (bølgeterræn er fri form og farves aldrig stejlt)
      const xs = [...f.d.matchAll(/L(-?[\d.]+),/g)].map((m) => (Number(m[1]) / L.W) * stage.distance_km);
      const [lo, hi] = [Math.min(...xs), Math.max(...xs)];
      assert.ok(spans.some(([a, b]) => lo >= a - 0.6 && hi <= b + 0.6), `bånd ${f.band} uden for stigning (${lo.toFixed(1)}-${hi.toFixed(1)} km)`);
    }
    for (const s of L.sprints) assert.ok(s.py > 0 && s.px > 0 && s.px < L.W);
    for (const t of L.ticks) assert.ok(t.px >= 0 && t.px < L.W);
    assert.ok(L.ticks.length >= 3 && L.ticks.length <= 11);
  });

  test(`buildStageCard(${key}): deterministisk, serialiserbar og 1200x630`, () => {
    const a = JSON.stringify(buildStageCard(stage));
    const b = JSON.stringify(buildStageCard(stage));
    assert.equal(a, b);
    const tree = buildStageCard(stage);
    assert.equal(tree.props.style.width, OG_WIDTH);
    assert.equal(tree.props.style.height, OG_HEIGHT);
    assert.ok(a.includes(stage.race));
    assert.ok(a.includes("cyclingzone.org"));
    assert.ok(!a.includes("undefined") && !a.includes("NaN"));
  });
}

test("buildStageCard: etapetekst efter sprog, endagsloeb uden 'etape x af y'", () => {
  const en = JSON.stringify(buildStageCard(DEMO_STAGES.mountain));
  assert.ok(en.includes("STAGE 2 OF 5") && en.includes("MOUNTAIN") && en.includes("m climbing"));
  const da = JSON.stringify(buildStageCard(DEMO_STAGES.high));
  assert.ok(da.includes("ETAPE 4 AF 6") && da.includes("HØJT BJERG") && da.includes("højdemeter") && da.includes("5.200"));
  const oneDay = JSON.stringify(buildStageCard(DEMO_STAGES.hilly));
  assert.ok(oneDay.includes("ONE-DAY RACE") && !oneDay.includes("STAGE 1"));
});

test("layoutStage: stigning uden navn og stage uden stigninger crasher ikke", () => {
  const flat = layoutStage({ ...DEMO_STAGES.flat, climbs: [], sprints: [] });
  assert.equal(flat.flags.length, 0);
  assert.ok(flat.fills.every((f) => f.band <= 0));
  const unnamed = layoutStage({ ...DEMO_STAGES.mountain, climbs: [{ category: "2", crest_km: 90, length_km: 8, avg_gradient: 6 }] });
  assert.equal(unnamed.flags[0].name, "");
  assert.doesNotThrow(() => buildStageCard({ ...DEMO_STAGES.mountain, climbs: [{ category: "2", crest_km: 90, length_km: 8, avg_gradient: 6, name: "" }] }));
});

test("layoutStage: tætte stigninger giver ikke flere synlige tekster end der er plads til", () => {
  const climbs = Array.from({ length: 8 }, (_, i) => ({ name: `Alto numero ${i + 1}`, category: "3", crest_km: 20 + i * 6, length_km: 3, avg_gradient: 7 }));
  const L = layoutStage({ ...DEMO_STAGES.mountain, climbs });
  const shown = L.flags.filter((f) => f.shown);
  assert.ok(shown.length < 8, "ikke alle kan have tekst");
  for (const a of shown) for (const b of shown) {
    if (a === b || a.level !== b.level) continue;
    const ax = a.rightSide ? [a.px + 22, a.px + 22 + a.est] : [a.px - 22 - a.est, a.px - 22];
    const bx = b.rightSide ? [b.px + 22, b.px + 22 + b.est] : [b.px - 22 - b.est, b.px - 22];
    assert.ok(ax[1] <= bx[0] || bx[1] <= ax[0], "tekster på samme niveau overlapper ikke");
  }
});
