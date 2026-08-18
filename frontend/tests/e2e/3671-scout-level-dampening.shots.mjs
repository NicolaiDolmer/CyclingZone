// #3671 — screenshots af den nye scout-knap-dæmpning på rytterprofilens
// Scouting-fane. Det RELATIVE gulv (backend/lib/scoutEngine.scoutHalfWidth,
// #3671) betyder at intet niveau længere køber nul for nogen spejder-rating —
// dæmpningen her er et SIKKERHEDSNET, ikke en normaltilstand. Screenshots
// viser begge sider af gaten på samme rival-rytter (niveau 2 af 3):
//   1) normal   — næste niveau køber noget (knap aktiv, grå tekst)
//   2) ubrugelig — næste niveau er under UI-opløsningen (knap dæmpet, advarselstekst)
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js). Kører mod en kørende dev-server med e2e-netværksmocks, samme
// mønster som 3810-transfer-listed-badge.shots.mjs.
//
//   node tests/e2e/3671-scout-level-dampening.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, RIDERS, json } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:5188";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

// Egen syntetisk rival-rytter (ikke "rider-2") — den ægte rider-2 er allerede
// bundet til en aktiv seed-auktion (AUCTIONS), som ville overskygge Scouting-
// fanens tilstand med en bud-boks. Samme teknik som
// 3810-transfer-listed-badge.shots.mjs (spread af en seed-rytter, ny id).
const base = RIDERS.find((r) => r.id === "rider-2");
const RIVAL_RIDER = {
  ...base,
  id: "rider-shot-scoutlevel",
  firstname: "Precisions",
  lastname: "Testesen",
  pending_team_id: null,
  pending_team: null,
};

// Fælles rapport-skelet (niveau 2 af 3, rival-rytter) — kun `precision` og
// `verdict.confidence` varierer mellem de to scenarier.
function reportFor({ nextGain, nextLevelIsUseless }) {
  return {
    level: 2, maxLevel: 3, own: false, capsMissing: false,
    primaryKey: "climber",
    stars: { lo: 3.5, hi: 4.5 },
    types: [
      { key: "sprinter", now: 18, ceilLo: 22, ceilHi: 30 },
      { key: "tt", now: 26, ceilLo: 31, ceilHi: 40 },
      { key: "climber", now: 31, ceilLo: 38, ceilHi: 47 },
      { key: "puncheur", now: 24, ceilLo: 29, ceilHi: 38 },
      { key: "brostensrytter", now: 19, ceilLo: 24, ceilHi: 33 },
      { key: "baroudeur", now: 25, ceilLo: 30, ceilHi: 39 },
      { key: "rouleur", now: 27, ceilLo: 33, ceilHi: 42 },
      { key: "gc", now: 29, ceilLo: 35, ceilHi: 44 },
    ],
    verdict: { headlineKey: "monitor", confidence: "medium", factorKeys: ["ceiling_gap", "type_match"] },
    precision: {
      halfWidth: 4.9,
      nextHalfWidth: nextLevelIsUseless ? 4.72 : 4.06,
      nextGain,
      nextLevelIsUseless,
      maxUsefulLevel: nextLevelIsUseless ? 2 : 3,
      limitedByScout: nextLevelIsUseless,
    },
    value: null,
    scout: { isDefault: true, name: null, tier: null, overall: 40, hiredAt: null },
    generatedAt: new Date().toISOString(),
  };
}

const SCENARIOS = [
  {
    slug: "active",
    label: "next level buys something — button stays active",
    report: reportFor({ nextGain: 0.84, nextLevelIsUseless: false }),
  },
  {
    slug: "dampened",
    label: "next level is under the useful-gain floor — button is dampened (safety net)",
    report: reportFor({ nextGain: 0.18, nextLevelIsUseless: true }),
  },
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 393, height: 852 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

for (const scenario of SCENARIOS) {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      baseURL: BASE,
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      locale: "da-DK",
    });
    const page = await context.newPage();
    await installNetworkMocks(page);
    // #3671: override kun DENNE rival-rytters scouting-report — resten af
    // mockHandlers.js' respons (hidden:true for ikke-scoutede rivaler) skal
    // stadig gælde for alle andre ryttere.
    await page.route("**/api/riders/*/scouting-report**", (route) => {
      const url = route.request().url();
      if (!url.includes(`/riders/${RIVAL_RIDER.id}/`)) return route.fallback();
      return json(route, scenario.report);
    });
    // #3671-script-note: begge disse queries kaldes med .single()/.maybeSingle()
    // (Accept: vnd.pgrst.object+json) — PostgREST svarer da med et RÅT objekt,
    // ikke en 1-elements array. json(route, [x]) fik supabase-js's parser til at
    // returnere et array som "rider" (alle felt-opslag blev undefined, hero
    // faldt til estimat-fallbacks: "Fri agent"/"1.000"/"~161"). Objektform er
    // derfor obligatorisk her, ikke kosmetisk.
    await page.route("**/rest/v1/riders**", (route) => {
      if (route.request().method() !== "GET") return json(route, {});
      const url = route.request().url();
      if (url.includes(`id=eq.${RIVAL_RIDER.id}`)) return json(route, RIVAL_RIDER);
      return route.fallback();
    });
    // mockHandlers.js' "rider_derived_abilities"-case bygger sine rækker af
    // RIDERS (den syntetiske rytter er ikke medlem) — uden denne ville heltens
    // rating/loft-plade vise "0"/"—" i stedet for tal, og skærmbilledet ville
    // se defekt ud af en grund der intet har med #3671 at gøre.
    await page.route("**/rest/v1/rider_derived_abilities**", (route) => {
      if (route.request().method() !== "GET") return json(route, {});
      const url = route.request().url();
      if (url.includes(`rider_id=eq.${RIVAL_RIDER.id}`)) {
        return json(route, { rider_id: RIVAL_RIDER.id, formula_version: 2, ...base.rider_derived_abilities });
      }
      return route.fallback();
    });
    // mockHandlers.js' "auctions"-case filtrerer IKKE på rider_id (kendt
    // preview-mock-hul, uafhængigt af #3671) — uden denne override ville ENHVER
    // rytterprofil vise seedets aktive auktion på rider-2, uanset hvilken
    // rytter der reelt vises.
    await page.route("**/rest/v1/auctions**", (route) => {
      if (route.request().method() !== "GET") return json(route, {});
      return json(route, []);
    });
    await stabilizePage(page);
    await login(page);
    await page.goto(`/riders/${RIVAL_RIDER.id}?tab=scouting`);
    await page.getByText(/Delvist scoutet|Partly scouted/).first().waitFor();
    await page.waitForTimeout(200);
    // fullPage: begge steder der bærer #3671-beviset skal med i ét billede —
    // knappen (sikkerhedsnettet, øverst i verdict-kortet) OG PrecisionNote-
    // linjen (den synlige forklaring, nederst i type-kortet) ligger for langt
    // fra hinanden til at dele én viewport-højde.
    await page.screenshot({
      path: resolve(OUT, `3671-scout-level-${scenario.slug}-${vp.name}.png`),
      fullPage: true,
    });
    console.log(`  ${scenario.slug}/${vp.name}: ${scenario.label}`);
    await context.close();
  }
}

await browser.close();
console.log(`Screenshots → ${OUT}`);
