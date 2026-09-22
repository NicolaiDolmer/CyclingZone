import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./e2e-base.js";

// #5495 — SEO forward-guard: den offentlige landing ("/") skal have et
// indgående link til hver public EN-side i sitemap.xml, ellers forbliver den
// orphan for crawlere. Testen henter den RÅ, prerenderede HTML for "/"
// (ingen page.goto/DOM — det ville teste post-hydration-DOM, ikke det en
// crawler faktisk ser i dist/index.html, jf. prerender.mjs), og kræver at
// hver EN sitemap-sti findes som en href et sted på siden (footer + header).
//
// "/" selv er bevidst udeladt: issuet handler om at give ANDRE sider et
// indgående link, ikke om at "/" skal linke til sig selv.

const frontendRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SITEMAP_PATH = join(frontendRoot, "public", "sitemap.xml");

// To DA-ruter ligger IKKE under /da/-prefixet (privacy/terms har egne
// top-level DA-stier, jf. App.jsx's /privatlivspolitik + /handelsbetingelser
// routes) — de skal udelukkes eksplicit, "starts with /da" fanger dem ikke.
const DA_TOP_LEVEL_PATHS = new Set(["/privatlivspolitik", "/handelsbetingelser"]);

function enSitemapPaths() {
  const xml = readFileSync(SITEMAP_PATH, "utf8");
  const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  // EN-ruter = ikke under /da, ikke en DA top-level-sti, og ikke forsiden
  // selv (se kommentar ovenfor).
  return locs.filter((path) => !path.startsWith("/da") && !DA_TOP_LEVEL_PATHS.has(path) && path !== "/");
}

test("prerendered '/' has a footer/header href to every public EN sitemap route", async ({
  request,
  baseURL,
}) => {
  const response = await request.get(`${baseURL}/`);
  expect(response.ok(), `GET / svarede ${response.status()}`).toBe(true);
  const html = await response.text();

  const missing = enSitemapPaths().filter((path) => !html.includes(`href="${path}"`));

  expect(
    missing,
    `Rå HTML for "/" mangler href til:\n${missing.join("\n") || "(ingen)"}\n` +
      `sitemap.xml: ${SITEMAP_PATH}`,
  ).toEqual([]);
});
