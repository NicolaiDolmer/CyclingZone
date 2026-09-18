// #5259 (ejer 15/9, del af rolle-direktivet #4268) · Laget OVENPAA den beta-
// mekanik der allerede virker.
//
// Mekanikken selv er UAENDRET: `users.is_beta_tester` (2026-06-13),
// `isViewerBetaTester(req)` i routes/api.js og evaluateFlagStage's
// off|beta|on i featureStage.js. Det der manglede var vejen DERTIL:
//   1. spilleren kan bede om adgang (beta_requests),
//   2. ejeren kan svare, og svaret saetter is_beta_tester,
//   3. spilleren kan traede ud igen uden at spoerge nogen.
//
// GATEN ER UAENDRET OG SERVER-SIDE. Intet her aendrer hvordan et flag i
// stadie `beta` evalueres — is_beta_tester laeses stadig fra databasen i
// isViewerBetaTester, aldrig fra klienten. Denne fil skriver kun FELTET.

import { notifyUser } from "./notificationService.js";
import { DEFAULT_LANGUAGE, translate as translateServer } from "./i18nServer.js";

export const BETA_ACCESS_DECIDED_TYPE = "beta_access_decided";

export const BETA_REQUEST_STATUS = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  WITHDRAWN: "withdrawn",
});

/**
 * Spillerens tilstand som EEN vaerdi, udledt af de to kilder (bool + raekke).
 * Ren funktion — baade API'et og fladen laeser den samme udledning, saa de to
 * ikke kan komme til at vise hver sin sandhed.
 *
 *  "member"   er beta-tester nu (uanset hvad raekken siger)
 *  "pending"  har ansoegt, ejeren har ikke svaret
 *  "rejected" ejeren sagde nej (spilleren maa gerne spoerge igen)
 *  "none"     har aldrig spurgt, eller er traadt ud / trak ansoegningen
 *
 * is_beta_tester VINDER over raekken med vilje: ejeren kan saette kontakten
 * direkte i Brugere-fanen uden at der nogensinde har vaeret en ansoegning, og
 * saa er spilleren medlem — uanset at der ikke ligger en 'approved'-raekke.
 */
export function betaAccessState({ isBetaTester = false, requestStatus = null } = {}) {
  if (isBetaTester === true) return "member";
  if (requestStatus === BETA_REQUEST_STATUS.PENDING) return "pending";
  if (requestStatus === BETA_REQUEST_STATUS.REJECTED) return "rejected";
  return "none";
}

/** Maa spilleren sende (endnu) en ansoegning fra fladen? */
export function canRequestBetaAccess(state) {
  return state === "none" || state === "rejected";
}

/** Maa spilleren traekke sig (annullere ansoegning ELLER forlade programmet)? */
export function canWithdrawBetaAccess(state) {
  return state === "member" || state === "pending";
}

/**
 * Indbakke-beskeden naar ejeren har svaret. Ren payload-builder (samme
 * moenster som buildDiscordWelcomeNotification) — afsendelsen ligger i
 * decideBetaRequest nedenfor.
 *
 * Fallback-teksten er EN, praecis som #4734 foreskriver: frontend rendrer
 * metadata.titleCode/messageCode i modtagerens sprog, og title/message er
 * fallback + dedup-noegle.
 */
export function buildBetaDecisionNotification(approved) {
  const suffix = approved ? "approved" : "rejected";
  const titleCode = `notif.betaAccess.${suffix}.title`;
  const messageCode = `notif.betaAccess.${suffix}.message`;
  return {
    type: BETA_ACCESS_DECIDED_TYPE,
    title: translateServer(titleCode, {}, { language: DEFAULT_LANGUAGE }),
    message: translateServer(messageCode, {}, { language: DEFAULT_LANGUAGE }),
    relatedId: null,
    metadata: { titleCode, titleParams: {}, messageCode, messageParams: {} },
  };
}

// ── DB-stier ────────────────────────────────────────────────────────────────
// Alle tager en service-role-klient. Tabellen har INGEN skrive-grants til
// authenticated (se database/2026-09-18-5259-beta-requests.sql), saa det er
// her — og kun her — at "spilleren maa kun saette pending paa SIG SELV"
// haandhaeves.

/** Laes spillerens egen tilstand: bool fra users + status fra beta_requests. */
export async function readBetaAccess(supabase, userId) {
  const [{ data: user }, { data: request }] = await Promise.all([
    supabase.from("users").select("is_beta_tester").eq("id", userId).maybeSingle(),
    supabase.from("beta_requests").select("status, created_at").eq("user_id", userId).maybeSingle(),
  ]);
  const isBetaTester = user?.is_beta_tester === true;
  const requestStatus = request?.status ?? null;
  return {
    is_beta_tester: isBetaTester,
    request_status: requestStatus,
    requested_at: request?.created_at ?? null,
    state: betaAccessState({ isBetaTester, requestStatus }),
  };
}

