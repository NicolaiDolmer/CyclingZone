// #4624 — genererer docs/audits/quality-audit-2026-09-metrics.md ud fra
// docs/audits/quality-audit-2026-09-metrics.json (skrevet af
// 4624-quality-audit.shots.mjs). Ren formattering, ingen nye maalinger.
//
//   node tests/e2e/4624-generate-metrics-md.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDITS_OUT = resolve(__dirname, "../../../docs/audits");
const metrics = JSON.parse(readFileSync(resolve(AUDITS_OUT, "quality-audit-2026-09-metrics.json"), "utf8"));

const rows = Object.values(metrics).sort((a, b) => a.route.localeCompare(b.route));

function n(v) { return v === undefined || v === null ? "–" : v; }

const header = `# Design-kvalitetsaudit 2026-09 · mekaniske maalinger

> Del 1 af [#4624](https://github.com/NicolaiDolmer/CyclingZone/issues/4624) (slice 2 af designsystem-epic'et #4622).
> Read-only: ingen kildekode aendret. Denne fil er GENERERET af
> \`node tests/e2e/4624-generate-metrics-md.mjs\` ud fra
> \`docs/audits/quality-audit-2026-09-metrics.json\` — redigér ikke direkte.

## Metode (saa tallene kan reproduceres)

- **Server:** \`frontend/scripts/e2e-static-server.mjs\` (samme statiske preview-server som Playwright's \`webServer\`), bygget via \`npm run build\`.
- **Netvaerk:** \`installNetworkMocks\` + \`login\` fra \`frontend/tests/e2e/fixtures.js\` (samme fixtures som resten af e2e-suiten). Ingen kildekode aendret.
- **Ruter:** \`frontend/tests/e2e/4624-audit-routes.mjs\` — 53 unikke ruter krydset fra \`App.jsx\` mod \`src/pages/*.jsx\`. Se \`docs/screenshots/quality-audit-2026-09/manifest.json\` for den fulde liste + skabelon-gaet.
- **Screenshots:** Playwright chromium, \`deviceScaleFactor: 1\`, fullPage. desktop 1280×900, mobil 375×812. Mørk via \`localStorage.setItem("cz-theme","dark")\` foer navigation.
- **Readiness:** \`waitForPageReady\` (samme util som resten af e2e-suiten) + route-specifikke gates for \`/auctions\`, \`/patch-notes\`, \`/planning\`; generisk fallback for resten (main synlig + fonts.ready + stabil main-geometri, 250ms ekstra).
- **Maalingerne herunder er taget PAA desktop-light-varianten** (efter samme readiness-gate), undtagen \`hasHorizontalOverflow\` som er maalt paa mobile-light.
- **chromeBeforeDataPx:** y-afstand fra toppen af \`<main>\` (eller \`<body>\` paa sider uden app-shell — se \`noMainFallback\`) til foerste \`table tbody tr\` / \`[role=row]\` / \`.cz-table\`-raekke; findes ingen tabel, til foerste \`section\`/kort-element der ligger EFTER \`<h1>\`'ets bund. \`chromeMeasuredOn\` viser hvilken gren der blev brugt.
- **unicodeArrows / textGlyphIcons:** optaelling af literale tegn (→ ← ↔ ↑ ↓ › « ») hhv. (✓ ✕ ✦ ▲ ▼ ○ ⓘ) i \`<main>\`'s tekst-noder, SVG ekskluderet.
- **emojiCount:** \`\\p{Extended_Pictographic}\`-matches i samme tekst, minus tegn allerede talt i de to ovenstaaende saet (undgaar dobbelt-taelling).
- **goldPrimaryButtons:** synlige \`button\`/\`a\` hvor computed \`background-color\` ligger inden for ±3 pr. kanal af rgb(232,197,71) (lys) eller rgb(255,217,102)/#ffd966 (moerk).
- **shadowElements:** synlige elementer i \`<main>\` (ekskl. \`[role=dialog]\`/\`.modal\`/\`popover\`/\`toast\`) med computed \`box-shadow ≠ none\`.
- **gradientElements:** computed \`background-image\` indeholder \`"gradient"\`.
- **offTokenRadius:** class-streng matcher \`rounded-(2xl|xl|lg|md|\\[)\`.
- **textBelow10px / textBetween10And12NonToken:** elementer med egen (direkte) tekst hvor computed \`font-size\` er hhv. < 10px, og 10-12px UDEN \`text-2xs\`/\`text-3xs\` i class-strengen.
- **rawHexInClass:** class-streng matcher \`#[0-9a-fA-F]{3,8}\`.
- **bebasCount/bebasSamples:** elementer med egen tekst hvor computed \`font-family\` indeholder "Bebas"; op til 3 tekst-eksempler.
- **emptyStatesCount/emptyStatesTitles:** elementer med \`border-style: dashed\` paa mindst én side (EmptyState-signaturen); titel = foerste \`h1-h4/p/strong\` i elementet.
- **consoleErrors:** antal \`console.error\`-kald + uncaught \`pageerror\` under load (fra goto til readiness-gate faerdig).
- **noMainFallback:** \`true\` hvis siden ikke har et \`<main>\`-element (offentlige sider uden for app-shellen) — maalingerne er saa taget paa \`<body>\` i stedet, hvilket giver stoerre raa-tal (heles siden er "main").

---

## Tabel

| Route | Skabelon | chromeBeforeDataPx (målt på) | pile | glyffer | emoji | guld-knapper | skygger | gradients | off-token radius | <10px | 10-12px u/token | rå hex | Bebas (n) | Empty states | h1 | console-fejl |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
`;

