/**
 * #4557 S-M2c · Årsmøde-auto-accept-cronen (spec §4.1 punkt 3).
 * ==========================================================================
 * `proposed` mandater forbi deres `auto_accept_deadline` underskrives
 * automatisk: Keep på alle mål, ingen anmodning — samme "Keep alt"-kontrakt
 * som `finalizeMandateGoals` allerede håndhæver (ingen justering =
 * `adjustments_used: 0`). Genbruger `resolveThresholds` + T-3/T-1-
 * notifikations-kadencen fra den GAMLE `board_profiles`-auto-accept-cron
 * (`boardAutoAccept.js`, via det delte `boardNegotiationThresholds.js`),
 * ejer-svar 2/9 spørgsmål 3: A — "5 dage / 10 for aktive spillere, som i
 * dag". Selve underskrivningen kører gennem `boardMandateMeeting.js::
 * signMandate` (SAMME funktion som manager-flowet), så der kun findes ÉT
 * sted mandat-underskrift sker.
 *
 * Idempotent: cronen kører hvert 30. minut (samme kadence som den gamle
 * auto-accept-cron, boot-run sikker) — et mandat der allerede er `active`
 * matcher ikke `.eq("status", "proposed")` i næste kørsel, og `signMandate`
 * er selv idempotent på `mandate.id` + status `proposed` (retry-sikkert hvis
 * et enkelt kald skulle fejle midtvejs mellem write og notifikation).
 */

import { resolveThresholds, DAY_MS } from "./boardNegotiationThresholds.js";
import { MandateSignConflictError, signMandate } from "./boardMandateMeeting.js";
import { isBoardMandateModelEnabled } from "./boardMandateFlag.js";
import { MANDATE_OPENED_TITLE_CODE, isMandateSeasonEnded, notifyMandateOpened } from "./boardMandateEngine.js";

/**
 * Cron-entry: tjek alle `proposed` mandater og send reminders / auto-sign
 * baseret på kalenderdage siden `proposed_at`.
 *
 * @param {object} args
 * @param {object} args.supabase
 * @param {Function} args.notifyUser
 * @param {Date} [args.now]
 * @returns {Promise<{ mandates_checked: number, reminders_sent: number, auto_accepted: number, errors: number }>}
 */
