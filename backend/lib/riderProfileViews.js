// Aggregering af rider_profile_views (#957) — bygger på datafundamentet fra #963.
//
// Datamodellen deduper pr. (bruger, rytter, kalenderdag), så det eneste ærlige tal
// vi kan udlede er UNIKKE BESØGENDE i et tidsvindue (COUNT(DISTINCT user_id)). Vi
// viser to vinduer — seneste 24t og seneste 7d — plus en trend-% mod den umiddelbart
// foregående periode af samme længde.
//
// Cold-start (#957-beslutning): trenden kan først beregnes ærligt når loggingen har
// kørt længe nok til at en HEL forrige 7d-periode kan have data (dvs. >= 14 dages
// historik). Indtil da er prev==0 tvetydigt (manglende historik vs. ægte nul), så vi
// undertrykker trend-procenten og lader frontend vise et "Ny"-badge i stedet.

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_REQUIRED_MS = 14 * DAY_MS; // fuld forrige 7d-periode

/**
 * @param {Array<{user_id: string, viewed_at: string|Date}>} rows
 *   Rå besøgs-rows for ÉN rytter, mindst dækkende de seneste 14 dage.
 * @param {{ nowMs: number, oldestViewedAtMs: number|null }} ctx
 *   nowMs = nu (epoch ms). oldestViewedAtMs = ældste viewed_at i HELE tabellen
 *   (systemets logging-alder), eller null hvis tabellen er tom.
 * @returns {{ views24h:number, views7d:number, trend24hPct:number|null, trend7dPct:number|null, isNew:boolean }}
 */
export function aggregateRiderViews(rows, { nowMs, oldestViewedAtMs }) {
  const uniqueVisitors = (loMs, hiMs) => {
    const users = new Set();
    for (const row of rows) {
      const t = new Date(row.viewed_at).getTime();
      if (Number.isNaN(t)) continue;
      if (t >= loMs && t < hiMs) users.add(row.user_id);
    }
    return users.size;
  };

  // hi = nowMs + 1 så et besøg præcis nu tælles med i det aktuelle vindue.
  const views24h = uniqueVisitors(nowMs - DAY_MS, nowMs + 1);
  const prev24h = uniqueVisitors(nowMs - 2 * DAY_MS, nowMs - DAY_MS);
  const views7d = uniqueVisitors(nowMs - 7 * DAY_MS, nowMs + 1);
  const prev7d = uniqueVisitors(nowMs - 14 * DAY_MS, nowMs - 7 * DAY_MS);

  // Utilstrækkelig historik → trend er ikke beregnelig endnu (cold-start).
  const isNew =
    oldestViewedAtMs == null || nowMs - oldestViewedAtMs < HISTORY_REQUIRED_MS;

  const trendPct = (cur, prev) =>
    prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;

  return {
    views24h,
    views7d,
    trend24hPct: isNew ? null : trendPct(views24h, prev24h),
    trend7dPct: isNew ? null : trendPct(views7d, prev7d),
    isNew,
  };
}
