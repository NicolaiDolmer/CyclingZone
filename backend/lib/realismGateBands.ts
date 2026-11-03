// #7588 (realisme-gate, løsning B, PR 2): schema og validator for gatens private
// bånd og kendt-rød-listen.
//
// Båndene ligger i private_config under nøglen `realism_gate_bands`, kendt-rød-
// listen under `realism_gate_known_red` (samme mønster som
// `weekly_engine_drift_thresholds`, #7390; kun service-rollen kan læse). Repoet
// har KUN navnene, schemaet og validatoren her; tallene er private (hard rule 17).
// Rækkerne skrives først efter ejerens go på båndene (prod-skrivning).
//
// Navnekataloget (løbsgrupper, terræn, afslutninger, metrikker og deres
// statistikker) bor her, så målemodulet (backend/scripts/dev/lib/realismMetrics.mjs),
// den kommende runner og drift-vagten bruger én liste.
//
// Versionskrav: en ændring af båndene = ny `version` + en `_decisions`-note med
// dato og ejerens ordlyd. En værdi uden version, eller hvor ingen beslutning
// bærer den aktuelle version, afvises (gaten nægter at køre på den).
//
// Fejlbeskeder indeholder aldrig værdier fra konfigurationen (kun navne på
// strukturelle nøgler). Ren funktion, ingen IO.

import { STAGE_PROFILE_TYPES } from "./stageProfileTypes.js";

export const REALISM_GATE_BANDS_KEY = "realism_gate_bands";
export const REALISM_GATE_KNOWN_RED_KEY = "realism_gate_known_red";

/** Løbsgruppe for en etape-celle (endagsløb, monument, etapeløb, Grand Tour). */
export const REALISM_RACE_GROUPS = Object.freeze(["one_day", "monument", "stage_race", "gt"] as const);

/** Løbsgruppe for de samlede klassements-mål (M10 Grand Tour, M11 korte etapeløb). */
export const REALISM_GC_GROUPS = Object.freeze(["gt", "sr2-4", "sr5-8"] as const);

/** Terræn = etapens profile_type (DB-ordforrådet, stageProfileTypes.js). */
export const REALISM_TERRAINS: readonly string[] = Object.freeze([...STAGE_PROFILE_TYPES]);

/**
 * Afslutnings-spande (strukturelle, ingen balance): topmål, nedkørsel, spurt,
 * kort stigning/mur, enkeltstart og alt andet. realismMetrics.finishOf mapper
 * finale_type hertil.
 */
export const REALISM_FINISHES = Object.freeze(["summit", "descent", "sprint", "punch", "tt", "other"] as const);

/** Jokertegn i en cellenøgle: cellen samler alle værdier på den akse. */
export const CELL_WILDCARD = "*";

export type RealismStat = "median" | "p90" | "share" | "count";

export interface RealismMetricSpec {
  /** M1-M11 fra designet. */
  id: string;
  /** "stage" = pr. etape-celle, "gc" = pr. klassements-gruppe. */
  scope: "stage" | "gc";
  stats: readonly RealismStat[];
  /** Kvalitativ dansk tekst til en rød dom (ingen tal). */
  label: string;
}

const spec = (id: string, scope: "stage" | "gc", stats: RealismStat[], label: string): RealismMetricSpec =>
  Object.freeze({ id, scope, stats: Object.freeze(stats), label });

/** Metrik-kataloget. Nøglen er navnet i båndene og i målemodulets output. */
export const REALISM_METRICS = Object.freeze({
  gapTo10: spec("M1", "stage", ["median", "p90"], "afstanden fra vinderen til nr. 10"),
  ittGapTo10PerKm: spec("M1", "stage", ["median", "p90"], "afstanden fra vinderen til nr. 10 pr. km på enkeltstarten"),
  breakawayWinShare: spec("M2", "stage", ["share"], "hvor ofte udbruddet vinder"),
  breakawayMaxLead: spec("M3", "stage", ["median", "p90"], "udbruddets største forspring"),
  bigLeadShare: spec("M4", "stage", ["share"], "hvor ofte udbruddet får et meget stort forspring"),
  overHardCapCount: spec("M5", "stage", ["count"], "udbrud over den hårde grænse for forspring"),
  breakawayPeakFrac: spec("M6", "stage", ["median"], "hvor på etapen udbruddets forspring topper"),
  breakawayPlateau: spec("M7", "stage", ["median"], "hvor meget af forspringet udbruddet holder midt på etapen"),
  breakawayCaughtKmToGo: spec("M8", "stage", ["median"], "hvor langt fra mål feltet henter udbruddet"),
  favouriteWinShare: spec("M9", "stage", ["share"], "hvor ofte en af favoritterne vinder"),
  bestRiderWinShare: spec("M9", "stage", ["share"], "hvor ofte den stærkeste rytter til ruten vinder"),
  gcFinalTo10: spec("M10/M11", "gc", ["median", "p90"], "afstanden i klassementet fra vinderen til nr. 10"),
  gcWinnerMargin: spec("M11", "gc", ["median"], "klassementsvinderens margin"),
} satisfies Record<string, RealismMetricSpec>);

