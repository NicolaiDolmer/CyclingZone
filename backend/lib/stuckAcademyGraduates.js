// #4495 — ÉN kilde til prædikatet "akademirytter der sidder fast over
// graduerings-alderen".
//
// BAGGRUND (verificeret prod 31/8): 8 akademiryttere paa 22-23 aar sad fast paa
// 6 hold. Rod-aarsagen var den usolgte graduate-auktion: naar graduerings-flowet
// valgte 'sell' oprettede createGraduateAuction en senior-auktion og lod bevidst
// rytteren staa is_academy=true indtil auktionen blev afgjort — men KUN vinder-
// stien i auctionFinalization.js flippede is_academy=false. Kom der ingen bud,
// lukkede auktionen som 'completed' uden at nogen sti roerte rytteren, og
// grad-raekken var allerede stemplet 'sold'. Rytteren var hverken solgt,
// promoveret, sluppet eller fri agent — bare fanget.
//
// DENNE fil ejer prædikatet, saa vagten (ownershipInvariantWatch invariant G) og
// reparations-scriptet (backend/scripts/repairStuckAcademyGraduates.js) ALDRIG
// kan divergere: en dry-run der viser andre ryttere end den efterfoelgende apply
// er den vaerste fejlklasse i et reparations-script (laering 3/9).
//
// READ-ONLY: ingen writes her. Udgangen (fri agent) ligger i
// academyGraduation.releaseUnsoldGraduate.

import { isGraduateAge } from "./academyGraduation.js";
import { ageForSeason } from "./riderSeasonAge.js";
import { fetchAllRows } from "./supabasePagination.js";

// Hvor laenge maa en akademirytter vaere OVER graduerings-alderen uden at vaere
// paa vej ud, foer det er et invariant-brud i stedet for en lovlig, forbigaaende
// tilstand?
//
// To lovlige tilstande skal IKKE alarmere:
//   1. Override-vinduet: rytteren har en 'pending' grad-raekke og deadline er
//      ikke naaet endnu — manageren har GRADUATION.DEADLINE_DAYS til selv at
//      vaelge promovér/saelg/slip.
//   2. Sweep-forsinkelsen: deadline er netop udloebet, men det daglige
//      graduerings-sweep har ikke koert endnu (det koerer i 22-24-vinduet).
//
// 48 timer daekker begge med god margin. Samme konservative logik som
// PENDING_TRANSFER_STALE_HOURS i ownershipInvariantWatch.js: en vagt der
// alarmerer paa lovlige, forbigaaende tilstande bliver ignoreret og mister sin
// vaerdi (CYCLINGZONE-31 / CYCLINGZONE-48 / CYCLINGZONE-4M).
export const STUCK_GRADUATE_GRACE_HOURS = 48;

const AUCTION_OPEN_STATUSES = ["active", "extended"];

/**
 * Slå den aktive sæsons nummer op. Returnerer null hvis ingen aktiv sæson er
 * registreret — kalderen skal da springe tjekket over i stedet for at gætte en
 * sæson (aldersprædikatet er sæson-diskret, jf. riderSeasonAge.js).
 */
export async function fetchActiveSeasonNumber(supabase) {
  const { data, error } = await supabase
    .from("seasons")
    .select("number")
    .eq("status", "active")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`fetchActiveSeasonNumber: ${error.message}`);
  return Number.isFinite(data?.number) ? data.number : null;
}

/**
 * Find akademiryttere der er vokset ud af akademiet men aldrig kom ud.
 *
 * Prædikat (ALLE skal holde):
 *   a. riders.is_academy = true, is_retired = false, team_id NOT NULL.
 *      team_id NULL er en ANDEN klasse (strandet akademi-fri-agent, invariant D
 *      i ownershipInvariantWatch #2257) — dobbelt-rapportering hjælper ingen.
 *   b. sæsonalder >= GRADUATION.GRADUATE_AGE (ageForSeason, ikke kalenderalder).
 *   c. INGEN aaben auktion (active/extended) paa rytteren — en igangvaerende
 *      graduate-auktion ER den dokumenterede mellemtilstand, ikke et brud.
 *   d. INGEN 'pending' grad-raekke hvis deadline ligger inden for graceHours
 *      bagud — dvs. hverken et aabent override-vindue eller et lige udloebet et
 *      som det daglige sweep endnu ikke har naaet.
 *
 * @param {object} supabase
 * @param {{ now?: Date, seasonNumber?: number|null, graceHours?: number }} [opts]
 * @returns {Promise<{seasonNumber:number|null, checked:number, stuck:Array<{riderId:string, teamId:string, aiTeamId:string|null, age:number, birthdate:string, firstname:string, lastname:string, pendingGraduationId:string|null, pendingDeadline:string|null, graduationStatuses:string[]}>}>}
 */
