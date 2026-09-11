// #5133 — løbende redningssti for akademiryttere der faldt ud af graduerings-
// flowet.
//
// BAGGRUND (verificeret prod 11/9): én akademirytter (født 2006, sæsonalder 22 i
// S3) fik aldrig sin academy_graduation-række ved sæson-transitionen 23/8. Han
// stod derfor stille på et menneskehold som akademirytter over aldersgrænsen —
// manageren fik aldrig sit valg (promovér/sælg/slip), fordi VALGET aldrig blev
// oprettet.
//
// Den strukturelle fejl er ikke at han missede batchen, men at INGEN sti fangede
// ham igen:
//   - detectGraduates kører KUN ved sæson-transitionen (riderProgressionEngine).
//     Misser du den, er næste chance næste sæsonskifte — op mod fem uger.
//   - Graduerings-sweepet (academyGraduationSweep.js) selekterer kun
//     EKSISTERENDE status='pending'-rækker. Uden en række gør det intet.
//   - Ownership-vagten (invariant G) er READ-ONLY pr. kontrakt: den råber, den
//     reparerer ikke.
//
// DENNE fil lukker hullet: samme prædikat som vagten, men den ÅBNER vinduet i
// stedet for kun at rapportere det. Invariant G bliver dermed et sikkerhedsnet
// i stedet for den eneste opdagelse.
//
// AFGRÆNSNING (bevidst): kun ryttere UDEN nogen grad-række overhovedet — dem der
// aldrig fik et override-vindue. En rytter MED en resolveret række (fx 'sold'
// uden gennemført salg) er #4495's klasse, og dén ejes af
// academyGraduation.resolveUnsoldGraduate + repairStuckAcademyGraduates.js. To
// stier der skriver på den samme rytter med hver sin historie er præcis den
// slags dobbelt-reparation der gør en prod-hændelse uoverskuelig.
//
// TO HULLER, ÉN sti: ud over rytteren helt uden række fanger sweepet også den
// række der BLEV oprettet, men hvis notifikation aldrig nåede manageren (insert
// ok, notify kastede). Den rytter er usynlig for prædikatet ovenfor — rækken
// findes jo — men manageren ved stadig ingenting og får udfaldet trukket ned
// over hovedet ved deadline. Se findPendingWithoutNotification.
//
// UDFALDET er managerens valg, ikke systemets: vi opretter den pending-række +
// notifikation som sæson-transitionen ville have oprettet, med et fuldt
// GRADUATION.DEADLINE_DAYS-vindue fra nu. Først når dét vindue udløber tager
// det eksisterende sweep over med default-kæden. Ejer-beslutning i #5133:
// manageren skal have sit valg frem for at få udfaldet trukket ned over hovedet.

import { isAcademyEnabled } from "./academyFlag.js";
import { notifyTeamOwner } from "./notificationService.js";
import {
  GRADUATION_READY_TYPE,
  graduationDeadlineFrom,
  notifyGraduationReady,
  openGraduationWindow,
} from "./academyGraduation.js";
import { fetchAllRows } from "./supabasePagination.js";
import { findStuckAcademyGraduates, STUCK_GRADUATE_GRACE_HOURS } from "./stuckAcademyGraduates.js";

/**
 * Slå den aktive sæson op (id + nummer). Begge dele skal bruges: nummeret til
 * det sæson-diskrete aldersprædikat, id'et til grad-rækkens season_id.
 *
 * @returns {Promise<{id:string, number:number}|null>}
 */
export async function fetchActiveSeason(supabase) {
  const { data, error } = await supabase
    .from("seasons")
    .select("id, number")
    .eq("status", "active")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`fetchActiveSeason: ${error.message}`);
  if (!data?.id || !Number.isFinite(data?.number)) return null;
  return { id: data.id, number: data.number };
}

/**
 * Akademiryttere over gradueringsalderen som ALDRIG har fået en grad-række.
 *
 * Prædikatet er vagtens, uændret (findStuckAcademyGraduates) — dry-run og
 * apply må aldrig kunne vise forskellige ryttere (læring 3/9). Her filtreres
 * kun HISTORIEN: graduationStatuses tom = intet override-vindue nogensinde.
 *
 * @returns {Promise<{seasonNumber:number|null, checked:number, missed:object[]}>}
 */
