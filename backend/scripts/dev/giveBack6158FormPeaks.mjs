// #6158 · Giv formtoppe brugt uden virkning under v4 tilbage til managerne.
//
// Spec: docs/superpowers/specs/2026-10-04-form-og-formtoppe-i-v4-design.md §4.
// Ejer-valg 4/10 (kort 2): toppene gives tilbage. Køres SAMMEN med tændingen af
// #6156 (form + toppe i v4), ikke før. Prod-skrivning kun efter ordret ejer-go på
// dry-run-tallene, og ejeren ser tilstanden live først.
//
// REGLEN (spec §4)
//   En top gives tilbage, hvis den ikke kan have fået virkning:
//   A) dens vindue startede fra S4's start og frem til tændingen, eller
//   B) dens målløb er startet før tændingen (løbet kører færdigt uden form,
//      ejer-beslutning 4), uanset hvor vinduet ligger.
//   Ingen top må både tælle i et løb og gives tilbage: har et løb der startede
//   EFTER tændingen allerede kørt en etape med rytteren inde i vinduet, har toppen
//   virket og beholdes ("talt"). Tilbagegivne toppe udløser intet dyk.
//
// HVORDAN EN TOP BLIVER PLANLÆGBAR IGEN (afklaret 7/10, læst i koden)
//   - Kvoten (riderPeakPlans.MAX_PEAK_PLANS_PER_SEASON) tælles som antal RÆKKER i
//     rider_peak_plans for (rytter, sæson) i POST /peak-plans og /peak-plans/bulk.
//   - Låsen er ikke en kolonne der kan slås fra: riderPeakPlans.isPlanLocked
//     udleder den ved læse-tid fra window_start (nu >= window_start), og
//     lockGuardForWrite stempler locked_at ved første skriveforsøg derefter.
//   - Motoren og dykket læser vinduet fra SAMME række (racePeakPlans.loadPeakPlans
//     henter alle rytterens vinduer i sæsonen; dykket ligger i dagene efter
//     window_end, racePeaks.peakPhaseForWindow).
//   Derfor er "giv tilbage" = slet rækken (efter backup). Det frigiver pladsen i
//   kvoten, fjerner låsen sammen med rækken, og der findes intet vindue at give et
//   dyk efter. Alternativerne frigiver ikke pladsen: at nulle target_race_id
//   efterlader en række der stadig tæller i kvoten (og som motoren springer over,
//   #4294), og at flytte window_start frem ville være et vindue ingen manager har
//   valgt. Manageren opretter derefter en ny plan som normalt: målet skal være et
//   seniorløb i holdets kalender der ikke er startet (#5992), og rytteren skal stå
//   i seniortruppen. Det samme målløb kan vælges igen, hvis det ikke er startet
//   (UNIQUE(rider, season, target) rammer ikke, rækken er væk); vinduet snappes så
//   igen om løbet og er låst fra sin startdato som alle andre planer.
//
// DEL B: NEDGANGEN EFTER EN TOP UDEN BONUS (ejer 17/10)
//   Ejeren: rytterne må ikke bære formdykket efter en top, der aldrig gav bonus.
//   Læst i koden 17/10 (verificeret, ikke antaget):
//   - Dykket gemmes ALDRIG i rider_condition.form. Det regnes ved løbstid ud fra
//     selve planrækken (racePeaks.peakPhaseForWindow: dagene efter window_end) og
//     lægges kun ind i v3-scoren (raceSimulator). Planlæggeren viser det samme
//     "formhul" ud fra rækken (plannerBoard.findPaybackCollisions).
//   - Under v4 smider broen vinduerne væk, og formen v4 ser er rytterens rå form
//     UDEN top og UDEN dyk (raceEngineV4Bridge.riderFormForV4, ejer 10/10).
//   Derfor måler scriptet dykket i stedet for at gætte: for hver plan findes de
//   kørte etaper hvor rytteren stod i nedgangen, og for hver etape læses hvad
//   motoren faktisk lagde på (race_simulation_rider_scores.components.peak < 0).
//   - "Formjustering pr. rytter" = det målte, anvendte dyk. Der er intet at rette
//     i rider_condition (dykket bor der ikke).
//   - Et dyk der stadig ligger foran (vinduet sluttede for nylig eller ligger
//     senere) fjernes ved at rækken slettes (del A). Scriptet tjekker at INGEN
//     plan med nedgang foran bliver stående.
//   - Er der målt et anvendt dyk i et kørt resultat, afbryder apply: historiske
//     resultater røres ikke uden særskilt ejer-beslutning (#6156).
//
// HVAD SCRIPTET GØR
//   Standard (ingen flag): READ-ONLY dry-run. Ingen skrivning til databasen.
//     Skriver en PRIVAT rapport (rytter-id'er, holdnavne, tal) + json + snapshot-
//     SQL + restore-SQL + kort (html) til balance-internals/6158/ (gitignoreret).
//     Konsollen får kun samlede tal og liste-hashen.
//   --ignition=<ISO>|next-season|now: tidspunktet hvor formtoppe virker igen.
//     Default next-season (ejer 10/10: formtoppe tændes ved næste sæsons start,
//     midnat dansk tid på seasons.start_date). "now" giver en prognose for i dag.
//   --backup-date=YYYYMMDD: dato-suffiks på backup-tabellen backup_6158_<dato>.
//     Default dagens danske dato i dry-run; KRÆVET ved apply (samme som snapshot).
//   --apply --owner-go=6158-production --approved-list=<hash> --ignition=<...> --backup-date=<dato>:
//     sletter præcis de godkendte planer. Afbryder FØR første skrivning, hvis den
//     levende liste afviger fra den godkendte (hash), hvis backup-tabellen ikke
//     dækker alle planer, hvis et dyk er målt anvendt i et kørt resultat, eller
//     hvis en plan med nedgang foran ikke er på listen.
//     Idempotent: hashen dækker "levende kandidater + allerede tilbagegivne"
//     (i backup, ikke længere i tabellen), og hver tilbagegivet række stemples
//     given_back_at i backuppen (kvittering). Post-verify: ingen godkendt plan
//     findes mere, alle er kvitteret, og en ny indlæsning har intet at give tilbage.
//
// SCOPE
//   Kun den aktive sæson (S4) og kun ryttere på menneskehold (ikke bank, ikke
//   frosset, ikke testkonto, samme ejendomsfilter som #5864). Planer uden for scope
//   og planer uden målløb listes separat og røres ikke.
//
//   node backend/scripts/dev/giveBack6158FormPeaks.mjs
//   node backend/scripts/dev/giveBack6158FormPeaks.mjs --ignition=2026-10-12T08:00:00+02:00
//   node backend/scripts/dev/giveBack6158FormPeaks.mjs --apply --owner-go=6158-production --approved-list=<hash> --ignition=next-season --backup-date=<YYYYMMDD>

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows, fetchAllRowsChunkedIn } from "../../lib/supabasePagination.js";
import { copenhagenDateString, copenhagenHourToUTC } from "../../lib/copenhagenTime.js";
import { dateStringToOrdinal, scheduledAtToOrdinal } from "../../lib/racePeakPlans.js";
import { peakPhaseForWindow, resolvePeakPhase } from "../../lib/racePeaks.js";
import { RACE_V3_TUNING } from "../../lib/raceRoles.js";
import { peakTargetRaceStarted, plannerSquadFor } from "../../lib/peakTargetScope.js";
import { MAX_PEAK_PLANS_PER_SEASON } from "../../lib/riderPeakPlans.js";
import { scoreComponentToFormPoints } from "../../lib/plannerBoard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "../../..");
export const PRIVATE_DIR = join(REPO_ROOT, "balance-internals", "6158");

export const OWNER_GO_FLAG = "--owner-go=6158-production";
export const IGNITION_NEXT_SEASON = "next-season";
export const IGNITION_NOW = "now";

/** Backup-/kvitteringstabellen: backup_6158_<YYYYMMDD> (ejer 17/10). */
export function backupTableName(backupDate) {
  if (!/^\d{8}$/.test(String(backupDate ?? ""))) throw new Error("--backup-date must be YYYYMMDD");
  return `backup_6158_${backupDate}`;
}

