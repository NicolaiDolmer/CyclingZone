// #5312 — en spiller kunne ikke aabne sit dashboard: browseren fik INTET
// HTTP-svar paa ~11 kald mod backenden ("Status code: (null)" i Firefox'
// konsol). Fladen sagde "Kunne ikke indlæse dashboardet" — en besked der peger
// paa spillet, naar problemet er forbindelsen mellem spilleren og serveren.
// Han havde intet at handle paa, og vi fik det foerst at vide via Discord.
//
// De to tests er hinandens kontrol: SAMME flade, to forskellige aarsager.
// Uden den anden kunne man "bestaa" den foerste ved at vise offline-teksten
// paa enhver fejl — og saa ville en fejl fra vores EGEN server sende
// spilleren ud at fejlsoege sit eget netvaerk uden grund.
//
// route.abort() er den aegte tilstand, ikke en tilnaermelse: requesten fejler
// paa transport-niveau, saa fetch() kaster den samme TypeError som hos
// spilleren i stedet for at levere et svar med en statuskode. Verificeret i
// browseren: konsollen logger "Dashboard load failed: TypeError: Failed to
// fetch" fra apiFetch, praecis som i hans skaermbillede.
//
// Moenster: stabilizePage (saetter cz_lang=da) -> installNetworkMocks ->
// spec-override (LIFO) -> login -> goto, samme som 4165-planning-load-error.
// Copyen der assertes paa er derfor den danske.
//
// #5325: den kanoniske ErrorState (components/ui/ErrorState.jsx) har nu
// role="alert" paa rod-elementet, saa fejlen kan findes via getByRole("alert")
// i stedet for kun paa tekstindholdet.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, corsHeaders } from "./fixtures.js";

const OFFLINE_COPY = "Kan ikke få forbindelse til spillets server. Tjek din forbindelse, og prøv igen.";
const GENERIC_COPY = "Kunne ikke indlæse dashboardet. Prøv igen.";

test("naar backenden slet ikke kan naas, siger dashboardet det - ikke 'kunne ikke indlaeses'", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  // Alle kald mod Express-API'et fejler paa transport-niveau.
  await page.route("**/api/**", (route) => route.abort("failed"));

  await login(page);
  await page.goto("/dashboard");

  // #5325: ErrorState har nu role="alert" — assert via rollen, ikke kun teksten.
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(OFFLINE_COPY);
  // Selve bugget: den gamle, misvisende besked maa IKKE staa her.
  await expect(page.getByText(GENERIC_COPY)).toHaveCount(0);
  // Retry skal stadig findes — en netvaerksfejl er ofte forbigaaende.
  await expect(page.getByRole("button", { name: "Prøv igen" })).toBeVisible();
});

test("naar serveren svarer, faar spilleren ikke besked om sit eget netvaerk", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  // Serveren ER der — den fejler bare. Det er en HELT anden tilstand end
  // "kaldet naaede aldrig frem", og spilleren skal ikke sendes ud at tjekke
  // sit netvaerk for noget der sker hos os.
  await page.route("**/api/**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      headers: corsHeaders(request),
      body: JSON.stringify({ error: "boom" }),
    });
  });

  await login(page);
  await page.goto("/dashboard");

  // Dashboardet klarer et 5xx-svar uden at gaa i fejl-tilstand overhovedet
  // (kaldene er enkeltvis afskaermede) — og saa skal ingen af de to
  // fejlbeskeder staa der.
  // Dashboardets egen holdundertekst — entydig, i modsaetning til "Division 2"
  // alene, som ogsaa staar i sidemenuen og i stillings-overskriften.
  await expect(page.getByText("Division 2 · 1 rytter")).toBeVisible();
  await expect(page.getByText(OFFLINE_COPY)).toHaveCount(0);
  await expect(page.getByText(GENERIC_COPY)).toHaveCount(0);
});
