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
import { raceSquadOf } from "./riderEligibility.js";
import { teamPoolIdForSquad } from "./raceBinding.js";

export const RACE_AVAILABILITY_NOTIFICATION_TYPE = "selection_warning";

/** "2026-10-19" -> "19/10" (dag/måned læses ens på EN og DA). */
export function shortDayMonth(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr ?? ""));
  return m ? `${Number(m[3])}/${Number(m[2])}` : null;
}

/**
 * #7412: første RASKE dag. `injured_until` er sidste skadede dato (DATE, inklusiv), og
 * udtagelses-gaten (`injured_until >= i dag`) holder ham ude hele den dag. "Injured until
 * 2/11" læste spillerne som "rask 2/11"; "fit again 3/11" kan ikke læses forkert.
 */
export function fitAgainDate(injuredUntil) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(injuredUntil ?? ""));
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1)).toISOString().slice(0, 10);
}

/** #7412: så mange løbsnavne står i beskeden; resten tælles ("and 3 more races"). */
export const MISSED_RACES_LISTED = 5;

function missedSummary(missedRaces = []) {
  const names = (missedRaces ?? []).map((r) => r?.name).filter(Boolean);
  const listed = names.slice(0, MISSED_RACES_LISTED);
  const more = names.length - listed.length;
  const missed = listed.join(", ");
  const en = !missed ? "" : more === 0 ? missed : `${missed} and ${more} more ${more === 1 ? "race" : "races"}`;
  return { missed, more, en };
}

/**
 * @param {{ riderName: string, raceName?: string|null, raceId: string, injuredUntil: string,
 *   missedRaces?: Array<{ id: string, name: string|null }>, finishedStage?: boolean }} args
 *   finishedStage: et hårdt styrt (tidstab + skade) kører etapen færdig; kun et
 *   styrt med udgåelse gør ikke. Uden det led lød beskeden som om han udgik (#7042).
 *   missedRaces (#7412): ALLE løb i rytterens pulje der starter i skadeperioden, ikke kun
 *   dem han er tilmeldt (racesStartingInInjury).
 */
export function buildRiderInjuredNotification({ riderName, raceName, raceId, injuredUntil, missedRaces = [], finishedStage = false }) {
  const rider = riderName || "A rider";
  const race = raceName || "a race";
  const fitAgain = shortDayMonth(fitAgainDate(injuredUntil)) ?? injuredUntil;
  const { missed, more, en } = missedSummary(missedRaces);
  const linkRaceId = missedRaces[0]?.id ?? raceId;
  const crashed = finishedStage
    ? `${rider} crashed in ${race} but finished the stage. He is fit again on ${fitAgain}.`
    : `${rider} crashed in ${race} and is fit again on ${fitAgain}.`;
  const message = missed ? `${crashed} He will miss ${en}.` : crashed;
  const variant = finishedStage ? "crashFinished" : "crash";
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
      messageParams: { rider, race, fitAgain, missed, more },
    },
  };
}

/**
 * #7086 (ejer 22/10): træningsvarianten. Samme titel og type som løbsstyrtet, men
 * årsagen er træning, der er intet løb, og linket går til rytteren (metadata.riderId
 * vinder i frontendens notificationLink.js før selection_warnings løbs-regel).
 * relatedId = rytteren, så dedup'en (type+title+message+related_id) er pr. rytter.
 * #7412: "fit again <første raske dag>" + løbene i skadeperioden.
 * @param {{ riderId: string, riderName?: string|null, injuredUntil: string,
 *   missedRaces?: Array<{ id: string, name: string|null }> }} args
 */
export function buildTrainingInjuryNotification({ riderId, riderName, injuredUntil, missedRaces = [] }) {
  const rider = riderName || "A rider";
  const fitAgain = shortDayMonth(fitAgainDate(injuredUntil)) ?? injuredUntil;
  const { missed, more, en } = missedSummary(missedRaces);
  const injured = `${rider} was injured in training and is fit again on ${fitAgain}.`;
  return {
    type: RACE_AVAILABILITY_NOTIFICATION_TYPE,
    title: "Rider injured",
    message: missed ? `${injured} He will miss ${en}.` : injured,
    relatedId: riderId ?? null,
    metadata: {
      riderId: riderId ?? null,
      titleCode: "notif.riderInjured.title",
      titleParams: {},
      messageCode: `notif.riderInjured.training${missed ? "Missed" : ""}`,
      messageParams: { rider, fitAgain, missed, more },
    },
  };
}

