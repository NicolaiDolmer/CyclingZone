import test from "node:test";
import assert from "node:assert/strict";
import { aggregateChannelFunnel } from "./trafficMetrics.js";
import { sanitizeCollectChannel } from "./trafficChannel.js";

// Hjælper: en besøgs-række som traffic_visit_rollup leverer den.
function visit({ host = null, source = null, bot = false, pageviews = 1, engagedEvents = 0 } = {}) {
  return {
    visit_hash: `h${Math.abs(host?.length ?? 0)}${pageviews}${engagedEvents}${bot}`,
    is_bot: bot,
    pageviews,
    engaged_events: engagedEvents,
    referrer_host: host,
    utm_source: source,
  };
}

test("funnel: kobler besøg og signups på samme kanal-nøgle", () => {
  const visits = [
    visit({ host: "www.reddit.com" }),
    visit({ host: "www.reddit.com" }),
    visit({ host: "www.google.com" }),
    visit({ host: "www.google.com" }),
    visit({ host: "www.google.com" }),
    visit({ host: "www.google.com" }),
  ];
  const signups = [
    { referrer: "https://www.reddit.com/r/cycling" },
    { referrer: "https://www.google.com/search?q=x" },
  ];

  const rows = aggregateChannelFunnel(visits, signups);
  const reddit = rows.find((r) => r.channel === "reddit");
  const google = rows.find((r) => r.channel === "organic-search");

  assert.equal(reddit.visits, 2);
  assert.equal(reddit.signups, 1);
  assert.equal(reddit.conversionRate, 0.5);

  assert.equal(google.visits, 4);
  assert.equal(google.signups, 1);
  assert.equal(google.conversionRate, 0.25);
});

test("funnel: Reddit-app og Reddit-web lander i SAMME række", () => {
  // Kernen i #4320's fund: web og app blev talt hver for sig, hvilket
  // undervurderede kanalen med en tredjedel.
  const rows = aggregateChannelFunnel(
    [visit({ host: "www.reddit.com" }), visit({ host: "com.reddit.frontpage" })],
    [
      { referrer: "https://www.reddit.com/r/cycling" },
      { referrer: "android-app://com.reddit.frontpage/" },
    ]
  );
  const reddit = rows.filter((r) => r.channel === "reddit");
  assert.equal(reddit.length, 1, "reddit må kun optræde som ÉN kanal");
  assert.equal(reddit[0].visits, 2);
  assert.equal(reddit[0].signups, 2);
});

test("funnel: bots ekskluderes fra både tæller og nævner", () => {
  const rows = aggregateChannelFunnel(
    [
      visit({ host: "www.reddit.com" }),
      visit({ host: "www.reddit.com", bot: true }),
      visit({ host: "www.reddit.com", bot: true }),
    ],
    [{ referrer: "https://www.reddit.com/" }]
  );
  const reddit = rows.find((r) => r.channel === "reddit");
  assert.equal(reddit.visits, 1, "kun det menneskelige besøg tælles");
  assert.equal(reddit.conversionRate, 1);
});

test("funnel: self-referral-besøg havner i (direct), ikke som egen kanal", () => {
  // #3819-værn på funnel-niveau.
  const rows = aggregateChannelFunnel(
    [visit({ host: "cyclingzone.org" }), visit({ host: null })],
    []
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channel, "(direct)");
  assert.equal(rows[0].visits, 2);
});

test("funnel: engagement tælles per kanal", () => {
  const rows = aggregateChannelFunnel(
    [
      visit({ host: "www.reddit.com", pageviews: 3 }),
      visit({ host: "www.reddit.com", pageviews: 1, engagedEvents: 1 }),
      visit({ host: "www.reddit.com", pageviews: 1 }),
    ],
    []
  );
  const reddit = rows.find((r) => r.channel === "reddit");
  assert.equal(reddit.engagedVisits, 2);
  assert.equal(reddit.visits, 3);
});

test("funnel: signup uden matchende besøg giver null konverteringsrate, ikke 0", () => {
  // Sker for historiske signups uden for tidsvinduet. 0 % ville læses som
  // "kanalen konverterer elendigt", hvilket er en anden påstand end "vi har
  // ingen besøgsdata for den".
  const rows = aggregateChannelFunnel([], [{ referrer: "https://chatgpt.com/" }]);
  assert.equal(rows[0].channel, "ai-assistant");
  assert.equal(rows[0].signups, 1);
  assert.equal(rows[0].conversionRate, null);
});

test("funnel: sorteret med flest signups øverst", () => {
  const rows = aggregateChannelFunnel(
    [visit({ host: "www.google.com" }), visit({ host: "www.reddit.com" })],
    [
      { referrer: "https://www.reddit.com/" },
      { referrer: "https://www.reddit.com/" },
      { referrer: "https://www.google.com/" },
    ]
  );
  assert.equal(rows[0].channel, "reddit");
  assert.equal(rows[1].channel, "organic-search");
});

test("funnel: tomt input giver tom liste, ikke et kast", () => {
  assert.deepEqual(aggregateChannelFunnel([], []), []);
  assert.deepEqual(aggregateChannelFunnel(null, undefined), []);
});

test("funnel: utm_source på besøget vinder over referrer-værten", () => {
  const rows = aggregateChannelFunnel(
    [visit({ host: "www.google.com", source: "discord" })],
    []
  );
  assert.equal(rows[0].channel, "discord");
});

// --- sanitizeCollectChannel -----------------------------------------------

test("sanitize: udleder værten server-side af den rå referrer", () => {
  const out = sanitizeCollectChannel({ referrer: "https://www.Reddit.com/r/cycling" });
  assert.equal(out.referrer, "https://www.Reddit.com/r/cycling");
  assert.equal(out.referrer_host, "www.reddit.com");
});

test("sanitize: ignorerer en klient-leveret vært", () => {
  // Endpointet er offentligt og uautentificeret. Ville vi stole på klienten,
  // var kanal-rapporten et frit tekstfelt for enhver på internettet.
  const out = sanitizeCollectChannel({
    referrer: "https://www.reddit.com/",
    referrer_host: "paahittet-kanal.example",
  });
  assert.equal(out.referrer_host, "www.reddit.com");
});

test("sanitize: trunkerer til de samme grænser som attribution.js", () => {
  const out = sanitizeCollectChannel({
    referrer: `https://e.example/${"a".repeat(900)}`,
    utm_source: "s".repeat(400),
    landingPath: `/${"p".repeat(400)}`,
  });
  assert.equal(out.referrer.length, 500);
  assert.equal(out.utm_source.length, 200);
  assert.equal(out.landing_path.length, 200);
});

test("sanitize: ikke-strenge og tomme værdier bliver null", () => {
  const out = sanitizeCollectChannel({
    referrer: 42,
    utm_source: { evil: true },
    utm_medium: "   ",
    utm_campaign: null,
  });
  assert.equal(out.referrer, null);
  assert.equal(out.referrer_host, null);
  assert.equal(out.utm_source, null);
  assert.equal(out.utm_medium, null);
  assert.equal(out.utm_campaign, null);
});

test("sanitize: en body der slet ikke er et objekt", () => {
  for (const body of [null, undefined, "streng", 7]) {
    const out = sanitizeCollectChannel(body);
    assert.equal(out.referrer, null);
    assert.equal(out.landing_path, null);
  }
});
