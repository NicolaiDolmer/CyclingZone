// #7861 · Løbsfilmen som én afspiller: kapitler og referatet, der følger filmen.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  climbFootKm, v6ChapterAt, v6ClimbAttackCopyKey, v6ClimbAttackLines, v6CurrentLine, v6FilmChapters, v6FilmProfileGeometry, v6FinaleKm, v6MoreAhead,
  v6NextChapter, v6PlayStep, v6ReportLines, v6StoryStripCells, v6VisibleLines,
} from "./v6RaceFilmModel.ts";
import type { StoryLine } from "../stagePageV2/raceStoryModel.ts";

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

test("den aktuelle linje er den, hvis udfald blev kendt senest, ikke den sidste i listen (Codex-fund 16/11)", () => {
  // Listen er sorteret efter start-km: stykket km 25-48 står før hændelsen ved km 40.
  const lines = [{ km: 25, kmTo: 48, id: "gap" }, { km: 40, kmTo: null, id: "event" }];
  assert.equal(v6CurrentLine(lines, 45)?.id, "event", "ved km 45 er kun hændelsen ved km 40 kendt");
  assert.equal(v6CurrentLine(lines, 48)?.id, "gap", "ved km 48 er stykket det seneste udfald");
  assert.equal(v6CurrentLine(lines, 60)?.id, "gap");
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

// ── Runde 3 (16/11 aften) ────────────────────────────────────────────────

// En topankomst: motoren stempler stigningens opsummering på målstregen (#7965).
const summitEvents = (attack: Record<string, unknown>) => [
  { type: "stage_start", km: 0, params: { distance_km: 155 } },
  { type: "gap_update", km: 120, params: { gap_seconds: 30 } },
  { type: "kom_passage", km: 155, params: { name: "Salita C", category: "1" } },
  attack,
  { type: "finish", km: 155, params: {} },
];
const summitClimbs = [{ name: "Salita C", crest_km: 155, length_km: 11.8 }];

test("et holdt angreb op ad sidste stigning er TO linjer: angrebet ved foden og udfaldet ved toppen (#7965, Codex P1)", () => {
  const lines = v6ClimbAttackLines(summitEvents({ type: "all_out_gain", km: 155, params: { rider_id: "r1" } }), {
    timelineVersion: 2, climbs: summitClimbs, mine: new Set(["r1"]), ownRiderIds: ["r1"], effortByRider: new Map([["r1", "all_out"]]),
  });
  assert.deepEqual(lines.map((l) => [l.phase, Math.round(l.km * 10) / 10, l.time, v6ClimbAttackCopyKey(l)]), [
    ["attack", 143.2, null, "climb_attack_start_named"],
    ["outcome", 155, null, "climb_attack_held"],
  ]);
  assert.equal(lines[0].climbName, "Salita C");
  assert.deepEqual(lines.map((l) => l.mineIds), [["r1"], ["r1"]], "egen rytter på begge linjer");
  assert.notEqual(lines[0].id, lines[1].id);
});

test("et knæk op ad sidste stigning er TO linjer: angrebet uden tid og knækket dér hvor motoren stemplede det, med løbstid (#7965)", () => {
  const lines = v6ClimbAttackLines(summitEvents({ type: "all_out_cracked", km: 155, params: { rider_id: "r2", exact_km: 150.4, exact_time: 14000 } }), {
    timelineVersion: 2, climbs: summitClimbs,
  });
  assert.deepEqual(lines.map((l) => [l.phase, Math.round(l.km * 10) / 10, l.time, l.held, v6ClimbAttackCopyKey(l)]), [
    ["attack", 143.2, null, false, "climb_attack_start_named"],
    ["outcome", 150.4, 14000, false, "climb_attack_cracked"],
  ]);
  assert.deepEqual(lines[0].mineIds, [], "andres ryttere er ikke dine");
});

test("uden topankomst er angrebet én linje ved toppen med den hidtidige films tekst", () => {
  const events = [
    { type: "stage_start", km: 0, params: { distance_km: 170 } },
    { type: "all_out_gain", km: 150, params: { rider_id: "r3" } },
    { type: "finish", km: 170, params: {} },
  ];
  const [line, ...rest] = v6ClimbAttackLines(events, { timelineVersion: 2, climbs: [{ crest_km: 150, length_km: 8 }] });
  assert.equal(rest.length, 0);
  assert.equal(line.phase, "single");
  assert.equal(line.km, 150);
  // Et andet holds rytter (ingen kendt ordre) "angriber" (#7707); egen "Alt ud"-ordre giver all_out-teksten.
  assert.equal(v6ClimbAttackCopyKey(line), "attack_gain");
  assert.equal(v6ClimbAttackCopyKey({ ...line, attackTask: false, held: false }), "all_out_cracked");
  assert.equal(v6ClimbAttackCopyKey({ ...line, phase: "attack", climbName: null }), "climb_attack_start");
  assert.deepEqual(v6ClimbAttackLines([{ type: "finish", km: 10 }], { timelineVersion: 2 }), [], "ingen angreb, ingen linjer");
});

test("referatet fletter angrebslinjerne efter km; målet står sidst på samme km, og referatet følger filmen", () => {
  const story = (kind: StoryLine["kind"], km: number): StoryLine => ({ id: `${kind}-${km}`, kind, km, kmTo: null, span: false, time: null, count: 0, riderIds: [], mineIds: [], priority: 0, data: {} });
  const attacks = v6ClimbAttackLines(summitEvents({ type: "all_out_gain", km: 155, params: { rider_id: "r1" } }), { timelineVersion: 2, climbs: summitClimbs });
  const merged = v6ReportLines([story("formed", 12), story("climb", 96), story("finish", 155)], attacks);
  assert.deepEqual(merged.map((l) => [l.kind, Math.round(l.km * 10) / 10]), [
    ["formed", 12], ["climb", 96], ["climbAttack", 143.2], ["climbAttack", 155], ["finish", 155],
  ]);
  assert.deepEqual(v6VisibleLines(merged, 150).map((l) => l.kind), ["formed", "climb", "climbAttack"], "udfaldet står først, når filmen er nået dertil");
});

test("filmens position ligger i rutens egne koordinater (samme tal som StageProfileV2 uden bånd)", () => {
  const geo = v6FilmProfileGeometry({ width: 800, profile: { distance_km: 200 }, series: { kms: [0, 200] }, floor: 0, ceil: 1000 });
  assert.deepEqual([geo.W, geo.H, geo.top, geo.bottom, geo.X(100), geo.Y(0), geo.Y(1000)], [800, 320, 78, 290, 400, 290, 78]);
  const narrow = v6FilmProfileGeometry({ width: 358, profile: { distance_km: 0 }, series: { kms: [0, 100] }, floor: 0, ceil: 1000 });
  assert.deepEqual([narrow.H, narrow.top, narrow.D], [220, 48, 100]);
  const profileSrc = read("../stagePageV2/StageProfileV2.tsx");
  assert.match(profileSrc, /const H = short \? \(narrow \? 130 : 170\) : \(narrow \? 220 : 320\);/);
  assert.match(profileSrc, /const TOP = short \? 34 : \(narrow \? 48 : 78\);/);
  assert.match(profileSrc, /const BOT = 30;/);
  assert.match(profileSrc, /const narrow = width > 0 && width < 640;/);
  assert.match(profileSrc, /const X = \(km: number\) => \(km \/ D\) \* W;/);
});

test("filmen bruger v6's fælles rute (V6Route) med positionen som overlay, og referatet har angrebslinjerne", () => {
  const film = read("./V6RaceFilm.tsx");
  assert.match(film, /<V6Route profile=\{profile\} \/>/);
  assert.doesNotMatch(film, /<StageProfileV2\b/, "ingen anden profil i filmen");
  assert.match(film, /data-film-position/);
  assert.match(film, /v6ReportLines\(storyLines, attackLines\)/);
});

test("et kørt endagsløbs Resultater har \"Din dag\" med Hvorfor? for egne ryttere (Codex P2)", () => {
  const page = read("./RacePageV6.tsx");
  assert.match(page, /\} else if \(!isStageRace\) \{[\s\S]{0,700}data-race-section="standings"[\s\S]{0,200}phase === "after" && <V6YourDay results=\{oneDayDayResults\} stageNumber=\{selectedStage\}/);
});
