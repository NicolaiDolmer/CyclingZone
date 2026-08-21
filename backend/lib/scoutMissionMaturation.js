// #3997 — mission-modning: en "N-dags" mission skal modne ~N×24 timer efter
// AFSENDELSE, ikke ved først-kommende kl.22-sweep (ejer-ord 20/8: "Spejder-
// rapporter skal fungere som en spiller tror de gør. Ret problemet i stedet
// for at oplyse bedre om det.").
//
// FØR: missioner modnede UDELUKKENDE via den natlige kl.22-sweep (scoutSweep.js)
// og en team-dags-mutex (scout_sweep_runs, UNIQUE(team_id, tick_date)) der kun
// tillod ÉN fuldførelses-runde pr. hold pr. dag. En mission sendt kl. 09 tog
// derfor reelt 23-46 timer (afhængig af afsendelses-klokkeslæt), og et hold
// med TO missioner der begge blev due samme dag fik kun den ene færdig —
// mutexen blokerede fejlagtigt den anden til næste dag.
//
// NU: modenhed = created_at + SCOUT_JOB_CONFIG.mission.days×24 timer (ren
// elapsed-tid, samme "regel" som target allerede bruger via targetReadyAt,
// scoutEngine.js — DST-robust af sig selv, se den funktions kommentar).
// Tjekket på HVERT cron-tick (5 min, cron.js — langt hyppigere end den
// time-krævede kadence, #3997 punkt 3), ikke kun efter kl. 22. Idempotens er
// PR ASSIGNMENT via en claim-first status-conditional UPDATE (samme mønster
// som scoutTargetMaturation.lazyCompleteDueTargetAssignments) i stedet for en
// delt hold-dags-mutex — to missioner der begge modner samme dag for samme
// hold fuldføres nu BEGGE, uafhængigt af hinanden, og en assignment kan
// aldrig fuldføres to gange uanset hvor mange samtidige ticks/processer der
// rammer den (0 rækker ramt af den betingede UPDATE = allerede claimet).
//
// Eget modul (mirror af scoutTargetMaturation.js): scoutSweep.js's
// target-backstop og denne mission-modning er nu to UAFHÆNGIGE stier, hver
// med sin egen idempotens-mekanik — target beholder sin eksisterende
// kl.22-gate + team-dags-mutex (uændret, #3997 rører IKKE ved den, se
// scoutSweep.js), missioner har ingen dags-gate overhovedet.
import { SCOUT_JOB_CONFIG } from "./scoutEngine.js";
import { generateShortlist } from "./scoutMission.js";
import { getScoutState } from "./scoutAssignmentService.js";
import { notifyScoutReportReady } from "./notificationService.js"; // #2945
import { ageForSeason } from "./riderSeasonAge.js"; // #4058

