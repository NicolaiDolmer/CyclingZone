// #8614 (ejer 23/11 + 26/11, valg B): AI-hold har en fast tilstand.
//
// Ejerens ord 23/11: AI-hold skal have fast træthed og form, udvikling der står stille,
// og ingen skader, så databasen ikke bruger tid på noget der ikke skaber værdi.
// Ejerens valg 26/11 på issuet: valg B (moderat grundtræthed, neutral form).
//
// Kontakten ai_team_frozen_state_8614 er binær: kun den eksakte værdi "on" tænder. En manglende
// række eller en fejlet læsning er slukket, altså præcis dagens regel. Seedet "off"; ejer-only flip.
//
// Med kontakten on:
//   1. Aftenopgørelsen springer AI-hold uden registreret arbejde over: ingen registrering, ingen
//      kvittering, intet tick (trainingDateClose.js). Allerede registreret arbejde afsluttes som før,
//      så en dato der var i gang da kontakten blev tændt, aldrig bliver hængende.
//   2. Sæsonens sidste træningsdato kræver ingen kvittering fra et AI-hold (seasonTransitionReadiness.js).
//   3. Løbsmotoren ser AI-ryttere med den faste træthed og form (raceRunner.js loadEntrants).
//   4. Et styrt giver ikke en AI-rytter en skade (raceRunner.js persistIncidents).
//   5. Ved sæsonskiftet nulstilles AI-rytternes skader og træthed ÉN gang (claim i app_config).
// Menneskehold rører ingen af grenene: hver gren kræver teams.is_ai === true.
//
// Hvorfor de faste tal står her: de er runtime-konstanter (hard rule 17-undtagelsen). Målingen bag
// valget ligger privat (OneDrive, private-handoffs/8614-ai-etape-2026-11-26), ikke i repoet.
import { readFlagStage } from "./featureStage.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { captureException } from "./sentry.js";

export const AI_TEAM_FROZEN_STATE_KEY = "ai_team_frozen_state_8614";
/** Engangs-claim for nulstillingen (en app_config-række; PRIMARY KEY på key giver 23505 ved nummer to). */
export const AI_TEAM_FROZEN_RESET_CLAIM_KEY = "ai_team_frozen_state_8614_reset";

/** Valg B: den faste træthed (0-100-skalaen, samme som rider_condition.fatigue). */
export const AI_FROZEN_FATIGUE = 15;
/** Valg B: neutral form (0-100-skalaen, samme som rider_condition.form). */
export const AI_FROZEN_FORM = 50;

/** En claim der aldrig blev færdig (processen døde midt i), må tages igen efter så lang tid. */
export const AI_FROZEN_RESET_STALE_CLAIM_MS = 30 * 60 * 1000;

const UPSERT_CHUNK = 500;

export async function isAiTeamFrozenStateEnabled(supabase) {
  return (await readFlagStage(supabase, AI_TEAM_FROZEN_STATE_KEY, { fresh: true })) === "on";
}

/**
 * Aftenopgørelsen: skal holdet springes over? Kun et AI-hold, kun uden registreret arbejde
 * på datoen, og kun med kontakten on. REN.
 * @param {{is_ai?: boolean|null}|null|undefined} team
 * @param {{ frozenOn: boolean, registered: boolean }} opts
 */
export function skipsFrozenAiTeamTick(team, { frozenOn, registered }) {
  return frozenOn === true && team?.is_ai === true && registered !== true;
}

/**
 * Løbsmotorens startfelt: en AI-rytter får den faste træthed og form. Muterer og returnerer
 * entrant. Slukket, eller en rytter fra et menneskehold: entrant er uændret (samme objekt,
 * samme nøgler). REN.
 * @param {{team_is_ai?: boolean, form?: any, fatigue?: any}} entrant
 * @param {boolean} frozenOn
 */
