// #7684 (#6110 byggetrin 4): én prognose-kilde. Spec
// docs/superpowers/specs/2026-10-23-6110-potentiale-et-tal-samlet-design.md §3, §8, §11.
//
// Læse-siden af det gemte skøn pr. (rytter, hold). Med potential_estimate_display
// tændt svarer estimates, scouting-rapporten, development-projection og akademiet
// herfra, så de tre gamle prognosemodeller ikke længere når klienten. Ruterne kalder
// først hertil, når flaget er tændt: slukket når intet opslag denne fil.
//
// Svarfeltet hedder potentialView, fordi potentialEstimate er optaget af akademiets
// stjerne-estimat i intake-listen:
//   { hidden:false, value, certainty, previousValue, previousCertainty, changedAt }
//   { hidden:true, reason:'unscouted' }
//   { hidden:true, reason:'learning', trainings, trainingsNeeded }
//
// Gate H4: usikkerheden, vidensniveauet og det loft skønnet blev skrevet med forlader
// aldrig serveren. Derfor læses de kolonner slet ikke her.

//
// #8523 (spec 2026-11-20 §5): egne ryttere får desuden prognosisView, den samlede
// prognose "fortsætter du den nuværende fart, ender du omkring her ved toppen":
//   { hidden:false, value }
//   { hidden:true, reason:'noEstimate' | 'pastPeak' }
// Andres ryttere får aldrig feltet. Ryttere på et AI-hold kan ikke scoutes, så uden
// et gemt skøn svarer de { hidden:true, reason:'aiTeam' } i stedet for 'unscouted'.

import { publicEstimateView } from "./potentialEstimate.js";
import { PEAK_AGE } from "./developmentProjection.js";
import { loadPastPeakAging, pastPeakFromAging } from "./pastPeakView.js"; // #7947: efter peak som motoren
import { buildVerdict, ratingFromAbilities } from "./scoutingReport.js";
import { REGISTRY_ABILITY_KEYS } from "./abilityRegistry.js";
import { bestRoleForAbilities } from "./riderBestRoleCache.js";
import { fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { PROGNOSIS_PACE_DAYS, pacePrognosis } from "./riderPrognosis.js";
import { resolveScoutBandSeasonNumber, scoutBandAge } from "./scoutBandAge.js";
import { roleOutputRaw } from "./weights/displayRecipes.js";

// Spec §3.4 + S18: egen ungdomsrytter får sit første skøn efter så mange afregnede
// datoer på holdet. Står i spillerens tekst ("Læres · x af 5"), så tallet er offentligt.
export const TRAININGS_NEEDED = 5;

// Bevidst kun de visningsfelter publicEstimateView bruger.
const ESTIMATE_COLUMNS = "rider_id, value, certainty, previous_value, previous_certainty, changed_at";

// Kun de viste evner: ability_caps og hidden_potential på samme række skal ikke læses her.
const ABILITY_COLUMNS = `rider_id, ${REGISTRY_ABILITY_KEYS.join(", ")}`;

const UNSCOUTED = Object.freeze({ hidden: true, reason: "unscouted" });
const AI_TEAM = Object.freeze({ hidden: true, reason: "aiTeam" });

// Rapportens vurdering må ikke påstå en anden sikkerhed end ordet ved tallet.
const VERDICT_CONFIDENCE = Object.freeze({ sure: "high", fair: "medium", unsure: "low" });

// Ren funktion. Et gemt skøn vinder altid: holdet beholder sin viden, også hvis det
// scoutede rytteren før han kom til holdet, eller efter han har forladt det (S19).
export function buildPotentialView({ row = null, currentRating = null, learningYouth = false, trainings = 0, aiTeam = false } = {}) {
  if (row) {
    const view = publicEstimateView(row, { currentRating });
    if (!view.hidden) return view;
  }
  if (learningYouth && trainings < TRAININGS_NEEDED) {
    return { hidden: true, reason: "learning", trainings, trainingsNeeded: TRAININGS_NEEDED };
  }
  return aiTeam ? AI_TEAM : UNSCOUTED;
}

// Afregnede datoer på holdet (S18). Samme tælling som harnessen kalibreres på: forskellige
// tick_date, ikke rækker, fordi én dato kan dække flere løbsdage.
async function loadTrainingDates(supabase, { teamId, riderIds }) {
  const datesByRider = new Map(riderIds.map((id) => [id, new Set()]));
  if (!riderIds.length) return datesByRider;
  const ticks = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase
    .from("training_rider_ticks")
    .select("rider_id, tick_date")
    .eq("team_id", teamId)
    .in("rider_id", chunk)
    .order("rider_id")
    .order("season_id")
    .order("game_day"));
  for (const tick of ticks) datesByRider.get(tick.rider_id)?.add(tick.tick_date);
  return datesByRider;
}

