// #7861 · Løbsfilmen som én afspiller: kapitler og referatet, der følger filmen.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  climbFootKm, v6ChapterAt, v6CurrentLine, v6FilmChapters, v6FinaleKm, v6MoreAhead, v6NextChapter, v6PlayStep, v6StoryStripCells, v6VisibleLines,
} from "./v6RaceFilmModel.ts";

const mountainClimbs = [
  { name: "Passo A", category: "3", crest_km: 60, length_km: 5, avg_gradient: 6 },
  { name: "Cima B", category: "3", crest_km: 96, length_km: 5, avg_gradient: 6 },
  { name: "Salita C", category: "1", crest_km: 155, length_km: 11.8, avg_gradient: 7, summit_finish: true },
];

test("stigningens fod er toppen minus længden, aldrig før start", () => {
  assert.equal(climbFootKm({ crest_km: 60, length_km: 5 }), 55);
  assert.equal(climbFootKm({ crest_km: 3, length_km: 5 }), 0);
  assert.equal(climbFootKm({ crest_km: Number.NaN, length_km: 5 }), null);
});

test("finalen begynder ved foden af en stigning, der topper i finalens vindue (F2)", () => {
  assert.equal(Math.round(v6FinaleKm(155, mountainClimbs) * 10) / 10, 143.2);
  // Uden stigning i vinduet: vinduets start.
  assert.equal(v6FinaleKm(168, [{ crest_km: 121, length_km: 6.4 }]), 158);
  assert.equal(v6FinaleKm(6, []), 0);
});

test("kapitlerne er start, udbruddet, stigningerne, spurten og finalen i rutens rækkefølge (F4)", () => {
  const chapters = v6FilmChapters({
    distanceKm: 155,
    climbs: mountainClimbs,
    sprints: [{ km: 67, kind: "intermediate" }, { km: 155, kind: "finish" }],
    lines: [{ kind: "formed", km: 12 }, { kind: "finish", km: 155 }],
  });
  assert.deepEqual(chapters.map((c) => [c.kind, Math.round(c.km * 10) / 10, c.name ?? null]), [
    ["start", 0, null],
    ["break", 12, null],
    ["climb", 55, "Passo A"],
    ["sprint", 67, null],
    ["climb", 91, "Cima B"],
    ["finale", 143.2, null],
  ]);
});

test("et sted i finalen hører til finalen, og to steder på samme km bliver ét kapitel", () => {
  const chapters = v6FilmChapters({
    distanceKm: 100,
    climbs: [{ name: "X", category: "4", crest_km: 40, length_km: 2, avg_gradient: 5 }],
    sprints: [{ km: 38.5, kind: "intermediate" }, { km: 95, kind: "intermediate" }],
    lines: [],
  });
  assert.deepEqual(chapters.map((c) => c.kind), ["start", "climb", "finale"]);
});

test("en etape uden længde har ingen kapitler", () => {
  assert.deepEqual(v6FilmChapters({ distanceKm: 0 }), []);
});

test("kapitlet filmen står i og det næste", () => {
  const chapters = v6FilmChapters({ distanceKm: 155, climbs: mountainClimbs, lines: [{ kind: "formed", km: 12 }] });
  assert.equal(v6ChapterAt(chapters, 0)?.kind, "start");
  assert.equal(v6ChapterAt(chapters, 12)?.kind, "break");
  assert.equal(v6ChapterAt(chapters, 150)?.kind, "finale");
  assert.equal(v6NextChapter(chapters, 12)?.name, "Passo A");
  assert.equal(v6NextChapter(chapters, 150), null);
});