export async function findMissedGraduates(supabase, {
  now = new Date(),
  seasonNumber = undefined,
  graceHours = STUCK_GRADUATE_GRACE_HOURS,
} = {}) {
  const { seasonNumber: season, checked, stuck } = await findStuckAcademyGraduates(supabase, { now, seasonNumber, graceHours });
  return { seasonNumber: season, checked, missed: stuck.filter((c) => c.graduationStatuses.length === 0) };
}

/**
 * Pending graduerings-rækker hvis manager ALDRIG fik sin notifikation.
 *
 * Hullet: openGraduationWindow inserter rækken FØRST og notificerer bagefter.
 * Lykkes inserten og kaster notifikationen (netværk, Supabase-hikke), står
 * rækken i basen — og netop dén række gør rytteren usynlig for
 * findMissedGraduates ("han har jo et vindue"). Manageren fik aldrig at vide at
 * han skulle vælge, og ved deadline resolverer det natlige sweep for ham.
 *
 * Kompensationen er efter-levering frem for rollback: rækken ER den rigtige
 * tilstand, og en sletning ville smide et allerede åbent vindue væk hvis
 * notifikationen i virkeligheden nåede frem. Matchet er (holdets user_id, type,
 * related_id = rytteren) — samme tre felter notifikationen skrives med.
 *
 * AI-hold (teams.user_id = null) har ingen modtager og udelades: ellers ville
 * hvert tick prøve at levere en besked der pr. definition ikke kan leveres.
 *
 * @returns {Promise<Array<{graduationId:string, riderId:string, teamId:string, name:string}>>}
 */
export async function findPendingWithoutNotification(supabase, { seasonId } = {}) {
  if (!seasonId) throw new Error("findPendingWithoutNotification: seasonId required");

  const pending = await fetchAllRows(() =>
    supabase.from("academy_graduation")
      .select("id, rider_id, team_id")
      .eq("season_id", seasonId)
      .eq("status", "pending")
      .order("rider_id"));
  if (pending.length === 0) return [];

  const riderIds = [...new Set(pending.map((g) => g.rider_id))];
  const teamIds = [...new Set(pending.map((g) => g.team_id).filter(Boolean))];

  const teams = await fetchAllRows(() =>
    supabase.from("teams").select("id, user_id").in("id", teamIds).order("id"));
  const ownerByTeam = new Map(teams.map((t) => [t.id, t.user_id ?? null]));

  const notifications = await fetchAllRows(() =>
    supabase.from("notifications")
      .select("user_id, related_id")
      .eq("type", GRADUATION_READY_TYPE)
      .in("related_id", riderIds)
      .order("related_id"));
  const delivered = new Set(notifications.map((n) => `${n.user_id}::${n.related_id}`));

  const riders = await fetchAllRows(() =>
    supabase.from("riders").select("id, firstname, lastname").in("id", riderIds).order("id"));
  const riderById = new Map(riders.map((r) => [r.id, r]));

  const missing = [];
  for (const g of pending) {
    const userId = ownerByTeam.get(g.team_id);
    if (!userId) continue;
    if (delivered.has(`${userId}::${g.rider_id}`)) continue;
    const r = riderById.get(g.rider_id);
    missing.push({
      graduationId: g.id,
      riderId: g.rider_id,
      teamId: g.team_id,
      firstname: r?.firstname ?? "",
      lastname: r?.lastname ?? "",
      name: `${r?.firstname ?? ""} ${r?.lastname ?? ""}`.trim(),
    });
  }
  return missing;
}

/**
 * Detektér-og-helbred: åbn override-vinduet for hver rytter der aldrig fik et.
 *
 * Idempotent på tre lag: (1) en rytter med en pending-række er ikke i
 * kandidatlisten, (2) dedupe sker på rytter+sæson via UNIQUE(rider_id,
 * season_id), og (3) en tabt insert-race giver "duplicate", ikke en fejl.
 * Gated på academy_enabled som alt andet akademi-maskineri.
 *
 * @param {{supabase:object, now?:Date, season?:{id:string,number:number}|null, dryRun?:boolean,
 *          isEnabled?:Function, notify?:Function, graceHours?:number}} args
 * @returns {Promise<{created:number, duplicates:number, failed:number, checked:number,
 *                    seasonNumber:number|null, candidates:object[], errors:object[], skipped?:string}>}
 */
