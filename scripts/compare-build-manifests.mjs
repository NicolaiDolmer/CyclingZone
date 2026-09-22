#!/usr/bin/env node
// Komplet manifest-sammenligning af to frontend-builds (#5160, audit-fund H1).
//
// Hvorfor den findes: `scripts/check-build-determinism.mjs --verify-only` (CI)
// laver ÉT build uden Sentry-transformationen og SCANNER det for kendte
// markør-strenge. Det beviser at netop de strenge ikke er med — ikke at to
// builds giver samme filnavne. Auditten 11/9 målte det modsatte i prod: to
// production-deploys UDEN frontend-diff havde 76 af 195 chunk-referencer
// udskiftet, og den gamle chunk svarede 404 med `max-age=31536000, immutable`.
//
// Denne gate sammenligner derfor HELE dist-træet fra to builds byte for byte:
// relativ sti + sha256 for hver eneste fil. Kun en kort, eksplicit liste af
// filer må variere (HTML + release-metadata, se VARIABLE_PATH_RULES). Alt andet
// er et runtime-asset, og en forskel dér gør gaten rød.
//
// Brug:
//   node scripts/compare-build-manifests.mjs <distA> <distB> [flag]
//
//   --out <dir>       skriv manifest-a.json, manifest-b.json, diff.json og
//                     diff.txt i <dir> (CI uploader mappen som artifact)
//   --label-a <navn>  navn på build A i rapporten (default: mappenavnet)
//   --label-b <navn>  navn på build B i rapporten
//   --context <n>     antal bytes kontekst omkring første forskel (default 100)
//
// Exit 0 = alle runtime-assets identiske. Exit 1 = forskel, eller et ugyldigt
// kald. Ved forskel printes første forskellige byte-offset i den FØRSTE
// afvigende fil plus et kort uddrag fra begge builds, så rod-årsagen kan læses
// direkte i CI-loggen i stedet for at skulle reproduceres lokalt.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PRERENDERED_HTML_FILES } from "../frontend/scripts/public-prerender-routes.mjs";

/**
 * Filer der MÅ variere mellem to builds med forskelligt release-id.
 *
 * Listen er bevidst kort og eksplicit. HTML er kort-cachet, følger deployet og
 * bærer `<meta name="cz-release">` (frontend/vite.config.js: releaseMetaPlugin)
 * — præcis derfor ligger release-sha'en dér og ikke i en hashet chunk (#4595).
 * Alt der IKKE matcher en regel her behandles som runtime-asset: en forskel gør
 * gaten rød. `.map`-filer er med vilje IKKE undtaget — en forskel i et source
 * map betyder at det underliggende modul ændrede sig.
 */
export const VARIABLE_PATH_RULES = [
  {
    path: "index.html",
    why: "prerendret landing; kort-cachet og bærer <meta name=\"cz-release\">",
  },
  {
    path: "app.html",
    why: "app-shell (kopi af index.html før prerender); samme release-meta",
  },
  // #5494: de øvrige offentlige ruter prerenderes nu også (dist/<rute>/
  // index.html). Samme argument som index.html: kort-cachet HTML med
  // release-meta, aldrig et immutable runtime-asset.
  ...PRERENDERED_HTML_FILES.filter((file) => file !== "index.html").map((file) => ({
    path: file,
    why: "prerendret offentlig rute (#5494); kort-cachet og bærer <meta name=\"cz-release\">",
  })),
  {
    path: "version.json",
    why: "release-metadata til versionsdetektion; kort-cachet, aldrig immutable",
  },
];

const VARIABLE_PATHS = new Set(VARIABLE_PATH_RULES.map((rule) => rule.path));

/** True hvis `relPath` er en af de få filer der må variere. */
export function isVariablePath(relPath) {
  return VARIABLE_PATHS.has(relPath);
}

/**
 * Splitter et Vite-asset-navn i mappe, stamme, indholds-hash og endelse, så to
 * builds' UDSKIFTEDE filer kan parres: `assets/AuctionsPage-Goxz2GED.js` og
 * `assets/AuctionsPage-C_27Jy7j.js` er samme modul med to hashes.
 *
 * Hash-genkendelsen er en HEURISTIK og bruges KUN til den menneskelæselige
 * parring i rapporten — aldrig til rød/grøn. Kravet om mindst ét ciffer holder
 * navne som `chunk-selfheal.js` ude af hash-fortolkningen.
 */
