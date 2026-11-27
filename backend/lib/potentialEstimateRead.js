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
// #8855: 'learning' sendes ikke længere for potentialet; frontend tåler den stadig.
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
import { ESTIMATE_RIDER_COLUMNS, loadEstimateWriteConfig, writeTeamEstimates } from "./potentialEstimateWriter.js"; // #8855
import { captureException } from "./sentry.js";
import { PEAK_AGE } from "./developmentProjection.js";
import { loadPastPeakAging, pastPeakFromAging } from "./pastPeakView.js"; // #7947: efter peak som motoren
import { mergeDevelopmentSnapshots } from "./riderDevelopmentReceipt.js";
import { buildTypePrognosisBands, buildVerdict, ratingFromAbilities } from "./scoutingReport.js";
import { REGISTRY_ABILITY_KEYS } from "./abilityRegistry.js";
import { bestRoleForAbilities } from "./riderBestRoleCache.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { PROGNOSIS_PACE_DAYS, pacePrognosis } from "./riderPrognosis.js";
import { resolveScoutBandSeasonNumber, scoutBandAge } from "./scoutBandAge.js";
import { roleOutputRaw } from "./weights/displayRecipes.js";

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
// #8855 (ejer 27/11): potentialet "læres" aldrig. En egen rytter får sit skøn fra dag ét
// (fillMissingOwnEstimates herunder); "Læres" hører kun til prognosen.
export function buildPotentialView({ row = null, currentRating = null, aiTeam = false } = {}) {
  if (row) {
    const view = publicEstimateView(row, { currentRating });
    if (!view.hidden) return view;
  }
  return aiTeam ? AI_TEAM : UNSCOUTED;
}

// #8855: en egen rytter uden gemt skøn (lige købt, nyt akademitalent, eller fra før
// reglen) får det skrevet ved første visning, med samme writer og samme regler som
// holdskifte-sweepet og søndagskørslen. Grunden er "backfill": den skriver kun, hvor
// intet er gemt, og flytter aldrig et eksisterende tal. Bag writerens egen kontakt
// (potential_estimate_writes) og kalibrering: uden dem skrives intet.
//
// Best-effort: visningen fejler aldrig af den grund. En rytter der stadig mangler et
// skøn efter et forsøg (intet sandt tal, kontakten slukket, fejl), prøves først igen
// efter en pause, så en liste ikke regner writeren igennem ved hvert opslag.
const FILL_RETRY_MS = 60 * 60 * 1000;
const fillRetryAt = new Map();

export async function fillMissingOwnEstimates(supabase, { teamId, riderIds, clock = new Date() }) {
  const nowMs = clock.getTime();
  const due = riderIds.filter((id) => (fillRetryAt.get(`${teamId}:${id}`) ?? 0) <= nowMs);
  if (!due.length) return [];
  for (const id of due) fillRetryAt.set(`${teamId}:${id}`, nowMs + FILL_RETRY_MS);
  try {
    const config = await loadEstimateWriteConfig(supabase, { now: clock });
    if (!config.enabled) return [];
    // schema-columns-ok: talent_ceiling kommer fra 2026-11-04-6110-potential-estimates.sql, snapshottet er ældre
    const riders = await fetchAllRowsChunkedIn(due, (chunk) => supabase
      .from("riders").select(ESTIMATE_RIDER_COLUMNS).eq("team_id", teamId).in("id", chunk).order("id"));
    if (!riders.length) return [];
    await writeTeamEstimates({ supabase, teamId, riders, trigger: "backfill", config, now: clock });
    const written = await fetchAllRowsChunkedIn(due, (chunk) => supabase
      .from("rider_potential_estimates").select(ESTIMATE_COLUMNS).eq("team_id", teamId).in("rider_id", chunk).order("rider_id"));
    for (const row of written) fillRetryAt.delete(`${teamId}:${row.rider_id}`);
    return written;
  } catch (err) {
    // best-effort: visningen svarer uden skønnet, og pausen bremser gentagelser; holdskifte-
    // sweepet og søndagskørslen skriver det ellers. Kun antal og hold logges, aldrig tal.
    console.error(`  potential estimate fill on read failed for team ${teamId} (${due.length} riders):`, err.message);
    captureException(err, { tags: { flow: "potential-estimate", stage: "fill-on-read" }, teamId });
    return [];
  }
}

