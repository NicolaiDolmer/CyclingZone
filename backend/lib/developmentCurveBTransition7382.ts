// #7382 (ejer-beslutning 30/10): blød overgang når kurve B tændes.
//
// Kurve B giver en evne over sit bløde loft kun en lille restfart (#7316). En evne
// der allerede står dér, når flaget tændes, ville derfor gå fra den gamle models
// fart til restfarten fra den ene dag til den anden. Overgangen tager toppen af det:
//   - HVEM: kun evner der stod på eller over kurve B's bløde loft, da kurve B blev
//     tændt (ét samlet øjebliksbillede, se nedenfor). Alle andre evner (også hos
//     samme rytter, og evner der først krydser loftet senere) får kurve B fra dag 1.
//   - HVORDAN: dagens fremdrift glider lineært fra den gamle models fremdrift til
//     kurve B's over CURVE_B_TRANSITION_DAYS kalenderdage, fra og med tændingsdatoen
//     (dansk dato). Dag 0 = max(kurve B, den gamle model), sidste dag i vinduet er
//     næsten kurve B. Derefter kun kurve B.
//   - Fremdriften er max(kurve B, blandingen): aldrig langsommere end kurve B (en
//     blød landing, ikke en bremse), aldrig mere end den største af de to modeller,
//     og aldrig negativ (rating-reglen 17/9).
//
// TÆNDINGEN (ensureCurveBIgnition): første gang kurve B faktisk er aktiv (flaget on
// OG gyldige params), og nøglen CURVE_B_IGNITED_AT_CONFIG_KEY mangler i app_config,
// gør motoren to ting i denne rækkefølge:
//   1. ØJEBLIKSBILLEDET: én række pr. rytter på et managerhold (managerhold-reglen,
//      #6500: user_id sat, ikke AI/bank/testkonto; rytteren ikke pensioneret) i
//      CURVE_B_TRANSITION_MEMBERS_TABLE med de evner der står på eller over det
//      bløde loft lige nu (rider_derived_abilities). Også tomme rækker, så en
//      samtidig kørsel der måler efter et tick, aldrig kan tilføje en evne.
//      insert ... on conflict do nothing i batches: idempotent.
//   2. STEMPLET: dagens danske dato ud fra `now`, aldrig en efterslæbende
//      tick-dato. insert ... on conflict do nothing, og overskrives aldrig.
// Billedet tages før stemplet: fejler billedet, står der intet stempel, og næste
// kørsel prøver igen (strict kaster; ellers kurve B fuldt for den kørsel). Står
// stemplet der, tages billedet aldrig igen. Et flag der er on uden gyldige params
// eller et kort flip on og off uden en kørsel imellem lægger intet. Skal en senere
// tænding starte en ny overgang, slettes nøglen bevidst først (nye rækker nøgles på
// den nye dato). Flag off = intet opslag, intet billede, intet stempel.
//
// RESTEN AF VINDUET læses kun rækken (loadCurveBTransitionRoster). En rytter uden
// række får kurve B hele vejen: fx en rytter der kommer til et managerhold efter
// tændingen (fra et AI-hold, eller ny i akademiet). Rækken følger rytteren, så et
// skifte mellem to managerhold beholder den. Kørsler for datoer før tændingsdatoen
// (efterslæb) får vægt 0. Uden låsen ville en evne der krydser loftet inde i
// vinduet, springe op til den gamle models fart.
//
// Ingen balance-tal her: de 14 dage er ejerens beslutning i issuet. Kurvens tal er
// private (hard rule 17) og kommer ind som de validerede params.
//
// De rene funktioner er deterministiske: ingen Date.now, ingen Math.random. Kun
// readCurveBIgnitedOn, ensureCurveBIgnition, takeCurveBTransitionSnapshot og
// loadCurveBTransitionRoster rører databasen.

import { copenhagenDateString } from "./copenhagenTime.js";
import { curveBSoftCeiling } from "./developmentCurveB.ts";
import type { DevelopmentCurveBParams } from "./developmentCurveB.ts";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { buildCapsForRider } from "./riderProgression.js";
import { ageForSeason } from "./riderSeasonAge.js";
import { fetchAllRows, fetchAllRowsChunkedIn, SUPABASE_IN_CHUNK_SIZE } from "./supabasePagination.js";

