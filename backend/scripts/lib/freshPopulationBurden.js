// Delt fresh-population-lønbyrde-model (ekstraheret fra moneySupplyScorecard i #1441 A2
// så inflationScorecard kan genbruge den — funktionen er UÆNDRET, flyttet 1:1).
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateLaunchPopulation } from "../../lib/fictionalLaunchPopulation.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { computeRiderTypes } from "../../lib/riderTypes.js";
import { predictBaseValue } from "../../lib/riderValuation.js";
import { allocateStarterSquads, STARTER_SQUAD } from "../../lib/starterSquadAllocator.js";
import { computeFrozenSalary } from "../../lib/contractSeed.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE_YEAR = 2026;

// ── ASSUMPTION: roster-størrelse pr. hold ved relaunch ──────────────────────────
// Autoritativ kilde: starterSquadAllocator.STARTER_SQUAD. Den fulde start-trup er nu
// TOTAL_SIZE (12 = CORE_SIZE 8 kerne + 4 svag hale) efter race-hub 0c.
// Scorecardet kalder allocateStarterSquads (= den løbsklare KERNE, CORE_SIZE=8/hold);
// den svage race-hub-0c-hale (TAIL_SIZE=4) allokeres separat og indgår IKKE her.
// Halen er bevidst dybe domestiques (base_value ~7k / lav løn) → forsvindende lille
// effekt på money supply, så money-supply-tallet er reelt uændret af de 4 ekstra ryttere.
// Allokeringen er DIVISION-BLIND (snake-draft på base_value over ALLE manager-hold,
// fairness-balanceret), så lønbyrden er ~ens pr. hold uanset division. De gamle 22/15/9-
// rosters i economyContractSimulation.js er MODNE-hold-templates, IKKE den friske relaunch.
export const RELAUNCH_TEAM_COUNT = 22; // relaunch-rehearsal 2026-06-11: 22 beta-manager-hold (#1191).

const median = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : 0;
};

// ── (A) SYNTETISK fresh-population-net ──────────────────────────────────────────
// Genererer den låste launch-population, kører den ægte starter-squad-allokering, og
// beregner den frosne lønbyrde (round(base_value × SALARY_RATE)) pr. hold. Returnerer
// median per-team-lønbyrde (division-blind) + populations-statistik.
export function computeFreshSalaryBurden() {
  const model = JSON.parse(readFileSync(path.join(SCRIPT_DIR, "../../lib/riderValuationModel.json"), "utf8"));
  const baseline = JSON.parse(readFileSync(path.join(SCRIPT_DIR, "../../lib/riderTypesBaseline.json"), "utf8"));

  const { riders } = generateLaunchPopulation();
  const pool = [];
  for (let i = 0; i < riders.length; i++) {
    const r = riders[i];
    const abilities = deriveAbilities({}, { ...r, id: `fic-${i}` }, { asOfYear: REFERENCE_YEAR });
    const { primary } = computeRiderTypes(abilities, baseline);
    const visible = {};
    for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) visible[k] = abilities[k];
    // base_value === market_value ved seed (prize_earnings_bonus = 0).
    const base_value = Math.round(predictBaseValue({ primary_type: primary.key }, visible, model) ?? 0);
    const age = r._meta?.age ?? (REFERENCE_YEAR - new Date(r.birthdate).getFullYear());
    pool.push({ id: `fic-${i}`, age, potentiale: Number(r.potentiale), base_value });
  }

  const teamIds = Array.from({ length: RELAUNCH_TEAM_COUNT }, (_, i) => `team-${i}`);
  const { assignments, leftToMarket, stats } = allocateStarterSquads(pool, teamIds);
  const byId = new Map(pool.map((p) => [p.id, p]));

  const burdens = teamIds.map((t) =>
    assignments[t].reduce(
      (s, id) => s + computeFrozenSalary({ base_value: byId.get(id).base_value, prize_earnings_bonus: 0 }),
      0
    )
  );
  const squadSizes = teamIds.map((t) => assignments[t].length);

  return {
    populationSize: pool.length,
    teamCount: RELAUNCH_TEAM_COUNT,
    squadSize: STARTER_SQUAD.CORE_SIZE,
    minSquadSize: Math.min(...squadSizes),
    maxSquadSize: Math.max(...squadSizes),
    burdenMin: Math.min(...burdens),
    burdenMedian: median(burdens),
    burdenMean: Math.round(burdens.reduce((a, b) => a + b, 0) / burdens.length),
    burdenMax: Math.max(...burdens),
    leftToMarket: leftToMarket.length,
    fairnessSpread: Math.round(stats.maxSquadBaseValue - stats.minSquadBaseValue),
  };
}