export function applyFrozenAiEntrantState(entrant, frozenOn) {
  if (frozenOn !== true || entrant?.team_is_ai !== true) return entrant;
  entrant.form = AI_FROZEN_FORM;
  entrant.fatigue = AI_FROZEN_FATIGUE;
  return entrant;
}

/**
 * Fjerner (in place) de skaderækker der tilhører en rytter på et AI-hold. Kun med kontakten on.
 * Kontakten læses kun, når der er rækker. Et fejlet opslag af hold kaster: finaliseringen er
 * idempotent og prøver igen, og en gættet holdtype ville enten skade et AI-hold eller tage en
 * skade fra et menneskehold.
 * @param {{ supabase: any, rows: Array<{rider_id: string}>, isEnabled?: (s: any) => Promise<boolean> }} args
 * @returns {Promise<number>} antal fjernede rækker
 */
export async function dropFrozenAiInjuryRows({ supabase, rows, isEnabled = isAiTeamFrozenStateEnabled }) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  if (!(await isEnabled(supabase))) return 0;
  const aiRiderIds = await loadAiRiderIds({ supabase, riderIds: [...new Set(rows.map((r) => r.rider_id))] });
  if (!aiRiderIds.size) return 0;
  const kept = rows.filter((r) => !aiRiderIds.has(r.rider_id));
  const dropped = rows.length - kept.length;
  rows.splice(0, rows.length, ...kept);
  return dropped;
}

async function loadAiRiderIds({ supabase, riderIds }) {
  const riders = await fetchAllRowsChunkedIn(riderIds, (chunk) =>
    supabase.from("riders").select("id, team_id").in("id", chunk).order("id"));
  const teamIds = [...new Set(riders.map((r) => r.team_id).filter(Boolean))];
  if (!teamIds.length) return new Set();
  const teams = await fetchAllRowsChunkedIn(teamIds, (chunk) =>
    supabase.from("teams").select("id, is_ai").in("id", chunk).order("id"));
  const aiTeams = new Set(teams.filter((t) => t.is_ai === true).map((t) => t.id));
  return new Set(riders.filter((r) => aiTeams.has(r.team_id)).map((r) => r.id));
}

/** Rækken en AI-rytter får ved nulstillingen: fast træthed, ingen skade. Formen røres ikke. REN. */
export function frozenAiResetRow(riderId) {
  return {
    rider_id: riderId,
    fatigue: AI_FROZEN_FATIGUE,
    injured_until: null,
    injury_cause: null,
    injury_end_game_day: null,
    injury_season_id: null,
    injury_race_days_left: null,
  };
}

/**
 * Tager engangs-claimen. Svarer "claimed" (vi ejer den nu), "done" (nulstillingen er kørt) eller
 * "held" (en anden kørsel er i gang og ikke forældet).
 */
async function takeResetClaim({ supabase, now }) {
  const nowIso = now.toISOString();
  const value = { status: "claimed", claimed_at: nowIso };
  const { error } = await supabase.from("app_config").insert({
    key: AI_TEAM_FROZEN_RESET_CLAIM_KEY,
    value,
    description: "Claim (#8614): AI riders' injuries and fatigue were reset once when ai_team_frozen_state_8614 took effect. Do not delete.",
  });
  if (!error) return "claimed";
  if (error.code !== "23505") throw new Error(`ai frozen reset claim: ${error.message}`);
  const { data, error: readError } = await supabase.from("app_config").select("value")
    .eq("key", AI_TEAM_FROZEN_RESET_CLAIM_KEY).maybeSingle();
  if (readError) throw new Error(`ai frozen reset claim read: ${readError.message}`);
  const existing = data?.value ?? null;
  if (existing?.status === "done") return "done";
  const claimedAt = Date.parse(existing?.claimed_at ?? "");
  if (Number.isFinite(claimedAt) && now.getTime() - claimedAt < AI_FROZEN_RESET_STALE_CLAIM_MS) return "held";
  // Forældet claim: tag den betinget (kun hvis den stadig er den samme forældede claim).
  let retake = supabase.from("app_config").update({ value }).eq("key", AI_TEAM_FROZEN_RESET_CLAIM_KEY)
    .eq("value->>status", "claimed");
  retake = existing?.claimed_at ? retake.eq("value->>claimed_at", existing.claimed_at) : retake;
  const { data: retaken, error: retakeError } = await retake.select("key");
  if (retakeError) throw new Error(`ai frozen reset claim retake: ${retakeError.message}`);
  return (retaken ?? []).length === 1 ? "claimed" : "held";
}

