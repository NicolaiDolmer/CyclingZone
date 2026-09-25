import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, RIDERS, TEST_TEAM, json, corsHeaders } from "./fixtures.js";
import { wantsObject } from "../../src/preview/mockHandlers.js";

// #4582 — nedrykning til akademiet: dialogen skal SIGE at kontrakten foelger med.
//
// ── Hvorfor den findes ──────────────────────────────────────────────────────
//
// Tre spillere meldte 1/9 at loennen STEG (17k -> 22k) naar de flyttede en ung
// rytter ned i akademiet. Backend holdt op med at genberegne i #4589, men
// bekraeftelses-dialogen blev staaende uaendret: etiketten sagde stadig
// "Ungdomsloen" over det uaendrede tal, med en "Nuvaerende loen"-raekke med
// praecis samme tal under. En spiller foran et irreversibelt klik kunne altsaa
// stadig ikke se at kontrakten fulgte med - og det var netop dét, tvivlen
// handlede om.
//
// Testen daekker begge grene, fordi kun de to SAMMEN viser at teksten er
// betinget og ikke bare er blevet skiftet ud:
//   1) rytter MED komplet kontrakt  -> "Loen (uaendret)" + kontrakt-noten
//   2) rytter UDEN kontrakt         -> "Ungdomsloen" + den gamle note
//
// Specs koerer paa DA-locale (stabilizePage saetter cz_lang=da).

// rider-1 (Ada Pedersen) er egen rytter, men foedt 2002 = 24 aar i saeson 1, og
// demote-knappen er alders-gatet (isU23). Vi genbruger hende med et yngre
// foedselsaar i stedet for at opfinde en ny rytter: alt andet paa profilen
// (holdet, kontrakten, relationerne i de oevrige mocks) passer saa stadig.
const OWN_RIDER = RIDERS.find((r) => r.id === "rider-1");
const U23_RIDER = { ...OWN_RIDER, birthdate: "2006-04-12" };

// Den rapporterede sag: den frosne kontrakt-loen er LAVERE end en genberegning
// ville give. Arves kontrakten, er newSalary === currentSalary.
const KEEPS_CONTRACT_QUOTE = {
  currentSalary: 17000,
  newSalary: 17000,
  keepsContract: true,
  racesCleared: 0,
  racesOngoing: 0,
};

// Kontraktloes rytter: der ER ingen kontrakt at arve, saa akademi-loennen
// beregnes friskt - og den gamle tekst er stadig den sande.
const FRESH_SALARY_QUOTE = {
  currentSalary: null,
  newSalary: 4200,
  keepsContract: false,
  racesCleared: 0,
  racesOngoing: 0,
};

// Rytterprofilen slaar op i "riders" REST-tabellen, som ikke kender vores
// aendrede foedselsaar - samme override-moenster som 4009-shots-scriptet.
async function mockU23OwnRider(page) {
  await page.route("**/rest/v1/riders**", (route) => {
    const request = route.request();
    if (request.method() !== "GET") return json(route, {});
    const url = request.url();
    const accept = request.headers().accept || "";
    const asSingle = (rows) => (wantsObject(accept) ? (rows[0] || {}) : rows);
    if (url.includes("pending_team_id=eq.")) return json(route, asSingle([]));
    const pool = RIDERS.map((r) => (r.id === U23_RIDER.id ? U23_RIDER : r));
    const idEq = url.match(/[?&]id=eq\.([^&]+)/);
    if (idEq) {
      const id = decodeURIComponent(idEq[1]);
      const match = pool.find((r) => r.id === id);
      return json(route, asSingle(match ? [match] : []));
    }
    if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) {
      return json(route, asSingle(pool.filter((r) => r.team_id === TEST_TEAM.id)));
    }
    return json(route, asSingle(pool));
  });
}

async function mockDemoteQuote(page, quote) {
  await page.route("**/api/riders/*/academy-demote-quote**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, quote);
  });
}

async function openDemoteDialog(page) {
  await page.goto(`/riders/${U23_RIDER.id}`);
  // #5748: én "Flyt trup"-knap; U23 er forvalgt for en 20-årig senior.
  const demoteBtn = page.getByRole("button", { name: /Flyt trup/i }).first();
  await expect(demoteBtn).toBeVisible({ timeout: 20000 });
  await demoteBtn.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { checked: true })).toHaveValue("u23");
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await mockU23OwnRider(page);
  await stabilizePage(page);
});

test("demote-dialogen siger at kontrakten foelger med, naar den goer (#4582)", async ({ page }) => {
  await mockDemoteQuote(page, KEEPS_CONTRACT_QUOTE);
  await login(page);
  const dialog = await openDemoteDialog(page);

  // Etiketten maa ikke kalde den arvede loen en "ungdomsloen" - det var praecis
  // den formulering der fik 17k->22k til at ligne en ny, genberegnet loen.
  await expect(dialog.getByText("Løn (uændret)")).toBeVisible();
  await expect(dialog.getByText("Ungdomsløn")).toHaveCount(0);

  // Noten skal sige det med rene ord.
  await expect(dialog.getByText(/Kontrakten følger med ned uændret/i)).toBeVisible();

  // Delta-raekken droppes: to raekker med samme tal lover en aendring der ikke sker.
  await expect(dialog.getByText("Nuværende løn")).toHaveCount(0);

  // Tallet er der stadig - spilleren skal kunne se hvad han bekraefter.
  await expect(dialog.getByText(/17[.,]000/)).toBeVisible();
});

test("kontraktloes rytter faar stadig den gamle ungdomsloens-tekst (#4582)", async ({ page }) => {
  await mockDemoteQuote(page, FRESH_SALARY_QUOTE);
  await login(page);
  const dialog = await openDemoteDialog(page);

  await expect(dialog.getByText("Ungdomsløn")).toBeVisible();
  await expect(dialog.getByText("Løn (uændret)")).toHaveCount(0);
  await expect(dialog.getByText(/Kontrakten følger med ned uændret/i)).toHaveCount(0);
  await expect(dialog.getByText(/4[.,]200/)).toBeVisible();
});