export const CURVE_B_IGNITED_AT_CONFIG_KEY = "development_curve_b_ignited_at";
export const CURVE_B_TRANSITION_MEMBERS_TABLE = "development_curve_b_transition_members";
export const CURVE_B_TRANSITION_DAYS = 14;
const CURVE_B_IGNITED_AT_DESCRIPTION =
  "#7382: Copenhagen date curve B was ignited (snapshot taken). Start of the soft transition. Written once by the training engine; delete the key to start a new transition.";

export interface CurveBTransition {
  // Kurve B's andel af dagens fremdrift for evner i overgangen (0 <= w < 1).
  weight: number;
  // Tændingsdatoen (dansk dato): rækkerne er nøglet på den.
  ignitedOn: string;
}

/** Overgangen for én rytter: vægten og de evner der var med i øjebliksbilledet. */
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
 * tændingsdatoen: den dag har vægt 0, dag days-1 den største vægt under 1. null =
 * ingen overgang (kurve B fuldt): intet stempel, ugyldig dato, eller vinduet er
 * slut. En dato før tændingen (en efterslæbende kørsel) giver vægt 0.
 */
export function curveBTransitionForDate({
  ignitedOn, tickDate, days = CURVE_B_TRANSITION_DAYS,
}: { ignitedOn: string | null | undefined; tickDate: string | null | undefined; days?: number }): CurveBTransition | null {
  if (!(Number.isFinite(days) && days > 0)) return null;
  const elapsed = calendarDaysBetween(ignitedOn, tickDate);
  if (elapsed == null || elapsed >= days) return null;
  return Object.freeze({ weight: Math.max(0, elapsed) / days, ignitedOn: ignitedOn as string });
}

/** Evnerne der står på eller over kurve B's bløde loft (sorteret). */
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
 * bruges). Evner der ikke var med i øjebliksbilledet, uden overgang eller med
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

