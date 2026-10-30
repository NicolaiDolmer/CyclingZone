// #7382 (ejer-beslutning 30/10): blød overgang når kurve B tændes.
//
// Kurve B giver en evne over sit bløde loft kun en lille restfart (#7316). En evne
// der allerede står dér, når flaget tændes, ville derfor gå fra den gamle models
// fart til restfarten fra den ene dag til den anden. Overgangen tager toppen af det:
//   - HVEM: kun evner der står på eller over kurve B's bløde loft. Alle andre evner
//     (også hos samme rytter) får kurve B fra dag 1.
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
// "Over loftet" måles på tick-dagens evne, ikke på et øjebliksbillede fra
// startdagen (der gemmes intet pr. rytter). En evne kan kun stige i vinduet, så
// alle evner der stod over loftet ved starten, er med. En evne der krydser loftet
// inde i vinduet, får også blandingen resten af vinduet, men aldrig mere end den
// gamle models fremdrift, som den ville have fået uden kurve B.
//
// Ingen balance-tal her: de 14 dage er ejerens beslutning i issuet. Kurvens tal er
// private (hard rule 17) og kommer ind som de validerede params.
//
// Rene funktioner, deterministiske: ingen Date.now, ingen Math.random. Kun
// readCurveBIgnitedOn og ensureCurveBIgnitedOn rører databasen.

import { copenhagenDateString } from "./copenhagenTime.js";

export const CURVE_B_IGNITED_AT_CONFIG_KEY = "development_curve_b_ignited_at";
export const CURVE_B_TRANSITION_DAYS = 14;
const CURVE_B_IGNITED_AT_DESCRIPTION =
  "#7382: first Copenhagen date curve B actually ran. Start of the soft transition. Written once by the training engine; delete the key to start a new transition.";

export interface CurveBTransition {
  // Kurve B's andel af dagens fremdrift for evner over det bløde loft (0 <= w < 1).
  weight: number;
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
  return Object.freeze({ weight: Math.max(0, elapsed) / days });
}

/**
 * Dagens fremdrift for én evne i overgangen. `oldDelta` er den gamle models
 * fremdrift for samme evne og dag (en funktion, så den kun regnes når den skal
 * bruges). Under det bløde loft, uden overgang eller med ugyldig vægt: kurve B
 * uændret. Over det: lineær blanding, aldrig negativ.
 */
export function blendCurveBTransition({
  curveBDelta, oldDelta, current, softCeiling, transition,
}: {
  curveBDelta: number;
  oldDelta: number | (() => number);
  current: number;
  softCeiling: number;
  transition: CurveBTransition | null | undefined;
}): number {
  const w = transition?.weight;
  if (!(typeof w === "number" && w >= 0 && w < 1)) return curveBDelta;
  if (!(Number.isFinite(current) && Number.isFinite(softCeiling) && current >= softCeiling)) return curveBDelta;
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

/**
 * Læser tændingsdatoen. strict = løbsdags-datoens atomare sti (som flagene dér):
 * en fejlet læsning kaster i stedet for at blive tolket som "ingen overgang".
 */
export async function readCurveBIgnitedOn(
  supabase: ConfigClient,
  { strict = false }: { strict?: boolean } = {},
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("app_config").select("value").eq("key", CURVE_B_IGNITED_AT_CONFIG_KEY).maybeSingle();
    if (error) throw new Error(`curve-b ignition read: ${error.message ?? error}`);
    return ignitedOnFromConfigValue(data?.value ?? null);
  } catch (err) {
    if (strict) throw err;
    console.warn(`[curve-b] ${CURVE_B_IGNITED_AT_CONFIG_KEY} kunne ikke laeses - ingen overgang: ${(err as Error)?.message ?? err}`);
    return null;
  }
}

/**
 * Kaldes KUN når kurve B faktisk er aktiv for tick'et. Stempler tick-datoen som
 * startdato, hvis der ikke allerede står én (insert ... on conflict do nothing:
 * et eksisterende stempel overskrives aldrig, og samtidige hold-kørsler er
 * harmløse), og læser derefter den gældende startdato. strict som ovenfor.
 */
export async function ensureCurveBIgnitedOn(
  supabase: ConfigClient,
  { tickDate, strict = false }: { tickDate: string; strict?: boolean },
): Promise<string | null> {
  try {
    if (typeof tickDate !== "string" || !DATE_RE.test(tickDate) || !isRealDate(tickDate)) {
      throw new Error(`curve-b ignition stamp: invalid tick date ${tickDate}`);
    }
    const { error } = await supabase.from("app_config").upsert(
      { key: CURVE_B_IGNITED_AT_CONFIG_KEY, value: tickDate, description: CURVE_B_IGNITED_AT_DESCRIPTION },
      { onConflict: "key", ignoreDuplicates: true },
    );
    if (error) throw new Error(`curve-b ignition stamp: ${error.message ?? error}`);
  } catch (err) {
    if (strict) throw err;
    console.warn(`[curve-b] ${CURVE_B_IGNITED_AT_CONFIG_KEY} kunne ikke stemples: ${(err as Error)?.message ?? err}`);
  }
  return readCurveBIgnitedOn(supabase, { strict });
}
