// #7390: læser for den lukkede tabel `private_config` (private motor- og
// træningsindstillinger).
//
// HVORFOR: app_config kan læses af ALLE indloggede (policy
// app_config_select_authenticated), så balance-tal dér ville være offentlige for
// spillerne. private_config har RLS slået til uden policies og grants kun til
// service_role (database/2026-10-30-7390-private-config.sql). Hver ændring logges
// med gammel og ny værdi i private_config_history (trigger).
//
// REGLER
//  - Kun nøgler i registret nedenfor kan læses (eller en kalder giver sit eget
//    `schema`). Hver nøgle har en parser: ugyldig værdi = null + en tydelig,
//    værdi-fri advarsel; med `strict` kastes der i stedet.
//  - Kort cache (60 s) pr. klient, så en motor-tick ikke slår op for hvert hold.
//    Databasefejl caches aldrig. strict kaster ved databasefejl.
//  - Værdierne logges ALDRIG (hard rule 17). Ops-scriptet viser kun hash og
//    hvilke felter der ændres (scripts/ops/setPrivateConfig.mjs).
//
// Skriv en værdi: backend/scripts/ops/setPrivateConfig.mjs, kun på ejerens
// ordrette go (docs/AI_OPS_REFERENCE.md, "Private indstillinger").

import { createHash } from "node:crypto";
import { validateDevelopmentCurveBParams, type DevelopmentCurveBParams } from "./developmentCurveB.ts";
import { validateRaceDayRoleYieldParams } from "./raceDayRoleYieldParams.js";
import { parseWeeklyEngineDriftThresholds, type WeeklyEngineDriftThresholds } from "./weeklyEngineDriftThresholds.ts";

export const PRIVATE_CONFIG_TABLE = "private_config";
export const PRIVATE_CONFIG_CACHE_MS = 60_000;

/** En parser kaster (værdi-fri besked) eller returnerer null ved ugyldig værdi. */
export type PrivateConfigParser<T> = (raw: unknown) => T | null;

export interface PrivateConfigKeySpec<T> {
  description: string;
  /** true = værdien må aldrig vises i klartekst i logs eller output. */
  private: boolean;
  parse: PrivateConfigParser<T>;
}

export const PRIVATE_CONFIG_KEYS = Object.freeze({
  development_curve_b_params: Object.freeze({
    description: "Kurve B's kalibrering (#3564). Læses af developmentCurveBFlag.ts.",
    private: true,
    parse: (raw: unknown): DevelopmentCurveBParams => {
      const params = validateDevelopmentCurveBParams(raw);
      if (!params) throw new Error("opfylder ikke validateDevelopmentCurveBParams");
      return params;
    },
  }) as PrivateConfigKeySpec<DevelopmentCurveBParams>,
  weekly_engine_drift_thresholds: Object.freeze({
    description: "Ugentlig motor-drift-rapports grænser (#2557/#7279), weeklyEngineDrift-sektionen.",
    private: true,
    parse: parseWeeklyEngineDriftThresholds,
  }) as PrivateConfigKeySpec<WeeklyEngineDriftThresholds>,
  race_day_role_yield_params: Object.freeze({
    description: "Løbsdagens rolle-vægtede tillæg (#5950). Læses af raceDayRoleYield5950.js.",
    private: true,
    parse: (raw: unknown): { stageBonus: number; leadShare: number } => {
      const params = validateRaceDayRoleYieldParams(raw);
      if (!params) throw new Error("opfylder ikke validateRaceDayRoleYieldParams");
      return params;
    },
  }) as PrivateConfigKeySpec<{ stageBonus: number; leadShare: number }>,
});

export type PrivateConfigKey = keyof typeof PRIVATE_CONFIG_KEYS;

export function isPrivateConfigKey(key: unknown): key is PrivateConfigKey {
  return typeof key === "string" && Object.hasOwn(PRIVATE_CONFIG_KEYS, key);
}

export function privateConfigSpec(key: string): PrivateConfigKeySpec<unknown> | null {
  return isPrivateConfigKey(key) ? PRIVATE_CONFIG_KEYS[key] as PrivateConfigKeySpec<unknown> : null;
}

/**
 * Kører parseren. { ok: true, value } eller { ok: false, reason } med en
 * værdi-fri begrundelse. Kaster aldrig.
 */
export function validatePrivateConfigValue<T>(parse: PrivateConfigParser<T>, raw: unknown):
  { ok: true; value: T } | { ok: false; reason: string } {
  try {
    const value = parse(raw);
    if (value === null || value === undefined) return { ok: false, reason: "ugyldig værdi" };
    return { ok: true, value };
  } catch (error) {
    return { ok: false, reason: (error as Error)?.message || "ugyldig værdi" };
  }
}

// ── Læsning ──────────────────────────────────────────────────────────────────

export type PrivateConfigStatus = "ok" | "missing" | "invalid" | "error";
export interface PrivateConfigEntry<T> { status: PrivateConfigStatus; value: T | null }

interface SupabaseLike { from(table: string): any }
type Log = Pick<Console, "warn">;
interface CacheEntry { at: number; status: Exclude<PrivateConfigStatus, "error">; value: unknown; schema: unknown }

// Pr. klient (WeakMap), så testklienter og prod-klienten aldrig deler cache.
let cacheByClient = new WeakMap<object, Map<string, CacheEntry>>();

