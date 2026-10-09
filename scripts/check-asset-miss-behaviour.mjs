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
//
// #5251 runde 2: app-shell-hentningen af `base` (for at finde entry-bundlen) skal
// sende cz_session-cookien, se scripts/lib/fetchAppShell.mjs — ellers faar proben
// siden #4067/#5239 marketing-sitets HTML for et ægte anonymt GET "/", som ikke har
// nogen /assets/index-*.js-reference at finde. De to asset-probes (rigtig + manglende)
// rammer konkrete /assets/*-stier, som IKKE er ramt af middleware'ens matcher, og
// forbliver derfor bevidst helt anonyme — det er dem der reelt tester #4545's adfærd.
//
// #5162 K4: `--carry-forward` maaler i stedet om carry-forward virker i prod:
//   node scripts/check-asset-miss-behaviour.mjs --carry-forward [--base=...] [--sample=5]
// Laeser READ-ONLY de to nyeste manifester i release-lageret
// (scripts/lib/releaseAssetsStore.mjs), vaelger op til 5 JS/CSS-filer der fandtes
// i den forrige release men IKKE i den nuvaerende, og henter dem anonymt paa
// <base>/assets/<navn>. 200 + text/javascript|text/css = baaret videre. 200 +
// text/html (SPA-rewriten) eller 404 = FEJL: en fane fra den forrige release
// rammer da chunk-fallbacken. Uden lager-secrets eller med under to manifester
// springes der over med en tydelig linje (exit 0).

import { fetchAppShell } from "./lib/fetchAppShell.mjs";
import {
  createDirStore,
  createSupabaseStore,
  describeStore,
  listNewestReleaseIds,
  manifestObjectPath,
  resolveStoreConfig,
  validateManifest,
} from "./lib/releaseAssetsStore.mjs";

const DEFAULT_BASE = "https://cyclingzone.org";
const MISSING_ASSET = "/assets/ProbeMissingChunk-DEADBEEF.js";
const CARRY_FORWARD_SAMPLE = 5;

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

// ── #5162 K4: carry-forward-proben ────────────────────────────────────────────

const CARRY_FORWARD_TYPES = { ".js": /javascript|ecmascript/i, ".mjs": /javascript|ecmascript/i, ".css": /text\/css/i };

function extensionOf(name) {
  const match = /\.[A-Za-z0-9]+$/.exec(name);
  return match ? match[0].toLowerCase() : "";
}

/**
 * Navnene (`assets/<fil>`) der fandtes i `previous` men ikke i `current`,
 * begraenset til JS/CSS (det en gammel fane faktisk importerer), sorteret og
 * derefter blandet med `random`, saa hver koersel rammer andre filer. Hoejst `limit`.
 */
export function selectCarryForwardCandidates(previous, current, { limit = CARRY_FORWARD_SAMPLE, random = Math.random } = {}) {
  const currentNames = new Set((current?.files ?? []).map((f) => f.name));
  const pool = [...new Set((previous?.files ?? []).map((f) => f.name))]
    .filter((name) => !currentNames.has(name) && CARRY_FORWARD_TYPES[extensionOf(name)])
    .sort();
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, limit));
}

/** Vurderer ét carry-forward-svar. Returnerer null ved OK, ellers fejlteksten. */
export function evaluateCarriedAsset({ name, status, contentType }) {
  const type = contentType || "";
  if (status === 200 && /text\/html/i.test(type)) {
    return `${name} svarede 200 + text/html — SPA-rewriten svarer i stedet for filen; carry-forward bar den ikke videre`;
  }
  if (status !== 200) {
    return `${name} svarede ${status} — filen fra den forrige release findes ikke laengere paa origin`;
  }
  const expected = CARRY_FORWARD_TYPES[extensionOf(name)];
  if (expected && !expected.test(type)) {
    return `${name} svarede 200 med content-type "${type}", forventede ${extensionOf(name) === ".css" ? "text/css" : "text/javascript"}`;
  }
  return null;
}

export function evaluateCarryForward(results) {
  const failures = [];
  for (const result of results) {
    const failure = evaluateCarriedAsset(result);
    if (failure) failures.push(failure);
  }
  return { failures };
}

