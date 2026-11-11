// Guard for kanal-grupperingen i monday-numbers.mjs. Grupperne bærer
// kanal-tabellen i docs/GROWTH_STACK.md §2.1, så en stille ændring her ville
// flytte et tal i SSOT'en uden at nogen opdagede det.
//
// Kør: node --test scripts/monday-numbers.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { classifyChannel, LOST_IN_MARKETING } from "./monday-numbers.mjs";
import { readWeeklySeoDrops, renderWeeklySeoDrops } from "./weekly-seo-report.mjs";

test("AI-assistenter samles i én gruppe (#4322)", () => {
  for (const host of ["https://chatgpt.com/", "https://www.perplexity.ai/x", "https://claude.ai/"]) {
    assert.equal(classifyChannel({ referrer: host }), "AI assistant");
  }
  // ChatGPT saetter selv utm_source; det maa ikke lande som sin egen kanal.
  assert.equal(classifyChannel({ utm_source: "chatgpt.com" }), "AI assistant");
});

test("Gmail-appens referrer er VORES egne mails, ikke en tredjepartskanal", () => {
  assert.equal(classifyChannel({ referrer: "android-app://com.google.android.gm/" }), "email (vores egne mails)");
});

test("Reddit-appen og reddit.com er samme kanal", () => {
  assert.equal(classifyChannel({ referrer: "android-app://com.reddit.frontpage/" }), "reddit");
  assert.equal(classifyChannel({ referrer: "https://www.reddit.com/r/procyclingmanager/" }), "reddit");
});

test("www-praefiks splitter ikke en kanal i to raekker", () => {
  assert.equal(classifyChannel({ referrer: "https://www.dugout-online.com/" }), classifyChannel({ referrer: "https://dugout-online.com/" }));
  assert.equal(classifyChannel({ referrer: "https://www85.hattrick.org/x" }), "hattrick");
});

test("utm_source vinder over referrer, fordi den er vores egen maerkning", () => {
  assert.equal(classifyChannel({ utm_source: "discord", referrer: "https://www.google.com/" }), "discord");
});

test("tom attribution er 'direct / ukendt', aldrig en kanal", () => {
  assert.equal(classifyChannel({}), "(direct / ukendt)");
  assert.equal(classifyChannel({ utm_source: "  ", referrer: "" }), "(direct / ukendt)");
});

test("soegemaskiner samles, og vores egen side holdes ude af kanal-listen", () => {
  assert.equal(classifyChannel({ referrer: "https://www.google.at/" }), "soegning (organisk)");
  assert.equal(classifyChannel({ referrer: "https://duckduckgo.com/" }), "soegning (organisk)");
  // #5310: egen side som referrer uden UTM er tabt attribution, ikke en kanal.
  assert.equal(classifyChannel({ referrer: "https://cyclingzone.org/dashboard" }), LOST_IN_MARKETING);
  assert.equal(classifyChannel({ utm_source: "cyclingzone.org" }), "self-referral");
});

// #5310: laese-side-fallback for raekker fra efter 14/9, hvor marketing-forsiden
// tabte UTM og ekstern referrer, og referreren blev vores egen side.
test("same-origin-referrer med UTM i query klassificeres efter de UTM'er (#5310)", () => {
  assert.equal(classifyChannel({ utm_source: null, referrer: "https://cyclingzone.org/?utm_source=reddit&utm_medium=paid" }), "reddit");
  assert.equal(classifyChannel({ referrer: "https://www.cyclingzone.org/da?utm_source=Discord" }), "discord");
  assert.equal(classifyChannel({ referrer: "https://cyclingzone.org/?utm_source=chatgpt.com" }), "AI assistant");
});

test("same-origin-referrer uden UTM er 'ukendt (tabt i marketing)' (#5310)", () => {
  assert.equal(LOST_IN_MARKETING, "ukendt (tabt i marketing)");
  for (const referrer of [
    "https://cyclingzone.org/",
    "https://cyclingzone.org/how-it-works",
    "https://cycling-zone.vercel.app/",
    "https://cycling-zone-marketing.vercel.app/",
  ]) {
    assert.equal(classifyChannel({ utm_source: null, referrer }), LOST_IN_MARKETING);
  }
});

test("gemt utm_source vinder over UTM i en same-origin-referrer (#5310)", () => {
  assert.equal(classifyChannel({ utm_source: "email", referrer: "https://cyclingzone.org/?utm_source=reddit" }), "email (vores egne mails)");
  // En fremmed referrers query bruges aldrig til UTM.
  assert.equal(classifyChannel({ referrer: "https://evil-cyclingzone.org/?utm_source=reddit" }), "evil-cyclingzone.org");
});