export function splitHashedName(relPath) {
  const slash = relPath.lastIndexOf("/");
  const dir = slash === -1 ? "" : relPath.slice(0, slash);
  const base = slash === -1 ? relPath : relPath.slice(slash + 1);

  let name = base;
  let ext = "";
  if (name.endsWith(".map")) {
    ext = ".map";
    name = name.slice(0, -".map".length);
  }
  const dot = name.lastIndexOf(".");
  if (dot > 0) {
    ext = name.slice(dot) + ext;
    name = name.slice(0, dot);
  }

  const match = name.match(/^(.+)-([A-Za-z0-9_-]{8,})$/);
  // Vites hash er base64url og har derfor stort set altid store bogstaver eller
  // cifre (`CIoYOQts`, `Goxz2GED`). Et segment der KUN er små bogstaver er et
  // almindeligt navneled (`chunk-selfheal.js`), ikke en hash.
  if (!match || /^[a-z]+$/.test(match[2])) {
    return { dir, stem: name, hash: null, ext };
  }
  return { dir, stem: match[1], hash: match[2], ext };
}

/** Parringsnøgle: samme mappe, samme stamme, samme endelse. */
export function pairKey(relPath) {
  const { dir, stem, ext } = splitHashedName(relPath);
  return `${dir}\0${stem}\0${ext}`;
}

/** Alle filer under `root`, rekursivt, som POSIX-relative stier. */
export function listFiles(root) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else out.push(rel);
    }
  };
  walk(root, "");
  return out.sort();
}

/** Komplet manifest: relativ sti → { sha256, bytes }. */
export function buildManifest(root, label = path.basename(root)) {
  const files = {};
  for (const rel of listFiles(root)) {
    const buf = fs.readFileSync(path.join(root, rel));
    files[rel] = {
      sha256: crypto.createHash("sha256").update(buf).digest("hex"),
      bytes: buf.length,
    };
  }
  return { label, root, fileCount: Object.keys(files).length, files };
}

/**
 * Første forskellige byte mellem to buffere plus et kort, printbart uddrag fra
 * hver. Returnerer null hvis de er identiske.
 */
export function firstByteDifference(bufA, bufB, context = 100) {
  const shared = Math.min(bufA.length, bufB.length);
  let offset = 0;
  while (offset < shared && bufA[offset] === bufB[offset]) offset += 1;
  if (offset === shared && bufA.length === bufB.length) return null;

  // Inklusivt vindue: `context` bytes paa hver side af selve forskellen.
  const start = Math.max(0, offset - context);
  const end = offset + context + 1;
  return {
    offset,
    bytesA: bufA.length,
    bytesB: bufB.length,
    excerptA: printableSlice(bufA, start, end),
    excerptB: printableSlice(bufB, start, end),
    contextStart: start,
  };
}

// Uddraget skal kunne limes ind i en CI-log uden at oedelaegge den: alt uden
// for printbar ASCII (linjeskift, minificeret stoej, binaere bytes) bliver ".".
function printableSlice(buf, start, end) {
  let out = "";
  for (const byte of buf.subarray(start, Math.min(end, buf.length))) {
    out += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".";
  }
  return out;
}

/**
 * Sammenligner to manifester.
 *
 * Kategorier:
 *   identical     — samme sti, samme sha256
 *   changed       — samme sti, forskelligt indhold (ikke-hashede filer)
 *   replaced      — samme modul, to forskellige indholds-hashes i filnavnet
 *   onlyInA/B     — filer uden modpart overhovedet
 *
 * `runtimeDifferences` er delmængden der gør gaten rød: alt undtagen de stier
 * VARIABLE_PATH_RULES tillader.
 */
