// #4385 · Upkeep som løbende rejse-/personaleudgift pr. seniorløbsdag.
//
// Ejer-beslutning 26/9 (fire låste valg, issue #4385):
//   1. Sats = samme sæsonsum spredt ud: UPKEEP_PER_RACE_DAY_BY_DIVISION.
//   2. Kun seniorholdets løbsdage koster. U23-/juniorløb er gratis, og parkerede
//      hold kører ingen løb og betaler derfor intet.
//   3. En løbsdag koster kun når holdet har mindst én rytter til start på den
//      løbsdag/etape. Ingen ryttere = 0.
//   4. Én finance-linje pr. løbsdag pr. hold, bogført ved afregningen af løbet
//      (autoPrizeSweep, samme tick som præmien og sponsorens løbsdags-indtægt).
//      Intet nyt dagligt job.
//
// "Løbsdag" = én etape. Et endagsløb er én løbsdag; et etapeløb med N etaper er N.
//
// Hvem var til start? race_results er sandheden:
//   - etapeløb (stages > 1): holdet har mindst én result_type='stage'-række med
//     det stage_number. Prod 26/9: alle completede etapeløb har stage-rækker for
//     hver etape 1..N.
//   - endagsløb (stages = 1): der findes ingen 'stage'-rækker, kun 'gc' med
//     stage_number 1 (målt i prod 26/9, 295 af 295 endagsløb) — derfor tæller
//     'gc' dér.
//
// Idempotens (samme to lag som sponsorRaceDayIncome.js, #3123):
//   - pre-filter: sæsonens allerede-bogførte travel_staff-nøgler hentes op front.
//   - backstop: uniq_finance_idempotency_key i DB (23505 → skipped).
// Nøgle: travel_staff:<raceId>:<stageNumber>:<teamId> — én pr. hold pr. løbsdag,
// så en genkørsel eller et retry aldrig trækker to gange.
//
// Dobbelt-træk-vagt: et hold der allerede har betalt det flade sæsonstart-
// upkeep ('upkeep'-post) i samme sæson, trækkes IKKE pr. løbsdag. Det dækker
// et flip midt i sæsonen (eller et flip efter sæsonskiftet).

import {
  FINANCE_ACTOR_TYPE,
  FINANCE_REASON,
  FINANCE_RELATED_ENTITY,
  UPKEEP_PER_RACE_DAY_BY_DIVISION,
} from "./economyConstants.js";
import { incrementBalanceWithAudit } from "./balanceRpc.js";
import { fetchAllRows } from "./supabasePagination.js";
import { withSeniorSquadScope } from "./squads.js";
import { isUpkeepPerRaceDayEnabled } from "./upkeepPerRaceDayFlag.ts";

export const TRAVEL_STAFF_FINANCE_TYPE = "travel_staff";

// PostgREST-klienten er utypet i resten af backend'en (JS + checkJs). Vi holder
// den løse type ÉT sted, så resten af modulet er strict.
type SupabaseLike = any;

export interface RaceLike {
  id: string;
  name?: string | null;
  stages?: number | string | null;
  squad?: string | null;
}

export interface ResultRowLike {
  team_id?: string | null;
  stage_number?: number | string | null;
  result_type?: string | null;
}

export interface TeamLike {
  id: string;
  division?: number | string | null;
}

export interface TravelStaffCharge {
  teamId: string;
  raceId: string;
  stageNumber: number;
  division: number;
  amount: number;
  idempotencyKey: string;
}

export function travelStaffIdempotencyKey(raceId: string, stageNumber: number, teamId: string): string {
  return `${TRAVEL_STAFF_FINANCE_TYPE}:${raceId}:${stageNumber}:${teamId}`;
}

/** Sats pr. seniorløbsdag for en division (0 for ukendt division og D4). */
export function upkeepPerRaceDayRate(division: unknown): number {
  const key = Number(division);
  const table: Record<number, number> = UPKEEP_PER_RACE_DAY_BY_DIVISION;
  const rate = Number.isInteger(key) ? table[key] : undefined;
  return Number.isFinite(rate) && (rate as number) > 0 ? (rate as number) : 0;
}

function isSeniorRace(race: RaceLike): boolean {
  return race.squad == null || race.squad === "senior";
}