export async function findStuckAcademyGraduates(supabase, {
  now = new Date(),
  seasonNumber = undefined,
  graceHours = STUCK_GRADUATE_GRACE_HOURS,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const season = seasonNumber === undefined ? await fetchActiveSeasonNumber(supabase) : seasonNumber;
  if (!Number.isFinite(season)) {
    // Ingen aktiv sæson → aldersprædikatet er udefineret. Rapportér 0 i stedet
    // for at gætte: en vagt der gætter alarmerer paa gættet, ikke paa data.
    return { seasonNumber: null, checked: 0, stuck: [] };
  }

  const academy = await fetchAllRows(() =>
    supabase
      .from("riders")
      .select("id, team_id, ai_team_id, firstname, lastname, birthdate")
      .eq("is_academy", true)
      .eq("is_retired", false)
      .not("team_id", "is", null)
      .order("id"));

  const overAge = academy
    .map((r) => ({ rider: r, age: ageForSeason(r.birthdate, season) }))
    .filter(({ age }) => isGraduateAge(age));

  if (overAge.length === 0) {
    return { seasonNumber: season, checked: academy.length, stuck: [] };
  }

  const riderIds = overAge.map(({ rider }) => rider.id);

  const openAuctions = await fetchAllRows(() =>
    supabase
      .from("auctions")
      .select("rider_id")
      .in("rider_id", riderIds)
      .in("status", AUCTION_OPEN_STATUSES)
      .order("rider_id"));
  const onOpenAuction = new Set(openAuctions.map((a) => a.rider_id));

  // ALLE grad-raekker for kandidaterne, ikke kun de pending: statusserne er
  // selve diagnosen. En rytter med en 'sold'-raekke er #4495's kerne-case
  // (auktionen blev aldrig til noget), mens en rytter UDEN nogen raekke aldrig
  // har faaet sit override-vindue overhovedet — to forskellige historier, og
  // reparations-scriptet skal kunne vise ejeren forskellen.
  const grads = await fetchAllRows(() =>
    supabase
      .from("academy_graduation")
      .select("id, rider_id, status, deadline, created_at")
      .in("rider_id", riderIds)
      .order("rider_id"));

  const gradsByRider = new Map();
  for (const g of grads) {
    if (!gradsByRider.has(g.rider_id)) gradsByRider.set(g.rider_id, []);
    gradsByRider.get(g.rider_id).push(g);
  }

  const graceCutoff = now.getTime() - graceHours * 3_600_000;
  const pendingById = new Map();
  const inGraceWindow = new Set();
  for (const g of grads) {
    if (g.status !== "pending") continue;
    if (!pendingById.has(g.rider_id)) pendingById.set(g.rider_id, g);
    // Fail-OPEN paa en uparsebar deadline: vi vil hellere lade vagten alarmere
    // paa en raekke vi ikke kan datere end tie om en fastlaast rytter.
    const deadlineMs = g.deadline ? new Date(g.deadline).getTime() : NaN;
    if (Number.isNaN(deadlineMs) || deadlineMs <= graceCutoff) continue;
    inGraceWindow.add(g.rider_id);
  }

  const stuck = overAge
    .filter(({ rider }) => !onOpenAuction.has(rider.id) && !inGraceWindow.has(rider.id))
    .map(({ rider, age }) => ({
      riderId: rider.id,
      teamId: rider.team_id,
      aiTeamId: rider.ai_team_id ?? null,
      age,
      birthdate: rider.birthdate,
      firstname: rider.firstname,
      lastname: rider.lastname,
      pendingGraduationId: pendingById.get(rider.id)?.id ?? null,
      pendingDeadline: pendingById.get(rider.id)?.deadline ?? null,
      // Historikken bag rytteren: [] = han fik aldrig et override-vindue.
      graduationStatuses: (gradsByRider.get(rider.id) ?? []).map((g) => g.status),
    }));

  return { seasonNumber: season, checked: academy.length, stuck };
}