export function compareManifests(manifestA, manifestB) {
  const pathsA = Object.keys(manifestA.files);
  const pathsB = Object.keys(manifestB.files);
  const setB = new Set(pathsB);

  const identical = [];
  const changed = [];
  const leftoverA = [];
  const leftoverB = [];

  for (const rel of pathsA) {
    if (!setB.has(rel)) {
      leftoverA.push(rel);
      continue;
    }
    if (manifestA.files[rel].sha256 === manifestB.files[rel].sha256) identical.push(rel);
    else changed.push(rel);
  }
  const setA = new Set(pathsA);
  for (const rel of pathsB) if (!setA.has(rel)) leftoverB.push(rel);

  // Par de filer der kun findes i hver sit build op som "udskiftet" når de er
  // samme modul med to forskellige indholds-hashes.
  const byKeyB = new Map();
  for (const rel of leftoverB) {
    const key = pairKey(rel);
    if (!byKeyB.has(key)) byKeyB.set(key, []);
    byKeyB.get(key).push(rel);
  }
  const replaced = [];
  const onlyInA = [];
  for (const rel of leftoverA) {
    const candidates = byKeyB.get(pairKey(rel));
    if (candidates && candidates.length > 0) replaced.push({ a: rel, b: candidates.shift() });
    else onlyInA.push(rel);
  }
  const onlyInB = [];
  for (const list of byKeyB.values()) onlyInB.push(...list);
  onlyInB.sort();

  const runtimeDifferences = [
    ...changed.filter((rel) => !isVariablePath(rel)).map((rel) => ({ kind: "changed", a: rel, b: rel })),
    ...replaced.filter((pair) => !isVariablePath(pair.a) && !isVariablePath(pair.b)).map((pair) => ({ kind: "replaced", ...pair })),
    ...onlyInA.filter((rel) => !isVariablePath(rel)).map((rel) => ({ kind: "onlyInA", a: rel, b: null })),
    ...onlyInB.filter((rel) => !isVariablePath(rel)).map((rel) => ({ kind: "onlyInB", a: null, b: rel })),
  ];

  const allowedDifferences = [
    ...changed.filter((rel) => isVariablePath(rel)).map((rel) => ({ kind: "changed", a: rel, b: rel })),
    ...replaced.filter((pair) => isVariablePath(pair.a) || isVariablePath(pair.b)).map((pair) => ({ kind: "replaced", ...pair })),
    ...onlyInA.filter((rel) => isVariablePath(rel)).map((rel) => ({ kind: "onlyInA", a: rel, b: null })),
    ...onlyInB.filter((rel) => isVariablePath(rel)).map((rel) => ({ kind: "onlyInB", a: null, b: rel })),
  ];

  return {
    labelA: manifestA.label,
    labelB: manifestB.label,
    fileCountA: pathsA.length,
    fileCountB: pathsB.length,
    identical: identical.sort(),
    changed: changed.sort(),
    replaced: replaced.sort((x, y) => (x.a < y.a ? -1 : 1)),
    onlyInA: onlyInA.sort(),
    onlyInB: onlyInB.sort(),
    runtimeDifferences,
    allowedDifferences,
    ok: runtimeDifferences.length === 0,
  };
}