const lines = rows.map((r) => {
  const chrome = r.chromeBeforeDataPx !== undefined && r.chromeBeforeDataPx !== null
    ? `${r.chromeBeforeDataPx}px (${r.chromeMeasuredOn || "?"})`
    : (r.error ? `fejl: ${r.error}` : "–");
  return `| \`${r.route}\` | ${n(r.template)} | ${chrome} | ${n(r.unicodeArrows)} | ${n(r.textGlyphIcons)} | ${n(r.emojiCount)} | ${n(r.goldPrimaryButtons)} | ${n(r.shadowElements)} | ${n(r.gradientElements)} | ${n(r.offTokenRadius)} | ${n(r.textBelow10px)} | ${n(r.textBetween10And12NonToken)} | ${n(r.rawHexInClass)} | ${n(r.bebasCount)} | ${n(r.emptyStatesCount)} | ${r.h1Text ? `"${r.h1Text}"` : "–"} | ${n(r.consoleErrors)} |`;
});

const withData = rows.filter((r) => typeof r.chromeBeforeDataPx === "number");
const sums = {};
for (const key of ["unicodeArrows", "textGlyphIcons", "emojiCount", "goldPrimaryButtons", "shadowElements", "gradientElements", "offTokenRadius", "textBelow10px", "textBetween10And12NonToken", "rawHexInClass", "bebasCount", "emptyStatesCount", "consoleErrors"]) {
  sums[key] = rows.reduce((acc, r) => acc + (typeof r[key] === "number" ? r[key] : 0), 0);
}
const top10 = withData
  .slice()
  .sort((a, b) => b.chromeBeforeDataPx - a.chromeBeforeDataPx)
  .slice(0, 10);
const consoleErrorPages = rows.filter((r) => (r.consoleErrors || 0) > 0);
const errored = rows.filter((r) => r.error || Object.keys(r).some((k) => k.startsWith("error_")));
const annotated = rows.filter((r) => r.auditNote);

const footer = `
---

## Sum pr. indikator (alle 53 ruter)

${Object.entries(sums).map(([k, v]) => `- **${k}**: ${v}`).join("\n")}

## Top-10 sider efter chromeBeforeDataPx (mest chrome foer indhold)

${top10.map((r, i) => `${i + 1}. \`${r.route}\` — ${r.chromeBeforeDataPx}px (${r.chromeMeasuredOn})`).join("\n")}

## Sider med console-fejl under load

${consoleErrorPages.length ? consoleErrorPages.map((r) => `- \`${r.route}\`: ${r.consoleErrors} fejl`).join("\n") : "Ingen."}

## Sider der fejlede helt (screenshot/maaling kunne ikke gennemfoeres)

${errored.length ? errored.map((r) => `- \`${r.route}\`: ${r.error || Object.entries(r).filter(([k]) => k.startsWith("error_")).map(([k, v]) => `${k}=${v}`).join(", ")}`).join("\n") : "Ingen."}

## Saerlige observationer (manuelt tilfoejet efter gennemsyn af screenshots)

${annotated.length ? annotated.map((r) => `- **\`${r.route}\`**: ${r.auditNote}`).join("\n") : "Ingen."}
`;

writeFileSync(resolve(AUDITS_OUT, "quality-audit-2026-09-metrics.md"), header + lines.join("\n") + "\n" + footer, "utf8");
console.log(`[4624] Markdown skrevet (${rows.length} raekker).`);
