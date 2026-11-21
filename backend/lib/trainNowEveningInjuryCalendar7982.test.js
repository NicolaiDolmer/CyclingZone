// #7982 trin 4a, dommens fund 2 (15/11): aftenkoerslen spoerger om skadens kalender som paa main.
//
// Trin 4a lader kun trykket (med sin hukommelse) spoerge om skadens kalender med loebsdags-opslagets
// to spoergsmaal (`pressPath` i resolveConditionInjuryDates). Aftenkoerslen skal spoerge praecis som
// paa main: holdets pulje med loadTeamDivisionId og puljens loeb med resolveInjuryEndDates' egen
// laesning. Dommerens facit sammenligner laesningernes filtre, ikke kolonnelisten (select), saa den
// ser ikke en aendring, der kun roerer kolonnerne. Denne proeve tager fingeraftryk af ALLE aftenkoerslens
// laesninger, med tabel, kolonneliste og hvert filter i raekkefoelge, i et forloeb hvor en skades
// slutdato slaas op i kalenderen.
//
// Fingeraftrykket nedenfor er maalt med mains motor (main 7b954034e og de47e8d56, dailyTrainingEngine.js
// lagt ind midlertidigt) og er det samme paa grenen. Dommerens filer roeres ikke; filen importerer
// kun harnesset (hvis stedfortraeder ikke optager kolonnelisten, derfor optager proeven den selv).
import test from "node:test";
import assert from "node:assert/strict";
import { SCENARIOS, seedState, createFake, sweep, canon, digest, TEAM, SEASON, DIVISION } from "./trainNowSameResult7982.harness.js";

// Maalt paa main og grenen (se ovenfor). Aendres aftenkoerslens laesninger med vilje, maales det igen.
// #8520 G3a: rytter-opslaget henter nu ogsaa talent_ceiling (P til XP-afstanden); kolonnen findes i prod (smallint).
const MAIN_EVENING_READS = "17b7b9c25319a6c5c3b2";

/** Optager hver laesning: tabel, kolonneliste og filtrene i den raekkefoelge, koden kalder dem. */
function recordReads(fake) {
  const reads = [];
  const realFrom = fake.supabase.from;
  fake.supabase.from = (table) => {
    const entry = { table, select: null, calls: [], write: false };
    reads.push(entry);
    const builder = realFrom(table);
    const wrapped = new Proxy(builder, {
      get(target, prop) {
        const value = target[prop];
        if (typeof prop === "symbol" || typeof value !== "function") return value;
        if (prop === "then") return value.bind(target);
        return (...args) => {
          if (prop === "select" && entry.select === null && !entry.write) entry.select = String(args[0] ?? "*");
          else if (["insert", "update", "upsert", "delete"].includes(prop)) entry.write = true;
          else entry.calls.push([prop, canon(args)]);
          const next = value.apply(target, args);
          // The fake's chain methods return its builder (not its proxy): keep recording on it.
          return next !== null && typeof next === "object" && next.eq === target.eq ? wrapped : next;
        };
      },
    });
    return wrapped;
  };
  return () => reads.filter((entry) => !entry.write).map(({ table, select, calls }) => ({ table, select, calls }));
}

async function eveningRun() {
  const state = seedState(SCENARIOS.aftenkoersel_uden_tryk.seed);
  const fake = createFake(state);
  const reads = recordReads(fake);
  const saved = { warn: console.warn, error: console.error, info: console.info, log: console.log };
  console.warn = () => {}; console.error = () => {}; console.info = () => {}; console.log = () => {};
  let out;
  try { out = await sweep(state, fake); } finally { Object.assign(console, saved); }
  return { out, reads: reads(), state };
}

test("forudsaetning: aftenkoerslen slaar en skades slutdato op i kalenderen", async () => {
  const { out, reads, state } = await eveningRun();
  assert.ok(out.every((day) => !day.error), "aftenkoerslen gennemfoerer alle fem dag-felter");
  assert.ok(state.rider_condition.some((row) => row.injury_end_game_day != null && row.injured_until), "en skadet rytter har en slutdato");
  const calendar = reads.filter((entry) => entry.table === "race_stage_schedule" && entry.calls.some(([op]) => op === "gte"));
  assert.equal(calendar.length, 1, "skadens kalender (etapeplanen fra slut-loebsdagen) laeses én gang");
});

test("aftenkoerslen spoerger om skadens pulje og loeb som paa main (kolonneliste og filtre)", async () => {
  const { reads } = await eveningRun();
  const calendar = reads.findIndex((entry) => entry.table === "race_stage_schedule" && entry.calls.some(([op]) => op === "gte"));
  // De to laesninger lige foer kalenderen: loadTeamDivisionId og resolveInjuryEndDates' egen loebs-laesning.
  assert.deepEqual(reads.slice(calendar - 2, calendar), [
    { table: "teams", select: "league_division_id", calls: [["eq", ["id", TEAM]], ["maybeSingle", []]] },
    { table: "races", select: "id", calls: [["eq", ["season_id", SEASON.id]], ["eq", ["league_division_id", DIVISION]]] },
  ], "aftenkoerslen maa ikke spoerge med trykkets loebsdags-opslag (pressPath)");
});

test("fingeraftryk af alle aftenkoerslens laesninger, med kolonnelister, er mains", async () => {
  const { reads } = await eveningRun();
  assert.equal(digest(reads), MAIN_EVENING_READS,
    `aftenkoerslens laesninger (${reads.length}) er ikke laengere mains; foerste kalender-relaterede: `
    + JSON.stringify(reads.filter((entry) => ["teams", "races"].includes(entry.table)).slice(-2)));
});
