// #5912: genopret de traeningsdage der gik tabt 28/9, fordi aftenkoerslen den dag
// koerte FOER #5880 (regel A, ejer-valg 28/9: en rytter der koerer en etape paa en
// dato, traener paa datoens oevrige loebsdage) og foer ungdomsloebs-fixet (en
// U23-/juniorrytter der koerte, blev registreret som "bundet, koerte ikke" = hvile).
//
// To slags tabte rytter-loebsdage (begge staar i 28/9-rapporten som
// intensity=rest + bound_race_day=true + race_day=false, ikke skadet):
//   free_slot    rytteren havde en etape paa EN ANDEN af datoens loebsdage
//                => skulle have traenet sin plan paa denne loebsdag (regel A).
//   raced_missed rytteren koerte en etape paa NETOP denne loebsdag, men opslaget
//                fandt ikke ungdomsloebet => skulle have haft loebsdags-udvikling.
// En bundet rytter UDEN etape paa datoen er en aegte hviledag og roeres ikke.
//
// Udvaelgelsen bruger SAMME opslag som motoren efter #5880 (raceDayStageLookup.js),
// og gevinsten regnes med SAMME rene motor som sweepen (dailyTraining.js
// applyDailyTick + resolveDayProgram/raceDayProgram), kaedet pr. rytter i
// loebsdags-raekkefoelge. Traethed/form roeres IKKE (det er #5928, holdt adskilt).
//
// Koersel (fra backend/):
//   infisical run --env=prod --silent -- node scripts/dev/repair5912LostTraining.mjs
//     => --dry-run (default): READ-ONLY. Skriver aggregeret md til
//        docs/snapshots/5912/ og detaljer (rytter-id'er, gevinst-fordeling) til
//        balance-internals/5912/ (gitignoreret).
//   ... repair5912LostTraining.mjs --apply --owner-go --expect-rider-days=N
//     => KUN efter ejer-go. Idempotent via fast noegle pr. rytter+loebsdag
//        (markoer i 28/9-rapportens rytter-linje), backup foer, verify efter.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProgram, applyDailyTick } from "../../lib/dailyTraining.js";
import { raceDayProgram, RACE_DAY_FALLBACK_PROFILE } from "../../lib/raceDayYield.js";
import { loadRaceDayStagesByRider } from "../../lib/raceDayStageLookup.js";
import { resolveDayProgram, programSlotForRaceDay, weekDaysHaveSessions } from "../../lib/trainingPrograms.js";
import { isTrainingCellsEnabledForTeam } from "../../lib/trainingWeekPlanCellsFlag.js";
import { conditionMultiplier } from "../../lib/riderCondition.js";
import { buildCapsForRider } from "../../lib/riderProgression.js";
import { ageForSeason } from "../../lib/riderProgressionEngine.js";
import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { loadTrainingStaffContext } from "../../lib/trainingStaffContext.js";
import { riderLevelBand } from "../../lib/staffAbilityConstants.js";
import {
  TRAINING_RACE_DAY_CONFIG, resolveRaceDayBudgetDivisor, raceDaySeedKey,
} from "../../lib/trainingRaceDayTick.js";
import { copenhagenWeekdayKey, copenhagenHour, copenhagenDateString } from "../../lib/copenhagenTime.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../../lib/supabasePagination.js";

export const REPAIR_TICK_DATE = "2026-09-28";
export const REPAIR_SQUAD = "senior"; // training_day_runs.squad; ungdom ligger i senior-raekken
export const MARKER_FIELD = "repair_5912";
// Statusser der BLOKERER en ny koersel. "released" (fejlet og rullet tilbage) maa proeves igen.
const BLOCKING_MARKER_STATUSES = new Set(["claimed", "applied"]);
// Aftensweepen/datolukningen skriver evner fra ca. kl. 18 dansk tid. Apply maa ikke
// koere samtidig, ellers kan to skrivere kappes om samme rytters evner.
export const APPLY_FORBIDDEN_FROM_HOUR = 17;

