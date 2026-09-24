// #5384 — skaermbilleder af den SAMLEDE loebs-linje i indbakken.
//
// Ad-hoc capture-script (ikke en del af CI-suiten; testMatch fanger kun
// *.spec.js), samme moenster som 3439-badge-loft.shots.mjs: mocker
// notifications-tabellen i scriptets egen browser-context og fotograferer
// /notifications.
//
// Datasaettet er PRAECIS det samme som i foer-billedet
// (pr-screens/5384-notifications-before-1440.png): et afviklet Amstel Classic
// med Lars Vermeulens foerste sejr, dansk UI, lyst tema, 1440 px.
// Titel/besked er raa tekst uden titleCode/messageCode (som foer-billedet), saa
// de to billeder kan laegges side om side uden at teksten skifter sprog
// undervejs; metadata baerer til gengaeld messageParams.race, netop det
// STRUKTUREREDE felt den nye titel bygger paa.
//
//   node tests/e2e/5384-notifications.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { installNetworkMocks, login, stabilizePage, corsHeaders, TEST_USER } = await import(
  pathToFileURL(resolve(__dirname, "fixtures.js")).href
);

const BASE = process.argv[2] || "http://127.0.0.1:5384";
const OUT = resolve(process.argv[3] || resolve(__dirname, "../../../pr-screens"));

// "7t siden" i begge kort, som i foer-billedet. Milepaelen skrives fem
// sekunder EFTER resultatet (careerFirsts.js koerer efter finaliseringen) —
// det er praecis derfor den gamle "nyeste besked som ansigt"-regel gav
// linjen overskriften "Maiden win".
const SEVEN_HOURS = 7 * 60 * 60 * 1000;
const resultAt = new Date(Date.now() - SEVEN_HOURS);
const milestoneAt = new Date(resultAt.getTime() + 5000);

const NOTIFICATION_ROWS = [
  {
    id: "notif-5384-milestone",
    user_id: TEST_USER.id,
    type: "career_milestone",
    title: "Maiden win",
    message: "Lars Vermeulen won for the first time in Amstel Classic.",
    related_id: "race-amstel-classic",
    is_read: false,
    created_at: milestoneAt.toISOString(),
    metadata: {
      raceId: "race-amstel-classic",
      riderId: "rider-lars-vermeulen",
      eventType: "maiden_win",
      messageParams: { rider: "Lars Vermeulen", race: "Amstel Classic" },
    },
  },
  {
    id: "notif-5384-result",
    user_id: TEST_USER.id,
    type: "race_result",
    title: "Race result is in",
    message: "Amstel Classic has been run. View the result.",
    related_id: "race-amstel-classic",
    is_read: false,
    created_at: resultAt.toISOString(),
    metadata: {
      raceId: "race-amstel-classic",
      messageParams: { race: "Amstel Classic" },
    },
  },
];

async function installNotificationsMock(page) {
  await page.route("**/rest/v1/notifications**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    if (request.method() !== "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: corsHeaders(request),
        body: "[]",
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        ...corsHeaders(request),
        // Layout.jsx's ulaest-badge laeser kun Content-Range.
        "Content-Range": `0-1/${NOTIFICATION_ROWS.length}`,
      },
      body: JSON.stringify(NOTIFICATION_ROWS),
    });
  });
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  baseURL: BASE,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "light",
});
const page = await context.newPage();
await installNetworkMocks(page);
await installNotificationsMock(page);
await stabilizePage(page);
await login(page);

await page.goto("/notifications");
// Den samlede linje er paa plads naar loebets navn staar som overskrift.
await page.getByText("Amstel Classic: resultatet er klar").waitFor();
await page.waitForTimeout(250); // font/paint settle
await page.screenshot({ path: resolve(OUT, "5384-notifications-after-1440.png") });

// Samme linje foldet ud: pilen viser begge underliggende beskeder med
// tidsstempel, og knappen i bunden hedder "Vis detaljer" (ikke "Vis auktion").
await page.getByText("Amstel Classic: resultatet er klar").click();
await page.getByRole("button", { name: /Vis detaljer/ }).waitFor();
await page.waitForTimeout(250);
await page.screenshot({ path: resolve(OUT, "5384-notifications-after-expanded-1440.png") });

await browser.close();
console.log(`✅ skrev 5384-notifications-after-1440.png + -expanded-1440.png til ${OUT}`);