// Rytterens rating lige nu. riders.best_role_rating opdateres af værdikørslen, ikke af den
// daglige træning, så den kan halte efter, og gulvet skal følge det spilleren ser nu.
function currentRating(rider, abilities) {
  const live = abilities
    ? bestRoleForAbilities(abilities, { primaryType: rider.primary_type, secondaryType: rider.secondary_type }).best_role_rating
    : null;
  return live ?? rider.best_role_rating ?? null;
}

// Holdets skøn for en liste ryttere. Kun holdets egne rækker læses, så et andet holds
// skøn aldrig kan nå svaret. Ukendte rytter-id'er er ikke med i resultatet.
// Hold der styres af spillet. Kun andres hold slås op: eget hold er aldrig et AI-hold.
async function loadAiTeamIds(supabase, { teamId, riderRows }) {
  const teamIds = [...new Set(riderRows.map((rider) => rider.team_id).filter((id) => id && id !== teamId))];
  if (!teamIds.length) return new Set();
  const teams = await fetchAllRowsChunkedIn(teamIds, (chunk) => supabase
    .from("teams").select("id, is_ai").in("id", chunk).order("id"));
  return new Set(teams.filter((team) => team.is_ai === true).map((team) => team.id));
}

async function loadEstimateContext(supabase, { teamId, riderIds }) {
  const ids = [...new Set((riderIds ?? []).filter(Boolean))];
  if (!ids.length) return { abilities: new Map(), ratings: new Map(), views: new Map(), riderRows: [] };
  const [riderRows, estimateRows, abilityRows] = await Promise.all([
    fetchAllRowsChunkedIn(ids, (chunk) => supabase
      .from("riders").select("id, team_id, is_academy, birthdate, primary_type, secondary_type, best_role_rating").in("id", chunk).order("id")),
    fetchAllRowsChunkedIn(ids, (chunk) => supabase
      .from("rider_potential_estimates").select(ESTIMATE_COLUMNS).eq("team_id", teamId).in("rider_id", chunk).order("rider_id")),
    fetchAllRowsChunkedIn(ids, (chunk) => supabase
      .from("rider_derived_abilities").select(ABILITY_COLUMNS).in("rider_id", chunk).order("rider_id")),
  ]);
  const abilities = new Map(abilityRows.map((row) => [row.rider_id, row]));
  const ratings = new Map(riderRows.map((rider) => [rider.id, currentRating(rider, abilities.get(rider.id))]));
  const rows = new Map(estimateRows.map((row) => [row.rider_id, row]));
  const isLearningYouth = (rider) => rider.team_id === teamId && rider.is_academy === true;
  const [dates, aiTeamIds] = await Promise.all([
    loadTrainingDates(supabase, {
      teamId,
      riderIds: riderRows.filter((rider) => isLearningYouth(rider) && !rows.has(rider.id)).map((rider) => rider.id),
    }),
    loadAiTeamIds(supabase, { teamId, riderRows: riderRows.filter((rider) => !rows.has(rider.id)) }),
  ]);
  const views = new Map(riderRows.map((rider) => [rider.id, buildPotentialView({
    row: rows.get(rider.id),
    currentRating: ratings.get(rider.id),
    learningYouth: isLearningYouth(rider),
    trainings: dates.get(rider.id)?.size ?? 0,
    aiTeam: aiTeamIds.has(rider.team_id),
  })]));
  return { abilities, ratings, views, riderRows };
}

export async function loadPotentialViews(supabase, { teamId, riderIds }) {
  return (await loadEstimateContext(supabase, { teamId, riderIds })).views;
}

// ── Samlet prognose for egne ryttere (#8523) ─────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const NO_ESTIMATE = Object.freeze({ hidden: true, reason: "noEstimate" });
const PAST_PEAK = Object.freeze({ hidden: true, reason: "pastPeak" });