// #5091: samme fejlklasse som Hattrick/self-referral (#5072), nu ogsaa dækket
// for AI_ASSISTANT_HOSTS/OWN_EMAIL_HOSTS/REDDIT_HOSTS/discord/SEARCH_HOSTS.
test("lookalike domains cannot impersonate any kanal-liste", () => {
  for (const domain of [
    "hattrick.org",
    "cyclingzone.org",
    "cycling-zone.vercel.app",
    "discord.com",
    "discordapp.com",
    "chatgpt.com",
    "reddit.com",
    // NB: mail.google.com er bevidst udeladt her - "evil-mail.google.com" ER
    // rent domaenemaessigt en gyldig subdomaene af google.com (searchlisten),
    // saa den overlappende sti er ikke en lookalike-bypass. Dækket separat i
    // "genuine hostnames"-testen nedenfor.
    "bing.com",
    "duckduckgo.com",
  ]) {
    for (const impostor of [`${domain}.example.com`, `evil-${domain}`]) {
      assert.equal(classifyChannel({ referrer: `https://${impostor}/` }), impostor);
      assert.equal(classifyChannel({ utm_source: impostor }), impostor);
    }
    assert.equal(classifyChannel({ referrer: `https://example.com/${domain}` }), "example.com");
    assert.equal(classifyChannel({ referrer: `https://${domain}@example.com/` }), "example.com");
  }
});

test("genuine hostnames and their subdomains retain their channel", () => {
  // Egne domaener: som utm_source er det self-referral, som referrer uden UTM
  // er det tabt attribution (#5310).
  for (const domain of ["cyclingzone.org", "cycling-zone.vercel.app", "cycling-zone-marketing.vercel.app"]) {
    assert.equal(classifyChannel({ referrer: `https://sub.${domain}/` }), LOST_IN_MARKETING);
    assert.equal(classifyChannel({ utm_source: domain }), "self-referral");
  }
  for (const [domain, expected] of [
    ["hattrick.org", "hattrick"],
    ["discord.com", "discord"],
    ["discordapp.com", "discord"],
    ["chatgpt.com", "AI assistant"],
    ["reddit.com", "reddit"],
    ["mail.google.com", "email (vores egne mails)"],
    ["bing.com", "soegning (organisk)"],
    ["duckduckgo.com", "soegning (organisk)"],
  ]) {
    assert.equal(classifyChannel({ referrer: `https://sub.${domain}/` }), expected);
    assert.equal(classifyChannel({ utm_source: domain }), expected);
  }
});

test("Google-soegedomaener er forankret til hele hostname, ikke en substring (#5091)", () => {
  // Repraesentativt udsnit paa tvaers af ccTLD-formerne, inkl. regionale
  // domaener der ville vaere udeladt af en opremset liste (CodeRabbit-fund).
  for (const domain of ["google.com", "google.co.uk", "google.com.au", "google.co.id", "google.com.ar", "google.at", "google.dk"]) {
    assert.equal(classifyChannel({ referrer: `https://www.${domain}/` }), "soegning (organisk)");
    assert.equal(classifyChannel({ referrer: `https://sub.${domain}/` }), "soegning (organisk)");
    assert.equal(classifyChannel({ utm_source: domain }), "soegning (organisk)");
  }
  assert.equal(classifyChannel({ referrer: "https://google.evil.com/" }), "google.evil.com");
  assert.equal(classifyChannel({ referrer: "https://evil-google.com/" }), "evil-google.com");
  assert.equal(classifyChannel({ referrer: "https://google.com.evil.com/" }), "google.com.evil.com");
});

const SEO_NOW = new Date('2026-11-11T12:00:00.000Z');
const SEO_SINCE = '2026-11-04T12:00:00.000Z';
const seoIssue = (number, createdAt = '2026-11-10T12:00:00.000Z', state = 'OPEN') => ({
  number, createdAt, state, url: `https://github.com/NicolaiDolmer/CyclingZone/issues/${number}`,
});
const readSeoFixture = (rows) => readWeeklySeoDrops({ now: SEO_NOW, runGh: async () => JSON.stringify(rows) });