// Standard kandidat-loader for missioner: alle ikke-pensionerede ryttere med
// kendt potentiale, mappet til scoutMission's forventede rider-form. Scope
// parametriseret (#2644 del 2, ejer-go 18/7): targetPool "free_agents" (default)
// eller "other_teams" — SAMME guards (ikke midt i handelsflow, ikke skjult af
// åbent akademi-intake-tilbud) gælder for begge, kun team_id-filteret vender.
//
// free_agents: team_id IS NULL — kontraktfrie ryttere (#2644 del 1, oprindelig
// scope). En rytter med pending_team_id sat er midt i et handelsflow (#1995/
// #2579) og derfor ikke reelt tilgængelig lige nu, selvom team_id (endnu) er
// NULL i overgangen — ekskluderes uanset targetPool.
// other_teams: team_id IS NOT NULL — ryttere ejet af en (anden) manager.
// Selve egen-hold-udelukkelsen sker IKKE her (denne loader kender ikke det
// kaldende holds id) men i scoutMission.js' generateShortlist via
// candidate.ownerTeamId (sat til r.team_id nedenfor for begge scopes).
//
// #2581: to hold på Discord samme morgen rapporterede rytternavne fra en
// mission-shortlist de ikke kunne søge frem noget sted. Read-only prod-audit
// (17/7) viste rytterne FAKTISK findes (0 rigtige orphans blandt 46 nogensinde
// shortlistede) — men 17/46 (37%) er lige nu skjult for ALLE ikke-admins af
// riders-RLS-policyen "Public read riders" (is_offered_intake_rider): en rytter
// der står som et UAFKLARET akademi-intake-tilbud (academy_intake.status =
// 'offered', endnu ikke accepteret/afvist af det tilbudte hold) er globalt
// usøgbar, ikke kun for det tilbudte hold. defaultLoadCandidates kendte ikke
// til akademi-intake-tilstanden og kunne derfor lægge sådan en rytter i en
// shortlist — spilleren fik et navn han reelt ikke kunne slå op nogen steder.
// Fix: ekskludér 'offered'-intake-ryttere fra kandidat-poolen (samme diskriminator
// som RLS-policyen), så missioner kun peger på faktisk søgbare ryttere. Denne
// genererings-tidspunkt-guard suppleres af et UAFHÆNGIGT view-tidspunkt-lag
// (scoutReportVisibility.js) der genkontrollerer synligheden når rapporten
// FAKTISK vises (#2623: synligheden kan ændre sig mellem de to tidspunkter).
//
// #2581 genåbnet 19/7: en NY klasse slap igennem samme hul — ryttere ejet af
// AI-hold. RidersPage skjuler dem for spillere som default (useRiderFilters.js
// .eq('owner_is_ai', false) uden show_ai), men other_teams-poolen filtrerede
// kun på team_id IS NOT NULL, ikke owner_is_ai. Samme fix-mønster: ekskludér
// owner_is_ai=true fra kandidat-poolen (no-op for free_agents — kontraktfrie
// ryttere har altid owner_is_ai=false).
// #4058: kandidat-alderen SKAL bruge sæson-alder (ageForSeason, SSOT
// riderSeasonAge.js), aldrig wall-clock — samme fejlklasse som #3071/#3081.
// seasonNumber leveres af kalderen (claimAndCompleteMission → resolveSeasonNumber,
// udledt af assignment.season_id). Mangler seasonNumber (fx en direkte-kaldt
// test uden season-kontekst), giver ageForSeason null tilbage — en manglende
// alder er bedre end en forkert (samme kontrakt som frontend/src/lib/riderAge.js).
export async function defaultLoadCandidates(supabase, targetPool = "free_agents", seasonNumber = null) {
  let ridersQuery = supabase
    .from("riders")
    // #3657: primary_type tilføjet — driver den nye scope:"type"-targeting i
    // scoutMission.filterCandidatePool (allerede beregnet af riderTypes.js,
    // ingen ny kolonne).
    .select("id, potentiale, birthdate, nationality_code, team_id, primary_type, is_retired, team:team_id(league_division_id)")
    .eq("is_retired", false)
    .eq("owner_is_ai", false) // #2581: AI-ejede ryttere er skjulte for spillere i RidersPage
    .not("potentiale", "is", null)
    .is("pending_team_id", null); // #2644: ikke midt i et handelsflow, uanset scope

  ridersQuery = targetPool === "other_teams"
    ? ridersQuery.not("team_id", "is", null) // #2644 del 2: kun ryttere PÅ et hold
    : ridersQuery.is("team_id", null); // free_agents (default): kun kontraktfrie

  const [{ data, error }, { data: offered, error: intakeError }] = await Promise.all([
    ridersQuery,
    supabase.from("academy_intake").select("rider_id").eq("status", "offered"),
  ]);
  if (error) throw new Error(`scoutMissionMaturation: candidate riders load failed: ${error.message}`);
  if (intakeError) throw new Error(`scoutMissionMaturation: offered-intake load failed: ${intakeError.message}`);
  const offeredIntakeRiderIds = new Set((offered ?? []).map((r) => r.rider_id));
  return (data ?? [])
    .filter((r) => !offeredIntakeRiderIds.has(r.id))
    .map((r) => ({
      id: r.id,
      potentiale: r.potentiale,
      divisionId: r.team?.league_division_id ?? null,
      country: r.nationality_code ?? null,
      age: ageForSeason(r.birthdate, seasonNumber), // #4058: sæson-alder, ikke wall-clock
      isNmEligible: true,
      primaryType: r.primary_type ?? null, // #3657: scope:"type"-targeting
      // #2581/#2644: for free_agents er ownerTeamId ALTID null (kandidat-poolen
      // er begrænset til kontraktfrie ryttere ovenfor); for other_teams er det
      // rytterens FAKTISKE ejerhold — generateShortlist bruger det til at
      // ekskludere holdets EGNE ryttere fra dets egen mission-shortlist.
      ownerTeamId: r.team_id ?? null,
    }));
}

