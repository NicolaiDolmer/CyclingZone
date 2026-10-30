// #7382 (ejer-beslutning 30/10): blød overgang når kurve B tændes.
//
// Kurve B giver en evne over sit bløde loft kun en lille restfart (#7316). En evne
// der allerede står dér, når flaget tændes, ville derfor gå fra den gamle models
// fart til restfarten fra den ene dag til den anden. Overgangen tager toppen af det:
//   - HVEM: kun evner der stod på eller over kurve B's bløde loft PÅ TÆNDINGSDAGEN.
//     Alle andre evner (også hos samme rytter, og evner der først krydser loftet
//     senere) får kurve B fra dag 1.
//   - HVORDAN: dagens fremdrift glider lineært fra den gamle models fremdrift til
//     kurve B's over CURVE_B_TRANSITION_DAYS kalenderdage, fra og med den første
//     dag kurve B faktisk kører (dansk dato). Dag 0 = den gamle models fulde
//     fremdrift, sidste dag i vinduet er næsten kurve B. Derefter kun kurve B.
//   - Fremdriften er max(kurve B, blandingen): aldrig langsommere end kurve B (en
//     blød landing, ikke en bremse), aldrig mere end den største af de to modeller,
//     og aldrig negativ (rating-reglen 17/9).
//
// Startdatoen står i app_config under CURVE_B_IGNITED_AT_CONFIG_KEY. Motoren
// stempler den selv (ensureCurveBIgnitedOn) med tick-datoen, første gang kurve B
// faktisk er aktiv (flaget on OG gyldige params), og overskriver den aldrig. Et
// flag der er on uden gyldige params, eller et kort flip on og off uden en tick
// imellem, lægger derfor intet stempel. Skal en senere tænding starte en ny
// overgang, slettes nøglen bevidst først. Flag off = intet opslag, intet stempel.
//
// MEDLEMSKABET ER LÅST PÅ TÆNDINGSDAGEN (CURVE_B_TRANSITION_MEMBERS_TABLE): på
// tændingsdagen skriver motoren én række pr. rytter på et hold der udvikler sig
// (managerhold-reglen, #6500), med de evner der stod på eller over loftet, målt på
// evnerne FØR dagens tick. Alle holdets ryttere måles, også dem der ikke får et
// tick den dag (skadet, hviledag i et etapeløb, ukendt slot). insert ... on
// conflict do nothing: datoens første kørsel vinder, så datoens senere løbsdage og
// en genkørsel aldrig flytter det. Resten af vinduet læses rækken. En rytter uden
// række får kurve B hele vejen: fx en rytter der først kommer til et managerhold
// inde i vinduet (transfer fra et hold der ikke udvikler sig, eller ny i
// akademiet efter tændingsdagen). Rækken følger rytteren, så et skifte mellem to managerhold beholder
// den. Uden låsen ville en evne der krydser loftet inde i vinduet, springe op til
// den gamle models fart (lige over loftet fik langt mere end lige under).
//
// Ingen balance-tal her: de 14 dage er ejerens beslutning i issuet. Kurvens tal er
// private (hard rule 17) og kommer ind som de validerede params.
//
// De rene funktioner er deterministiske: ingen Date.now, ingen Math.random. Kun
// readCurveBIgnitedOn, ensureCurveBIgnitedOn og loadCurveBTransitionRoster
// (læs + persist) rører databasen.

import { copenhagenDateString } from "./copenhagenTime.js";
import { curveBSoftCeiling } from "./developmentCurveB.ts";
import type { DevelopmentCurveBParams } from "./developmentCurveB.ts";

export const CURVE_B_IGNITED_AT_CONFIG_KEY = "development_curve_b_ignited_at";
export const CURVE_B_TRANSITION_MEMBERS_TABLE = "development_curve_b_transition_members";
export const CURVE_B_TRANSITION_DAYS = 14;
const CURVE_B_IGNITED_AT_DESCRIPTION =
  "#7382: first Copenhagen date curve B actually ran. Start of the soft transition. Written once by the training engine; delete the key to start a new transition.";

export interface CurveBTransition {
  // Kurve B's andel af dagens fremdrift for evner i overgangen (0 <= w < 1).
  weight: number;
  // Startdatoen (dansk dato) og om tick-datoen ER den: kun dér låses medlemskabet.
  ignitedOn: string;
  ignitionDay: boolean;
}

