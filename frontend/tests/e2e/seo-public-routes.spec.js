import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage } from "./fixtures.js";

// #1404/#1405 — hver public route skal have sin egen <title> + canonical/robots
// via useDocumentHead-hooket (klient-side; SPA-baseline i index.html). Denne
// smoke verificerer at hooket faktisk skriver per-route head efter mount, og at
// titlerne er UNIKKE på tværs af de public-reachable ruter.
//
// stabilizePage() låser DA-locale, så titlerne her er den danske variant; vi
// asserter uniqueness + "Cycling Zone"-suffix + canonical/robots-reglen, ikke
// den eksakte oversættelse (den dækkes af i18n-key-parity-guarden).

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

// path → forventet adfærd. canonicalEndsWith = null betyder "noindex, ingen
// canonical" (ruter uden for sitemap).
const PUBLIC_ROUTES = [
  { path: "/", canonicalEndsWith: "/" },
  { path: "/login", canonicalEndsWith: "/login" },
  { path: "/founder-supporter", canonicalEndsWith: "/founder-supporter" },
  { path: "/privacy-policy", canonicalEndsWith: "/privacy-policy" },
  { path: "/privatlivspolitik", canonicalEndsWith: "/privatlivspolitik" },
  { path: "/reset-password", canonicalEndsWith: null, noindex: true },
  { path: "/ui", canonicalEndsWith: null, noindex: true },
];

test("each public route sets a unique, non-default <title>", async ({ page }) => {
  const titles = new Map();

  for (const route of PUBLIC_ROUTES) {
    await page.goto(route.path);
    await expect(page.locator("main, [id='root']").first()).toBeVisible();
    // Hooket kører i en useEffect efter mount → poll til titlen har ændret sig
    // væk fra den statiske index.html-baseline ("Cycling Zone").
    await expect
      .poll(async () => page.title(), { message: `title for ${route.path}` })
      .not.toBe("Cycling Zone");

    const title = await page.title();
    expect(title, `${route.path} mangler en titel`).toBeTruthy();
    expect(title, `${route.path}-titel skal nævne Cycling Zone`).toContain("Cycling Zone");
    titles.set(route.path, title);
  }

  // Unikke titler på tværs af alle ruter.
  const seen = new Map();
  for (const [path, title] of titles) {
    if (seen.has(title)) {
      throw new Error(
        `Titel "${title}" deles af ${seen.get(title)} og ${path} — skal være unik per route`,
      );
    }
    seen.set(title, path);
  }
});

test("indexable routes get a route-matching canonical; noindex routes get none", async ({
  page,
}) => {
  for (const route of PUBLIC_ROUTES) {
    await page.goto(route.path);
    await expect(page.locator("main, [id='root']").first()).toBeVisible();

    if (route.canonicalEndsWith === null) {
      // noindex-ruter: robots-meta sat, INGEN rod-canonical.
      await expect
        .poll(async () =>
          page.evaluate(() =>
            document.querySelector('meta[name="robots"]')?.getAttribute("content"),
          ),
        )
        .toMatch(/noindex/);
      const canonicalHref = await page.evaluate(
        () => document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
      );
      expect(canonicalHref, `${route.path} må ikke have en canonical`).toBeNull();
    } else {
      await expect
        .poll(async () =>
          page.evaluate(
            () => document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "",
          ),
        )
        .toContain(route.canonicalEndsWith);
    }
  }
});

test("static Organization + WebSite JSON-LD is present on every route; VideoGame only on /", async ({
  page,
}) => {
  // Statisk @graph i index.html → findes på alle ruter.
  await page.goto("/login");
  await expect(page.locator("[id='root']")).toBeVisible();
  const graphTypes = await page.evaluate(() => {
    const el = [...document.querySelectorAll('script[type="application/ld+json"]')].find((s) =>
      s.textContent.includes("@graph"),
    );
    if (!el) return [];
    const data = JSON.parse(el.textContent);
    return (data["@graph"] || []).map((n) => n["@type"]);
  });
  expect(graphTypes).toContain("Organization");
  expect(graphTypes).toContain("WebSite");

  // VideoGame injiceres dynamisk KUN på /.
  await page.goto("/");
  await expect(page.locator("[id='root']")).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          document.querySelector('script[type="application/ld+json"][data-cz-jsonld="videogame"]')
            ?.textContent ?? "",
      ),
    )
    .toContain("VideoGame");

  // ...men ikke på /login.
  await page.goto("/login");
  await expect(page.locator("[id='root']")).toBeVisible();
  const videoGameOnLogin = await page.evaluate(
    () => !!document.querySelector('script[type="application/ld+json"][data-cz-jsonld="videogame"]'),
  );
  expect(videoGameOnLogin, "VideoGame JSON-LD må ikke lække til /login").toBe(false);
});

// #4067 — statisk guard, INGEN netværk: rewrites-listen i frontend/vercel.json
// (marketing/-destinationer) skal matche 1:1 med de sider marketing/app/
// faktisk eksponerer. Uden denne test kan en ny page.tsx i marketing/ blive
// tilføjet uden en tilsvarende rewrite (404 på cyclingzone.org), eller en
// rewrite overleve efter en side er fjernet dér (spøgelses-rute) — begge dele
// opdages først i produktion. Forsiden "/" er bevidst undtaget: den ejes af
// den prerenderede LandingPage i denne PR (#4067-scope), ikke af marketing/.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MARKETING_BASE = "https://cycling-zone-marketing.vercel.app";

function marketingPageRoutes(appDir) {
  // Route-groups ("(en)"/"(da)") bidrager ikke til URL'en; alle andre mapper
  // gør. Kun mapper der reelt indeholder en page.(t|j)sx tæller som en rute.
  const routes = [];
  function walk(dir, segments) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      const isGroup = entry.startsWith("(") && entry.endsWith(")");
      const nextSegments = isGroup ? segments : [...segments, entry];
      const hasPage = readdirSync(full).some((f) => /^page\.(tsx|ts|jsx|js)$/.test(f));
      if (hasPage) routes.push(`/${nextSegments.join("/")}`);
      walk(full, nextSegments);
    }
  }
  walk(appDir, []);
  return routes;
}

test("frontend/vercel.json's marketing-rewrites matcher marketing/app 1:1 (#4067)", () => {
  const vercelConfig = JSON.parse(
    readFileSync(join(repoRoot, "frontend", "vercel.json"), "utf8"),
  );
  const rewrittenPaths = new Set(
    vercelConfig.rewrites
      .filter((r) => r.destination.startsWith(MARKETING_BASE) && r.source !== "/_next/:path(.*)")
      .map((r) => r.source),
  );

  const actualRoutes = new Set(
    marketingPageRoutes(join(repoRoot, "marketing", "app")).filter((r) => r !== "/"),
  );

  for (const route of actualRoutes) {
    expect(rewrittenPaths.has(route), `marketing/app har siden ${route}, men vercel.json rewriter den ikke`).toBe(
      true,
    );
  }
  for (const source of rewrittenPaths) {
    expect(actualRoutes.has(source), `vercel.json rewriter ${source} til marketing/, men siden findes ikke der`).toBe(
      true,
    );
  }
});
