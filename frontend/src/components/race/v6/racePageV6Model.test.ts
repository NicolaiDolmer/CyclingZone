// #7778 · Loebssiden v6: faner og hovedets handling.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RACE_PAGE_V6_TABS, resolveV6Tab, tacticsAfterView, tacticsCta, v6OneDayDayResults, v6ResultsPhase, v6RouteProfile, v6StageTabFor, v6Strip, v6TabButtonFor, v6TabButtons, v6Tabs, v6StageOpenForTactics, v6TacticsResults, v6TacticsStage,
} from "./racePageV6Model.ts";
import { yourDay } from "../stagePageV2/stagePageV2Model.ts";
import { SEED_STAGE_PROFILES } from "../../../preview/seedData.js";

test("#7861 Codex P2: endagsloebets Din dag finder egne ryttere, ogsaa naar resultatet kun er klassement-raekker", () => {
  const gcOnly = [
    { result_type: "gc", stage_number: 1, rank: 1, rider_id: "r1", rider_name: "Rytter A", team_id: "t1" },
    { result_type: "gc", stage_number: 1, rank: 2, rider_id: "r2", rider_name: "Rytter B", team_id: "t2" },
  ];
  assert.equal(yourDay(gcOnly, 1, "t1", "stage").mine.length, 0, "uden normalisering er Din dag tom (fejlen)");
  const mine = yourDay(v6OneDayDayResults(gcOnly, 1), 1, "t1", "stage").mine;
  assert.deepEqual(mine.map((r) => [r.riderId, r.rank]), [["r1", 1]]);
  // Med etape-raekker er listen uaendret (samme regel som YourDayCard).
  const withStage = [...gcOnly, { result_type: "stage", stage_number: 1, rank: 1, rider_id: "r1", rider_name: "Rytter A", team_id: "t1" }];
  assert.deepEqual(v6OneDayDayResults(withStage, 1), withStage);
  assert.deepEqual(v6OneDayDayResults([], 1), []);
});

test("#7861 Codex P2: endagsloebets Resultater giver Din dag de normaliserede raekker", () => {
  const src = read("./RacePageV6.tsx");
  assert.match(src, /isStageRace \? results : v6OneDayDayResults\(results, selectedStage\)/);
  assert.match(src, /phase === "after" && <V6YourDay results=\{oneDayDayResults\}/);
});

// Linjeskift normaliseres, saa kildeproeverne virker med CRLF-checkout (Windows) og LF (CI).
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("en koert etape aabner paa Resultater, en kommende paa Etape (valg 5)", () => {
  assert.equal(resolveV6Tab(null, { ridden: true, isStageRace: true }), "results");
  assert.equal(resolveV6Tab(null, { ridden: false, isStageRace: true }), "stage");
  assert.equal(resolveV6Tab("nonsense", { ridden: true, isStageRace: true }), "results");
});

test("en gyldig ?tab= vinder; Resultater staar foerst", () => {
  assert.equal(RACE_PAGE_V6_TABS[0], "results");
  for (const tab of ["results", "stage", "tactics", "team"]) {
    assert.equal(resolveV6Tab(tab, { ridden: true, isStageRace: true }), tab);
  }
});

test("#7861: fanerne som wireframet; Stillinger er ingen fane, Startliste er (#7862)", () => {
  assert.deepEqual([...v6Tabs()], ["results", "stage", "start", "tactics", "team"]);
  assert.deepEqual([...v6TabButtons()], ["stage", "start", "tactics", "team"]);
  // Et gammelt link til Stillinger lander paa Etape-fanens standard (Resultater for en koert etape).
  assert.equal(resolveV6Tab("standings", { ridden: true, isStageRace: true }), "results");
  assert.equal(resolveV6Tab("start", { ridden: true, isStageRace: false }), "start");
  assert.equal(resolveV6Tab("standings", { ridden: true, isStageRace: false }), "results");
  assert.equal(resolveV6Tab("startlist", { ridden: true, isStageRace: true }), "results");
  // Resultater og Historie er begge Etape-fanen.
  assert.equal(v6TabButtonFor("results"), "stage");
  assert.equal(v6TabButtonFor("stage"), "stage");
  assert.equal(v6TabButtonFor("team"), "team");
});