/**
 * Pure: hvilke hold havde mindst én rytter til start på hver etape.
 * Returnerer Map<stageNumber, Set<teamId>>.
 */
export function startersByStage(race: RaceLike, results: ResultRowLike[]): Map<number, Set<string>> {
  const stages = Math.max(1, Number(race?.stages) || 1);
  const byStage = new Map<number, Set<string>>();
  for (const row of results || []) {
    const teamId = row?.team_id;
    if (!teamId) continue;
    const isStartRow = row.result_type === "stage" || (stages === 1 && row.result_type === "gc");
    if (!isStartRow) continue;
    const stageNumber = row.stage_number == null ? 1 : Number(row.stage_number);
    if (!Number.isInteger(stageNumber) || stageNumber < 1 || stageNumber > stages) continue;
    let set = byStage.get(stageNumber);
    if (!set) {
      set = new Set<string>();
      byStage.set(stageNumber, set);
    }
    set.add(teamId);
  }
  return byStage;
}

/**
 * Pure: træk pr. hold pr. løbsdag for ét løb.
 *
 * - `teamsById` er de hold der KAN betale (menneskehold, ikke bank, ikke frosne).
 *   Et hold der ikke står der (AI, bank, frosset, slettet) springes over.
 * - `excludedTeamIds` er hold der allerede har betalt fladt sæsonstart-upkeep.
 * - `paidKeys` er allerede-bogførte idempotency-nøgler (springes over).
 */
export function computeTravelStaffCharges({
  race,
  results,
  teamsById,
  excludedTeamIds = new Set<string>(),
  paidKeys = new Set<string>(),
}: {
  race: RaceLike;
  results: ResultRowLike[];
  teamsById: Map<string, TeamLike>;
  excludedTeamIds?: Set<string>;
  paidKeys?: Set<string>;
}): TravelStaffCharge[] {
  if (!race?.id || !isSeniorRace(race)) return [];
  const byStage = startersByStage(race, results);
  const charges: TravelStaffCharge[] = [];
  const stageNumbers = [...byStage.keys()].sort((a, b) => a - b);
  for (const stageNumber of stageNumbers) {
    const teamIds = [...(byStage.get(stageNumber) || [])].sort();
    for (const teamId of teamIds) {
      const team = teamsById.get(teamId);
      if (!team) continue;
      if (excludedTeamIds.has(teamId)) continue;
      const amount = upkeepPerRaceDayRate(team.division);
      if (amount <= 0) continue;
      const idempotencyKey = travelStaffIdempotencyKey(race.id, stageNumber, teamId);
      if (paidKeys.has(idempotencyKey)) continue;
      charges.push({
        teamId,
        raceId: race.id,
        stageNumber,
        division: Number(team.division),
        amount,
        idempotencyKey,
      });
    }
  }
  return charges;
}

// Løb der er fuldt afregnet i DENNE proces. En completet løbs afregning ændrer
// sig ikke, så vi henter ikke race_results for det igen ved hvert tick.
const settledRaces = new Set<string>();

export function clearSettledTravelStaffRaces(): void {
  settledRaces.clear();
}

export interface ChargeRaceDayTravelStaffResult {
  charged: number;
  total: number;
  races_settled: number;
  skipped?: string;
}

/**
 * I/O: træk rejse og personale pr. seniorløbsdag for alle completede seniorløb
 * i sæsonen. Kaldes fra autoPrizeSweep lige efter præmie- og sponsor-sweepen.
 */
