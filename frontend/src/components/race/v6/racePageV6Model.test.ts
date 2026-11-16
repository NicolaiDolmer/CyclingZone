// #7778 · Loebssiden v6: faner og hovedets handling.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RACE_PAGE_V6_TABS, resolveV6Tab, tacticsAfterView, tacticsCta, v6ResultsPhase, v6RouteProfile, v6StageTabFor, v6Strip, v6Tabs, v6TacticsResults, v6TacticsStage,
} from "./racePageV6Model.ts";
import { SEED_STAGE_PROFILES } from "../../../preview/seedData.js";

// Linjeskift normaliseres, saa kildeproeverne virker med CRLF-checkout (Windows) og LF (CI).
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("en koert etape aabner paa Resultater, en kommende paa Etape (valg 5)", () => {
  assert.equal(resolveV6Tab(null, { ridden: true, isStageRace: true }), "results");
  assert.equal(resolveV6Tab(null, { ridden: false, isStageRace: true }), "stage");
  assert.equal(resolveV6Tab("nonsense", { ridden: true, isStageRace: true }), "results");
});

test("en gyldig ?tab= vinder; Resultater staar foerst", () => {
  assert.equal(RACE_PAGE_V6_TABS[0], "results");
  for (const tab of ["results", "stage", "standings", "tactics", "team"]) {
    assert.equal(resolveV6Tab(tab, { ridden: true, isStageRace: true }), tab);
  }
});

test("endagsloeb har ingen Stillinger-fane", () => {
  assert.deepEqual([...v6Tabs(false)], ["results", "stage", "tactics", "team"]);
  assert.equal(resolveV6Tab("standings", { ridden: true, isStageRace: false }), "results");
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
  // Udgave E: striben er hovedkortets bund og staar paa alle faner; fra Stillinger og Hold aabner den etapen.
  assert.deepEqual(v6Strip({ activeTab: "standings", isStageRace: true, selectedStage: 1, tacticsStage: 3 }), { selected: 1, target: "open" });
  assert.deepEqual(v6Strip({ activeTab: "team", isStageRace: true, selectedStage: 1, tacticsStage: 3 }), { selected: 1, target: "open" });
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
  assert.match(detail, /standingsSlot: renderTabContent\("results", \{ hideOrdersRecap: v6 \}\)/);
  assert.match(detail, /isV4Timeline && !hideOrdersRecap && <StageOrdersRecap/);
  assert.match(detail, /!hideOrdersRecap && \(oneDayTimeline\?\.timeline_version \?\? 1\) >= 2 && <StageOrdersRecap/);
  const page = read("./RacePageV6.tsx");
  assert.match(page, /hideOrdersRecap\n/, "og stadig ikke under Historie");
});

test("#7865 review-punkt d: panelet har kortets bredde og placering paa alle faner", () => {
  const page = read("./RacePageV6.tsx");
  assert.match(page, /role="tabpanel" aria-labelledby=\{tabId\(activeTab\)\} data-race-body-width="card" className="w-full">/);
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
  assert.match(page, /body = renderResults\(selectedStage, \{/, "listen er den valgte etapes");
  assert.match(page, /<V6RouteProfile[\s\S]*?profile=\{profile\}/, "kortet får netop den profil");
  assert.match(page, /<V6YourDay results=\{results\} stageNumber=\{selectedStage\}/);
  assert.match(page, /profile=\{v6RouteProfile\(profileByStage, tacticsStage\)\}/, "Taktik: samme opslag for Taktiks etape");
  assert.doesNotMatch(page, /profileByStage\[(selectedStage|tacticsStage)\]/, "intet direkte opslag uden tjek");
  const detail = read("../../../pages/RaceDetailPage.jsx");
  assert.match(detail, /for \(const p of stageProfiles\) out\[p\.stage_number \?\? 1\] = p;/, "siden nøgler profilerne som prøven");
});
