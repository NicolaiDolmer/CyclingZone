// backend/lib/academyIntakePull.js
// #3550 — ungdomspakken (løn-design-session 19/8, ejer-beslutning). Erstatter det
// løbende søndags-drip (sundayIntakeTick.js) med en PULL-mekanik: ét kuld pr. hold
// pr. uge, hentet med en knap i stedet for auto-genereret. Henter holdet ikke inden
// ugens udløb (søndag 23:59 Europe/Copenhagen), genereres kuldet ALDRIG og forfalder
// stille — ingen rider-rows, ingen auktioner. Signup-seedingen af det allerførste
// kuld for nye hold (runAcademyIntakeForTeam) er UBERØRT af denne fil.
//
// Genbruger den delte kerne (seedAcademyCohortForTeam) + samme claim-tabel som det
// gamle drip (academy_intake_ticks, PK team_id+tick_date) — men "tick_date" er her
// UGENS søndag (kan claimes en hvilken som helst dag i ugen), ikke selve kørselsdagen.
// Flag-gated: academy_intake_pull_enabled (academyIntakePullFlag.js), seedet OFF —
// cron.js's søndags-drip fortsætter uændret indtil flaget flippes ved cutover.
import {
  fetchActiveSeason,
  fetchExistingFoldedRiderNames,
  hashStringToSeed,
  referenceYearForSeason,
  seedAcademyCohortForTeam,
} from "./academyIntake.js";
import { isAcademyIntakePullEnabled } from "./academyIntakePullFlag.js";
import { makeRng } from "./fictionalRiderGenerator.js";
import { deriveForRiderIds } from "./backfillCores.js";
import { SUNDAY_DRIP_COUNT } from "./sundayIntakeTick.js";

const PULL_SEED_BASE = 3550;

// ── Symbolsk start (ejer-beslutning 19/8, punkt 2) ────────────────────────────
// Ved hentning trækkes kandidatens market_value uniformt i dette interval — IKKE
// den normale karriere-NPV-afledte værdi. market_value = GENERATED(base_value +
// prize_earnings_bonus); en frisk kandidat har ALDRIG præmier, så det er nok at
// skrive base_value. Signing-fee-formlen er UÆNDRET (25 % af markedsværdien,
// academyFlag.ACADEMY.SIGNING_FEE_RATE) — den bliver symbolsk AF SIG SELV fordi
// værdien er lav. Rækkefølgen der betyder noget: denne værdi skrives FØR nogen
// signing kan ske (kandidaten er stadig kun 'offered' på dette tidspunkt).
export const INTAKE_PULL_VALUE_MIN = 1_000;
export const INTAKE_PULL_VALUE_MAX = 5_000;

function randomProvisionalValue(rng) {
  const span = INTAKE_PULL_VALUE_MAX - INTAKE_PULL_VALUE_MIN + 1;
  return INTAKE_PULL_VALUE_MIN + Math.floor(rng() * span);
}

async function applyProvisionalValues(supabase, riderIds, rng) {
  for (const id of riderIds) {
    const baseValue = randomProvisionalValue(rng);
    const { error } = await supabase.from("riders").update({ base_value: baseValue }).eq("id", id);
    if (error) throw new Error(`academy-intake-pull provisional value ${id}: ${error.message}`);
  }
}

