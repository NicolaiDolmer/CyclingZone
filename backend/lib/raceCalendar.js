// Player-facing race-calendar read model (#in-game-race-calendar).
//
// Pure transforms, NO I/O — så `node --test` kan loade modulet direkte og
// raceCalendar.test.js kan teste game_day→dato-mapping, pulje-dedup og
// terræn-afledning uden DB. Endpoint'et (routes/api.js) laver I/O og kalder ind her.
//
// DESIGN: Kalenderen er bevidst afkoblet fra race_engine_v2-kill-switchen. Den læser
// KUN schedule + profiler + entries og bygger en månedlig løbskalender der renderer
// uanset om motoren kører. game_day (in-game-dag-ordinal) er sandheden for HVILKEN
// kalenderdag et løb ligger på — ikke scheduled_at (IRL-timestamp). Vi udleder en
// game_day→CET-dato-mapping fra schedule-rækkerne selv, så kalenderen følger den
// faktiske binding (jf. prompt: "key on game_day, not scheduled_at").

// league_divisions.tier → spiller-vendt "Division N"-nummer. tier ER divisionsnummeret
// i pyramiden (tier1 = Division 1, …). pool_index adskiller puljer inden for en tier.
export function tierToDivision(tier) {
  return Number.isFinite(tier) ? tier : null;
}

// 9 profile_types → 5 spiller-vendte terræn-buckets der matcher legend'en
// (Sprint · Kuperet · Bjerge · Enkeltstart · Holdstart). Folder cobbles+classic ind i
// de viste kategorier (cobbles er fladt-med-rumlen → sprint-bucket; classic er kuperet →
// hilly). itt=enkeltstart, ttt=holdstart — hver sin glyf på kalenderen, så en enkeltstart
// ikke ligner en flad sprint og en holdstart skelnes fra enkeltstart (#1953).
const PROFILE_TO_CAL_BUCKET = {
  flat: "sprint",
  rolling: "sprint",
  cobbles: "sprint",
  hilly: "hilly",
  classic: "hilly",
  mountain: "mountain",
  high_mountain: "mountain",
  itt: "itt",
  ttt: "ttt",
};

export const CALENDAR_TERRAIN_BUCKETS = Object.freeze(["sprint", "hilly", "mountain", "itt", "ttt"]);

export function calendarTerrainBucket(profileType) {
  return PROFILE_TO_CAL_BUCKET[profileType] || "sprint";
}

// Dominerende terræn-bucket på tværs af et løbs etaper. Tie → bucket-rækkefølgen
// (sprint < hilly < mountain < itt) som stabil tiebreak. Tomt → null (intet badge).
export function dominantCalendarBucket(profileTypes) {
  if (!Array.isArray(profileTypes) || profileTypes.length === 0) return null;
  const counts = new Map();
  for (const pt of profileTypes) {
    const b = calendarTerrainBucket(pt);
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  let best = null;
  let bestCount = -1;
  for (const b of CALENDAR_TERRAIN_BUCKETS) {
    const c = counts.get(b) || 0;
    if (c > bestCount) {
      bestCount = c;
      best = c > 0 ? b : best;
    }
  }
  return best;
}

// Bygger en game_day → CET-kalenderdato-mapping ud fra schedule-rækkerne. Hver
// scheduled_at er en IRL-timestamp i UTC; vi projicerer den til Europe/Copenhagen-
// kalenderdagen. For en given game_day kan flere etaper have lidt forskellige
// klokkeslæt — vi tager den TIDLIGSTE CET-dato som dagens dato (deterministisk).
//
// Returnerer Map<game_day:number, isoDate:"YYYY-MM-DD">.
export function buildGameDayDateMap(scheduleRows) {
  const byDay = new Map(); // game_day -> earliest epoch ms
  for (const row of scheduleRows || []) {
    const gd = row.game_day;
    if (gd == null) continue;
    const ms = Date.parse(row.scheduled_at);
    if (!Number.isFinite(ms)) continue;
    const prev = byDay.get(gd);
    if (prev == null || ms < prev) byDay.set(gd, ms);
  }
  const out = new Map();
  for (const [gd, ms] of byDay) out.set(gd, toCopenhagenISODate(ms));
  return out;
}

// Epoch-ms → "YYYY-MM-DD" i Europe/Copenhagen. Bruger Intl med fast tidszone så
// CET/CEST-sommertid håndteres korrekt uden at slæbe et dato-bibliotek ind.
const CPH_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Copenhagen",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function toCopenhagenISODate(epochMs) {
  // en-CA giver "YYYY-MM-DD" direkte.
  return CPH_DATE_FMT.format(new Date(epochMs));
}