// getScoutState-genbrug (mirror af den gamle scoutSweep.js' defaultGetScout):
// mission-shortlisten skal vide hvilken spejder (reach/evaluation) holdet har.
async function defaultGetScout(supabase, teamId) {
  const { scout } = await getScoutState(teamId, supabase);
  return scout;
}

// #4058: sæson-NUMMERET (ageForSeason's andet argument) for en given assignment.
// Foretrækker assignment.season_id (sat ved mission-start, scoutAssignmentService.
// startMission) — falder tilbage til den AKTIVE sæson for assignments startet FØR
// season_id blev sporet (bagudkompatibelt, samme mønster som targetPool ovenfor).
// Returnerer null hvis ingen sæson kan slås op (ageForSeason giver da null videre,
// aldrig et gættet wall-clock-tal).
async function resolveSeasonNumber(supabase, seasonId) {
  if (seasonId) {
    const { data, error } = await supabase.from("seasons").select("number").eq("id", seasonId).maybeSingle();
    if (error) throw new Error(`scoutMissionMaturation: season lookup failed for ${seasonId}: ${error.message}`);
    if (data?.number != null) return data.number;
  }
  const { data: active, error: activeError } = await supabase
    .from("seasons")
    .select("number")
    .eq("status", "active")
    .maybeSingle();
  if (activeError) throw new Error(`scoutMissionMaturation: active season lookup failed: ${activeError.message}`);
  return active?.number ?? null;
}

// #4058: rider_id'er holdet ALLEREDE har en scout_actions-række på — fra en
// tidligere mission-shortlist ELLER en target-undersøgelse (begge skriver til
// samme ledger, #1543/scouting.js). Bruges til at ekskludere gentagne fund fra
// fremtidige mission-shortlists for samme hold (jeppek 20/8: Carlos Lozano i
// 2 separate U23-shortlists for samme hold på 2 dage).
async function defaultLoadAlreadyScoutedRiderIds(supabase, teamId) {
  const { data, error } = await supabase.from("scout_actions").select("rider_id").eq("team_id", teamId);
  if (error) throw new Error(`scoutMissionMaturation: scout_actions load failed for ${teamId}: ${error.message}`);
  return new Set((data ?? []).map((r) => r.rider_id));
}

