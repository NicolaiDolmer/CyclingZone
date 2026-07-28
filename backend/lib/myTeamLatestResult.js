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
