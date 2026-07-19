// Akademi-promotion-flow ved 22 (#932). Akademiryttere der passerer 21 ved
// sæson-skift sættes i pending-graduering; holdet vælger promover/sælg/slip i et
// override-vindue, ellers auto-resolverer sweepet (academyGraduationSweep.js) via
// default-kæden. Spec: docs/superpowers/specs/2026-06-18-academy-promotion-flow-design.md
//
// Determinisme: detektion er sæson-diskret (ageForSeason), idempotent via
// UNIQUE(rider_id, season_id) + status-gating. Fair-premium (#1142): ingen
// rigtige penge — promover/sælg/slip købes/udføres med in-game-økonomi.

import { ageForSeason } from "./riderProgressionEngine.js";
import { fetchAllRows } from "./supabasePagination.js";
import { notifyTeamOwner } from "./notificationService.js";
import { computeFrozenSalary, computeContractEndSeason, CONTRACT } from "./contractSeed.js";
import { getTeamMarketState, calculateRiderMarketValue } from "./marketUtils.js";
import { calculateAuctionEnd, DEFAULT_AUCTION_CONFIG } from "./auctionEngine.js";
import { clearFutureRaceEntriesSafe } from "./raceEntryCleanup.js";

export const GRADUATION = Object.freeze({
  GRADUATE_AGE: 22,   // alder hvor akademi-ophold slutter (MAX_AGE 21 + 1)
  DEADLINE_DAYS: 7,   // override-vindue i dage. SIM-STARTPUNKT — ejer-godkendes (scorecard).
});

const VALID_ACTIONS = new Set(["promote", "sell", "release"]);

export function isGraduateAge(age) {
  return Number.isFinite(age) && age >= GRADUATION.GRADUATE_AGE;
}

/**
 * Opret pending-graduerings-rows for akademiryttere der har passeret 21 i den
 * aktive (ny) sæson. Idempotent: rytter med eksisterende grad-row for season
 * skippes. deadline = now + GRADUATION.DEADLINE_DAYS. Kaldes i season-transition.
 *
 * @returns {Promise<{dryRun:boolean, graduates:number}>}
 */
export async function detectGraduates(supabase, { seasonId, seasonNumber, now = new Date(), dryRun = false, notify = notifyTeamOwner } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!seasonId || !Number.isFinite(seasonNumber)) throw new Error("detectGraduates: seasonId + seasonNumber required");

  const academy = await fetchAllRows(() =>
    supabase.from("riders")
      .select("id, team_id, firstname, lastname, birthdate")
      .eq("is_academy", true).eq("is_retired", false).order("id"));

  const existing = await fetchAllRows(() =>
    supabase.from("academy_graduation").select("rider_id").eq("season_id", seasonId).order("rider_id"));
  const alreadyRowed = new Set(existing.map((r) => r.rider_id));

  const deadline = new Date(now.getTime() + GRADUATION.DEADLINE_DAYS * 86_400_000).toISOString();
  let graduates = 0;
  for (const r of academy) {
    if (alreadyRowed.has(r.id)) continue;
    const age = ageForSeason(r.birthdate, seasonNumber);
    if (!isGraduateAge(age)) continue;
    if (dryRun) { graduates++; continue; }

    const { error } = await supabase.from("academy_graduation").insert({
      team_id: r.team_id, rider_id: r.id, season_id: seasonId, status: "pending", deadline,
    });
    if (error) throw new Error(`detectGraduates insert (${r.id}): ${error.message}`);

    await notify({
      supabase, teamId: r.team_id, type: "academy_graduation_ready", relatedId: r.id,
      title: "Academy graduation",
      message: `${r.firstname} ${r.lastname} has aged out of your academy. Promote, sell or release before the deadline.`,
      metadata: {
        titleCode: "notif.academyGraduationReady.title",
        messageCode: "notif.academyGraduationReady.message",
        titleParams: { name: `${r.firstname} ${r.lastname}` },
      },
    });
    graduates++;
  }
  return { dryRun, graduates };
}

/**
 * Udfør ét graduerings-udfald. action ∈ promote|sell|release.
 *
 * - promote: is_academy=false + NY senior-løn (overskriver arvet akademi-løn,
 *   ejer-beslutning 3) + senior-kontrakt. Kræver ledig senior-plads (division-cap).
 * - sell:    opret senior-auktion (seller=hold, is_youth=false). Rytteren forbliver
 *   is_academy=true (uden for cap) indtil auktions-finalization afgør udfaldet.
 * - release: team_id=NULL, is_academy=false (free agent).
 *
 * @throws 'invalid_action' | 'not_pending' | 'rider_not_found' | 'squad_cap_violation'
 */