test("referatet viser kun linjerne op til filmens position, så vinderen først står der i mål (F6)", () => {
  const lines = [{ km: 12, id: "a" }, { km: 60, id: "b" }, { km: 155, id: "finish" }];
  assert.deepEqual(v6VisibleLines(lines, 0).map((l) => l.id), []);
  assert.deepEqual(v6VisibleLines(lines, 60).map((l) => l.id), ["a", "b"]);
  assert.deepEqual(v6VisibleLines(lines, 154.5).map((l) => l.id), ["a", "b"]);
  assert.deepEqual(v6VisibleLines(lines, 155).map((l) => l.id), ["a", "b", "finish"]);
  assert.equal(v6CurrentLine(lines, 70)?.id, "b");
  assert.equal(v6CurrentLine(lines, 5), null);
  assert.equal(v6MoreAhead(lines, 70), true);
  assert.equal(v6MoreAhead(lines, 155), false);
});

test("en linje over et stykke vej vises først, når filmen er ved dens slut-km (Codex-fund)", () => {
  const lines = [{ km: 25, kmTo: 48, id: "gap" }, { km: 60, kmTo: null, id: "b" }];
  assert.deepEqual(v6VisibleLines(lines, 30).map((l) => l.id), [], "hullets udfald ved km 48 afsløres ikke ved km 30");
  assert.deepEqual(v6VisibleLines(lines, 48).map((l) => l.id), ["gap"]);
  assert.equal(v6MoreAhead(lines, 30), true);
  assert.equal(v6CurrentLine(lines, 30), null);
});

test("i Historie viser striben ikke den valgte etapes vinder eller egen plads (låst 7/11)", () => {
  const cells = [
    { number: 1, foot: { kind: "ridden", winner: "A. Vinder", myRank: 4 } },
    { number: 2, foot: { kind: "ridden", winner: "B. Vinder", myRank: 2 } },
    { number: 3, foot: { kind: "plan", state: "saved" } },
  ];
  const out = v6StoryStripCells(cells, 2);
  assert.deepEqual(out[1].foot, { kind: "ridden", winner: null, myRank: null });
  assert.equal(out[0], cells[0], "andre etaper er uændrede");
  assert.equal(out[2], cells[2]);
  assert.deepEqual(v6StoryStripCells(cells, 3)[2], cells[2], "en kommende etape har intet at skjule");
});

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("Historie efter etapen er filmen; Etape-fanen har Historie | Resultater i rutelinjen", () => {
  const page = read("./RacePageV6.tsx");
  assert.match(page, /activeTab === "stage" && phase === "after"\) \{[\s\S]{0,400}routeLine\("story"\)[\s\S]{0,200}<V6RaceFilm /);
  assert.match(page, /\{routeLine\("results"\)\}\{renderResults\(/);
  const line = read("./V6RouteLine.tsx");
  assert.match(line, /racePageV6\.tab\.story[\s\S]{0,120}racePageV6\.tab\.results/, "Historie først, som wireframet");
});

test("filmens dubletter er væk under v6: popup-afspiller, sidste km, ekstra referat og mellemtider", () => {
  const detail = read("../../../pages/RaceDetailPage.jsx");
  assert.equal(detail.match(/\{!hideFilm && <StoryOfTheStageSection/g)?.length, 2, "etapens og endagsløbets popup-afspiller");
  assert.match(detail, /\{!hideFilm && finalKmOpen && finalKmPlayback\.available && \(/);
  assert.match(detail, /\{!hideFilm && <RaceReportPanel/);
  assert.match(detail, /\{!hideFilm && <StageSplitTimes/);
  assert.match(detail, /\{!hideFilm && <RaceRecap results=\{oneDayResults\}/);
  assert.match(detail, /standingsSlot: renderTabContent\("results", \{ hideOrdersRecap: v6, hideFilm: v6 \}\)/, "kun når v6 er tændt");
});

test("afspilningen går hele etapen igennem i ca. 150 tik, aldrig under en halv km pr. tik", () => {
  assert.equal(v6PlayStep(155), 1);
  assert.equal(v6PlayStep(30), 0.5);
  assert.equal(v6PlayStep(300), 2);
});
