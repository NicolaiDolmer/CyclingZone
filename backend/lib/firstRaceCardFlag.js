// #1140 Pakke A: "Your first race"-kortet paa dashboardet for nye hold, bag
// stadie-flaget `first_race_card` (off | beta | on, featureStage.js).
//
// Moenster kopieret fra trainingMobileTableFlag.js. Migrationen
// (database/2026-10-12-1140-first-race-card-flag.sql) opretter raekken med
// stadie "off": intet aendrer sig foer ejeren flytter flaget fra admin-fladen.
//
// Alt der afgoer OM kortet vises, afgoeres SERVER-SIDE og leveres som bare
// booleans (GET /api/me/first-race-card, routes/firstRaceCard.js). Klienten
// laeser aldrig is_beta_tester og stoler aldrig paa en query-parameter alene:
//
//   ?preview=first-race  → kun admin/beta-tester faar kortet uanset flag og
//                          uanset om holdet har resultater. For alle andre er
//                          parameteren uden virkning (som om den ikke var der).
//
// Gate (uden preview): flaget er sandt for viewer OG holdet har INTET resultat
// i race_results endnu. Saa snart foerste resultat findes, er det det
// eksisterende "Your first race is in the books"-kort (MyLatestResultCard,
// #3310) der overtager, uaendret.
//
// Ingen nye notifikationstyper og ingen mail-aendringer: `mail` er kun et
// laese-svar paa "ville spilleren faa en mail", brugt til at afgoere om kortet
// maa naevne mail.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { readEmailLoopStage } from "./emailLoopFlag.js";
import { isEmailTypeEnabled } from "./emailPrefs.js";
import { readAssistantSelectionConfig, ASSISTANT_MODES } from "./assistantSelectionMode.js";

export const FIRST_RACE_CARD_FLAG_KEY = "first_race_card";
export const FIRST_RACE_CARD_PREVIEW_VALUE = "first-race";

export async function isFirstRaceCardEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, FIRST_RACE_CARD_FLAG_KEY), opts);
}

/**
 * Ren: hvem faar kortet, og er det en forhaandsvisning?
 * @param {object} p
 * @param {boolean|string|null} p.stage        app_config-vaerdien
 * @param {boolean} p.isBetaTester             server-side (users.is_beta_tester eller admin)
 * @param {string|undefined|null} p.previewParam  raa ?preview=-vaerdi
 * @returns {{enabled: boolean, preview: boolean}}
 */
export function resolveFirstRaceCardAccess({ stage, isBetaTester = false, previewParam = null }) {
  const preview = previewParam === FIRST_RACE_CARD_PREVIEW_VALUE && isBetaTester === true;
  const enabled = preview || evaluateFlagStage(stage, { isBetaTester });
  return { enabled, preview };
}

/** Ren gate: preview omgaar resultat-kravet, flaget goer ikke. */
export function shouldShowFirstRaceCard({ enabled, preview, hasResult }) {
  if (!enabled) return false;
  return preview || !hasResult;
}

/**
 * Ren: assistenten vaelger KUN for spilleren hvis holdet har den slaaet til
 * (teams.assistant_autopick_enabled === true) OG udtagelses-tilstanden ikke er
 * "proactive" (der roerer assistenten aldrig et manager-hold). Ellers udelades
 * saetningen, saa kortet aldrig lover noget assistenten ikke goer.
 */
export function resolveAssistantPicks({ team, mode }) {
  return team?.assistant_autopick_enabled === true && mode !== ASSISTANT_MODES.PROACTIVE;
}

/**
 * Ren: faar spilleren en mail om foerste resultat? Samme to regler som
 * sendLoopEmail/sweeps haandhaever: typens stadie er ikke "off", og spilleren
 * har ikke fravalgt typen. race_digest kraever desuden marketing-samtykke
 * (som emailRaceDigestSweep).
 */
export function resolveMailActive({ day1Stage, digestStage, emailPrefs, consentPreferences }) {
  const day1 = day1Stage !== "off" && isEmailTypeEnabled(emailPrefs, "day1");
  const digest = digestStage !== "off"
    && isEmailTypeEnabled(emailPrefs, "race_digest")
    && consentPreferences?.email_marketing === true;
  return day1 || digest;
}

/**
 * Hele svaret til GET /api/me/first-race-card. Fail-safe: enhver fejl i en
 * sekundaer laesning degraderer det enkelte felt, aldrig kortets synlighed
 * (en kastet fejl i en bi-laesning maa ikke skjule kortet; en fejl i selve
 * gaten lukker det).
 *
 * @param {object} supabase
 * @param {object} p
 * @param {string} p.userId
 * @param {object} p.team                req.team
 * @param {() => Promise<boolean>} p.isBetaTester  lazy: kun kaldt naar stadiet != off eller preview er bedt om
 * @param {string|undefined} p.previewParam
 */
export async function buildFirstRaceCardPayload(supabase, { userId, team, isBetaTester, previewParam }) {
  const hidden = { visible: false, preview: false };
  const stage = await readFlagStage(supabase, FIRST_RACE_CARD_FLAG_KEY);
  const previewAsked = previewParam === FIRST_RACE_CARD_PREVIEW_VALUE;
  if (!previewAsked && (stage === null || stage === "off" || stage === false)) return hidden;
  if (!team?.id || !userId) return hidden;

  const beta = await isBetaTester();
  const { enabled, preview } = resolveFirstRaceCardAccess({ stage, isBetaTester: beta, previewParam });
  if (!enabled) return hidden;

  let hasResult = true; // fail-safe: ukendt = kortet overlader til resultat-kortet
  try {
    const { data, error } = await supabase
      .from("race_results").select("id").eq("team_id", team.id).limit(1);
    if (!error && Array.isArray(data)) hasResult = data.length > 0;
  } catch { /* hasResult forbliver true */ }
  if (!shouldShowFirstRaceCard({ enabled, preview, hasResult })) return hidden;

  const [assistant, day1Stage, digestStage, userRow, seasonRow] = await Promise.all([
    readAssistantSelectionConfig(supabase).catch(() => ({ mode: ASSISTANT_MODES.PROACTIVE })),
    readEmailLoopStage(supabase, "day1").catch(() => "off"),
    readEmailLoopStage(supabase, "race_digest").catch(() => "off"),
    supabase.from("users").select("email_prefs, consent_preferences").eq("id", userId).maybeSingle()
      .then((r) => (r.error ? null : r.data), () => null),
    supabase.from("seasons").select("start_date").eq("status", "upcoming")
      .order("start_date", { ascending: true }).limit(1)
      .then((r) => (r.error ? null : (r.data?.[0] ?? null)), () => null),
  ]);

  return {
    visible: true,
    preview,
    assistant_picks: resolveAssistantPicks({ team, mode: assistant?.mode }),
    mail: userRow
      ? resolveMailActive({
        day1Stage,
        digestStage,
        emailPrefs: userRow.email_prefs,
        consentPreferences: userRow.consent_preferences,
      })
      : false,
    next_season_start: seasonRow?.start_date ?? null,
  };
}
