#!/usr/bin/env node
// Perf/SEO-loop Del 3 — statisk repo-audit til den ugentlige review.
//
// Scanner frontend/index.html (SEO meta/OG/JSON-LD), robots.txt + sitemap.xml og
// bundle-vægt, og skriver en markdown-rapport til stdout. Valgfrit første arg:
// sti til en Lighthouse-prod-JSON → scores foldes ind. Dette er en RAPPORT, ikke
// en gate: exit 0 altid (medmindre uventet crash), så den ugentlige workflow
// aldrig fejler på et fund — fundene er pointen, ikke en blokering.
//
// Brug: `node scripts/audit-perf-seo.mjs [lighthouse-prod.json]`
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lhPath = process.argv[2];

const findings = [];
const add = (sev, area, msg) => findings.push({ sev, area, msg });

// --- 1. index.html SEO regressions-vagt ---
const indexPath = join(root, "frontend", "index.html");
let html = "";
try {
  html = readFileSync(indexPath, "utf8");
} catch {
  add("red", "SEO", `Kan ikke læse ${indexPath}`);
}
const must = [
  ["<title>", "title"],
  ['name="description"', "meta description"],
  ['rel="canonical"', "canonical link"],
  ['property="og:title"', "og:title"],
  ['property="og:description"', "og:description"],
  ['property="og:image"', "og:image (PNG raster)"],
  ['name="twitter:card"', "twitter:card"],
  ["application/ld+json", "JSON-LD structured data"],
];
for (const [needle, label] of must) {
  if (html.includes(needle)) add("green", "SEO", `${label} til stede`);
  else add("red", "SEO", `MANGLER: ${label} — SEO-regression, gendan i frontend/index.html`);
}
const lang = html.match(/<html[^>]*lang="([^"]+)"/)?.[1];
if (lang === "da" && /name="description"[^>]*content="[^"]*manager/i.test(html)) {
  add(
    "yellow",
    "SEO",
    '`<html lang="da">` men meta-indholdet er EN-first — overvej `lang="en"` så crawlere får korrekt sprog-signal (player-facing copy er EN-primary).'
  );
}

// --- 2. robots + sitemap ---
const robotsPath = join(root, "frontend", "public", "robots.txt");
const sitemapPath = join(root, "frontend", "public", "sitemap.xml");
if (existsSync(robotsPath)) {
  const robots = readFileSync(robotsPath, "utf8");
  add("green", "Crawl", "robots.txt findes");
  if (!/sitemap:/i.test(robots)) add("yellow", "Crawl", "robots.txt refererer ikke `Sitemap:` — tilføj for hurtigere indeksering");
} else add("red", "Crawl", "robots.txt mangler i frontend/public/");
if (existsSync(sitemapPath)) {
  const locs = (readFileSync(sitemapPath, "utf8").match(/<loc>/g) || []).length;
  add(locs > 0 ? "green" : "yellow", "Crawl", `sitemap.xml: ${locs} <loc>-entries`);
} else add("red", "Crawl", "sitemap.xml mangler i frontend/public/");

// --- 3. bundle-trend (ingen gate, kun signal) ---
let bundleLine = "Build-output mangler (kør `npm run build`) — bundle-trend ikke målt.";
try {
  const assetsDir = join(root, "frontend", "dist", "assets");
  const sizes = readdirSync(assetsDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => ({ file: f, kb: gzipSync(readFileSync(join(assetsDir, f)), { level: 9 }).length / 1024 }))
    .sort((a, b) => b.kb - a.kb);
  const total = sizes.reduce((s, x) => s + x.kb, 0);
  const budget = JSON.parse(readFileSync(join(root, "frontend", "bundle-budget.json"), "utf8"));
  const pct = (total / budget.total_gzip_kb) * 100;
  const top = sizes.slice(0, 3).map((s) => `${s.file.split("-")[0]} ${s.kb.toFixed(0)}KB`).join(", ");
  bundleLine = `Total gzipped JS **${total.toFixed(1)} KB** (${pct.toFixed(0)}% af budget). Tungeste: ${top}.`;
  // Gul først når vægten spiser ind i marginen over baseline-budgettet (ikke ved
  // selve baseline, hvor pct~100% er normalen).
  add(total > budget.total_gzip_kb ? "yellow" : "green", "Bundle", bundleLine);
} catch {
  add("info", "Bundle", bundleLine);
}

// --- 4. Lighthouse prod (valgfri) ---
let lhLine = "";
if (lhPath && existsSync(lhPath)) {
  try {
    const cats = JSON.parse(readFileSync(lhPath, "utf8")).categories || {};
    const sc = (k) => (cats[k] ? Math.round(cats[k].score * 100) : "n/a");
    lhLine = `Performance ${sc("performance")} · A11y ${sc("accessibility")} · Best-practices ${sc("best-practices")} · SEO ${sc("seo")}`;
    for (const [k, label] of [["performance", "Performance"], ["seo", "SEO"], ["accessibility", "Accessibility"], ["best-practices", "Best-practices"]]) {
      const v = cats[k]?.score;
      if (v != null && v < 0.9) add(v < 0.7 ? "red" : "yellow", "Lighthouse", `${label}-score ${Math.round(v * 100)} (<90) — se prod-rapport.`);
    }
  } catch {
    add("info", "Lighthouse", "Kunne ikke parse Lighthouse-JSON.");
  }
}

// --- render markdown ---
const icon = { red: "🔴", yellow: "🟡", green: "🟢", info: "ℹ️" };
const order = { red: 0, yellow: 1, info: 2, green: 3 };
findings.sort((a, b) => order[a.sev] - order[b.sev]);
const red = findings.filter((f) => f.sev === "red").length;
const yellow = findings.filter((f) => f.sev === "yellow").length;

const out = [];
out.push("# Perf & SEO audit\n");
if (lhLine) out.push(`**Lighthouse (prod):** ${lhLine}\n`);
out.push(`**Bundle:** ${bundleLine}\n`);
out.push(`**Findings:** ${red} 🔴, ${yellow} 🟡 (grønne = OK, vist nederst)\n`);
out.push("| | Område | Note |");
out.push("|---|---|---|");
for (const f of findings) out.push(`| ${icon[f.sev]} | ${f.area} | ${f.msg.replace(/\|/g, "\\|")} |`);
console.log(out.join("\n"));