test('weekly SEO report keeps open/closed issues in the exact dated period and deduplicates them', async () => {
  let query;
  const result = await readWeeklySeoDrops({ now: SEO_NOW, runGh: async (args) => {
    query = args;
    return JSON.stringify([
      seoIssue(1, SEO_SINCE), seoIssue(2, '2026-11-10T12:00:00.000Z', 'CLOSED'),
      seoIssue(1, SEO_SINCE), seoIssue(3, '2026-11-04T11:59:59.999Z'),
      seoIssue(4, '2026-11-11T12:00:00.001Z'),
    ]);
  } });
  assert.equal(result?.status, 'complete');
  assert.equal(result?.since, SEO_SINCE);
  assert.equal(result?.until, SEO_NOW.toISOString());
  assert.deepEqual(result?.issues?.map((issue) => issue.number), [2, 1]);
  assert.equal(query?.[query.indexOf('--repo') + 1], 'NicolaiDolmer/CyclingZone');
  assert.equal(query?.[query.indexOf('--label') + 1], 'perf-seo-drop');
  assert.equal(query?.[query.indexOf('--state') + 1], 'all');
  assert.equal(query?.[query.indexOf('--search') + 1], 'created:>=2026-11-04');
});

test('weekly SEO report distinguishes a complete empty issue list from unavailable evidence', async () => {
  const result = await readSeoFixture([]);
  assert.equal(result?.status, 'complete');
  assert.deepEqual(result?.issues, []);
  assert.match(renderWeeklySeoDrops(result), /0 oprettede issues/);
});

test('weekly SEO report contains reader failures without leaking raw errors or claiming zero', async () => {
  const result = await readWeeklySeoDrops({ now: SEO_NOW, runGh: async () => { throw new Error('raw fixture failure'); } });
  assert.equal(result?.status, 'unavailable');
  assert.equal(result?.issues, null);
  assert.ok(!JSON.stringify(result).includes('raw fixture failure'));
  assert.match(renderWeeklySeoDrops(result), /ukendt/);
  assert.doesNotMatch(renderWeeklySeoDrops(result), /0 oprettede issues/);
});

for (const [name, output] of [['invalid JSON', '{'], ['non-array JSON', '{}']]) {
  test(`weekly SEO report marks ${name} unavailable`, async () => {
    const result = await readWeeklySeoDrops({ now: SEO_NOW, runGh: async () => output });
    assert.equal(result?.status, 'unavailable');
    assert.equal(result?.issues, null);
  });
}

for (const [name, row] of [
  ['null row', null],
  ['non-integer issue number', { ...seoIssue(1), number: 1.5 }],
  ['foreign repository URL', { ...seoIssue(1), url: 'https://github.com/example/other/issues/1' }],
  ['mismatched issue URL', { ...seoIssue(1), url: 'https://github.com/NicolaiDolmer/CyclingZone/issues/2' }],
  ['invalid date', { ...seoIssue(1), createdAt: 'not-a-date' }],
  ['invalid state', { ...seoIssue(1), state: 'UNKNOWN' }],
]) {
  test(`weekly SEO report rejects ${name} rather than silently undercounting`, async () => {
    const result = await readSeoFixture([row]);
    assert.equal(result?.status, 'unavailable');
    assert.equal(result?.issues, null);
  });
}

test('weekly SEO report marks a full page incomplete rather than reporting a complete count', async () => {
  const result = await readSeoFixture(Array.from({ length: 100 }, (_, index) => seoIssue(index + 1)));
  assert.equal(result?.status, 'incomplete');
  assert.equal(result?.issues, null);
  assert.match(renderWeeklySeoDrops(result), /ufuldstændig/);
  assert.doesNotMatch(renderWeeklySeoDrops(result), /0 oprettede issues/);
});

test('weekly SEO report renders links and closed issues from complete evidence', () => {
  const text = renderWeeklySeoDrops({ status: 'complete', since: SEO_SINCE, until: SEO_NOW.toISOString(), issues: [seoIssue(2, SEO_SINCE, 'CLOSED')] });
  assert.match(text, /1 oprettede issues/);
  assert.ok(text.includes('[#2](https://github.com/NicolaiDolmer/CyclingZone/issues/2)'));
  assert.ok(text.includes('CLOSED'));
  assert.ok(text.includes(SEO_SINCE));
});

test('weekly SEO report requires an explicit valid date before invoking the GitHub reader', async () => {
  let reads = 0;
  const runGh = async () => { reads++; return '[]'; };
  await assert.rejects(readWeeklySeoDrops({ runGh }), TypeError);
  await assert.rejects(readWeeklySeoDrops({ now: new Date('invalid'), runGh }), TypeError);
  assert.equal(reads, 0);
});