/**
 * Spilleren ansoeger. UPSERT paa user_id: en ny ansoegning efter et afslag
 * genbruger raekken, saa admin-listen ikke kan spammes med pending-raekker.
 * decided_at/decided_by nulstilles — beslutningen er ikke truffet endnu.
 */
export async function requestBetaAccess(supabase, userId, { now = new Date() } = {}) {
  const current = await readBetaAccess(supabase, userId);
  if (!canRequestBetaAccess(current.state)) {
    return { ok: false, reason: current.state, access: current };
  }
  const { error } = await supabase
    .from("beta_requests")
    .upsert(
      {
        user_id: userId,
        status: BETA_REQUEST_STATUS.PENDING,
        created_at: now.toISOString(),
        decided_at: null,
        decided_by: null,
      },
      { onConflict: "user_id" },
    );
  if (error) throw error;
  return { ok: true, access: await readBetaAccess(supabase, userId) };
}

/**
 * Spilleren traekker sig selv ud: enten en ubesvaret ansoegning eller hele
 * medlemskabet. Ejeren skal IKKE godkende en udmeldelse — det er spillerens
 * eget valg, og den vej er den eneste "opt-out" der findes.
 */
export async function withdrawBetaAccess(supabase, userId, { now = new Date() } = {}) {
  const current = await readBetaAccess(supabase, userId);
  if (!canWithdrawBetaAccess(current.state)) {
    return { ok: false, reason: current.state, access: current };
  }
  if (current.is_beta_tester) {
    const { error } = await supabase.from("users").update({ is_beta_tester: false }).eq("id", userId);
    if (error) throw error;
  }
  const { error: reqError } = await supabase
    .from("beta_requests")
    .upsert(
      {
        user_id: userId,
        status: BETA_REQUEST_STATUS.WITHDRAWN,
        decided_at: now.toISOString(),
        decided_by: null,
      },
      { onConflict: "user_id" },
    );
  if (reqError) throw reqError;
  return { ok: true, access: await readBetaAccess(supabase, userId) };
}

/**
 * Ejeren svarer paa en ansoegning. Saetter is_beta_tester ved ja, markerer
 * raekken, og laegger EEN besked i spillerens indbakke.
 *
 * Notifikationen er BEVIDST ikke fatal: fejler den, er beslutningen stadig
 * truffet (kontakten er sat), og at rulle den tilbage ville vaere vaerre end
 * en manglende besked. Fejlen bobler som `notified: false`.
 */
export async function decideBetaRequest(supabase, { userId, approved, adminUserId, now = new Date() }) {
  const { error: reqError } = await supabase
    .from("beta_requests")
    .upsert(
      {
        user_id: userId,
        status: approved ? BETA_REQUEST_STATUS.APPROVED : BETA_REQUEST_STATUS.REJECTED,
        decided_at: now.toISOString(),
        decided_by: adminUserId ?? null,
      },
      { onConflict: "user_id" },
    );
  if (reqError) throw reqError;

  const { error: userError } = await supabase
    .from("users").update({ is_beta_tester: approved === true }).eq("id", userId);
  if (userError) throw userError;

  let notified = false;
  try {
    const payload = buildBetaDecisionNotification(approved === true);
    const result = await notifyUser({ supabase, userId, ...payload, now });
    notified = result?.delivered === true;
  } catch {
    notified = false;
  }
  return { ok: true, notified, access: await readBetaAccess(supabase, userId) };
}

/**
 * Ejeren saetter kontakten direkte (Brugere-fanen), uden om ansoegningsvejen.
 * Raekken i beta_requests foelger med, saa fladen og spillerens egen side
 * viser det samme — men der sendes INGEN besked: ejeren har ikke svaret paa
 * noget spilleren spurgte om.
 */
export async function setBetaTester(supabase, { userId, isBetaTester, adminUserId, now = new Date() }) {
  const { data, error } = await supabase
    .from("users")
    .update({ is_beta_tester: isBetaTester === true })
    .eq("id", userId)
    .select("username")
    .single();
  if (error) throw error;

  const { error: reqError } = await supabase
    .from("beta_requests")
    .upsert(
      {
        user_id: userId,
        status: isBetaTester ? BETA_REQUEST_STATUS.APPROVED : BETA_REQUEST_STATUS.WITHDRAWN,
        decided_at: now.toISOString(),
        decided_by: adminUserId ?? null,
      },
      { onConflict: "user_id" },
    );
  if (reqError) throw reqError;

  return { ok: true, username: data?.username ?? null };
}
