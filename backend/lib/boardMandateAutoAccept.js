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
import { signMandate } from "./boardMandateMeeting.js";
import { isBoardMandateModelEnabled } from "./boardMandateFlag.js";
import { MANDATE_OPENED_TITLE_CODE, notifyMandateOpened } from "./boardMandateEngine.js";

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

  const summary = { mandates_checked: 0, reminders_sent: 0, auto_accepted: 0, errors: 0 };

  // Kill-switch: samme fail-safe-disciplin som alle andre mandat-indgange.
  // Ingen isBetaTester-parameter her — cronen kører for HELE populationen og
  // har ingen viewer at spørge. #4839: derfor `engineWrite: true`, så 'beta'
  // behandles som 'on' for denne SKRIVNING; uden den stod cronen stille i beta,
  // og mandater hobede sig op i 'proposed' forbi deres auto_accept_deadline.
  // 'off' stopper stadig alt.
  if (!await isBoardMandateModelEnabled(supabase, { engineWrite: true })) return summary;

  const { data: proposedMandates, error } = await supabase
    .from("board_mandates")
    .select("id, team_id, season_number, proposed_at, auto_accept_deadline")
    .eq("status", "proposed");
  if (error) throw error;
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

  for (const mandate of proposedMandates) {
    summary.mandates_checked += 1;
    const team = teamById.get(mandate.team_id);
    if (!team) continue;
    try {
      const result = await processMandateAutoAccept({ supabase, mandate, team, notifyUser, now, lastSeenByUserId });
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

async function processMandateAutoAccept({ supabase, mandate, team, notifyUser, now, lastSeenByUserId }) {
  const result = { reminder_sent: false, auto_accepted: false };
  if (!mandate.proposed_at) return result;

  const openedAt = new Date(mandate.proposed_at);
  if (Number.isNaN(openedAt.getTime())) return result;

  const thresholds = resolveThresholds({ last_seen: lastSeenByUserId.get(team.user_id) ?? null }, now);
  const daysSinceOpen = (now.getTime() - openedAt.getTime()) / DAY_MS;

  if (daysSinceOpen >= thresholds.AUTO_ACCEPT) {
    // Keep på alt: ingen adjustments, ingen anmodning, intet vision-slot-svar
    // (et evt. åbent slot forbliver åbent til næste rigtige møde).
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
      team, mandate, notifyUser, now, daysSinceOpen, thresholds, critical: true,
    });
    return result;
  }

  if (daysSinceOpen >= thresholds.T_MINUS_3) {
    result.reminder_sent = await sendReminder({
      team, mandate, notifyUser, now, daysSinceOpen, thresholds, critical: false,
    });
    return result;
  }

  // #3579-mønsteret: åbnings-varsel KUN i mandatets første døgn.
  if (daysSinceOpen >= thresholds.NOTICE && daysSinceOpen < 1) {
    result.reminder_sent = await sendOpeningNotice({
      supabase, team, mandate, notifyUser, now, daysSinceOpen, thresholds,
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
 */
async function hasOpeningNotice({ supabase, userId, mandateId }) {
  const { data, error } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("type", "board_update")
    .eq("related_id", mandateId)
    .eq("metadata->>titleCode", MANDATE_OPENED_TITLE_CODE)
    .limit(1);
  if (error) throw new Error(`notifications lookup failed: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

async function sendOpeningNotice({ supabase, team, mandate, notifyUser, now, daysSinceOpen, thresholds }) {
  if (!team.user_id) return false;
  if (await hasOpeningNotice({ supabase, userId: team.user_id, mandateId: mandate.id })) return false;

  // Samme regel som reminderne: dage tilbage af vinduet, rundet op, min. 1.
  const days = Math.max(1, Math.ceil(thresholds.AUTO_ACCEPT - daysSinceOpen));
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
}

async function sendReminder({ team, mandate, notifyUser, now, daysSinceOpen, thresholds, critical }) {
  if (!team.user_id) return false;
  const daysLeft = Math.max(1, Math.ceil(thresholds.AUTO_ACCEPT - daysSinceOpen));
  const isSingle = daysLeft === 1;
  const result = await notifyUser({
    userId: team.user_id,
    type: critical ? "board_critical" : "board_update",
    title: critical ? "Last chance: sign your annual mandate" : "The board is waiting for your annual mandate",
    message: critical
      ? `The board signs on its own in ${daysLeft} day${isSingle ? "" : "s"}. Open the annual meeting now.`
      : `You have ${daysLeft} days left to negotiate your annual mandate. If you don't act, the board will sign for you.`,
    relatedId: mandate.id,
    metadata: {
      titleCode: critical ? "notif.boardMandateT1Reminder.title" : "notif.boardMandateT3Reminder.title",
      messageCode: critical
        ? (isSingle ? "notif.boardMandateT1Reminder.messageSingle" : "notif.boardMandateT1Reminder.messageMulti")
        : "notif.boardMandateT3Reminder.message",
      messageParams: { daysLeft },
    },
    now,
  });
  return Boolean(result?.delivered);
}
