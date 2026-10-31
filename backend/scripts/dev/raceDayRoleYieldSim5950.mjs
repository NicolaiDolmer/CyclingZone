#!/usr/bin/env node
// #5950 / #6110 · HARNESS: loebsdag = haard dag + rolle-vaegtet tillaeg mod det
// private baand (ejer-godkendt 31/10: loebsdagen skal give en privat fastsat andel
// af en haard dag i etapens evner, for senior, U23 og junior).
//
// Koerer PRODUKTIONSSTIEN (`applyDailyTick` + `withRaceDayRoleYield`), ikke en
// genimplementering. Populationen er syntetisk og deterministisk (alle aldre 17-33,
// alle potentialer, alle ryttertyper, seeded evner); scriptet laeser ingen database
// og skriver aldrig til en.
//
// MAALET pr. rytter, profil og rolle (samme rytter, samme dag, samme stoej):
//   andel = loebsdagens udbytte / en haard traeningsdags udbytte (loebsdagens basis
//           uden tillaeg, haard dag paa etapens profil-evner), begge summeret over
//   · "etapens evner" (DOMMEN): etapens profil-evner, som baandet er defineret
//   · "rollens evner" (info): profil-evnerne plus de evner rollens tillaeg lander i
//
// TALLENE ER PRIVATE (hard rule 17). Stdout viser KUN dommen (inside/outside) pr.
// aldersgruppe og rolle. Baandet laeses fra motor-testport-thresholds.json
// (raceDayDevelopment.vsHardDayInStageAbilities) og params fra en privat fil; begge
// ligger i balance-internals/ (OneDrive). Med --private-out skrives de fulde tal til en
// privat fil.
//
// KOERSEL (fra repo-roden):
//   node backend/scripts/dev/raceDayRoleYieldSim5950.mjs \
//     [--thresholds <motor-testport-thresholds.json>] [--params <params.json>] \
//     [--curve-b <curve-b-params.json>] [--private-out <fil>]
// Default-stier: $BALANCE_INTERNALS_DIR eller ~/OneDrive/CyclingZone-context/balance-internals.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { applyDailyTick, RACE_PROFILE_ABILITY_MAP } from "../../lib/dailyTraining.js";
import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { buildCapsForRider, seededUnitMixed } from "../../lib/riderProgression.js";
import { RIDER_TYPE_KEYS } from "../../lib/riderTypes.js";
import { riderLevelBand } from "../../lib/staffAbilityConstants.js";
import { raceDayBudgetDivisor } from "../../lib/trainingRaceDayTick.js";
import { validateDevelopmentCurveBParams } from "../../lib/developmentCurveB.ts";
import {
  raceDayRoleBaseProgram, raceDayRoleBonusWeights, validateRaceDayRoleYieldParams, withRaceDayRoleYield,
} from "../../lib/raceDayRoleYield5950.js";

export const AGE_GROUPS = Object.freeze([
  { key: "junior", min: 17, max: 18 },
  { key: "u23", min: 19, max: 22 },
  { key: "senior", min: 23, max: 33 },
]);
// Én repraesentant pr. rollegruppe + de roller der deler gruppe, saa dommen daekker alle.
export const ROLES = Object.freeze(["captain", "sprint_captain", "co_captain", "hunter", "helper", "luxury_helper", "free_role"]);
export const PROFILES = Object.freeze(Object.keys(RACE_PROFILE_ABILITY_MAP));
const POTENTIALER = Object.freeze([1, 2, 3, 4, 5, 6]);
const DAYS = 8; // forskellige stoej-udfald pr. rytter

export function ageGroupFor(age) {
  return AGE_GROUPS.find((g) => age >= g.min && age <= g.max)?.key ?? null;
}

/** Deterministisk syntetisk population: alle aldre x potentialer x typer. */
export function syntheticPopulation() {
  const out = [];
  for (let age = 17; age <= 33; age += 1) {
    for (const potentiale of POTENTIALER) {
      for (const primary_type of RIDER_TYPE_KEYS) {
        const id = `sim5950-${age}-${potentiale}-${primary_type}`;
        const abilities = {};
        for (const k of VISIBLE_ABILITIES) {
          const level = 15 + Math.min(age - 16, 12) * 3 + potentiale * 3;
          abilities[k] = Math.max(1, Math.min(85, Math.round(level + (seededUnitMixed(`${id}:${k}`) - 0.5) * 30)));
        }
        out.push({ id, age, potentiale, primary_type, secondary_type: null, is_academy: age <= 18, abilities });
      }
    }
  }
  return out;
}

function yieldOf(result, abilities) {
  let sum = 0;
  for (const k of abilities) sum += (result.gains[k] ?? 0) + Number(result.progress[k] ?? 0);
  return sum;
}

/** Evnerne rollens tillaeg kan lande i, plus etapens profil-evner. */
export function roleAbilities(profile, role, params) {
  const out = new Set(RACE_PROFILE_ABILITY_MAP[profile] ?? []);
  for (const [k, w] of Object.entries(raceDayRoleBonusWeights(profile, role, params.leadShare))) if (w > 0) out.add(k);
  return [...out];
}

/**
 * Andelen loebsdag / haard dag for én rytter, profil og rolle (snit over DAYS dage).
 * @returns {{ stage: number|null, role: number|null }}
 */