type DbClient = { from: (table: string) => any };
type TeamRow = { id: string; user_id?: string | null; is_ai?: boolean | null; is_bank?: boolean | null; is_test_account?: boolean | null };

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
async function readIgnitionRow(supabase: DbClient): Promise<{ exists: boolean; ignitedOn: string | null }> {
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
  supabase: DbClient,
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

const MEMBER_WRITE_BATCH = 500;
const RIDER_COLUMNS = "id, team_id, potentiale, birthdate, primary_type, secondary_type, is_retired";

/**
 * Øjebliksbilledet: én række pr. rytter på et managerhold med evnerne på eller
 * over det bløde loft lige nu, nøglet på `ignitedOn`. Idempotent (on conflict do
 * nothing). Kaster ved enhver fejl; intet stempel må skrives uden et helt billede.
 * Returnerer antal rytter-rækker der blev sendt.
 */
export async function takeCurveBTransitionSnapshot(
  supabase: DbClient,
  { ignitedOn, curveB, seasonNumber, isManagerTeam }: {
    ignitedOn: string; curveB: DevelopmentCurveBParams; seasonNumber: number; isManagerTeam: (team: TeamRow) => boolean;
  },
): Promise<number> {
  if (!Number.isFinite(seasonNumber)) throw new Error("curve-b snapshot: seasonNumber required");
  if (typeof isManagerTeam !== "function") throw new Error("curve-b snapshot: isManagerTeam required");
  const teams: TeamRow[] = await fetchAllRows(() => supabase.from("teams")
    .select("id, user_id, is_ai, is_bank, is_test_account").order("id"));
  const teamIds = teams.filter((t) => isManagerTeam(t)).map((t) => t.id);
  const riders = await fetchAllRowsChunkedIn(teamIds, (ids: string[]) => supabase.from("riders")
    .select(RIDER_COLUMNS).in("team_id", ids).eq("is_retired", false).order("id"));
  const live = riders.filter((r: { is_retired?: boolean | null; team_id?: string | null }) => r.is_retired !== true && r.team_id != null);
  const abilityRows = await fetchAllRowsChunkedIn(live.map((r: { id: string }) => r.id), (ids: string[]) =>
    supabase.from("rider_derived_abilities").select("*").in("rider_id", ids).order("rider_id"),
    { chunkSize: SUPABASE_IN_CHUNK_SIZE });
  const abilityByRider = new Map<string, Record<string, unknown>>(abilityRows.map((row: Record<string, unknown>) => [row.rider_id as string, row]));
  const rows: Array<{ rider_id: string; ignited_on: string; abilities: string[] }> = [];
  for (const rider of live) {
    const abRow = abilityByRider.get(rider.id);
    if (!abRow) continue; // ingen evner = ingen række = kurve B hele vejen
    // Samme evner og loft som motoren regner med før tick'et.
    const abilities: Record<string, number> = {};
    for (const k of VISIBLE_ABILITIES) if (abRow[k] != null) abilities[k] = Number(abRow[k]);
    const caps = buildCapsForRider(abilities, { potentiale: rider.potentiale, age: ageForSeason(rider.birthdate, seasonNumber) },
      rider.primary_type, rider.secondary_type);
    rows.push({ rider_id: rider.id, ignited_on: ignitedOn, abilities: curveBTransitionAbilities({ abilities, caps, potentiale: rider.potentiale, curveB }) });
  }
  for (let i = 0; i < rows.length; i += MEMBER_WRITE_BATCH) {
    const { error } = await supabase.from(CURVE_B_TRANSITION_MEMBERS_TABLE)
      .upsert(rows.slice(i, i + MEMBER_WRITE_BATCH), { onConflict: "rider_id,ignited_on", ignoreDuplicates: true });
    if (error) throw new Error(`curve-b snapshot write: ${error.message ?? error}`);
  }
  return rows.length;
}

/**
 * Kaldes KUN når kurve B faktisk er aktiv for kørslen. Læser først; står nøglen
 * der, returneres den (intet billede, intet stempel, heller ikke efter vinduet).
 * Mangler den: øjebliksbilledet for dagens danske dato (ud fra `now`), derefter
 * stemplet (on conflict do nothing, så samtidige hold-kørsler er harmløse), og
 * læses igen. strict = dato-stien: en fejl kaster; ellers null (kurve B fuldt for
 * kørslen), og næste kørsel prøver igen.
 */
export async function ensureCurveBIgnition(
  supabase: DbClient,
  { now, curveB, seasonNumber, isManagerTeam, strict = false }: {
    now: Date; curveB: DevelopmentCurveBParams; seasonNumber: number; isManagerTeam: (team: TeamRow) => boolean; strict?: boolean;
  },
): Promise<string | null> {
  try {
    const existing = await readIgnitionRow(supabase);
    if (existing.exists) return existing.ignitedOn;
    const today = copenhagenDateString(now);
    if (typeof today !== "string" || !DATE_RE.test(today) || !isRealDate(today)) {
      throw new Error(`curve-b ignition: invalid date ${today}`);
    }
    await takeCurveBTransitionSnapshot(supabase, { ignitedOn: today, curveB, seasonNumber, isManagerTeam });
    const { error } = await supabase.from("app_config").upsert(
      { key: CURVE_B_IGNITED_AT_CONFIG_KEY, value: today, description: CURVE_B_IGNITED_AT_DESCRIPTION },
      { onConflict: "key", ignoreDuplicates: true },
    );
    if (error) throw new Error(`curve-b ignition stamp: ${error.message ?? error}`);
    return (await readIgnitionRow(supabase)).ignitedOn;
  } catch (err) {
    if (strict) throw err;
    console.warn(`[curve-b] taendingen (${CURVE_B_IGNITED_AT_CONFIG_KEY}) mislykkedes - ingen overgang i denne koersel: ${errText(err)}`);
    return null;
  }
}

export interface CurveBTransitionRoster {
  /** Rytterens overgang til kørslen, eller null (kurve B fuldt). */
  forRider(riderId: string): CurveBRiderTransition | null;
}

/**
 * Medlemskabet for kørslens ryttere i vinduet: kun læsning af øjebliksbilledet
 * for tændingsdatoen. Ingen række eller en tom række = kurve B fuldt. En fejlet
 * læsning: strict kaster, ellers kurve B fuldt for hele holdet.
 */
export async function loadCurveBTransitionRoster(
  supabase: DbClient,
  { transition, riderIds, strict = false }: { transition: CurveBTransition; riderIds: readonly string[]; strict?: boolean },
): Promise<CurveBTransitionRoster> {
  const members = new Map<string, readonly string[]>();
  let usable = true;
  try {
    for (let i = 0; i < riderIds.length; i += SUPABASE_IN_CHUNK_SIZE) {
      const { data, error } = await supabase.from(CURVE_B_TRANSITION_MEMBERS_TABLE)
        .select("rider_id, abilities").eq("ignited_on", transition.ignitedOn).in("rider_id", riderIds.slice(i, i + SUPABASE_IN_CHUNK_SIZE));
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
  return {
    forRider(riderId) {
      if (!usable) return null;
      const locked = members.get(riderId);
      if (!locked || locked.length === 0) return null;
      return Object.freeze({ weight: transition.weight, abilities: locked });
    },
  };
}
