// backend/lib/raceAvailabilityNotifications.js
// #6740 (ejer 16/10): to beskeder der manglede, da Friis' hold ikke stillede op i
// Tour du Léman. (1) En rytter der styrter, kører i mål og er skadet, så ud som rask:
// ingen besked, intet mærke. (2) Et hold der blev fjernet ved start (under gulvet)
// fik ingen besked og stod stadig som "Lineup locked".
//
// Begge bruger den eksisterende type `selection_warning` (advarselsikon, deep-link
// til løbet via metadata.raceId, push-gruppen "udtagelse"), så der skal ingen ny
// type i notifications_type_check. EN-tekst er fallback og dedup-nøgle; DA renderes
// af frontend via titleCode/messageCode (#666), samme mønster som
// assistantFilledSquadNotification.js.
//
// Fire-and-forget: kalderne isolerer fejl (try/catch + captureException). En fejlet
// besked må aldrig vælte en etape.
import { notifyTeamOwner } from "./notificationService.js";
import { copenhagenDateString } from "./copenhagenTime.js";
import { MIN_RACE_ENTRIES } from "./raceAutopick.js";
import { fetchAllRows } from "./supabasePagination.js";

export const RACE_AVAILABILITY_NOTIFICATION_TYPE = "selection_warning";

/** "2026-10-19" -> "19/10" (dag/måned læses ens på EN og DA). */
export function shortDayMonth(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr ?? ""));
  return m ? `${Number(m[3])}/${Number(m[2])}` : null;
}

/**
 * @param {{ riderName: string, raceName?: string|null, raceId: string, injuredUntil: string,
 *   missedRaces?: Array<{ id: string, name: string|null }> }} args
 */
export function buildRiderInjuredNotification({ riderName, raceName, raceId, injuredUntil, missedRaces = [] }) {
  const rider = riderName || "A rider";
  const race = raceName || "a race";
  const until = shortDayMonth(injuredUntil) ?? injuredUntil;
  const missed = missedRaces.map((r) => r.name).filter(Boolean).join(", ");
  const linkRaceId = missedRaces[0]?.id ?? raceId;
  return {
    type: RACE_AVAILABILITY_NOTIFICATION_TYPE,
    title: "Rider injured",
    message: missed
      ? `${rider} crashed in ${race} and is injured until ${until}. He will not ride ${missed}.`
      : `${rider} crashed in ${race} and is injured until ${until}.`,
    relatedId: linkRaceId ?? null,
    metadata: {
      raceId: linkRaceId ?? null,
      titleCode: "notif.riderInjured.title",
      titleParams: {},
      messageCode: missed ? "notif.riderInjured.messageMissed" : "notif.riderInjured.message",
      messageParams: { rider, race, until, missed },
    },
  };
}

/** @param {{ raceId: string, raceName?: string|null, min?: number }} args */
export function buildTeamDidNotStartNotification({ raceId, raceName, min = MIN_RACE_ENTRIES }) {
  const race = raceName || "your race";
  return {
    type: RACE_AVAILABILITY_NOTIFICATION_TYPE,
    title: "Your team did not start",
    message: `Your team did not start ${race}: fewer than ${min} fit riders at the start.`,
    relatedId: raceId ?? null,
    metadata: {
      raceId: raceId ?? null,
      titleCode: "notif.teamDidNotStart.title",
      titleParams: {},
      messageCode: "notif.teamDidNotStart.message",
      messageParams: { race, min },
    },
  };
}

/**
 * PURE: de kommende løb rytteren misser. Et løb tæller når det ikke er startet, ikke
 * er det løb han styrtede i, og første etape ligger senest på skadens sidste dag.
 * @param {{ entries: Array<{race_id:string}>, races: Array<{id,name,stages_completed,status}>,
 *   firstStageDateByRace: Map<string,string>, injuredUntil: string, crashRaceId: string }} args
 */
export function racesMissedByInjury({ entries, races, firstStageDateByRace, injuredUntil, crashRaceId }) {
  const raceById = new Map((races ?? []).map((r) => [r.id, r]));
  const out = [];
  for (const id of new Set((entries ?? []).map((e) => e.race_id))) {
    const race = raceById.get(id);
    if (!race || id === crashRaceId) continue;
    if ((Number(race.stages_completed) || 0) > 0 || race.status === "completed") continue;
    const start = firstStageDateByRace.get(id);
    if (!start || !injuredUntil || start > injuredUntil) continue;
    out.push({ id, name: race.name ?? null, start });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || String(a.name).localeCompare(String(b.name)))
    .map(({ id, name }) => ({ id, name }));
}

