// #4943 · In-app spørgeskema (/survey/:slug).
//
// Ejer-beslutning 7/9: skemaet bygges i spillet i stedet for Google Forms.
// Smoke-guarden holder på det der gør siden brugbar frem for et Forms-link:
//   1) Siden loader med intro, progress-linje og de 12 spørgsmål i sektioner.
//   2) To-akse-rækken har BEGGE skalaer pr. funktion plus en "ved ikke"-udvej,
//      og den overlever 375 px uden at tabe den anden akse (P10).
//   3) Send er låst indtil alle påkrævede spørgsmål er besvaret, og teksten
//      siger hvor mange der mangler.
//   4) Autosave skriver svaret uden at man trykker Send (det er dét der gør at
//      en lukket fane ikke koster svar).
//   5) Et gennemført skema viser tak-fladen med "du kan rette indtil det lukker".
//   6) Et LUKKET skema viser tak + roadmap-vej, ikke en død formular.
//
// Fixturen låser app'en til DA-locale (stabilizePage → cz_lang=da), så
// assertions matcher public/locales/da/survey.json og seedets label_da.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";
import { installSurveyRoutes } from "../../src/preview/surveyMock.js";

const SLUG = "2026-09-features";
const FIRST_FEATURE = "Følg et løb live mens det kører, etape for etape";

async function openSurvey(page, options) {
  await installNetworkMocks(page);
  await installSurveyRoutes(page, options);
  await stabilizePage(page);
  await login(page);
  await page.goto(`/survey/${SLUG}`);
}

test("skemaet loader med intro, progress og de 12 spørgsmål i sektioner", async ({ page }) => {
  await openSurvey(page);

  await expect(page.getByRole("heading", { name: "Hvad skal jeg bygge næste gang?" })).toBeVisible();
  await expect(page.getByText("Jeg spørger hellere dig end gætter", { exact: false })).toBeVisible();
  await expect(page.getByText("Dine svar gemmes på din konto", { exact: false })).toBeVisible();

  const progress = page.getByRole("progressbar");
  await expect(progress).toBeVisible();
  await expect(progress).toHaveAttribute("aria-valuenow", "0");

  // Sektionerne, i rækkefølge. Ingen løs stak af 12 kort.
  for (const heading of ["Sådan er det i dag", "Idéerne", "Hvad fungerer dårligst", "Hvad du selv ville vælge", "Pro", "Før du sender"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});

test("to-akse-rækken har begge akser og en ved ikke-udvej pr. funktion", async ({ page }) => {
  await openSurvey(page);

  await expect(page.getByRole("radiogroup", { name: `Idé: ${FIRST_FEATURE}` })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: `Vigtigt: ${FIRST_FEATURE}` })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: `Ingen mening om ${FIRST_FEATURE}` })).toBeVisible();

  // 1-5, ikke 0-10: NPS er den eneste 0-10-skala på siden.
  const ideaSteps = page.getByRole("radiogroup", { name: `Idé: ${FIRST_FEATURE}` }).getByRole("radio");
  await expect(ideaSteps).toHaveCount(5);
  await expect(page.getByRole("radiogroup").first().getByRole("radio")).toHaveCount(11);
});

test("ved ikke slår begge akser fra for netop den funktion", async ({ page }) => {
  await openSurvey(page);

  const idea = page.getByRole("radiogroup", { name: `Idé: ${FIRST_FEATURE}` }).getByRole("radio").nth(3);
  await idea.click();
  await expect(idea).toHaveAttribute("aria-checked", "true");

  await page.getByRole("checkbox", { name: `Ingen mening om ${FIRST_FEATURE}` }).check();
  await expect(idea).toBeDisabled();
  await expect(idea).toHaveAttribute("aria-checked", "false");
});

test("Send er låst indtil de påkrævede spørgsmål er besvaret", async ({ page }) => {
  await openSurvey(page);

  const send = page.getByRole("button", { name: "Send mine svar" });
  await expect(send).toBeDisabled();
  await expect(page.getByText("mangler stadig et svar", { exact: false })).toBeVisible();

  // NPS er det første påkrævede: tælleren skal falde når det besvares.
  await page.getByRole("radiogroup").first().getByRole("radio").nth(9).click();
  await expect(page.getByText("4 spørgsmål mangler stadig et svar.")).toBeVisible();
  await expect(send).toBeDisabled();
});

test("autosave skriver svaret uden at man trykker Send", async ({ page }) => {
  const writes = [];
  await installNetworkMocks(page);
  await installSurveyRoutes(page);
  await page.route(/\/rest\/v1\/survey_responses/, async (route) => {
    const request = route.request();
    if (request.method() === "POST") writes.push(request.postData());
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await stabilizePage(page);
  await login(page);
  await page.goto(`/survey/${SLUG}`);

  await page.getByRole("radiogroup").first().getByRole("radio").nth(9).click();
  await expect(page.getByText("Gemt").first()).toBeVisible();
  expect(writes.length).toBeGreaterThan(0);
  expect(writes.join(" ")).toContain('"question_key":"nps"');
  expect(writes.join(" ")).toContain('"score":9');
});

test("et gennemført skema viser tak-fladen og vejen tilbage til svarene", async ({ page }) => {
  await openSurvey(page, { completed: true });

  await expect(page.getByRole("heading", { name: "Tak" })).toBeVisible();
  await expect(page.getByText("Jeg læser hvert eneste svar selv", { exact: false })).toBeVisible();
  await expect(page.getByText("Du kan rette dine svar indtil skemaet lukker.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Se roadmap" })).toHaveAttribute("href", "/roadmap");

  await page.getByRole("button", { name: "Ret mine svar" }).click();
  await expect(page.getByRole("progressbar")).toBeVisible();
});

test("et lukket skema viser tak og en vej til roadmappet, ikke en død formular", async ({ page }) => {
  await openSurvey(page, { status: "closed" });

  // EmptyState-titlen er en <p>, ikke en overskrift (skabelonens egen anatomi).
  await expect(page.getByText("Skemaet er lukket")).toBeVisible();
  await expect(page.getByText("Det der kom ud af det lander på roadmappet.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Se roadmap" })).toHaveAttribute("href", "/roadmap");
  await expect(page.getByRole("button", { name: "Send mine svar" })).toHaveCount(0);
});

test("to-akse-rækken taber ikke den anden akse på 375 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openSurvey(page);

  const importance = page.getByRole("radiogroup", { name: `Vigtigt: ${FIRST_FEATURE}` });
  await expect(importance).toBeVisible();
  await expect(importance.getByRole("radio")).toHaveCount(5);

  // Ingen vandret overflow: alle fem trin ligger inden for viewportet.
  const box = await importance.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(375);
});
