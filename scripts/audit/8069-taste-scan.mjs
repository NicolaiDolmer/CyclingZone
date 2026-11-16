// scripts/audit/8069-taste-scan.mjs: read-only TASTE-scanner (#8069, audit 16/11).
// Tæller kandidat-brud pr. fil og fører dem op til ruternes sidefiler via
// import-grafen. Tallene er KANDIDATER: kommentarer, SVG-koordinater og
// tælle-piller giver falske positiver, så hvert fund i rapporten er
// efterset i koden. Kør fra repo-roden: node scripts/audit/8069-taste-scan.mjs out.json
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

const ROOT = resolve("frontend/src");
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) { if (!["test", "__tests__", "preview"].includes(n)) walk(p); continue; }
    if (!/\.(jsx|tsx|js|ts)$/.test(n)) continue;
    if (/\.(test|spec|stories)\./.test(n) || /\.d\.ts$/.test(n)) continue;
    files.push(p);
  }
})(ROOT);

const strip = (line) => line.replace(/\/\/.*$/, "");
const RULES = {
  gold: (src) => (src.match(/variant\s*[=:]\s*\{?\s*["'`]primary["'`]/g) || []).length
    + (src.match(/\bbg-cz-accent\b(?![\/-])[^"'`]*\btext-(?:cz-)?(?:navy|ink|on-accent|white|black)/g) || []).length,
  shadow: (src) => (src.match(/\b(?:shadow-(?!none\b|overlay\b)[\w\[]|drop-shadow|boxShadow|box-shadow|backdrop-blur)/g) || []).length,
  border: (src) => (src.match(/\bborder(?:-[lrtbxy])?-(?:[2-8])\b|\bborder-l-cz-accent\b|\bring-[2-8]\b/g) || []).length,
  radius: (src) => (src.match(/\brounded(?:-(?:[tblr]{1,2}|s|e|ss|se|es|ee))?(?:-(?:sm|md|lg|xl|2xl|3xl|\[[^\]]+\]))?(?=[\s"'`}])(?!-cz)/g) || [])
    .filter((m) => m !== "rounded-cz").length,
  icons: (src) => {
    let n = 0;
    for (const raw of src.split("\n")) {
      const l = strip(raw); if (/^\s*\*/.test(l)) continue;
      const m = l.match(/[←-⇿‹›«»✓✔✕✖✗✘✦★☆▲▼▴▾●○ⓘ]|\p{Extended_Pictographic}/gu);
      if (m) n += m.length;
    }
    return n;
  },
  header: (src, rel) => {
    if (!/^pages\//.test(rel)) return 0;
    let n = 0;
    n += (src.match(/<h1\b/g) || []).length;
    n += (src.match(/\bmax-w-(?!4xl\b|5xl\b|\[1600px\])[\w\[\]]+[^"'`]*\bmx-auto\b|\bmx-auto\b[^"'`]*\bmax-w-(?!4xl\b|5xl\b|\[1600px\])[\w\[\]]+/g) || []).length;
    return n;
  },
  tabular: (src) => {
    const lines = src.split("\n"); let n = 0;
    lines.forEach((l, i) => {
      if (!/(formatCz|formatMoney|formatNumber|toLocaleString|toFixed)\s*\(/.test(l)) return;
      if (!/[<>{}]/.test(l) && !/className/.test(lines.slice(Math.max(0, i - 3), i + 2).join(" "))) return;
      const ctx = lines.slice(Math.max(0, i - 4), i + 3).join(" ");
      if (!/font-data|font-mono|tabular-nums|DataTable|HeroStats|cz-table/.test(ctx)) n++;
    });
    return n;
  },
};

const data = {};
for (const f of files) {
  const rel = relative(ROOT, f);
  const src = readFileSync(f, "utf8");
  const r = {}; for (const [k, fn] of Object.entries(RULES)) r[k] = fn(src, rel);
  const imports = [...src.matchAll(/(?:import|from)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)].map((m) => {
    const base = resolve(dirname(f), m[1]);
    for (const ext of ["", ".jsx", ".tsx", ".js", ".ts", "/index.jsx", "/index.tsx", "/index.js", "/index.ts"]) if (existsSync(base + ext) && statSync(base + ext).isFile()) return relative(ROOT, base + ext);
    return null;
  }).filter(Boolean);
  data[rel] = { r, imports };
}

const ROUTES = {
  "/dashboard": "pages/DashboardPage", "/notifications": "pages/NotificationsPage", "/team": "pages/TeamPage",
  "/planning": "pages/PlanningHubPage", "/training": "pages/TrainingPage", "/auctions": "pages/AuctionsPage",
  "/patch-notes": "pages/PatchNotesPage", "/riders": "pages/RidersPage", "/standings": "pages/StandingsPage",
  "/forum": "pages/ForumPage", "/squads/:squad": "pages/SquadPage", "/academy": "pages/AcademyPage",
  "/finance": "pages/FinancePage", "/transfers": "pages/TransfersPage", "/scouting": "pages/ScoutingCentralPage",
  "/races/:raceId": "pages/RaceDetailPage", "/riders/:id": "pages/RiderStatsPage", "/teams/:id": "pages/TeamProfilePage",
  "/board": "pages/BoardPage", "/klub": "pages/KlubPage", "/watchlist": "pages/WatchlistPage", "/help": "pages/HelpPage",
};
const findFile = (stem) => Object.keys(data).find((k) => k.replace(/\.(jsx|tsx|js|ts)$/, "") === stem);
const isShared = (k) => k.startsWith("components/ui/") || k.startsWith("components/layout/");
const out = {};
for (const [route, stem] of Object.entries(ROUTES)) {
  const entry = findFile(stem);
  if (!entry) { out[route] = { missing: stem }; continue; }
  const seen = new Set(); const stack = [entry];
  while (stack.length) { const k = stack.pop(); if (seen.has(k) || !data[k]) continue; if (k !== entry && isShared(k)) continue; seen.add(k); stack.push(...data[k].imports); }
  const tot = {}; const top = {};
  for (const k of seen) for (const [rule, v] of Object.entries(data[k].r)) { if (!v) continue; tot[rule] = (tot[rule] || 0) + v; (top[rule] ||= []).push([k, v]); }
  for (const rule in top) top[rule] = top[rule].sort((a, b) => b[1] - a[1]).slice(0, 4);
  out[route] = { entry, files: seen.size, pageOwn: data[entry].r, tot, top };
}
const ui = Object.entries(data).filter(([k]) => isShared(k)).map(([k, v]) => [k, v.r]).filter(([, r]) => Object.values(r).some(Boolean));
writeFileSync(process.argv[2] || "taste-scan.json", JSON.stringify({ out, ui }, null, 1));
console.log(Object.keys(data).length, "files scanned");
