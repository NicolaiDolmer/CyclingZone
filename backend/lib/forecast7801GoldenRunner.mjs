// #7801 svartid: koerer prognosens opslag (loadTeamFatigueForecast) paa dommerens opdigtede verdener
// og giver kun fingeraftryk (hard rule 17). Samme fil koeres mod en FROSSET kopi af merge-base-koden
// (golden-base) for at fryse facit, og mod den nye kode i proeven. Filen har ingen afhaengighed af
// den nye kode ud over det, begge traeer har: harnessen, prognosen og kontakterne.
//
// Hvad der fryses: svaret for hvert scenarie og hold under hver kontaktkombination, og svaret
// (eller fejlens klasse og tekst), naar ET opslag ad gangen ikke kan laeses. Antal kald og runder
// fryses ikke: dem aendrer ombygningen med vilje (se riderFatigueNowCalls7801.test.js).

import { SCENARIO_NAMES, SEASON, countCalls, createFake, sha, world } from "./dommer7801RestByg.harness.mjs";
import { loadTeamFatigueForecast } from "./trainingWeekPlanForecast.js";

const TEAMS = ["team-a", "team-b"];
// Kontaktkombinationer: [navn, fatigue_now_7801, aendring af app_config].
const VARIANTS = [
  ["mangler", undefined, (rows) => rows],
  ["off", "off", (rows) => rows],
  ["on", "on", (rows) => rows],
  ["on_uden_model", "on", (rows) => rows.filter((r) => r.key !== "condition_model_v2")],
  ["on_uden_dagsmodel", "on", (rows) => rows.filter((r) => r.key !== "condition_v2_race_date_training_day")],
  ["on_uden_dagsopgoerelse", "on", (rows) => rows.filter((r) => r.key !== "training_condition_per_date")],
];
const FAIL_SCENARIOS = ["midt_paa_dagen", "aften_alle_koert", "traen_nu_trykket", "hviledag"];
const FAIL_MODES = ["error", "throw"];

async function quiet(fn) {
  const saved = { warn: console.warn, error: console.error };
  console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
}

async function runForecast(name, flag, mutate, team, fail = null) {
  const { now, state } = world(name, flag);
  state.app_config = mutate(state.app_config);
  const fake = createFake(state, { fail });
  let svar;
  try {
    svar = await quiet(() => loadTeamFatigueForecast({ supabase: fake, team: { id: team, league_division_id: "div-1" }, seasonId: SEASON, now }));
  } catch (err) {
    svar = { kastet: err?.constructor?.name ?? "Error", tekst: String(err?.message ?? err) };
  }
  return { svar, log: fake.log };
}

/** { kontakt: { variant: { scenarie: { hold: <sha> } } }, fejl: { scenarie: { hold: { "<maal>:<maade>": <sha> } } } } */
export async function runGolden(frozen = null) {
  const out = { kontakt: {}, fejl: {} };
  for (const [variant, flag, mutate] of VARIANTS) {
    out.kontakt[variant] = {};
    for (const name of SCENARIO_NAMES) {
      out.kontakt[variant][name] = {};
      for (const team of TEAMS) out.kontakt[variant][name][team] = sha((await runForecast(name, flag, mutate, team)).svar);
    }
  }
  for (const name of FAIL_SCENARIOS) {
    out.fejl[name] = {};
    for (const team of TEAMS) {
      out.fejl[name][team] = {};
      // Maalene er de tabeller og kontakter, forecasten laeser i facit-koden (frosset). Uden facit
      // (ved selve frysningen paa merge-base) findes de ved at koere en gang med alt tilgaengeligt.
      const { log } = frozen ? { log: [] } : await runForecast(name, "on", (rows) => rows, team);
      const targets = frozen
        ? [...new Set(Object.keys(frozen.fejl[name][team]).map((key) => key.slice(0, key.lastIndexOf(":"))))]
        : [...new Set(log.map((entry) => entry.target))].sort();
      for (const target of targets) for (const mode of FAIL_MODES) {
        const { svar } = await runForecast(name, "on", (rows) => rows, team, (table, keyHint) => ((table === "app_config" && keyHint ? `app_config:${keyHint}` : table) === target ? mode : null));
        out.fejl[name][team][`${target}:${mode}`] = sha(svar);
      }
    }
  }
  return out;
}

/** Antal kald og runder for en forecast, til proeven af svartiden. */
export async function forecastCalls(name, team, flag = "on") {
  const { log } = await runForecast(name, flag, (rows) => rows, team);
  const { kald, runder } = countCalls(log);
  return { kald, runder };
}