const isoDay = (date) => date.toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

// Rytterens bedste rolle nu, ratingen i den rolle nu og ratingen i SAMME rolle, da
// farten-vinduet startede. Samme rolle i begge ender, så et rolleskifte ikke ligner fart.
// Rå (urundede) ratings, så en lille fremgang over vinduet ikke rundes væk.
function paceInputs(rider, liveAbilities, snapshots, today) {
  if (!liveAbilities) return null;
  const { best_role: role } = bestRoleForAbilities(liveAbilities, {
    primaryType: rider.primary_type, secondaryType: rider.secondary_type,
  });
  if (!role) return null;
  const now = roleOutputRaw(liveAbilities, role);
  if (now == null) return null;
  const windowStart = isoDay(new Date(Date.parse(today) - PROGNOSIS_PACE_DAYS * DAY_MS));
  // Seneste billede fra før vinduet; ellers det ældste i vinduet. Uden billeder har
  // rytteren ingen registreret fremgang i vinduet, og farten er nul.
  const sorted = [...(snapshots ?? [])].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const baseline = sorted.filter((row) => row.snapshot_date <= windowStart).at(-1) ?? sorted[0] ?? null;
  const past = baseline ? roleOutputRaw(baseline.abilities ?? {}, role) : null;
  const daysAgo = baseline ? daysBetween(baseline.snapshot_date, today) : null;
  return { now, past, daysAgo };
}

// Evne-billeder fra lidt før farten-vinduet og frem, kun for de ryttere der skal bruge dem.
async function loadPaceSnapshots(supabase, { riderIds, today }) {
  const byRider = new Map(riderIds.map((id) => [id, []]));
  if (!riderIds.length) return byRider;
  const since = isoDay(new Date(Date.parse(today) - 2 * PROGNOSIS_PACE_DAYS * DAY_MS));
  const rows = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase
    .from("rider_derived_ability_history")
    .select("rider_id, snapshot_date, abilities")
    .in("rider_id", chunk)
    .gte("snapshot_date", since)
    .order("rider_id")
    .order("snapshot_date")
    // Tabellen er kun unik på (rider_id, snapshot_date, source): uden source
    // er sorteringen ikke entydig, og offset-paginering kan springe en række
    // over eller tage den med to gange ved en sidegrænse.
    .order("source"));
  for (const row of rows) byRider.get(row.rider_id)?.push(row);
  return byRider;
}

// prognosisView pr. egen rytter. Andres ryttere er ikke med i resultatet.
async function loadPrognosisViews(supabase, { teamId, context, clock = new Date() }) {
  const out = new Map();
  const own = context.riderRows.filter((rider) => rider.team_id === teamId);
  const ready = own.filter((rider) => {
    const view = context.views.get(rider.id);
    if (!view || view.hidden) out.set(rider.id, NO_ESTIMATE);
    return out.get(rider.id) == null;
  });
  if (!ready.length) return out;
  const seasonNumber = await resolveScoutBandSeasonNumber(supabase);
  const today = isoDay(clock);
  const ages = new Map(ready.map((rider) => [rider.id, scoutBandAge(rider.birthdate, seasonNumber)]));
  const growing = ready.filter((rider) => {
    const age = ages.get(rider.id);
    if (age == null) out.set(rider.id, NO_ESTIMATE);
    else if (age > PEAK_AGE) out.set(rider.id, PAST_PEAK);
    return out.get(rider.id) == null;
  });
  const snapshots = await loadPaceSnapshots(supabase, { riderIds: growing.map((rider) => rider.id), today });
  for (const rider of growing) {
    const inputs = paceInputs(rider, context.abilities.get(rider.id), snapshots.get(rider.id), today);
    const value = inputs
      ? pacePrognosis({ ...inputs, estimate: context.views.get(rider.id).value, age: ages.get(rider.id) })
      : null;
    out.set(rider.id, value == null ? NO_ESTIMATE : { hidden: false, value });
  }
  return out;
}

// POST /scouting/estimates. Skønnet står alene: de gamle bånd er en anden kilde.
// Egne ryttere får prognosen med, så alle flader læser den samme.
export async function buildEstimatesFromViews(supabase, { teamId, riderIds, clock = new Date() } = {}) {
  const context = await loadEstimateContext(supabase, { teamId, riderIds });
  const prognoses = await loadPrognosisViews(supabase, { teamId, context, clock });
  return Object.fromEntries([...context.views].map(([riderId, potentialView]) => [
    riderId,
    prognoses.has(riderId) ? { potentialView, prognosisView: prognoses.get(riderId) } : { potentialView },
  ]));
}

