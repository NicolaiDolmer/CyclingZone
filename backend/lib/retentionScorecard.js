// Retention-scorecard v2 (#2360, afløser lukket meta-issue #135) — D1/D7/D30
// pr. signup-uge-kohorte, kun rigtige managere. Pure + DB-free så det kan
// unit-testes uden Supabase; GET /api/admin/retention henter rows via
// service_role og kalder computeRetentionCohorts().
//
// Population-filter: samme diskriminator som economy-overview/board/academy
// ("rigtige hold" = ikke-AI/bank/test/frosne — grep'et fra api.js linje ~9258
// og academyIntake.js): teams.is_ai=false, is_bank=false, is_frozen=false,
// is_test_account=false. AI/bank-hold har intet auth-login; frosne/test-hold
// ville forvrænge det tal #1279-GO/NO-GO-beslutningen (betalt marketing under
// Touren) hviler på.
//
// Retention-definition (ROLLING/unbounded — matcher den eksisterende #1168
// get_cohort_retention-RPC, database/2026-06-09-cohort-retention-rpc.sql):
// en manager tæller "returnerede på +Nd" hvis last_activity >= signup + N dage,
// hvor last_activity = GREATEST(users.created_at, users.last_seen,
// MAX(player_events.created_at)). Bounded ("aktiv PRÆCIS dag N") blev fravalgt
// — beta-populationen er lille og daglig aktivitet sparsom, så et præcis-dag-krav
// ville give kunstigt lave/støjende tal. Rolling er det robuste stickiness-signal.
//
// Eligibility: en manager tæller kun i d{N}_eligible hvis signup + N dage <= now
// (nok tid er gået til at +Nd overhovedet kan måles). Kohorter yngre end N dage
// bidrager 0 til d{N}_eligible → pct = null ("—" i UI), ikke 0%. Garanterer
// D1_pct >= D7_pct >= D30_pct pr. kohorte (rolling er monotont aftagende).

const DAY_MS = 86_400_000;

// Mandag 00:00 UTC for ugen der indeholder `date`. Konsistent med #1168-RPC'ens
// date_trunc('week', ...) i UTC (Supabase DB-session-tz).
export function weekStartUTC(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay(); // 0=søn..6=lør
  const diffToMonday = (dow + 6) % 7; // mandag=0
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Ældste signup-uge der skal med for et givet `weeks`-vindue, regnet fra `now`.
export function cohortCutoff(now, weeks) {
  const clampedWeeks = Math.min(Math.max(parseInt(weeks, 10) || 8, 1), 52);
  return new Date(weekStartUTC(now).getTime() - (clampedWeeks - 1) * 7 * DAY_MS);
}

// users: [{ id, created_at, last_seen }] — allerede filtreret til rigtige managere.
// eventMaxByUser: Map<user_id, isoString|Date> — MAX(player_events.created_at) pr. user
// (kan mangle entries for users uden events; da behandles som ingen event-aktivitet).
// options.now: Date (injicerbar for test-determinisme). options.weeks: antal seneste
// signup-uger at inkludere (clamp 1-52, default 8).
export function computeRetentionCohorts(users, eventMaxByUser, { now = new Date(), weeks = 8 } = {}) {
  const clampedWeeks = Math.min(Math.max(parseInt(weeks, 10) || 8, 1), 52);
  const cutoff = cohortCutoff(now, clampedWeeks);
  const nowMs = now.getTime();

  const cohortMap = new Map();

  for (const u of users || []) {
    if (!u?.id || !u?.created_at) continue;
    const signupAt = new Date(u.created_at);
    if (Number.isNaN(signupAt.getTime()) || signupAt < cutoff) continue;

    const lastSeenMs = u.last_seen ? new Date(u.last_seen).getTime() : signupAt.getTime();
    const evMax = eventMaxByUser?.get(u.id);
    const eventMs = evMax ? new Date(evMax).getTime() : signupAt.getTime();
    const lastActivityMs = Math.max(signupAt.getTime(), lastSeenMs, eventMs);

    const key = isoDate(weekStartUTC(signupAt));
    if (!cohortMap.has(key)) {
      cohortMap.set(key, {
        cohort_week: key, cohort_size: 0,
        d1_eligible: 0, d1_returned: 0,
        d7_eligible: 0, d7_returned: 0,
        d30_eligible: 0, d30_returned: 0,
      });
    }
    const c = cohortMap.get(key);
    c.cohort_size += 1;

    for (const [n, prefix] of [[1, "d1"], [7, "d7"], [30, "d30"]]) {
      const thresholdMs = signupAt.getTime() + n * DAY_MS;
      if (thresholdMs <= nowMs) {
        c[`${prefix}_eligible`] += 1;
        if (lastActivityMs >= thresholdMs) c[`${prefix}_returned`] += 1;
      }
    }
  }

  const cohorts = [...cohortMap.values()]
    .map(c => ({
      ...c,
      d1_pct: c.d1_eligible > 0 ? round1((100 * c.d1_returned) / c.d1_eligible) : null,
      d7_pct: c.d7_eligible > 0 ? round1((100 * c.d7_returned) / c.d7_eligible) : null,
      d30_pct: c.d30_eligible > 0 ? round1((100 * c.d30_returned) / c.d30_eligible) : null,
    }))
    .sort((a, b) => b.cohort_week.localeCompare(a.cohort_week));

  return { weeks: clampedWeeks, generated_at: now.toISOString(), cohorts };
}
