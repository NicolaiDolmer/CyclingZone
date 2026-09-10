// backend/lib/retirementNotice.js
//
// #5073 — SSOT for det GEMTE pensionsvarsel.
//
// Hvorfor filen findes: varslet var indtil nu en ren funktion af rytter-id,
// fødselsdato, sæson og hash-funktionen bag rullet, og blev regnet forfra ved
// hver visning. Da #4990 skiftede `retirementDecision()` fra `seededUnit()` til
// `seededUnitMixed()` (7/9, #4987's avalanche-fix) skiftede varslet MIDT i sæson
// 3 for 58 af 229 ryttere i det seedede vindue. Et varsel er ikke støj — det er
// et løfte spillerne planlægger efter — så det skal gemmes én gang og derefter
// læses, ikke rulles igen.
//
// Kontrakten er tre kolonner på `riders` (se
// database/2026-09-10-5073-retirement-notice-column.sql):
//
//   retirement_notice_season        sæsonen svaret er afgjort for (frysnings-markør)
//   retirement_notice_after_season  sæsonen rytteren stopper EFTER (= markøren når
//                                   svaret er ja, NULL når det er nej)
//   retirement_notice_given_at      hvornår varslet blev givet (kun ved ja)
//
// To felter og ikke ét, fordi et "nej" for sæson N ikke er et "nej" for evigt:
// rytteren rulles igen i sæson N+1 med en højere sandsynlighed. Uden markøren
// kunne "nej" ikke skelnes fra "ikke afgjort endnu", og præcis dét hul er #5073.
//
// Denne fil er DEPENDENCY-LET: den rene del (læsning/klassifikation) importerer
// kun riderProgression.js + riderSeasonAge.js, så den kan testes uden DB. Kun
// `resolveRetirementNotice()` rører Supabase, og den tager klienten som argument.

import {
  PROGRESSION_CONFIG,
  announcedRetirementAfterSeason,
} from "./riderProgression.js";
import { ageForSeason } from "./riderSeasonAge.js";

/**
 * Kolonnerne der SKAL med i et select for at varslet kan læses. Samlet ét sted,
 * så et kaldested ikke kan hente rytteren uden markøren og dermed uforvarende
 * falde tilbage på et nyt rul.
 */
export const RETIREMENT_NOTICE_COLUMNS =
  "retirement_notice_season, retirement_notice_after_season, retirement_notice_given_at";

/**
 * Er rytteren i det SEEDEDE vindue for en given sæson? Kun dér findes der et rul
 * der kan flytte sig — under `windowStartAge` er svaret altid nej og fra
 * `guaranteedAge` altid ja, og de to grænser er rene alders-regler der ikke kan
 * ændre sig uden en bevidst config-ændring.
 *
 * @param {{birthdate?: string|null}} rider
 * @param {number} season   sæsonen varslet gælder (rytteren stopper EFTER den)
 */
export function isInSeededWindow(rider, season, cfg = PROGRESSION_CONFIG) {
  const age = ageForSeason(rider?.birthdate, season);
  if (age == null) return false;
  const { windowStartAge, guaranteedAge } = cfg.retirement;
  return age >= windowStartAge && age < guaranteedAge;
}

/**
 * Læs det FROSNE svar for én sæson af en rytter-række.
 *
 * @returns {boolean|null}  true/false når svaret er frosset for netop den sæson,
 *                          null når rækken ikke bærer en frysning for sæsonen
 *                          (aldrig afgjort, eller afgjort for en ANDEN sæson).
 */
export function frozenNoticeFor(riderRow, season) {
  const marker = riderRow?.retirement_notice_season;
  if (marker == null || season == null) return null;
  if (Number(marker) !== Number(season)) return null;
  return Number(riderRow.retirement_notice_after_season) === Number(season);
}

/**
 * Den patch der fryser ét svar. `given_at` sættes KUN når et varsel rent faktisk
 * står: et "nej" er ikke et varsel og skal ikke bære en dato rytterkortet kan
 * finde på at vise.
 *
 * @param {number} season
 * @param {boolean} announced
 * @param {string} [now]  ISO-tidsstempel (injicerbart, så tests er deterministiske)
 */
export function noticeFreezePatch(season, announced, now = new Date().toISOString()) {
  return {
    retirement_notice_season: Number(season),
    retirement_notice_after_season: announced ? Number(season) : null,
    retirement_notice_given_at: announced ? now : null,
  };
}

/**
 * Varslet for én rytter i én sæson — frosset hvis det findes, ellers beregnet
 * med den GÆLDENDE regel.
 *
 * Ren funktion. Den siger også OM der skal skrives (`shouldFreeze`), så
 * kaldestedet kan afgøre hvornår en skrivning er værd at lave: kun ryttere i det
 * seedede vindue har et rul der kan flytte sig, og kun dér koster en manglende
 * frysning noget.
 *
 * @returns {{announced:boolean, season:number|null, givenAt:string|null,
 *            frozen:boolean, shouldFreeze:boolean}}
 */