export type RealismMetricKey = keyof typeof REALISM_METRICS;
export const REALISM_METRIC_KEYS = Object.freeze(Object.keys(REALISM_METRICS) as RealismMetricKey[]);

/** Parametre målemodulet skal have for M4/M5 (tærskler, private). */
export const REALISM_PARAM_KEYS = Object.freeze(["bigLeadSeconds", "hardCapSeconds"] as const);
export type RealismParamKey = (typeof REALISM_PARAM_KEYS)[number];

/** Retning på en kendt rød celle: målingen ligger over eller under båndet. */
export const KNOWN_RED_DIRECTIONS = Object.freeze(["above", "below"] as const);

export interface RealismBand { min?: number; max?: number }
export type RealismMetricBands = Partial<Record<RealismStat, RealismBand>>;
export interface RealismCellBands { minRoutes?: number; metrics: Partial<Record<RealismMetricKey, RealismMetricBands>> }
export interface RealismDecision { version: string; date: string; quote: string }
export interface RealismGateBands {
  version: string;
  decisions: RealismDecision[];
  minRoutes: number;
  params: Partial<Record<RealismParamKey, number>>;
  cells: Record<string, RealismCellBands>;
  gcGroups: Record<string, RealismCellBands>;
}
export interface KnownRedEntry { cell: string; metric: RealismMetricKey; stat: RealismStat; issue: string; direction: (typeof KNOWN_RED_DIRECTIONS)[number]; tolerance?: number }
export interface RealismGateKnownRed { version: string; entries: KnownRedEntry[] }

const finite = (v: unknown) => v !== null && v !== undefined && typeof v !== "boolean" && v !== "" && Number.isFinite(Number(v));
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISSUE_RE = /^#\d+$/;

/** Versionen som tekst; tom, manglende eller ikke-tekst/tal = null. */
function versionOf(v: unknown): string | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return String(v);
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  return null;
}

/** "gruppe|terræn|afslutning" med jokertegn. Returnerer null ved ugyldig nøgle. */
export function parseCellKey(key: unknown): { group: string; terrain: string; finish: string } | null {
  if (typeof key !== "string") return null;
  const parts = key.split("|");
  if (parts.length !== 3) return null;
  const [group, terrain, finish] = parts;
  const ok = (value: string, allowed: readonly string[]) => value === CELL_WILDCARD || allowed.includes(value);
  if (!ok(group, REALISM_RACE_GROUPS) || !ok(terrain, REALISM_TERRAINS) || !ok(finish, REALISM_FINISHES)) return null;
  return { group, terrain, finish };
}

export function cellKey(group: string, terrain: string, finish: string): string {
  return `${group}|${terrain}|${finish}`;
}

function parseMinRoutes(v: unknown, where: string): number {
  if (!finite(v) || !Number.isInteger(Number(v)) || Number(v) < 1) throw new Error(`realismGate: ${where} minRoutes er ikke et heltal >= 1`);
  return Number(v);
}

function parseBand(raw: unknown, where: string): RealismBand {
  if (!isPlainObject(raw)) throw new Error(`realismGate: ${where} skal være et objekt med min og/eller max`);
  for (const k of Object.keys(raw)) if (k !== "min" && k !== "max") throw new Error(`realismGate: ${where} har en ukendt nøgle`);
  const { min, max } = raw;
  if (min === undefined && max === undefined) throw new Error(`realismGate: ${where} mangler både min og max`);
  if ((min !== undefined && !finite(min)) || (max !== undefined && !finite(max))) throw new Error(`realismGate: ${where} har en grænse der ikke er et tal`);
  if (min !== undefined && max !== undefined && Number(min) > Number(max)) throw new Error(`realismGate: ${where} har min større end max`);
  return { ...(min !== undefined ? { min: Number(min) } : {}), ...(max !== undefined ? { max: Number(max) } : {}) };
}

