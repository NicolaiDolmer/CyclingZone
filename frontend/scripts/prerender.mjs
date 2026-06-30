// Build-time prerender af den offentlige landing-side (#perf).
//
// Pipeline (kaldt fra `npm run build`):
//   1. `vite build`                    → dist/ (client-bundle + tom index.html)
//   2. `vite build --ssr entry-server` → dist-ssr/entry-server.js (Node-render)
//   3. dette script                    → omdanner dist/index.html til den prerendrede
//                                         landing og gemmer den tomme shell som app.html
//
// Hvorfor index.html og IKKE en separat landing.html: Vercel serverer en statisk
// fil før den anvender rewrites, så "/" rammer altid dist/index.html — en rewrite
// "/" → /landing.html ville aldrig blive brugt. I stedet:
//   • dist/index.html = prerendret landing  → serveres statisk for "/"
//   • dist/app.html   = den tomme app-shell → vercel.json rewriter alle andre ruter hertil
// Så kun landing betaler for prerender, og app-ruter får ingen landing-flash.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const ssrEntry = path.join(root, "dist-ssr", "entry-server.js");
const indexPath = path.join(root, "dist", "index.html");
const appShellPath = path.join(root, "dist", "app.html");

if (!fs.existsSync(ssrEntry)) {
  throw new Error(`SSR-entry mangler: ${ssrEntry} — kørte 'vite build --ssr' før dette script?`);
}
if (!fs.existsSync(indexPath)) {
  throw new Error(`Client-template mangler: ${indexPath} — kørte 'vite build' før dette script?`);
}

const { render } = await import(pathToFileURL(ssrEntry).href);
const template = fs.readFileSync(indexPath, "utf-8");

const appHtml = await render("/");

// Sanity-gate: en tom/mistænkeligt lille render betyder prerender fejlede stille
// (fx en provider der kastede) — fail loud i build i stedet for at deploye en
// landing der er lige så tom som den oprindelige shell.
if (!appHtml || appHtml.length < 500) {
  throw new Error(`Prerender gav kun ${appHtml ? appHtml.length : 0} tegn HTML — afbryder build.`);
}
if (!template.includes('<div id="root"></div>')) {
  throw new Error('Kunne ikke finde <div id="root"></div> i index.html — template-struktur ændret?');
}

// Bevar den tomme shell først (app-ruter rewrites hertil), overskriv så index.html.
fs.copyFileSync(indexPath, appShellPath);
const html = template.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`);
fs.writeFileSync(indexPath, html, "utf-8");

// dist-ssr er kun et build-artefakt til dette script — det skal ikke deployes.
fs.rmSync(path.join(root, "dist-ssr"), { recursive: true, force: true });

console.log(
  `✓ Prerendret landing → dist/index.html · tom shell → dist/app.html (#root: ${appHtml.length} tegn)`
);