export function yieldRatio(rider, profile, role, params, { curveB = null, budgetDivisor = raceDayBudgetDivisor() } = {}) {
  const caps = buildCapsForRider(rider.abilities, { potentiale: rider.potentiale, age: rider.age }, rider.primary_type, rider.secondary_type);
  const program = raceDayRoleBaseProgram(profile);
  const extra = withRaceDayRoleYield({}, { params, profileType: profile, role });
  const stageSet = RACE_PROFILE_ABILITY_MAP[profile] ?? [];
  const roleSet = roleAbilities(profile, role, params);
  const sums = { hardStage: 0, raceStage: 0, hardRole: 0, raceRole: 0 };
  for (let day = 0; day < DAYS; day += 1) {
    const args = {
      riderId: rider.id, dateStr: "2026-10-31", tickSeedKey: `sim5950#gd${day + 1}`, age: rider.age,
      abilities: rider.abilities, caps, progress: {}, program, conditionMult: 1, potentiale: rider.potentiale,
      primaryType: rider.primary_type, secondaryType: rider.secondary_type,
      riderLevel: riderLevelBand({ is_academy: rider.is_academy, age: rider.age }),
      budgetDivisor, hardDailyCap: Infinity, curveB,
    };
    const hard = applyDailyTick(args);
    const race = applyDailyTick({ ...args, ...extra });
    sums.hardStage += yieldOf(hard, stageSet);
    sums.raceStage += yieldOf(race, stageSet);
    sums.hardRole += yieldOf(hard, roleSet);
    sums.raceRole += yieldOf(race, roleSet);
  }
  return {
    stage: sums.hardStage > 0 ? sums.raceStage / sums.hardStage : null,
    role: sums.hardRole > 0 ? sums.raceRole / sums.hardRole : null,
  };
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

function summarize(cells, band) {
  const full = {};
  const verdict = {};
  for (const [key, list] of Object.entries(cells)) {
    const sorted = [...list].sort((a, b) => a - b);
    const stats = { n: sorted.length, p10: quantile(sorted, 0.1), median: quantile(sorted, 0.5), p90: quantile(sorted, 0.9), min: sorted[0], max: sorted.at(-1) };
    full[key] = stats;
    // Inside = hele midterfeltet (p10-p90) ligger i baandet.
    verdict[key] = stats.p10 >= band.min && stats.p90 <= band.max ? "inside" : "outside";
  }
  return { full, verdict, allInside: Object.values(verdict).every((v) => v === "inside") };
}

/** Hele harnessen. Returnerer de fulde tal (private) og dommen (offentlig). */
export function runHarness({ params, band, curveB = null, population = syntheticPopulation() }) {
  const stageCells = {};
  const roleCells = {};
  for (const rider of population) {
    const group = ageGroupFor(rider.age);
    for (const role of ROLES) {
      const key = `${group}/${role}`;
      stageCells[key] ??= [];
      roleCells[key] ??= [];
      for (const profile of PROFILES) {
        const r = yieldRatio(rider, profile, role, params, { curveB });
        if (Number.isFinite(r.stage)) stageCells[key].push(r.stage);
        if (Number.isFinite(r.role)) roleCells[key].push(r.role);
      }
    }
  }
  const stage = summarize(stageCells, band);
  const roleInfo = summarize(roleCells, band);
  return { ...stage, roleInfo };
}

function verdictTable(verdict) {
  const lines = [
    "| Aldersgruppe | " + ROLES.join(" | ") + " |",
    "|---|" + ROLES.map(() => "---").join("|") + "|",
  ];
  for (const g of AGE_GROUPS) lines.push(`| ${g.key} | ${ROLES.map((r) => verdict[`${g.key}/${r}`] ?? "-").join(" | ")} |`);
  return lines;
}

export function toVerdictMarkdown({ verdict, allInside, roleInfo }) {
  const lines = ["Dom - etapens evner:", ...verdictTable(verdict)];
  lines.push("", `Samlet dom: ${allInside ? "inside" : "outside"} (alle profiler, ${DAYS} dage pr. rytter, p10-p90 i baandet).`);
  if (roleInfo) {
    lines.push("", "Info - rollens evner (etapens evner + hvor rollens tillaeg lander):", ...verdictTable(roleInfo.verdict));
  }
  return lines.join("\n");
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function main(argv = process.argv.slice(2)) {
  const dir = process.env.BALANCE_INTERNALS_DIR || join(homedir(), "OneDrive", "CyclingZone-context", "balance-internals");
  const thresholdsPath = argValue(argv, "--thresholds") ?? join(dir, "motor-testport-thresholds.json");
  const paramsPath = argValue(argv, "--params") ?? join(dir, "6110", "race-day-role-yield-5950", "params.json");
  const curveBPath = argValue(argv, "--curve-b");
  const privateOut = argValue(argv, "--private-out");
  for (const p of [thresholdsPath, paramsPath]) {
    if (!existsSync(p)) throw new Error(`private input missing: ${p}`);
  }
  const band = readJson(thresholdsPath)?.raceDayDevelopment?.vsHardDayInStageAbilities;
  if (!Number.isFinite(band?.min) || !Number.isFinite(band?.max)) throw new Error("raceDayDevelopment band missing in thresholds file");
  const params = validateRaceDayRoleYieldParams(readJson(paramsPath));
  if (!params) throw new Error("params file is invalid (validateRaceDayRoleYieldParams)");
  const curveB = curveBPath ? validateDevelopmentCurveBParams(readJson(curveBPath)) : null;
  if (curveBPath && !curveB) throw new Error("curve B params file is invalid");
  const report = runHarness({ params, band, curveB });
  if (privateOut) writeFileSync(privateOut, JSON.stringify({ band, params, curveB: !!curveB, ...report }, null, 2));
  console.log(`Kurve: ${curveB ? "B" : "dagens"}`);
  console.log(toVerdictMarkdown(report));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
