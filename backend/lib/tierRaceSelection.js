// backend/lib/tierRaceSelection.js
// Kalender-rebuild (2026-06-27, prestige/spredning-spec): vælg ÉT løb-sæt PR. DIVISION (tier) fra
// race_pool-kataloget — DE STØRSTE løb den kan få op til en PRÆCIS game-day-kvote (Div 1=140,
// Div 2=112, Div 3=84, Div 4=56). Output (stageRaces + oneDayRaces) fodres til packLaneCalendar,
// der komprimerer + spreder + fylder til præcis density. REN + deterministisk (ingen DB/Date/random).
//
// Cross-tier dedup håndteres af tierCalendarMaterializer (øverste tier vælger først; lavere fra resten).

// Prestige-rang (ejer-låst 2026-06-27): "de største løb" = højeste prestige først, IKKE flest
// etaper. Derfor havner monumenterne (1 etape) i Division 1.
export const PRESTIGE_RANK = Object.freeze({
  TourFrance: 0, GiroVuelta: 0, Monuments: 1,
  OtherWorldTourA: 2, OtherWorldTourB: 3, OtherWorldTourC: 4,
  ProSeries: 5, Class1: 6, Class2: 7,
});

// Et "Grand Tour" = ~3-ugers etapeløb (≥15 etaper) — pakkerens rygrad (spredt, komprimeret).
export const GRAND_TOUR_MIN_STAGES = 15;

// Game-day-kvote pr. tier (ejer-låst). Pr. pulje; alle puljer i en tier kører samme sæt.
export const TIER_GAME_DAY_QUOTA = Object.freeze({ 1: 140, 2: 112, 3: 84, 4: 56 });

// Deterministisk seed-varieret nøgle — varierer KUN rækkefølgen inden for samme prestige+størrelse.
function seededKey(id, seed) {
  let h = 2166136261 >>> 0;
  const s = `${(Number(seed) || 0) >>> 0}:${id}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
const prestigeOf = (rc) => PRESTIGE_RANK[rc] ?? 99;

/**
 * Vælg en divisions løb op til en præcis game-day-kvote, prestige-først.
 *
 * @param {{ catalog?: Array<{id,name,race_class,race_type,stages}>, quota?: number, seed?: number }} args
 * @returns {{ stageRaces, oneDayRaces, stageGameDays, totalGameDays, quotaHit, shortfall }}
 */
export function selectTierRaceSet({ catalog = [], quota = 0, seed = 1 } = {}) {
  // Rang: prestige asc → størrelse desc (de største af samme prestige først) → seed → id.
  const ranked = [...catalog].sort((a, b) => {
    const ra = prestigeOf(a.race_class), rb = prestigeOf(b.race_class);
    if (ra !== rb) return ra - rb;
    const sa = Math.max(1, Number(a.stages) || 1), sb = Math.max(1, Number(b.stages) || 1);
    if (sa !== sb) return sb - sa;
    const ka = seededKey(a.id, seed), kb = seededKey(b.id, seed);
    if (ka !== kb) return ka - kb;
    return String(a.id).localeCompare(String(b.id));
  });

  const stageRaces = [];
  const oneDayRaces = [];
  let total = 0;
  // Grådigt prestige-walk: tag hvert løb der PASSER inden for kvoten; et løb der ville skyde over
  // springes (et senere, mindre løb lukker resten præcist). 1-etape-løb i overflod → eksakt.
  for (const r of ranked) {
    if (total >= quota) break;
    const st = Math.max(1, Number(r.stages) || 1);
    if (total + st > quota) continue;
    const row = { id: r.id, name: r.name ?? null, race_class: r.race_class, stages: st };
    if (st >= 2) stageRaces.push(row); else oneDayRaces.push(row);
    total += st;
  }

  return {
    stageRaces, oneDayRaces,
    stageGameDays: stageRaces.reduce((s, r) => s + r.stages, 0),
    totalGameDays: total,
    quotaHit: total === quota,
    shortfall: Math.max(0, quota - total),
  };
}