const riders = [{ rider_id: "r1", name: "A", race_role: "captain" }, { rider_id: "r2", name: "B", race_role: "helper" }];
const schedule = [
  { stage_number: 1, scheduled_at: "2026-11-12T10:00:00.000Z" },
  { stage_number: 2, scheduled_at: "2026-11-13T10:00:00.000Z" },
];
const base = { stagesCompleted: 1, totalStages: 3, raceFinished: false, schedule, riders, overrides: [], nowMs: Date.parse("2026-11-12T18:00:00.000Z") };

test("efter en koert etape peger knappen paa naeste etape med dens laasetid", () => {
  const cta = tacticsCta(base);
  assert.equal(cta?.stage, 2);
  assert.equal(cta?.locksAt?.toISOString(), "2026-11-13T10:00:00.000Z");
  assert.ok(cta && cta.total > 0);
});

test("ingen knap naar loebet er slut, holdet er udgaaet eller alle etaper er koert", () => {
  assert.equal(tacticsCta({ ...base, raceFinished: true }), null);
  assert.equal(tacticsCta({ ...base, riders: riders.map((r) => ({ ...r, abandoned: true })) }), null);
  assert.equal(tacticsCta({ ...base, stagesCompleted: 3 }), null);
});

test("#7865: en etape paa vejen er laast; knappen peger saa paa den naeste aabne etape", () => {
  const onRoad = Date.parse("2026-11-13T10:30:00.000Z");
  const twoStages = { ...base, totalStages: 2 };
  assert.equal(tacticsCta({ ...twoStages, nowMs: onRoad }), null, "sidste etape paa vejen: intet at saette");
  assert.equal(tacticsCta({ ...base, nowMs: onRoad })?.stage, 3, "etape 2 paa vejen: etape 3 er aaben");
});

// ── #7865 punkt 1: hovedet er loebets og staar stille ──

test("#7865: hovedets knap afhaenger ikke af den valgte etape (samme indhold uanset klik i striben)", () => {
  // tacticsCta kender ikke laengere den valgte etape: samme input = samme svar.
  assert.deepEqual(tacticsCta(base), tacticsCta({ ...base }));
  const detail = read("../../../pages/RaceDetailPage.jsx");
  const call = detail.slice(detail.indexOf("const v6Cta = v6 ? tacticsCta({"), detail.indexOf("}) : null;", detail.indexOf("const v6Cta = v6 ? tacticsCta({")));
  assert.doesNotMatch(call, /selectedStage/, "hovedets knap laeser ikke den valgte etape");
  assert.match(detail, /const heroStage = v6 \? runningStage : focusStage;/, "tal-raekkens etape er loebets under v6");
  assert.match(detail, /value: `\$\{heroStage\} \/ \$\{totalStages\}`/);
  assert.match(detail, /heroProfile \? profileLabelKey\(heroProfile\.profile_type\)/, "terraenet foelger loebets etape");
});

