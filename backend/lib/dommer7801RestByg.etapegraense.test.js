// #7801 rest-byg: dommerens proeve af ETAPEGRAENSEN pr. kolonne. Skrevet af den uafhaengige dommer 13/11
// ved dommen over PR #8139 (se dom-pr-8139.md). Ejes af dommeren; byggeren aendrer ikke filen.
//
// Hvorfor den findes: dommerens foerste verdener har kun belastninger paa loebsdage FOER hver kolonnes
// naeste etape. Derfor faar alle kolonner samme tal, og to bevidste fejl i Race Hub-soemmen blev ikke
// fanget ved dommen: at soemmen glemmer etapens graense pr. kolonne, og at den bytter om paa kolonnernes
// tal. Denne verden har en koert etape paa en SENERE loebsdag end en anden kolonnes naeste etape, saa
// kolonnerne skal have hver sit tal.
//
// Verdenen (opdigtet): som "midt_paa_dagen", men kl. 19 dansk tid. Etape 3 i etapeloebet (loebsdag 102)
// er forsinket og ikke koert. Endagsloebet sidst paa dagen (loebsdag 104) ER koert. Kolonnen for
// etapeloebet viser tallet ved etape 3's start (uden loebsdag 104); de andre kolonner viser tallet nu.
//
//   G1  Hver kolonne alene (udtagelse og Hold-fane), slukket og taendt: praecis som paa main.  GROEN paa main.
//   G2  Vagt: verdenen rammer graensen (kolonnerne har forskellige tal for de to ryttere).      GROEN paa main.
//   G3  Race Hub-soemmen: hver kolonne praecis som kolonnen alene, slukket og taendt.           ROED paa main
//       (soemmen findes ikke paa main; samme soem som krav K2).
//
// Facit (__fixtures__/dommer7801RestBygEtapegraenseFacit.json) er frosset paa origin/main af dommeren og
// maa aldrig genskabes med ny kode. Kun fingeraftryk (hard rule 17); decimaltal afrundes foer hash (#8113).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// <kerne> (dommerens fryse-script koerer praecis denne del paa main)
import { DATE, RACEHUB_RACES, SEASON, TEAM_IDS, createFake, flagName, sha, world } from "./dommer7801RestByg.harness.mjs";
import { getSelectionContext, ridersAtOpeningFatigue } from "./raceSelection.js";
import { getStageRolesContext } from "./raceStageRolesApi.js";

export const GRAENSE_NOW = new Date(`${DATE}T17:00:00.000Z`);
/** midt_paa_dagen + endagsloebet paa loebsdag 104 er koert, mens etape 3 (loebsdag 102) stadig venter. */
export function graenseWorld(flag) {
  const { state } = world("midt_paa_dagen", flag);
  const late = (id, value) => ({ rider_id: id, season_id: SEASON, race_id: "r-sent", stage_number: 1, game_day: 104, tick_date: DATE, load: value, consumed_at: null, duplicate_of_race_id: null });
  state.training_race_loads.push(late("a7", 27), late("a6", 21), late("b3", 25));
  Object.assign(state.races.find((r) => r.id === "r-sent"), { stages_completed: 1, status: "completed" });
  return state;
}
const silent = async (fn) => {
  const saved = { warn: console.warn, error: console.error };
  console.warn = () => {}; console.error = () => {};
  try { return await fn(); } catch (err) { return { kastet: err?.constructor?.name ?? "Error" }; } finally { Object.assign(console, saved); }
};
const raceOf = (state, id) => ({ ...state.races.find((r) => r.id === id) });
const withDoctorsRiders = (ctx) => (ctx?.kastet ? ctx : { ctx, laegensRyttere: ridersAtOpeningFatigue(ctx).map((r) => [r.id, r.fatigue ?? null]) });
/** Én kolonne alene paa en frisk databaseklient: udtagelsens svar (med det skjulte felt til laegens vurdering). */
export const columnAlone = (flag, team, raceId) => {
  const state = graenseWorld(flag);
  return silent(() => getSelectionContext({ supabase: createFake(state), race: raceOf(state, raceId), teamId: team, now: GRAENSE_NOW })).then(withDoctorsRiders);
};
export const teamTabAlone = (flag, team, raceId) => {
  const state = graenseWorld(flag);
  return silent(() => getStageRolesContext({ supabase: createFake(state), race: raceOf(state, raceId), teamId: team, now: GRAENSE_NOW }));
};
/** { kontakt: { hold: { udtagelse: [aftryk pr. kolonne], holdfane: [aftryk pr. kolonne] } } } */
export async function compute() {
  const out = {};
  for (const flag of [undefined, "on"]) {
    out[flagName(flag)] = {};
    for (const team of TEAM_IDS) {
      const udtagelse = []; const holdfane = [];
      for (const raceId of RACEHUB_RACES) {
        udtagelse.push(sha(await columnAlone(flag, team, raceId)));
        holdfane.push(sha(await teamTabAlone(flag, team, raceId)));
      }
      out[flagName(flag)][team] = { udtagelse, holdfane };
    }
  }
  return out;
}
// </kerne>

