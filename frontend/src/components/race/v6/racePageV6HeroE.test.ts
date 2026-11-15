// #7778 udgave E (valg 20-22, ejer 15/11): hovedkort, talraekkens "Samlet" og etapestribens celler.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { v6Overall, v6StripCells, v6StripKeyTarget, v6WhenLabel, v6WinnersByStage } from "./racePageV6Model.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// Etape 1-2 koert, etape 3 startet (paa vejen), etape 4-5 kommende.
const schedule = [1, 2, 3, 4, 5].map((n) => ({ stage_number: n, scheduled_at: `2026-11-${String(11 + n).padStart(2, "0")}T12:00:00.000Z` }));
const nowMs = Date.parse("2026-11-14T12:30:00.000Z");
const riders = [{ rider_id: "r1", name: "A", race_role: "captain" }, { rider_id: "r2", name: "B", race_role: "helper" }];
const base = {
  totalStages: 5, stagesCompleted: 2, raceFinished: false, schedule, nowMs,
  profileTypeByStage: { 1: "itt", 2: "hilly", 3: "rolling", 4: "mountain" } as Record<number, string>,
  winners: { 1: "Anna Berg" } as Record<number, string>,
  myBest: { 1: { rank: 4 }, 2: { rank: 2 } } as Record<number, { rank: number }>,
  riders, overrides: [],
  whenFor: (d: Date) => d.toISOString().slice(5, 10),
};

test("koert etape: vinderen hvor siden kender navnet, og egen bedste plads", () => {
  const cells = v6StripCells(base);
  assert.equal(cells.length, 5);
  assert.deepEqual(cells[0].foot, { kind: "ridden", winner: "Anna Berg", myRank: 4 });
  assert.deepEqual(cells[1].foot, { kind: "ridden", winner: null, myRank: 2 }, "ukendt vinder udelades, opfindes ikke");
});

test("koert etape uden egne ryttere: ingen egen plads", () => {
  const cells = v6StripCells({ ...base, myBest: {}, riders: [] });
  assert.deepEqual(cells[0].foot, { kind: "ridden", winner: "Anna Berg", myRank: null });
  assert.deepEqual(cells[1].foot, { kind: "ridden", winner: null, myRank: null });
});

test("etape paa vejen: startet og ikke afgjort", () => {
  assert.deepEqual(v6StripCells(base)[2].foot, { kind: "on_road" });
  // Foer starten er den samme etape kommende.
  const before = v6StripCells({ ...base, nowMs: Date.parse("2026-11-14T11:00:00.000Z") });
  assert.equal(before[2].foot.kind, "plan");
});

test("kommende etape med egne ryttere: samme 'x af 3' som guld-knappen; uden ryttere intet", () => {
  const cells = v6StripCells(base);
  assert.deepEqual(cells[3].foot, { kind: "plan", done: 2, total: 3 }, "udtaget og kaptajn, ingen intention");
  assert.deepEqual(v6StripCells({ ...base, riders: [] })[3].foot, { kind: "none" });
  assert.deepEqual(v6StripCells({ ...base, raceFinished: true })[3].foot, { kind: "none" }, "slut loeb har ingen plan");
});

test("cellen baerer terraen og tidspunkt fra siden; ukendt = null", () => {
  const cells = v6StripCells(base);
  assert.equal(cells[0].profileType, "itt");
  assert.equal(cells[4].profileType, null);
  assert.equal(cells[3].when, "11-15");
  assert.equal(v6StripCells({ ...base, schedule: [] })[3].when, null);
});

test("endagsloeb har ingen stribe (v6Strip) og en enkelt celle tegnes ikke", () => {
  const strip = read("./V6StageStrip.tsx");
  assert.match(strip, /if \(cells\.length < 2\) return null;/);
});

test("vinderne laeses kun fra etapens hentede liste med navn", () => {
  const w = v6WinnersByStage([
    { stage_number: 1, result_type: "stage", rank: 1, rider: { firstname: "Anna", lastname: "Berg" } },
    { stage_number: 1, result_type: "stage", rank: 2, rider: { firstname: "Bo", lastname: "Dal" } },
    { stage_number: 2, result_type: "gc", rank: 1, rider: { firstname: "Cia", lastname: "Ek" } },
    { stage_number: 3, result_type: "stage", rank: 1, rider_id: "x" },
  ]);
  assert.deepEqual(w, { 1: "Anna Berg" });
});

