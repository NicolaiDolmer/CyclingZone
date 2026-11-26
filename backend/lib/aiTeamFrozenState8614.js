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
//   1. Aftenopgørelsen springer AI-hold over: ingen registrering, ingen kvittering, intet tick
//      (trainingDateClose.js). Undtagelse: arbejde registreret på en dato, der var åben da kontakten
//      blev tændt (datoen ligger på eller før tændingsdagen, app_config.updated_at), afsluttes som før,
//      så den dato aldrig bliver hængende. Registreret AI-arbejde på en senere dato springes over og
//      meldes til Sentry (en sti, der stadig registrerer AI-hold, er en fejl; #8808).
//   2. Etape-afregningen efter etapen springer AI-hold over (trainingSettleRaceSession7982.js, #8808).
//   3. Sæsonens sidste træningsdato kræver ingen kvittering fra et AI-hold (seasonTransitionReadiness.js).
//   4. Løbsmotoren ser AI-ryttere med den faste træthed og form (raceRunner.js loadEntrants), også
//      efter etapestartens træthed fra datoens tidligere etaper (simulateStageByIndex, #8808).
//   5. Et styrt giver ikke en AI-rytter en skade (raceRunner.js persistIncidents).
//   6. Ved sæsonskiftet nulstilles AI-rytternes skader og træthed ÉN gang (claim i app_config).
//      Fejler den, slippes claimen, og den kan genkøres med ops-kommandoen
//      backend/scripts/ops/aiTeamFrozenReset8614.mjs (#8808).
// Menneskehold rører ingen af grenene: hver gren kræver teams.is_ai === true.
// En fejlet læsning af kontakten tæller som slukket, men meldes altid til Sentry (#8808).
//
// Hvorfor de faste tal står her: de er runtime-konstanter (hard rule 17-undtagelsen). Målingen bag
// valget ligger privat (OneDrive, private-handoffs/8614-ai-etape-2026-11-26), ikke i repoet.
import { copenhagenDateString } from "./copenhagenTime.js";
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

/**
 * Læser kontakten frisk (motorens input, aldrig cachet) og hvornår den sidst blev sat.
 * Fejl = slukket (dagens regel), men aldrig tavst: fejlen meldes til Sentry (Fable 26/11 fund 5),
 * for med kontakten on ville en fejlet læsning ellers tavst give AI-holdene dagens regel igen.
 * @param {any} supabase
 * @param {{ capture?: (err: any, ctx?: any) => void }} [opts]
 * @returns {Promise<{ on: boolean, onSince: string|null, failed?: true }>}
 */
export async function readAiTeamFrozenState(supabase, { capture = captureException } = {}) {
  try {
    const { data, error } = await supabase.from("app_config").select("value, updated_at")
      .eq("key", AI_TEAM_FROZEN_STATE_KEY).maybeSingle();
    if (error) throw new Error(`${AI_TEAM_FROZEN_STATE_KEY} read: ${error.message}`);
    const on = data?.value === "on";
    return { on, onSince: on ? (data?.updated_at ?? null) : null };
  } catch (err) {
    try {
      capture(err, { tags: { flag: AI_TEAM_FROZEN_STATE_KEY, step: "read" }, fingerprint: ["ai-team-frozen-state-8614-read-failed"] });
    } catch {
      // catch-ok: en fejlende Sentry må aldrig vælte motoren; læsningen er allerede slukket.
    }
    return { on: false, onSince: null, failed: true };
  }
}

export async function isAiTeamFrozenStateEnabled(supabase) {
  return (await readAiTeamFrozenState(supabase)).on;
}

/**
 * Var datoen åben, da kontakten blev tændt? Ja, når datoen ligger på eller før tændingsdagen
 * (dansk kalenderdato for app_config.updated_at). Et ukendt tidspunkt tæller som ja, så en dato
 * aldrig hænger på en manglende tidsstempel. REN.
 * @param {string} tickDate  YYYY-MM-DD
 * @param {string|null|undefined} onSince
 */
export function wasDateOpenWhenSwitchedOn(tickDate, onSince) {
  const at = onSince ? new Date(onSince) : null;
  if (!at || !Number.isFinite(at.getTime()) || !tickDate) return true;
  return String(tickDate).slice(0, 10) <= copenhagenDateString(at);
}

/**
 * Aftenopgørelsen: skal holdet springes over? Kun et AI-hold med kontakten on. Uden registreret
 * arbejde altid; med registreret arbejde kun, når datoen ikke var åben da kontakten blev tændt
 * (Fable 26/11: undtagelsen gælder kun den dato). REN.
 * @param {{is_ai?: boolean|null}|null|undefined} team
 * @param {{ frozenOn: boolean, registered: boolean, tickDate?: string|null, onSince?: string|null }} opts
 */
export function skipsFrozenAiTeamTick(team, { frozenOn, registered, tickDate = null, onSince = null }) {
  if (frozenOn !== true || team?.is_ai !== true) return false;
  if (registered !== true) return true;
  return !wasDateOpenWhenSwitchedOn(tickDate, onSince);
}