// ── Uge-bucket (Europe/Copenhagen, kalenderdag-baseret) ───────────────────────
// "Ugen" er Mandag-Søndag; nøglen er datoen for den søndag der AFSLUTTER ugen
// "nu" falder i. Er det allerede søndag (en hvilken som helst time før 23:59:59
// lokal tid), returneres DAGENS dato — bucket'en flipper først når det bliver
// mandag 00:00 Europe/Copenhagen, hvilket ER "søndag 23:59"-deadline'en (ejer-
// beslutning punkt 1): ingen separat tidspunkt-udregning nødvendig, kun kalender-
// dagen. Konstrueret via UTC-kalenderaritmetik (Date.UTC på Y-M-D-dele hentet via
// Intl for Europe/Copenhagen) for at undgå DST-fælder i direkte Date-aritmetik.
export function copenhagenDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function currentIntakeWeekSunday(now = new Date()) {
  const { year, month, day } = copenhagenDateParts(now);
  const cal = new Date(Date.UTC(year, month - 1, day));
  const dow = cal.getUTCDay(); // 0=søn..6=lør
  const daysUntilSunday = (7 - dow) % 7; // 0 hvis allerede søndag
  cal.setUTCDate(cal.getUTCDate() + daysUntilSunday);
  return cal.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Har holdet allerede hentet denne uges kuld? Læse-only — bruges af GET
 * /api/academy/me til at afgøre om intake-sektionen viser knappen eller
 * (evt. tomme) kandidat-kort.
 */
export async function hasPulledThisWeek(supabase, { teamId, now = new Date() } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!teamId) throw new Error("teamId required");
  const weekSunday = currentIntakeWeekSunday(now);
  const { data, error } = await supabase
    .from("academy_intake_ticks")
    .select("team_id")
    .eq("team_id", teamId)
    .eq("tick_date", weekSunday)
    .maybeSingle();
  if (error) throw new Error(`academy-intake-pull status: ${error.message}`);
  return Boolean(data);
}

/**
 * Hent (generér) ét akademi-kuld for ét hold — den manager-udløste erstatning
 * for søndags-drippet. Idempotent pr. (hold, uge) via academy_intake_ticks-claim
 * (samme tabel/PK som det gamle drip, men tick_date = UGENS søndag).
 *
 * @returns {Promise<{ok:true, alreadyPulled:boolean, weekSunday:string, candidates:string[]}
 *   | {ok:false, reason:string}>}
 */
export async function pullWeeklyAcademyIntake(supabase, {
  teamId,
  now = new Date(),
  seed = PULL_SEED_BASE,
  deriveRiders = deriveForRiderIds,
  isEnabled = isAcademyIntakePullEnabled,
  seedCohortFn = seedAcademyCohortForTeam,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!teamId) throw new Error("teamId required");

  if (!(await isEnabled(supabase))) return { ok: false, reason: "flag_off" };

  const season = await fetchActiveSeason(supabase);
  if (!season) return { ok: false, reason: "no_active_season" };

  const weekSunday = currentIntakeWeekSunday(now);

  // Claim-FØRST (samme TOCTOU-forsvar som sundayIntakeTick): PK-kollision på
  // (team_id, tick_date) betyder "allerede hentet denne uge" — idempotent mod
  // dobbeltklik OG mod at prøve igen efter at have signet/afvist alle kandidater.
  const { data: claim, error: claimErr } = await supabase
    .from("academy_intake_ticks")
    .upsert({ team_id: teamId, tick_date: weekSunday }, { onConflict: "team_id,tick_date", ignoreDuplicates: true })
    .select("team_id");
  if (claimErr) throw new Error(`academy-intake-pull claim: ${claimErr.message}`);
  if (!claim?.length) return { ok: true, alreadyPulled: true, weekSunday, candidates: [] };

  const { data: teamRow, error: teamErr } = await supabase
    .from("teams").select("id, season_1_identity_basis").eq("id", teamId).maybeSingle();
  if (teamErr) throw new Error(`academy-intake-pull team lookup: ${teamErr.message}`);

  const referenceYear = referenceYearForSeason(season);
  const existingNames = await fetchExistingFoldedRiderNames(supabase);
  const rng = makeRng(((seed >>> 0) ^ hashStringToSeed(`${teamId}:${weekSunday}`)) >>> 0);

  const newIds = await seedCohortFn(supabase, {
    teamId,
    season,
    referenceYear,
    existingNames,
    rng,
    identityBasis: teamRow?.season_1_identity_basis || null,
    countOverride: SUNDAY_DRIP_COUNT,
  });

  if (newIds.length > 0) {
    await deriveRiders(supabase, newIds, { dryRun: false });
    // #3550 punkt 2: provisorisk værdi skrives EFTER derive (som ellers ville
    // regne den "rigtige" værdi ud fra evnerne) og FØR noget kan signes.
    await applyProvisionalValues(supabase, newIds, rng);
  }

  return { ok: true, alreadyPulled: false, weekSunday, candidates: newIds };
}