/** Fast idempotens-noegle pr. rytter + loebsdag. */
export function repairKey({ seasonId, gameDay, riderId }) {
  return `5912:${seasonId}:${Number(gameDay)}:${riderId}`;
}

/** Er rapport-linjen en tvungen hvile pga. binding (kandidat til genopretning)? */
export function isLostRestCandidate(entry) {
  return !!entry
    && entry.intensity === "rest"
    && entry.bound_race_day === true
    && entry.race_day !== true
    && entry.injured !== true;
}

/** Har rapport-linjen allerede en blokerende genopretnings-markoer? */
export function markerBlocks(entry) {
  const status = entry?.[MARKER_FIELD]?.status;
  return BLOCKING_MARKER_STATUSES.has(status);
}

/**
 * Ren udvaelgelse. Ingen I/O.
 * @param {object} args
 * @param {Array<{id?: string, team_id: string, season_id: string, game_day: number, report: object}>} args.runs
 *   28/9-raekkerne (senior-squad) fra training_day_runs
 * @param {Map<string, Map<number, string|null>>} args.stageGameDaysByRider
 *   rytter -> (loebsdag -> etapens profil) for de loebsdage paa datoen hvor han koerte en etape
 * @returns {{ lost: Array<object>, alreadyMarked: Array<object>, legitRest: number }}
 */
export function classifyLostRiderDays({ runs, stageGameDaysByRider }) {
  const lost = [];
  const alreadyMarked = [];
  let legitRest = 0;
  const dateGameDays = [...new Set(runs.map((r) => Number(r.game_day)).filter(Number.isFinite))]
    .sort((a, b) => a - b);
  const seen = new Set();
  for (const run of runs) {
    const gameDay = Number(run.game_day);
    if (!Number.isFinite(gameDay)) continue;
    for (const entry of run.report?.riders ?? []) {
      if (!isLostRestCandidate(entry)) continue;
      const riderId = entry.rider_id;
      const stages = stageGameDaysByRider.get(riderId);
      if (!stages || stages.size === 0) { legitRest += 1; continue; }
      const key = repairKey({ seasonId: run.season_id, gameDay, riderId });
      if (seen.has(key)) continue; // dobbelt rapport-linje maa aldrig give dobbelt kredit
      seen.add(key);
      const kind = stages.has(gameDay) ? "raced_missed" : "free_slot";
      const item = {
        key, kind, riderId, teamId: run.team_id, seasonId: run.season_id, gameDay,
        runId: run.id ?? null, dateGameDays,
        profileType: kind === "raced_missed" ? (stages.get(gameDay) ?? RACE_DAY_FALLBACK_PROFILE) : null,
        // Traethed FOER loebsdagens tick (rapporten gemmer efter-vaerdien + deltaet).
        formBefore: Number(entry.form ?? 50),
        fatigueBefore: Number(entry.fatigue ?? 0) - Number(entry.fatigue_delta ?? 0),
      };
      if (markerBlocks(entry)) alreadyMarked.push(item);
      else lost.push(item);
    }
  }
  lost.sort((a, b) => (a.riderId < b.riderId ? -1 : a.riderId > b.riderId ? 1 : a.gameDay - b.gameDay));
  return { lost, alreadyMarked, legitRest };
}

/**
 * Ren beregning af én rytters genopretning: hans tabte loebsdage koeres i
 * raekkefoelge gennem samme applyDailyTick som sweepen, oven paa hans NUVAERENDE
 * evner/fremdrift (den tilstand en apply ville skrive oven paa).
 */