/** Dagens danske dato som YYYYMMDD (default backup-dato i dry-run). */
export function defaultBackupDate(now = new Date()) {
  return copenhagenDateString(now).replace(/-/g, "");
}

const PLAN_COLUMNS = "id, rider_id, season_id, target_race_id, window_start, window_end, locked_at, created_at";
const RIDER_COLUMNS = "id, firstname, lastname, team_id, squad, is_academy, is_retired";
const TEAM_COLUMNS = "id, name, is_ai, is_frozen, is_bank, is_test_account, parked_at, retired_at";
const RACE_COLUMNS = "id, name, season_id, status, stages, stages_completed, squad";
// Kvoten hentes fra koden, ikke hardkodet i restore-SQL'en (én kilde).
const RIDER_PLAN_QUOTA_SQL = String(MAX_PEAK_PLANS_PER_SEASON);

// ── Argumenter ──────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const opts = { apply: false, ownerGo: false, approvedHash: null, ignition: null, backupDate: null };
  for (const arg of argv) {
    if (arg === "--apply") opts.apply = true;
    else if (arg === OWNER_GO_FLAG) opts.ownerGo = true;
    else if (arg.startsWith("--owner-go=")) throw new Error("Wrong owner-go token");
    else if (arg.startsWith("--approved-list=")) {
      const h = arg.slice("--approved-list=".length);
      if (!/^[a-f0-9]{64}$/.test(h)) throw new Error("--approved-list must be the 64-char list hash printed by the dry-run");
      opts.approvedHash = h;
    } else if (arg.startsWith("--ignition=")) {
      const raw = arg.slice("--ignition=".length);
      if (raw === IGNITION_NEXT_SEASON || raw === IGNITION_NOW) {
        opts.ignition = raw;
        continue;
      }
      const ms = Date.parse(raw);
      if (!raw || !Number.isFinite(ms)) throw new Error(`--ignition must be an ISO timestamp (e.g. 2026-10-12T08:00:00+02:00), ${IGNITION_NEXT_SEASON} or ${IGNITION_NOW}`);
      opts.ignition = new Date(ms).toISOString();
    } else if (arg.startsWith("--backup-date=")) {
      opts.backupDate = arg.slice("--backup-date=".length);
      backupTableName(opts.backupDate); // validerer
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (opts.ownerGo && !opts.apply) throw new Error("--owner-go only makes sense together with --apply");
  if (opts.apply && !opts.ownerGo) throw new Error(`--apply requires ${OWNER_GO_FLAG} (owner must have seen the live list)`);
  if (opts.apply && opts.approvedHash === null) {
    throw new Error("--apply requires --approved-list=<list hash from the dry-run the owner approved>");
  }
  if (opts.apply && (opts.ignition === null || opts.ignition === IGNITION_NOW)) {
    throw new Error(`--apply requires an explicit --ignition=<ISO> or --ignition=${IGNITION_NEXT_SEASON} (the same one the approved dry-run used)`);
  }
  if (opts.apply && opts.backupDate === null) {
    throw new Error("--apply requires --backup-date=YYYYMMDD (the date of the snapshot that was taken)");
  }
  return opts;
}

// ── Rene klassifikationer ───────────────────────────────────────────────────

/** Samme ejendomsfilter som #5864 + kun menneskehold. */
export function isInScopeTeam(team) {
  return !!team && team.is_ai === false && team.is_bank === false && team.is_frozen === false && team.is_test_account === false;
}

/** Hvorfor en plan er uden for scope (eller null hvis den er med). */
export function outOfScopeReason(rider, team) {
  if (!rider) return "rider_missing";
  if (rider.is_retired === true) return "retired_rider";
  if (!team) return "no_team";
  if (team.is_ai !== false) return "ai_team";
  if (team.is_bank) return "bank";
  if (team.is_test_account) return "test_account";
  if (team.is_frozen) return "frozen";
  return null;
}

/** Tidligste etape-tidspunkt pr. løb fra race_stage_schedule-rækker. */
export function firstStageAtByRace(scheduleRows) {
  const out = new Map();
  for (const row of scheduleRows || []) {
    const ms = Date.parse(row?.scheduled_at);
    if (!row?.race_id || !Number.isFinite(ms)) continue;
    const prev = out.get(row.race_id);
    if (prev == null || ms < prev) out.set(row.race_id, ms);
  }
  return out;
}

/**
 * Er målløbet startet før tændingen? Etapeplanen afgør (første etape før
 * tændingstidspunktet), så en prognose med en fremtidig tænding også fanger løb
 * der når at starte inden. Uden etapeplan falder vi tilbage på løbets status
 * (peakTargetRaceStarted, samme definition som planlæggeren, #5992).
 */
export function targetStartedBeforeIgnition(race, firstStageMs, ignitionMs) {
  if (firstStageMs != null) return firstStageMs < ignitionMs;
  return peakTargetRaceStarted(race);
}

/**
 * Har toppen TALT i et løb efter tændingen? `postIgnitionStages` er kørte etaper
 * (rytter, CET-dag-ordinal) i løb hvis første etape ligger på eller efter
 * tændingen, altså løb der kører på de nye regler. En etape inde i vinduet =
 * toppen har virket. En etape i dagene lige efter vinduet = dykket er allerede
 * mærket (kun informativt; toppen har så alligevel ikke virket).
 */
export function countedAfterIgnition(plan, stagesForRider, paybackDays = RACE_V3_TUNING.PEAK_PAYBACK_DAYS) {
  const start = dateStringToOrdinal(plan.window_start);
  const end = dateStringToOrdinal(plan.window_end);
  const res = { counted: false, countedRaceIds: [], dipFelt: false };
  if (start == null || end == null) return res;
  for (const s of stagesForRider || []) {
    const phase = peakPhaseForWindow(s.dayOrdinal, start, end, paybackDays);
    if (phase === "peak") {
      res.counted = true;
      if (!res.countedRaceIds.includes(s.raceId)) res.countedRaceIds.push(s.raceId);
    } else if (phase === "payback") res.dipFelt = true;
  }
  return res;
}

/**
 * Byg hele planen ud fra rå, allerede-hentede rækker. Ren funktion (ingen I/O).
 *
 * @param {object} p
 * @param {{id:string, number:number, start_date:string}} p.season
 * @param {object[]} p.plans                 rider_peak_plans for sæsonen
 * @param {Map<string,object>} p.ridersById
 * @param {Map<string,object>} p.teamsById
 * @param {Map<string,object>} p.racesById   målløbene
 * @param {Map<string,number>} p.firstStageMs race_id → første etapes tidspunkt (ms)
 * @param {Map<string,Array<{raceId:string, dayOrdinal:number}>>} p.postIgnitionStagesByRider
 * @param {string[]} [p.alreadyGivenBackIds]  i backup, ikke længere i tabellen
 * @param {string} p.ignitionAt              ISO
 */
export function buildPlan({ season, plans, ridersById, teamsById, racesById, firstStageMs, postIgnitionStagesByRider, alreadyGivenBackIds = [], ignitionAt }) {
  const ignitionMs = Date.parse(ignitionAt);
  if (!Number.isFinite(ignitionMs)) throw new Error("ignitionAt must be a valid timestamp");
  const ignitionDay = dateStringToOrdinal(copenhagenDateString(new Date(ignitionMs)));
  const seasonStartDay = dateStringToOrdinal(season?.start_date);
  if (seasonStartDay == null) throw new Error("Active season has no start_date");

  const rows = [];
  const outOfScope = [];
  const orphans = [];
  for (const p of plans || []) {
    const rider = ridersById.get(p.rider_id) || null;
    const team = rider?.team_id ? teamsById.get(rider.team_id) || null : null;
    const reason = outOfScopeReason(rider, team);
    if (reason) {
      outOfScope.push({ planId: p.id, riderId: p.rider_id, teamId: rider?.team_id ?? null, reason });
      continue;
    }
    if (!p.target_race_id) {
      // Kan ikke have virket (motoren springer den over, #4294), men falder uden for
      // ejerens to regler. Listes til ejeren, røres ikke.
      orphans.push({ planId: p.id, riderId: p.rider_id, teamId: rider.team_id });
      continue;
    }
    const race = racesById.get(p.target_race_id) || null;
    const windowStart = dateStringToOrdinal(p.window_start);
    const windowStarted = windowStart != null && windowStart >= seasonStartDay && windowStart <= ignitionDay;
    const targetStarted = targetStartedBeforeIgnition(race, firstStageMs.get(p.target_race_id) ?? null, ignitionMs);
    const c = countedAfterIgnition(p, postIgnitionStagesByRider.get(p.rider_id));
    const rules = [];
    if (windowStarted) rules.push("window_started");
    if (targetStarted) rules.push("target_started");

    let outcome = "keep_will_work";
    if (c.counted) outcome = "keep_counted_after_ignition";
    else if (rules.length) outcome = "give_back";

    const stages = Number(race?.stages) || 0;
    const done = Number(race?.stages_completed) || 0;
    rows.push({
      planId: p.id,
      riderId: p.rider_id,
      name: `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim(),
      teamId: rider.team_id,
      targetRaceId: p.target_race_id,
      targetRaceName: race?.name ?? null,
      windowStart: p.window_start,
      windowEnd: p.window_end,
      lockedAt: p.locked_at ?? null,
      rules,
      outcome,
      countedRaceIds: c.countedRaceIds,
      dipFelt: c.dipFelt,
      // Følgeeffekt til go-kortet: målløbet var i gang ved tændingen (etapeløb).
      targetInProgressAtIgnition: targetStarted && stages > 1 && done < stages,
      // Planlægbar igen? Pladsen frigives altid; det samme mål kan kun vælges igen
      // hvis det ikke er startet, og kun en seniorrytter kan planlægges.
      riderSeniorNow: plannerSquadFor(rider) === "senior",
      sameTargetReplannable: !targetStarted,
    });
  }

  const giveBack = rows.filter((r) => r.outcome === "give_back");
  const teams = new Map();
  for (const r of giveBack) {
    if (!teams.has(r.teamId)) {
      const t = teamsById.get(r.teamId);
      teams.set(r.teamId, { teamId: r.teamId, name: t?.name ?? null, parked: t?.parked_at != null, plans: 0, riders: new Set() });
    }
    const t = teams.get(r.teamId);
    t.plans++;
    t.riders.add(r.riderId);
  }
  const teamList = [...teams.values()].map((t) => ({ ...t, riders: t.riders.size }));

  const totals = {
    ignitionAt: new Date(ignitionMs).toISOString(),
    seasonNumber: season.number,
    seasonStart: season.start_date,
    plansInSeason: (plans || []).length,
    outOfScope: outOfScope.length,
    outOfScopeByReason: countBy(outOfScope, (x) => x.reason),
    orphansNoTarget: orphans.length,
    inScope: rows.length,
    giveBack: giveBack.length,
    giveBackByRule: {
      window_started_only: giveBack.filter((r) => r.rules.length === 1 && r.rules[0] === "window_started").length,
      target_started_only: giveBack.filter((r) => r.rules.length === 1 && r.rules[0] === "target_started").length,
      both: giveBack.filter((r) => r.rules.length === 2).length,
    },
    keepCountedAfterIgnition: rows.filter((r) => r.outcome === "keep_counted_after_ignition").length,
    keepWillWork: rows.filter((r) => r.outcome === "keep_will_work").length,
    giveBackLocked: giveBack.filter((r) => r.lockedAt != null).length,
    giveBackTargetInProgress: giveBack.filter((r) => r.targetInProgressAtIgnition).length,
    giveBackDipAlreadyFelt: giveBack.filter((r) => r.dipFelt).length,
    giveBackRiderNotSenior: giveBack.filter((r) => !r.riderSeniorNow).length,
    giveBackSameTargetReplannable: giveBack.filter((r) => r.sameTargetReplannable).length,
    giveBackRiders: new Set(giveBack.map((r) => r.riderId)).size,
    giveBackTeams: teamList.length,
    giveBackTeamsParked: teamList.filter((t) => t.parked).length,
    alreadyGivenBack: alreadyGivenBackIds.length,
  };
  return { rows, teams: teamList, outOfScope, orphans, alreadyGivenBackIds: [...alreadyGivenBackIds], totals };
}

function countBy(list, keyFn) {
  const out = {};
  for (const x of list) {
    const k = keyFn(x);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/** Plan-id'er apply sletter (levende kandidater). */
export function giveBackIds(plan) {
  return plan.rows.filter((r) => r.outcome === "give_back").map((r) => r.planId);
}

/**
 * Fingeraftryk af præcis den plan-mængde ejeren har set: levende kandidater +
 * allerede tilbagegivne (fra et tidligere, evt. afbrudt apply). Rækkefølge-
 * uafhængig. En plan der er kommet til, faldet ud eller er begyndt at tælle siden
 * dry-run'et giver en ny hash, og apply afbryder.
 */
export function approvedListHash(plan) {
  const ids = [...new Set([...giveBackIds(plan), ...plan.alreadyGivenBackIds].map(String))].sort();
  return createHash("sha256").update(ids.join("\n")).digest("hex");
}

// ── Del B: nedgangen efter en top uden bonus ───────────────────────────────

/**
 * Mål nedgangen (dykket) for hver plan i scope. Ren funktion.
 *
 * For hver plan med målløb: hvilke KØRTE etaper stod rytteren til start på i
 * nedgangen (resolvePeakPhase over alle rytterens vinduer = "payback"; et andet
 * aktivt vindue samme dag vinder, som i motoren), og hvad lagde motoren faktisk
 * på (peak-komponenten < 0 i den seneste kørsel af etapen)? Og ligger nedgangen
 * stadig foran (slutter i dag eller senere)?
 *
 * @param {object} p
 * @param {object[]} p.rows   buildPlan(...).rows (kun planer i scope med målløb)
 * @param {Map<string,Array<{raceId:string, stageNumber:number, dayOrdinal:number}>>} p.seasonStagesByRider  kørte etaper i sæsonen
 * @param {Map<string,{runId:string, engineVersion:number|null}>} p.latestRunByStage  `${raceId}:${stageNumber}` → seneste kørsel
 * @param {Map<string,number>} p.peakComponentByRunRider  `${runId}:${riderId}` → components.peak
 * @param {number} p.todayOrdinal  dansk kalenderdag-ordinal for "nu"
 * @param {number} [p.paybackDays]
 */
export function assessDip({ rows, seasonStagesByRider, latestRunByStage, peakComponentByRunRider, todayOrdinal, paybackDays = RACE_V3_TUNING.PEAK_PAYBACK_DAYS, tuning = RACE_V3_TUNING }) {
  const windowsByRider = new Map();
  for (const r of rows || []) {
    const start = dateStringToOrdinal(r.windowStart);
    const end = dateStringToOrdinal(r.windowEnd);
    if (start == null || end == null) continue;
    if (!windowsByRider.has(r.riderId)) windowsByRider.set(r.riderId, []);
    windowsByRider.get(r.riderId).push({ planId: r.planId, start, end });
  }

  const perPlan = [];
  for (const r of rows || []) {
    const end = dateStringToOrdinal(r.windowEnd);
    if (end == null) continue;
    const pbStart = end + 1;
    const pbEnd = end + paybackDays;
    const others = windowsByRider.get(r.riderId) || [];
    let stagesRun = 0;
    let stagesApplied = 0;
    let appliedSum = 0;
    const engineVersions = new Set();
    for (const s of seasonStagesByRider.get(r.riderId) || []) {
      if (s.dayOrdinal < pbStart || s.dayOrdinal > pbEnd) continue;
      // Et andet vindue samme dag vinder over nedgangen (samme regel som motoren).
      if (resolvePeakPhase(s.dayOrdinal, others, paybackDays) !== "payback") continue;
      stagesRun++;
      const run = latestRunByStage.get(`${s.raceId}:${s.stageNumber}`) || null;
      if (run) engineVersions.add(run.engineVersion ?? "unknown");
      const comp = run ? Number(peakComponentByRunRider.get(`${run.runId}:${r.riderId}`)) : NaN;
      if (Number.isFinite(comp) && comp < 0) {
        stagesApplied++;
        appliedSum += comp;
      }
    }
    let paybackStatus = "ahead";
    if (pbEnd < todayOrdinal) paybackStatus = "lapsed";
    else if (pbStart <= todayOrdinal) paybackStatus = "active";
    perPlan.push({
      planId: r.planId,
      riderId: r.riderId,
      teamId: r.teamId,
      outcome: r.outcome,
      paybackStatus,
      dipStagesRun: stagesRun,
      dipStagesApplied: stagesApplied,
      dipAppliedScore: appliedSum,
      engineVersions: [...engineVersions].map(String).sort(),
      // Nedgangen ligger foran (eller er i gang) og fjernes kun, hvis rækken slettes.
      dipAheadRemovedByGiveBack: paybackStatus !== "lapsed" && r.outcome === "give_back",
      // En beholdt plan har (eller faar) sin bonus, saa dens nedgang er fortjent.
      dipAheadWithBonus: paybackStatus !== "lapsed" && r.outcome !== "give_back",
    });
  }

  // Kun nedgang efter en top UDEN bonus (tilbagegivne planer) tæller som "formstraf
  // for intet". En beholdt top har (eller får) sin bonus, så dens dyk er fortjent.
  const riders = new Map();
  for (const p of perPlan) {
    if (p.outcome !== "give_back") continue;
    if (!riders.has(p.riderId)) riders.set(p.riderId, { riderId: p.riderId, teamId: p.teamId, dipAppliedScore: 0, dipStagesApplied: 0, dipAhead: false });
    const x = riders.get(p.riderId);
    x.dipAppliedScore += p.dipAppliedScore;
    x.dipStagesApplied += p.dipStagesApplied;
    if (p.paybackStatus !== "lapsed") x.dipAhead = true;
  }
  const riderList = [...riders.values()].map((x) => ({
    ...x,
    // Formjusteringen = det målte, anvendte dyk med modsat fortegn (i formpoint).
    // rider_condition.form røres ikke: dykket gemmes aldrig der.
    formAdjustmentPoints: x.dipAppliedScore < 0 ? scoreComponentToFormPoints(-x.dipAppliedScore, tuning) : 0,
    riderConditionDelta: 0,
  }));

  const totals = {
    plansAssessed: perPlan.length,
    plansLapsed: perPlan.filter((p) => p.paybackStatus === "lapsed").length,
    plansActive: perPlan.filter((p) => p.paybackStatus === "active").length,
    plansAhead: perPlan.filter((p) => p.paybackStatus === "ahead").length,
    dipStagesRun: perPlan.reduce((s, p) => s + p.dipStagesRun, 0),
    dipStagesApplied: perPlan.reduce((s, p) => s + p.dipStagesApplied, 0),
    ridersWithDipStagesRun: new Set(perPlan.filter((p) => p.dipStagesRun > 0).map((p) => p.riderId)).size,
    ridersWithDipApplied: riderList.filter((x) => x.dipStagesApplied > 0).length,
    ridersNeedingFormAdjustment: riderList.filter((x) => x.formAdjustmentPoints).length,
    ridersCarryingDipAhead: riderList.filter((x) => x.dipAhead).length,
    plansDipAheadRemovedByGiveBack: perPlan.filter((p) => p.dipAheadRemovedByGiveBack).length,
    plansDipAheadWithBonus: perPlan.filter((p) => p.dipAheadWithBonus).length,
    // Dyk uden bonus der faktisk er lagt paa et koert resultat (kun tilbagegivne planer).
    dipWithoutBonusStagesApplied: perPlan.filter((p) => p.outcome === "give_back").reduce((s, p) => s + p.dipStagesApplied, 0),
    engineVersionsSeen: [...new Set(perPlan.flatMap((p) => p.engineVersions))].sort(),
  };
  return { perPlan, riders: riderList, totals };
}

/** Hvorfor apply ikke må køre ud fra del B (tom liste = ok). */
export function dipApplyBlockers(dip) {
  const out = [];
  if (dip.totals.dipWithoutBonusStagesApplied > 0) {
    out.push(`A dip without bonus was applied in ${dip.totals.dipWithoutBonusStagesApplied} finished rider-stages; historical results need a separate owner decision (#6156). Nothing was written.`);
  }
  return out;
}

// ── SQL: snapshot + restore ────────────────────────────────────────────────

function assertBackupTable(table) {
  if (!/^backup_6158_\d{8}$/.test(String(table))) throw new Error("Unexpected backup table name: ${table}");
}

function uuidList(ids) {
  for (const id of ids) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new Error(`Unexpected plan id format: ${id}`);
  }
  return ids.map((id) => `'${id}'`).join(",\n  ");
}

/**
 * Snapshot-SQL (køres FØR apply, fx via Supabase MCP execute_sql efter ejer-go).
 * Idempotent: `create table if not exists` + `on conflict do nothing`, så en
 * genkørsel aldrig overskriver det oprindelige før-billede.
 */
export function buildSnapshotSql(planIds, table) {
  assertBackupTable(table);
  if (!planIds.length) return "-- #6158: ingen planer at give tilbage, intet snapshot nødvendigt\n";
  const ids = uuidList(planIds);
  return `-- #6158 snapshot FØR tilbagegivelse af formtoppe. Idempotent.
-- given_back_at er kvitteringen: apply stempler den, når rækken er slettet.
begin;
create table if not exists public.${table} as
  select ${PLAN_COLUMNS}, now() as backed_up_at, null::timestamptz as given_back_at
  from public.rider_peak_plans where false;
alter table public.${table} add column if not exists given_back_at timestamptz;
alter table public.${table} enable row level security;
create unique index if not exists ${table}_id on public.${table}(id);
insert into public.${table}
  select ${PLAN_COLUMNS}, now(), null::timestamptz
  from public.rider_peak_plans where id in (
  ${ids}
  )
on conflict (id) do nothing;
commit;
notify pgrst, 'reload schema';
-- Verificér: select count(*) from public.${table}; (skal være mindst ${planIds.length})
`;
}

/**
 * Restore-SQL: genindsæt de tilbagegivne planer fra backup. Springer en plan over,
 * hvis rytteren siden har brugt pladsen igen (kvoten ville ellers blive brudt) eller
 * har en plan mod samme mål (UNIQUE). Rytteren skal stadig eksistere (FK).
 */
export function buildRestoreSql(table) {
  assertBackupTable(table);
  return `-- #6158 restore: rul tilbagegivelsen tilbage fra ${table}. Ejer-gated.
-- NB: kvoten tjekkes mod tabellen FØR indsættelsen; har en rytter to backup-planer
-- og én ny plan, kan han ende over kvoten. Tjek bagefter med forespørgslen nederst.
begin;
insert into public.rider_peak_plans (${PLAN_COLUMNS})
  select b.id, b.rider_id, b.season_id, b.target_race_id, b.window_start, b.window_end, b.locked_at, b.created_at
  from public.${table} b
  join public.riders r on r.id = b.rider_id
  where not exists (select 1 from public.rider_peak_plans p where p.id = b.id)
    and (select count(*) from public.rider_peak_plans p where p.rider_id = b.rider_id and p.season_id = b.season_id) < ${RIDER_PLAN_QUOTA_SQL}
on conflict do nothing;
-- Kvitteringen nulstilles for de genindsatte rækker.
update public.${table} b set given_back_at = null
  where exists (select 1 from public.rider_peak_plans p where p.id = b.id);
commit;
-- Over kvoten efter restore:
-- select rider_id, season_id, count(*) from public.rider_peak_plans group by 1, 2 having count(*) > ${RIDER_PLAN_QUOTA_SQL};
`;
}

// ── Privat rapport ──────────────────────────────────────────────────────────

const OUTCOME_LABEL = {
  give_back: "gives tilbage",
  keep_counted_after_ignition: "BEHOLDES (har talt efter tændingen)",
  keep_will_work: "beholdes (virker efter tændingen)",
};
const RULE_LABEL = { window_started: "A vindue startet", target_started: "B målløb startet" };

export function renderPrivateReport(plan, { generatedAt }) {
  const t = plan.totals;
  const lines = [];
  lines.push(`# #6158 dry-run: formtoppe brugt uden virkning under v4 (PRIVAT)`);
  lines.push("");
  lines.push(`Genereret ${generatedAt}. Sæson ${t.seasonNumber} (start ${t.seasonStart}). Tænding ${t.ignitionAt}. Ingen skrivning udført.`);
  lines.push("");
  lines.push("## Samlet");
  lines.push(`- Planer i sæsonen: ${t.plansInSeason}`);
  lines.push(`- Uden for scope (røres ikke): ${t.outOfScope} ${JSON.stringify(t.outOfScopeByReason)}`);
  lines.push(`- Uden målløb (kan ikke have virket, men uden for de to regler, røres ikke): ${t.orphansNoTarget}`);
  lines.push(`- I scope: ${t.inScope}`);
  lines.push(`- **Gives tilbage: ${t.giveBack}** på ${t.giveBackRiders} ryttere og ${t.giveBackTeams} hold (heraf parkerede hold: ${t.giveBackTeamsParked})`);
  lines.push(`  - Kun regel A (vindue startet fra sæsonstart til tænding): ${t.giveBackByRule.window_started_only}`);
  lines.push(`  - Kun regel B (målløb startet før tænding): ${t.giveBackByRule.target_started_only}`);
  lines.push(`  - Begge regler: ${t.giveBackByRule.both}`);
  lines.push(`  - Med hård lås (locked_at stemplet): ${t.giveBackLocked}`);
  lines.push(`  - Dykket allerede mærket i et løb efter tændingen: ${t.giveBackDipAlreadyFelt}`);
  lines.push(`- Beholdes fordi toppen har talt i et løb efter tændingen: ${t.keepCountedAfterIgnition}`);
  lines.push(`- Beholdes fordi den virker efter tændingen: ${t.keepWillWork}`);
  lines.push(`- Allerede givet tilbage (i backup, ikke i tabellen): ${t.alreadyGivenBack}`);
  lines.push(`- Liste-hash (apply kræver \`--approved-list=\` med netop denne og samme \`--ignition=\`): \`${approvedListHash(plan)}\``);
  if (plan.backupTable) lines.push(`- Backup-/kvitteringstabel: \`${plan.backupTable}\` (apply kræver samme \`--backup-date=\`)`);
  lines.push("");
  if (plan.dip) {
    const d = plan.dip.totals;
    lines.push("## Del B: nedgangen efter en top uden bonus");
    lines.push(`- Planer vurderet: ${d.plansAssessed} (nedgang overstået ${d.plansLapsed}, i gang ${d.plansActive}, foran ${d.plansAhead})`);
    lines.push(`- Kørte rytter-etaper i nedgangen (alle planer i scope): ${d.dipStagesRun} på ${d.ridersWithDipStagesRun} ryttere. Motorversioner set: ${d.engineVersionsSeen.join(", ") || "-"}`);
    lines.push(`- **Rytter-etaper hvor motoren faktisk lagde et dyk på (alle planer): ${d.dipStagesApplied}**`);
    lines.push(`- **Heraf efter en top uden bonus (tilbagegivne planer): ${d.dipWithoutBonusStagesApplied}** på ${d.ridersWithDipApplied} ryttere`);
    lines.push(`- Ryttere der skal have formjustering for et allerede anvendt dyk: ${d.ridersNeedingFormAdjustment}. Ændring i \`rider_condition.form\`: 0 for alle (dykket gemmes ikke der).`);
    lines.push(`- Ryttere der stadig bærer en nedgang uden bonus (i gang eller foran): ${d.ridersCarryingDipAhead}; ${d.plansDipAheadRemovedByGiveBack} planer. Fjernes når rækken slettes i del A.`);
    lines.push(`- Beholdte planer med nedgang foran (har bonus, røres ikke): ${d.plansDipAheadWithBonus}`);
    const blockers = dipApplyBlockers(plan.dip);
    lines.push(`- Apply-spærre fra del B: ${blockers.length ? blockers.join(" ") : "ingen"}`);
    lines.push("");
    const adjusted = plan.dip.riders.filter((x) => x.formAdjustmentPoints || x.dipAhead);
    if (adjusted.length) {
      lines.push("| Rytter-id | Hold-id | Anvendt dyk (etaper) | Formjustering (formpoint) | rider_condition | Nedgang foran |");
      lines.push("|---|---|---|---|---|---|");
      for (const x of adjusted) {
        lines.push(`| ${x.riderId} | ${x.teamId} | ${x.dipStagesApplied} | ${x.formAdjustmentPoints ?? "?"} | ${x.riderConditionDelta} | ${x.dipAhead ? "ja" : "nej"} |`);
      }
      lines.push("");
    }
  }
  lines.push("## Følgeeffekt til go-kortet");
  lines.push(`- ${t.giveBackTargetInProgress} tilbagegivne toppe hører til et etapeløb der er i gang ved tændingen. Manageren får toppen tilbage, men kan først bruge den i et løb der starter efter tændingen.`);
  lines.push(`- ${t.giveBackRiderNotSenior} tilbagegivne toppe hører til ryttere der ikke står i seniortruppen nu; de kan ikke planlægges igen før rytteren er senior (#5992).`);
  lines.push(`- ${t.giveBackSameTargetReplannable} tilbagegivne toppe har et målløb der ikke er startet; det samme løb kan vælges igen.`);
  lines.push("");
  lines.push("## Sådan bliver en tilbagegivet top planlægbar igen");
  lines.push("- Tilbagegivelse = rækken i `rider_peak_plans` slettes (efter backup). Kvoten tælles som rækker pr. (rytter, sæson), så pladsen er fri med det samme.");
  lines.push("- Låsen udledes fra `window_start` (og et evt. `locked_at`-stempel) på selve rækken. Ingen række, ingen lås.");
  lines.push("- Motoren og dykket læser vinduet fra samme række. Ingen række, intet vindue, intet dyk.");
  lines.push("- Manageren opretter en ny plan som normalt: målet skal være et seniorløb i holdets kalender der ikke er startet, og rytteren skal være senior. Det nye vindue snappes om målløbet og er låst fra sin startdato.");
  lines.push("- Fravalgt: at nulle `target_race_id` (rækken tæller stadig i kvoten) og at flytte `window_start` (et vindue ingen manager har valgt).");
  lines.push("");
  lines.push("## Hold");
  lines.push("| Hold | Status | Toppe tilbage | Ryttere |");
  lines.push("|---|---|---|---|");
  for (const team of [...plan.teams].sort((a, b) => (b.plans - a.plans) || String(a.name).localeCompare(String(b.name)))) {
    lines.push(`| ${team.name} | ${team.parked ? "parkeret" : "aktiv"} | ${team.plans} | ${team.riders} |`);
  }
  lines.push("");
  lines.push("## Planer i scope");
  lines.push("| Rytter | Rytter-id | Hold | Målløb | Vindue | Regler | Udfald | Låst | I gang ved tænding | Senior nu | Samme mål igen | Plan-id |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  const teamName = new Map(plan.teams.map((x) => [x.teamId, x.name]));
  const sorted = [...plan.rows].sort((a, b) => a.outcome.localeCompare(b.outcome) || String(teamName.get(a.teamId) ?? a.teamId).localeCompare(String(teamName.get(b.teamId) ?? b.teamId)) || a.name.localeCompare(b.name));
  for (const r of sorted) {
    lines.push(`| ${r.name} | ${r.riderId} | ${teamName.get(r.teamId) ?? r.teamId} | ${r.targetRaceName ?? r.targetRaceId} | ${r.windowStart} til ${r.windowEnd} | ${r.rules.map((x) => RULE_LABEL[x]).join(", ") || "-"} | ${OUTCOME_LABEL[r.outcome]} | ${r.lockedAt ? "ja" : "nej"} | ${r.targetInProgressAtIgnition ? "ja" : "nej"} | ${r.riderSeniorNow ? "ja" : "nej"} | ${r.sameTargetReplannable ? "ja" : "nej"} | ${r.planId} |`);
  }
  if (plan.outOfScope.length || plan.orphans.length) {
    lines.push("");
    lines.push("## Uden for scope og uden målløb (røres ikke)");
    lines.push("| Plan-id | Rytter-id | Hold-id | Årsag |");
    lines.push("|---|---|---|---|");
    for (const o of plan.outOfScope) lines.push(`| ${o.planId} | ${o.riderId} | ${o.teamId ?? "-"} | ${o.reason} |`);
    for (const o of plan.orphans) lines.push(`| ${o.planId} | ${o.riderId} | ${o.teamId ?? "-"} | no_target_race |`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Konsol-output: KUN samlede tal (ingen id'er, ingen navne). */
export function renderPublicSummary(plan) {
  const t = plan.totals;
  return [
    `#6158 dry-run (read-only). Sæson ${t.seasonNumber}, tænding ${t.ignitionAt}.`,
    `  Planer i sæsonen: ${t.plansInSeason} | uden for scope: ${t.outOfScope} ${JSON.stringify(t.outOfScopeByReason)} | uden målløb: ${t.orphansNoTarget}`,
    `  I scope: ${t.inScope} | gives tilbage: ${t.giveBack} (kun A ${t.giveBackByRule.window_started_only}, kun B ${t.giveBackByRule.target_started_only}, begge ${t.giveBackByRule.both})`,
    `  Beholdes: talt efter tænding ${t.keepCountedAfterIgnition}, virker efter tænding ${t.keepWillWork} | allerede givet tilbage: ${t.alreadyGivenBack}`,
    `  Ryttere ${t.giveBackRiders} | hold ${t.giveBackTeams} (parkerede ${t.giveBackTeamsParked}) | målløb i gang ved tænding ${t.giveBackTargetInProgress} | ikke senior nu ${t.giveBackRiderNotSenior}`,
    ...(plan.dip ? [
      `  Del B (nedgang): kørte rytter-etaper i nedgangen ${plan.dip.totals.dipStagesRun} | dyk anvendt ${plan.dip.totals.dipStagesApplied} (uden bonus ${plan.dip.totals.dipWithoutBonusStagesApplied}) | ryttere med nedgang uden bonus foran ${plan.dip.totals.ridersCarryingDipAhead} | formjustering nødvendig ${plan.dip.totals.ridersNeedingFormAdjustment}`,
    ] : []),
    `  Liste-hash (til --approved-list): ${approvedListHash(plan)}${plan.backupTable ? ` | backup ${plan.backupTable}` : ""}`,
  ].join("\n");
}

// ── Kort til ejeren (privat, anonymiseret) ─────────────────────────────────

function esc(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

/** Hold-alias A, B, ... AA, AB (stabilt efter antal toppe, så id). */
export function teamAlias(i) {
  let n = i;
  let s = "";
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return `Hold ${s}`;
}

/**
 * Før/efter pr. hold: toppe brugt i S4 (i scope) før, og hvor mange der står
 * tilbage efter tilbagegivelsen. Anonymiseret (Hold A, B, ...). Ren.
 */
export function cardRows(plan) {
  const byTeam = new Map();
  for (const r of plan.rows) {
    if (!byTeam.has(r.teamId)) byTeam.set(r.teamId, { teamId: r.teamId, before: 0, givenBack: 0, riders: new Set(), dipAhead: 0 });
    const t = byTeam.get(r.teamId);
    t.before++;
    if (r.outcome === "give_back") { t.givenBack++; t.riders.add(r.riderId); }
  }
  for (const p of plan.dip?.perPlan || []) {
    if (p.dipAheadRemovedByGiveBack && byTeam.has(p.teamId)) byTeam.get(p.teamId).dipAhead++;
  }
  return [...byTeam.values()]
    .sort((a, b) => (b.givenBack - a.givenBack) || (b.before - a.before) || String(a.teamId).localeCompare(String(b.teamId)))
    .map((t, i) => ({ alias: teamAlias(i), before: t.before, after: t.before - t.givenBack, givenBack: t.givenBack, riders: t.riders.size, dipAhead: t.dipAhead }));
}

export function renderCardHtml(plan, { generatedAt }) {
  const rows = cardRows(plan);
  const t = plan.totals;
  const d = plan.dip?.totals;
  const max = Math.max(1, ...rows.map((r) => r.before));
  const bar = (v, cls) => `<span class="bar ${cls}" style="width:${((v / max) * 100).toFixed(1)}%"></span>`;
  const body = rows.map((r) => `<tr><td>${esc(r.alias)}</td><td class="n">${r.before}</td><td class="viz">${bar(r.before, "before")}${bar(r.after, "after")}</td><td class="n">${r.after}</td><td class="n">${r.givenBack}</td><td class="n">${r.riders}</td><td class="n">${r.dipAhead}</td></tr>`).join("");
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><title>6158 formtoppe tilbage</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#6b6b6b;--line:#e3e3e3;--before:#b8b8b8;--after:#c9a227}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,Segoe UI,sans-serif}
.card{width:880px;padding:24px;box-sizing:border-box}
h1{font-size:18px;margin:0 0 4px}p{margin:0 0 12px;color:var(--muted)}
.kpis{display:flex;gap:12px;margin:12px 0 16px}.kpi{border:1px solid var(--line);border-radius:5px;padding:8px 12px;flex:1}
.kpi b{display:block;font-size:20px;font-variant-numeric:tabular-nums}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left}th{color:var(--muted);font-weight:500}
td.n{text-align:right;width:70px}td.viz{width:300px}
.bar{display:block;height:6px;border-radius:2px;margin:1px 0}.bar.before{background:var(--before)}.bar.after{background:var(--after)}
.legend span{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 12px;vertical-align:middle}
</style></head><body><div class="card">
<h1>#6158 formtoppe tilbage, før og efter pr. hold</h1>
<p>Tørkørsel ${esc(copenhagenDateString(new Date(generatedAt)))}. Sæson ${t.seasonNumber}. Formtoppe virker igen fra ${esc(copenhagenDateString(new Date(t.ignitionAt)))} (dansk tid). Intet er skrevet.</p>
<div class="kpis">
<div class="kpi"><b>${t.giveBack}</b>toppe gives tilbage</div>
<div class="kpi"><b>${t.giveBackRiders}</b>ryttere</div>
<div class="kpi"><b>${t.giveBackTeams}</b>hold</div>
<div class="kpi"><b>${d ? d.dipWithoutBonusStagesApplied : "-"}</b>etaper med dyk uden bonus</div>
<div class="kpi"><b>${d ? d.ridersCarryingDipAhead : "-"}</b>ryttere med nedgang foran (fjernes)</div>
</div>
<p class="legend"><span style="background:var(--before)"></span>toppe brugt nu<span style="background:var(--after)"></span>står tilbage efter</p>
<table><thead><tr><th>Hold</th><th class="n">Før</th><th></th><th class="n">Efter</th><th class="n">Tilbage</th><th class="n">Ryttere</th><th class="n">Planer m. nedgang fjernet</th></tr></thead><tbody>${body}</tbody></table>
</div></body></html>
`;
}

// ── I/O (read-only) ─────────────────────────────────────────────────────────

export async function fetchActiveSeason(supabase) {
  const { data, error } = await supabase
    .from("seasons").select("id, number, start_date").eq("status", "active")
    .order("number", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`season lookup: ${error.message}`);
  if (!data?.id) throw new Error("No active season found");
  return data;
}

async function fetchSeasonPlans(supabase, seasonId) {
  return fetchAllRows(() =>
    supabase.from("rider_peak_plans").select(PLAN_COLUMNS).eq("season_id", seasonId).order("id")
  );
}

async function fetchByIds(supabase, table, columns, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await fetchAllRowsChunkedIn(uniq, (chunk) =>
    supabase.from(table).select(columns).in("id", chunk).order("id")
  );
  return new Map(rows.map((r) => [r.id, r]));
}

async function fetchSchedule(supabase, raceIds) {
  const uniq = [...new Set(raceIds.filter(Boolean))];
  if (!uniq.length) return [];
  return fetchAllRowsChunkedIn(uniq, (chunk) =>
    supabase.from("race_stage_schedule").select("race_id, stage_number, scheduled_at").in("race_id", chunk)
      .order("race_id").order("stage_number")
  );
}

/**
 * Alle KØRTE etaper (rytter, etape, CET-dag) i sæsonens løb, for de givne ryttere.
 * En etape tæller som kørt når stage_number <= stages_completed. Bærer løbets
 * første etapetidspunkt, så tændingsgrænsen kan lægges på bagefter (rent).
 */
export async function fetchSeasonStages(supabase, { seasonId, riderIds }) {
  const out = new Map();
  if (!riderIds.length) return out;
  const entries = await fetchAllRowsChunkedIn(riderIds, (chunk) =>
    supabase.from("race_entries")
      .select("race_id, rider_id, races!inner(season_id, stages_completed)")
      .in("rider_id", chunk)
      .eq("races.season_id", seasonId)
      .gt("races.stages_completed", 0)
      .order("race_id")
      .order("rider_id")
  );
  if (!entries.length) return out;
  const raceIds = [...new Set(entries.map((e) => e.race_id))];
  const schedule = await fetchSchedule(supabase, raceIds);
  const first = firstStageAtByRace(schedule);
  const completedByRace = new Map(entries.map((e) => [e.race_id, Number(e.races?.stages_completed) || 0]));
  const stagesByRace = new Map();
  for (const s of schedule) {
    if (!(Number(s.stage_number) <= (completedByRace.get(s.race_id) || 0))) continue;
    const day = scheduledAtToOrdinal(s.scheduled_at);
    if (day == null) continue;
    if (!stagesByRace.has(s.race_id)) stagesByRace.set(s.race_id, []);
    stagesByRace.get(s.race_id).push({ stageNumber: Number(s.stage_number), dayOrdinal: day, raceFirstMs: first.get(s.race_id) ?? null });
  }
  for (const e of entries) {
    for (const st of stagesByRace.get(e.race_id) || []) {
      if (!out.has(e.rider_id)) out.set(e.rider_id, []);
      out.get(e.rider_id).push({ raceId: e.race_id, ...st });
    }
  }
  return out;
}

/** Kun etaper i løb der startede på eller efter tændingen (de nye regler). Ren. */
export function postIgnitionFrom(seasonStagesByRider, ignitionMs) {
  const out = new Map();
  for (const [riderId, list] of seasonStagesByRider) {
    const kept = list
      .filter((s) => s.raceFirstMs != null && s.raceFirstMs >= ignitionMs)
      .map((s) => ({ raceId: s.raceId, dayOrdinal: s.dayOrdinal }));
    if (kept.length) out.set(riderId, kept);
  }
  return out;
}

/**
 * Kørte etaper (rytter, CET-dag) i løb der startede på eller efter tændingen.
 * Bevaret som indgang; bygger på fetchSeasonStages.
 */
export async function fetchPostIgnitionStages(supabase, { seasonId, riderIds, ignitionMs }) {
  return postIgnitionFrom(await fetchSeasonStages(supabase, { seasonId, riderIds }), ignitionMs);
}

/** Seneste motorkørsel pr. (løb, etape): `${raceId}:${stage}` → {runId, engineVersion}. */
export async function fetchLatestRuns(supabase, raceIds) {
  const uniq = [...new Set(raceIds.filter(Boolean))];
  const out = new Map();
  if (!uniq.length) return out;
  const rows = await fetchAllRowsChunkedIn(uniq, (chunk) =>
    supabase.from("race_simulation_runs").select("id, race_id, stage_number, engine_version, created_at")
      .in("race_id", chunk).order("race_id").order("stage_number").order("created_at")
  );
  const best = new Map();
  for (const r of rows) {
    const key = `${r.race_id}:${Number(r.stage_number)}`;
    const prev = best.get(key);
    if (!prev || Date.parse(r.created_at) >= Date.parse(prev.created_at)) best.set(key, r);
  }
  for (const [key, r] of best) out.set(key, { runId: r.id, engineVersion: r.engine_version ?? null });
  return out;
}

/**
 * Peak-komponenten (score-rum) pr. (kørsel, rytter), kun rækker hvor motoren
 * overhovedet skrev en peak-komponent. Under v4 skrives ingen komponenter.
 */
export async function fetchPeakComponents(supabase, runIds) {
  const uniq = [...new Set(runIds.filter(Boolean))];
  const out = new Map();
  if (!uniq.length) return out;
  const rows = await fetchAllRowsChunkedIn(uniq, (chunk) =>
    supabase.from("race_simulation_rider_scores").select("run_id, rider_id, peak:components->peak")
      .in("run_id", chunk).not("components->peak", "is", null).order("run_id").order("rider_id")
  );
  for (const r of rows) {
    const v = Number(r.peak);
    if (Number.isFinite(v)) out.set(`${r.run_id}:${r.rider_id}`, v);
  }
  return out;
}

/** Backup-rækker for sæsonen; tom liste hvis backup-tabellen ikke findes endnu. */
export async function fetchBackupIds(supabase, seasonId, table) {
  assertBackupTable(table);
  try {
    const rows = await fetchAllRows(() =>
      supabase.from(table).select("id").eq("season_id", seasonId).order("id")
    );
    return rows.map((r) => r.id);
  } catch (err) {
    if (/does not exist|could not find|PGRST205|42P01/i.test(String(err?.message))) return [];
    throw err;
  }
}

/** Næste sæsons start (midnat dansk tid) = tidspunktet hvor formtoppe virker igen (ejer 10/10). */
export async function fetchNextSeasonIgnition(supabase, activeSeason) {
  const { data, error } = await supabase
    .from("seasons").select("id, number, start_date").eq("number", Number(activeSeason.number) + 1)
    .limit(1).maybeSingle();
  if (error) throw new Error(`next season lookup: ${error.message}`);
  if (!data?.start_date) throw new Error(`No season ${Number(activeSeason.number) + 1} with a start_date; pass --ignition=<ISO>`);
  return copenhagenHourToUTC(String(data.start_date).slice(0, 10), 0).toISOString();
}

/**
 * Indlæs alt read-only og byg planen (del A) + nedgangen (del B).
 * @param {object} supabase
 * @param {{ignition?: string|null, backupTable: string, now?: string}} opts
 *   ignition: ISO, "next-season" (default) eller "now".
 */
export async function loadPlan(supabase, { ignition = IGNITION_NEXT_SEASON, backupTable, now = new Date().toISOString() }) {
  const season = await fetchActiveSeason(supabase);
  let ignitionAt;
  if (ignition === IGNITION_NOW) ignitionAt = now;
  else if (ignition == null || ignition === IGNITION_NEXT_SEASON) ignitionAt = await fetchNextSeasonIgnition(supabase, season);
  else ignitionAt = ignition;
  const ignitionMs = Date.parse(ignitionAt);
  const plans = await fetchSeasonPlans(supabase, season.id);
  const ridersById = await fetchByIds(supabase, "riders", RIDER_COLUMNS, plans.map((p) => p.rider_id));
  const teamsById = await fetchByIds(supabase, "teams", TEAM_COLUMNS, [...ridersById.values()].map((r) => r.team_id));
  const targetIds = plans.map((p) => p.target_race_id);
  const riderIds = [...new Set(plans.map((p) => p.rider_id))];
  const [racesById, schedule, seasonStagesByRider, backupIds] = await Promise.all([
    fetchByIds(supabase, "races", RACE_COLUMNS, targetIds),
    fetchSchedule(supabase, targetIds),
    fetchSeasonStages(supabase, { seasonId: season.id, riderIds }),
    fetchBackupIds(supabase, season.id, backupTable),
  ]);
  const live = new Set(plans.map((p) => p.id));
  const alreadyGivenBackIds = backupIds.filter((id) => !live.has(id));
  const plan = buildPlan({
    season, plans, ridersById, teamsById, racesById,
    firstStageMs: firstStageAtByRace(schedule),
    postIgnitionStagesByRider: postIgnitionFrom(seasonStagesByRider, ignitionMs),
    alreadyGivenBackIds, ignitionAt,
  });

  // Del B: hvad lagde motoren faktisk på i nedgangen?
  const stagedRaceIds = [...new Set([...seasonStagesByRider.values()].flat().map((s) => s.raceId))];
  const latestRunByStage = await fetchLatestRuns(supabase, stagedRaceIds);
  const peakComponentByRunRider = await fetchPeakComponents(supabase, [...latestRunByStage.values()].map((r) => r.runId));
  plan.dip = assessDip({
    rows: plan.rows,
    seasonStagesByRider,
    latestRunByStage,
    peakComponentByRunRider,
    todayOrdinal: dateStringToOrdinal(copenhagenDateString(new Date(Date.parse(now)))),
  });
  plan.backupTable = backupTable;
  return { plan, season };
}

export function writePrivateArtifacts(plan, { generatedAt, dir = PRIVATE_DIR, suffix = "dry-run" }) {
  mkdirSync(dir, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const report = join(dir, `${suffix}-${stamp}.md`);
  const json = join(dir, `${suffix}-${stamp}.json`);
  const snapshot = join(dir, "snapshot.sql");
  const restore = join(dir, "restore.sql");
  const card = join(dir, "card.html");
  writeFileSync(report, renderPrivateReport(plan, { generatedAt }), "utf8");
  writeFileSync(json, JSON.stringify({ generatedAt, listHash: approvedListHash(plan), ...plan }, null, 2), "utf8");
  writeFileSync(snapshot, buildSnapshotSql(giveBackIds(plan), plan.backupTable), "utf8");
  writeFileSync(restore, buildRestoreSql(plan.backupTable), "utf8");
  writeFileSync(card, renderCardHtml(plan, { generatedAt }), "utf8");
  return { report, json, snapshot, restore, card };
}

// ── Apply (ejer-gated) ──────────────────────────────────────────────────────

/** Kast hvis backup-tabellen ikke dækker alle planer der skal slettes. */
export async function assertBackupCovers(supabase, planIds, table) {
  assertBackupTable(table);
  if (!planIds.length) return;
  const rows = await fetchAllRowsChunkedIn(planIds, (chunk) =>
    supabase.from(table).select("id").in("id", chunk).order("id")
  ).catch((err) => {
    throw new Error(`Backup table ${table} not readable (${err.message}). Run balance-internals/6158/snapshot.sql first. Nothing was written.`);
  });
  const covered = new Set(rows.map((r) => r.id));
  const missing = planIds.filter((id) => !covered.has(id));
  if (missing.length) {
    throw new Error(`Backup missing ${missing.length} of ${planIds.length} plans. Re-run snapshot.sql. Nothing was written.`);
  }
}

/**
 * Apply: slet præcis de godkendte planer (giv toppene tilbage og fjern dermed
 * nedgangen), stempl kvitteringen i backuppen, og verificér. Idempotent: en
 * slettet plan findes ikke igen og tælles som "allerede givet tilbage" i hashen;
 * kvitteringen stemples kun hvor den mangler.
 */
export async function runApply({ supabase, plan, seasonId, ownerGo, approvedHash, now = new Date().toISOString() }) {
  if (!ownerGo) throw new Error(`Apply requires ${OWNER_GO_FLAG}`);
  if (approvedHash !== approvedListHash(plan)) {
    throw new Error("Live list differs from the list the owner approved. Re-run dry-run and show the owner the new list. Nothing was written.");
  }
  const table = plan.backupTable;
  assertBackupTable(table);
  const blockers = plan.dip ? dipApplyBlockers(plan.dip) : ["Dip assessment (part B) missing. Nothing was written."];
  if (blockers.length) throw new Error(blockers.join(" "));
  const ids = giveBackIds(plan);
  await assertBackupCovers(supabase, ids, table);

  let deleted = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await supabase.from("rider_peak_plans")
      .delete()
      .in("id", chunk)
      .eq("season_id", seasonId)
      .select("id");
    if (error) throw new Error(`give back (delete) after ${deleted} plans: ${error.message}`);
    deleted += (data || []).length;
  }

  // Kvittering: stempl given_back_at på alle godkendte (også et tidligere, afbrudt
  // apply's rækker), kun hvor stemplet mangler.
  const all = [...new Set([...ids, ...plan.alreadyGivenBackIds])];
  let receipted = 0;
  for (let i = 0; i < all.length; i += 100) {
    const chunk = all.slice(i, i + 100);
    const { data, error } = await supabase.from(table)
      .update({ given_back_at: now })
      .in("id", chunk)
      .is("given_back_at", null)
      .select("id");
    if (error) throw new Error(`receipt (${table}.given_back_at) after ${receipted} rows: ${error.message}. Plans are deleted; re-run apply to finish the receipt.`);
    receipted += (data || []).length;
  }

  // Post-verify 1: ingen godkendt plan findes mere.
  const remaining = all.length
    ? await fetchAllRowsChunkedIn(all, (chunk) => supabase.from("rider_peak_plans").select("id").in("id", chunk).order("id"))
    : [];
  if (remaining.length) throw new Error(`Verification failed: ${remaining.length} approved plans still exist after delete`);
  // Post-verify 2: alle godkendte er kvitteret i backuppen.
  const backupRows = all.length
    ? await fetchAllRowsChunkedIn(all, (chunk) => supabase.from(table).select("id, given_back_at").in("id", chunk).order("id"))
    : [];
  const unreceipted = all.length - backupRows.filter((r) => r.given_back_at != null).length;
  if (unreceipted) throw new Error(`Verification failed: ${unreceipted} approved plans have no receipt in ${table}`);
  return { planned: ids.length, deleted, alreadyGivenBack: plan.alreadyGivenBackIds.length, receipted, remainingAfter: 0 };
}

/** Post-verify 3: en frisk indlæsning har intet tilbage at give, og hashen er uændret. */
export function assertNothingLeft(planAfter, approvedHash) {
  if (giveBackIds(planAfter).length) throw new Error(`Verification failed: ${giveBackIds(planAfter).length} plans still qualify for give-back after apply`);
  if (approvedListHash(planAfter) !== approvedHash) throw new Error("Verification failed: list hash changed after apply");
  if (planAfter.dip && planAfter.dip.totals.plansDipAheadRemovedByGiveBack) {
    throw new Error("Verification failed: a dip without bonus is still ahead after apply");
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dotenv = await import("dotenv");
  dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  const generatedAt = new Date().toISOString();
  const backupTable = backupTableName(opts.backupDate ?? defaultBackupDate(new Date(generatedAt)));
  const { plan, season } = await loadPlan(supabase, { ignition: opts.ignition, backupTable, now: generatedAt });
  const files = writePrivateArtifacts(plan, { generatedAt, suffix: opts.apply ? "pre-apply" : "dry-run" });
  console.log(renderPublicSummary(plan));
  console.log(`  Privat rapport: ${files.report}`);
  console.log(`  Snapshot-SQL:   ${files.snapshot}`);
  console.log(`  Restore-SQL:    ${files.restore}`);
  console.log(`  Kort (html):    ${files.card}`);
  if (!opts.apply) {
    console.log("Dry-run: intet skrevet til databasen.");
    return;
  }
  const result = await runApply({ supabase, plan, seasonId: season.id, ownerGo: opts.ownerGo, approvedHash: opts.approvedHash });
  const { plan: after } = await loadPlan(supabase, { ignition: opts.ignition, backupTable, now: new Date().toISOString() });
  assertNothingLeft(after, opts.approvedHash);
  const resultPath = join(PRIVATE_DIR, `apply-result-${generatedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(resultPath, JSON.stringify({ ...result, postVerify: "ok" }, null, 2), "utf8");
  console.log(`Apply: ${JSON.stringify(result)} | post-verify ok`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(`FEJL: ${err.message}`); process.exitCode = 1; });
}
