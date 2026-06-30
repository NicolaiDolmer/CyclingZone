// Build-time prerender af den offentlige landing-side (#perf).
//
// Pipeline (kaldt fra `npm run build`):
//   1. `vite build`                    → dist/ (client-bundle + tom index.html)
//   2. `vite build --ssr entry-server` → dist-ssr/entry-server.js (Node-render)
//   3. dette script                    → prerender pr. sprog + tom app-shell
//
// Output:
//   • dist/index.en.html / dist/index.da.html = prerendret landing pr. sprog
//   • dist/app.html                            = den tomme app-shell (alle andre ruter)
//   • dist/index.html FJERNES                  = så Vercel-rewriten (Accept-Language)
//     bestemmer hvilken sprog-variant "/" serverer. Lå index.html der, ville
//     filsystemet altid vinde over rewriten, og DA-detektionen aldrig fire.
//
// Hvorfor pr. sprog: en kold besøgende har ingen localStorage endnu, så klientens
// i18n vælger sprog ud fra browseren (navigator.language) — præcis samme signal
// som Accept-Language. Ved at servere den matchende prerender males det rigtige
// sprog fra første paint, og hydration sker uden EN↔DA-tekstskift (flash).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const ssrEntry = path.join(root, "dist-ssr", "entry-server.js");
const distDir = path.join(root, "dist");
const indexPath = path.join(distDir, "index.html");

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

// Den tomme app-shell (alle ikke-landing-ruter rewrites hertil).
fs.writeFileSync(path.join(distDir, "app.html"), template, "utf-8");

const LANGS = ["en", "da"];
for (const lng of LANGS) {
  const appHtml = await render("/", lng);
  // Sanity-gate: en tom/mistænkeligt lille render = prerender fejlede stille.
  if (!appHtml || appHtml.length < 500) {
    throw new Error(`Prerender (${lng}) gav kun ${appHtml ? appHtml.length : 0} tegn HTML — afbryder build.`);
  }
  const html = template
    .replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`)
    .replace(/<html lang="[^"]*">/, `<html lang="${lng}">`);
  fs.writeFileSync(path.join(distDir, `index.${lng}.html`), html, "utf-8");
}

// Fjern den sprog-neutrale index.html, så Accept-Language-rewriten styrer "/".
fs.rmSync(indexPath, { force: true });

// dist-ssr er kun et build-artefakt til dette script — det skal ikke deployes.
fs.rmSync(path.join(root, "dist-ssr"), { recursive: true, force: true });

console.log(
  `✓ Prerendret landing: ${LANGS.map((l) => `index.${l}.html`).join(" + ")} + app.html · index.html fjernet (Accept-Language-rewrite styrer /)`
);
