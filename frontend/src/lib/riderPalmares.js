// Palmarès-fanens datalag (#1997 S1 — rytterside-fundament). Bygger oven på
// groupRiderRaces (samme grupperede løb som Resultater-fanen, lib/riderResultsTab.js)
// — INGEN dublet-parsing af rå race_results-rækker. Palmarès er den redigerede,
// ProCyclingStats-stil karriereside: kun det der tæller som ære (sejre, podier,
// etapesejre, trøjer) — den fulde etape-for-etape-log lever i Resultater-fanen.
//
// Datakontrakt: race_results.team_name er et immutabelt (team_id, team_name)-
// snapshot skrevet ved import (#1993, verificeret live i raceResultsEngine.js +
// raceRunner.js) — det er DERFOR palmarès kan vise "hvilket hold" trygt uden at
// historikken flytter sig ved senere transfers.

const JERSEY_TYPES = ["points", "mountain", "young"];
const DAY_JERSEY_TYPES = ["leader", "mountain_day", "points_day", "young_day"];

// Trofæskab: tæller pr. kategori på tværs af HELE karrieren (races = allerede
// grupperede løb fra groupRiderRaces).
//   gcWins      = sejr i et etapeløbs samlede klassement
//   oneDayWins  = sejr i et endagsløb (samme result_type 'gc', men raceType 'single')
//   stageWins   = individuelle etapesejre (tæller ikke med i gcWins/oneDayWins)
//   jerseyWins  = ENDELIGE klassementstrøjer (point/bjerg/ungdom, rank 1 ved løbets slut)
//   jerseyDays  = dage som fører af en klassificering (leder/point/bjerg/ungdom-dag)
//   podiums     = finalRank 1-3 (inkluderer sejre, cykelsportens egen konvention)
export function buildTrophyCase(races = []) {
  const trophy = {
    gcWins: 0,
    oneDayWins: 0,
    stageWins: 0,
    jerseyWins: 0,
    jerseyDays: 0,
    jerseyDaysByType: { leader: 0, mountain_day: 0, points_day: 0, young_day: 0 },
    podiums: 0,
  };
  for (const race of races || []) {
    if (race.finalRank === 1) {
      if (race.raceType === "stage_race") trophy.gcWins += 1;
      else trophy.oneDayWins += 1;
    }
    if (race.finalRank != null && race.finalRank <= 3) trophy.podiums += 1;
    trophy.stageWins += (race.stageRows || []).filter((s) => s.rank === 1).length;
    trophy.jerseyWins += JERSEY_TYPES.filter((k) => race.jerseys?.[k] === 1).length;
    for (const k of DAY_JERSEY_TYPES) {
      const n = race.dayLeads?.[k] || 0;
      trophy.jerseyDays += n;
      trophy.jerseyDaysByType[k] += n;
    }
  }
  return trophy;
}

// Karrieretotaler + win-rate. careerWins = OVERORDNEDE sejre (GC + endagsløb) —
// bevidst IKKE etapesejre, som er delresultater inden i et løb rytteren allerede
// er talt for. Win-rate = careerWins / antal STARTEDE løb (races.length), samme
// enhed som ProCyclingStats' "wins per start" — ikke pr. etape.
export function careerTotals(races = []) {
  const trophy = buildTrophyCase(races);
  const totalRaces = (races || []).length;
  const careerWins = trophy.gcWins + trophy.oneDayWins;
  const points = (races || []).reduce((sum, r) => sum + (r.points || 0), 0);
  const prize = (races || []).reduce((sum, r) => sum + (r.prize || 0), 0);
  return {
    totalRaces,
    careerWins,
    podiums: trophy.podiums,
    jerseyWins: trophy.jerseyWins,
    winRatePct: totalRaces > 0 ? Math.round((careerWins / totalRaces) * 1000) / 10 : 0,
    points,
    prize,
  };
}

// Achievement-liste for ét løb — bruges af seasonHonours til at afgøre om løbet
// hører til i æreslisten, og af UI'en til at rendere "hvorfor er dette en ære"
// uden at gætte på ny logik i komponenten.
export function raceAchievements(race) {
  const items = [];
  if (race.finalRank === 1) {
    items.push({ type: race.raceType === "stage_race" ? "gcWin" : "raceWin" });
  } else if (race.finalRank === 2 || race.finalRank === 3) {
    items.push({ type: "podium", rank: race.finalRank });
  }
  for (const s of race.stageRows || []) {
    if (s.rank === 1) items.push({ type: "stageWin", stage: s.stage });
  }
  for (const k of JERSEY_TYPES) {
    if (race.jerseys?.[k] === 1) items.push({ type: "jerseyWin", jersey: k });
  }
  return items;
}

// Sæson-æresliste: KUN løb med mindst ét achievement, grupperet pr. sæson
// (nyeste først). Fuld resultatliste (inkl. midterfelts-placeringer) lever i
// Resultater-fanen — her er kun det der ville stå i en rytters CV.
export function seasonHonours(races = []) {
  const bySeason = new Map();
  for (const race of races || []) {
    if (race.season == null) continue;
    const achievements = raceAchievements(race);
    if (achievements.length === 0) continue;
    if (!bySeason.has(race.season)) {
      bySeason.set(race.season, { season: race.season, teamNames: new Set(), races: [] });
    }
    const entry = bySeason.get(race.season);
    if (race.teamName) entry.teamNames.add(race.teamName);
    entry.races.push({ ...race, achievements });
  }
  return [...bySeason.values()]
    .map((s) => ({ season: s.season, teamNames: [...s.teamNames], races: s.races }))
    .sort((a, b) => b.season - a.season);
}
