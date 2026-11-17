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
    ["attack", 143.2, null, "detail.film.event.climb_attack_start_named"],
    ["outcome", 155, null, "raceFilm:climb.gainedNamed"],
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
    ["attack", 143.2, null, false, "detail.film.event.climb_attack_start_named"],
    ["outcome", 150.4, 14000, false, "raceFilm:climb.crackedNamed"],
  ]);
  assert.deepEqual(lines[0].mineIds, [], "andres ryttere er ikke dine");
});

// Ejer 17/11 (afvist montage runde 3): "Det er ikke kronologisk muligt at angribe og vinde
// tid på samme tid." Også når stigningen ender før mål er det TO linjer, aldrig én.
test("uden topankomst er angrebet også TO linjer: angrebet ved foden uden tid, udfaldet ved toppen med løbstid", () => {
  const events = [
    { type: "stage_start", km: 0, params: { distance_km: 170 } },
    { type: "gap_update", km: 120, params: { gap_seconds: 30 } },
    { type: "all_out_gain", km: 150, params: { rider_id: "r3", exact_km: 150, exact_time: 12000 } },
    { type: "all_out_cracked", km: 150, params: { rider_id: "r4", exact_km: 147.5, exact_time: 11800 } },
    { type: "finish", km: 170, params: {} },
  ];
  const lines = v6ClimbAttackLines(events, { timelineVersion: 2, climbs: [{ name: "Monte X", crest_km: 150, length_km: 8 }] });
  // Løbsloggen står i filmens km-rækkefølge: knækket ved km 147,5 kommer før toppen.
  assert.deepEqual(lines.map((l) => [l.riderIds[0], l.phase, l.km, l.time, v6ClimbAttackCopyKey(l)]), [
    ["r4", "attack", 142, null, "detail.film.event.climb_attack_start_named"],
    ["r4", "outcome", 147.5, 11800, "raceFilm:climb.crackedNamed"],
    ["r3", "attack", 142, null, "detail.film.event.climb_attack_start_named"],
    ["r3", "outcome", 150, 12000, "raceFilm:climb.gainedNamed"],
  ]);
  assert.ok(lines.every((l) => l.phase === "attack" || l.phase === "outcome"), "ingen kombineret linje");
  // Kendes stigningen ikke: forrige kendte punkt er angrebspunktet, stadig to linjer.
  const unknown = v6ClimbAttackLines(events.slice(0, 3).concat(events[4]), { timelineVersion: 2, climbs: [] });
  assert.deepEqual(unknown.map((l) => [l.phase, l.km, l.time, v6ClimbAttackCopyKey(l)]), [
    ["attack", 120, null, "detail.film.event.climb_attack_start"],
    ["outcome", 150, 12000, "raceFilm:climb.gained"],
  ]);
  assert.deepEqual(v6ClimbAttackLines([{ type: "finish", km: 10 }], { timelineVersion: 2 }), [], "ingen angreb, ingen linjer");
});

test("preview-mockens referat: Pedersen og Brekke er to linjer hver, angrebet ved foden af Colle di Anteprima før udfaldet ved toppen", async () => {
  const { film7861Timeline } = await import("../../../preview/raceFilm7861PreviewMock.ts");
  const { SEED_STAGE_PROFILES } = await import("../../../preview/seedData.js");
  const timeline = film7861Timeline("/api/races/race-live-1/timeline?stage=2") as { timeline_version: number; events: Parameters<typeof v6ClimbAttackLines>[0] };
  const profile = (SEED_STAGE_PROFILES as Array<{ race_id: string; stage_number: number; climbs: unknown[] }>).find((p) => p.race_id === "race-live-1" && p.stage_number === 2);
  const lines = v6ClimbAttackLines(timeline.events, {
    timelineVersion: timeline.timeline_version, climbs: profile?.climbs as Parameters<typeof v6ClimbAttackLines>[1]["climbs"], mine: new Set(["rider-1"]), ownRiderIds: ["rider-1"],
  });
  assert.deepEqual(lines.map((l) => [l.riderIds[0], l.phase, Math.round(l.km * 10) / 10, l.time != null, v6ClimbAttackCopyKey(l)]), [
    ["rider-1", "attack", 114.6, false, "detail.film.event.climb_attack_start_named"],
    ["rider-1", "outcome", 121, true, "raceFilm:climb.gainedNamed"],
    ["rider-702", "attack", 114.6, false, "detail.film.event.climb_attack_start_named"],
    ["rider-702", "outcome", 121, true, "raceFilm:climb.crackedNamed"],
  ]);
  assert.ok(lines.every((l) => l.climbName === "Colle di Anteprima"));
  // I referatet: begge angreb ved foden står før begge udfald.
  const merged = v6ReportLines([], lines);
  assert.deepEqual(merged.map((l) => (l as { phase?: string }).phase), ["attack", "attack", "outcome", "outcome"]);
  assert.deepEqual(v6VisibleLines(merged, 118).map((l) => (l as { phase?: string }).phase), ["attack", "attack"], "udfaldet afsløres først ved toppen");
});

test("udfaldets tekst siger kun udfaldet, angrebets tekst kun angrebet (EN+DA, ejer 17/11)", () => {
  const locale = (lang: string, ns: string) => JSON.parse(read(`../../../../public/locales/${lang}/${ns}.json`));
  for (const lang of ["en", "da"]) {
    const film = locale(lang, "raceFilm").climb;
    const races = locale(lang, "races").detail.film.event;
    const keys = ["gained", "gainedNamed", "cracked", "crackedNamed"];
    for (const key of keys) {
      assert.equal(typeof film[key], "string", `${lang} raceFilm:climb.${key}`);
      assert.doesNotMatch(film[key], /attack|angreb|angrib/i, `${lang} ${key}: udfaldet nævner ikke angrebet`);
      assert.match(film[key], /\{rider\}/);
    }
    assert.match(film.gainedNamed, /\{climb\}/);
    assert.match(film.crackedNamed, /\{climb\}/);
    for (const key of ["climb_attack_start", "climb_attack_start_named"]) {
      assert.match(races[key], /attack|angrib/i, `${lang} ${key} er angrebet`);
      assert.doesNotMatch(races[key], /gain|time|tid|tom|empty|crack|knæk/i, `${lang} ${key}: angrebet har intet udfald`);
    }
  }
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
