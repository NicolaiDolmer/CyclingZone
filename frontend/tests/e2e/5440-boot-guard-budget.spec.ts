// 5440-boot-guard-budget.spec.ts — browserbevis for #5440 punkt 2.
//
// Boot-vagten (public/chunk-selfheal.js) bogfoerte foer kun sit reload i det
// faelles recovery-budget NAAR appen bootede (main.jsx, accountBootGuardReload).
// En fane hvis entry aldrig kan hentes, booter aldrig, og var derfor kun
// begraenset af vagtens egen 60-sekunders-noegle. Nu bogfoerer vagten selv, foer
// reloadet, i samme noegle som de andre lag (`cz:recovery-budget`).
//
// Koerer mod det BYGGEDE /app.html (den tomme shell Vercel rewriter app-ruter
// til), samme opsaetning som 5161-entry-404-selfheal.spec.js.
//
// Refs #5440 #5162 #5161
import type { Page } from "@playwright/test";
import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage } from "./fixtures.js";

const DOCUMENT_PATH = "/app.html";
const BUDGET_KEY = "cz:recovery-budget";
const BUDGET_MAX = 3;
const GUARD_KEY = "cz_chunk_selfheal_at";

async function readEntryPath(page: Page): Promise<string> {
  const response = await page.request.get(DOCUMENT_PATH);
  expect(response.ok(), `${DOCUMENT_PATH} kunne ikke hentes fra preview-serveren`).toBeTruthy();
  // Kommentarer fjernes til strengen holder op med at aendre sig (CodeQL #360,
  // samme moenster som 5161-specen): index-kommentaren citerer datablok-tagget.
  let html = await response.text();
  let previous: string;
  do {
    previous = html;
    html = html.replace(/<!--[\s\S]*?-->/g, "");
  } while (html !== previous);
  const match = html.match(/<script\b[^>]*\bid="cz-boot-assets"[^>]*>([\s\S]*?)<\/script>/);
  expect(match, `${DOCUMENT_PATH} mangler <script id="cz-boot-assets">`).not.toBeNull();
  const urls = JSON.parse(match![1]) as string[];
  const entry = urls.find((url) => url.endsWith(".js"));
  expect(entry, "boot-listen indeholdt ingen JS-entry").toBeTruthy();
  return entry!;
}

// Entry-bundlen svarer 404 i HVERT load: appen booter aldrig, og main.jsx'
// bogfoering koerer aldrig. Kun dokument-loads taelles (vagtens canary-fetch
// mod location.href rammer samme sti som "fetch").
async function breakEntryForever(page: Page, entryPath: string): Promise<() => number> {
  let documentLoads = 0;
  await page.route(
    (url) => url.pathname === DOCUMENT_PATH,
    async (route) => {
      if (route.request().resourceType() === "document") documentLoads += 1;
      await route.fallback();
    },
  );
  await page.route(
    (url) => url.pathname === entryPath,
    (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "Not Found" }),
  );
  return () => documentLoads;
}

function collectGuardWarnings(page: Page): string[] {
  const lines: string[] = [];
  // e2e-error-collector-exempt: specen asserter IKKE paa "ingen fejl" — den
  // leder efter boot-vagtens egne "[chunk-selfheal]"-linjer.
  page.on("console", (msg) => {
    if (msg.text().includes("[chunk-selfheal]")) lines.push(msg.text());
  });
  return lines;
}

const fallbackHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "The game did not start" });

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("et budget brugt op af andre lag: vagten reloader IKKE, fallback-siden vises med det samme", async ({ page }) => {
  const entryPath = await readEntryPath(page);
  const warnings = collectGuardWarnings(page);
  // Tre automatiske reloads er allerede brugt i denne fane (fx af release-
  // watcheren og chunk-fejl-handleren), inden for det rullende vindue.
  await page.addInitScript(
    ([key, max]) => {
      try {
        window.sessionStorage.setItem(
          key as string,
          JSON.stringify({ used: max, windowStart: Date.now() - 1000, last: "chunk-error" }),
        );
      } catch {
        // sessionStorage utilgaengelig — assertionerne fejler i stedet.
      }
    },
    [BUDGET_KEY, BUDGET_MAX],
  );
  const loads = await breakEntryForever(page, entryPath);

  await page.goto(DOCUMENT_PATH);

  await expect(fallbackHeading(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
  await page.waitForTimeout(800);
  expect(loads(), "budgettet er brugt: nul automatiske reloads").toBe(1);
  expect(warnings.join("\n")).toMatch(/recovery-budget brugt op/);
  const guardKey = await page.evaluate((key) => window.sessionStorage.getItem(key), GUARD_KEY);
  expect(guardKey, "et afvist forsoeg braender ikke vagtens egen noegle").toBeNull();
});

test("en fane der ALDRIG booter: budgettet stopper loopet, ogsaa naar 60-sekunders-noeglen er udloebet", async ({ page }) => {
  const entryPath = await readEntryPath(page);
  // Hvert dokument aelder vagtens egen noegle, som om spilleren ventede mere end
  // et minut mellem hvert load. Paa den gamle vagt var det ubegraenset: appen
  // booter aldrig, saa main.jsx bogfoerte aldrig noget i budgettet.
  await page.addInitScript((key) => {
    try {
      if (window.sessionStorage.getItem(key)) {
        window.sessionStorage.setItem(key, String(Date.now() - 120_000));
      }
    } catch {
      // sessionStorage utilgaengelig — assertionerne fejler i stedet.
    }
  }, GUARD_KEY);
  const loads = await breakEntryForever(page, entryPath);

  await page.goto(DOCUMENT_PATH);

  // Tre bogfoerte reloads (første load + tre = fire), derefter fallback-siden.
  await expect.poll(loads, { timeout: 30_000, message: "vagten stoppede ikke" }).toBe(BUDGET_MAX + 1);
  await expect(fallbackHeading(page)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  expect(loads(), "ingen reload-loop efter at budgettet er brugt").toBe(BUDGET_MAX + 1);
  const budget = await page.evaluate((key) => window.sessionStorage.getItem(key), BUDGET_KEY);
  expect(JSON.parse(budget ?? "{}")).toMatchObject({ used: BUDGET_MAX, last: "boot-guard" });
});
