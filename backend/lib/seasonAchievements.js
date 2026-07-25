/**
 * #2917 · Sæson-achievements — kriterie-motor
 * ===========================================
 * 13 achievements var defineret i `achievements`-tabellen og synlige for spilleren,
 * men INGEN kode kunne tildele dem (0 tildelinger i prod 25/7):
 *
 *   season_top10, season_top5, season_top3, season_winner, season_div1_winner,
 *   season_div3_winner, season_3_top3, season_2_seasons, season_5_seasons,
 *   team_promotion, team_relegation, team_survived, season_grand_tour_rider
 *
 * Dette modul er den RENE del: det udleder de tal `achievementEngine` låser op på,
 * ud fra et holds sæson-rækker (season_standings + sæson-status + næste sæsons
 * division). Ingen DB, ingen Date, ingen tilfældighed — så både live-motoren og
 * backfill-scriptet (scripts/backfillSeasonAchievements.js) bruger samme regler.
 *
 * Kriterier (verificeret mod prod-data 25/7, se PR til #2917):
 *   • Rang-baserede (top10/top5/top3/winner/div-winner) læses fra
 *     `rank_in_division` — som er rangen i holdets PULJE, ikke i hele tieren.
 *     De tæller først når sæsonen er `completed`; en igangværende sæson er ikke
 *     "sluttet i top 10".
 *   • Op-/nedrykning udledes af FAKTISK divisionsskifte (den afsluttede sæsons
 *     division → næste sæsons division), ikke af den sportslige regel. Det er den
 *     eneste definition der ikke kan lyve for spilleren: står der "Oprykket!", så
 *     ER holdet rykket op. Konsekvens: en sæson kan først afgøres når holdets
 *     division for den NÆSTE sæson er kendt (dvs. efter op/nedrykningen er kørt).
 *   • "Overlevede" = holdet sluttede i farezonen (SURVIVAL_DANGER_MARGIN pladser
 *     over nedrykningsstregen) og blev IKKE rykket ned. Bund-divisionen
 *     (MAX_DIVISION) rykker ikke ned, så der findes ingen farezone der.
 */

import {
  MAX_DIVISION,
  RELEGATION_SLOTS,
  SURVIVAL_DANGER_MARGIN,
} from "./economyConstants.js";

// Et "Grand Tour" = ~3-ugers etapeløb. Samme grænse som kalender-motoren
// (tierRaceSelection.GRAND_TOUR_MIN_STAGES) — genimporteres ikke for at holde
// dette modul fri for kalender-afhængigheder, men tallet SKAL følges ad.
export const GRAND_TOUR_MIN_STAGES = 15;

// season_3_top3 ("Konstant"): top 3 tre sæsoner i TRÆK.
export const SEASON_TOP3_STREAK_TARGET = 3;