export function resolveNoticeFromRow(riderRow, season, cfg = PROGRESSION_CONFIG) {
  if (season == null || riderRow == null) {
    return { announced: false, season: null, givenAt: null, frozen: false, shouldFreeze: false };
  }
  const frozen = frozenNoticeFor(riderRow, season);
  if (frozen !== null) {
    return {
      announced: frozen,
      season: Number(season),
      givenAt: frozen ? (riderRow.retirement_notice_given_at ?? null) : null,
      frozen: true,
      shouldFreeze: false,
    };
  }
  const announced = announcedRetirementAfterSeason(riderRow, season, cfg);
  return {
    announced,
    season: Number(season),
    givenAt: null,
    frozen: false,
    shouldFreeze: isInSeededWindow(riderRow, season, cfg),
  };
}

/**
 * Lazy freeze: læs varslet, og skriv det ned første gang det afgøres, så en
 * senere ændring af hash-funktionen ikke kan flytte det igen (#5073).
 *
 * Skriver KUN for ryttere i det seedede vindue — uden for vinduet er svaret en
 * ren alders-regel uden rul, og en frysning ville bare skjule en fremtidig
 * bevidst ændring af `windowStartAge`/`guaranteedAge`.
 *
 * Skrivningen er non-critical: fejler den, returnerer vi stadig det beregnede
 * svar. Det er præcis samme svar som før frysningen, så en fejlet skrivning kan
 * ikke gøre visningen forkert — kun udskyde frysningen til næste visning.
 *
 * @param {object} supabase   service-role-klient
 * @param {object} riderRow   skal indeholde id, birthdate + RETIREMENT_NOTICE_COLUMNS
 * @param {number|null} season
 */
export async function resolveRetirementNotice(supabase, riderRow, season, cfg = PROGRESSION_CONFIG) {
  const resolved = resolveNoticeFromRow(riderRow, season, cfg);
  if (!resolved.shouldFreeze || !riderRow?.id || !supabase?.from) return resolved;

  const patch = noticeFreezePatch(resolved.season, resolved.announced);
  try {
    const { data, error } = await supabase
      .from("riders")
      .update(patch)
      // Skriv kun hvis ingen anden kørsel nåede det først (sæsonstart-sweep,
      // cutover, ops-scriptet): frysningen er "først til mølle", aldrig en
      // overskrivning af et allerede givet løfte.
      .eq("id", riderRow.id)
      // ... og kun hvis rækken ikke allerede bærer frysningen for DENNE eller en
      // senere sæson. `is.null` alene ville låse rytteren fast på sæson 2's
      // markør for evigt; `lt` lader et nyt sæsonår erstatte et forældet svar,
      // men aldrig et nyere.
      .or(`retirement_notice_season.is.null,retirement_notice_season.lt.${Number(resolved.season)}`)
      // #5073 (review): `.select()` er ikke pynt. Uden den kan 0 ramte rækker
      // ikke skelnes fra 1, og vi ville svare "frozen: true" med et `given_at`
      // der aldrig blev skrevet — også i det tilfælde hvor guarden ovenfor
      // blokerede fordi ops-kørslen (reparationen) vandt kapløbet og lagde et
      // ANDET svar i rækken. Svaret til brugeren skal være det der står i DB.
      .select(RETIREMENT_NOTICE_COLUMNS);
    if (error) {
      console.error("[retirement-notice] lazy freeze failed:", error.message);
      return resolved;
    }
    const winner = data?.[0];
    if (winner) {
      // Vi vandt: rækken vi fik tilbage ER det gemte svar.
      return { ...resolveNoticeFromRow({ ...riderRow, ...winner }, resolved.season, cfg), shouldFreeze: false };
    }
    // 0 rækker = en anden skrivning nåede det først (guarden holdt). Læs den
    // vindende række og svar med DEN, i stedet for at påstå at vores egen
    // beregning blev gemt.
    // schema-columns-ok: retirement_notice_season/-after_season/-given_at
    // tilfoejes af database/2026-09-10-5073-retirement-notice-column.sql i SAMME
    // PR; snapshottet opdateres foerst efter merge.
    const { data: fresh, error: readError } = await supabase
      .from("riders")
      .select(RETIREMENT_NOTICE_COLUMNS)
      .eq("id", riderRow.id)
      .maybeSingle();
    if (readError || !fresh) {
      if (readError) console.error("[retirement-notice] re-read after lost race failed:", readError.message);
      return resolved;
    }
    return { ...resolveNoticeFromRow({ ...riderRow, ...fresh }, resolved.season, cfg), shouldFreeze: false };
  } catch (err) {
    // best-effort: frysningen er en OPTIMERING af et svar vi allerede har regnet
    // ud. Fejler skrivningen (netvaerk, RLS, kolonnen findes ikke endnu foer
    // migrationen er applied), returnerer vi praecis samme svar som foer og
    // proever igen ved naeste visning. En fejl her maa aldrig braekke rytterkortet.
    console.error("[retirement-notice] lazy freeze threw:", err?.message || err);
    return resolved;
  }
}