/** Lageret read-only, eller { skip } med grunden. Nøglen logges aldrig. */
export function openReleaseStore(env = process.env, { fetchImpl = globalThis.fetch } = {}) {
  const config = resolveStoreConfig(env);
  if (config.kind === "local") return { store: createDirStore(config.dir), label: describeStore(config) };
  if (config.kind === "supabase") {
    return { store: createSupabaseStore({ url: config.url, key: config.key, fetchImpl }), label: describeStore(config) };
  }
  return { skip: config.reason };
}

/**
 * Hele carry-forward-maalingen. Returnerer { status: "skipped" | "ok" | "failed", ... }.
 * Kun GET/LIST mod lageret og anonyme GET mod `base`; ingen skrivning.
 */
export async function runCarryForwardProbe({
  base,
  env = process.env,
  store: injectedStore,
  fetchImpl = globalThis.fetch,
  limit = CARRY_FORWARD_SAMPLE,
  random = Math.random,
  log = console.log,
} = {}) {
  let store = injectedStore;
  let label = "injiceret lager";
  if (!store) {
    const opened = openReleaseStore(env, { fetchImpl });
    if (opened.skip) {
      log(`CARRY-FORWARD-PROBE SPRUNGET OVER: ${opened.skip} — kan ikke laese manifesterne (forventet lokalt uden secrets).`);
      return { status: "skipped", reason: opened.skip };
    }
    ({ store, label } = opened);
  }

  const newest = await listNewestReleaseIds(store, 2);
  if (newest.length < 2) {
    const reason = `lageret (${label}) har ${newest.length} manifest(er), skal bruge 2`;
    log(`CARRY-FORWARD-PROBE SPRUNGET OVER: ${reason} — foerste deploy efter carry-forward baerer intet.`);
    return { status: "skipped", reason };
  }
  const [currentRow, previousRow] = newest;
  const current = validateManifest(await store.getJson(manifestObjectPath(currentRow.id)), currentRow.id);
  const previous = validateManifest(await store.getJson(manifestObjectPath(previousRow.id)), previousRow.id);

  log(`Carry-forward-probe mod ${base}`);
  log(`  nuvaerende release ${current.frontend} (${current.files.length} filer)`);
  log(`  forrige release    ${previous.frontend} (${previous.files.length} filer)`);

  const warnings = [];
  try {
    const res = await fetchImpl(`${base}/version.json`, { redirect: "follow", headers: { "cache-control": "no-cache" } });
    const live = res.ok ? (await res.json())?.frontend : null;
    if (live && live !== current.frontend) {
      warnings.push(`live frontend-id er ${live}, men nyeste manifest er ${current.frontend} — maalingen gaelder maaske ikke det serverede deploy`);
    }
  } catch {
    warnings.push("kunne ikke laese live version.json — kan ikke bekraefte at nyeste manifest er det serverede deploy");
  }

  const names = selectCarryForwardCandidates(previous, current, { limit, random });
  if (!names.length) {
    log("CARRY-FORWARD-PROBE SPRUNGET OVER: den forrige release har ingen JS/CSS-filer som den nuvaerende mangler — intet at maale.");
    return { status: "skipped", reason: "ingen kandidater", warnings };
  }

  const results = [];
  for (const name of names) {
    const url = `${base}/${name}`;
    const res = await fetchImpl(url, { redirect: "follow" });
    results.push({ name, url, status: res.status, contentType: res.headers.get("content-type") });
    log(`  ${name} -> ${res.status} ${res.headers.get("content-type") || ""}`);
  }

  const { failures } = evaluateCarryForward(results);
  for (const w of warnings) log(`  ADVARSEL: ${w}`);
  for (const f of failures) log(`  FEJL: ${f}`);
  if (failures.length) {
    log(`\nCARRY-FORWARD-PROBE FEJLEDE (${failures.length} af ${results.length})`);
    return { status: "failed", failures, warnings, results };
  }
  log(`\nCARRY-FORWARD-PROBE OK (${results.length} filer fra den forrige release svarer 200 med rigtig type)`);
  return { status: "ok", failures, warnings, results };
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

  if (args["carry-forward"]) {
    const sample = Number.parseInt(args.sample, 10);
    const result = await runCarryForwardProbe({ base, limit: Number.isFinite(sample) && sample > 0 ? sample : CARRY_FORWARD_SAMPLE });
    if (result.status === "failed") process.exit(1);
    return;
  }

  const shell = await fetchAppShell(base, { redirect: "follow" });
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
