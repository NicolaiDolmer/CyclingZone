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

import { publicEstimateView } from "./potentialEstimate.js";
import { DISPLAY_SEASONS, PEAK_AGE, projectTrack } from "./developmentProjection.js";
import { buildVerdict, ratingFromAbilities } from "./scoutingReport.js";
import { REGISTRY_ABILITY_KEYS } from "./abilityRegistry.js";
import { bestRoleForAbilities } from "./riderBestRoleCache.js";
import { fetchAllRowsChunkedIn } from "./supabasePagination.js";

// Spec §3.4 + S18: egen ungdomsrytter får sit første skøn efter så mange afregnede
// datoer på holdet. Står i spillerens tekst ("Læres · x af 5"), så tallet er offentligt.
export const TRAININGS_NEEDED = 5;

// Bevidst kun de visningsfelter publicEstimateView bruger.
const ESTIMATE_COLUMNS = "rider_id, value, certainty, previous_value, previous_certainty, changed_at";

// Kun de viste evner: ability_caps og hidden_potential på samme række skal ikke læses her.
const ABILITY_COLUMNS = `rider_id, ${REGISTRY_ABILITY_KEYS.join(", ")}`;

const UNSCOUTED = Object.freeze({ hidden: true, reason: "unscouted" });

// Rapportens vurdering må ikke påstå en anden sikkerhed end ordet ved tallet.
const VERDICT_CONFIDENCE = Object.freeze({ sure: "high", fair: "medium", unsure: "low" });

// Ren funktion. Et gemt skøn vinder altid: holdet beholder sin viden, også hvis det
// scoutede rytteren før han kom til holdet, eller efter han har forladt det (S19).
export function buildPotentialView({ row = null, currentRating = null, learningYouth = false, trainings = 0 } = {}) {
  if (row) {
    const view = publicEstimateView(row, { currentRating });
    if (!view.hidden) return view;
  }
  if (learningYouth && trainings < TRAININGS_NEEDED) {
    return { hidden: true, reason: "learning", trainings, trainingsNeeded: TRAININGS_NEEDED };
  }
  return UNSCOUTED;
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
async function loadEstimateContext(supabase, { teamId, riderIds }) {
  const ids = [...new Set((riderIds ?? []).filter(Boolean))];
  if (!ids.length) return { abilities: new Map(), ratings: new Map(), views: new Map() };
  const [riderRows, estimateRows, abilityRows] = await Promise.all([
    fetchAllRowsChunkedIn(ids, (chunk) => supabase
      .from("riders").select("id, team_id, is_academy, primary_type, secondary_type, best_role_rating").in("id", chunk).order("id")),
    fetchAllRowsChunkedIn(ids, (chunk) => supabase
      .from("rider_potential_estimates").select(ESTIMATE_COLUMNS).eq("team_id", teamId).in("rider_id", chunk).order("rider_id")),
    fetchAllRowsChunkedIn(ids, (chunk) => supabase
      .from("rider_derived_abilities").select(ABILITY_COLUMNS).in("rider_id", chunk).order("rider_id")),
  ]);
  const abilities = new Map(abilityRows.map((row) => [row.rider_id, row]));
  const ratings = new Map(riderRows.map((rider) => [rider.id, currentRating(rider, abilities.get(rider.id))]));
  const rows = new Map(estimateRows.map((row) => [row.rider_id, row]));
  const isLearningYouth = (rider) => rider.team_id === teamId && rider.is_academy === true;
  const dates = await loadTrainingDates(supabase, {
    teamId,
    riderIds: riderRows.filter((rider) => isLearningYouth(rider) && !rows.has(rider.id)).map((rider) => rider.id),
  });
  const views = new Map(riderRows.map((rider) => [rider.id, buildPotentialView({
    row: rows.get(rider.id),
    currentRating: ratings.get(rider.id),
    learningYouth: isLearningYouth(rider),
    trainings: dates.get(rider.id)?.size ?? 0,
  })]));
  return { abilities, ratings, views };
}

export async function loadPotentialViews(supabase, { teamId, riderIds }) {
  return (await loadEstimateContext(supabase, { teamId, riderIds })).views;
}

// POST /scouting/estimates. Skønnet står alene: de gamle bånd er en anden kilde.
export async function buildEstimatesFromViews(supabase, { teamId, riderIds }) {
  const views = await loadPotentialViews(supabase, { teamId, riderIds });
  return Object.fromEntries([...views].map(([riderId, potentialView]) => [riderId, { potentialView }]));
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
export async function buildScoutingReportFromView(supabase, { teamId, rider, own, level, maxLevel, looks, age, scout, generatedAt }) {
  const { ratings, views } = await loadEstimateContext(supabase, { teamId, riderIds: [rider.id] });
  const potentialView = views.get(rider.id) ?? UNSCOUTED;
  const rating = ratings.get(rider.id) ?? null;
  return {
    potentialView,
    level, maxLevel, own, looks,
    primaryKey: rider.primary_type ?? null,
    verdict: estimateVerdict({ view: potentialView, age, own, level, maxLevel, rating }),
    pastPeak: age != null && age > PEAK_AGE,
    scout, generatedAt,
  };
}

// Kurven mod skønnet som én linje (spec §3.6). Samme offentlige alderskurve som den gamle
// projektion, men uden envelopes: et bånd ville være et interval ad bagvejen.
export function buildEstimateLine({ now, value, age, seasons = DISPLAY_SEASONS }) {
  return projectTrack(now, value, age, seasons).map((point) => ({ season: point.season, value: Math.round(point.value) }));
}

// GET /riders/:id/development-projection.
export async function buildProjectionFromView(supabase, { teamId, rider, own, level, maxLevel, age }) {
  const { abilities, views } = await loadEstimateContext(supabase, { teamId, riderIds: [rider.id] });
  const potentialView = views.get(rider.id) ?? UNSCOUTED;
  const primaryKey = rider.primary_type ?? null;
  const riderAbilities = abilities.get(rider.id);
  const now = riderAbilities && primaryKey ? ratingFromAbilities(riderAbilities, primaryKey) : null;
  const canDraw = !potentialView.hidden && now != null && age != null;
  return {
    level, maxLevel, own,
    capsMissing: !potentialView.hidden && !canDraw,
    primaryKey,
    now,
    estimateLine: canDraw ? buildEstimateLine({ now, value: potentialView.value, age }) : [],
    potentialView,
    pastPeak: age != null && age > PEAK_AGE,
  };
}

// GET /academy/me. is_serious er generatorens potentiale-mærke, og prognosen er den
// gamle kendskabsmodel: begge ville fortælle mere end holdets skøn.
export async function buildAcademyFromViews(supabase, { teamId, roster, intake }) {
  const candidateId = (item) => item?.riderId ?? item?.rider?.id;
  const views = await loadPotentialViews(supabase, {
    teamId,
    riderIds: [...(roster ?? []).map((rider) => rider.id), ...(intake ?? []).map(candidateId)],
  });
  const viewOf = (riderId) => views.get(riderId) ?? UNSCOUTED;
  return {
    roster: (roster ?? []).map((rider) => {
      const safe = { ...rider, potentialView: viewOf(rider.id) };
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