function toRank(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Sidste "sikre" rang i en pulje — alt derunder rykker ned.
 * 24 hold, 4 nedrykningspladser → 20.
 */
export function relegationCutoffRank(poolSize) {
  const size = Number(poolSize) || 0;
  return Math.max(0, size - RELEGATION_SLOTS);
}

/**
 * Var holdet i farezonen? De SURVIVAL_DANGER_MARGIN pladser lige over stregen.
 * 24 hold → streg 20 → farezone = rang 18, 19, 20.
 */
export function isInRelegationDangerZone({ rank, poolSize, division }) {
  const parsedRank = toRank(rank);
  if (parsedRank == null) return false;
  // Bund-divisionen rykker ikke ned — der er ingen farezone at overleve.
  if (Number(division) >= MAX_DIVISION) return false;
  const cutoff = relegationCutoffRank(poolSize);
  if (cutoff <= 0) return false;
  return parsedRank <= cutoff && parsedRank > cutoff - SURVIVAL_DANGER_MARGIN;
}

/**
 * @typedef {object} SeasonRow
 * @property {number}  seasonNumber   Sæsonnummer (1, 2, ...)
 * @property {boolean} isFinal        Sæsonen er afsluttet (status='completed')
 * @property {number}  division       Tier holdet spillede i den sæson
 * @property {number}  rank           rank_in_division (rang i puljen)
 * @property {number}  poolSize       Antal hold i puljen den sæson
 * @property {number|null} nextDivision Holdets division den FØLGENDE sæson
 *                                      (null = op/nedrykning ikke afgjort endnu)
 */

/**
 * Udled sæson-statistikken achievementEngine låser op på.
 *
 * @param {object} args
 * @param {SeasonRow[]} [args.seasonRows]      Holdets sæson-rækker (rækkefølge er ligegyldig)
 * @param {boolean}     [args.hasGrandTourRider] Har holdet haft en rytter i et Grand Tour?
 */
export function computeSeasonAchievementStats({
  seasonRows = [],
  hasGrandTourRider = false,
} = {}) {
  // Kun afsluttede sæsoner tæller: "slut en sæson i top 10" kræver at sæsonen ER slut.
  const finalRows = (seasonRows || [])
    .filter((row) => row && row.isFinal)
    .sort((a, b) => (Number(a.seasonNumber) || 0) - (Number(b.seasonNumber) || 0));

  let seasonBestRank = null;
  const seasonDivisionsWon = new Set();
  let hasPromotion = false;
  let hasRelegation = false;
  let hasSurvival = false;

  // Længste stime af top-3-placeringer i FORTLØBENDE sæsoner (season_3_top3).
  let seasonMaxConsecutiveTop3 = 0;
  let currentTop3Streak = 0;
  let previousSeasonNumber = null;

  for (const row of finalRows) {
    const rank = toRank(row.rank);
    const division = Number(row.division);
    const seasonNumber = Number(row.seasonNumber);
    const nextDivision = row.nextDivision == null ? null : Number(row.nextDivision);

    if (rank != null) {
      if (seasonBestRank == null || rank < seasonBestRank) seasonBestRank = rank;
      if (rank === 1 && Number.isFinite(division)) seasonDivisionsWon.add(division);
    }

    const isTop3 = rank != null && rank <= 3;
    const isConsecutive = previousSeasonNumber != null && seasonNumber === previousSeasonNumber + 1;
    currentTop3Streak = isTop3 ? (isConsecutive ? currentTop3Streak + 1 : 1) : 0;
    if (currentTop3Streak > seasonMaxConsecutiveTop3) seasonMaxConsecutiveTop3 = currentTop3Streak;
    previousSeasonNumber = seasonNumber;

    // Op/nedrykning kræver at næste sæsons division er kendt.
    if (nextDivision != null && Number.isFinite(division) && Number.isFinite(nextDivision)) {
      if (nextDivision < division) hasPromotion = true;
      if (nextDivision > division) hasRelegation = true;
      if (
        nextDivision === division
        && isInRelegationDangerZone({ rank, poolSize: row.poolSize, division })
      ) {
        hasSurvival = true;
      }
    }
  }

  return {
    seasonsCompleted: finalRows.length,
    seasonBestRank,
    seasonDivisionsWon: [...seasonDivisionsWon].sort((a, b) => a - b),
    seasonMaxConsecutiveTop3,
    hasPromotion,
    hasRelegation,
    hasSurvival,
    hasGrandTourRider: Boolean(hasGrandTourRider),
  };
}

/**
 * Byg SeasonRow-listen for ÉT hold ud af rå tabel-rækker.
 *
 * @param {object} args
 * @param {string} args.teamId
 * @param {Array}  args.standings   Alle season_standings-rækker for de puljer holdet
 *                                  har spillet i (bruges både til holdets egen rang
 *                                  og til puljestørrelsen).
 * @param {Map<string, {number: number, status: string}>} args.seasonsById
 * @param {number|null} args.currentDivision  teams.division (holdets division NU)
 */
export function buildSeasonRowsForTeam({
  teamId,
  standings = [],
  seasonsById = new Map(),
  currentDivision = null,
}) {
  const poolSizes = new Map();
  for (const row of standings) {
    if (row?.league_division_id == null) continue;
    const key = `${row.season_id}:${row.league_division_id}`;
    poolSizes.set(key, (poolSizes.get(key) || 0) + 1);
  }

  const own = standings
    .filter((row) => row?.team_id === teamId && row?.league_division_id != null)
    .map((row) => {
      const season = seasonsById.get(row.season_id) || null;
      return {
        seasonId: row.season_id,
        seasonNumber: Number(season?.number) || 0,
        isFinal: season?.status === "completed",
        division: Number(row.division),
        rank: toRank(row.rank_in_division),
        poolSize: poolSizes.get(`${row.season_id}:${row.league_division_id}`) || 0,
        nextDivision: null,
      };
    })
    .sort((a, b) => a.seasonNumber - b.seasonNumber);

  // nextDivision: divisionen i den FØLGENDE sæson-række hvis den findes, ellers
  // holdets nuværende division (teams.division) for den seneste række — det er
  // dér op/nedrykningen har landet efter processSeasonEnd.
  for (let i = 0; i < own.length; i++) {
    const next = own[i + 1];
    if (next) {
      own[i].nextDivision = next.division;
    } else if (currentDivision != null && Number.isFinite(Number(currentDivision))) {
      own[i].nextDivision = Number(currentDivision);
    }
  }

  return own;
}