export async function resolveGraduation(supabase, {
  teamId, riderId, action, seasonNumber, now = new Date(),
  getMarketState = getTeamMarketState, auctionConfig, notify = notifyTeamOwner,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!VALID_ACTIONS.has(action)) throw new Error("invalid_action");

  const { data: grad } = await supabase.from("academy_graduation")
    .select("id, status").eq("team_id", teamId).eq("rider_id", riderId).maybeSingle();
  if (!grad || grad.status !== "pending") throw new Error("not_pending");

  const { data: rider } = await supabase.from("riders")
    .select("id, team_id, firstname, lastname, base_value, prize_earnings_bonus, current_production_value, market_value, salary")
    .eq("id", riderId).maybeSingle();
  if (!rider) throw new Error("rider_not_found");

  if (action === "promote") {
    const state = await getMarketState(supabase, teamId);
    const cap = state?.squad_limits?.max ?? 30;
    const future = state?.future_count ?? state?.rider_count ?? 0;
    if (future + 1 > cap) throw new Error("squad_cap_violation");

    // NY senior-løn (overskriv arvet akademi-løn) — #2594: cpv × divisions-sats.
    const salary = computeFrozenSalary({ ...rider, division: state?.division });
    const length = CONTRACT.DEFAULT_ACQUIRE_LENGTH;
    const { error } = await supabase.from("riders").update({
      is_academy: false,
      salary,
      contract_length: length,
      contract_end_season: computeContractEndSeason(seasonNumber, length),
    }).eq("id", riderId);
    if (error) throw new Error(`resolveGraduation promote update: ${error.message}`);
    await finishGraduation(supabase, { gradId: grad.id, status: "promoted", teamId, rider, now, action, notify });
    return { riderId, action: "promoted", salary };
  }

  if (action === "sell") {
    await createGraduateAuction(supabase, { teamId, rider, now, auctionConfig });
    await finishGraduation(supabase, { gradId: grad.id, status: "sold", teamId, rider, now, action, notify });
    return { riderId, action: "sold" };
  }

  // release
  const { error } = await supabase.from("riders")
    .update({ team_id: null, is_academy: false }).eq("id", riderId);
  if (error) throw new Error(`resolveGraduation release update: ${error.message}`);
  // #1906 defense-in-depth: ryd rytterens fremtidige race_entries så de ikke hænger ved som ghost.
  await clearFutureRaceEntriesSafe({ supabase, riderId, label: "academy_release" });
  await finishGraduation(supabase, { gradId: grad.id, status: "released", teamId, rider, now, action, notify });
  return { riderId, action: "released" };
}

/**
 * Soft default: promover hvis ledig plads OG holdet ikke er i gæld → ellers sælg.
 * Manuel promovering (via ruten) har ingen gælds-guard — det er spillerens valg;
 * kun AUTO-defaulten er konservativ (lægger ikke løn-byrde på et hold i minus).
 * Usolgt salg → free agent håndteres i auktions-finalization.
 */
export async function defaultResolveGraduate(supabase, {
  teamId, riderId, seasonNumber, now = new Date(),
  getMarketState = getTeamMarketState, auctionConfig, notify = notifyTeamOwner,
} = {}) {
  const state = await getMarketState(supabase, teamId);
  const cap = state?.squad_limits?.max ?? 30;
  const future = state?.future_count ?? state?.rider_count ?? 0;
  const balance = Number(state?.balance ?? 0);
  const action = future + 1 <= cap && balance >= 0 ? "promote" : "sell";
  try {
    return await resolveGraduation(supabase, { teamId, riderId, action, seasonNumber, now, getMarketState, auctionConfig, notify });
  } catch (err) {
    if (action === "promote") {
      return await resolveGraduation(supabase, { teamId, riderId, action: "sell", seasonNumber, now, getMarketState, auctionConfig, notify });
    }
    throw err;
  }
}

// ─── interne helpers ──────────────────────────────────────────────────────────

async function finishGraduation(supabase, { gradId, status, teamId, rider, now, action, notify = notifyTeamOwner }) {
  const { error } = await supabase.from("academy_graduation")
    .update({ status, resolved_at: now.toISOString() }).eq("id", gradId);
  if (error) throw new Error(`finishGraduation update: ${error.message}`);
  const verb = action === "promote" ? "promoted to your senior squad"
    : action === "sell" ? "listed for transfer" : "released";
  await notify({
    supabase, teamId, type: "academy_graduated", relatedId: rider.id,
    title: "Academy graduate resolved",
    message: `${rider.firstname} ${rider.lastname} was ${verb}.`,
    metadata: {
      titleCode: "notif.academyGraduated.title",
      messageCode: `notif.academyGraduated.${action}`,
      titleParams: { name: `${rider.firstname} ${rider.lastname}` },
    },
  });
}

// Opret en senior-salgs-auktion for en graduate (spejler youthMarket.js, men med
// seller_team_id=holdet + is_youth=false). Rytteren forbliver is_academy=true til
// auktions-finalization (Task 6) sætter is_academy=false ved salg / free agent ved ingen bud.
async function createGraduateAuction(supabase, { teamId, rider, now = new Date(), auctionConfig }) {
  const value = Math.max(1, calculateRiderMarketValue(rider));
  const cfg = auctionConfig || await resolveAuctionConfig(supabase);
  const calculatedEnd = calculateAuctionEnd(now, cfg);
  const { error } = await supabase.from("auctions").insert({
    rider_id: rider.id,
    seller_team_id: teamId,
    starting_price: value,
    current_price: value,
    current_bidder_id: null,
    min_increment: 1,
    calculated_end: calculatedEnd.toISOString(),
    is_youth: false,
  });
  if (error) throw new Error(`createGraduateAuction: ${error.message}`);
}

async function resolveAuctionConfig(supabase) {
  const { data } = await supabase.from("auction_timing_config").select("*").eq("id", 1).single();
  return data || DEFAULT_AUCTION_CONFIG;
}