test("Samlet: holdets bedste plads og tidsafstand; foereren uden afstand; uden hold intet", () => {
  const gc = [
    { rank: 1, team_id: "t9", finish_time: "+0:00" },
    { rank: 3, team_id: "t1", finish_time: "+0:41" },
    { rank: 7, team_id: "t1", finish_time: "+2:05" },
  ];
  assert.deepEqual(v6Overall(gc, "t1"), { rank: 3, gap: "+0:41" });
  assert.deepEqual(v6Overall(gc, "t9"), { rank: 1, gap: null });
  assert.equal(v6Overall(gc, "t5"), null, "holdet staar ikke i klassementet");
  assert.equal(v6Overall(gc, null), null);
  assert.equal(v6Overall([], "t1"), null);
  assert.deepEqual(v6Overall([{ rank: 2, team_id: "t1", finish_time: "4:12:30" }], "t1"), { rank: 2, gap: null }, "kun en rigtig afstand vises");
});

test("tidspunkt: kun klokkeslaet i dag, ellers ugedag og klokkeslaet (Koebenhavn)", () => {
  const now = Date.parse("2026-11-15T09:00:00.000Z");
  const today = v6WhenLabel(new Date("2026-11-15T14:00:00.000Z"), now, "en-GB");
  assert.equal(today, "15:00");
  const later = v6WhenLabel(new Date("2026-11-16T12:00:00.000Z"), now, "en-GB");
  assert.match(later ?? "", /^Mon/);
  assert.match(later ?? "", /13:00/);
  assert.equal(v6WhenLabel(null, now, "en"), null);
});

test("piletaster flytter mellem etaperne, Home/End til enderne", () => {
  assert.equal(v6StripKeyTarget("ArrowRight", 3, 7), 4);
  assert.equal(v6StripKeyTarget("ArrowRight", 7, 7), 7);
  assert.equal(v6StripKeyTarget("ArrowLeft", 1, 7), 1);
  assert.equal(v6StripKeyTarget("Home", 5, 7), 1);
  assert.equal(v6StripKeyTarget("End", 2, 7), 7);
  assert.equal(v6StripKeyTarget("Enter", 2, 7), null);
});

test("striben: rigtige knapper, aria-current, proximity-snap, fade med scroll-padding, ingen guld", () => {
  const strip = read("./V6StageStrip.tsx");
  assert.match(strip, /aria-current=\{active \? "true" : undefined\}/);
  assert.match(strip, /aria-label=\{t\("racePageV6\.strip\.earlier"\)\}/);
  assert.match(strip, /aria-label=\{t\("racePageV6\.strip\.later"\)\}/);
  assert.match(strip, /block: "nearest", inline: "nearest", container: "nearest"/);
  assert.doesNotMatch(strip, /accent|gold|shadow/, "den valgte etape er aldrig guld");
  const css = read("../../../index.css");
  const block = css.slice(css.indexOf("/* #7778 udgave E: v6's etapestribe"));
  assert.match(block, /scroll-snap-type: x proximity;/);
  assert.doesNotMatch(block, /mandatory/);
  assert.match(block, /scroll-padding-inline: var\(--v6-fade-size\);/);
  assert.match(block, /@property --v6-fade-start/);
  assert.match(block, /border: 1\.5px solid var\(--text-1\);/, "valgt etape = moerk kant");
  assert.match(block, /width: 44px;/, "pilene har 44 px trykflade");
  assert.doesNotMatch(block, /box-shadow|accent/);
});

test("fanerne: underline, guld-tekst paa den aktive, panel med aria-labelledby og uden aria-controls", () => {
  const page = read("./RacePageV6.tsx");
  assert.match(page, /<TabList label=\{t\("stagePageV2\.tabsAria"\)\} accent>/);
  assert.match(page, /role="tabpanel" aria-labelledby=\{tabId\(activeTab\)\}/);
  assert.doesNotMatch(page, /aria-controls/);
  const styles = read("../../ui/tabsStyles.js");
  assert.match(styles, /border-cz-accent \$\{accent \? "text-cz-accent-t" : "text-cz-1"\}/);
  // Aktiv og inaktiv fane har samme skriftvaegt og -stoerrelse (kun farve og understregning skifter).
  assert.doesNotMatch(styles, /font-(semibold|bold)/);
});

test("hovedkortet: striben er bunden, fanerne staar under kortet, og hovedet hopper ikke mens rammen hentes", () => {
  const page = read("./RacePageV6.tsx");
  assert.ok(page.indexOf("<V6RaceHeroCard") < page.indexOf("<Tabs "), "kortet staar over fanerne");
  const detail = read("../../../pages/RaceDetailPage.jsx");
  assert.match(detail, /<Suspense fallback=\{v6Hero \? <V6RaceHeroCard hero=\{v6Hero\}/);
  assert.match(detail, /\{!v6 && \(\n\s+<section className="bg-cz-card/, "slukket = det gamle hoved uaendret");
});