function parseCellBands(raw: unknown, where: string, scope: "stage" | "gc"): RealismCellBands {
  if (!isPlainObject(raw)) throw new Error(`realismGate: ${where} skal være et objekt`);
  const out: RealismCellBands = { metrics: {} };
  for (const [metric, value] of Object.entries(raw)) {
    if (metric === "minRoutes") { out.minRoutes = parseMinRoutes(value, where); continue; }
    if (!Object.hasOwn(REALISM_METRICS, metric)) throw new Error(`realismGate: ${where} indeholder en ukendt metrik`);
    const s = REALISM_METRICS[metric as RealismMetricKey];
    if (s.scope !== scope) throw new Error(`realismGate: ${where} indeholder metrikken ${metric}, der ikke hører til denne slags celle`);
    if (!isPlainObject(value)) throw new Error(`realismGate: ${where}.${metric} skal være et objekt pr. statistik`);
    const stats: RealismMetricBands = {};
    for (const [stat, band] of Object.entries(value)) {
      if (!(s.stats as readonly string[]).includes(stat)) throw new Error(`realismGate: ${where}.${metric} har en statistik metrikken ikke har`);
      stats[stat as RealismStat] = parseBand(band, `${where}.${metric}.${stat}`);
    }
    if (!Object.keys(stats).length) throw new Error(`realismGate: ${where}.${metric} har intet bånd`);
    out.metrics[metric as RealismMetricKey] = stats;
  }
  if (!Object.keys(out.metrics).length) throw new Error(`realismGate: ${where} har ingen metrik med bånd`);
  return out;
}

function parseDecisions(raw: unknown, version: string): RealismDecision[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error("realismGate: _decisions mangler (en ændring kræver ejerens beslutning med dato og ordlyd)");
  const out = raw.map((d) => {
    if (!isPlainObject(d)) throw new Error("realismGate: en beslutning skal være et objekt");
    const v = versionOf(d.version);
    if (!v) throw new Error("realismGate: en beslutning mangler version");
    if (typeof d.date !== "string" || !DATE_RE.test(d.date) || Number.isNaN(Date.parse(`${d.date}T00:00:00Z`))) throw new Error("realismGate: en beslutning har ikke en dato (ÅÅÅÅ-MM-DD)");
    if (typeof d.quote !== "string" || d.quote.trim() === "") throw new Error("realismGate: en beslutning mangler ejerens ordlyd");
    return { version: v, date: d.date, quote: d.quote };
  });
  if (!out.some((d) => d.version === version)) throw new Error("realismGate: ingen beslutning bærer den aktuelle version");
  return out;
}

