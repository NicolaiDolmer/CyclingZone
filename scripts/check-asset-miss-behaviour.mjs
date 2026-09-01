#!/usr/bin/env node
// Post-deploy-probe for #4545: maaler hvad et LIVE deploy faktisk svarer paa en
// manglende asset. Enhedstesten i frontend/vercel.rewrites.test.js bevogter vores
// HENSIGT i repoet; denne probe bevogter OPFOERSLEN i produktion. De to fanger
// forskellige ting: en aendring i Vercel-dashboardet, en aendret header-semantik
// eller et deploy fra en aeldre config lader repo-testen staa groen.
//
// Baggrund: SPA-catch-all'en fangede ogsaa /assets/*, saa en chunk der ikke fandtes
// i det serverede deploy svarede 200 + text/html i stedet for 404. Browseren fik en
// HTML-side paa en JS-URL, cachet immutable i et aar, og en spiller sad permanent
// fast bag "Cycling Zone was updated".
//
// Brug:
//   node scripts/check-asset-miss-behaviour.mjs
//   node scripts/check-asset-miss-behaviour.mjs --base=https://preview.vercel.app
//   node scripts/check-asset-miss-behaviour.mjs --require-fresh-miss
//
// --require-fresh-miss goer det til en HARD FEJL at miss-svaret baerer en lang
// cache-header. Den er slaaet fra indtil #2423 P1 (Skew Protection) eller en
// aendret header-regel goer den opnaaelig; indtil da rapporteres den som advarsel,
// saa resten er uovervaaget. Se #4545.

const DEFAULT_BASE = "https://cyclingzone.org";
const MISSING_ASSET = "/assets/ProbeMissingChunk-DEADBEEF.js";

export function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    args[key] = rest.length ? rest.join("=") : true;
  }
  return args;
}

// Entry-bundlen findes i app-shellen som <script type="module" src="/assets/index-*.js">.
export function findEntryAsset(html) {
  const match = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
  return match ? match[1] : null;
}

// En cache-header er "frisk nok" til et fejlsvar hvis browseren ikke gemmer det
// laenge. no-store/no-cache og max-age paa faa minutter er fint; immutable eller
// timer/aar er praecis det der goer en forbigaaende fejl permanent.
export function missResponseIsSafelyCacheable(cacheControl, maxSeconds = 300) {
  const value = (cacheControl || "").toLowerCase();
  if (!value) return true;
  if (value.includes("no-store") || value.includes("no-cache")) return true;
  if (value.includes("immutable")) return false;
  const maxAge = value.match(/max-age=(\d+)/);
  if (!maxAge) return true;
  return Number(maxAge[1]) <= maxSeconds;
}

export function evaluate({ entry, miss }) {
  const failures = [];
  const warnings = [];

  if (!entry.found) {
    failures.push("kunne ikke finde entry-bundlen i app-shellen — proben kan ikke maale noget");
  } else {
    if (entry.status !== 200) {
      failures.push(`en rigtig asset svarede ${entry.status}, forventede 200 (${entry.url})`);
    }
    if (!/javascript|ecmascript/i.test(entry.contentType || "")) {
      failures.push(`en rigtig asset havde content-type "${entry.contentType}", forventede javascript`);
    }
  }

  if (miss.status === 200) {
    failures.push(
      `en manglende asset svarede 200 med content-type "${miss.contentType}" — SPA-fallbacken fanger /assets/ igen (#4545)`,
    );
  } else if (miss.status !== 404) {
    warnings.push(`en manglende asset svarede ${miss.status}, forventede 404`);
  }

  if (/text\/html/i.test(miss.contentType || "")) {
    failures.push("en manglende asset svarede med HTML — import() resolver da til en side i stedet for at fejle (#4545)");
  }

  if (!missResponseIsSafelyCacheable(miss.cacheControl)) {
    warnings.push(
      `fejlsvaret caches laenge: "${miss.cacheControl}" — en forbigaaende miss bliver permanent i browseren. Lukkes af #2423 P1`,
    );
  }

  return { failures, warnings };
}

async function probe(url) {
  const res = await fetch(url, { redirect: "follow" });
  return {
    url,
    status: res.status,
    contentType: res.headers.get("content-type"),
    cacheControl: res.headers.get("cache-control"),
    body: res,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const base = (args.base || DEFAULT_BASE).replace(/\/$/, "");

  const shell = await fetch(base, { redirect: "follow" });
  const html = await shell.text();
  const entryPath = findEntryAsset(html);

  const entry = entryPath
    ? { ...(await probe(base + entryPath)), found: true }
    : { found: false, status: 0, contentType: null, cacheControl: null, url: base };
  const miss = await probe(base + MISSING_ASSET);

  const { failures, warnings } = evaluate({ entry, miss });

  console.log(`Probe mod ${base}`);
  console.log(`  rigtig asset  ${entry.found ? entry.url.replace(base, "") : "(ikke fundet)"} -> ${entry.status} ${entry.contentType || ""}`);
  console.log(`  manglende     ${MISSING_ASSET} -> ${miss.status} ${miss.contentType || ""}`);
  console.log(`  miss-cache    ${miss.cacheControl || "(ingen)"}`);

  for (const w of warnings) console.log(`  ADVARSEL: ${w}`);
  for (const f of failures) console.log(`  FEJL: ${f}`);

  const strict = Boolean(args["require-fresh-miss"]);
  const hardFailures = strict
    ? [...failures, ...warnings.filter((w) => w.startsWith("fejlsvaret caches"))]
    : failures;

  if (hardFailures.length) {
    console.log(`\nPROBE FEJLEDE (${hardFailures.length})`);
    process.exit(1);
  }
  console.log(`\nPROBE OK${warnings.length ? ` (${warnings.length} advarsel/advarsler)` : ""}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-asset-miss-behaviour.mjs")) {
  main().catch((err) => {
    console.error(`PROBE KUNNE IKKE KOERE: ${err?.message || err}`);
    process.exit(1);
  });
}