export async function processMandateAutoAcceptCron({
  supabase,
  notifyUser,
  now = new Date(),
  captureExceptionFn,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client is required");
  if (typeof notifyUser !== "function") throw new Error("notifyUser is required");

  const summary = { mandates_checked: 0, reminders_sent: 0, auto_accepted: 0, lapsed_ended_season: 0, errors: 0 };

  // Kill-switch: samme fail-safe-disciplin som alle andre mandat-indgange.
  // Ingen isBetaTester-parameter her — cronen kører for HELE populationen og
  // har ingen viewer at spørge. #4839: derfor `engineWrite: true`, så 'beta'
  // behandles som 'on' for denne SKRIVNING; uden den stod cronen stille i beta,
  // og mandater hobede sig op i 'proposed' forbi deres auto_accept_deadline.
  // 'off' stopper stadig alt.
  if (!await isBoardMandateModelEnabled(supabase, { engineWrite: true })) return summary;

  const { mandates: proposedMandates, stampsAvailable } = await loadProposedMandates(supabase);
  if (!proposedMandates?.length) return summary;

  const teamIds = [...new Set(proposedMandates.map((m) => m.team_id).filter(Boolean))];
  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id, user_id, name, team_dna_key")
    .in("id", teamIds);
  if (teamsError) throw teamsError;
  const teamById = new Map((teams || []).map((t) => [t.id, t]));

  const lastSeenByUserId = await loadLastSeenByUserId({
    supabase,
    userIds: (teams || []).map((t) => t.user_id).filter(Boolean),
  });

  // #6773 · Ét sæson-opslag pr. sæson pr. kørsel, ikke pr. mandat.
  const seasonEndedByKey = new Map();
  const seasonEnded = async (mandate) => {
    const key = mandate.season_id ?? `n:${mandate.season_number}`;
    if (!seasonEndedByKey.has(key)) seasonEndedByKey.set(key, await isMandateSeasonEnded(supabase, mandate));
    return seasonEndedByKey.get(key);
  };

  for (const mandate of proposedMandates) {
    summary.mandates_checked += 1;
    const team = teamById.get(mandate.team_id);
    if (!team) continue;
    try {
      // #6773 · Et forslag for en afsluttet sæson underskrives aldrig og får
      // ingen påmindelser: det udløber ('lapsed'). Før blev det underskrevet
      // efter skiftet og stod aktivt ved siden af næste sæsons mandat.
      if (await seasonEnded(mandate)) {
        if (await lapseProposedMandate({ supabase, mandateId: mandate.id, now })) summary.lapsed_ended_season += 1;
        continue;
      }
      const result = await processMandateAutoAccept({ supabase, mandate, team, notifyUser, now, lastSeenByUserId, stampsAvailable });
      if (result.reminder_sent) summary.reminders_sent += 1;
      if (result.auto_accepted) summary.auto_accepted += 1;
    } catch (autoAcceptError) {
      summary.errors += 1;
      console.error(`  ❌ mandate auto-accept failed for team ${mandate.team_id}:`, autoAcceptError.message);
      if (captureExceptionFn) {
        captureExceptionFn(autoAcceptError, {
          tags: { cron: "board-mandate-auto-accept" },
          extra: { teamId: mandate.team_id, mandateId: mandate.id },
        });
      }
    }
  }

  return summary;
}

const MANDATE_BASE_COLUMNS = "id, team_id, season_id, season_number, proposed_at, auto_accept_deadline";

// #6946 · Dedupe-stemplerne pr. besked-slags. Stemplet står på mandatet, som
// spilleren ikke kan slette (board_mandates har RLS uden policies), i modsætning
// til notifications-rækken, som indbakken hard-sletter.
export const MANDATE_NOTICE_STAMPS = Object.freeze({
  opened: "opened_notified_at",
  t3: "t3_notified_at",
  t1: "t1_notified_at",
});
const STAMP_COLUMNS = Object.values(MANDATE_NOTICE_STAMPS);

// #6946 · auto-migrate applier migrationen ~3 min EFTER deployet. Svarer
// databasen i det vindue at en stempel-kolonne ikke findes (42703 fra Postgres,
// PGRST204 fra PostgREST's skema-cache), kører cronen den gamle
// notifications-dedupe i stedet for at fejle. Kun fejl der nævner en
// stempel-kolonne tæller.
export function isMissingStampColumnError(error) {
  if (!error || (error.code !== "42703" && error.code !== "PGRST204")) return false;
  const message = String(error.message ?? "");
  return STAMP_COLUMNS.some((col) => message.includes(col));
}

async function loadProposedMandates(supabase) {
  const { data, error } = await supabase
    .from("board_mandates")
    .select(`${MANDATE_BASE_COLUMNS}, ${STAMP_COLUMNS.join(", ")}`)
    .eq("status", "proposed");
  if (!error) return { mandates: data ?? [], stampsAvailable: true };
  if (!isMissingStampColumnError(error)) throw error;
  console.warn("  ⚠️  mandate auto-accept: stempel-kolonnerne (#6946) findes ikke endnu — bruger notifications-dedupe til migrationen er kørt");
  const { data: legacy, error: legacyError } = await supabase
    .from("board_mandates")
    .select(MANDATE_BASE_COLUMNS)
    .eq("status", "proposed");
  if (legacyError) throw legacyError;
  return { mandates: legacy ?? [], stampsAvailable: false };
}

/**
 * #6773 · Betinget på `status = 'proposed'`, så et samtidigt sign eller en
 * anden kørsel aldrig overskrives. Returnerer true når rækken blev lukket.
 */
async function lapseProposedMandate({ supabase, mandateId, now }) {
  const { data, error } = await supabase
    .from("board_mandates")
    .update({ status: "lapsed", updated_at: now.toISOString() })
    .eq("id", mandateId)
    .eq("status", "proposed")
    .select("id");
  if (error) throw new Error(`board_mandates lapse failed: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/**
 * Samme degraderings-disciplin som `boardAutoAccept.js::loadLastSeenByUserId`:
 * et fejlende opslag giver et tomt map (alle hold falder til det korte
 * vindue) i stedet for at vælte hele cronen.
 */
async function loadLastSeenByUserId({ supabase, userIds }) {
  const map = new Map();
  if (!userIds?.length) return map;
  const { data, error } = await supabase.from("users").select("id, last_seen").in("id", userIds);
  if (error) {
    console.error("  ⚠️  mandate auto-accept: kunne ikke hente last_seen — alle hold falder tilbage til det korte vindue:", error.message);
    return map;
  }
  for (const row of data || []) map.set(row.id, row.last_seen ?? null);
  return map;
}

async function processMandateAutoAccept({ supabase, mandate, team, notifyUser, now, lastSeenByUserId, stampsAvailable }) {
  const result = { reminder_sent: false, auto_accepted: false };
  if (!mandate.proposed_at) return result;

  const openedAt = new Date(mandate.proposed_at);
  if (Number.isNaN(openedAt.getTime())) return result;

  const thresholds = resolveThresholds({ last_seen: lastSeenByUserId.get(team.user_id) ?? null }, now);
  const daysSinceOpen = (now.getTime() - openedAt.getTime()) / DAY_MS;

  if (daysSinceOpen >= thresholds.AUTO_ACCEPT) {
    // Keep på alt: ingen adjustments, ingen anmodning, intet vision-slot-svar
    // (et evt. åbent slot forbliver åbent til næste rigtige møde).
    try {
      await signMandate(supabase, {
        teamId: team.id,
        mandateId: mandate.id,
        adjustments: [],
        request: null,
        visionSlot: null,
        now,
        // #4839: cron-skrivning uden viewer — 'beta' skal underskrive for alle
        // hold, ellers returnerer signMandate null og cronen tæller et
        // auto_accepted der aldrig skete.
        engineWrite: true,
        signedVia: "auto_accept",
      });
    } catch (signError) {
      // Codex P2 (#6780): forslaget blev lukket (fx lapsed af sæsonskiftet)
      // under underskriften. Ingen underskrift, ingen besked, ingen fejl.
      if (signError instanceof MandateSignConflictError && signError.errorCode === "board_mandate_not_proposed") return result;
      throw signError;
    }
    result.auto_accepted = true;
    if (team.user_id) {
      await notifyUser({
        userId: team.user_id,
        type: "board_update",
        title: "The board signed your annual mandate for you",
        message: "You didn't sign your annual mandate in time. The board kept the proposed goals and signed on your behalf. You can still request changes once the season is running.",
        relatedId: mandate.id,
        metadata: {
          titleCode: "notif.boardMandateAutoAccepted.title",
          messageCode: "notif.boardMandateAutoAccepted.message",
        },
        now,
      });
    }
    return result;
  }

  if (daysSinceOpen >= thresholds.T_MINUS_1) {
    result.reminder_sent = await sendReminder({
      supabase, team, mandate, notifyUser, now, daysSinceOpen, thresholds, stampsAvailable, critical: true,
    });
    return result;
  }

  if (daysSinceOpen >= thresholds.T_MINUS_3) {
    result.reminder_sent = await sendReminder({
      supabase, team, mandate, notifyUser, now, daysSinceOpen, thresholds, stampsAvailable, critical: false,
    });
    return result;
  }

  // #3579-mønsteret: åbnings-varsel KUN i mandatets første døgn.
  if (daysSinceOpen >= thresholds.NOTICE && daysSinceOpen < 1) {
    result.reminder_sent = await sendOpeningNotice({
      supabase, team, mandate, notifyUser, now, daysSinceOpen, thresholds, stampsAvailable,
    });
  }

  return result;
}

/**
 * #5752 · FALLBACK. Sæsonskiftet (`boardMandateEngine.js::
 * advanceMandateAtSeasonEnd`) sender normalt åbnings-notitsen i samme minut
 * som mandatet skrives. Cronen sender den kun når den mangler (fx en
 * notifikations-fejl ved skiftet, eller et nyt hold hvis mandat foreslås ved
 * holddannelsen). notifyUser's 24t-dedup dækker IKKE dette: teksten bærer
 * "{days} dage tilbage", så cronens tekst er en anden end skiftets. Derfor
 * slås notitsen op direkte (manager + board_update + related_id = mandatet +
 * titleCode) i stedet for at stole på tekst-lighed.
 *
 * #6946 · Den egentlige dedupe-sandhed er nu stemplet på mandatet
 * (`sendMandateNoticeOnce`). Notits-opslaget er kun BEVIS for at beskeden
 * allerede er sendt af en vej der ikke stempler (sæsonskiftet, rækker fra før
 * migrationen); finder cronen beviset, stempler den mandatet med det samme, så
 * en senere sletning i indbakken ikke kan genåbne det.
 */

// #6122 · Dedupe-nøgle (manager, type, mandat, titleCode) uden tidsvindue.
// Reminder-teksten bærer "{daysLeft}", så notifyUser's 24t-tekst-dedup lod
// T-3 og T-1 fyre igen HVERT døgn i deres vindue (aktive managere: op til 5
// beskeder + Discord-DM pr. mandat). Nu: højst én T-3 og én T-1 pr. mandat.
async function hasMandateNotice({ supabase, userId, mandateId, type, titleCode }) {
  const { data, error } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("type", type)
    .eq("related_id", mandateId)
    .eq("metadata->>titleCode", titleCode)
    .limit(1);
  if (error) throw new Error(`notifications lookup failed: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/**
 * #6946 · Sæt stemplet KUN hvis det stadig er NULL. Returnerer true når denne
 * kørsel satte det (og dermed ejer afsendelsen); false når en anden kørsel kom
 * først.
 */
async function claimMandateNoticeStamp({ supabase, mandateId, stamp, stampedAt }) {
  const { data, error } = await supabase
    .from("board_mandates")
    .update({ [stamp]: stampedAt })
    .eq("id", mandateId)
    .is(stamp, null)
    .select("id");
  if (error) throw new Error(`board_mandates ${stamp} stamp failed: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

// Fejlede afsendelsen, frigives stemplet igen (kun vores eget), så næste kørsel
// prøver igen. Lykkedes indsættelsen før fejlen, fanger notits-beviset det.
async function releaseMandateNoticeStamp({ supabase, mandateId, stamp, stampedAt }) {
  const { error } = await supabase
    .from("board_mandates")
    .update({ [stamp]: null })
    .eq("id", mandateId)
    .eq(stamp, stampedAt);
  if (error) throw new Error(`board_mandates ${stamp} release failed: ${error.message}`);
}

/**
 * #6946 · Højst én besked af hver slags pr. mandat, også når spilleren sletter
 * den i indbakken. Rækkefølge:
 *   1. Stemplet står → sendt, færdig.
 *   2. Notits-bevis findes (sæsonskiftet / før migrationen) → stempl, send ikke.
 *   3. Ellers: tag stemplet (betinget), send, og frigiv stemplet hvis
 *      afsendelsen kaster.
 * Uden stempel-kolonnerne (migrations-vinduet) kører kun trin 2 + send, som før.
 */
async function sendMandateNoticeOnce({ supabase, mandate, userId, stamp, type, titleCode, now, stampsAvailable, send }) {
  if (stampsAvailable && mandate[stamp]) return false;

  if (await hasMandateNotice({ supabase, userId, mandateId: mandate.id, type, titleCode })) {
    if (stampsAvailable) await claimMandateNoticeStamp({ supabase, mandateId: mandate.id, stamp, stampedAt: now.toISOString() });
    return false;
  }

  if (!stampsAvailable) return send();

  const stampedAt = now.toISOString();
  if (!await claimMandateNoticeStamp({ supabase, mandateId: mandate.id, stamp, stampedAt })) return false;
  try {
    return await send();
  } catch (sendError) {
    try {
      await releaseMandateNoticeStamp({ supabase, mandateId: mandate.id, stamp, stampedAt });
    } catch (releaseError) {
      // best-effort: den oprindelige afsendelsesfejl kastes lige herunder og
      // captures af cronens per-mandat-catch; frigivelsesfejlen logges kun.
      console.error(`  ❌ mandate notice: kunne ikke frigive ${stamp} for mandat ${mandate.id} efter fejlet afsendelse:`, releaseError.message);
    }
    throw sendError;
  }
}

async function sendOpeningNotice({ supabase, team, mandate, notifyUser, now, daysSinceOpen, thresholds, stampsAvailable }) {
  if (!team.user_id) return false;

  // Samme regel som reminderne: dage tilbage af vinduet, rundet op, min. 1.
  const days = Math.max(1, Math.ceil(thresholds.AUTO_ACCEPT - daysSinceOpen));
  return sendMandateNoticeOnce({
    supabase,
    mandate,
    userId: team.user_id,
    stamp: MANDATE_NOTICE_STAMPS.opened,
    type: "board_update",
    titleCode: MANDATE_OPENED_TITLE_CODE,
    now,
    stampsAvailable,
    send: async () => {
      const result = await notifyMandateOpened(supabase, {
        teamId: team.id,
        mandateId: mandate.id,
        seasonNumber: mandate.season_number,
        days,
        userId: team.user_id,
        dnaKey: team.team_dna_key ?? null,
        notifyUser,
        now,
      });
      return Boolean(result?.delivered);
    },
  });
}

async function sendReminder({ supabase, team, mandate, notifyUser, now, daysSinceOpen, thresholds, stampsAvailable, critical }) {
  if (!team.user_id) return false;
  const type = critical ? "board_critical" : "board_update";
  const titleCode = critical ? "notif.boardMandateT1Reminder.title" : "notif.boardMandateT3Reminder.title";
  return sendMandateNoticeOnce({
    supabase,
    mandate,
    userId: team.user_id,
    stamp: critical ? MANDATE_NOTICE_STAMPS.t1 : MANDATE_NOTICE_STAMPS.t3,
    type,
    titleCode,
    now,
    stampsAvailable,
    send: () => deliverReminder({ team, mandate, notifyUser, now, daysSinceOpen, thresholds, critical, type, titleCode }),
  });
}

async function deliverReminder({ team, mandate, notifyUser, now, daysSinceOpen, thresholds, critical, type, titleCode }) {
  const daysLeft = Math.max(1, Math.ceil(thresholds.AUTO_ACCEPT - daysSinceOpen));
  const isSingle = daysLeft === 1;
  const result = await notifyUser({
    userId: team.user_id,
    type,
    title: critical ? "Last chance: sign your annual mandate" : "The board is waiting for your annual mandate",
    message: critical
      ? `The board signs on its own in ${daysLeft} day${isSingle ? "" : "s"}. Open the annual meeting now.`
      : `You have ${daysLeft} days left to negotiate your annual mandate. If you don't act, the board will sign for you.`,
    relatedId: mandate.id,
    metadata: {
      titleCode,
      messageCode: critical
        ? (isSingle ? "notif.boardMandateT1Reminder.messageSingle" : "notif.boardMandateT1Reminder.messageMulti")
        : "notif.boardMandateT3Reminder.message",
      messageParams: { daysLeft },
    },
    now,
  });
  return Boolean(result?.delivered);
}