/**
 * PURE (#7412): de løb rytteren ikke kan køre. ALLE løb i hans trups pulje (ikke kun dem
 * han er tilmeldt) der ikke er startet, starter fra i dag til og med skadens sidste dag, og
 * ikke er styrt-løbet eller et løb holdet har meldt fra (review #6742). Sorteret efter start.
 * @param {{ races: Array<{id, name, squad, poolId, start}>, squad: string, poolId: any,
 *   injuredUntil: string, today: string, crashRaceId?: string|null,
 *   withdrawnRaceIds?: Set<string> }} args
 */
export function racesStartingInInjury({ races, squad, poolId, injuredUntil, today, crashRaceId = null, withdrawnRaceIds = new Set() }) {
  if (poolId == null || !injuredUntil) return [];
  const riderSquad = raceSquadOf({ squad });
  return (races ?? [])
    .filter((r) => r?.id && r.id !== crashRaceId && !withdrawnRaceIds.has(r.id))
    .filter((r) => r.poolId === poolId && raceSquadOf(r) === riderSquad)
    .filter((r) => r.start && (!today || r.start >= today) && r.start <= injuredUntil)
    .sort((a, b) => a.start.localeCompare(b.start) || String(a.name).localeCompare(String(b.name)))
    .map(({ id, name }) => ({ id, name: name ?? null }));
}

/**
 * #7412: kommende, ikke-startede løb i de givne puljer med første etape senest `untilDate`.
 * Grænserne i forespørgslen er løse (UTC); racesStartingInInjury afgør den danske dato.
 * @returns {Promise<Array<{id, name, squad, poolId, start}>>}
 */
export async function loadPoolRacesStartingBy({ supabase, poolIds, untilDate, now = new Date() }) {
  const pools = [...new Set((poolIds ?? []).filter((p) => p != null))];
  const upper = fitAgainDate(untilDate); // dansk midnat efter sidste skadedag ligger før UTC-midnat
  if (!pools.length || !upper) return [];
  const today = copenhagenDateString(now);
  // pagination-safe (fetchAllRows): kun ikke-startede løb i rytternes puljer, med etaper
  // fra i går til skadens sidste dag. En skade varer dage, så det er titals rækker.
  const rows = await fetchAllRows(() => supabase.from("race_stage_schedule")
    .select("race_id, stage_number, scheduled_at, races!inner(id, name, squad, league_division_id, stages_completed, status)")
    .in("races.league_division_id", pools)
    .eq("races.stages_completed", 0)
    .neq("races.status", "completed")
    .gte("scheduled_at", `${shiftDate(today, -1)}T00:00:00Z`)
    .lt("scheduled_at", `${upper}T00:00:00Z`)
    .order("race_id")
    .order("stage_number"));
  const byRace = new Map();
  for (const row of rows ?? []) {
    const race = row?.races;
    if (!race?.id || !row.scheduled_at) continue;
    const day = copenhagenDateString(new Date(row.scheduled_at));
    const prev = byRace.get(race.id);
    if (!prev) byRace.set(race.id, { id: race.id, name: race.name ?? null, squad: race.squad ?? null, poolId: race.league_division_id, start: day });
    else if (day < prev.start) prev.start = day;
  }
  return [...byRace.values()];
}

function shiftDate(dateStr, days) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * #7412: løbene hver skadet rytter ikke kan køre, pr. rider_id. FAIL-SAFE: en fejl i
 * opslaget koster listen, aldrig beskeden (Sentry får fejlen).
 * @param {{ supabase, injuries: Array<{riderId, teamId, squad, injuredUntil}>,
 *   crashRaceId?: string|null, now?: Date, flow?: string }} args
 * @returns {Promise<Map<string, Array<{id, name}>>>}
 */