const reportedSkippedWork = new Set();
/**
 * Registreret AI-arbejde på en dato efter tændingen springes over. Det betyder, at en sti stadig
 * registrerer AI-hold, så det meldes til Sentry, én gang pr. hold og dato pr. proces (datoen ligger
 * åben og prøves ved hver aftenkørsel). Kaster aldrig.
 */
export function reportFrozenAiWorkSkipped({ teamId, tickDate, logger = console, capture = captureException }) {
  const key = `${teamId}:${tickDate}`;
  if (reportedSkippedWork.has(key)) return;
  reportedSkippedWork.add(key);
  try {
    logger.error?.("[training-date] #8614: registered AI work after the switch was turned on is not ticked", teamId, tickDate);
    capture(new Error("AI team has registered training work after ai_team_frozen_state_8614 was turned on (#8808)"), {
      tags: { flag: AI_TEAM_FROZEN_STATE_KEY, step: "skip_registered_ai_work" },
      fingerprint: ["ai-team-frozen-state-8614-registered-ai-work"], teamId, tickDate,
    });
  } catch {
    // catch-ok: rapporten er best-effort; springet er allerede afgjort.
  }
}
export function __resetFrozenAiReportsForTests() { reportedSkippedWork.clear(); }

/**
 * Etape-afregningen: planen uden AI-hold. REN.
 * @param {Array<{teamId: string}>} plan
 * @param {Array<{id: string, is_ai?: boolean|null}>} teams
 */
export function hasFrozenAiPlanItems(plan, teams) {
  const ai = new Set((teams ?? []).filter((t) => t?.is_ai === true).map((t) => t.id));
  return (plan ?? []).some((item) => ai.has(item.teamId));
}
export function withoutFrozenAiTeams(plan, teams) {
  const ai = new Set((teams ?? []).filter((t) => t?.is_ai === true).map((t) => t.id));
  return (plan ?? []).filter((item) => !ai.has(item.teamId));
}

/**
 * Etapestarten (simulateStageByIndex): datoens tidligere etaper og stemplet træning lægges oven på
 * startfeltet (applySameDateEnteringFatigueV2). Med kontakten on sættes AI-rytterne bagefter
 * tilbage til den faste tilstand, så motoren også på dagens anden etape ser den (Codex P1 26/11).
 * Kontakten læses kun med AI-ryttere i feltet. Muterer entrants.
 * @returns {Promise<number>} antal AI-ryttere sat til den faste tilstand
 */
export async function refreezeAiEntrantsAfterStageStart({ supabase, entrants, isEnabled = isAiTeamFrozenStateEnabled }) {
  const ai = (entrants ?? []).filter((e) => e?.team_is_ai === true);
  if (!ai.length || !(await isEnabled(supabase))) return 0;
  for (const entrant of ai) applyFrozenAiEntrantState(entrant, true);
  return ai.length;
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
export async function applyAiFrozenStateResetOnce({ supabase, now, isEnabled = isAiTeamFrozenStateEnabled }) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!(await isEnabled(supabase))) return { ran: false, reason: "flag_off" };
  // Codex P1 26/11: intet vægur-default; kalderen giver altid sit ur (sæsonskiftets tidspunkt, ops-kommandoen).
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Explicit valid now required");
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
      // Codex P1 26/11: kun det injicerede ur, aldrig væguret (AGENTS.md regel 16).
      value: { status: "done", claimed_at: now.toISOString(), done_at: now.toISOString(), riders: riderIds.length },
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
 * Status til ops-kommandoen (Fable 26/11 fund 6): kontakten og engangs-claimen. Kun læsninger.
 * @returns {Promise<{ switchOn: boolean, switchReadFailed: boolean, claim: null | object }>}
 */
export async function loadAiFrozenStateResetStatus({ supabase }) {
  const state = await readAiTeamFrozenState(supabase);
  const { data, error } = await supabase.from("app_config").select("value")
    .eq("key", AI_TEAM_FROZEN_RESET_CLAIM_KEY).maybeSingle();
  if (error) throw new Error(`ai frozen reset claim read: ${error.message}`);
  return { switchOn: state.on, switchReadFailed: state.failed === true, claim: data?.value ?? null };
}

/**
 * Sæsonskiftets fase. Kaster aldrig. Slukket kontakt giver null (ingen fase-række, samme
 * betingede fase-log som seasonStartHooks.js), så flag off er bit-identisk i fase-loggen.
 * @returns {Promise<null | {phase: string, [k: string]: any}>}
 */
export async function runAiFrozenStateResetPhase({ supabase, now, apply = applyAiFrozenStateResetOnce } = {}) {
  try {
    const result = await apply({ supabase, now });
    if (result?.ran === false && result?.reason === "flag_off") return null;
    return { phase: "ai_team_frozen_reset_8614", ...result };
  } catch (err) {
    captureException(err, { tags: { phase: "ai_team_frozen_reset_8614" } });
    return { phase: "ai_team_frozen_reset_8614", error: err.message };
  }
}
