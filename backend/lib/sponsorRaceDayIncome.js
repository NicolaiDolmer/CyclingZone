// Per-løbsdag-sponsor-indkomst (#1663, economy Fase 2).
//
// Hvert hold med en aktiv sponsor-kontrakt (per_race_day_rate > 0) tjener
// per_race_day_rate × race.stages for HVERT completet løb det deltog i. Dette er
// RÅ indkomst (IKKE board-modificeret — modsat den garanterede sæson-start-sponsor)
// og krediteres når løb finaliseres, ved siden af præmie-udbetalingen.
//
// Idempotent per (race, team) via idempotency_key "sponsor_race_day:<raceId>:<teamId>"
// + uniq_finance_idempotency_key i DB — gentagne sweep-ticks er harmløse (samme
// mønster som prizePayoutEngine's race_prize-nøgle).

import { FINANCE_ACTOR_TYPE, FINANCE_REASON, FINANCE_RELATED_ENTITY } from "./economyConstants.js";
import { incrementBalanceWithAudit } from "./balanceRpc.js";

// Pure: beregn race-day-kreditter for ét løb. stages defaulter til 1 (endagsløb);
// hold uden aktiv kontrakt eller med rate <= 0 springes over.
export function computeRaceDayCredits({ race, participatingTeamIds, contractsByTeam }) {
  const stages = Number(race?.stages) || 1;
  const credits = [];
  for (const teamId of participatingTeamIds || []) {
    const rate = Number(contractsByTeam?.[teamId]?.per_race_day_rate) || 0;
    if (rate <= 0) continue;
    credits.push({
      teamId,
      amount: rate * stages,
      idempotencyKey: `sponsor_race_day:${race.id}:${teamId}`,
    });
  }
  return credits;
}

// I/O: udbetal per-løbsdag-sponsor-indkomst for alle completede løb i en sæson.
// Mirror'er prizePayoutEngine.paySeasonPrizesToDate's race-query + payload-shape.
// opts.actorType lader en cron-sweep logge som SYSTEM (default = SYSTEM her, da
// indkomsten er en automatisk konsekvens af finalisering — ikke en manuel handling).
export async function payRaceDaySponsorsToDate(seasonId, supabase, opts = {}) {
  const actorType = opts.actorType ?? FINANCE_ACTOR_TYPE.SYSTEM;

  const { data: races, error: racesError } = await supabase
    .from("races")
    .select("id, stages, status")
    .eq("season_id", seasonId)
    .eq("status", "completed");
  if (racesError) throw new Error(racesError.message);
  if (!races?.length) return { credited: 0 };

  const { data: contracts, error: contractsError } = await supabase
    .from("sponsor_contracts")
    .select("team_id, per_race_day_rate")
    .eq("status", "active");
  if (contractsError) throw new Error(contractsError.message);

  const contractsByTeam = Object.fromEntries(
    (contracts || []).map((c) => [c.team_id, c])
  );

  let credited = 0;
  for (const race of races) {
    const { data: results, error: resultsError } = await supabase
      .from("race_results")
      .select("team_id")
      .eq("race_id", race.id);
    if (resultsError) throw new Error(resultsError.message);

    const participatingTeamIds = [
      ...new Set((results || []).map((r) => r.team_id).filter(Boolean)),
    ];
    const credits = computeRaceDayCredits({ race, participatingTeamIds, contractsByTeam });

    for (const c of credits) {
      const { skipped } = await incrementBalanceWithAudit(
        supabase,
        {
          teamId: c.teamId,
          delta: c.amount,
          payload: {
            type: "sponsor_race_day",
            amount: c.amount,
            description: "Sponsor — race-day income",
            season_id: seasonId,
            race_id: race.id,
            actor_type: actorType,
            actor_id: null,
            source_path: "sponsorRaceDayIncome.payRaceDaySponsorsToDate",
            reason_code: FINANCE_REASON.SPONSOR_RACE_DAY,
            related_entity_type: FINANCE_RELATED_ENTITY.RACE,
            related_entity_id: race.id,
            idempotency_key: c.idempotencyKey,
          },
        },
        { allowDuplicate: true }
      );
      if (!skipped) credited += 1;
    }
  }

  return { credited };
}
