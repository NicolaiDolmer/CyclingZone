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