import { boardFunction } from "./dommer7801RestByg.harness.mjs";

const FACIT = JSON.parse(readFileSync(new URL("./__fixtures__/dommer7801RestBygEtapegraenseFacit.json", import.meta.url), "utf8"));

test("G1 etapegraensen, hver kolonne alene (udtagelse og Hold-fane): praecis som paa main, slukket og taendt", async () => {
  assert.deepEqual(await compute(), FACIT.kontakt);
});

test("G2 vagt: verdenen rammer graensen, saa kolonnerne har hver sit tal", async () => {
  const numbers = async (flag, raceId) => new Map((await columnAlone(flag, "team-a", raceId)).ctx.riders.map((r) => [r.id, r.fatigue ?? null]));
  const atStage = await numbers("on", "r-etape"); // tallet ved etape 3's start (loebsdag 102)
  const rightNow = await numbers("on", "r-imorgen"); // tallet nu (med loebsdag 104)
  const morning = await numbers(undefined, "r-etape");
  for (const id of ["a6", "a7"]) {
    assert.equal(typeof atStage.get(id), "number", id);
    assert.equal(typeof rightNow.get(id), "number", id);
    assert.notEqual(atStage.get(id), rightNow.get(id), `${id}: etapen paa loebsdag 104 maa ikke taelle med foer etape 3`);
  }
  // a6 har kun koert loebsdag 104: foer etape 3 er hans tal morgenens.
  assert.equal(atStage.get("a6"), morning.get("a6"));
  // En rytter uden etaper efter graensen har samme tal i begge kolonner, og det er ikke morgenens.
  assert.equal(atStage.get("a1"), rightNow.get("a1"));
  assert.notEqual(atStage.get("a1"), morning.get("a1"));
});

test("G3 Race Hub-soemmen: hver kolonne praecis som kolonnen alene, naar kolonnerne har hver sin etapegraense", async () => {
  const board = boardFunction();
  assert.equal(typeof board, "function", "soemmen getSelectionContextsForRaces mangler");
  for (const flag of [undefined, "on"]) for (const team of TEAM_IDS) {
    const state = graenseWorld(flag);
    const ctxs = await silent(() => board({ supabase: createFake(state), races: RACEHUB_RACES.map((id) => raceOf(state, id)), teamId: team, now: GRAENSE_NOW }));
    assert.ok(Array.isArray(ctxs), `${flagName(flag)} / ${team}: soemmen skal svare`);
    assert.deepEqual(ctxs.map((ctx) => sha(withDoctorsRiders(ctx))), FACIT.kontakt[flagName(flag)][team].udtagelse, `${flagName(flag)} / ${team}`);
  }
});