/** Tømmer cachen (tests, og ops-scriptet efter en skrivning). */
export function clearPrivateConfigCache(): void {
  cacheByClient = new WeakMap();
}

export interface ReadPrivateConfigOptions<T> {
  /** Egen parser i stedet for registrets (fx en test). */
  schema?: PrivateConfigParser<T>;
  /** Kast ved databasefejl og ved ugyldig værdi (i stedet for null + advarsel). */
  strict?: boolean;
  log?: Log;
  cacheMs?: number;
  now?: () => number;
}

/**
 * Læser én nøgle med status: ok (gyldig), missing (ingen række), invalid
 * (rækken findes, men parseren afviser den) eller error (databasefejl, kun uden
 * strict). Bruges af kaldere der skal skelne "ikke sat" fra "sat forkert".
 */
export async function readPrivateConfigEntry<T = unknown>(
  supabase: SupabaseLike,
  key: string,
  { schema, strict = false, log = console, cacheMs = PRIVATE_CONFIG_CACHE_MS, now = Date.now }: ReadPrivateConfigOptions<T> = {},
): Promise<PrivateConfigEntry<T>> {
  const parse = (schema ?? privateConfigSpec(key)?.parse) as PrivateConfigParser<T> | undefined;
  if (!parse) throw new Error(`private_config: ukendt noegle ${JSON.stringify(key)} (tilfoej den til PRIVATE_CONFIG_KEYS)`);

  const cache = (supabase && typeof supabase === "object") ? cacheFor(supabase) : null;
  const hit = cache?.get(key);
  if (hit && hit.schema === parse && now() - hit.at < cacheMs) {
    if (hit.status === "invalid" && strict) throw invalidError(key);
    return { status: hit.status, value: hit.value as T | null };
  }

  let row: { value?: unknown } | null;
  try {
    const { data, error } = await supabase.from(PRIVATE_CONFIG_TABLE).select("value").eq("key", key).maybeSingle();
    if (error) throw new Error(error.message ?? String(error));
    row = data ?? null;
  } catch (error) {
    const message = `private_config: laesning af ${key} fejlede: ${(error as Error)?.message ?? error}`;
    if (strict) throw new Error(message);
    log?.warn?.(`[private-config] ${message}`);
    return { status: "error", value: null };
  }

  let entry: PrivateConfigEntry<T>;
  if (!row || row.value === undefined || row.value === null) {
    entry = { status: "missing", value: null };
  } else {
    const result = validatePrivateConfigValue(parse, row.value);
    if (result.ok) {
      entry = { status: "ok", value: result.value };
    } else {
      entry = { status: "invalid", value: null };
      log?.warn?.(`[private-config] ${key} har en ugyldig vaerdi og ignoreres (${result.reason}). Ret den med scripts/ops/setPrivateConfig.mjs`);
    }
  }
  cache?.set(key, { at: now(), status: entry.status as CacheEntry["status"], value: entry.value, schema: parse });
  if (entry.status === "invalid" && strict) throw invalidError(key);
  return entry;
}

/** Den gyldige værdi, eller null (mangler, ugyldig eller databasefejl uden strict). */
export async function readPrivateConfig<T = unknown>(
  supabase: SupabaseLike,
  key: string,
  options: ReadPrivateConfigOptions<T> = {},
): Promise<T | null> {
  return (await readPrivateConfigEntry<T>(supabase, key, options)).value;
}

function cacheFor(client: object): Map<string, CacheEntry> {
  let map = cacheByClient.get(client);
  if (!map) { map = new Map(); cacheByClient.set(client, map); }
  return map;
}

function invalidError(key: string): Error {
  return new Error(`private_config: ${key} har en ugyldig vaerdi (strict)`);
}

// ── Værdi-fri beskrivelse af en ændring (ops-scriptet) ──────────────────────

/** JSON med sorterede nøgler, så samme indhold altid giver samme hash (jsonb sorterer selv). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]));
  }
  return value;
}

/** Kort sha256 af den kanoniske JSON. null/undefined = "(ingen)". */
export function privateConfigHash(value: unknown): string {
  if (value === null || value === undefined) return "(ingen)";
  return createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 12);
}

/**
 * Stierne der er tilføjet, fjernet eller ændret mellem to værdier, fx
 * ["load.floor", "potentialCeiling[2]", "+aboveCeilingFloor", "-gammeltFelt"].
 * Viser aldrig selve værdierne.
 */
export function changedPaths(before: unknown, after: unknown, prefix = ""): string[] {
  const isObj = (v: unknown) => !!v && typeof v === "object";
  if (!isObj(before) || !isObj(after) || Array.isArray(before) !== Array.isArray(after)) {
    return canonicalJson(before) === canonicalJson(after) ? [] : [prefix || "(hele vaerdien)"];
  }
  const out: string[] = [];
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const arr = Array.isArray(before);
  const keys = arr
    ? Array.from({ length: Math.max((before as unknown[]).length, (after as unknown[]).length) }, (_, i) => String(i))
    : [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  for (const k of keys) {
    const path = arr ? `${prefix}[${k}]` : (prefix ? `${prefix}.${k}` : k);
    if (!Object.hasOwn(b, k)) out.push(`+${path}`);
    else if (!Object.hasOwn(a, k)) out.push(`-${path}`);
    else out.push(...changedPaths(b[k], a[k], path));
  }
  return out;
}