// Kun til tests: glemmer pauserne mellem forsøg.
export function resetFillRetriesForTests() {
  fillRetryAt.clear();
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

async function loadEstimateContext(supabase, { teamId, riderIds, clock = new Date(), fillMissing = fillMissingOwnEstimates }) {
  const ids = [...new Set((riderIds ?? []).filter(Boolean))];
  if (!ids.length) return { abilities: new Map(), ratings: new Map(), views: new Map(), riderRows: [] };
  const [riderRows, estimateRows, abilityRows] = await Promise.all([
    fetchAllRowsChunkedIn(ids, (chunk) => supabase
      .from("riders").select("id, team_id, birthdate, primary_type, secondary_type, best_role_rating").in("id", chunk).order("id")),
    fetchAllRowsChunkedIn(ids, (chunk) => supabase
      .from("rider_potential_estimates").select(ESTIMATE_COLUMNS).eq("team_id", teamId).in("rider_id", chunk).order("rider_id")),
    fetchAllRowsChunkedIn(ids, (chunk) => supabase
      .from("rider_derived_abilities").select(ABILITY_COLUMNS).in("rider_id", chunk).order("rider_id")),
  ]);
  const abilities = new Map(abilityRows.map((row) => [row.rider_id, row]));
  const ratings = new Map(riderRows.map((rider) => [rider.id, currentRating(rider, abilities.get(rider.id))]));
  const rows = new Map(estimateRows.map((row) => [row.rider_id, row]));
  const missingOwn = riderRows.filter((rider) => rider.team_id === teamId && !rows.has(rider.id)).map((rider) => rider.id);
  const [filled, aiTeamIds] = await Promise.all([
    missingOwn.length && fillMissing ? fillMissing(supabase, { teamId, riderIds: missingOwn, clock }) : [],
    loadAiTeamIds(supabase, { teamId, riderRows: riderRows.filter((rider) => !rows.has(rider.id)) }),
  ]);
  for (const row of filled) rows.set(row.rider_id, row);
  const views = new Map(riderRows.map((rider) => [rider.id, buildPotentialView({
    row: rows.get(rider.id),
    currentRating: ratings.get(rider.id),
    aiTeam: aiTeamIds.has(rider.team_id),
  })]));
  return { abilities, ratings, views, riderRows };
}

export async function loadPotentialViews(supabase, { teamId, riderIds, clock = new Date(), fillMissing = fillMissingOwnEstimates }) {
  return (await loadEstimateContext(supabase, { teamId, riderIds, clock, fillMissing })).views;
}

// Only public rider IDs enter this read. Fetch the requesting team's estimate
// rows first, then load live ratings only for its matching scouted riders.
export async function sortScoutedRiderPage(supabase, { teamId, riderIds, page, pageSize, ascending }) {
  const candidates = new Set(riderIds);
  if (!candidates.size) return { ids: [], count: 0 };
  const estimates = await fetchAllRows(() => supabase
    .from("rider_potential_estimates").select("rider_id, value, certainty")
    .eq("team_id", teamId).order("rider_id"));
  const visible = estimates.filter((row) => candidates.has(row.rider_id) && !publicEstimateView(row).hidden);
  const ids = visible.map((row) => row.rider_id);
  const [riders, abilities] = await Promise.all([
    fetchAllRowsChunkedIn(ids, (chunk) => supabase.from("riders")
      .select("id, primary_type, secondary_type, best_role_rating").in("id", chunk).order("id")),
    fetchAllRowsChunkedIn(ids, (chunk) => supabase.from("rider_derived_abilities")
      .select(ABILITY_COLUMNS).in("rider_id", chunk).order("rider_id")),
  ]);
  const abilitiesById = new Map(abilities.map((row) => [row.rider_id, row]));
  const estimateById = new Map(visible.map((row) => [row.rider_id, row]));
  const values = new Map(riders.map((rider) => [
    rider.id,
    publicEstimateView(estimateById.get(rider.id), {
      currentRating: currentRating(rider, abilitiesById.get(rider.id)),
    }).value,
  ]));
  const ordered = [...candidates].sort((a, b) => {
    const av = values.get(a);
    const bv = values.get(b);
    if (av == null) return bv == null ? a.localeCompare(b) : 1;
    if (bv == null) return -1;
    return (ascending ? av - bv : bv - av) || a.localeCompare(b);
  });
  const from = (page - 1) * pageSize;
  return { ids: ordered.slice(from, from + pageSize), count: ordered.length };
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
  const role = bestRoleOf(rider, liveAbilities);
  if (!role) return null;
  return rolePaceInputs(role, liveAbilities, paceBaseline(snapshots, today));
}

function bestRoleOf(rider, liveAbilities) {
  return bestRoleForAbilities(liveAbilities, {
    primaryType: rider.primary_type, secondaryType: rider.secondary_type,
  }).best_role ?? null;
}

// Farten-vinduets startbillede: seneste billede fra før vinduet, ellers det ældste i
// vinduet. Uden billeder har rytteren ingen registreret fremgang, og farten er nul.
function paceBaseline(snapshots, today) {
  const windowStart = isoDay(new Date(Date.parse(today) - PROGNOSIS_PACE_DAYS * DAY_MS));
  const sorted = [...(snapshots ?? [])].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const baseline = sorted.filter((row) => row.snapshot_date <= windowStart).at(-1) ?? sorted[0] ?? null;
  return baseline ? { abilities: baseline.abilities ?? {}, daysAgo: daysBetween(baseline.snapshot_date, today) } : null;
}

function rolePaceInputs(role, liveAbilities, baseline) {
  const now = roleOutputRaw(liveAbilities, role);
  if (now == null) return null;
  const past = baseline ? roleOutputRaw(baseline.abilities, role) : null;
  return { now, past, daysAgo: baseline?.daysAgo ?? null };
}

// Evne-billeder fra lidt før farten-vinduet og frem, kun for de ryttere der skal bruge dem.
async function loadPaceSnapshots(supabase, { riderIds, today }) {
  const byRider = new Map(riderIds.map((id) => [id, []]));
  if (!riderIds.length) return byRider;
  const since = isoDay(new Date(Date.parse(today) - 2 * PROGNOSIS_PACE_DAYS * DAY_MS));
  const rows = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase
    .from("rider_derived_ability_history")
    .select("rider_id, snapshot_date, season_number, source, abilities")
    .in("rider_id", chunk)
    .gte("snapshot_date", since)
    .order("rider_id")
    .order("snapshot_date")
    // Tabellen er kun unik på (rider_id, snapshot_date, source): uden source
    // er sorteringen ikke entydig, og offset-paginering kan springe en række
    // over eller tage den med to gange ved en sidegrænse.
    .order("source"));
  // Kalenderdagens række fryser på datoens første gevinst-tick (#5947); datoens sande
  // slut-tilstand ligger i løbsdags-billederne. Samme fletning som udviklingshistorikken,
  // ellers tæller senere gevinster samme dag som fremgang efter vinduets start.
  // schema-columns-ok: rider_ability_race_day_history, database/2026-09-14-4846-training-tick-game-day.sql.
  const raceDayRows = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase
    .from("rider_ability_race_day_history")
    .select("id, rider_id, snapshot_date, season_number, source, game_day, abilities, created_at")
    .in("rider_id", chunk)
    .gte("snapshot_date", since)
    .order("rider_id")
    .order("snapshot_date")
    .order("id"));
  const calendarBy = new Map(riderIds.map((id) => [id, []]));
  const raceDayBy = new Map(riderIds.map((id) => [id, []]));
  for (const row of rows) calendarBy.get(row.rider_id)?.push(row);
  for (const row of raceDayRows) raceDayBy.get(row.rider_id)?.push(row);
  for (const id of riderIds) byRider.set(id, mergeDevelopmentSnapshots(calendarBy.get(id), raceDayBy.get(id)));
  return byRider;
}