/**
 * Nulstiller AI-rytternes skader og træthed ÉN gang (idempotent via claim). Slukket = intet opslag
 * ud over kontakten og ingen skrivning.
 * @param {{ supabase: any, now?: Date, isEnabled?: (s: any) => Promise<boolean> }} args
 * @returns {Promise<{ ran: boolean, reason?: string, riders?: number }>}
 */
export async function applyAiFrozenStateResetOnce({ supabase, now = new Date(), isEnabled = isAiTeamFrozenStateEnabled }) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!(await isEnabled(supabase))) return { ran: false, reason: "flag_off" };
  const claim = await takeResetClaim({ supabase, now });
  if (claim !== "claimed") return { ran: false, reason: claim === "done" ? "already_done" : "claim_held" };
  try {
    const aiTeams = await fetchAllRows(() => supabase.from("teams").select("id").eq("is_ai", true).order("id"));
    const aiTeamIds = aiTeams.map((t) => t.id);
    const riders = aiTeamIds.length
      ? await fetchAllRowsChunkedIn(aiTeamIds, (chunk) =>
        supabase.from("riders").select("id").in("team_id", chunk).eq("is_retired", false).order("id"))
      : [];
    const riderIds = [...new Set(riders.map((r) => r.id))].sort();
    for (let i = 0; i < riderIds.length; i += UPSERT_CHUNK) {
      const chunk = riderIds.slice(i, i + UPSERT_CHUNK).map(frozenAiResetRow);
      const { error } = await supabase.from("rider_condition").upsert(chunk, { onConflict: "rider_id" });
      if (error) throw new Error(`ai frozen reset rider_condition: ${error.message}`);
    }
    const { error: doneError } = await supabase.from("app_config").update({
      value: { status: "done", claimed_at: now.toISOString(), done_at: new Date().toISOString(), riders: riderIds.length },
    }).eq("key", AI_TEAM_FROZEN_RESET_CLAIM_KEY);
    if (doneError) throw new Error(`ai frozen reset claim done: ${doneError.message}`);
    return { ran: true, riders: riderIds.length };
  } catch (err) {
    // Slip claimen, så næste skifte (eller en genkørsel) kan prøve igen. Nulstillingen er selv
    // idempotent (samme rækker, samme værdier), så en delvis kørsel skader intet.
    const { error: releaseError } = await supabase.from("app_config").delete()
      .eq("key", AI_TEAM_FROZEN_RESET_CLAIM_KEY).eq("value->>status", "claimed");
    if (releaseError) captureException(releaseError, { tags: { phase: "ai_team_frozen_reset_8614", step: "release" } });
    throw err;
  }
}

/**
 * Sæsonskiftets fase. Kaster aldrig. Slukket kontakt giver null (ingen fase-række, samme
 * betingede fase-log som seasonStartHooks.js), så flag off er bit-identisk i fase-loggen.
 * @returns {Promise<null | {phase: string, [k: string]: any}>}
 */
export async function runAiFrozenStateResetPhase({ supabase, now = new Date(), apply = applyAiFrozenStateResetOnce } = {}) {
  try {
    const result = await apply({ supabase, now });
    if (result?.ran === false && result?.reason === "flag_off") return null;
    return { phase: "ai_team_frozen_reset_8614", ...result };
  } catch (err) {
    captureException(err, { tags: { phase: "ai_team_frozen_reset_8614" } });
    return { phase: "ai_team_frozen_reset_8614", error: err.message };
  }
}
