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
import { captureException } from "./sentry.js";

export const RACE_AVAILABILITY_NOTIFICATION_TYPE = "selection_warning";

/** "2026-10-19" -> "19/10" (dag/måned læses ens på EN og DA). */
export function shortDayMonth(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr ?? ""));
  return m ? `${Number(m[3])}/${Number(m[2])}` : null;
}

/**
 * @param {{ riderName: string, raceName?: string|null, raceId: string, injuredUntil: string,
 *   missedRaces?: Array<{ id: string, name: string|null }>, finishedStage?: boolean }} args
 *   finishedStage: et hårdt styrt (tidstab + skade) kører etapen færdig; kun et
 *   styrt med udgåelse gør ikke. Uden det led lød beskeden som om han udgik (#7042).
 */
export function buildRiderInjuredNotification({ riderName, raceName, raceId, injuredUntil, missedRaces = [], finishedStage = false }) {
  const rider = riderName || "A rider";
  const race = raceName || "a race";
  const until = shortDayMonth(injuredUntil) ?? injuredUntil;
  const missed = missedRaces.map((r) => r.name).filter(Boolean).join(", ");
  const linkRaceId = missedRaces[0]?.id ?? raceId;
  const crashed = finishedStage
    ? `${rider} crashed in ${race} but finished the stage. He is injured until ${until}`
    : `${rider} crashed in ${race} and is injured until ${until}`;
  const message = !missed
    ? `${crashed}.`
    : finishedStage ? `${crashed} and will not ride ${missed}.` : `${crashed}. He will not ride ${missed}.`;
  const variant = finishedStage ? "messageFinished" : "message";
  return {
    type: RACE_AVAILABILITY_NOTIFICATION_TYPE,
    title: "Rider injured",
    message,
    relatedId: linkRaceId ?? null,
    metadata: {
      raceId: linkRaceId ?? null,
      titleCode: "notif.riderInjured.title",
      titleParams: {},
      messageCode: `notif.riderInjured.${variant}${missed ? "Missed" : ""}`,
      messageParams: { rider, race, until, missed },
    },
  };
}

/**
 * #7086 (ejer 22/10): træningsvarianten. Samme titel og type som løbsstyrtet, men
 * årsagen er træning, der er intet løb, og linket går til rytteren (metadata.riderId
 * vinder i frontendens notificationLink.js før selection_warnings løbs-regel).
 * relatedId = rytteren, så dedup'en (type+title+message+related_id) er pr. rytter.
 * @param {{ riderId: string, riderName?: string|null, injuredUntil: string }} args
 */
export function buildTrainingInjuryNotification({ riderId, riderName, injuredUntil }) {
  const rider = riderName || "A rider";
  const until = shortDayMonth(injuredUntil) ?? injuredUntil;
  return {
    type: RACE_AVAILABILITY_NOTIFICATION_TYPE,
    title: "Rider injured",
    message: `${rider} was injured in training and is out until ${until}.`,
    relatedId: riderId ?? null,
    metadata: {
      riderId: riderId ?? null,
      titleCode: "notif.riderInjured.title",
      titleParams: {},
      messageCode: "notif.riderInjured.messageTraining",
      messageParams: { rider, until },
    },
  };
}

/** #6938: lægens besked når en rytter bliver syg af langvarig ekstrem træthed. */
export function buildRiderIllNotification({ riderId, riderName, injuredUntil }) {
  const rider = riderName || "A rider";
  const until = shortDayMonth(injuredUntil) ?? injuredUntil;
  return {
    type: RACE_AVAILABILITY_NOTIFICATION_TYPE,
    title: "Rider ill",
    message: `The doctor says ${rider} is ill after several days of extreme fatigue and is out until ${until}.`,
    relatedId: riderId ?? null,
    metadata: {
      riderId: riderId ?? null,
      titleCode: "notif.riderIll.title",
      titleParams: {},
      messageCode: "notif.riderIll.message",
      messageParams: { rider, until },
    },
  };
}

/** PURE (#6938): de NYE sygdomme i ét afregnet tick (illness_days > 0), med datoen fra condition-raekken. */
export function newTrainingIllnesses({ reportRiders, conditionUpserts, today }) {
  const untilByRider = new Map((conditionUpserts ?? []).map((c) => [c?.rider_id, c?.injured_until ?? null]));
  const out = [];
  for (const r of reportRiders ?? []) {
    if (!r?.rider_id || !(Number(r.illness_days) > 0)) continue;
    const injuredUntil = untilByRider.get(r.rider_id);
    if (!injuredUntil || (today && injuredUntil < today)) continue;
    out.push({ riderId: r.rider_id, riderName: r.name || null, injuredUntil });
  }
  return out;
}