test("udgave E: talraekken, fristen og den ene guld-knap staar i samme raekke af hovedkortet", () => {
  const detail = read("../../../pages/RaceDetailPage.jsx");
  const start = detail.indexOf("const v6Hero = v6 ? {");
  const v6Hero = detail.slice(start, detail.indexOf("} : null;\n", detail.indexOf("} : null,", start) + 1));
  assert.match(v6Hero, /stats: statBlocks/, "talraekken er sidens egne tal");
  assert.match(v6Hero, /onClick: \(\) => openV2Tactics\(v6Cta\.stage\)/);
  assert.doesNotMatch(v6Hero, /statusChip/, "ingen statuschip i v6-hovedet (valg 22)");
  assert.match(detail, /\.\.\.\(nextStart && !v6Cta \? \[/, "fristen staar ikke to gange");
  const card = read("./V6RaceHeroCard.tsx");
  const row2 = card.slice(card.indexOf("<HeroStats flush"), card.indexOf("{strip}"));
  assert.match(row2, /data-race-hero-action/);
  assert.equal(card.match(/variant="primary"/g)?.length, 1, "een guld-knap");
  assert.match(card, /border-t-2 border-t-cz-accent/, "T3-heroens guld-streg");
  assert.doesNotMatch(card, /shadow|bg-cz-danger|text-cz-danger/, "ingen skygge og ingen roed status-pille");
});

// ── #7865 punkt 2: een etapevaelger ──

test("#7865: een etapestribe; paa Taktik foelger den Taktik-fanens etape og styrer editoren", () => {
  assert.deepEqual(v6Strip({ activeTab: "tactics", isStageRace: true, selectedStage: 1, tacticsStage: 3 }), { selected: 3, target: "tactics" });
  assert.deepEqual(v6Strip({ activeTab: "results", isStageRace: true, selectedStage: 1, tacticsStage: 3 }), { selected: 1, target: "page" });
  assert.deepEqual(v6Strip({ activeTab: "stage", isStageRace: true, selectedStage: 2, tacticsStage: 3 }), { selected: 2, target: "page" });
  // Udgave E: striben er hovedkortets bund og staar paa alle faner; fra Startliste aabner den etapen.
  assert.deepEqual(v6Strip({ activeTab: "start", isStageRace: true, selectedStage: 1, tacticsStage: 3 }), { selected: 1, target: "open" });
  // #7862 (valg 13): Hold følger etapeskiftet i striben i stedet for at åbne etapen.
  assert.deepEqual(v6Strip({ activeTab: "team", isStageRace: true, selectedStage: 1, tacticsStage: 3 }), { selected: 1, target: "page" });
  assert.equal(v6StageTabFor(2, 3), "results");
  assert.equal(v6StageTabFor(4, 3), "stage");
  assert.equal(v6Strip({ activeTab: "tactics", isStageRace: false, selectedStage: 1, tacticsStage: 1 }), null);
  const page = read("./RacePageV6.tsx");
  assert.equal(page.match(/<V6StageStrip /g)?.length, 1, "kun een stribe i v6-rammen");
  assert.doesNotMatch(page, /<StageStripV2 /);
  const detail = read("../../../pages/RaceDetailPage.jsx");
  assert.match(detail, /renderTactics=\{\(n\) => renderTabContent\("tactics", \{ v6Stage: n \}\)\}/);
  assert.match(detail, /stage=\{v6Stage\}/);
  assert.match(detail, /hideStagePicker=\{v6Stage != null && race\.race_type === "stage_race"\}/);
  const tactics = read("../RaceTacticsTab.jsx");
  assert.match(tactics, /\{!hideStagePicker && <div className="inline-flex/, "editorens egen vaelger skjules under v6");
  assert.match(tactics, /if \(stage == null\) return;\n\s+setActiveStage\(stage\);/, "etapen udefra styrer editoren");
});

// ── #7865 punkt 3: Taktik paa en koert etape ──

const viewBase = { timeTrial: false, resultsState: "loaded" as const, timelineLoading: false, timelineMissing: false, ordersPending: false, ordersMissing: false, riderCount: 3 };

test("#7865: enkeltstart, holdtidskoersel og etaper uden optegnelse viser den laaste oversigt alene", () => {
  assert.equal(tacticsAfterView({ ...viewBase, timeTrial: true }), "hidden");
  assert.equal(tacticsAfterView({ ...viewBase, timelineMissing: true }), "hidden");
  assert.equal(tacticsAfterView({ ...viewBase, riderCount: 0 }), "hidden", "ingen egne ryttere i optegnelsen");
  assert.equal(tacticsAfterView(viewBase), "compare", "plan og optegnelse: planen mod det der skete");
  assert.equal(tacticsAfterView({ ...viewBase, resultsState: "loading" }), "loading");
  assert.equal(tacticsAfterView({ ...viewBase, timelineLoading: true }), "loading");
  assert.equal(tacticsAfterView({ ...viewBase, ordersPending: true }), "loading");
  assert.equal(tacticsAfterView({ ...viewBase, resultsState: "failed" }), "error");
  assert.equal(tacticsAfterView({ ...viewBase, ordersMissing: true }), "no_orders");
  const page = read("./RacePageV6.tsx");
  const tacticsBody = page.slice(page.indexOf('if (activeTab === "tactics")'), page.indexOf('} else if (activeTab !== "results")'));
  assert.match(tacticsBody, /<V6TacticsAfter/);
  assert.match(tacticsBody, /renderTactics \? renderTactics\(tacticsStage\) : tacticsSlot/, "den laaste oversigt staar altid under");
  const after = read("./V6TacticsAfter.tsx");
  assert.match(after, /if \(view === "hidden"\) return null;/);
  assert.doesNotMatch(after, /stagePlan\.timeTrial|stagePlan\.recap\.pending/, "ingen tom besked i stedet for oversigten");
});

// ── #7865 punkt 5, 6 og 8 ──

test("#7865: Resultater for en etape paa vejen siger det; en kommende etape som foer", () => {
  const sched = [{ stage_number: 2, scheduled_at: "2026-11-13T10:00:00.000Z" }, { stage_number: 3, scheduled_at: "2026-11-14T10:00:00.000Z" }];
  const at = Date.parse("2026-11-13T10:30:00.000Z");
  const p = { stagesCompleted: 1, raceFinished: false, schedule: sched, nowMs: at };
  assert.equal(v6ResultsPhase({ ...p, selectedStage: 1 }), "ridden");
  assert.equal(v6ResultsPhase({ ...p, selectedStage: 2 }), "on_road");
  assert.equal(v6ResultsPhase({ ...p, selectedStage: 3 }), "not_ridden");
  assert.equal(v6ResultsPhase({ ...p, selectedStage: 2, nowMs: Date.parse("2026-11-13T09:00:00.000Z") }), "not_ridden");
  const page = read("./RacePageV6.tsx");
  assert.match(page, /racePage\.hero\.chipStageOnRoad/, "genbruger den eksisterende tekst for 'paa vejen'");
});

test("#7865: ordre-oversigten findes eet sted under v6 (Taktik), ikke under Stillinger", () => {
  const detail = read("../../../pages/RaceDetailPage.jsx");
  assert.match(detail, /standingsSlot: renderTabContent\("results", \{ hideOrdersRecap: v6, hideFilm: v6 \}\)/);
  assert.match(detail, /isV4Timeline && !hideOrdersRecap && <StageOrdersRecap/);
  assert.match(detail, /!hideOrdersRecap && \(oneDayTimeline\?\.timeline_version \?\? 1\) >= 2 && <StageOrdersRecap/);
  const page = read("./RacePageV6.tsx");
  assert.match(page, /hideOrdersRecap\n/, "og stadig ikke under Historie");
});

test("#7865 review-punkt d: panelet har kortets bredde og placering paa alle faner", () => {
  const page = read("./RacePageV6.tsx");
  assert.match(page, /role="tabpanel" aria-labelledby=\{tabId\(v6TabButtonFor\(activeTab\)\)\} data-race-body-width="card" className="w-full">/);
  assert.doesNotMatch(page, /max-w-5xl/, "intet panel staar venstrestillet under et bredere kort");
});

// ── PR #8173-review: Taktik-fanens etape og etapens resultater ──

test("Taktik: den seneste eksplicitte navigation vinder, ogsaa guld-knappen efter et valg i striben", () => {
  // Kørt etape 1 valgt i Taktiks stribe: sammenligningen for etape 1.
  assert.equal(v6TacticsStage({ requested: 1, ctaStage: 2, selectedStage: 1 }), 1);
  // Guld-knappen sender etape 2 som ny eksplicit navigation: editoren for etape 2.
  assert.equal(v6TacticsStage({ requested: 2, ctaStage: 2, selectedStage: 1 }), 2);
  // Fanen åbnet direkte: guld-knappens etape, ellers den valgte.
  assert.equal(v6TacticsStage({ requested: null, ctaStage: 2, selectedStage: 1 }), 2);
  assert.equal(v6TacticsStage({ requested: null, ctaStage: null, selectedStage: 3 }), 3);
});

test("#8800: en valgt etape der kan faa taktik vinder over guld-knappens etape (intet hop 16 -> 14)", () => {
  const nowMs = Date.parse("2026-11-26T12:00:00Z");
  const day = 24 * 3600 * 1000;
  const schedule = Array.from({ length: 21 }, (_, i) => ({ stage_number: i + 1, scheduled_at: new Date(nowMs + (i + 1 - 13) * day).toISOString() }));
  const open = (stage: number, extra: Partial<{ raceFinished: boolean; nowMs: number }> = {}) =>
    v6StageOpenForTactics({ stage, stagesCompleted: 13, totalStages: 21, raceFinished: false, schedule, nowMs, ...extra });
  assert.equal(open(16), true, "ukoert og ikke startet");
  assert.equal(open(13), false, "koert etape");
  assert.equal(open(14, { nowMs: nowMs + 2 * day }), false, "startet etape er laast");
  assert.equal(open(16, { raceFinished: true }), false);
  assert.equal(open(22), false, "uden for loebet");
  assert.equal(v6StageOpenForTactics({ stage: 16, stagesCompleted: 13, totalStages: 21, raceFinished: false, schedule: [], nowMs }), true, "ukendt skema: aaben");

  // Fejlen: rollerne lander, guld-knappen faar etape 14, og fanen sprang fra 16 til 14.
  assert.equal(v6TacticsStage({ requested: null, ctaStage: null, selectedStage: 16, selectedOpen: open(16) }), 16, "foer rollerne");
  assert.equal(v6TacticsStage({ requested: null, ctaStage: 14, selectedStage: 16, selectedOpen: open(16) }), 16, "efter rollerne");
  // En koert valgt etape (sidens standard under loebet) aabner stadig guld-knappens etape.
  assert.equal(v6TacticsStage({ requested: null, ctaStage: 14, selectedStage: 13, selectedOpen: open(13) }), 14);
  // Den seneste eksplicitte navigation vinder stadig over den valgte etape.
  assert.equal(v6TacticsStage({ requested: 17, ctaStage: 14, selectedStage: 16, selectedOpen: open(16) }), 17);
  assert.equal(v6TacticsStage({ requested: 14, ctaStage: 14, selectedStage: 16, selectedOpen: open(16) }), 14, "guld-knappen");
});

test("#8800: siden giver Taktik den valgte etapes aabenhed, og fanen lader den styrede etape vinde i load()", () => {
  const page = read("./RacePageV6.tsx");
  assert.match(page, /const selectedOpen = v6StageOpenForTactics\(\{ stage: selectedStage, stagesCompleted, totalStages, raceFinished, schedule, nowMs \}\)/);
  assert.match(page, /v6TacticsStage\(\{ requested: tacticsStageRequest, ctaStage: openTactics\?\.stage, selectedStage, selectedOpen \}\)/);
  const tab = read("../RaceTacticsTab.jsx");
  assert.match(tab, /const stageRef = useRef\(stage\);/);
  assert.match(tab, /setActiveStage\(\(current\) => \{\n[^\n]*\n\s+if \(stageRef\.current != null && stageNumbers\.includes\(stageRef\.current\)\) return stageRef\.current;/);
});

test("Taktik: valget i striben og guld-knappen gaar gennem samme sidetilstand (ingen lokal kopi der vinder)", () => {
  const page = read("./RacePageV6.tsx");
  assert.doesNotMatch(page, /tacticsPick/, "ingen lokal Taktik-etape, der overtrumfer hovedets knap");
  assert.match(page, /requested: tacticsStageRequest/);
  assert.match(page, /const selectTacticsStage = \(n: number\) => onOpenTactics\(n\)/);
  const detail = read("../../../pages/RaceDetailPage.jsx");
  assert.match(detail, /<RacePageV6 [^\n]*tacticsStageRequest=\{v2TacticsStage\}/);
});

test("Taktik paa en koert etape: etapens resultater hentes, med indlaesning og fejl foer sammenligningen", () => {
  const stateFor = (n: number) => ({ 1: "loaded", 2: "failed" } as Record<number, "loaded" | "failed">)[n] ?? "loading";
  assert.equal(v6TacticsResults({ activeTab: "tactics", stage: 1, stagesCompleted: 3, stateFor }), "loaded");
  assert.equal(v6TacticsResults({ activeTab: "tactics", stage: 2, stagesCompleted: 3, stateFor }), "failed");
  assert.equal(v6TacticsResults({ activeTab: "tactics", stage: 3, stagesCompleted: 3, stateFor }), "loading");
  assert.equal(v6TacticsResults({ activeTab: "tactics", stage: 4, stagesCompleted: 3, stateFor }), null, "kommende etape: editoren");
  assert.equal(v6TacticsResults({ activeTab: "stage", stage: 1, stagesCompleted: 3, stateFor }), null);
  const page = read("./RacePageV6.tsx");
  assert.match(page, /if \(tacticsResults !== null\) loadStage\?\.\(tacticsStage\)/, "valget starter hentningen pr. etape");
  assert.match(page, /resultsState=\{tacticsResults\}/);
  const detail = read("../../../pages/RaceDetailPage.jsx");
  assert.match(detail, /loadStage=\{startStageFetch\}/);
  assert.match(detail, /stageStateFor=\{\(n\) => stageFetchState\(n, \{ loaded: loadedStages, failed: failedStages \}\)\}/);
  assert.match(detail, /stageErrorFor=\{stageLoadErrorFor\}/);
});

// #8253: rutekortet skal altid vise den valgte etapes rute. Siden nøgler profilerne som
// RaceDetailPage gør (stage_number ?? 1); prøven går ALLE etaper i alle preview-løb igennem.
function profilesKeyedLikeThePage(rows: Array<{ stage_number?: number | null }>) {
  const out: Record<number, (typeof rows)[number]> = {};
  for (const p of rows) out[p.stage_number ?? 1] = p;
  return out;
}

test("#8253: rutekortet viser den valgte etapes rute for hver etape i hvert løb", () => {
  type Row = { race_id: string; stage_number: number; distance_km: number; profile_type: string };
  const rows = SEED_STAGE_PROFILES as Row[];
  const races = [...new Set(rows.map((r) => r.race_id))];
  assert.ok(races.length >= 3, "flere løb i prøven");
  let checked = 0;
  for (const race of races) {
    const own = rows.filter((r) => r.race_id === race);
    const byStage = profilesKeyedLikeThePage(own);
    for (const row of own) {
      const shown = v6RouteProfile(byStage, row.stage_number);
      assert.equal(shown, row, `${race} etape ${row.stage_number}: kortet viser netop etapens række`);
      checked++;
    }
    // En etape uden profil viser intet kort (aldrig naboens rute).
    const missing = Math.max(...own.map((r) => r.stage_number)) + 1;
    assert.equal(v6RouteProfile(byStage, missing), null);
  }
  assert.ok(checked >= 10, `alle etaper gennemgået (${checked})`);
});

test("#8253: en profil der står under en anden etapes nøgle vises aldrig", () => {
  const stage2 = { stage_number: 2, distance_km: 168 };
  assert.equal(v6RouteProfile({ 1: stage2 }, 1), null, "forkert nøgle: intet kort frem for en anden etapes rute");
  assert.equal(v6RouteProfile({ 1: { stage_number: null, distance_km: 90 } }, 1)?.distance_km, 90, "række uden nummer = etape 1");
  assert.equal(v6RouteProfile({}, 3), null);
});

test("#8253: Resultater tegner rute, liste og Din dag for den samme valgte etape", () => {
  const page = read("./RacePageV6.tsx");
  assert.match(page, /const profile = v6RouteProfile\(profileByStage, selectedStage\);/);
  assert.match(page, /body = (?:<div[^>]*>\{routeLine\("results"\)\}\{)?renderResults\(selectedStage, \{/, "listen er den valgte etapes"); // #7861: filmens rute-linje kan staa foran listen
  assert.match(page, /<V6RouteProfile[\s\S]*?profile=\{profile\}/, "kortet får netop den profil");
  assert.match(page, /<V6YourDay results=\{(?:results|oneDayDayResults)\} stageNumber=\{selectedStage\}/); // #7861: endagsloeb normaliseres
  assert.match(page, /profile=\{v6RouteProfile\(profileByStage, tacticsStage\)\}/, "Taktik: samme opslag for Taktiks etape");
  assert.doesNotMatch(page, /profileByStage\[(selectedStage|tacticsStage)\]/, "intet direkte opslag uden tjek");
  const detail = read("../../../pages/RaceDetailPage.jsx");
  assert.match(detail, /for \(const p of stageProfiles\) out\[p\.stage_number \?\? 1\] = p;/, "siden nøgler profilerne som prøven");
});

test("#8253: underrækken (klassementet) er Segmented, hovedfanerne er understregede faner", () => {
  const detail = read("../../../pages/RaceDetailPage.jsx");
  const v6Branch = detail.slice(detail.indexOf("if (v6Layout) {"), detail.indexOf("if (v6Layout) {") + 2200);
  assert.match(v6Branch, /<Segmented label=\{t\("detail\.classTab\.ariaLabel"\)\} value=\{classTab\} onChange=\{setClassTab\}/);
  assert.doesNotMatch(v6Branch, /<TabList label=\{t\("detail\.classTab\.ariaLabel"\)\}/, "ingen anden fanerække under v6");
  assert.match(v6Branch, /overflow-x-auto/, "ruller vandret på mobil i stedet for at brække");
  const page = read("./RacePageV6.tsx");
  assert.match(page, /<TabList label=\{t\("stagePageV2\.tabsAria"\)\} accent>/, "hovedfanerne er stadig understregede faner");
});
