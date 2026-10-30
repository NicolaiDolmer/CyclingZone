// #7390 (+ #2557/#7279): validatoren for drift-rapportens private grænser.
//
// Grænserne ligger i private_config under nøglen `weekly_engine_drift_thresholds`
// (privateConfig.ts' register). Værdien er selve `weeklyEngineDrift`-sektionen:
//   { minStages: n, groups: { <løbsgruppe>: { minStages?: n, <mål>: { min?, max? } } } }
// Reglerne og output-formen er de samme som `parseThresholds` i
// backend/scripts/ops/weeklyEngineDrift2557.mjs (#7279), så scriptet kan læse
// herfra i stedet for ENGINE_GATE_THRESHOLDS_JSON uden at ændre sin evaluering.
// Grupper og mål er spejlet her; #7279 importerer dem herfra, når det kobles på,
// så der kun findes én liste.
//
// Fejlbeskeder indeholder aldrig værdier fra konfigurationen (grænserne er
// private, hard rule 17). Ren funktion.

export const DRIFT_GROUPS = Object.freeze([
  "short_stage_race", "other_stage_race", "gt", "one_day", "monument", "u23_junior",
] as const);

export const DRIFT_MEASURE_KEYS = Object.freeze([
  "breakawayWinShare", "favoriteWinShare", "topRiderWinShare", "favoriteInBreakawayShare",
  "gcWinnerFromBreakawayShare", "abandonShare", "crashShare", "illnessShare", "fatigueShare",
] as const);

export interface DriftBand { min?: number; max?: number }
export interface DriftGroupThresholds { minStages?: number; bands: Record<string, DriftBand> }
export interface WeeklyEngineDriftThresholds { minStages: number; groups: Record<string, DriftGroupThresholds> }

const finite = (v: unknown) => v !== null && v !== undefined && Number.isFinite(Number(v));
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Validerer og normaliserer sektionen. Kaster ved ugyldig værdi (beskeden er værdi-fri). */
export function parseWeeklyEngineDriftThresholds(raw: unknown): WeeklyEngineDriftThresholds {
  if (!isPlainObject(raw)) throw new Error("weeklyEngineDrift skal være et objekt");
  if (!finite(raw.minStages) || Number(raw.minStages) < 0) throw new Error("weeklyEngineDrift.minStages mangler eller er ikke et tal >= 0");
  if (raw.groups !== undefined && !isPlainObject(raw.groups)) throw new Error("weeklyEngineDrift.groups skal være et objekt");
  const knownGroups = new Set<string>(DRIFT_GROUPS);
  const knownMeasures = new Set<string>(DRIFT_MEASURE_KEYS);
  const groups: Record<string, DriftGroupThresholds> = {};
  for (const [group, cfg] of Object.entries((raw.groups as Record<string, unknown>) ?? {})) {
    if (!knownGroups.has(group)) throw new Error("weeklyEngineDrift.groups indeholder en ukendt loebsgruppe");
    if (cfg !== undefined && cfg !== null && !isPlainObject(cfg)) throw new Error("weeklyEngineDrift: en gruppe skal være et objekt");
    const c = (cfg ?? {}) as Record<string, unknown>;
    const out: DriftGroupThresholds = { bands: {} };
    if (c.minStages !== undefined) {
      if (!finite(c.minStages) || Number(c.minStages) < 0) throw new Error("weeklyEngineDrift: en gruppes minStages er ikke et tal >= 0");
      out.minStages = Number(c.minStages);
    }
    for (const [measure, band] of Object.entries(c)) {
      if (measure === "minStages") continue;
      if (!knownMeasures.has(measure)) throw new Error("weeklyEngineDrift: en gruppe indeholder et ukendt maal");
      const b = (isPlainObject(band) ? band : {}) as Record<string, unknown>;
      const { min, max } = b;
      if (min === undefined && max === undefined) throw new Error("weeklyEngineDrift: et baand mangler baade min og max");
      if ((min !== undefined && !finite(min)) || (max !== undefined && !finite(max))) throw new Error("weeklyEngineDrift: et baand har en graense der ikke er et tal");
      out.bands[measure] = { ...(min !== undefined ? { min: Number(min) } : {}), ...(max !== undefined ? { max: Number(max) } : {}) };
    }
    groups[group] = out;
  }
  return { minStages: Number(raw.minStages), groups };
}