// prognosisView pr. egen rytter. Andres ryttere er ikke med i resultatet.
// `preloaded` (valgfri): evne-billeder der allerede er hentet, så rapporten ikke læser dem to gange.
async function loadPrognosisViews(supabase, { teamId, context, clock = new Date(), preloaded = null }) {
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
  const snapshots = preloaded && growing.every((rider) => preloaded.has(rider.id))
    ? preloaded
    : await loadPaceSnapshots(supabase, { riderIds: growing.map((rider) => rider.id), today });
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
export async function buildEstimatesFromViews(supabase, { teamId, riderIds, clock = new Date(), fillMissing = fillMissingOwnEstimates } = {}) {
  const context = await loadEstimateContext(supabase, { teamId, riderIds, clock, fillMissing });
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

// #6110: prognosen pr. ryttertype står under skønnet igen, for egne og scoutede ryttere.
// Skjulte ryttere (uscoutet, AI-hold, lærer endnu) får ingen liste, og uden evner eller
// alder er der intet at fremskrive. Spejderens bånd pr. type (maskeret efter holdets
// scout-niveau og spejder) bruges kun her på serveren; svaret bærer ét tal pr. type.
async function loadRoleBands({ rider, abilities, own, level, teamId, age, bandScout, loadDevelopmentXp, potentialView }) {
  if (potentialView.hidden || !abilities || age == null) return [];
  if (!own && !(level > 0)) return [];
  const developmentXp = loadDevelopmentXp ? await loadDevelopmentXp() : null;
  const bands = buildTypePrognosisBands({
    nowAbilities: abilities, age, primaryType: rider.primary_type, secondaryType: rider.secondary_type,
    potentiale: rider.potentiale, level, riderId: rider.id, teamId, scout: bandScout, developmentXp,
  });
  return bands.some((band) => band.now != null) ? bands : [];
}

const bandMid = (band) => (band && Number.isFinite(band.progLo) && Number.isFinite(band.progHi)
  ? (band.progLo + band.progHi) / 2
  : null);

// #6110 (ejer 23/11): ét prognosetal pr. ryttertype, intet bånd. Samme regel som den
// samlede prognose (pacePrognosis): rytterens fart i netop den type de seneste dage, frem
// til toppen, mod et mål for typen. Målet er holdets skøn, flyttet med typens afstand til
// den bedste rolle i spejderens fremskrivning. Den bedste rolle har dermed skønnet selv
// som mål og samme tal som "Prognose" på kortet. Efter toppen vokser ingen type.
// Ren funktion; `bands` er loadRoleBands' svar, `snapshots` rytterens evne-billeder.
export function buildTypePrognoses({ bands, rider, liveAbilities, snapshots, today, estimate, age }) {
  const best = liveAbilities ? bestRoleOf(rider, liveAbilities) : null;
  const bestMid = bandMid(bands.find((band) => band.key === best));
  const baseline = paceBaseline(snapshots, today);
  return bands.filter((band) => band.now != null).map((band) => {
    const mid = bandMid(band);
    const target = band.key === best ? estimate
      : bestMid != null && mid != null ? estimate + mid - bestMid
        : mid;
    const inputs = liveAbilities ? rolePaceInputs(band.key, liveAbilities, baseline) : null;
    const prog = inputs && target != null && age <= PEAK_AGE
      ? pacePrognosis({ ...inputs, estimate: target, age })
      : null;
    return { key: band.key, now: band.now, prog: prog ?? band.now };
  });
}

// GET /riders/:id/scouting-report. `level` er knappens niveau (egen rytter = maxLevel);
// `looks` er de kig holdet faktisk har taget ("bygger på", spec §3.6).
// `bandScout` er holdets rigtige spejder (til båndbredden), `scout` er kun visningens udsnit.
// `loadDevelopmentXp` er valgfri (XP-modellen bag sin kontakt); uden den er prognosen som før.
export async function buildScoutingReportFromView(supabase, { teamId, rider, own, level, maxLevel, looks, age, scout, generatedAt, bandScout, loadDevelopmentXp = null, clock = new Date(), fillMissing = fillMissingOwnEstimates }) {
  const context = await loadEstimateContext(supabase, { teamId, riderIds: [rider.id], clock, fillMissing });
  const potentialView = context.views.get(rider.id) ?? UNSCOUTED;
  const rating = context.ratings.get(rider.id) ?? null;
  const liveAbilities = context.abilities.get(rider.id);
  // Codex P2 (#8645): typerne bruger samme referencesæson som prognosisView, så en
  // sæsonpause (ingen aktiv sæson) aldrig gør rytteren yngre i fremskrivningen.
  const typesAge = rider.birthdate
    ? scoutBandAge(rider.birthdate, await resolveScoutBandSeasonNumber(supabase)) ?? age
    : age;
  const bands = await loadRoleBands({
    rider, abilities: liveAbilities, own, level, teamId, age: typesAge, bandScout, loadDevelopmentXp, potentialView,
  });
  const today = isoDay(clock);
  const snapshots = bands.length ? await loadPaceSnapshots(supabase, { riderIds: [rider.id], today }) : null;
  const prognoses = await loadPrognosisViews(supabase, { teamId, context, clock, preloaded: snapshots });
  const types = bands.length
    ? buildTypePrognoses({
      bands, rider, liveAbilities, snapshots: snapshots.get(rider.id), today, estimate: potentialView.value, age: typesAge,
    })
    : [];
  return {
    potentialView,
    ...(prognoses.has(rider.id) ? { prognosisView: prognoses.get(rider.id) } : {}),
    level, maxLevel, own, looks,
    primaryKey: rider.primary_type ?? null,
    ...(types.length ? { types } : {}),
    verdict: estimateVerdict({ view: potentialView, age, own, level, maxLevel, rating }),
    pastPeak: pastPeakFromAging(age, await loadPastPeakAging(supabase, { now: clock })), // regel 16: uret injiceres
    scout, generatedAt,
  };
}

// GET /riders/:id/development-projection. #8523: den gamle kurve mod skønnet er væk;
// egne ryttere får den samlede prognose i stedet (spec 2026-11-20 §5).
export async function buildProjectionFromView(supabase, { teamId, rider, own, level, maxLevel, age, clock = new Date(), fillMissing = fillMissingOwnEstimates }) {
  const context = await loadEstimateContext(supabase, { teamId, riderIds: [rider.id], clock, fillMissing });
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
export async function buildAcademyFromViews(supabase, { teamId, roster, intake, clock = new Date(), fillMissing = fillMissingOwnEstimates }) {
  const candidateId = (item) => item?.riderId ?? item?.rider?.id;
  const context = await loadEstimateContext(supabase, {
    teamId,
    riderIds: [...(roster ?? []).map((rider) => rider.id), ...(intake ?? []).map(candidateId)],
    clock,
    fillMissing,
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
