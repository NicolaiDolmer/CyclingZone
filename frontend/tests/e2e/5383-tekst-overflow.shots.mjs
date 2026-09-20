// #5383 — foer/efter-udsnit af de flader tekst-vagten fik rettet.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; playwright's testMatch fanger
// kun *.spec.js). Koerer mod en koerende preview-server med e2e-netvaerksmocks.
//
//   node tests/e2e/5383-tekst-overflow.shots.mjs <baseURL> <outDir> <foer|efter>
//
// Kaldes to gange af scripts/..-wrapperen: een gang med DataTable.jsx paa
// commit'en FOER rettelsen ("foer") og een gang paa den rettede ("efter"), saa
// begge halvdele er aegte skaermbilleder af koerende kode — ikke en rekonstruktion
// med indsproejtet CSS.
//
// Bredden er 412x915: den Android-bredde vagten selv maaler paa.

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:5399";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens/5383-raw"));
const LABEL = process.argv[4] || "efter";

const SURFACES = [
  { name: "riders", path: "/riders" },
  { name: "academy", path: "/academy" },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  baseURL: BASE,
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
await installNetworkMocks(page);
await stabilizePage(page);
await login(page);

for (const surface of SURFACES) {
  await page.goto(surface.path);
  await page.waitForLoadState("networkidle");
  await page.locator("main table").first().waitFor();
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await page.waitForTimeout(250);
  // Selve tabelkortet, ikke hele siden: udsnittet skal vise navnecellen, ikke
  // sidehovedet.
  const card = page.locator("main table").first().locator("xpath=ancestor::div[1]");
  await card.screenshot({ path: resolve(OUT, `5383-${surface.name}-${LABEL}.png`) });
}

await context.close();
await browser.close();
console.log(`[5383] ${LABEL}-udsnit skrevet til ${OUT}`);