export async function runMissedGraduateSweep({
  supabase,
  now = new Date(),
  season = null,
  dryRun = false,
  isEnabled = isAcademyEnabled,
  notify = notifyTeamOwner,
  graceHours = STUCK_GRADUATE_GRACE_HOURS,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  const empty = {
    created: 0, duplicates: 0, failed: 0, checked: 0, seasonNumber: null,
    candidates: [], errors: [], notificationsSent: 0, missingNotifications: [],
  };

  if (!(await isEnabled(supabase))) return { ...empty, skipped: "flag_off" };

  const active = season ?? await fetchActiveSeason(supabase);
  // Uden en aktiv sæson er både aldersprædikatet og season_id udefineret —
  // spring over i stedet for at gætte (samme valg som vagten).
  if (!active) return { ...empty, skipped: "no_active_season" };

  const { checked, missed } = await findMissedGraduates(supabase, { now, seasonNumber: active.number, graceHours });
  const deadline = graduationDeadlineFrom(now);
  const candidates = missed.map((c) => ({
    riderId: c.riderId,
    teamId: c.teamId,
    aiTeamId: c.aiTeamId,
    name: `${c.firstname} ${c.lastname}`,
    birthdate: c.birthdate,
    age: c.age,
    wouldCreate: { season_id: active.id, status: "pending", deadline },
  }));

  // Efter-leveringen kører FØR oprettelserne, så en række der oprettes i dette
  // tick ikke kan blive vurderet af to stier i samme kørsel. Fejler notifikationen
  // igen nu, fanger næste tick den igen.
  const missingNotifications = await findPendingWithoutNotification(supabase, { seasonId: active.id });

  if (dryRun) {
    return { ...empty, checked, seasonNumber: active.number, candidates, missingNotifications, dryRun: true };
  }

  let created = 0, duplicates = 0, failed = 0, notificationsSent = 0;
  const errors = [];

  for (const m of missingNotifications) {
    try {
      await notifyGraduationReady(supabase, {
        rider: { id: m.riderId, team_id: m.teamId, firstname: m.firstname, lastname: m.lastname },
        notify,
      });
      notificationsSent++;
    } catch (err) {
      // best-effort pr. rytter: fejlen sluges IKKE, den bæres videre i `errors`
      // og captures aggregeret i cron.js. Rækken står stadig som pending, så
      // næste tick prøver efter-leveringen igen af sig selv.
      failed++;
      errors.push({ riderId: m.riderId, teamId: m.teamId, phase: "notify_backfill", message: err?.message || String(err) });
      console.error(`missed-graduate notify backfill failed (${m.riderId}):`, err?.message || err);
    }
  }
  // Per-rytter try/catch: én rytter med et ødelagt hold må ikke koste de andre
  // deres vindue (samme isolation som graduerings-sweepets resolve-loop).
  for (const c of missed) {
    try {
      const outcome = await openGraduationWindow(supabase, {
        rider: { id: c.riderId, team_id: c.teamId, firstname: c.firstname, lastname: c.lastname },
        seasonId: active.id,
        deadline,
        notify,
      });
      if (outcome === "created") created++; else duplicates++;
    } catch (err) {
      // best-effort pr. rytter: fejlen sluges IKKE, den bæres videre i
      // `errors` og captures aggregeret i cron.js (samme mønster som
      // graduerings-sweepets resolve-loop). En Sentry-capture her ville give
      // ét issue pr. rytter pr. tick for den samme, stående tilstand.
      failed++;
      errors.push({ riderId: c.riderId, teamId: c.teamId, phase: "open_window", message: err?.message || String(err) });
      console.error(`missed-graduate sweep failed (${c.riderId}):`, err?.message || err);
    }
  }

  return {
    created, duplicates, failed, checked, seasonNumber: active.number, candidates, errors,
    notificationsSent, missingNotifications,
  };
}
