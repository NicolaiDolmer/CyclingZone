import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage } from "./fixtures.js";
import { ORIGIN, PRERENDER_ROUTES } from "../../scripts/public-prerender-routes.mjs";

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
    // Vent til rutens EGEN useDocumentHead har kørt. Signalet er
    // canonical/robots — de skrives i samme effect som titlen, så er de på
    // plads, er titlen det også. #5494: vi kan ikke længere polle "væk fra
    // 'Cycling Zone'" for alle ruter, fordi de prerendrede ruter allerede
    // leverer deres rigtige titel i server-HTML.
    if (route.canonicalEndsWith === null) {
      await expect
        .poll(
          async () =>
            page.evaluate(() =>
              document.querySelector('meta[name="robots"]')?.getAttribute("content"),
            ),
          { message: `robots-meta for ${route.path}` },
        )
        .toMatch(/noindex/);
    } else {
      await expect
        .poll(
          async () =>
            page.evaluate(
              () => document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "",
            ),
          { message: `canonical for ${route.path}` },
        )
        .toContain(route.canonicalEndsWith);
    }
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

// #5494 forward-guard — RÅ HTML, INGEN JS. Dette er præcis det Ahrefs (og
// enhver ikke-renderende crawler) ser. Før #5494 svarede 10 af de 11
// frontend-ejede sitemap-URL'er med den tomme app-shell: title "Cycling Zone",
// canonical mod forsiden, 0 H1. Testen henter dokumentet med request.get —
// page.goto ville køre SPA'ens JS og dermed måle useDocumentHead i stedet for
// server-HTML'en, altså netop det der IKKE var problemet.
test("hver prerendret rute svarer med rute-matchende canonical, unik title og et H1 i RÅ HTML (#5494)", async ({
  request,
}) => {
  const titles = new Map();

  for (const route of PRERENDER_ROUTES) {
    const response = await request.get(route.path);
    expect(response.status(), `${route.path} skal svare 200`).toBe(200);
    const html = await response.text();

    const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/)?.[1];
    expect(canonical, `${route.path} mangler canonical i server-HTML`).toBe(
      `${ORIGIN}${route.path}`,
    );

    const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim();
    expect(title, `${route.path} mangler <title> i server-HTML`).toBeTruthy();
    expect(title, `${route.path} har stadig app-shellens default-titel`).not.toBe("Cycling Zone");
    expect(title, `${route.path}-titel skal nævne Cycling Zone`).toContain("Cycling Zone");

    const description = html.match(
      /<meta\s+name="description"\s+content="([^"]*)"/,
    )?.[1];
    expect(description, `${route.path} mangler meta description i server-HTML`).toBeTruthy();

    expect(/<h1[\s>]/.test(html), `${route.path} har intet <h1> i server-HTML`).toBe(true);

    const lang = html.match(/<html\s+lang="([^"]+)"/)?.[1];
    expect(lang, `${route.path} skal melde sproget ${route.lang} i <html lang>`).toBe(route.lang);

    if (route.alternates) {
      for (const [hreflang, altPath] of Object.entries(route.alternates)) {
        expect(
          html.includes(`hreflang="${hreflang}" href="${ORIGIN}${altPath}"`),
          `${route.path} mangler hreflang-alternate ${hreflang} → ${altPath}`,
        ).toBe(true);
      }
    }

    const previous = titles.get(title);
    expect(previous, `Titel "${title}" deles af ${previous} og ${route.path}`).toBeUndefined();
    titles.set(title, route.path);
  }
});

// #4067 — statisk guard, INGEN netværk: rewrites-listen i frontend/vercel.json
// (marketing/-destinationer) skal matche 1:1 med de sider marketing/app/
// faktisk eksponerer. Uden denne test kan en ny page.tsx i marketing/ blive
// tilføjet uden en tilsvarende rewrite (404 på cyclingzone.org), eller en
// rewrite overleve efter en side er fjernet dér (spøgelses-rute) — begge dele
// opdages først i produktion. Forsiden "/" er fortsat undtaget her: den routes
// IKKE via vercel.json's rewrites-array (Vercels filsystem vinder over
// rewrites for en literal "/index.html" i output — bekræftet empirisk på
// preview-deployet i #4067-opfølgeren), men via frontend/middleware.ts, som
// kører FØR filsystem-matchet og derfor kan overstyre det.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MARKETING_BASE = "https://cycling-zone-marketing.vercel.app";

// #5230 (CodeQL #362) — startsWith accepterer også fx
// "https://cycling-zone-marketing.vercel.app.evil.example", som ikke er
// MARKETING_BASE. Sammenlign origin i stedet. Relative destinationer (fx
// "/index.html") kan ikke parses som URL og skal give false, ikke kaste.
function isMarketingDestination(destination) {
  try {
    return new URL(destination).origin === new URL(MARKETING_BASE).origin;
  } catch {
    return false;
  }
}

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
      .filter((r) => isMarketingDestination(r.destination) && r.source !== "/_next/:path(.*)")
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

// #5494 — statisk guard, INGEN netværk: prerender-listen skal matche de
// sitemap-URL'er frontend'en selv ejer. En ny offentlig rute i sitemap.xml
// uden en prerender ville lande tilbage i præcis den tomme-app-shell-tilstand
// issuet rettede; en prerendret rute der IKKE er i sitemap.xml ville omvendt
// være en usynlig side vi betaler build-tid for.
test("prerender-listen matcher de frontend-ejede sitemap-URL'er 1:1 (#5494)", () => {
  const sitemap = readFileSync(join(repoRoot, "frontend", "public", "sitemap.xml"), "utf8");
  const vercelConfig = JSON.parse(readFileSync(join(repoRoot, "frontend", "vercel.json"), "utf8"));
  const marketingSources = new Set(
    vercelConfig.rewrites.filter((r) => isMarketingDestination(r.destination)).map((r) => r.source),
  );

  const sitemapPaths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => new URL(m[1]).pathname)
    .filter((p) => !marketingSources.has(p));

  const prerendered = PRERENDER_ROUTES.map((r) => r.path);
  expect(sitemapPaths.slice().sort()).toEqual(prerendered.slice().sort());
});