/** Validerer og normaliserer `realism_gate_bands`. Kaster ved ugyldig værdi (beskeden er værdi-fri). */
export function parseRealismGateBands(raw: unknown): RealismGateBands {
  if (!isPlainObject(raw)) throw new Error("realismGate: båndene skal være et objekt");
  const known = new Set(["version", "_decisions", "minRoutes", "params", "cells", "gcGroups"]);
  for (const k of Object.keys(raw)) if (!known.has(k)) throw new Error("realismGate: båndene har en ukendt nøgle på øverste niveau");
  const version = versionOf(raw.version);
  if (!version) throw new Error("realismGate: version mangler (gaten kører ikke på bånd uden version)");
  const decisions = parseDecisions(raw._decisions, version);
  const minRoutes = parseMinRoutes(raw.minRoutes, "båndenes");

  const params: Partial<Record<RealismParamKey, number>> = {};
  if (raw.params !== undefined) {
    if (!isPlainObject(raw.params)) throw new Error("realismGate: params skal være et objekt");
    for (const [k, v] of Object.entries(raw.params)) {
      if (!(REALISM_PARAM_KEYS as readonly string[]).includes(k)) throw new Error("realismGate: params har en ukendt parameter");
      if (!finite(v) || Number(v) <= 0) throw new Error(`realismGate: params.${k} er ikke et tal > 0`);
      params[k as RealismParamKey] = Number(v);
    }
  }

  if (!isPlainObject(raw.cells)) throw new Error("realismGate: cells mangler eller er ikke et objekt");
  const cells: Record<string, RealismCellBands> = {};
  for (const [key, value] of Object.entries(raw.cells)) {
    if (!parseCellKey(key)) throw new Error("realismGate: cells har en ugyldig cellenøgle (gruppe|terræn|afslutning)");
    cells[key] = parseCellBands(value, `cells[${key}]`, "stage");
  }
  if (!Object.keys(cells).length) throw new Error("realismGate: cells er tom");

  const gcGroups: Record<string, RealismCellBands> = {};
  if (raw.gcGroups !== undefined) {
    if (!isPlainObject(raw.gcGroups)) throw new Error("realismGate: gcGroups skal være et objekt");
    for (const [group, value] of Object.entries(raw.gcGroups)) {
      if (!(REALISM_GC_GROUPS as readonly string[]).includes(group)) throw new Error("realismGate: gcGroups har en ukendt klassements-gruppe");
      gcGroups[group] = parseCellBands(value, `gcGroups[${group}]`, "gc");
    }
  }

  // Et bånd på M4/M5 er meningsløst uden tærsklen: afvis ved skrivning, ikke ved kørsel.
  const usesParam = (metric: RealismMetricKey) => Object.values(cells).some((c) => c.metrics[metric] !== undefined);
  if (usesParam("bigLeadShare") && params.bigLeadSeconds === undefined) throw new Error("realismGate: bigLeadShare har bånd men params.bigLeadSeconds mangler");
  if (usesParam("overHardCapCount") && params.hardCapSeconds === undefined) throw new Error("realismGate: overHardCapCount har bånd men params.hardCapSeconds mangler");

  return { version, decisions, minRoutes, params, cells, gcGroups };
}

/** Validerer og normaliserer `realism_gate_known_red`. Kaster ved ugyldig værdi (beskeden er værdi-fri). */
export function parseRealismGateKnownRed(raw: unknown): RealismGateKnownRed {
  if (!isPlainObject(raw)) throw new Error("realismGate: kendt-rød-listen skal være et objekt");
  const version = versionOf(raw.version);
  if (!version) throw new Error("realismGate: kendt-rød-listen mangler version");
  if (!Array.isArray(raw.entries)) throw new Error("realismGate: kendt-rød-listen mangler entries");
  const seen = new Set<string>();
  const entries = raw.entries.map((e): KnownRedEntry => {
    if (!isPlainObject(e)) throw new Error("realismGate: en kendt rød skal være et objekt");
    const cell = parseCellKey(e.cell) ? String(e.cell) : null;
    const isGcCell = typeof e.cell === "string" && (REALISM_GC_GROUPS as readonly string[]).includes(e.cell);
    if (!cell && !isGcCell) throw new Error("realismGate: en kendt rød har en ugyldig celle");
    if (typeof e.metric !== "string" || !Object.hasOwn(REALISM_METRICS, e.metric)) throw new Error("realismGate: en kendt rød har en ukendt metrik");
    const s = REALISM_METRICS[e.metric as RealismMetricKey];
    if (s.scope !== (isGcCell ? "gc" : "stage")) throw new Error("realismGate: en kendt røds metrik hører ikke til cellens slags");
    if (typeof e.stat !== "string" || !(s.stats as readonly string[]).includes(e.stat)) throw new Error("realismGate: en kendt rød har en statistik metrikken ikke har");
    if (typeof e.issue !== "string" || !ISSUE_RE.test(e.issue)) throw new Error("realismGate: en kendt rød skal pege på et issue (#N)");
    if (typeof e.direction !== "string" || !(KNOWN_RED_DIRECTIONS as readonly string[]).includes(e.direction)) throw new Error("realismGate: en kendt rød har en ukendt retning");
    if (e.tolerance !== undefined && (!finite(e.tolerance) || Number(e.tolerance) < 0)) throw new Error("realismGate: en kendt røds tolerance er ikke et tal >= 0");
    const id = `${e.cell}::${e.metric}::${e.stat}`;
    if (seen.has(id)) throw new Error("realismGate: kendt-rød-listen har samme celle og metrik to gange");
    seen.add(id);
    return {
      cell: String(e.cell), metric: e.metric as RealismMetricKey, stat: e.stat as RealismStat, issue: e.issue,
      direction: e.direction as KnownRedEntry["direction"], ...(e.tolerance !== undefined ? { tolerance: Number(e.tolerance) } : {}),
    };
  });
  return { version, entries };
}