function estimateVerdict({ view, age, own, level, maxLevel, rating }) {
  if (view.hidden || age == null || rating == null) return null;
  return {
    ...buildVerdict({ age, own, level, maxLevel, bestNow: rating, bestCeilMid: view.value }),
    confidence: VERDICT_CONFIDENCE[view.certainty],
  };
}

// GET /riders/:id/scouting-report. `level` er knappens niveau (egen rytter = maxLevel);
// `looks` er de kig holdet faktisk har taget ("bygger på", spec §3.6).
export async function buildScoutingReportFromView(supabase, { teamId, rider, own, level, maxLevel, looks, age, scout, generatedAt, clock = new Date() }) {
  const context = await loadEstimateContext(supabase, { teamId, riderIds: [rider.id] });
  const potentialView = context.views.get(rider.id) ?? UNSCOUTED;
  const rating = context.ratings.get(rider.id) ?? null;
  const prognoses = await loadPrognosisViews(supabase, { teamId, context, clock });
  return {
    potentialView,
    ...(prognoses.has(rider.id) ? { prognosisView: prognoses.get(rider.id) } : {}),
    level, maxLevel, own, looks,
    primaryKey: rider.primary_type ?? null,
    verdict: estimateVerdict({ view: potentialView, age, own, level, maxLevel, rating }),
    pastPeak: pastPeakFromAging(age, await loadPastPeakAging(supabase, { now: clock })), // regel 16: uret injiceres
    scout, generatedAt,
  };
}

// GET /riders/:id/development-projection. #8523: den gamle kurve mod skønnet er væk;
// egne ryttere får den samlede prognose i stedet (spec 2026-11-20 §5).
export async function buildProjectionFromView(supabase, { teamId, rider, own, level, maxLevel, age, clock = new Date() }) {
  const context = await loadEstimateContext(supabase, { teamId, riderIds: [rider.id] });
  const potentialView = context.views.get(rider.id) ?? UNSCOUTED;
  const primaryKey = rider.primary_type ?? null;
  const riderAbilities = context.abilities.get(rider.id);
  const now = riderAbilities && primaryKey ? ratingFromAbilities(riderAbilities, primaryKey) : null;
  const prognoses = await loadPrognosisViews(supabase, { teamId, context, clock });
  return {
    level, maxLevel, own,
    capsMissing: !potentialView.hidden && (now == null || age == null),
    primaryKey,
    now,
    potentialView,
    ...(prognoses.has(rider.id) ? { prognosisView: prognoses.get(rider.id) } : {}),
    pastPeak: pastPeakFromAging(age, await loadPastPeakAging(supabase, { now: clock })), // regel 16: uret injiceres
  };
}

// GET /academy/me. is_serious er generatorens potentiale-mærke, og prognosen er den
// gamle kendskabsmodel: begge ville fortælle mere end holdets skøn.
// #8523: truppen får den samlede prognose (prognosisView) i stedet for den gamle.
export async function buildAcademyFromViews(supabase, { teamId, roster, intake, clock = new Date() }) {
  const candidateId = (item) => item?.riderId ?? item?.rider?.id;
  const context = await loadEstimateContext(supabase, {
    teamId,
    riderIds: [...(roster ?? []).map((rider) => rider.id), ...(intake ?? []).map(candidateId)],
  });
  const prognoses = await loadPrognosisViews(supabase, { teamId, context, clock });
  const viewOf = (riderId) => context.views.get(riderId) ?? UNSCOUTED;
  return {
    roster: (roster ?? []).map((rider) => {
      const safe = {
        ...rider,
        potentialView: viewOf(rider.id),
        ...(prognoses.has(rider.id) ? { prognosisView: prognoses.get(rider.id) } : {}),
      };
      delete safe.prognosis;
      return safe;
    }),
    intake: (intake ?? []).map((item) => ({
      ...item,
      is_serious: false,
      potentialEstimate: null,
      potentialBand: null,
      potentialView: viewOf(candidateId(item)),
    })),
  };
}
