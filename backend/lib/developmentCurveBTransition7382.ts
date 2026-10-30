// #7382 (ejer-beslutning 30/10): blød overgang når kurve B tændes.
//
// Kurve B giver en evne over sit bløde loft kun en lille restfart (#7316). En evne
// der allerede står dér, når flaget tændes, ville derfor gå fra den gamle models
// fart til restfarten fra den ene dag til den anden. Overgangen tager toppen af det:
//   - HVEM: kun evner der står på eller over kurve B's bløde loft. Alle andre evner
//     (også hos samme rytter) får kurve B fra dag 1.
//   - HVORDAN: dagens fremdrift glider lineært fra den gamle models fremdrift til
//     kurve B's over CURVE_B_TRANSITION_DAYS kalenderdage fra tændingsdatoen
//     (dansk tid). Derefter kun kurve B.
//   - Aldrig negativ fremdrift (rating-reglen 17/9), og aldrig mere end den største
//     af de to modeller: blandingen ligger altid mellem dem.
//
// Tændingstidspunktet står i app_config under CURVE_B_IGNITED_AT_CONFIG_KEY. Det
// stemples af en trigger (database/2026-10-30-7382-curve-b-transition.sql), første
// gang `development_curve_b` sættes til "on", og overskrives aldrig af en ny
// tænding. Så kan overgangen regnes efter for enhver dato. Mangler stemplet, er der
// ingen overgang (kurve B fuldt), som før #7382.
//
// "Over loftet" måles på tick-dagens evne, ikke på et øjebliksbillede fra
// tændingsdagen (der gemmes intet pr. rytter). En evne kan kun stige i vinduet, så
// alle evner der stod over loftet ved tændingen, er med. En evne der krydser loftet
// i vinduet, kommer også med resten af vinduet, men får aldrig mere end den gamle
// models fremdrift, som den ville have fået uden kurve B.
//
// Ingen balance-tal her: de 14 dage er ejerens beslutning i issuet. Kurvens tal er
// private (hard rule 17) og kommer ind som de validerede params.
//
// Rene funktioner, deterministiske: ingen Date.now, ingen Math.random. Kun
// readCurveBIgnitedOn læser fra databasen.

import { copenhagenDateString } from "./copenhagenTime.js";

export const CURVE_B_IGNITED_AT_CONFIG_KEY = "development_curve_b_ignited_at";
export const CURVE_B_TRANSITION_DAYS = 14;

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
 * Overgangen for én tick-dato. null = ingen overgang (kurve B fuldt): intet
 * tændingsstempel, ugyldig dato, eller vinduet er slut. En dato før tændingen
 * (fx en efterslæbende kørsel) giver vægt 0, altså den gamle models fart.
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
  const v = (1 - w) * o + w * b;
  return v > 0 ? v : 0;
}

type ConfigClient = { from: (table: string) => any };

/** Tændingsstemplet (timestamptz i jsonb) som dansk kalenderdato, ellers null. */
export function ignitedOnFromConfigValue(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? copenhagenDateString(new Date(t)) : null;
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
