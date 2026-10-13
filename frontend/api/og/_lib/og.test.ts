// #6574: tests af road book-kortets rene dele (rute-validering, terræn, geometri, elementtræ, hentning).
// Selve PNG-gengivelsen (satori/resvg) testes ikke her — det kræver @vercel/og's WASM; den ses på
// preview-deployet.
import test from "node:test";
import assert from "node:assert/strict";
import { buildStageCard, layoutStage, gradeBand, fmtInt, COLORS, OG_WIDTH, OG_HEIGHT } from "./card.ts";
import { DEMO_STAGES } from "./demo.ts";
import { buildTerrain } from "./terrain.ts";
import { cleanText, normalizeStageRoute, fetchStageRoute, type StageRoute } from "./stageRoute.ts";

const STAGE_ID = "11111111-2222-4333-8444-555555555555";
const demo = (key: string): StageRoute => {
  const r = normalizeStageRoute(DEMO_STAGES[key]);
  if (!r) throw new Error(`demo ${key} has no route`);
  return r;
};
const json = (tree: unknown) => JSON.stringify(tree);

test("cleanText: kontroltegn, whitespace og længde", () => {
  assert.equal(cleanText("a\u0000b\n\tc   d", 40), "a b c d");
  assert.equal(cleanText("x".repeat(100), 10).length, 10);
  assert.equal(cleanText(undefined, 10), "");
  assert.equal(cleanText("<img src=x onerror=1>", 40), "<img src=x onerror=1>", "tekst renderes som tekst, aldrig som markup");
});

test("normalizeStageRoute: ingen afstand giver null; ugyldige rækker droppes, tal klemmes", () => {
  assert.equal(normalizeStageRoute(null), null);
  assert.equal(normalizeStageRoute({ race_name: "X", distance_km: 0 }), null);
  const r = normalizeStageRoute({
    race_name: "Tour\u0000 Alpha", distance_km: 160, elevation_gain_m: 99999, stage_number: 9, stage_count: 4,
    climbs: [{ name: "A", category: "hc", crest_km: 999, length_km: 99, avg_gradient: 7 }, { name: "bad", crest_km: "x" }],
    sprints: [{ km: 80, kind: "intermediate" }, { km: 160, kind: "finish" }, { km: -1, kind: "intermediate" }],
    segments: [{ kind: "mystery", from_km: 0, to_km: 5 }, { kind: "climb", from_km: 10, to_km: 20, avg_gradient: 6 }, { kind: "flat", from_km: 30, to_km: 20 }],
  });
  assert.ok(r);
  assert.equal(r.race, "Tour Alpha");
  assert.equal(r.elevation_gain_m, 9000);
  assert.equal(r.stage, 4, "etape klemmes til antal etaper");
  assert.equal(r.climbs.length, 1);
  assert.equal(r.climbs[0].category, "HC");
  assert.equal(r.climbs[0].crest_km, 160);
  assert.equal(r.climbs[0].length_km, 40);
  assert.deepEqual(r.sprints, [80], "kun mellemsprints inden for etapen");
  assert.equal(r.segments.length, 1, "ukendt type og omvendt segment droppes");
});

test("gradeBand: fælles skala <3 / 3-6 / 6-8 / 8-10 / >10, nedkørsel dæmpet", () => {
  const cases: [number, number][] = [[-8, -1], [-3, -1], [-2.9, 0], [0, 0], [2.99, 0], [3, 1], [5.99, 1], [6, 2], [7.99, 2], [8, 3], [9.99, 3], [10, 4], [14, 4], [NaN, 0]];
  for (const [pct, band] of cases) assert.equal(gradeBand(pct), band, `${pct} %`);
  assert.equal(COLORS.bands.length, 5);
});

test("fmtInt: tusindtalsseparator efter sprog", () => {
  assert.equal(fmtInt(3400, "en"), "3,400");
  assert.equal(fmtInt(3400, "da"), "3.400");
  assert.equal(fmtInt(1234567, "en"), "1,234,567");
});

test("buildTerrain: ægte terræn — stigning stiger præcis sin procent, flad/bølget er vandret, ingen bølger", () => {
  const t = buildTerrain(demo("high"));
  const covered = t.runs.reduce((s, r) => s + (r.to_km - r.from_km), 0);
  assert.ok(Math.abs(covered - 175) < 1e-6, "dækker hele etapen uden huller");
  for (const r of t.runs) {
    const len = r.to_km - r.from_km;
    if (r.kind === "climb") {
      assert.ok(Math.abs((r.endM - r.startM) - len * 10 * (r.gradient ?? 0)) < 1e-6, "rampe = længde x procent");
      assert.equal(r.band, gradeBand(r.gradient ?? 0));
    } else if (r.kind === "descent") {
      assert.ok(r.endM <= r.startM && r.endM >= t.valley);
      assert.equal(r.band, -1);
    } else {
      assert.equal(r.endM, r.startM, `${r.kind} opfinder ingen højdeforskel`);
      assert.equal(r.band, 0);
    }
  }
  assert.equal(t.derived, false);
  // HC-toppen er etapens højeste punkt og ligger i mål.
  assert.equal(t.elevationAt(175), t.peak);
});

test("buildTerrain: ældre række uden segments afleder ramper + nedkørsler af stigningerne", () => {
  const route = { ...demo("hilly"), segments: [] };
  const t = buildTerrain(route);
  assert.equal(t.derived, true);
  assert.equal(t.runs.filter((r) => r.kind === "climb").length, route.climbs.length);
  assert.ok(t.runs.some((r) => r.kind === "descent"));
  const covered = t.runs.reduce((s, r) => s + (r.to_km - r.from_km), 0);
  assert.ok(Math.abs(covered - route.distance_km) < 1e-6);
});

