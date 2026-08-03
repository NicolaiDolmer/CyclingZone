// Vækst-dashboard helpers (#3196, ejer-direktiv 31/7 — subsumerer #2089).
// Pure + DB-frie funktioner så de kan unit-testes uden Supabase. Bruges af
// GET /api/admin/growth/customers og GET /api/admin/growth/nps
// (backend/routes/api.js).
//
// LTV-ESTIMAT: subscriptions (#1903) har ingen faktura-/betalingshistorik —
// kun nuværende status + current_period_end. estimateSubscriptionLtvCents()
// nedenfor er derfor et ESTIMAT (antal betalte perioder ≈ dækket tid / periode-
// længde, ganget periode-prisen), IKKE en eksakt regnskabssum. Formlen er
// bevidst identisk med SQL-udgaven i compute_daily_growth_snapshot()
// (database/2026-08-03-growth-snapshots-3196.sql) — hold dem i sync ved
// prisændring. Priser matcher frontend/public/locales/{en,da}/pro.json
// ("49 kr/mo" / "265 kr"); ingen fælles maskinlæsbar kilde findes i dag.
export const PLAN_PRICE_CENTS = {
  monthly: 4900,
  semiannual: 26500,
};

const MONTH_SECONDS = 2629800; // 30.44 dage, gennemsnitlig månedslængde
const SEMIANNUAL_SECONDS = 15778800; // 182.625 dage

// #1903 computeIsPro-definition (backend/lib/entitlement.js), genbrugt her så
// "aktivt abonnement" betyder det SAMME i admin-dashboardet som i selve spillet.
const SUBSCRIPTION_ACTIVE_STATUSES = new Set(["active", "cancelled", "past_due"]);

export function isSubscriptionActive(sub, asOf = new Date()) {
  if (!sub?.current_period_end) return false;
  if (!SUBSCRIPTION_ACTIVE_STATUSES.has(sub.status)) return false;
  return new Date(sub.current_period_end).getTime() > asOf.getTime();
}

// Estimeret levetidsværdi (øre) for ét abonnement, som af `asOf`-tidspunktet.
// periods = max(1, ceil(dækket_sekunder / periode-sekunder)); ltv = periods * pris.
// "Dækket til" = asOf hvis stadig active, ellers current_period_end (fryser ved
// cancel/past_due) — matcher SQL-udgavens LEAST(v_asof, ...)-logik.
export function estimateSubscriptionLtvCents(sub, asOf = new Date()) {
  if (!sub?.created_at) return 0;
  const createdAt = new Date(sub.created_at);
  const referenceEnd = sub.status === "active"
    ? asOf
    : new Date(sub.current_period_end || sub.created_at);
  const effectiveEnd = referenceEnd.getTime() < asOf.getTime() ? referenceEnd : asOf;
  const coveredSeconds = Math.max(0, (effectiveEnd.getTime() - createdAt.getTime()) / 1000);
  const periodSeconds = sub.plan_interval === "semiannual" ? SEMIANNUAL_SECONDS : MONTH_SECONDS;
  const periods = Math.max(1, Math.ceil(coveredSeconds / periodSeconds));
  const pricePerPeriod = PLAN_PRICE_CENTS[sub.plan_interval] ?? PLAN_PRICE_CENTS.monthly;
  return periods * pricePerPeriod;
}

// Bygger den pr.-kunde-tabel "Kunder & LTV"-fanen viser: ét array-element pr.
// abonnement, beriget med teamnavn + estimeret LTV, sorteret højeste LTV først.
export function buildCustomerRows(subscriptions, teamsById = {}, asOf = new Date()) {
  return (subscriptions || [])
    .map(sub => {
      const team = teamsById[sub.team_id] || null;
      return {
        team_id: sub.team_id,
        team_name: team?.name || null,
        manager_name: team?.manager_name || null,
        status: sub.status,
        plan_interval: sub.plan_interval,
        is_founder: !!sub.is_founder,
        is_active: isSubscriptionActive(sub, asOf),
        current_period_end: sub.current_period_end,
        created_at: sub.created_at,
        ltv_cents: estimateSubscriptionLtvCents(sub, asOf),
      };
    })
    .sort((a, b) => b.ltv_cents - a.ltv_cents);
}

// NPS-aggregat (#940/#2089). Standarddefinition: promoter = 9-10, passiv =
// 7-8, detractor = 0-6. score = 100 * (promoters - detractors) / n (null hvis
// n=0 — "for tidligt at konkludere", ikke 0).
export function summarizeNps(rows) {
  const responses = rows || [];
  const n = responses.length;
  let promoters = 0, passives = 0, detractors = 0, sum = 0;
  for (const r of responses) {
    const score = r.score;
    sum += score;
    if (score >= 9) promoters++;
    else if (score >= 7) passives++;
    else detractors++;
  }
  return {
    n,
    average: n > 0 ? Math.round((sum / n) * 100) / 100 : null,
    promoters,
    passives,
    detractors,
    score: n > 0 ? Math.round(100 * (promoters - detractors) / n * 10) / 10 : null,
  };
}
