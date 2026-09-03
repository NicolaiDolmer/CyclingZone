// #2466 — "How your team did": ren udvælgelses-/aggregerings-logik for
// dashboardets resultat-push-modul. Kun 22 af 88 spillere har nogensinde set et
// løbsresultat; modulet skubber DIT holds seneste finaliserede løb til
// dashboardet i stedet for at vente på at spilleren selv finder det.
//
// Filen er bevidst ren (ingen supabase/IO) så udvælgelsen kan unit-testes:
//   pickLatestTeamRace  — hvilket løb er holdets seneste finaliserede?
//   summarizeTeamRace   — holdets placeringer + totaler i det løb
//   trimRecapRows       — minimal delmængde af løbets resultatrækker som
//                         frontendens buildRaceRecap() stadig kan fortælle ud fra
//   buildSeasonHistory  — #2886: de FOREGÅENDE løb + sæson-totaler, normaliseret
//                         fra dashboard_my_team_season_races-RPC'ens rækker
//   buildPrizeBreakdown — #4697/#4698: samme race_results-rækker som
//                         summarizeTeamRace, foldet til en LILLE sammensætning
//                         (etapeplacering pr. etape, klassifikationsplacering,
//                         holdbonus) i stedet for kun ét lump-total-tal.
//   buildSponsorPayoutLine — #4698: sæsonens sponsor-race-day/result-bonus-
//                         finance_transactions for DETTE løb, som egen linje
//                         med kilde i stedet for kun en separat notifikation.
// Ruten i routes/api.js komponerer dem over trimmede SELECTs.

// Seneste løb = løbet med den nyeste imported_at blandt holdets egne
// resultatrækker. date_text er en in-game-streng (ikke kronologisk sorterbar),
// så import-batchens timestamp er recency-signalet — samme konvention som
// /api/dashboard/recent-results. Rækker uden imported_at ignoreres til
// sammenligningen men kan stadig vinde hvis intet andet findes.
export function pickLatestTeamRace(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let bestRace = null;
  let bestImport = null;
  for (const row of rows) {
    if (!row?.race_id) continue;
    const imp = row.imported_at || "";
    if (bestRace === null || imp > (bestImport || "")) {
      bestRace = row.race_id;
      bestImport = imp;
    }
  }
  return bestRace;
}

// Holdets placeringer i løbet: det endelige klassement = gc-rækker (motoren
// skriver kun gc ved sidste etape; endagsløb har gc på etape 1). Gamle
// PCM-importerede løb kan mangle gc — fald tilbage til stage-rækker ved højeste
// etape (spejler buildRaceRecap/RaceDetailPages egen gc→stage-fallback).
// Totaler (point/præmie) summeres over ALLE holdets rækker i løbet (etaper,
// trøjer, holdklassement) — det er hvad løbet reelt indbragte.
export function summarizeTeamRace({ raceMeta, myRows }) {
  const rows = Array.isArray(myRows) ? myRows : [];
  const gc = rows.filter((r) => r.result_type === "gc");
  let finalRows = gc;
  if (!finalRows.length) {
    const stages = rows.filter((r) => r.result_type === "stage");
    const maxStage = stages.reduce((mx, r) => Math.max(mx, r.stage_number ?? 1), 0);
    finalRows = stages.filter((r) => (r.stage_number ?? 1) === maxStage);
  }

  const placements = [...finalRows]
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
    .map((r) => ({
      rider_id: r.rider_id ?? null,
      firstname: r.rider?.firstname ?? null,
      lastname: r.rider?.lastname ?? null,
      rider_name: r.rider_name ?? null,
      nationality_code: r.rider?.nationality_code ?? null,
      rank: r.rank ?? null,
      finish_time: r.finish_time ?? null,
      points_earned: r.points_earned || 0,
    }));

  // Etapesejre kun for etapeløb — endagsløb fra gamle imports gemmer selve
  // finishen som en 'stage'-række, og den er ikke en "etapesejr".
  const stageWins = raceMeta?.race_type === "stage_race"
    ? rows.filter((r) => r.result_type === "stage" && r.rank === 1).length
    : 0;

  const totals = rows.reduce(
    (acc, r) => {
      acc.points += r.points_earned || 0;
      acc.prize_money += Number(r.prize_money) || 0;
      return acc;
    },
    { points: 0, prize_money: 0 }
  );

  return { placements, stage_wins: stageWins, totals };
}