export async function loadMissedRacesByRider({ supabase, injuries, crashRaceId = null, now = new Date(), flow = "race-run" }) {
  const out = new Map();
  const list = (injuries ?? []).filter((i) => i?.riderId && i?.teamId && i?.injuredUntil).map((i) => ({ ...i }));
  if (!list.length) return out;
  try {
    // Træningsstien kender ikke truppen; den slås op her.
    // pagination-safe: en træningsdags nye skader på ét hold (en håndfuld ryttere).
    const unknownSquad = list.filter((i) => i.squad === undefined).map((i) => i.riderId);
    if (unknownSquad.length) {
      const { data: squads, error: squadErr } = await supabase.from("riders").select("id, squad").in("id", unknownSquad);
      if (squadErr) throw new Error(`riders (injury races): ${squadErr.message}`);
      const squadById = new Map((squads ?? []).map((r) => [r.id, r.squad ?? null]));
      for (const i of list) if (i.squad === undefined) i.squad = squadById.get(i.riderId) ?? null;
    }
    const teamIds = [...new Set(list.map((i) => i.teamId))];
    // pagination-safe: holdene bag en håndfuld skadede ryttere.
    const { data: teams, error: teamErr } = await supabase.from("teams")
      .select("id, league_division_id, u23_league_division_id, junior_league_division_id").in("id", teamIds);
    if (teamErr) throw new Error(`teams (injury races): ${teamErr.message}`);
    const teamById = new Map((teams ?? []).map((t) => [t.id, t]));
    const withPool = list.map((i) => ({ ...i, poolId: teamPoolIdForSquad(teamById.get(i.teamId), raceSquadOf({ squad: i.squad })) }));
    const untilMax = withPool.map((i) => i.injuredUntil).sort().at(-1);
    const races = await loadPoolRacesStartingBy({ supabase, poolIds: withPool.map((i) => i.poolId), untilDate: untilMax, now });
    const withdrawn = new Set();
    if (races.length) {
      // pagination-safe: afmeldinger for de få kommende løb × de skadede rytteres hold.
      const { data: wd, error: wdErr } = await supabase.from("race_withdrawals")
        .select("race_id, team_id").in("race_id", races.map((r) => r.id)).in("team_id", teamIds);
      if (wdErr) throw new Error(`race_withdrawals (injury races): ${wdErr.message}`);
      for (const w of wd ?? []) withdrawn.add(`${w.race_id}:${w.team_id}`);
    }
    const today = copenhagenDateString(now);
    for (const i of withPool) {
      const withdrawnRaceIds = new Set(races.filter((r) => withdrawn.has(`${r.id}:${i.teamId}`)).map((r) => r.id));
      out.set(i.riderId, racesStartingInInjury({
        races, squad: i.squad, poolId: i.poolId, injuredUntil: i.injuredUntil, today, crashRaceId, withdrawnRaceIds,
      }));
    }
  } catch (err) {
    captureException(err, { tags: { flow, stage: "injury-missed-races" } });
    out.clear();
  }
  return out;
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
    // #7412: løbene i skadeperioden. Fail-safe: en fejl koster listen, ikke beskeden.
    const missedByRider = injuries.length && supabase?.from
      ? await loadMissedRacesByRider({ supabase, injuries: injuries.map((i) => ({ ...i, teamId })), now, flow: "training-day" })
      : new Map();
    for (const injury of injuries) {
      const payload = buildTrainingInjuryNotification({ ...injury, missedRaces: missedByRider.get(injury.riderId) ?? [] });
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
 * Én besked pr. skadet rytter til holdets ejer (AI-hold har ingen ejer: no-op).
 * #7412: beskeden nævner ALLE løb i rytterens pulje der starter i skadeperioden, ikke
 * kun dem han er tilmeldt, og datoen er første raske dag.
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
    .select("id, firstname, lastname, team_id, squad").in("id", riderIds);
  if (riderErr) throw new Error(`riders (injury notice): ${riderErr.message}`);
  const riderById = new Map((riders ?? []).map((r) => [r.id, r]));
  const missedByRider = await loadMissedRacesByRider({
    supabase, crashRaceId: race.id, now,
    injuries: rows.map((row) => {
      const rider = riderById.get(row.rider_id);
      return { riderId: row.rider_id, teamId: rider?.team_id ?? null, squad: rider?.squad ?? null, injuredUntil: row.injured_until };
    }),
  });
  let sent = 0;
  for (const row of rows) {
    const rider = riderById.get(row.rider_id);
    if (!rider?.team_id) continue;
    const payload = buildRiderInjuredNotification({
      riderName: [rider.firstname, rider.lastname].filter(Boolean).join(" "),
      raceName: race.name, raceId: race.id, injuredUntil: row.injured_until,
      missedRaces: missedByRider.get(row.rider_id) ?? [],
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