/**
 * Én besked pr. skadet rytter til holdets ejer (AI-hold har ingen ejer: no-op).
 * @param {{ supabase, race: {id,name}, injuryRows: Array<{rider_id, injured_until}>, notify?, now? }} args
 */
export async function notifyRaceInjuries({ supabase, race, injuryRows, notify = notifyTeamOwner, now = new Date() }) {
  const rows = (injuryRows ?? []).filter((r) => r?.rider_id && r?.injured_until);
  if (!rows.length) return { sent: 0 };
  const riderIds = [...new Set(rows.map((r) => r.rider_id))];
  // pagination-safe: de ryttere der styrtede på én etape (en håndfuld).
  const { data: riders, error: riderErr } = await supabase.from("riders")
    .select("id, firstname, lastname, team_id").in("id", riderIds);
  if (riderErr) throw new Error(`riders (injury notice): ${riderErr.message}`);
  // Kun tilmeldinger i løb der ikke er startet: race_entries bevares som historik, så et
  // uafgrænset opslag ville vokse med rytterens karriere (review #6742). Det indlejrede
  // races!inner-filter holder svaret på de få kommende løb.
  // pagination-safe: en etapes styrtede ryttere (en håndfuld) × deres ikke-startede løb (få pr. rytter).
  const { data: entries, error: entryErr } = await supabase.from("race_entries")
    .select("race_id, rider_id, team_id, races!inner(id, name, stages_completed, status)")
    .in("rider_id", riderIds).eq("races.stages_completed", 0).neq("races.status", "completed");
  if (entryErr) throw new Error(`race_entries (injury notice): ${entryErr.message}`);
  // Et afmeldt hold bevarer sine entries (#4306); det løb misser rytteren ikke (review #6742).
  const entryRaceIds = [...new Set((entries ?? []).map((e) => e.race_id))];
  const withdrawnPairs = new Set();
  if (entryRaceIds.length) {
    // pagination-safe: afmeldinger i de få kommende løb fra opslaget ovenfor.
    const { data: wd, error: wdErr } = await supabase.from("race_withdrawals").select("race_id, team_id").in("race_id", entryRaceIds);
    if (wdErr) throw new Error(`race_withdrawals (injury notice): ${wdErr.message}`);
    for (const w of wd ?? []) withdrawnPairs.add(`${w.race_id}:${w.team_id}`);
  }
  const activeEntries = (entries ?? []).filter((e) => !withdrawnPairs.has(`${e.race_id}:${e.team_id}`));
  const races = [...new Map(activeEntries.filter((e) => e?.races?.id).map((e) => [e.races.id, e.races])).values()];
  const raceIds = races.map((r) => r.id);
  const firstStageDateByRace = new Map();
  if (raceIds.length) {
    const sched = await fetchAllRows(() => supabase.from("race_stage_schedule")
      .select("race_id, scheduled_at").in("race_id", raceIds).order("race_id").order("stage_number"));
    for (const row of sched ?? []) {
      if (!row?.scheduled_at) continue;
      const day = copenhagenDateString(new Date(row.scheduled_at));
      const prev = firstStageDateByRace.get(row.race_id);
      if (!prev || day < prev) firstStageDateByRace.set(row.race_id, day);
    }
  }
  const riderById = new Map((riders ?? []).map((r) => [r.id, r]));
  let sent = 0;
  for (const row of rows) {
    const rider = riderById.get(row.rider_id);
    if (!rider?.team_id) continue;
    const missedRaces = racesMissedByInjury({
      entries: activeEntries.filter((e) => e.rider_id === row.rider_id && e.team_id === rider.team_id),
      races, firstStageDateByRace, injuredUntil: row.injured_until, crashRaceId: race.id,
    });
    const payload = buildRiderInjuredNotification({
      riderName: [rider.firstname, rider.lastname].filter(Boolean).join(" "),
      raceName: race.name, raceId: race.id, injuredUntil: row.injured_until, missedRaces,
    });
    const result = await notify({ supabase, teamId: rider.team_id, now, ...payload });
    if (result?.delivered) sent += 1;
  }
  return { sent };
}

/** Én besked pr. hold der blev fjernet ved start (gulvet). Afmeldte hold får ingen. */
export async function notifyTeamsDidNotStart({ supabase, race, teamIds, notify = notifyTeamOwner, now = new Date() }) {
  let sent = 0;
  for (const teamId of new Set(teamIds ?? [])) {
    const payload = buildTeamDidNotStartNotification({ raceId: race.id, raceName: race.name });
    const result = await notify({ supabase, teamId, now, ...payload });
    if (result?.delivered) sent += 1;
  }
  return { sent };
}
