// Per-løbsdag-sponsor-indkomst + resultat-bonusser (#1663, economy Fase 2 ·
// udvidet i #2948 "Sponsorvalg 2.0").
//
// Løbsdage: hvert hold med en aktiv sponsor-kontrakt (per_race_day_rate > 0)
// tjener per_race_day_rate × race.stages for HVERT completet løb det deltog i.
// #2913: raten er ved aktivering sat mod divisionens etapetal, så den variable
// del summer til race_day_share × target ved fuld deltagelse.
//
// Resultat-bonusser (#2948, 'results'-arketypen): stage_win-klausul betaler pr.
// etapesejr (result_type='stage', rank=1), podium-klausul pr. 2.-3.-plads —
// begge under et fælles loft (results_cap-klausul) håndhævet via
// sponsor_contracts.results_bonus_paid.
//
// Alt er RÅ indkomst (IKKE board-modificeret — modsat den garanterede sæson-
// start-sponsor) og krediteres når løb finaliseres, ved siden af præmierne.
//
// Idempotent per (race, team) via idempotency_keys "sponsor_race_day:<raceId>:<teamId>"
// og "sponsor_results:<raceId>:<teamId>".
//
// #3123: idempotensen håndhæves i TO lag. Primært et pre-filter — sweep'en henter
// sæsonens allerede-bogførte nøgler op front og springer dem over. Sekundært
// uniq_finance_idempotency_key i DB, som backstop mod to samtidige ticks.
// Uden pre-filteret genforsøgte hver tick ALLE betalte krediteringer og fik dem
// afvist med 23505 — funktionelt harmløst, men O(alle completede løb) sekventielle
// round-trips pr. tick (~40 ms stykket). Ved sæsonslut ville ét tick tage længere
// end sit eget 5-minutters-interval og begynde at overlappe.

import { FINANCE_ACTOR_TYPE, FINANCE_REASON, FINANCE_RELATED_ENTITY } from "./economyConstants.js";
import { incrementBalanceWithAudit } from "./balanceRpc.js";

// PostgREST returnerer maks 1000 rækker pr. request uanset filter. Sæsonens
// sponsor-nøgler overstiger det længe før sæsonslut, så vi SKAL paginere —
// en tavs afkortning ville lade de afkortede nøgler falde tilbage på 23505-stien
// og genindføre præcis den fejl vi fjerner her.
const KEY_PAGE_SIZE = 1000;

// Hent alle allerede-bogførte sponsor-idempotency-nøgler for sæsonen.
//
// `.order()` er IKKE valgfri: offset-pagination over et uordnet resultatsæt er
// udefineret i Postgres — to queries kan give hver sin rækkefølge, og så kan en
// nøgle hoppe mellem sider og blive sprunget helt over. Den oversprungne nøgle
// falder tilbage på 23505-stien vi fjerner her. idempotency_key er unik, så den
// er en totalordning og dermed et stabilt paginerings-anker.
export async function fetchPaidSponsorKeys(seasonId, supabase) {
  const paid = new Set();
  for (let from = 0; ; from += KEY_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("finance_transactions")
      .select("idempotency_key")
      .eq("season_id", seasonId)
      .in("type", ["sponsor_race_day", "sponsor_result_bonus"])
      .order("idempotency_key", { ascending: true })
      .range(from, from + KEY_PAGE_SIZE - 1);
    if (error) throw new Error(`finance_transactions: ${error.message}`);
    for (const row of data || []) {
      if (row?.idempotency_key) paid.add(row.idempotency_key);
    }
    if ((data?.length || 0) < KEY_PAGE_SIZE) break;
  }
  return paid;
}

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

// Pure: beregn resultat-bonus for ét løb ud fra etape-resultater. stageResults =
// rækker med result_type='stage' (rank 1-3 er nok). remainingCapByTeam muterer
// IKKE — capped beløb returneres så caller kan bogføre og decremente selv.
export function computeResultBonusCredits({ race, stageResults, contractsByTeam, remainingCapByTeam }) {
  const winsByTeam = {};
  const podiumsByTeam = {};
  for (const r of stageResults || []) {
    if (!r.team_id) continue;
    const rank = Number(r.rank);
    if (rank === 1) winsByTeam[r.team_id] = (winsByTeam[r.team_id] || 0) + 1;
    else if (rank === 2 || rank === 3) podiumsByTeam[r.team_id] = (podiumsByTeam[r.team_id] || 0) + 1;
  }

  const credits = [];
  const teamIds = new Set([...Object.keys(winsByTeam), ...Object.keys(podiumsByTeam)]);
  for (const teamId of teamIds) {
    const contract = contractsByTeam?.[teamId];
    if (!contract) continue;
    const clauses = contract.bonus_clauses || [];
    const winAmount = Number(clauses.find((c) => c.type === "stage_win")?.amount) || 0;
    const podiumAmount = Number(clauses.find((c) => c.type === "podium")?.amount) || 0;
    if (winAmount <= 0 && podiumAmount <= 0) continue;

    const raw =
      (winsByTeam[teamId] || 0) * winAmount +
      (podiumsByTeam[teamId] || 0) * podiumAmount;
    if (raw <= 0) continue;

    const remaining = remainingCapByTeam?.[teamId];
    const amount = Number.isFinite(remaining) ? Math.min(raw, Math.max(remaining, 0)) : raw;
    if (amount <= 0) continue;

    credits.push({
      teamId,
      amount,
      wins: winsByTeam[teamId] || 0,
      podiums: podiumsByTeam[teamId] || 0,
      idempotencyKey: `sponsor_results:${race.id}:${teamId}`,
    });
  }
  return credits;
}