// Claim-first atomisk fuldførelse af ÉN due mission. Shortlisten beregnes FØR
// claimet (ren læsning — deterministisk pr. missionId/teamId/riderId via
// seededUnit, se scoutMission.js, så et redundant dobbelt-beregnet resultat
// ved et kapløb er harmløst). Selve DB-MUTATIONEN (scout_actions-insert +
// status→completed) sker KUN hvis den betingede UPDATE (.eq("status","active"))
// rent faktisk rammer rækken — taber et kapløb (0 rækker ramt), skrives intet,
// og notify() kaldes ikke. En mission kan derfor ALDRIG give to rapporter
// (#3997 punkt 3), uanset hvor mange samtidige ticks/processer der rammer den.
async function claimAndCompleteMission({ supabase, assignment, loadCandidates, getScout, loadAlreadyScoutedRiderIds, now, notify }) {
  // #2644 del 2: sweepen læser targetPool fra selve assignmentens mission_criteria
  // (sat ved start, scoutAssignmentService.startMission) — bagudkompatibel
  // default "free_agents" for assignments der blev startet FØR denne feature.
  const targetPool = assignment.mission_criteria?.targetPool ?? "free_agents";
  const seasonNumber = await resolveSeasonNumber(supabase, assignment.season_id); // #4058
  const [candidates, scout, excludeRiderIds] = await Promise.all([
    loadCandidates(supabase, targetPool, seasonNumber),
    getScout(supabase, assignment.team_id),
    loadAlreadyScoutedRiderIds(supabase, assignment.team_id), // #4058
  ]);
  const { shortlist, topRiderId } = generateShortlist({
    candidates,
    criteria: assignment.mission_criteria,
    scout,
    teamId: assignment.team_id,
    missionId: assignment.id,
    excludeRiderIds,
  });
  const result = { shortlist, top_rider_id: topRiderId };

  const { data: claimed, error: claimErr } = await supabase
    .from("scout_assignments")
    .update({ status: "completed", completed_at: now.toISOString(), result })
    .eq("id", assignment.id)
    .eq("status", "active")
    .select("id");
  if (claimErr) throw new Error(`scout_assignments claim (mission): ${claimErr.message}`);
  if (!claimed || claimed.length === 0) return { completed: false };

  // #3652 (spillerønske 11/8): HELE shortlisten (3-5 ryttere) får en gratis
  // niveau-1-rapport, samme scout_actions-mekanik som altid — kun skrevet af
  // den proces der VANDT claimet ovenfor.
  if (shortlist.length > 0) {
    const rows = shortlist.map((riderId) => ({
      team_id: assignment.team_id,
      rider_id: riderId,
      season_id: assignment.season_id ?? null,
    }));
    const { error: insErr } = await supabase.from("scout_actions").insert(rows);
    if (insErr) throw new Error(`scout_actions insert (mission shortlist reports): ${insErr.message}`);
  }

  // #2945: notify() kaldes EFTER claimet + scout_actions er bekræftet —
  // notifyScoutReportReady isolerer selv sine fejl (kaster aldrig), `notify`
  // injicérbar for test.
  await notify({ supabase, assignment: { ...assignment, status: "completed", result }, now });
  return { completed: true };
}

/**
 * Sweep-bredt (alle hold): fuldfør alle due missioner (created_at +
 * SCOUT_JOB_CONFIG.mission.days×24t <= now). Kaldt på HVERT cron-tick
 * (scoutSweep.js → cron.js, 5 min — langt hyppigere end den time-krævede
 * kadence, #3997 punkt 3) — ingen egen dags-gate, i modsætning til
 * target-backstoppets kl.22-vindue (scoutSweep.js, uændret).
 *
 * @returns {Promise<{completed: number, failed?: number}>}
 */
export async function completeDueMissionAssignments({
  supabase,
  now = new Date(),
  days = SCOUT_JOB_CONFIG.mission.days,
  loadCandidates = defaultLoadCandidates,
  getScout = defaultGetScout,
  loadAlreadyScoutedRiderIds = defaultLoadAlreadyScoutedRiderIds, // #4058, injicérbar for test
  notify = notifyScoutReportReady, // #2945, injicérbar for test
}) {
  const dueBefore = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data: due, error } = await supabase
    .from("scout_assignments")
    .select("*")
    .eq("status", "active")
    .eq("kind", "mission")
    .lte("created_at", dueBefore);
  if (error) throw new Error(`scout_assignments (due missions): ${error.message}`);

  let completed = 0;
  let failed = 0;
  for (const assignment of due ?? []) {
    try {
      const outcome = await claimAndCompleteMission({ supabase, assignment, loadCandidates, getScout, loadAlreadyScoutedRiderIds, now, notify });
      if (outcome.completed) completed += 1;
    } catch (err) {
      // best-effort: per-mission try/catch isolerer én fejlende assignment fra
      // resten (mirror af den gamle scoutSweep.js' per-hold-isolering). `failed`
      // tælles op og logges her; runScoutSweepCron (cron.js) capturer AGGREGERET
      // pr. tick (én Sentry-issue frem for pr. mission).
      failed += 1;
      console.error(`  ❌ mission-modning fejlede for assignment ${assignment.id}:`, err.message);
    }
  }
  return failed > 0 ? { completed, failed } : { completed };
}
