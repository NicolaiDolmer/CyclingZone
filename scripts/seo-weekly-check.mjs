#!/usr/bin/env node
// Ugentlig SEO-vagt (#7440), kaldt fra .github/workflows/perf-seo-review.yml.
//
// Laeser Lighthouse-resultater (lhr-*.json) fra en mappe, udtraekker SEO-score pr. URL,
// sammenligner med sidste uges scores og skriver:
//   - <scoresOut>: JSON {url: score0-100} (gemmes som artifact til naeste uge)
//   - <dropReportOut>: markdown, KUN hvis mindst en side er faldet markant.
// Ingen drop-fil = intet issue. Foerste uge (ingen forrige scores) giver aldrig et issue.
//
// Brug: node scripts/seo-weekly-check.mjs <lhciDir> <prevScores.json|-> <scoresOut> <dropReportOut>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// "Markant fald" = mindst saa mange point (0-100) ned fra sidste uge paa en enkelt side.
export const DROP_THRESHOLD = 5;

export function collectSeoScores(dir) {
  const scores = {};
  if (!fs.existsSync(dir)) return scores;
  for (const f of fs.readdirSync(dir)) {
    if (!/^lhr-.*\.json$/.test(f)) continue;
    try {
      const lhr = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const s = lhr?.categories?.seo?.score;
      const url = lhr?.finalUrl || lhr?.requestedUrl;
      if (url && typeof s === "number") scores[url] = Math.round(s * 100);
    } catch {
      // korrupt fil springes over; manglende URL giver bare ingen sammenligning
    }
  }
  return scores;
}

export function findDrops(prev, curr, threshold = DROP_THRESHOLD) {
  const drops = [];
  for (const [url, now] of Object.entries(curr)) {
    const before = prev?.[url];
    if (typeof before === "number" && before - now >= threshold) {
      drops.push({ url, before, now });
    }
  }
  return drops;
}

export function renderDropReport(drops, threshold = DROP_THRESHOLD) {
  return [
    "## SEO-fald paa offentlige sider",
    "",
    `Lighthouse SEO er faldet mindst ${threshold} point siden sidste uges maaling.`,
    "",
    "| Side | Sidste uge | Nu |",
    "|---|---:|---:|",
    ...drops.map((d) => `| ${d.url} | ${d.before} | ${d.now} |`),
    "",
  ].join("\n");
}

function main() {
  const [dir, prevPath, scoresOut, dropOut] = process.argv.slice(2);
  if (!dir || !scoresOut || !dropOut) {
    console.error("Brug: seo-weekly-check.mjs <lhciDir> <prevScores.json|-> <scoresOut> <dropReportOut>");
    process.exit(2);
  }
  const curr = collectSeoScores(dir);
  let prev = {};
  if (prevPath && prevPath !== "-" && fs.existsSync(prevPath)) {
    try {
      prev = JSON.parse(fs.readFileSync(prevPath, "utf8"));
    } catch {
      prev = {};
    }
  }
  fs.writeFileSync(scoresOut, JSON.stringify(curr, null, 2));
  if (fs.existsSync(dropOut)) fs.rmSync(dropOut);
  const drops = findDrops(prev, curr);
  if (drops.length > 0) fs.writeFileSync(dropOut, renderDropReport(drops));
  console.log(`SEO-scores: ${JSON.stringify(curr)}`);
  console.log(drops.length > 0 ? `Markant fald paa ${drops.length} side(r)` : "Intet markant fald");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