export async function chargeRaceDayTravelStaffToDate(
  seasonId: string,
  supabase: SupabaseLike,
  opts: { actorType?: string; enabled?: boolean } = {},
): Promise<ChargeRaceDayTravelStaffResult> {
  const enabled = opts.enabled ?? (await isUpkeepPerRaceDayEnabled(supabase));
  if (!enabled) return { charged: 0, total: 0, races_settled: 0, skipped: "flag_off" };
  const actorType = opts.actorType ?? FINANCE_ACTOR_TYPE.SYSTEM;

  // Kun sæsonens SENIORløb (valg 2). Samme scope som sponsorRaceDayIncome (#5537).
  const racesRes: { data: RaceLike[] | null; error: { message: string } | null } =
    await withSeniorSquadScope((senior: (q: SupabaseLike) => SupabaseLike) => senior(supabase
      .from("races")
      .select("id, name, stages, status, squad"))
      .eq("season_id", seasonId)
      .eq("status", "completed"));
  if (racesRes.error) throw new Error(`races: ${racesRes.error.message}`);
  const allRaces = (racesRes.data || []).filter((r) => !settledRaces.has(`${seasonId}:${r.id}`));
  if (!allRaces.length) return { charged: 0, total: 0, races_settled: 0 };

  // Allerede-bogførte nøgler. Et løb med nøgler springes BEVIDST ikke over på
  // løbsniveau: fejler ét træk midt i et løb (fx et forbigående RPC-hikke), er
  // de tidligere træk allerede bogført, og en "har nøgler = afregnet"-genvej
  // ville efterlade resten af holdene utrukket for altid. Nøgle-filteret gør en
  // genkørsel sikker; prisen er én race_results-læsning pr. løb pr. proces.
  const keyRows: Array<{ idempotency_key: string | null }> = await fetchAllRows(() => supabase
    .from("finance_transactions")
    .select("idempotency_key")
    .eq("season_id", seasonId)
    .eq("type", TRAVEL_STAFF_FINANCE_TYPE)
    .order("idempotency_key", { ascending: true }));
  const paidKeys = new Set<string>();
  for (const row of keyRows) {
    if (row?.idempotency_key) paidKeys.add(row.idempotency_key);
  }
  const races: RaceLike[] = allRaces;

  // Hold der kan betale: samme filter som sæsonskiftets payroll
  // (economyEngine.loadHumanSeasonEndTeams).
  const teams: TeamLike[] = await fetchAllRows(() => supabase
    .from("teams")
    .select("id, division")
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_frozen", false)
    .order("id", { ascending: true }));
  const teamsById = new Map<string, TeamLike>(teams.map((t) => [t.id, t]));

  // Dobbelt-træk-vagt: hold der allerede har betalt fladt upkeep i sæsonen.
  const flatRows: Array<{ team_id: string | null }> = await fetchAllRows(() => supabase
    .from("finance_transactions")
    .select("team_id")
    .eq("season_id", seasonId)
    .eq("type", "upkeep")
    .order("id", { ascending: true }));
  const excludedTeamIds = new Set<string>(
    flatRows.map((r) => r.team_id).filter((id): id is string => Boolean(id)),
  );

  let charged = 0;
  let total = 0;
  let racesSettled = 0;
  for (const race of races) {
    const results: ResultRowLike[] = await fetchAllRows(() => supabase
      .from("race_results")
      .select("team_id, stage_number, result_type")
      .eq("race_id", race.id)
      .in("result_type", ["stage", "gc"])
      .order("id", { ascending: true }));

    const charges = computeTravelStaffCharges({ race, results, teamsById, excludedTeamIds, paidKeys });
    for (const c of charges) {
      try {
        const { skipped } = await incrementBalanceWithAudit(
          supabase,
          {
            teamId: c.teamId,
            delta: -c.amount,
            payload: {
              type: TRAVEL_STAFF_FINANCE_TYPE,
              amount: -c.amount,
              description: `Travel & staff — ${race.name || "race"}, stage ${c.stageNumber}`,
              metadata: {
                code: "tx.travelStaff",
                params: { race: race.name || "", stage: c.stageNumber, division: c.division },
              },
              season_id: seasonId,
              race_id: race.id,
              actor_type: actorType,
              actor_id: null,
              source_path: "upkeepPerRaceDay.chargeRaceDayTravelStaffToDate",
              reason_code: FINANCE_REASON.RACE_DAY_TRAVEL_STAFF,
              related_entity_type: FINANCE_RELATED_ENTITY.RACE,
              related_entity_id: race.id,
              idempotency_key: c.idempotencyKey,
            },
          },
          { allowDuplicate: true },
        );
        paidKeys.add(c.idempotencyKey);
        if (!skipped) {
          charged += 1;
          total += c.amount;
        }
      } catch (err) {
        // P0002 = holdet findes ikke længere (slettet mellem læsning og træk).
        // Samme håndtering som prisudbetalingen (#2389). Alt andet kastes videre.
        if ((err as { code?: string } | null)?.code !== "P0002") throw err;
      }
    }
    settledRaces.add(`${seasonId}:${race.id}`);
    racesSettled += 1;
  }

  return { charged, total, races_settled: racesSettled };
}