// I/O: udbetal per-løbsdag-sponsor-indkomst + resultat-bonusser for alle
// completede løb i en sæson. Mirror'er prizePayoutEngine.paySeasonPrizesToDate's
// race-query + payload-shape. opts.actorType lader en cron-sweep logge som SYSTEM.
export async function payRaceDaySponsorsToDate(seasonId, supabase, opts = {}) {
  const actorType = opts.actorType ?? FINANCE_ACTOR_TYPE.SYSTEM;

  const { data: races, error: racesError } = await supabase
    .from("races")
    .select("id, stages, status")
    .eq("season_id", seasonId)
    .eq("status", "completed");
  if (racesError) throw new Error(racesError.message);
  if (!races?.length) return { credited: 0, result_bonuses: 0 };

  const { data: contracts, error: contractsError } = await supabase
    .from("sponsor_contracts")
    .select("id, team_id, per_race_day_rate, bonus_clauses, results_bonus_paid")
    .eq("status", "active");
  if (contractsError) throw new Error(contractsError.message);

  const contractsByTeam = Object.fromEntries(
    (contracts || []).map((c) => [c.team_id, c])
  );

  // #3123: allerede-bogførte nøgler, så vi ikke genforsøger dem mod DB'en.
  const paidKeys = await fetchPaidSponsorKeys(seasonId, supabase);

  // Resterende resultat-loft pr. hold (results_cap-klausul − allerede udbetalt).
  // Holdes i memory gennem sweepen og persisteres pr. kreditering.
  const remainingCapByTeam = {};
  for (const c of contracts || []) {
    const cap = Number((c.bonus_clauses || []).find((cl) => cl.type === "results_cap")?.amount);
    if (Number.isFinite(cap) && cap > 0) {
      remainingCapByTeam[c.team_id] = Math.max(cap - (Number(c.results_bonus_paid) || 0), 0);
    }
  }

  let credited = 0;
  let resultBonuses = 0;
  for (const race of races) {
    const { data: results, error: resultsError } = await supabase
      .from("race_results")
      .select("team_id, result_type, rank")
      .eq("race_id", race.id);
    if (resultsError) throw new Error(resultsError.message);

    const participatingTeamIds = [
      ...new Set((results || []).map((r) => r.team_id).filter(Boolean)),
    ];
    const credits = computeRaceDayCredits({ race, participatingTeamIds, contractsByTeam });

    for (const c of credits) {
      if (paidKeys.has(c.idempotencyKey)) continue;
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

    // #2948: resultat-bonusser (kun etape-rækker, rank 1-3).
    const stageResults = (results || []).filter((r) => r.result_type === "stage");
    const bonusCredits = computeResultBonusCredits({
      race,
      stageResults,
      contractsByTeam,
      remainingCapByTeam,
    });

    for (const b of bonusCredits) {
      // #3123: allerede bogført → spring over UDEN at decrementere loftet igen
      // (forbruget ligger allerede i contract.results_bonus_paid). Samme semantik
      // som `skipped`-stien nedenfor.
      if (paidKeys.has(b.idempotencyKey)) continue;
      const { skipped } = await incrementBalanceWithAudit(
        supabase,
        {
          teamId: b.teamId,
          delta: b.amount,
          payload: {
            type: "sponsor_result_bonus",
            amount: b.amount,
            description: `Sponsor — result bonus (${b.wins} wins, ${b.podiums} podiums)`,
            season_id: seasonId,
            race_id: race.id,
            actor_type: actorType,
            actor_id: null,
            source_path: "sponsorRaceDayIncome.payRaceDaySponsorsToDate",
            reason_code: FINANCE_REASON.SPONSOR_RESULT_BONUS,
            related_entity_type: FINANCE_RELATED_ENTITY.RACE,
            related_entity_id: race.id,
            idempotency_key: b.idempotencyKey,
          },
        },
        { allowDuplicate: true }
      );
      if (skipped) continue;
      resultBonuses += 1;

      // Persistér loft-forbruget. Kreditering skete (idempotent), så inkrement
      // her er sikkert; ved crash mellem de to writes over-krediteres højst én
      // race-bonus næste sweep — accepteret (samme klasse som prize-sweepens
      // race-granularitet).
      if (Number.isFinite(remainingCapByTeam[b.teamId])) {
        remainingCapByTeam[b.teamId] = Math.max(remainingCapByTeam[b.teamId] - b.amount, 0);
        const contract = contractsByTeam[b.teamId];
        const { error: capError } = await supabase
          .from("sponsor_contracts")
          .update({ results_bonus_paid: (Number(contract.results_bonus_paid) || 0) + b.amount })
          .eq("id", contract.id);
        if (capError) throw new Error(capError.message);
        contract.results_bonus_paid = (Number(contract.results_bonus_paid) || 0) + b.amount;
      }
    }
  }

  return { credited, result_bonuses: resultBonuses };
}
