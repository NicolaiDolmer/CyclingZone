// #5242 — apiFetch's Retry-After-kontrakt verificeret på tværs af et rigtigt
// UI-flow (opfoelger #5089/#5233, hvor kontrakten kun blev testet i apiFetch's
// egen unit-suite). Bruger RiderStatsPage's rytter-switcher (prev/next), fordi
// koden DER allerede har den præcise produktions-byge apiFetch blev bygget mod
// (se apiFetch.ts's fil-header: "en 429 (rytter-switcher-byge) sætter et
// Retry-After-vindue") — hurtig prev → næste → prev tilbage til SAMME rytter
// inden for vinduet rammer den identiske url to gange.
//
// Scenarie (issue #5242 punkt 5): mock 429 med Retry-After på ÉT kaldsted →
// intet andet kald mod SAMME url inden for vinduet, og INGEN fejlboks
// (apiFetch.ts's kontrakt: "limited" er ikke en fejl kaldstedet skal vise en
// fejlkasse for — modulets fil-header, punkt 2).
//
// Vinduets LÆNGDE er ikke under test — kun at det findes. Testen venter aldrig
// på udløb, så mocken bruger et vindue ingen runner kan overhale: med de
// oprindelige 2 s (backendens rigtige værdi) tog prev→next→prev 2,3-2,4 s på
// GitHubs Windows-runner mod 0,6-1,0 s lokalt, og value-trend blev ramt igen
// 300-400 ms efter vinduet udløb (PR #5235, 2x deterministisk, trace-verificeret;
// postmortem: .claude/learnings/2026-09-15-5242-e2e-real-clock-window-ci-flake.md).
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, corsHeaders, json } from "./fixtures.js";
import { RIDERS } from "../../src/preview/seedData.js";

// #5242: klon af den eksisterende rider-1-fixture (samme felter alle andre
// e2e-tests allerede afhænger af render'er korrekt) med et nyt id + navn — kun
// til at give switcheren et andet hold-medlem at pege "næste" på. Samme hold
// (team_id uændret), så roster-effektens dependency (rider?.team_id) ikke
// rives ned mellem de to ryttere.
const RIDER_A = RIDERS.find((r) => r.id === "rider-1");
const RIDER_B = { ...RIDER_A, id: "rider-5242b", firstname: "Bo", lastname: "Zenberg" };

// Se fil-headeren: vinduet skal være længere end NOGEN runner bruger på
// prev→next→prev (CI målt til 2,4 s; testens egen timeout er 30 s). Ikke 2,
// som backenden sender i dag — den værdi er allerede dækket af apiFetch's
// unit-suite, her handler det kun om "rammer aldrig netværket igen".
const RETRY_AFTER_SECONDS = 60;

test.describe("#5242 — apiFetch 429/Retry-After-backoff er stille, ikke en fejlboks", () => {
  test("gentaget kald mod SAMME url inden for Retry-After-vinduet rammer aldrig netværket, og viser ingen fejl", async ({ page }) => {
    await stabilizePage(page);
    await installNetworkMocks(page);

    // Overskriver EFTER installNetworkMocks (senest-registrerede route vinder,
    // se #3708-specens kommentar) — giver switcheren et rigtigt 2-rytter-hold.
    await page.route("**/rest/v1/riders**", (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
      if (request.method() !== "GET") return json(route, {});
      const wantsObj = (request.headers().accept || "").includes("vnd.pgrst.object");
      const url = request.url();
      if (url.includes("id=eq.rider-1")) return json(route, wantsObj ? RIDER_A : [RIDER_A]);
      if (url.includes("id=eq.rider-5242b")) return json(route, wantsObj ? RIDER_B : [RIDER_B]);
      // Roster-listen til switcher-baren (team_id=eq...): begge ryttere.
      return json(route, [RIDER_A, RIDER_B]);
    });

    // #5242 kerne-fixturen: rider-1's value-trend (hentes UBETINGET ved hver
    // rytter-profil-visning, ikke fane-gated — se RiderStatsPage.jsx's
    // hoved-effekt) svarer ALTID 429 med Retry-After. Et 2. kald mod
    // PRÆCIS denne url inden for vinduet må aldrig nå hertil.
    let riderAValueTrendHits = 0;
    await page.route("**/api/riders/rider-1/value-trend**", (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
      riderAValueTrendHits += 1;
      return route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { ...corsHeaders(request), "Retry-After": String(RETRY_AFTER_SECONDS) },
        body: JSON.stringify({ error: "rate_limited", retry_after_seconds: RETRY_AFTER_SECONDS }),
      });
    });
    // rider-5242b's tilsvarende endpoint svarer normalt — kun rider-1's url er
    // under test, en anden rytters url deler ikke vindue (apiFetch's Map er
    // nøglet PR. url, se apiFetch.ts).
    await page.route("**/api/riders/rider-5242b/value-trend**", (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
      return json(route, { windows: {} });
    });

    await login(page);
    await page.goto("/riders/rider-1");
    await expect(page.getByRole("heading", { name: "Ada Pedersen" }).first()).toBeVisible();
    await expect.poll(() => riderAValueTrendHits).toBeGreaterThanOrEqual(1);
    expect(riderAValueTrendHits).toBe(1);

    // Prev/next — næste rytter, så tilbage til rider-1 igen, INDEN for
    // Retry-After-vinduet. Samme mønster som en spiller der klikker sig frem og
    // tilbage i switcheren (apiFetch.ts's "rytter-switcher-byge").
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("heading", { name: "Bo Zenberg" }).first()).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("heading", { name: "Ada Pedersen" }).first()).toBeVisible();

    // #5242 kernepåstand: stille backoff — intet nyt netværkskald mod rider-1's
    // value-trend, selvom komponenten er remountet/genrendret med samme id.
    expect(riderAValueTrendHits).toBe(1);

    // "ingen fejlboks": et 429/limited er non-kritisk UI (apiFetch.ts's egen
    // kontrakt, punkt 2) — ingen synlig fejl-alert nogen steder på siden.
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});
