import { resolveChannel, DIRECT } from "./trafficChannel.js";

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

// Konverterings-funnel per kanal (#4320). Dette er hele pointen med issuet:
// før dette kunne vi se "25.642 besøg" og "67 signups" som to tal uden fælles
// akse, og altså ikke afgøre om Reddit konverterer bedre end Google.
//
// visitRows  = traffic_visit_rollup-output (én række pr. besøg)
// signupRows = signup_attribution-rækker (utm_source + referrer)
//
// Begge sider mappes gennem den SAMME resolveChannel(), hvilket er
// forudsætningen for at tæller og nævner kan sammenlignes.
//
// Bots ekskluderes helt: de konverterer aldrig, så en kanal med botttrafik
// ville få kunstigt lav konverteringsrate.
//
// VIGTIGT om fortolkning: besøg er storage-less og dedup'es pr. (IP, UA, dag),
// mens signups er personer. En besøgende der kommer igen næste dag tælles som
// to besøg. Konverteringsraten er derfor et retnings-tal til at rangere
// kanaler indbyrdes, ikke en absolut sandsynlighed for at en person opretter
// sig. Sammenlign kanaler med hinanden, ikke raten med en ekstern benchmark.
export function aggregateChannelFunnel(visitRows, signupRows) {
  const visits = Array.isArray(visitRows) ? visitRows : [];
  const signups = Array.isArray(signupRows) ? signupRows : [];
  const byChannel = new Map();

  const row = (channel) => {
    let entry = byChannel.get(channel);
    if (!entry) {
      entry = { channel, visits: 0, engagedVisits: 0, signups: 0 };
      byChannel.set(channel, entry);
    }
    return entry;
  };

  for (const visit of visits) {
    if (visit?.is_bot) continue;
    const channel = resolveChannel({
      utmSource: visit?.utm_source,
      host: visit?.referrer_host,
    });
    const entry = row(channel);
    entry.visits += 1;
    const engaged =
      (Number(visit?.pageviews) || 0) >= 2 || (Number(visit?.engaged_events) || 0) >= 1;
    if (engaged) entry.engagedVisits += 1;
  }

  for (const signup of signups) {
    const channel = resolveChannel({
      utmSource: signup?.utm_source,
      referrer: signup?.referrer,
    });
    row(channel).signups += 1;
  }

  return [...byChannel.values()]
    .map((entry) => ({
      ...entry,
      // Null frem for 0 når kanalen ingen besøg har: en signup uden matchende
      // besøg (fx en historisk signup uden for tidsvinduet) må ikke se ud som
      // "0 % konvertering". Fladen viser en tankestreg for null.
      conversionRate: entry.visits ? entry.signups / entry.visits : null,
      engagedRate: entry.visits ? entry.engagedVisits / entry.visits : null,
    }))
    // Flest signups først, så de kanaler beslutninger handler om står øverst.
    // Derefter besøg, så en stor kanal uden konvertering stadig er synlig.
    .sort(
      (a, b) =>
        b.signups - a.signups ||
        b.visits - a.visits ||
        a.channel.localeCompare(b.channel)
    );
}

export { DIRECT };
