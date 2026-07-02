// Resultater-fanens datalag (#2000): gruppér en rytters race_results-rækker
// (hentet via fetchAllRiderSeasonRows — ALLE rækker, paginerede) til PCS-stil:
// ét løb pr. række, etapeløb kan foldes ud i etape-underrækker + Samlet (GC).
//
// Semantik (verificeret mod prod 2026-07-03):
//   endagsløb   → én 'gc'-række (finaleplacering)
//   etapeløb    → 'stage' pr. etape + finale-'gc'/'points'/'mountain'/'young'
//                 + trøje-dag-rækker (leader/points_day/...) med småpoint/præmie
//   'team'      → holdresultat, ikke rytterens — filtreres fra
//
// Point/præmie pr. løb summerer ALLE rytterens rækker i løbet (også trøje-dage)
// — det er de reelt optjente ranking-point og CZ$.

const JERSEY_TYPES = ["points", "mountain", "young"];

export function groupRiderRaces(rows = []) {
  const byRace = new Map();
  for (const r of rows || []) {
    if (!r || r.result_type === "team") continue;
    const race = r.race ?? {};
    const id = race.id ?? r.race_id;
    if (!id) continue;
    if (!byRace.has(id)) {
      byRace.set(id, {
        raceId: id,
        name: race.name ?? null,
        raceType: race.race_type ?? "single",
        raceClass: race.race_class ?? null,
        terrain: race.pool?.terrain_archetype ?? null,
        stagesTotal: race.stages ?? 1,
        status: race.status ?? null,
        date: race.scheduled_for ?? null,
        season: race.season?.number ?? null,
        finalRank: null,
        gcPoints: 0,
        gcPrize: 0,
        points: 0,
        prize: 0,
        stageRows: [],
        jerseys: {},
      });
    }
    const g = byRace.get(id);
    g.points += r.points_earned || 0;
    g.prize += r.prize_money || 0;
    if (r.result_type === "gc") {
      g.finalRank = r.rank ?? null;
      g.gcPoints = r.points_earned || 0;
      g.gcPrize = r.prize_money || 0;
    } else if (r.result_type === "stage") {
      g.stageRows.push({ stage: r.stage_number ?? 1, rank: r.rank ?? null, points: r.points_earned || 0, prize: r.prize_money || 0 });
    } else if (JERSEY_TYPES.includes(r.result_type)) {
      g.jerseys[r.result_type] = r.rank ?? null;
    }
  }
  const races = [...byRace.values()];
  for (const g of races) g.stageRows.sort((a, b) => a.stage - b.stage);
  // Nyeste først; løb uden dato sidst.
  races.sort((a, b) => {
    const ta = a.date ? new Date(a.date).getTime() : -Infinity;
    const tb = b.date ? new Date(b.date).getTime() : -Infinity;
    return tb - ta;
  });
  return races;
}

export function racesForSeason(races = [], season = null) {
  return season == null ? races : races.filter((r) => r.season === season);
}

// Sæson-totaler til stat-rækken: Sejre · Løb · Top 5 · Trøjer · Point · Præmie.
//   wins   = etapesejre + finale-GC-sejre (endagssejr = GC-sejr på single)
//   top5   = finaleplaceringer (gc) i top 5 — etapeplaceringer tæller ikke
//   jerseys= vundne trøjer (points/mountain/young, rank 1 ved løbets afslutning)
export function riderResultTotals(races = []) {
  const totals = { wins: 0, races: races.length, top5: 0, jerseys: 0, points: 0, prize: 0 };
  for (const g of races) {
    totals.wins += g.stageRows.filter((s) => s.rank === 1).length + (g.finalRank === 1 ? 1 : 0);
    if (g.finalRank != null && g.finalRank <= 5) totals.top5 += 1;
    totals.jerseys += JERSEY_TYPES.filter((k) => g.jerseys[k] === 1).length;
    totals.points += g.points;
    totals.prize += g.prize;
  }
  return totals;
}

export function seasonsInRaces(races = []) {
  return [...new Set(races.map((r) => r.season).filter((n) => n != null))].sort((a, b) => b - a);
}
