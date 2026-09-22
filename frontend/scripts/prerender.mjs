// Build-time prerender af de offentlige SPA-ruter (#perf, #5494).
//
// Pipeline (kaldt fra `npm run build`):
//   1. `vite build`                    → dist/ (client-bundle + tom index.html)
//   2. `vite build --ssr entry-server` → dist-ssr/entry-server.js (Node-render)
//   3. dette script                    → dist/index.html + dist/<rute>/index.html
//
// Hvorfor filer og IKKE rewrites: Vercel serverer en statisk fil FØR rewrites,
// så "/" rammer altid dist/index.html og "/login" altid dist/login/index.html.
// Den tomme shell gemmes som app.html, som alle ikke-prerendrede ruter
// rewrites til (frontend/vercel.json) — samme filsystem-match som sitemap.xml.
//
// Hvorfor det er nødvendigt (#5494): før dette blev 10 af 16 sitemap-URL'er
// serveret som tom app-shell til crawlere — title "Cycling Zone", canonical
// mod forsiden, 0 H1 og 0 ord. useDocumentHead retter først head'en EFTER
// JS-kørsel, og det er for sent for en ikke-renderende crawler.
//
// Hydration: KUN "/" hydreres (main.jsx gater `hydratingLanding` på
// pathname === "/"). På de øvrige ruter rydder main.jsx #root og laver en frisk
// createRoot-render, så prerendret markup dér aldrig kan give mismatch.
//
// Sprog: EN-first. De to danske juridiske ruter (/privatlivspolitik,
// /handelsbetingelser) er egne danske sider og prerendres på DA; de er
// hreflang-parret med deres engelske søskende. Header-baseret per-sprog-
// servering af de ENGELSKE ruter dur ikke: Vercels CDN cacher på URL alene
// (ignorerer Accept-Language) → første variant serveres til alle.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ORIGIN, PRERENDER_ROUTES, outputFileFor } from "./public-prerender-routes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const ssrEntry = path.join(root, "dist-ssr", "entry-server.js");
const distDir = path.join(root, "dist");
const indexPath = path.join(distDir, "index.html");
const appShellPath = path.join(distDir, "app.html");

const MIN_ROOT_HTML = 500;

if (!fs.existsSync(ssrEntry)) {
  throw new Error(`SSR-entry mangler: ${ssrEntry} — kørte 'vite build --ssr' før dette script?`);
}
if (!fs.existsSync(indexPath)) {
  throw new Error(`Client-template mangler: ${indexPath} — kørte 'vite build' før dette script?`);
}

const { render } = await import(pathToFileURL(ssrEntry).href);
const template = fs.readFileSync(indexPath, "utf-8");

if (!template.includes('<div id="root"></div>')) {
  throw new Error('Kunne ikke finde <div id="root"></div> i index.html — template-struktur ændret?');
}

/** Minimal HTML-escaping til attribut- og tekst-kontekst. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Byg regex'en der matcher HELE `<meta name|property="…" …>`-tagget.
 * Vi matcher hele tagget (ikke kun content-attributten) så en minifier der
 * ændrer attribut-rækkefølge eller dropper self-closing-skråstregen ikke
 * stille får replacementen til at falde ud.
 */
function metaTagPattern(attr, name) {
  return new RegExp(`<meta\\s+${attr}="${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`);
}

/**
 * Erstat indholdet i et `<meta name|property="…" content="…">`-tag.
 * Kaster hvis tagget ikke findes, så en template-ændring fejler buildet i
 * stedet for stille at droppe metadataen.
 */
function replaceMetaContent(html, attr, name, content) {
  const pattern = metaTagPattern(attr, name);
  if (!pattern.test(html)) {
    throw new Error(`Kunne ikke finde <meta ${attr}="${name}"> i index.html-templaten.`);
  }
  return html.replace(pattern, `<meta ${attr}="${name}" content="${escapeHtml(content)}" />`);
}

/**
 * Byg det færdige dokument for én rute: templaten med rute-specifik head
 * (title, description, canonical, hreflang, og:*, <html lang>) og det
 * prerendrede træ i #root.
 */