// buildRaceRecap (frontend/src/lib/raceRecap.js) læser af finish-ordenen kun:
// vinderen + nr. 2 (sejrsmargin), udbruds-flaggede rækker (antal + caught),
// top-10 (holdets dag) og klassements-vindere. Alt det overlever dette trim:
// behold rækker der er top-10 ELLER bærer et udbruds-flag. Resten af feltet
// (plads 11-140 uden udbrud) bidrager ikke til noget recap-moment.
export function trimRecapRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (r) => (r.rank != null && r.rank <= 10) || r.in_breakaway || r.breakaway_caught
  );
}

// #2886 — "flere løb end det seneste". Normaliserer rækkerne fra
// dashboard_my_team_season_races (database/2026-07-25-...-rpc.sql) til kortets
// kontrakt. RPC'en gentager sæson-totalerne på HVER række (CROSS JOIN over hele
// sæsonen, beregnet FØR LIMIT), så totalerne læses af den første række — de er
// pr. definition ens på alle rækker og dækker hele sæsonen, ikke kun de
// returnerede løb.
//
// Det seneste løb filtreres UD af historikken: det vises allerede i fuld
// detalje øverst i kortet, og en dublet ville læse som om holdet kørte det to
// gange. latestRaceId er kortets egen udvælgelse (pickLatestTeamRace) — hvis de
// to kilder mod forventning peger forskelligt, er filtreringen stadig korrekt
// (den fjerner præcis det løb der vises ovenfor).
//
// Postgres' bigint serialiseres af PostgREST som JSON-tal ELLER streng afhængigt
// af størrelse/driver — derfor Number()-koercion hele vejen, så frontendens
// formatNumber aldrig får "16249" som streng.
export function buildSeasonHistory({ rows, latestRaceId = null } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return { history: [], season_totals: null };

  const first = list[0];
  const season_totals = {
    points: Number(first.season_points) || 0,
    prize_money: Number(first.season_prize_money) || 0,
    races: Number(first.season_races) || 0,
  };

  const history = list
    .filter((r) => r.race_id && r.race_id !== latestRaceId)
    .map((r) => ({
      race_id: r.race_id,
      name: r.race_name ?? null,
      race_type: r.race_type ?? null,
      stages: r.stages == null ? null : Number(r.stages),
      best_rank: r.best_rank == null ? null : Number(r.best_rank),
      points: Number(r.points) || 0,
      prize_money: Number(r.prize_money) || 0,
    }));

  return { history, season_totals };
}

// ── #4697/#4698: prize-sammensætning + sponsor-udbetaling som egen linje ────
//
// Kilde (docs/ECONOMY_RULES.md §1/§3): prize_money er allerede beregnet pr.
// race_results-række (points_earned × PRIZE_PER_POINT, se raceResultsEngine.js
// buildRaceResultsFromPending) og prize_earnings_bonus genberegnes ved
// paySeasonPrizesToDate — INGEN ny beregning her, kun aggregering + labels af
// det der allerede er skrevet. Foldes til tre grupper (Discord-ønsket, #4697):
// "placeringspræmie pr. etape", "pr. klassifikation" og "holdbonus". De fire
// dagstrøje-mikrobonusser (leader/mountain_day/points_day/young_day —
// raceResultsEngine.js's RESULT_TYPE_TO_RACE_POINTS) lægges ind under deres
// tilhørende slutklassifikation i stedet for at få en fjerde gruppe hver —
// "en LILLE sammensætning", ikke ti rækker for et 21-etapes løb.
const CLASSIFICATION_KEYS = ["gc", "points", "mountain", "young"];
const DAY_JERSEY_TO_CLASSIFICATION = {
  leader: "gc",
  mountain_day: "mountain",
  points_day: "points",
  young_day: "young",
};

