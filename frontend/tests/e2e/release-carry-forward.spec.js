// #5162 K4: manuel A->B-proeve af carry-forward i en rigtig browser.
//
// Ejerens leverancebevis (11/9): "to udgivelser i en rigtig browser". Proeven
// koeres MANUELT mod to rigtige deploys og er sprunget over i CI's e2e-shards
// (kraever to deploys, som CI ikke har). Se docs/DEPLOYMENT.md
// §"Carry-forward og retention" for opskriften.
//
//   CZ_CARRY_FORWARD_A_URL=https://<deploy-A> \
//   CZ_CARRY_FORWARD_B_URL=https://<deploy-B> \
//   npx playwright test tests/e2e/release-carry-forward.spec.js \
//     --project=desktop-chromium --project=mobile-webkit
//
// Hvad den goer: aabner en fane paa A (A's HTML + entry), og lader derefter
// fanens /assets/*-requests besvares af B, praecis som naar cyclingzone.org er
// gaaet fra A til B under en aaben fane. Saa navigeres der klient-side (ingen
// reload) til en route hvis chunk ikke var hentet. Den chunk SKAL komme fra B
// med 200 + JS/CSS: findes den kun fordi carry-forward bar den med, er det
// beviset. 200 + text/html (SPA-rewrite) eller 404 er praecis den fejl
// CYCLINGZONE-56 handler om.
//
// version.json routes bevidst IKKE til B: releaseWatch.js maa gerne opdatere
// ved et sikkert punkt, men det er en anden mekanisme (#5159). Her maales kun
// at chunken findes.
//
// Valgfrit:
//   CZ_CARRY_FORWARD_START_PATH   default /login (offentlig, ingen login kraevet)
//   CZ_CARRY_FORWARD_TARGET_PATH  default /terms (lazy chunk, ikke hentet paa /login)
//   CZ_CARRY_FORWARD_ALLOW_SAME_ID=1  tillad samme frontend-id paa A og B
//                                 (proeven beviser da kun routingen, ikke carry-forward)
//   VERCEL_AUTOMATION_BYPASS_SECRET  sendes KUN til A's og B's origin (beskyttede previews)

import { test, expect } from "@playwright/test";

const A_URL = process.env.CZ_CARRY_FORWARD_A_URL;
const B_URL = process.env.CZ_CARRY_FORWARD_B_URL;
const START_PATH = process.env.CZ_CARRY_FORWARD_START_PATH || "/login";
const TARGET_PATH = process.env.CZ_CARRY_FORWARD_TARGET_PATH || "/terms";
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "";

// Kun chunk-klassens fejl taeller: et preview kan have stoej fra telemetri o.l.
// "Unexpected token '<'" og MIME-fejlen er HTML serveret paa en JS-URL.
const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Unexpected token '<'|MIME type/i;

function bypassHeaders() {
  return BYPASS ? { "x-vercel-protection-bypass": BYPASS } : {};
}

function isAssetPath(pathname) {
  return pathname.startsWith("/assets/");
}

function isScriptOrStyle(pathname) {
  return /\.(m?js|css)$/i.test(pathname);
}

async function frontendId(request, origin) {
  const res = await request.get(`${origin}/version.json`, { headers: bypassHeaders() });
  expect(res.status(), `${origin}/version.json`).toBe(200);
  return (await res.json()).frontend;
}

test.describe("release carry-forward A -> B (#5162, manuel)", () => {
  test.skip(!A_URL || !B_URL, "Manuel proeve: saet CZ_CARRY_FORWARD_A_URL og CZ_CARRY_FORWARD_B_URL (to rigtige deploys).");

  test("en fane fra A henter en ny route-chunk fra B uden reload", async ({ page, context, request }) => {
    const a = new URL(A_URL);
    const b = new URL(B_URL);
    const bOrigin = b.origin;

    const idA = await frontendId(request, a.origin);
    const idB = await frontendId(request, bOrigin);
    test.info().annotations.push({ type: "frontend-id", description: `A=${idA} B=${idB}` });
    if (process.env.CZ_CARRY_FORWARD_ALLOW_SAME_ID !== "1") {
      expect(idA, "A og B har samme frontend-id: deler alle chunks, saa proeven beviser intet om carry-forward").not.toBe(idB);
    }

    // Markoer-cookien (#4067) saa "/" aldrig proxy'es til marketing-sitet.
    await context.addCookies([{ name: "cz_session", value: "1", url: a.origin }]);

    const pageErrors = [];
    page.on("pageerror", (err) => {
      const text = String(err?.message || err);
      if (CHUNK_ERROR.test(text)) pageErrors.push(text);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error" && CHUNK_ERROR.test(msg.text())) pageErrors.push(msg.text());
    });

    // Fase 1: A serverer alt. Bypass-headeren sendes kun til A's origin.
    let servedByB = false;
    let pending = 0;
    const fromB = [];
    await page.route(
      (url) => url.origin === a.origin,
      async (route) => {
        const url = new URL(route.request().url());
        if (!servedByB || !isAssetPath(url.pathname)) {
          await route.continue({ headers: { ...route.request().headers(), ...bypassHeaders() } });
          return;
        }
        // Fase 2: origin er "gaaet til B" for fanens assets.
        pending += 1;
        try {
          const response = await route.fetch({
            url: `${bOrigin}${url.pathname}${url.search}`,
            headers: { ...route.request().headers(), ...bypassHeaders() },
          });
          fromB.push({ path: url.pathname, status: response.status(), contentType: response.headers()["content-type"] || "" });
          await route.fulfill({ response });
        } finally {
          pending -= 1;
        }
      },
    );

    await page.goto(`${a.origin}${START_PATH}`, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      window.__czCarryForwardMarker = "A-tab";
    });

    servedByB = true;
    const firstChunk = page
      .waitForResponse((res) => {
        const url = new URL(res.url());
        return url.origin === a.origin && isAssetPath(url.pathname) && isScriptOrStyle(url.pathname);
      }, { timeout: 15000 })
      .catch(() => null);
    await page.evaluate((target) => {
      window.history.pushState({}, "", target);
      window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    }, TARGET_PATH);
    await expect(page).toHaveURL(new RegExp(`${TARGET_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await firstChunk;
    // Lazy chunks kan hente flere chunks i kaskade: vent til alle B-hentninger er faerdige.
    await page.waitForLoadState("networkidle");
    await expect.poll(() => pending, { timeout: 15000 }).toBe(0);

    test.info().annotations.push({ type: "chunks-fra-B", description: fromB.map((r) => `${r.path} ${r.status}`).join(", ") || "(ingen)" });

    const scripts = fromB.filter((r) => isScriptOrStyle(r.path));
    expect(scripts.length, `navigation til ${TARGET_PATH} hentede ingen ny chunk; vaelg en anden CZ_CARRY_FORWARD_TARGET_PATH`).toBeGreaterThan(0);
    for (const r of scripts) {
      expect(r.contentType, `${r.path} fik HTML fra B (SPA-rewrite i stedet for filen)`).not.toMatch(/text\/html/i);
      expect(r.status, `${r.path} fandtes ikke paa B — carry-forward bar den ikke med`).toBe(200);
      expect(r.contentType, `${r.path} content-type`).toMatch(/javascript|ecmascript|text\/css/i);
    }

    // Ingen reload: markoeren fra fase 1 lever stadig, og ingen chunk-fejl naaede siden.
    expect(await page.evaluate(() => window.__czCarryForwardMarker)).toBe("A-tab");
    expect(pageErrors, "chunk-/sidefejl i A-fanen").toEqual([]);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });
});