function buildDocument({ route, head, appHtml }) {
  const canonical = head.canonical || `${ORIGIN}${route.path}`;
  const title = head.title || "Cycling Zone";
  const description = head.description;
  const lang = head.lang || route.lang;

  let html = template;

  // <html lang> — templaten er EN-first; DA-ruterne skal melde dansk allerede
  // i server-HTML'en (LanguageProvider sætter den igen runtime).
  html = html.replace(/(<html\s+lang=")[^"]*(")/, `$1${escapeHtml(lang)}$2`);

  // <title>
  if (!/<title>[^<]*<\/title>/.test(html)) {
    throw new Error("Kunne ikke finde <title> i index.html-templaten.");
  }
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);

  if (description) {
    html = replaceMetaContent(html, "name", "description", description);
    html = replaceMetaContent(html, "property", "og:description", description);
    html = replaceMetaContent(html, "name", "twitter:description", description);
  }
  html = replaceMetaContent(html, "property", "og:title", title);
  html = replaceMetaContent(html, "name", "twitter:title", title);
  // og:url følger canonical pr. rute (#5494: den var hardkodet til
  // /founder-supporter på hver eneste side).
  html = replaceMetaContent(html, "property", "og:url", canonical);
  html = replaceMetaContent(html, "property", "og:locale", lang === "da" ? "da_DK" : "en_US");
  html = replaceMetaContent(
    html,
    "property",
    "og:locale:alternate",
    lang === "da" ? "en_US" : "da_DK",
  );

  // canonical + hreflang. Indsættes lige efter description-metaen, som findes i
  // alle varianter af templaten.
  const links = [`    <link rel="canonical" href="${escapeHtml(canonical)}" />`];
  if (route.alternates) {
    for (const [hreflang, altPath] of Object.entries(route.alternates)) {
      links.push(
        `    <link rel="alternate" hreflang="${escapeHtml(hreflang)}" href="${escapeHtml(`${ORIGIN}${altPath}`)}" />`,
      );
    }
    links.push(
      `    <link rel="alternate" hreflang="x-default" href="${escapeHtml(`${ORIGIN}${route.alternates.en}`)}" />`,
    );
  }
  const descriptionTag = html.match(metaTagPattern("name", "description"));
  if (!descriptionTag) {
    throw new Error('Kunne ikke finde <meta name="description"> til canonical-indsættelse.');
  }
  html = html.replace(descriptionTag[0], `${descriptionTag[0]}\n${links.join("\n")}`);

  return html.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`);
}

// Bevar den tomme shell FØRST (ikke-prerendrede ruter rewrites hertil).
fs.copyFileSync(indexPath, appShellPath);

const rendered = [];

for (const route of PRERENDER_ROUTES) {
  const { html: appHtml, head } = await render(route.path, route.lang);

  if (!appHtml || appHtml.length < MIN_ROOT_HTML) {
    throw new Error(
      `Prerender af ${route.path} gav kun ${appHtml ? appHtml.length : 0} tegn HTML (< ${MIN_ROOT_HTML}) — afbryder build.`,
    );
  }
  if (!/<h1[\s>]/.test(appHtml)) {
    throw new Error(
      `Prerender af ${route.path} indeholder intet <h1> — crawlere ville se en overskriftsløs side. Afbryder build.`,
    );
  }
  if (!head.title || !head.description) {
    throw new Error(
      `Prerender af ${route.path} mangler ${!head.title ? "title" : "description"} fra useDocumentHead — tilføj den på siden.`,
    );
  }
  // Forward-guard: sidens egen lang skal være den vi prerenderer på. En
  // uenighed betyder at i18n's aktive sprog i Node ikke er det vi bad om
  // (racen beskrevet i entry-server.jsx) — og ville sende <html lang="da">
  // ud på engelsk indhold.
  if (head.lang && head.lang !== route.lang) {
    throw new Error(
      `Prerender af ${route.path}: siden meldte lang="${head.lang}", men ruten prerendres på "${route.lang}".`,
    );
  }

  const outFile = outputFileFor(route.path);
  const outPath = path.join(distDir, outFile);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buildDocument({ route, head, appHtml }), "utf-8");
  rendered.push(`${outFile} (${appHtml.length})`);
}

fs.rmSync(path.join(root, "dist-ssr"), { recursive: true, force: true });

console.log(
  `✓ Prerendrede ${rendered.length} offentlige ruter · tom shell → dist/app.html\n  ${rendered.join("\n  ")}`,
);