/**
 * Fold ét holds race_results-rækker for ét løb til en foldbar sammensætning.
 * Rene input/output — ingen supabase/IO (samme regel som resten af filen).
 *
 * @param {{myRows: Array}} args - samme `myRows` som summarizeTeamRace modtager
 *   (result_type, stage_number, rank, points_earned, prize_money, rider_id, rider_name).
 * @returns {{prize_total:number, points_total:number,
 *   stages: Array<{stage_number, amount, points, riders: Array<{rider_id, rider_name, rank, amount}>}>,
 *   classifications: Array<{classification, amount, points, riders: Array<{rider_id, rider_name, rank, amount}>}>,
 *   team_bonus: {amount, points}|null}}
 *
 * `riders[].amount` er DEN rytters egen andel (rows kan have flere ryttere pr.
 * etape/klassifikation-gruppe — fx to klatrere der begge placerer sig samme
 * etape); gruppens `amount` er stadig summen, men frontend skal bruge
 * `riders[].amount` når den viser hvem der tjente hvad (#4697-rettelsen,
 * ret-runde PR #4728: den anonyme sum uden rytternavn var netop det
 * reporteren + ejeren bad om at kunne se).
 */
export function buildPrizeBreakdown({ myRows } = {}) {
  const rows = (Array.isArray(myRows) ? myRows : []).filter((r) => (Number(r.prize_money) || 0) > 0);

  const stageMap = new Map();
  const classificationMap = new Map();
  const teamBonus = { amount: 0, points: 0 };

  for (const r of rows) {
    const amount = Number(r.prize_money) || 0;
    const points = Number(r.points_earned) || 0;
    const rider = r.rider_name
      ? { rider_id: r.rider_id ?? null, rider_name: r.rider_name, rank: r.rank ?? null, amount }
      : null;

    if (r.result_type === "stage") {
      const stageNumber = r.stage_number ?? 1;
      const g = stageMap.get(stageNumber) || { stage_number: stageNumber, amount: 0, points: 0, riders: [] };
      g.amount += amount;
      g.points += points;
      if (rider) g.riders.push(rider);
      stageMap.set(stageNumber, g);
      continue;
    }
    if (r.result_type === "team") {
      teamBonus.amount += amount;
      teamBonus.points += points;
      continue;
    }
    const classification = CLASSIFICATION_KEYS.includes(r.result_type)
      ? r.result_type
      : DAY_JERSEY_TO_CLASSIFICATION[r.result_type];
    // Ukendt/fremtidig result_type uden mapping falder ærligt på gulvet her
    // (samme holdning som raceResultsEngine.js's #3718 forward-guard) — det
    // beløb er stadig talt med i prize_total/points_total nedenfor, blot uden
    // egen gruppe, så tallene aldrig kommer i uoverensstemmelse med totalen.
    if (!classification) continue;
    const g = classificationMap.get(classification) || { classification, amount: 0, points: 0, riders: [] };
    g.amount += amount;
    g.points += points;
    if (rider) g.riders.push(rider);
    classificationMap.set(classification, g);
  }

  const stages = [...stageMap.values()].sort((a, b) => a.stage_number - b.stage_number);
  const classifications = CLASSIFICATION_KEYS.map((k) => classificationMap.get(k)).filter(Boolean);

  return {
    prize_total: rows.reduce((s, r) => s + (Number(r.prize_money) || 0), 0),
    points_total: rows.reduce((s, r) => s + (Number(r.points_earned) || 0), 0),
    stages,
    classifications,
    team_bonus: teamBonus.amount > 0 ? teamBonus : null,
  };
}

// Kilde: backend/lib/sponsorRaceDayIncome.js's payRaceDaySponsorsToDate — race-
// day-indkomst (type="sponsor_race_day") og resultat-bonus (type=
// "sponsor_result_bonus") krediteres begge med race_id+team_id sat og
// sender i dag KUN en separat "Sponsor payout"-notifikation (#3315). #4698
// (Discord 2/9, @zootne): vis den SAMME sum som egen linje i selve
// løbsrapporten, med kilde, i stedet for kun i den ekstra besked.
//
// @param {{sponsorRows: Array<{type:string, amount:number}>}} args - finance_transactions
//   rækker for ÉT race_id + team_id, type IN (sponsor_race_day, sponsor_result_bonus).
// @returns {{total:number, items: Array<{type:string, amount:number}>}|null} null hvis
//   holdet ikke fik nogen sponsor-udbetaling for dette løb (ingen tom linje i UI'et).
export function buildSponsorPayoutLine({ sponsorRows } = {}) {
  const rows = (Array.isArray(sponsorRows) ? sponsorRows : []).filter((r) => (Number(r.amount) || 0) > 0);
  if (!rows.length) return null;
  return {
    total: rows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    items: rows.map((r) => ({ type: r.type, amount: Number(r.amount) || 0 })),
  };
}
