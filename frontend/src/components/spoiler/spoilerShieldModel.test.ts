// #7859 · Spoiler-skjoldets regler: slukket = som i dag, skjult etape åbner i Story,
// og en åbnet etape (ét tryk eller filmen i mål) er synlig igen.
import test from "node:test";
import assert from "node:assert/strict";
import {
  OFF_VIEW, filmAtFinish, finishedStageTab, initialView, linesUpTo, parseShieldResponse, raceShielded, readRememberedShield,
  rememberShield, stageHidden, withOpenedStage, withRaceShield, withoutHiddenStages, withoutSpoilerStats, type SpoilerShieldView,
} from "./spoilerShieldModel.ts";

const shielded = (opened: number[] = [], extra: Partial<SpoilerShieldView["settings"]> = {}): SpoilerShieldView => parseShieldResponse({
  enabled: true,
  settings: { shieldAll: true, openFinishedIn: "results", ...extra },
  race: { shield: null, openedStages: opened },
});

test("slukket kontakt, fejl eller et ukendt svar = alt som i dag", () => {
  for (const body of [null, {}, { enabled: false }, { enabled: "true" }, "x"]) {
    const view = parseShieldResponse(body);
    assert.equal(view, OFF_VIEW);
    assert.equal(stageHidden(view, 1, 3), false);
    assert.equal(finishedStageTab(view, { hidden: false }), "results");
  }
});

test("med skjoldet er en kørt, uåbnet etape skjult; en kommende eller åbnet etape er ikke", () => {
  const view = shielded([2]);
  assert.equal(raceShielded(view), true);
  assert.equal(stageHidden(view, 1, 3), true);
  assert.equal(stageHidden(view, 2, 3), false, "åbnet");
  assert.equal(stageHidden(view, 4, 3), false, "ikke kørt endnu");
  assert.equal(stageHidden(withOpenedStage(view, 1), 1, 3), false, "ét tryk åbner etapen");
});

test("kontakten i løbets hoved vinder over valget for alle løb", () => {
  const off = parseShieldResponse({ enabled: true, settings: { shieldAll: true }, race: { shield: false, openedStages: [] } });
  assert.equal(stageHidden(off, 1, 1), false);
  const on = withRaceShield(parseShieldResponse({ enabled: true, settings: { shieldAll: false }, race: null }), true);
  assert.equal(stageHidden(on, 1, 1), true);
});

test("mens svaret hentes: kun en husket tændt skjold skjuler (ingen glimt af vinderen)", () => {
  assert.equal(stageHidden(initialView(true), 1, 2), true);
  assert.equal(stageHidden(initialView(true), 3, 2), false);
  assert.equal(stageHidden(initialView(false), 1, 2), false, "uden husket værdi tegnes siden straks som i dag");
});

test("en færdig etape åbner i Story med skjoldet, ellers efter spillerens valg", () => {
  assert.equal(finishedStageTab(shielded(), { hidden: true }), "stage");
  assert.equal(finishedStageTab(shielded(), { hidden: false }), "results");
  assert.equal(finishedStageTab(shielded([], { openFinishedIn: "story" }), { hidden: false }), "stage");
});

test("striben og hovedet: skjulte etapers vinder og resultat-tal står ikke", () => {
  assert.deepEqual(withoutHiddenStages({ 1: "A", 2: "B", 3: "C" }, (n) => n !== 2), { 2: "B" });
  const stats = [{ label: "Stage" }, { label: "Overall", spoiler: true }];
  assert.deepEqual(withoutSpoilerStats(stats, true), [{ label: "Stage" }]);
  assert.deepEqual(withoutSpoilerStats(stats, false), stats);
});

test("filmen: referatet stopper ved positionen, og først i mål er filmen færdig", () => {
  const lines = [{ km: 10 }, { km: 80 }, { km: 155 }];
  assert.deepEqual(linesUpTo(lines, 0), []);
  assert.deepEqual(linesUpTo(lines, 80), [{ km: 10 }, { km: 80 }]);
  assert.equal(filmAtFinish(154.5, 155), false);
  assert.equal(filmAtFinish(155, 155), true);
  assert.equal(filmAtFinish(0, 0), false, "ukendt længde åbner aldrig af sig selv");
});

test("den huskede værdi tåler et blokeret lager", () => {
  const store = new Map<string, string>();
  const memory = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  assert.equal(readRememberedShield(memory), false);
  rememberShield(true, memory);
  assert.equal(readRememberedShield(memory), true);
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readRememberedShield(broken), false);
  assert.doesNotThrow(() => rememberShield(true, broken));
});