/**
 * PURE (#7086): de NYE træningsskader i ét afregnet træningstick. En ny skade er en
 * rapportlinje med injury_days > 0 (sat KUN når skaden blev rullet i dette tick; en
 * igangværende skade har 0). Datoen læses fra condition-raekken, fordi #5462 kan
 * have rykket den til slut-løbsdagens dato efter løkken. En skade der allerede er
 * overstået i dag (en sen afregning af en gammel dato) giver ingen besked.
 * @param {{ reportRiders: Array<{rider_id, name?, injury_days?}>,
 *   conditionUpserts: Array<{rider_id, injured_until}>, today: string }} args
 */
export function newTrainingInjuries({ reportRiders, conditionUpserts, today }) {
  const untilByRider = new Map((conditionUpserts ?? []).map((c) => [c?.rider_id, c?.injured_until ?? null]));
  const out = [];
  for (const r of reportRiders ?? []) {
    if (!r?.rider_id || !(Number(r.injury_days) > 0)) continue;
    const injuredUntil = untilByRider.get(r.rider_id);
    if (!injuredUntil || (today && injuredUntil < today)) continue;
    out.push({ riderId: r.rider_id, riderName: r.name || null, injuredUntil });
  }
  return out;
}

/**
 * #7086: én besked pr. ny træningsskade til holdets ejer (AI-hold har ingen ejer:
 * no-op i notifyTeamOwner). Kaldes af dailyTrainingEngine EFTER træningsdagens
 * writes er landet og kun når tick'et ikke allerede var kørt, så en genkørsel aldrig
 * sender igen; dedup'en i notifyUser (24 t, samme rytter + dato) er anden linje.
 * Kaster ALDRIG: en fejlet besked må ikke vælte en afregnet træningsdag.
 */
export async function notifyTrainingInjuries({ supabase, teamId, reportRiders, conditionUpserts, notify = notifyTeamOwner, now = new Date() }) {
  let sent = 0;
  try {
    const injuries = newTrainingInjuries({ reportRiders, conditionUpserts, today: copenhagenDateString(now) });
    for (const injury of injuries) {
      const payload = buildTrainingInjuryNotification(injury);
      if (await deliverOne({ notify, supabase, teamId, now, payload, flow: "training-day", stage: "training-injury-notice" })) sent += 1;
    }
    // #6938: syg af langvarig ekstrem træthed (kun når sygdom er tændt; ellers ingen illness_days).
    for (const illness of newTrainingIllnesses({ reportRiders, conditionUpserts, today: copenhagenDateString(now) })) {
      if (await deliverOne({ notify, supabase, teamId, now, payload: buildRiderIllNotification(illness), flow: "training-day", stage: "training-illness-notice" })) sent += 1;
    }
  } catch (err) {
    captureException(err, { tags: { flow: "training-day", stage: "training-injury-notice" }, teamId });
  }
  return { sent };
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
 * @param {{ supabase, race: {id,name}, injuryRows: Array<{rider_id, injured_until}>,
 *   finishedRiderIds?: Set<string>, notify?, now? }} args
 *   finishedRiderIds: ryttere hvis styrt ikke var en udgåelse (de kørte etapen færdig, #7042).
 */
export async function notifyRaceInjuries({ supabase, race, injuryRows, finishedRiderIds = new Set(), notify = notifyTeamOwner, now = new Date() }) {
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
      finishedStage: finishedRiderIds.has(row.rider_id),
    });
    if (await deliverOne({ notify, supabase, teamId: rider.team_id, now, payload, raceId: race.id })) sent += 1;
  }
  return { sent };
}

// Én modtagers fejl (ejer-opslag, insert) må aldrig koste de øvrige managers deres
// besked (review #6742): fanget og sendt til Sentry pr. modtager, løkken fortsætter.
async function deliverOne({ notify, supabase, teamId, now, payload, raceId, flow = "race-run", stage = "race-availability-notice" }) {
  try {
    const result = await notify({ supabase, teamId, now, ...payload });
    return Boolean(result?.delivered);
  } catch (err) {
    captureException(err, { tags: { flow, stage }, raceId, teamId });
    return false;
  }
}

/** Én besked pr. hold der blev fjernet ved start (gulvet). Afmeldte hold får ingen. */
export async function notifyTeamsDidNotStart({ supabase, race, teamIds, notify = notifyTeamOwner, now = new Date() }) {
  let sent = 0;
  for (const teamId of new Set(teamIds ?? [])) {
    const payload = buildTeamDidNotStartNotification({ raceId: race.id, raceName: race.name });
    if (await deliverOne({ notify, supabase, teamId, now, payload, raceId: race.id })) sent += 1;
  }
  return { sent };
}