export function simulateRiderRepair({
  rider, abilityRow, days, plan = null, teamWeekDays = null, riderOverrideDays = null,
  programsOn = false, staff = null, facilityTier = null, seasonNumber,
}) {
  const startAbilities = {};
  for (const k of VISIBLE_ABILITIES) if (abilityRow?.[k] != null) startAbilities[k] = Number(abilityRow[k]);
  let abilities = { ...startAbilities };
  let progress = { ...(abilityRow?.ability_progress ?? {}) };
  const age = ageForSeason(rider.birthdate, seasonNumber);
  if (age == null) return { skipped: "no_age", gains: {}, totalPoints: 0, perDay: [] };
  const caps = buildCapsForRider(abilities, { ...rider, age }, rider.primary_type, rider.secondary_type);
  const budgetDivisor = resolveRaceDayBudgetDivisor({ seasonNumber });
  const hasExplicitPlan = !!(plan?.focus && plan?.intensity);
  const weekday = copenhagenWeekdayKey(REPAIR_TICK_DATE);
  const totalGains = {};
  const perDay = [];
  let totalProgress = 0;
  for (const day of [...days].sort((a, b) => a.gameDay - b.gameDay)) {
    const program = resolveProgram(plan, rider.primary_type);
    let tickProgram = program;
    let hardDailyCap = TRAINING_RACE_DAY_CONFIG.abilityGainCapPerRaceDay;
    if (day.kind === "raced_missed") {
      tickProgram = raceDayProgram(day.profileType ?? RACE_DAY_FALLBACK_PROFILE);
    } else {
      const dayProgram = resolveDayProgram({
        weekday, slotIndex: programSlotForRaceDay(day.gameDay, day.dateGameDays),
        riderOverrideDays, teamWeekDays, program, hasExplicitPlan, programsOn,
      });
      if (dayProgram.source === "program") program.focus = dayProgram.focus;
      program.intensity = dayProgram.intensity;
      tickProgram = program;
    }
    const result = applyDailyTick({
      riderId: rider.id, dateStr: REPAIR_TICK_DATE, age, abilities, caps, progress,
      program: tickProgram,
      conditionMult: conditionMultiplier({ form: day.formBefore, fatigue: day.fatigueBefore }),
      potentiale: rider.potentiale, primaryType: rider.primary_type, secondaryType: rider.secondary_type,
      staff, facilityTier, riderLevel: riderLevelBand({ is_academy: rider.is_academy, age }),
      tickSeedKey: raceDaySeedKey({ seasonId: day.seasonId, gameDay: day.gameDay }),
      budgetDivisor, hardDailyCap,
    });
    abilities = result.abilities;
    progress = result.progress;
    for (const [k, n] of Object.entries(result.gains)) totalGains[k] = (totalGains[k] ?? 0) + n;
    totalProgress += result.score;
    perDay.push({ key: day.key, gameDay: day.gameDay, kind: day.kind, intensity: tickProgram.intensity, gains: result.gains, progress: result.score });
  }
  const patch = { ability_progress: progress };
  for (const k of VISIBLE_ABILITIES) if (abilities[k] !== startAbilities[k]) patch[k] = abilities[k];
  const totalPoints = Object.values(totalGains).reduce((s, n) => s + n, 0);
  // totalProgress = summen af raa evne-deltaer (inkl. fremdrift under et helt point).
  return { gains: totalGains, totalPoints, totalProgress: Math.round(totalProgress * 100) / 100, perDay, patch, before: startAbilities,
    // Den laeste fremdrift (null = kolonnen var NULL) - optimistisk vagt ved apply.
    beforeProgress: abilityRow?.ability_progress ?? null };
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Ren aggregering til rapporten. */
export function summarizePlan({ lost, plans, teamById, riderById }) {
  const bucket = () => ({ riderDays: 0, riders: new Set(), teams: new Set() });
  const byCat = new Map();
  const byKind = { free_slot: 0, raced_missed: 0 };
  const teams = new Set();
  const riders = new Set();
  for (const d of lost) {
    const team = teamById.get(d.teamId);
    const rider = riderById.get(d.riderId);
    const cat = `${team?.is_ai ? "AI" : "menneske"} / ${rider?.squad ?? "ukendt"}`;
    if (!byCat.has(cat)) byCat.set(cat, bucket());
    const b = byCat.get(cat);
    b.riderDays += 1; b.riders.add(d.riderId); b.teams.add(d.teamId);
    byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
    teams.add(d.teamId); riders.add(d.riderId);
  }
  const done = [...plans.values()].filter((p) => !p.skipped);
  const points = done.map((p) => p.totalPoints).sort((a, b) => a - b);
  const progress = done.map((p) => p.totalProgress ?? 0).sort((a, b) => a - b);
  return {
    riderDays: lost.length,
    riders: riders.size,
    teams: teams.size,
    byKind,
    byCategory: [...byCat.entries()].sort().map(([cat, b]) => ({
      category: cat, riderDays: b.riderDays, riders: b.riders.size, teams: b.teams.size,
    })),
    gainPointsPerRider: {
      min: points[0] ?? null, median: quantile(points, 0.5), max: points.at(-1) ?? null,
      ridersWithZero: points.filter((p) => p === 0).length,
    },
    progressPerRider: { min: progress[0] ?? null, median: quantile(progress, 0.5), max: progress.at(-1) ?? null },
    skipped: [...plans.values()].filter((p) => p.skipped).length,
  };
}

export function parseArgs(argv) {
  const opts = { apply: false, ownerGo: false, expectRiderDays: null, humanOnly: false };
  for (const arg of argv) {
    if (arg === "--dry-run") continue;
    else if (arg === "--apply") opts.apply = true;
    else if (arg === "--owner-go") opts.ownerGo = true;
    // Ejer 1/10: genopret kun menneskehold; AI-hold roeres ikke.
    else if (arg === "--human-only") opts.humanOnly = true;
    else if (arg.startsWith("--expect-rider-days=")) opts.expectRiderDays = Number(arg.split("=")[1]);
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  if (opts.apply && !opts.ownerGo) throw new Error("--apply requires --owner-go (owner-gated prod mutation, #5912)");
  if (opts.apply && !Number.isInteger(opts.expectRiderDays)) {
    throw new Error("--apply requires --expect-rider-days=N from the dry-run the owner approved");
  }
  return opts;
}

/** Ejer 1/10 (--human-only): behold kun rytter-loebsdage og planer for menneskehold. Ren. */
export function onlyHumanTeams({ lost, plans, teamById }) {
  const isHuman = (teamId) => teamById.get(teamId)?.is_ai === false;
  return {
    lost: lost.filter((d) => isHuman(d.teamId)),
    plans: new Map([...plans].filter(([, p]) => isHuman(p.teamId))),
  };
}

/** Apply-gate: ren funktion, saa vagten kan testes. */
// Ejer 1/10: aftenvinduet er kun lukket MENS dagens afregning koerer. Er dagens
// datolukning helt faerdig (ingen pending/partial work-raekker og mindst een complete
// for i dag), kan der ikke vaere en samtidig skriver, og apply er tilladt.
export function assertApplyAllowed({ opts, plannedRiderDays, now = new Date(), todayCloseComplete = false }) {
  if (!opts.apply || !opts.ownerGo) throw new Error("apply not authorised");
  if (plannedRiderDays !== opts.expectRiderDays) {
    throw new Error(`plan changed since dry-run: ${plannedRiderDays} rider-days, expected ${opts.expectRiderDays} - rerun dry-run and get a new owner go`);
  }
  if (copenhagenHour(now) >= APPLY_FORBIDDEN_FROM_HOUR && !todayCloseComplete) {
    throw new Error(`apply refused after ${APPLY_FORBIDDEN_FROM_HOUR}:00 Copenhagen time until today's training date close is complete (evening training writes)`);
  }
}

/** Er dagens datolukning helt faerdig? Ingen pending/partial og mindst een complete. */
export async function loadTodayCloseComplete(supabase, now = new Date()) {
  const today = copenhagenDateString(now);
  const { data, error } = await supabase.from("training_date_work").select("status").eq("tick_date", today);
  if (error) throw new Error(`training_date_work: ${error.message}`);
  const rows = data ?? [];
  return rows.length > 0 && rows.some((r) => r.status === "complete") && !rows.some((r) => r.status === "pending" || r.status === "partial");
}

/**
 * Saet markoerer paa rapport-linjerne for de givne noegler. Ren: returnerer en ny
 * rapport. Linjer der allerede har en blokerende markoer roeres ikke.
 */
export function withMarkers(report, { gameDay, seasonId, keys, status, at, extraByKey = {} }) {
  const riders = (report?.riders ?? []).map((entry) => {
    const key = repairKey({ seasonId, gameDay, riderId: entry.rider_id });
    if (!keys.has(key) || !isLostRestCandidate(entry)) return entry;
    const current = entry[MARKER_FIELD]?.status;
    if (status === "claimed" && BLOCKING_MARKER_STATUSES.has(current)) return entry;
    if (status !== "claimed" && current !== "claimed") return entry;
    return { ...entry, [MARKER_FIELD]: { key, status, at, ...(extraByKey[key] ?? {}) } };
  });
  return { ...report, riders };
}

// ── I/O ──────────────────────────────────────────────────────────────────────

async function loadState(supabase) {
  const runs = await fetchAllRows(() => supabase.from("training_day_runs")
    .select("id, team_id, season_id, game_day, report")
    .eq("tick_date", REPAIR_TICK_DATE).eq("squad", REPAIR_SQUAD).order("id"));
  const seasonIds = [...new Set(runs.map((r) => r.season_id).filter(Boolean))];
  if (seasonIds.length !== 1) throw new Error(`expected exactly one season on ${REPAIR_TICK_DATE}, got ${seasonIds.length}`);
  const { data: season, error: seasonError } = await supabase.from("seasons")
    .select("id, number").eq("id", seasonIds[0]).maybeSingle();
  if (seasonError || !season) throw new Error(`season load: ${seasonError?.message ?? "missing"}`);
  const dateGameDays = [...new Set(runs.map((r) => Number(r.game_day)))].sort((a, b) => a - b);

  // Kandidater pr. hold (kun dem der skal slaas op).
  const candidatesByTeam = new Map();
  for (const run of runs) {
    for (const entry of run.report?.riders ?? []) {
      if (!isLostRestCandidate(entry)) continue;
      if (!candidatesByTeam.has(run.team_id)) candidatesByTeam.set(run.team_id, new Set());
      candidatesByTeam.get(run.team_id).add(entry.rider_id);
    }
  }

  // Samme opslag som motoren efter #5880, pr. hold og loebsdag.
  const stageGameDaysByRider = new Map();
  for (const [teamId, riderSet] of candidatesByTeam) {
    const riderIds = [...riderSet];
    for (const gameDay of dateGameDays) {
      const res = await loadRaceDayStagesByRider({
        supabase, teamId, seasonId: season.id, gameDay, riderIds, withProfiles: true,
      });
      if (res.error) throw new Error(`stage lookup team ${teamId} game day ${gameDay}: ${res.error.message ?? res.error}`);
      for (const [riderId, stage] of res.data ?? new Map()) {
        if (!stageGameDaysByRider.has(riderId)) stageGameDaysByRider.set(riderId, new Map());
        stageGameDaysByRider.get(riderId).set(gameDay, stage.profileType ?? null);
      }
    }
  }
  return { runs, season, stageGameDaysByRider, candidateTeams: [...candidatesByTeam.keys()] };
}

async function planAll(supabase, { lost, season }) {
  const riderIds = [...new Set(lost.map((d) => d.riderId))];
  const teamIds = [...new Set(lost.map((d) => d.teamId))];
  const riders = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase.from("riders")
    .select("id, team_id, squad, is_retired, is_academy, birthdate, potentiale, primary_type, secondary_type")
    .in("id", chunk).order("id"));
  const abilityRows = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase.from("rider_derived_abilities")
    .select("*").in("rider_id", chunk).order("rider_id"));
  const teams = await fetchAllRowsChunkedIn(teamIds, (chunk) => supabase.from("teams")
    .select("id, is_ai").in("id", chunk).order("id"));
  const plans28 = await fetchAllRowsChunkedIn(teamIds, (chunk) => supabase.from("training_plans")
    .select("rider_id, team_id, focus, intensity").eq("season_id", season.id).in("team_id", chunk).order("id"));
  const weekRows = await fetchAllRowsChunkedIn(teamIds, (chunk) => supabase.from("training_week_plans")
    .select("team_id, rider_id, days").in("team_id", chunk).order("id"));

  const riderById = new Map(riders.map((r) => [r.id, r]));
  const abilityById = new Map(abilityRows.map((a) => [a.rider_id, a]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const planByRider = new Map(plans28.map((p) => [p.rider_id, p]));
  const teamCtx = new Map();
  for (const teamId of teamIds) {
    const rows = weekRows.filter((r) => r.team_id === teamId);
    const programsOn = rows.some((r) => weekDaysHaveSessions(r.days))
      ? await isTrainingCellsEnabledForTeam(supabase, teamId) : false;
    const { facilityTier, staff } = await loadTrainingStaffContext(supabase, teamId);
    teamCtx.set(teamId, {
      teamWeekDays: rows.find((r) => r.rider_id == null)?.days ?? null,
      overrideByRider: new Map(rows.filter((r) => r.rider_id != null).map((r) => [r.rider_id, r.days])),
      programsOn, facilityTier, staff,
    });
  }

  const daysByRider = new Map();
  for (const d of lost) {
    if (!daysByRider.has(d.riderId)) daysByRider.set(d.riderId, []);
    daysByRider.get(d.riderId).push(d);
  }
  const plans = new Map();
  for (const [riderId, days] of daysByRider) {
    const rider = riderById.get(riderId);
    const abilityRow = abilityById.get(riderId);
    if (!rider || !abilityRow) { plans.set(riderId, { skipped: "missing_rider", days }); continue; }
    if (rider.is_retired) { plans.set(riderId, { skipped: "retired", days }); continue; }
    // Planen/ugeplanen tilhoerer det hold han traenede for 28/9.
    const ctx = teamCtx.get(days[0].teamId);
    const plan = planByRider.get(riderId);
    const result = simulateRiderRepair({
      rider, abilityRow, days,
      plan: plan && plan.team_id === days[0].teamId ? plan : null,
      teamWeekDays: ctx.teamWeekDays, riderOverrideDays: ctx.overrideByRider.get(riderId) ?? null,
      programsOn: ctx.programsOn, staff: ctx.staff, facilityTier: ctx.facilityTier,
      seasonNumber: season.number,
    });
    plans.set(riderId, { ...result, days, teamId: days[0].teamId });
  }
  return { plans, teamById, riderById };
}

/** jsonb-sammenligning uafhaengig af noegle-raekkefoelge. */
export function sameProgress(a, b) {
  const norm = (o) => JSON.stringify(Object.keys(o ?? {}).sort().map((k) => [k, Number(o[k])]));
  return norm(a) === norm(b);
}

function stamp(now) {
  return now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function renderMarkdown({ summary, now, alreadyMarked, legitRest }) {
  const rows = summary.byCategory.map((c) => `| ${c.category} | ${c.riderDays} | ${c.riders} | ${c.teams} |`).join("\n");
  return `# #5912 dry-run: tabte traeningsdage 28/9

Koert: ${now.toISOString()} (READ-ONLY, ingen skrivninger).

## Omfang
- Tabte rytter-loebsdage: **${summary.riderDays}**
  - regel A (fri loebsdag paa en dato med etape): ${summary.byKind.free_slot}
  - koerte etape, men fik hvile (ungdomsloeb-opslaget): ${summary.byKind.raced_missed}
- Ryttere: **${summary.riders}**, hold: **${summary.teams}**
- Allerede markeret af en tidligere apply: ${alreadyMarked.length}
- Aegte hviledage i etapeloeb (ingen etape paa datoen, roeres ikke): ${legitRest}
- Sprunget over (pensioneret / mangler data): ${summary.skipped}

| Hold / trup | Rytter-loebsdage | Ryttere | Hold |
|---|---|---|---|
${rows}

## Evne-gevinst
Forventet gevinst pr. rytter (min/median/max) er beregnet med samme motor som
sweepen, men staar kun i den gitignorerede detaljefil under \`balance-internals/5912/\`
(offentligt repo: ingen maalte fordelinger fra motoren her). Kvalitativt: de
fleste seniorryttere mistede én loebsdag og faar typisk under ét helt evnepoint;
gevinsten ligger da i fremdriftsbaren. Ungdomsryttere mistede flere loebsdage og
faar mere.

## Afgraensning
- Traethed og form roeres ikke (#5928, gennemfoert separat).
- Gevinsten regnes oven paa rytterens nuvaerende evner, ikke tilstanden 28/9.
- Apply kraever \`--apply --owner-go --expect-rider-days=${summary.riderDays}\`.
`;
}

/**
 * Optimistisk vagt: praecis de evner der stiger skal staa uaendret, og fremdriften med.
 * En evne der var NULL (fx holdarbejde/lederskab paa aeldre ryttere, #5268) mangler i
 * `before`; den vagtes med IS NULL. `.eq(k, undefined)` matchede aldrig (#5912, 11 ryttere).
 */
export function guardAbilityUpdate(query, p) {
  let q = query;
  for (const k of Object.keys(p.patch)) {
    if (k === "ability_progress") continue;
    q = p.before[k] == null ? q.is(k, null) : q.eq(k, p.before[k]);
  }
  // Ogsaa fremdriften skal staa uaendret: mange ryttere faar kun en progress-patch.
  return p.beforeProgress == null
    ? q.is("ability_progress", null)
    : q.eq("ability_progress", JSON.stringify(p.beforeProgress));
}

async function applyPlans(supabase, { plans, runs, season, now, privateDir }) {
  const at = now.toISOString();
  const applicable = [...plans.entries()].filter(([, p]) => !p.skipped && p.patch);
  // 1) Backup FOER noget skrives.
  const riderIds = applicable.map(([id]) => id);
  const backupAbilities = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase.from("rider_derived_abilities")
    .select("*").in("rider_id", chunk).order("rider_id"));
  const runIds = new Set(applicable.flatMap(([, p]) => p.days.map((d) => d.runId)));
  const backupRuns = runs.filter((r) => runIds.has(r.id));
  const backupPath = resolve(privateDir, `backup-${stamp(now)}.json`);
  writeFileSync(backupPath, JSON.stringify({ at, abilities: backupAbilities, runs: backupRuns }) + "\n");
  console.log(`backup: ${backupPath}`);

  // 2) Claim: markoer "claimed" paa alle noegler. En claim blokerer en ny koersel.
  const keysByRun = new Map();
  for (const [, p] of applicable) for (const d of p.days) {
    if (!keysByRun.has(d.runId)) keysByRun.set(d.runId, new Set());
    keysByRun.get(d.runId).add(d.key);
  }
  const runById = new Map(runs.map((r) => [r.id, r]));
  for (const [runId, keys] of keysByRun) {
    const run = runById.get(runId);
    const report = withMarkers(run.report, { gameDay: run.game_day, seasonId: season.id, keys, status: "claimed", at });
    const { error } = await supabase.from("training_day_runs").update({ report }).eq("id", runId);
    if (error) throw new Error(`claim run ${runId}: ${error.message}`);
    run.report = report;
  }

  // 3) Skriv evner med optimistisk vagt (praecis de evner der stiger skal staa uaendret).
  const outcome = new Map();
  for (const [riderId, p] of applicable) {
    const query = guardAbilityUpdate(
      supabase.from("rider_derived_abilities").update(p.patch).eq("rider_id", riderId), p);
    const { data, error } = await query.select("rider_id");
    const result = error ? `error:${error.message}` : (data?.length === 1 ? "applied" : "conflict");
    outcome.set(riderId, result);
    if (result !== "applied") console.error(`rider ${riderId}: ${result}`);
  }

  // 4) Afslut markoerer: applied, eller released saa en ny koersel kan proeve igen.
  for (const [runId, keys] of keysByRun) {
    const run = runById.get(runId);
    const appliedKeys = new Set([...keys].filter((k) => outcome.get(k.split(":").at(-1)) === "applied"));
    const releasedKeys = new Set([...keys].filter((k) => !appliedKeys.has(k)));
    let report = withMarkers(run.report, { gameDay: run.game_day, seasonId: season.id, keys: appliedKeys, status: "applied", at });
    report = withMarkers(report, { gameDay: run.game_day, seasonId: season.id, keys: releasedKeys, status: "released", at });
    const { error } = await supabase.from("training_day_runs").update({ report }).eq("id", runId);
    if (error) console.error(`finalize run ${runId}: ${error.message} - marker stays 'claimed', check manually`);
  }

  // 5) Verify: genlaes og sammenlign med det planlagte.
  const after = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase.from("rider_derived_abilities")
    .select("*").in("rider_id", chunk).order("rider_id"));
  const afterById = new Map(after.map((a) => [a.rider_id, a]));
  let verified = 0;
  let mismatched = 0;
  for (const [riderId, p] of applicable) {
    if (outcome.get(riderId) !== "applied") continue;
    const row = afterById.get(riderId);
    const ok = Object.keys(p.patch).every((k) => (k === "ability_progress"
      ? sameProgress(row?.ability_progress, p.patch.ability_progress)
      : Number(row?.[k]) === Number(p.patch[k])));
    if (ok) verified += 1; else mismatched += 1;
  }
  const counts = {};
  for (const v of outcome.values()) counts[v.startsWith("error") ? "error" : v] = (counts[v.startsWith("error") ? "error" : v] ?? 0) + 1;
  return { counts, verified, mismatched, backupPath };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY missing");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const now = new Date();
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const privateDir = resolve(repoRoot, "balance-internals/5912");
  mkdirSync(privateDir, { recursive: true });

  const state = await loadState(supabase);
  const classified = classifyLostRiderDays(state);
  const { alreadyMarked, legitRest } = classified;
  const planned = await planAll(supabase, { lost: classified.lost, season: state.season });
  const { teamById, riderById } = planned;
  // Ejer 1/10: --human-only genopretter kun menneskehold.
  const { lost, plans } = opts.humanOnly
    ? onlyHumanTeams({ lost: classified.lost, plans: planned.plans, teamById })
    : { lost: classified.lost, plans: planned.plans };
  const summary = summarizePlan({ lost, plans, teamById, riderById });

  const detailPath = resolve(privateDir, `dry-run-${stamp(now)}.json`);
  writeFileSync(detailPath, JSON.stringify({
    at: now.toISOString(), summary, alreadyMarked,
    riders: [...plans.entries()].map(([riderId, p]) => ({
      riderId, teamId: p.teamId, skipped: p.skipped ?? null, totalPoints: p.totalPoints ?? 0, totalProgress: p.totalProgress ?? 0,
      gains: p.gains ?? {}, perDay: p.perDay ?? [],
    })),
  }, null, 2) + "\n");

  if (!opts.apply) {
    const mdPath = resolve(repoRoot, `docs/snapshots/5912/dry-run-${stamp(now)}.md`);
    mkdirSync(dirname(mdPath), { recursive: true });
    writeFileSync(mdPath, renderMarkdown({ summary, now, alreadyMarked, legitRest }));
    console.log(JSON.stringify({ dryRun: true, written: 0, summary, md: mdPath, detail: detailPath }, null, 2));
    return;
  }

  const todayCloseComplete = await loadTodayCloseComplete(supabase, now);
  assertApplyAllowed({ opts, plannedRiderDays: summary.riderDays, now, todayCloseComplete });
  const result = await applyPlans(supabase, { plans, runs: state.runs, season: state.season, now, privateDir });
  console.log(JSON.stringify({ applied: true, ...result }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