for (const key of Object.keys(DEMO_STAGES)) {
  test(`layoutStage(${key}): gyldig geometri, ét flag pr. stigning, kun stigninger farves stejlt`, () => {
    const route = demo(key);
    const L = layoutStage(route);
    assert.equal(L.flags.length, route.climbs.length);
    for (const f of L.fills) {
      assert.match(f.d, /^M[\d.\-, LZ]+$/, "ingen NaN/undefined i path");
      assert.ok(f.band >= -1 && f.band <= 4);
    }
    assert.ok(L.outline.startsWith("M") && !L.outline.includes("NaN"));
    for (const r of L.terrain.runs) if (r.band > 0) assert.equal(r.kind, "climb", "kun stigninger farves stejlt");
    for (const s of L.sprints) assert.ok(s.py > 0 && s.px > 0 && s.px < L.W);
    for (const tk of L.ticks) assert.ok(tk.px >= 0 && tk.px < L.W);
    assert.ok(L.ticks.length >= 3 && L.ticks.length <= 11);
  });

  test(`buildStageCard(${key}): deterministisk, serialiserbar og 1200x630`, () => {
    const route = demo(key);
    const a = json(buildStageCard(route));
    assert.equal(a, json(buildStageCard(route)));
    const tree = buildStageCard(route);
    const style = tree.props.style as Record<string, unknown>;
    assert.equal(style.width, OG_WIDTH);
    assert.equal(style.height, OG_HEIGHT);
    assert.ok(a.includes(route.race));
    assert.ok(a.includes("cyclingzone.org"));
    assert.ok(!a.includes("undefined") && !a.includes("NaN"));
  });
}

test("buildStageCard: tekst efter sprog, mål på toppen, brosten tælles", () => {
  const en = json(buildStageCard(demo("high")));
  assert.ok(en.includes("STAGE 12 OF 18") && en.includes("HIGH MOUNTAIN") && en.includes("m climbing") && en.includes("4,211"));
  assert.ok(en.includes("Summit finish: Col de Vars"));
  assert.ok(en.includes("17.4 km · 8.1 % · +1,409 m"), "stigningens egne tal");
  const da = json(buildStageCard(demo("high"), "da"));
  assert.ok(da.includes("ETAPE 12 AF 18") && da.includes("HØJT BJERG") && da.includes("højdemeter") && da.includes("4.211"));
  assert.ok(da.includes("17,4 km · 8,1 % · +1.409 m"));
  const cobbles = json(buildStageCard(demo("cobbles")));
  assert.ok(cobbles.includes("cobbled sectors") && cobbles.includes("\"6\""));
  const oneDay = json(buildStageCard({ ...demo("flat"), stageCount: 1, stage: 1 }));
  assert.ok(oneDay.includes("ONE-DAY RACE") && !oneDay.includes("STAGE 1"));
});

test("layoutStage: tætte stigninger giver ikke flere synlige tekster end der er plads til", () => {
  const climbs = Array.from({ length: 8 }, (_, i) => ({ name: `Alto numero ${i + 1}`, category: "3" as const, crest_km: 20 + i * 6, length_km: 3, avg_gradient: 7, summit_finish: false }));
  const L = layoutStage({ ...demo("high"), climbs, segments: [] });
  const shown = L.flags.filter((f) => f.shown);
  assert.ok(shown.length < 8, "ikke alle kan have tekst");
  for (const a of shown) for (const b of shown) {
    if (a === b || a.level !== b.level) continue;
    const ax = a.rightSide ? [a.px + 22, a.px + 22 + a.est] : [a.px - 22 - a.est, a.px - 22];
    const bx = b.rightSide ? [b.px + 22, b.px + 22 + b.est] : [b.px - 22 - b.est, b.px - 22];
    assert.ok(ax[1] <= bx[0] || bx[1] <= ax[0], "tekster på samme niveau overlapper ikke");
  }
});

const fakeFetch = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

test("fetchStageRoute: kun uuid, kalder det offentlige endpoint, 404 videregives, fejl bliver 502", async () => {
  assert.deepEqual(await fetchStageRoute("../etc", { fetchImpl: fakeFetch(200, {}) }), { ok: false, status: 400, error: "id must be a stage uuid" });

  let seen = "";
  const spy = (async (url: string) => { seen = url; return new Response(JSON.stringify({ stage: DEMO_STAGES.flat }), { status: 200 }); }) as unknown as typeof fetch;
  const ok = await fetchStageRoute(STAGE_ID, { origin: "https://api.example/", fetchImpl: spy });
  assert.equal(seen, `https://api.example/api/public/stage-route/${STAGE_ID}`);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.route.race, "Tour de l'Hexagone");

  assert.equal((await fetchStageRoute(STAGE_ID, { fetchImpl: fakeFetch(404, { error: "stage_not_found" }) })).ok, false);
  const r404 = await fetchStageRoute(STAGE_ID, { fetchImpl: fakeFetch(404, {}) });
  assert.equal(!r404.ok && r404.status, 404);
  const r500 = await fetchStageRoute(STAGE_ID, { fetchImpl: fakeFetch(500, {}) });
  assert.equal(!r500.ok && r500.status, 502);
  const bad = await fetchStageRoute(STAGE_ID, { fetchImpl: fakeFetch(200, "not json") });
  assert.equal(!bad.ok && bad.status, 502);
  const thrown = await fetchStageRoute(STAGE_ID, { fetchImpl: (async () => { throw new Error("down"); }) as unknown as typeof fetch });
  assert.equal(!thrown.ok && thrown.status, 502);
  const noRoute = await fetchStageRoute(STAGE_ID, { fetchImpl: fakeFetch(200, { stage: { race_name: "X", distance_km: null } }) });
  assert.equal(!noRoute.ok && noRoute.status, 404);
});