/** Overgangen for én rytter: vægten og de evner der var med på tændingsdagen. */
export interface CurveBRiderTransition {
  weight: number;
  abilities: readonly string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Hele kalenderdage fra `from` til `to` (begge YYYY-MM-DD). null ved ugyldig dato. */
export function calendarDaysBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  if (typeof from !== "string" || typeof to !== "string" || !DATE_RE.test(from) || !DATE_RE.test(to)) return null;
  // UTC-middag: datoerne er allerede danske kalenderdage, så ingen tidszone/DST.
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

/**
 * Overgangen for én tick-dato. Vinduet er `days` kalenderdage fra og med
 * startdatoen: startdagen har vægt 0 (den gamle models fart), dag days-1 den
 * største vægt under 1. null = ingen overgang (kurve B fuldt): intet stempel,
 * ugyldig dato, eller vinduet er slut. En dato før starten (fx en efterslæbende
 * kørsel) giver vægt 0.
 */
export function curveBTransitionForDate({
  ignitedOn, tickDate, days = CURVE_B_TRANSITION_DAYS,
}: { ignitedOn: string | null | undefined; tickDate: string | null | undefined; days?: number }): CurveBTransition | null {
  if (!(Number.isFinite(days) && days > 0)) return null;
  const elapsed = calendarDaysBetween(ignitedOn, tickDate);
  if (elapsed == null || elapsed >= days) return null;
  return Object.freeze({ weight: Math.max(0, elapsed) / days, ignitedOn: ignitedOn as string, ignitionDay: elapsed === 0 });
}

/**
 * Evnerne der står på eller over kurve B's bløde loft (sorteret). Det er
 * medlemskabet, målt på tændingsdagen før dagens tick.
 */
export function curveBTransitionAbilities({
  abilities, caps, potentiale, curveB,
}: {
  abilities: Record<string, unknown> | null | undefined;
  caps: Record<string, unknown> | null | undefined;
  potentiale: number | null | undefined;
  curveB: DevelopmentCurveBParams;
}): string[] {
  const out: string[] = [];
  for (const [ability, raw] of Object.entries(abilities ?? {})) {
    const current = Number(raw);
    const soft = curveBSoftCeiling(Number(caps?.[ability]), potentiale, curveB);
    if (Number.isFinite(current) && Number.isFinite(soft) && current >= soft) out.push(ability);
  }
  return out.sort();
}

/**
 * Dagens fremdrift for én evne i overgangen. `oldDelta` er den gamle models
 * fremdrift for samme evne og dag (en funktion, så den kun regnes når den skal
 * bruges). Evner der ikke var med på tændingsdagen, uden overgang eller med
 * ugyldig vægt: kurve B uændret. Ellers lineær blanding, aldrig negativ.
 */
export function blendCurveBTransition({
  ability, curveBDelta, oldDelta, transition,
}: {
  ability: string;
  curveBDelta: number;
  oldDelta: number | (() => number);
  transition: CurveBRiderTransition | null | undefined;
}): number {
  const w = transition?.weight;
  if (!(typeof w === "number" && w >= 0 && w < 1)) return curveBDelta;
  if (!Array.isArray(transition?.abilities) || !transition.abilities.includes(ability)) return curveBDelta;
  const b = Number.isFinite(curveBDelta) && curveBDelta > 0 ? curveBDelta : 0;
  const rawOld = typeof oldDelta === "function" ? oldDelta() : oldDelta;
  const o = Number.isFinite(rawOld) && rawOld > 0 ? rawOld : 0;
  // Overgangen kan kun hjælpe: er den gamle model langsommere, får evnen kurve B
  // uændret i stedet for at blive bremset.
  const v = Math.max(b, (1 - w) * o + w * b);
  return v > 0 ? v : 0;
}

type ConfigClient = { from: (table: string) => any };

/**
 * Stemplet som dansk kalenderdato, ellers null. Motoren skriver en dansk dato
 * (YYYY-MM-DD); et tidsstempel (fx sat i hånden) omregnes til dansk dato.
 */
export function ignitedOnFromConfigValue(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  if (DATE_RE.test(value)) return isRealDate(value) ? value : null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? copenhagenDateString(new Date(t)) : null;
}

function isRealDate(date: string): boolean {
  const t = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === date;
}

const errText = (err: unknown) => (err as Error)?.message ?? String(err);

// Kaster ved en fejlet læsning. exists = nøglen står der (også med en ugyldig værdi).
async function readIgnitionRow(supabase: ConfigClient): Promise<{ exists: boolean; ignitedOn: string | null }> {
  const { data, error } = await supabase
    .from("app_config").select("value").eq("key", CURVE_B_IGNITED_AT_CONFIG_KEY).maybeSingle();
  if (error) throw new Error(`curve-b ignition read: ${error.message ?? error}`);
  return { exists: data != null, ignitedOn: ignitedOnFromConfigValue(data?.value ?? null) };
}

/**
 * Læser tændingsdatoen. strict = løbsdags-datoens atomare sti (som flagene dér):
 * en fejlet læsning kaster i stedet for at blive tolket som "ingen overgang".
 */
export async function readCurveBIgnitedOn(
  supabase: ConfigClient,
  { strict = false }: { strict?: boolean } = {},
): Promise<string | null> {
  try {
    return (await readIgnitionRow(supabase)).ignitedOn;
  } catch (err) {
    if (strict) throw err;
    console.warn(`[curve-b] ${CURVE_B_IGNITED_AT_CONFIG_KEY} kunne ikke laeses - ingen overgang: ${errText(err)}`);
    return null;
  }
}

/**
 * Kaldes KUN når kurve B faktisk er aktiv for tick'et. Læser først; kun når
 * nøglen mangler, stemples tick-datoen (insert ... on conflict do nothing, så
 * samtidige hold-kørsler er harmløse) og læses igen. Står nøglen der, skrives
 * intet, heller ikke efter vinduet. strict som ovenfor; uden strict giver en
 * fejl null (kurve B fuldt).
 */
export async function ensureCurveBIgnitedOn(
  supabase: ConfigClient,
  { tickDate, strict = false }: { tickDate: string; strict?: boolean },
): Promise<string | null> {
  try {
    const existing = await readIgnitionRow(supabase);
    if (existing.exists) return existing.ignitedOn;
    if (typeof tickDate !== "string" || !DATE_RE.test(tickDate) || !isRealDate(tickDate)) {
      throw new Error(`curve-b ignition stamp: invalid tick date ${tickDate}`);
    }
    const { error } = await supabase.from("app_config").upsert(
      { key: CURVE_B_IGNITED_AT_CONFIG_KEY, value: tickDate, description: CURVE_B_IGNITED_AT_DESCRIPTION },
      { onConflict: "key", ignoreDuplicates: true },
    );
    if (error) throw new Error(`curve-b ignition stamp: ${error.message ?? error}`);
    return (await readIgnitionRow(supabase)).ignitedOn;
  } catch (err) {
    if (strict) throw err;
    console.warn(`[curve-b] ${CURVE_B_IGNITED_AT_CONFIG_KEY} kunne ikke stemples/laeses - ingen overgang: ${errText(err)}`);
    return null;
  }
}

export interface CurveBTransitionRoster {
  /** Rytterens overgang til tick'et, eller null (kurve B fuldt). */
  forRider(args: { riderId: string; abilities: Record<string, unknown>; caps: Record<string, unknown> | null | undefined; potentiale: number | null | undefined }): CurveBRiderTransition | null;
  /** Skriver tændingsdagens nye rækker (on conflict do nothing). Kald før dagens evner skrives. */
  persist(opts?: { strict?: boolean }): Promise<void>;
}

const MEMBER_BATCH = 500;

/**
 * Medlemskabet for holdets ryttere i vinduet. Læser de låste rækker for
 * startdatoen. På tændingsdagen måles ryttere uden række på deres evner før
 * dagens tick, og rækken sættes i kø til persist(). En fejlet læsning: strict
 * kaster, ellers kurve B fuldt for hele holdet (intet måles, intet skrives).
 */
export async function loadCurveBTransitionRoster(
  supabase: ConfigClient,
  { transition, curveB, riderIds, strict = false }: {
    transition: CurveBTransition; curveB: DevelopmentCurveBParams; riderIds: readonly string[]; strict?: boolean;
  },
): Promise<CurveBTransitionRoster> {
  const members = new Map<string, readonly string[]>();
  let usable = true;
  try {
    for (let i = 0; i < riderIds.length; i += MEMBER_BATCH) {
      const { data, error } = await supabase.from(CURVE_B_TRANSITION_MEMBERS_TABLE)
        .select("rider_id, abilities").eq("ignited_on", transition.ignitedOn).in("rider_id", riderIds.slice(i, i + MEMBER_BATCH));
      if (error) throw new Error(`curve-b transition members read: ${error.message ?? error}`);
      for (const row of data ?? []) {
        members.set(row.rider_id, Object.freeze((Array.isArray(row.abilities) ? row.abilities : []).filter((a: unknown) => typeof a === "string")));
      }
    }
  } catch (err) {
    if (strict) throw err;
    console.warn(`[curve-b] overgangens medlemmer kunne ikke laeses - kurve B fuldt: ${errText(err)}`);
    usable = false;
  }
  const pending: Array<{ rider_id: string; ignited_on: string; abilities: string[] }> = [];
  return {
    forRider({ riderId, abilities, caps, potentiale }) {
      if (!usable) return null;
      let locked = members.get(riderId);
      if (!locked && transition.ignitionDay) {
        const measured = curveBTransitionAbilities({ abilities, caps, potentiale, curveB });
        locked = Object.freeze(measured);
        members.set(riderId, locked);
        pending.push({ rider_id: riderId, ignited_on: transition.ignitedOn, abilities: measured });
      }
      if (!locked || locked.length === 0) return null;
      return Object.freeze({ weight: transition.weight, abilities: locked });
    },
    async persist({ strict: strictWrite = strict } = {}) {
      if (pending.length === 0) return;
      try {
        for (let i = 0; i < pending.length; i += MEMBER_BATCH) {
          const { error } = await supabase.from(CURVE_B_TRANSITION_MEMBERS_TABLE)
            .upsert(pending.slice(i, i + MEMBER_BATCH), { onConflict: "rider_id,ignited_on", ignoreDuplicates: true });
          if (error) throw new Error(`curve-b transition members write: ${error.message ?? error}`);
        }
        pending.length = 0;
      } catch (err) {
        if (strictWrite) throw err;
        console.warn(`[curve-b] overgangens medlemmer kunne ikke gemmes - resten af vinduet kurve B fuldt for dem: ${errText(err)}`);
      }
    },
  };
}
