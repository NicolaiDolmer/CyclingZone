// #5159 (Codex-fund H4): frontendens INDHOLDS-id — ikke Git-sha'en.
//
// Problemet: `/version.json` og `<meta name="cz-release">` bærer commit-sha'en.
// Den ændrer sig ved HVERT deploy, også et docs-, marketing- eller backend-only
// commit uden en eneste frontend-ændring. Bruger man den som "er der en ny
// version?", genindlæser en spiller der bare læser et løb, fordi jeg rettede en
// stavefejl i en markdown-fil. Auditten målte to prod-deploys hvis git-diff kun
// rørte `.github/dependabot.yml` og `marketing/`.
//
// Løsningen: et id beregnet af det der faktisk UDGØR frontendens runtime:
//
//   1. navnene på alle emitterede bundle-assets (Rollup-hashen ER indholdet, så
//      en ændret chunk giver et nyt navn — og efter #5160/#5170 er navnene
//      stabile når koden er uændret),
//   2. indholdet af `public/` (chunk-selfheal.js, fonte, sprogfiler, ikoner —
//      kopieres uhashet og ville ellers være usynlige for id'et),
//   3. HTML-skabelonen `index.html` selv (dens inline-script og tags).
//
// Bevidst UDE af id'et:
//   · `version.json` og `<meta name="cz-release">` — de bærer sha'en, som er
//     deploy-unik. Var de med, ville id'et rotere præcis som sha'en gjorde.
//   · patch-notes.json og patch-notes-meta.json's INDHOLD — de emitteres med
//     faste navne og hentes on-demand af PatchNotesPage. Nye patch notes kræver
//     ikke at nogen genindlæser noget.
//   · worktree-id-filens indhold (dev/e2e-hjælper, ikke spiller-vendt runtime).
//   · filer i dist/assets som scripts/carry-forward-assets.mjs bærer videre fra
//     ÆLDRE releases (#5162). Id'et regnes af Rollups egen bundle og af kilderne
//     på disken, aldrig af dist-mappen, så det kan ikke rotere med
//     retention-listen. Testen "båret-videre filer" i frontend-content-id.test.js
//     holder det fast.
//
// Sha'en forsvinder ikke: den står stadig i version.json og i meta-tagget, så et
// forløb kan spores i Sentry og i telemetrien. Den er bare ikke længere det der
// afgør, om en spiller får revet siden væk under sig.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const FRONTEND_META_NAME = "cz-frontend";
export const VERSION_FILE_NAME = "version.json";

// Navne der emitteres med FAST filnavn og hvis indhold ikke hører til runtime-
// identiteten. Navnet er konstant, så de bidrager alligevel ingenting — men de
// står her, så beslutningen er skrevet ned ét sted.
const IGNORED_BUNDLE_FILES = new Set([
  VERSION_FILE_NAME,
  "patch-notes.json",
  "patch-notes-meta.json",
]);

function listFilesRecursive(dir) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  // Sorteret navigering: samme rækkefølge på alle filsystemer.
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function hashFile(file) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return "unreadable";
  }
}

/**
 * Ren beregning — testbar uden et Vite-build.
 *
 * @param {object} input
 * @param {string[]} input.assetNames emitterede bundle-filnavne
 * @param {Array<[string, string]>} [input.files] par af (relativ sti, indholds-hash)
 * @returns {string} 16 hex-tegn. Nok til at to forskellige frontends ikke
 *   kolliderer i praksis, og kort nok til at stå i et meta-tag.
 */
export function computeFrontendContentId({ assetNames = [], files = [] } = {}) {
  const hash = crypto.createHash("sha256");
  // Laengde-praefiks frem for et skille-TEGN: feltet kan aflaeses entydigt uanset
  // hvad navnet indeholder, saa "ab"+"c" aldrig kan hashe som "a"+"bc". Tidligere
  // stod her en NUL-byte som skilletegn; den var lige saa entydig, men gjorde
  // filen binaer i Gits oejne, saa diffen ikke kunne reviewes.
  const field = (value) => {
    hash.update(String(value.length));
    hash.update(":");
    hash.update(value);
  };
  // Sorteret, saa to forskellige lister ikke kan hashe ens.
  for (const name of [...assetNames].filter((n) => !IGNORED_BUNDLE_FILES.has(n)).sort()) {
    hash.update("a");
    field(name);
  }
  for (const [name, digest] of [...files].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    hash.update("f");
    field(name);
    field(digest);
  }
  return hash.digest("hex").slice(0, 16);
}

/**
 * Vite-plugin: injicér `<meta name="cz-frontend">` i HTML'en og emittér
 * `dist/version.json` med både indholds-id og sha.
 *
 * Filen ligger bevidst i dist-roden og IKKE under /assets/, så `immutable`-
 * headeren i frontend/vercel.json ikke rammer den (det var netop den header der
 * gjorde en 404 permanent i #4595). Hentes altid med `cache: "no-store"`.
 *
 * SSR-buildet springes over: dist-ssr er ikke en server-rod.
 *
 * @param {{releaseSha?: string}} [opts]
 */
export function frontendContentIdPlugin({ releaseSha = "" } = {}) {
  let isSsrBuild = false;
  let publicDir = "";
  let htmlTemplate = "";
  /** @type {string|null} */
  let cachedId = null;

  // Kilderne uden for bundlen læses fra DISKEN ved build-tid, ikke fra dist.
  // De er derfor deterministiske: samme commit ⇒ samme bytes ⇒ samme id.
  function staticFileHashes() {
    /** @type {Array<[string, string]>} */
    const files = [];
    if (publicDir) {
      for (const file of listFilesRecursive(publicDir)) {
        files.push([`public/${path.relative(publicDir, file).split(path.sep).join("/")}`, hashFile(file)]);
      }
    }
    if (htmlTemplate) files.push(["index.html", hashFile(htmlTemplate)]);
    return files;
  }

  function ensureId(bundle) {
    if (cachedId) return cachedId;
    cachedId = computeFrontendContentId({
      assetNames: Object.keys(bundle ?? {}),
      files: staticFileHashes(),
    });
    return cachedId;
  }

  return {
    name: "cz-frontend-content-id",
    // Efter alle andre plugins, så bundlen er komplet når vi hasher den.
    enforce: "post",

    configResolved(config) {
      isSsrBuild = Boolean(config.build?.ssr);
      publicDir = config.publicDir || "";
      // `config.root` er altid sat af Vite (default: cwd), så vi behøver ikke
      // røre `process` her — eslint-konfigurationen for frontend/ har ikke
      // Node-globals, og pluginet skal kunne lintes med samme regler som resten.
      htmlTemplate = config.root ? path.resolve(config.root, "index.html") : "";
    },

    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (isSsrBuild) return undefined;
        // I build får handleren hele bundlen med i konteksten — på det tidspunkt
        // er alle chunk-navne endelige. I dev findes den ikke, og id'et bliver
        // dermed kun beregnet af public/ + skabelonen; mekanikken er alligevel
        // slået fra i dev (release.js svarer "dev").
        return [
          {
            tag: "meta",
            attrs: { name: FRONTEND_META_NAME, content: ensureId(ctx?.bundle) },
            injectTo: "head",
          },
        ];
      },
    },

    generateBundle(_options, bundle) {
      if (isSsrBuild) return;
      this.emitFile({
        type: "asset",
        fileName: VERSION_FILE_NAME,
        source: `${JSON.stringify({ release: releaseSha, frontend: ensureId(bundle) })}\n`,
      });
    },
  };
}

export default frontendContentIdPlugin;
