// Ren aggregator (#2040), mønster som attributionDashboard.js. Input = rækker
// pre-grupperet pr. visit_hash (fra traffic_visit_rollup-RPC'en). En visit er
// ENGAGED hvis ≥2 pageviews ELLER ≥1 engaged-event. Bounce regnes KUN på
// bot-ekskluderede (human) visits.
export function aggregateTraffic(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let humanVisits = 0;
  let engagedVisits = 0;
  let botVisits = 0;
  for (const r of list) {
    if (r?.is_bot) {
      botVisits += 1;
      continue;
    }
    humanVisits += 1;
    const engaged = (Number(r?.pageviews) || 0) >= 2 || (Number(r?.engaged_events) || 0) >= 1;
    if (engaged) engagedVisits += 1;
  }
  const bounceVisits = humanVisits - engagedVisits;
  const totalVisits = humanVisits + botVisits;
  return {
    humanVisits,
    engagedVisits,
    botVisits,
    engagedRate: humanVisits ? engagedVisits / humanVisits : 0,
    bounceRate: humanVisits ? bounceVisits / humanVisits : 0,
    botShare: totalVisits ? botVisits / totalVisits : 0,
  };
}