/** Menneskelæselig rapport. Samme tekst i CI-loggen og i diff.txt-artifactet. */
export function formatReport(diff, { rootA, rootB, context = 100 } = {}) {
  const lines = [];
  lines.push(`Build-determinisme: komplet manifest-sammenligning (#5160)`);
  lines.push(`  A = ${diff.labelA}${rootA ? ` (${rootA})` : ""} — ${diff.fileCountA} filer`);
  lines.push(`  B = ${diff.labelB}${rootB ? ` (${rootB})` : ""} — ${diff.fileCountB} filer`);
  lines.push("");
  lines.push(`  identiske:            ${diff.identical.length}`);
  lines.push(`  udskiftet (ny hash):  ${diff.replaced.length}`);
  lines.push(`  ændret på samme sti:  ${diff.changed.length}`);
  lines.push(`  kun i A:              ${diff.onlyInA.length}`);
  lines.push(`  kun i B:              ${diff.onlyInB.length}`);
  lines.push("");

  if (diff.allowedDifferences.length > 0) {
    lines.push(`Tilladte forskelle (${diff.allowedDifferences.length}) — release-metadata, ikke runtime-assets:`);
    for (const d of diff.allowedDifferences) {
      const rel = d.a ?? d.b;
      const why = VARIABLE_PATH_RULES.find((rule) => rule.path === rel)?.why ?? "";
      lines.push(`  [${d.kind}] ${d.a ?? "-"} → ${d.b ?? "-"}${why ? `  (${why})` : ""}`);
    }
    lines.push("");
  }

  if (diff.ok) {
    lines.push("✅ Alle runtime-assets er byte-identiske på tværs af de to builds.");
    return lines.join("\n");
  }

  lines.push(`❌ ${diff.runtimeDifferences.length} runtime-asset(s) afviger. Asset-navnene er IKKE stabile —`);
  lines.push("   en åben fane fra build A vil få 404 på filer der ikke findes i build B (#5160 / audit H1).");
  lines.push("");
  const shown = diff.runtimeDifferences.slice(0, 25);
  for (const d of shown) {
    lines.push(`  [${d.kind}] ${d.a ?? "-"} → ${d.b ?? "-"}`);
  }
  if (diff.runtimeDifferences.length > shown.length) {
    lines.push(`  ... og ${diff.runtimeDifferences.length - shown.length} mere (se diff.json)`);
  }

  // Rod-årsagen står i bytes, ikke i filnavne: find første forskel i den første
  // afvigende fil der findes i BEGGE builds.
  if (rootA && rootB) {
    const probe = diff.runtimeDifferences.find((d) => d.a && d.b);
    if (probe) {
      const bufA = fs.readFileSync(path.join(rootA, probe.a));
      const bufB = fs.readFileSync(path.join(rootB, probe.b));
      const delta = firstByteDifference(bufA, bufB, context);
      lines.push("");
      lines.push(`Første forskellige byte i ${probe.a} vs ${probe.b}:`);
      if (!delta) {
        lines.push("  (filerne er byte-identiske — kun filnavnet skiftede; se de ØVRIGE afvigelser)");
      } else {
        lines.push(`  offset ${delta.offset} (A: ${delta.bytesA} bytes, B: ${delta.bytesB} bytes)`);
        lines.push(`  A: ...${delta.excerptA}...`);
        lines.push(`  B: ...${delta.excerptB}...`);
      }
    } else {
      lines.push("");
      lines.push("Ingen fil findes i begge builds under samme modul — derfor intet byte-uddrag.");
    }
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  const positional = [];
  const opts = { context: 100 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") opts.out = argv[++i];
    else if (arg === "--label-a") opts.labelA = argv[++i];
    else if (arg === "--label-b") opts.labelB = argv[++i];
    else if (arg === "--context") opts.context = Number(argv[++i]);
    else if (arg.startsWith("--")) throw new Error(`Ukendt flag: ${arg}`);
    else positional.push(arg);
  }
  return { positional, opts };
}

export function main(argv) {
  const { positional, opts } = parseArgs(argv);
  if (positional.length !== 2) {
    console.error("Brug: node scripts/compare-build-manifests.mjs <distA> <distB> [--out <dir>]");
    return 1;
  }
  const [rootA, rootB] = positional.map((p) => path.resolve(p));
  for (const root of [rootA, rootB]) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      console.error(`❌ ${root} findes ikke som mappe — blev begge builds gemt?`);
      return 1;
    }
  }

  const manifestA = buildManifest(rootA, opts.labelA ?? path.basename(rootA));
  const manifestB = buildManifest(rootB, opts.labelB ?? path.basename(rootB));
  if (manifestA.fileCount === 0 || manifestB.fileCount === 0) {
    console.error("❌ Et af buildene er tomt — der er intet at sammenligne.");
    return 1;
  }

  const diff = compareManifests(manifestA, manifestB);
  const report = formatReport(diff, { rootA, rootB, context: opts.context });
  console.log(report);

  if (opts.out) {
    fs.mkdirSync(opts.out, { recursive: true });
    fs.writeFileSync(path.join(opts.out, "manifest-a.json"), `${JSON.stringify(manifestA, null, 2)}\n`);
    fs.writeFileSync(path.join(opts.out, "manifest-b.json"), `${JSON.stringify(manifestB, null, 2)}\n`);
    fs.writeFileSync(path.join(opts.out, "diff.json"), `${JSON.stringify(diff, null, 2)}\n`);
    fs.writeFileSync(path.join(opts.out, "diff.txt"), `${report}\n`);
    console.log(`\nRapport skrevet til ${opts.out}/ (manifest-a.json, manifest-b.json, diff.json, diff.txt)`);
  }

  return diff.ok ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}

export const SCRIPT_PATH = fileURLToPath(import.meta.url);
