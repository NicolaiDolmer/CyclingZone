// #6067: Taktik-fanen for et løb med regel-revisionen orders_gc_v1.
//
// Alt nyt er usynligt indtil løbet har engine_rules_revision = "orders_gc_v1":
//   1. Legacy-løb (i dag): ingen regel-linje, ingen GC-note, ingen break-note.
//   2. orders_gc_v1-løb: regel-linjen med link til Hjælp, jagt-stancen med de
//      nye labels, linjen om den begrænsede GC-reaktion og linjen om at
//      kaptajn/spurt-kaptajn/hjælper kun går i morgenudbrud med Forsøg udbrud.
//      Ordre-halvdelen vises (den er preview-gated for legacy), og et gem
//      sender den valgte stance.
//
// Samme mønster som race-tactics-tab.spec.js: stabilizePage → installNetworkMocks
// → spec-specifikke overrides → login → goto. Skærmbillederne til PR'ens
// før/efter-billede skrives via evidenceShotPath (CZ_WRITE_COMMITTED_SHOTS=1).
import { test, expect } from "./e2e-base.js";
import {
  installNetworkMocks,
  login,
  stabilizePage,
  evidenceShotPath,
  json,
  corsHeaders,
} from "./fixtures.js";

const RACE_ID = "00000000-0000-4000-8000-000000006067";
const visible = (locator) => locator.filter({ visible: true }).first();

const RIDERS = [
  { rider_id: "r1", name: "Rider One", race_role: "captain", abandoned: false },
  { rider_id: "r2", name: "Rider Two", race_role: "helper", abandoned: false },
  { rider_id: "r3", name: "Rider Three", race_role: "hunter", abandoned: false },
];

function raceFixture(revision) {
  return {
    id: RACE_ID,
    name: "E2E Orders Race",
    race_type: "stage_race",
    race_class: "OtherWorldTourA",
    stages: 3,
    stages_completed: 0,
    edition_year: 2026,
    status: "scheduled",
    season: { id: "season-e2e", number: 1 },
    pool_race: null,
    engine_rules_revision: revision,
  };
}

async function mockOrdersRace(page, { revision }) {
  const putBodies = [];
  const race = raceFixture(revision);
  await page.route("**/rest/v1/races**", (route) => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? race : [race]);
  });
  await page.route("**/rest/v1/race_results**", (route) => json(route, []));
  await page.route("**/rest/v1/race_stage_profiles**", (route) => json(route, []));
  await page.route("**/rest/v1/race_stage_schedule**", (route) => json(route, []));
  await page.route(`**/api/races/${RACE_ID}/stage-roles`, (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() === "PUT") return json(route, { ok: true });
    return json(route, {
      enabled: true,
      intention_enabled: true,
      valid_efforts: ["grupetto", "save", "normal", "protect", "all_out"],
      stages_completed: 0,
      stage_count: 3,
      riders: RIDERS,
      overrides: [],
    });
  });
  await page.route(`**/api/races/${RACE_ID}/team-orders**`, (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() === "PUT") {
      try { putBodies.push(JSON.parse(request.postData() || "{}")); } catch { putBodies.push({}); }
      return json(route, { ok: true });
    }
    return json(route, {
      stage_count: 3,
      stages_completed: 0,
      race_completed: false,
      riders: RIDERS.map(({ rider_id, race_role }) => ({ rider_id, race_role })),
      stages: [1, 2, 3].map((n) => ({ stage_number: n, locked: false, scheduled_at: null })),
      orders: [],
      default_order: {
        breakaway_stance: "neutral",
        riders: [
          { rider_id: "r1", effort: "normal", try_break: false, leadout: false },
          { rider_id: "r2", effort: "normal", try_break: false, leadout: false },
          { rider_id: "r3", effort: "normal", try_break: true, leadout: false },
        ],
      },
    });
  });
  return () => putBodies;
}

test("legacy-løb: Taktik-fanen er uændret, ingen orders_gc_v1-flader", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockOrdersRace(page, { revision: "legacy" });
  await login(page);
  await page.goto(`/races/${RACE_ID}?tab=tactics`);

  const panel = page.getByTestId("race-tactics-tab");
  await expect(panel).toBeVisible();
  await expect(visible(panel.getByRole("button", { name: "Gem etape 1" }))).toBeVisible();
  await expect(panel.getByTestId("race-rules-revision")).toHaveCount(0);
  await expect(panel.getByTestId("orders-gc-break-note")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Vurder undervejs" })).toHaveCount(0);

  if (testInfo.project.name === "desktop-chromium") {
    await page.setViewportSize({ width: 1440, height: 900 });
    await panel.screenshot({ path: evidenceShotPath("pr-screens/6067/raw-legacy-1440.png") });
  }
  if (testInfo.project.name === "mobile-chromium") {
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.screenshot({ path: evidenceShotPath("pr-screens/6067/raw-legacy-390.png") });
  }
});

test("orders_gc_v1-løb: regel-linje, jagt-stance, GC-note og break-note før gem", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  const putBodies = await mockOrdersRace(page, { revision: "orders_gc_v1" });
  await login(page);
  await page.goto(`/races/${RACE_ID}?tab=tactics`);

  const panel = page.getByTestId("race-tactics-tab");
  await expect(panel).toBeVisible();

  // Hvilke regler løbet bruger står i fanens hoved, med link til Hjælp.
  const rules = panel.getByTestId("race-rules-revision");
  await expect(rules).toContainText("Løbets regler");
  await expect(rules).toContainText("Udbrudsordrer og GC-reaktion");
  await expect(rules.getByRole("link", { name: "Sådan virker de" })).toHaveAttribute("href", "/help?section=raceSelection");

  // Jagt-stancen med spec'ens labels og én linje om GC-reaktionen.
  const stances = panel.getByRole("group", { name: "Holdets udbruds-holdning" });
  for (const label of ["Jag", "Vurder undervejs", "Overlad jagten til andre"]) {
    await expect(stances.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  await expect(stances.getByRole("button", { name: "Vurder undervejs", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByText("Holdet kan reagere begrænset på en alvorlig GC-trussel med de ledige ryttere.")).toBeVisible();
  await expect(panel.getByTestId("orders-gc-break-note"))
    .toHaveText("Kaptajn, spurt-kaptajn og hjælper går kun i morgenudbrud med Forsøg udbrud valgt.");

  // Ordrerne kan sættes: Forsøg udbrud findes pr. rytter.
  await expect(visible(panel.getByRole("button", { name: "Rider One forsøger at komme med i udbruddet" }))).toBeVisible();

  // Siden må ikke overflowe vandret (#1834-mønster).
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow, "siden må ikke overflowe vandret").toBeLessThanOrEqual(1);

  if (testInfo.project.name === "desktop-chromium") {
    await page.setViewportSize({ width: 1440, height: 900 });
    await panel.screenshot({ path: evidenceShotPath("pr-screens/6067/raw-orders-gc-1440.png") });
  }
  if (testInfo.project.name === "mobile-chromium") {
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.screenshot({ path: evidenceShotPath("pr-screens/6067/raw-orders-gc-390.png") });
  }

  // Valget gemmes med fanens ene gem.
  await stances.getByRole("button", { name: "Overlad jagten til andre", exact: true }).click();
  await visible(panel.getByRole("button", { name: "Gem etape 1" })).click();
  await expect.poll(() => putBodies().length).toBeGreaterThan(0);
  expect(putBodies().at(-1).breakaway_stance).toBe("let_go");
});