// Epoch-ms → "HH:MM" i Europe/Copenhagen (24-timers). Til per-etape-visning på kalenderen.
const CPH_TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Copenhagen",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export function toCopenhagenTime(epochMs) {
  return CPH_TIME_FMT.format(new Date(epochMs));
}

// "YYYY-MM-DD" → { year, month (1-12), day }. Ingen Date-parsing (undgår TZ-skred).
export function splitISODate(iso) {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return { year: +m[1], month: +m[2], day: +m[3] };
}

// Bygger den fulde kalender-read-model fra rå rækker.
//
// Input (alt allerede hentet af endpoint'et):
//   races: [{ id, name, race_type, race_class, stages, league_division_id, game_day_start, status }]
//   scheduleRows: [{ race_id, stage_number, scheduled_at, game_day }]
//   profileRows: [{ race_id, stage_number, profile_type }]
//   divisions: [{ id, tier, pool_index, label }]
//   teamDivisionId: number|null (req.team.league_division_id — holdets pulje-id)
//   teamEntryRaceIds: Set<raceId> løb holdet har en entry i
//   teamLeaderRaceIds: Set<raceId> løb hvor holdet har sat en leder (captain/sprint_captain)
//
// Output: { entries: [...], days: [{ gameDay, date }], divisions: [{division, pools}] }
// Hver entry repræsenterer ÉT løb (én pulje-instans) på sin startdag, beriget med
// terræn, division/pulje og "mit hold"-flag.
export function buildCalendarModel({
  races = [],
  scheduleRows = [],
  profileRows = [],
  divisions = [],
  teamDivisionId = null,
  teamEntryRaceIds = new Set(),
  teamLeaderRaceIds = new Set(),
} = {}) {
  const dayDateMap = buildGameDayDateMap(scheduleRows);

  // game_days pr. løb (fra schedule) → start/slut-dag + dato. game_day er sandheden;
  // game_day_start på races er en hint men vi stoler på schedule-rækkerne.
  const daysByRace = new Map();
  for (const row of scheduleRows || []) {
    if (row.game_day == null) continue;
    if (!daysByRace.has(row.race_id)) daysByRace.set(row.race_id, new Set());
    daysByRace.get(row.race_id).add(row.game_day);
  }

  // profile_types pr. løb (rækkefølge efter stage_number for stabil dominans).
  const profilesByRace = new Map();
  for (const row of (profileRows || []).slice().sort((a, b) => (a.stage_number ?? 0) - (b.stage_number ?? 0))) {
    if (!profilesByRace.has(row.race_id)) profilesByRace.set(row.race_id, []);
    profilesByRace.get(row.race_id).push(row.profile_type);
  }
  // terræn-bucket pr. (race, stage_number) — til per-etape-chips på kalenderen.
  const terrainByRaceStage = new Map();
  for (const row of profileRows || []) {
    terrainByRaceStage.set(`${row.race_id}:${row.stage_number}`, calendarTerrainBucket(row.profile_type));
  }

  // Per-etape-plan pr. løb: { stage, date, time, terrain } sorteret efter faktisk tidspunkt.
  // Afledt DIREKTE fra scheduled_at (IRL), så den korrekte kalenderdag+tid vises selv for
  // monumenter (hvis game_day ligger i binding-fri båndet). Frontend ekspanderer hver etape
  // til sin egen dag-celle, så spilleren ser "1. etape 12:30", "2. etape 15:00" osv.
  const stageScheduleByRace = new Map();
  for (const row of scheduleRows || []) {
    const ms = Date.parse(row.scheduled_at);
    if (!Number.isFinite(ms)) continue;
    if (!stageScheduleByRace.has(row.race_id)) stageScheduleByRace.set(row.race_id, []);
    stageScheduleByRace.get(row.race_id).push({
      stage: row.stage_number,
      date: toCopenhagenISODate(ms),
      time: toCopenhagenTime(ms),
      terrain: terrainByRaceStage.get(`${row.race_id}:${row.stage_number}`) || null,
      _ms: ms,
    });
  }
  for (const list of stageScheduleByRace.values()) {
    list.sort((a, b) => a._ms - b._ms || a.stage - b.stage);
    for (const s of list) delete s._ms;
  }

  const divById = new Map(divisions.map((d) => [d.id, d]));

  const entries = [];
  for (const race of races) {
    const dayset = daysByRace.get(race.id);
    // Intet schedule → kan ikke placeres på kalenderen (ufærdigt løb). Spring over.
    const startDay = dayset && dayset.size
      ? Math.min(...dayset)
      : (Number.isFinite(race.game_day_start) ? race.game_day_start : null);
    if (startDay == null) continue;
    const endDay = dayset && dayset.size ? Math.max(...dayset) : startDay;
    const date = dayDateMap.get(startDay) || null;

    const div = divById.get(race.league_division_id) || null;
    const profileTypes = profilesByRace.get(race.id) || [];
    const isMine = teamDivisionId != null && race.league_division_id === teamDivisionId;

    entries.push({
      id: race.id,
      name: race.name,
      raceType: race.race_type,
      raceClass: race.race_class,
      stages: race.stages ?? 1,
      status: race.status,
      poolId: race.league_division_id ?? null,
      division: div ? tierToDivision(div.tier) : null,
      poolLabel: div ? div.label : null,
      poolIndex: div ? div.pool_index : null,
      gameDayStart: startDay,
      gameDayEnd: endDay,
      date,
      terrain: dominantCalendarBucket(profileTypes),
      terrainStages: profileTypes.map(calendarTerrainBucket),
      stageSchedule: stageScheduleByRace.get(race.id) || [],
      isMine,
      leaderSet: teamLeaderRaceIds.has(race.id),
      entered: teamEntryRaceIds.has(race.id),
    });
  }

  // Sorter deterministisk: dag, så division, så navn — så frontend kan rendere
  // chips i en stabil rækkefølge inden for en celle.
  entries.sort((a, b) =>
    a.gameDayStart - b.gameDayStart ||
    (a.division ?? 99) - (b.division ?? 99) ||
    (a.poolIndex ?? 0) - (b.poolIndex ?? 0) ||
    a.name.localeCompare(b.name));

  // Distinkte divisioner (tier) → pulje-liste, til division-vælgeren.
  const divisionTree = buildDivisionTree(divisions);

  // Dag-liste (kun dage med løb) til måneds-navigation-hints.
  const days = [...dayDateMap.entries()]
    .map(([gameDay, date]) => ({ gameDay, date }))
    .sort((a, b) => a.gameDay - b.gameDay);

  return { entries, days, divisions: divisionTree };
}

// [{division, label, pools:[{id,label,poolIndex}]}] sorteret efter tier så
// division-vælgeren kan vise "Division 1..4" + puljerne under hver.
export function buildDivisionTree(divisions = []) {
  const byTier = new Map();
  for (const d of divisions) {
    if (!byTier.has(d.tier)) byTier.set(d.tier, []);
    byTier.get(d.tier).push({ id: d.id, label: d.label, poolIndex: d.pool_index });
  }
  return [...byTier.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tier, pools]) => ({
      division: tier,
      pools: pools.sort((a, b) => (a.poolIndex ?? 0) - (b.poolIndex ?? 0)),
    }));
}
