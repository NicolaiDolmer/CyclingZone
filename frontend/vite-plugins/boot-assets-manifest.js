// Vite-plugin: build-genereret boot-asset-manifest til boot-vagten (#5161).
//
// ── Problemet pluginet findes for ───────────────────────────────────────────
//
// `public/chunk-selfheal.js` er en CLASSIC script i <head> der skal kunne
// genkende en cachet 404 paa entry-bundlen (#4595). Den byggede sin liste over
// "boot-assets" med `document.querySelectorAll(...)` i samme oejeblik den blev
// installeret — men paa det tidspunkt staar HTML-parseren stadig midt i <head>
// og har IKKE indsat entry-scriptet eller Vites modulepreloads endnu.
//
// Maalt i rigtige browsere (Codex-audit 11/9, fund H2, bevis E5):
//
//   install() -> { count: 0, readyState: "loading" }   // listen var tom
//   efter boot -> 28 modul-/preload-tags                // de kom senere
//
// Listen blev aldrig genopbygget, saa fejlhandleren afviste ENHVER fejlet
// ressource som "uden for boot-scope". Ved en entry-404 fik spilleren derfor
// hverken selvheling eller fallback — kun en tom `#root`.
//
// ── Loesningen ─────────────────────────────────────────────────────────────
//
// Buildet kender listen praecist. Pluginet kører som et `order: "post"`
// transformIndexHtml-hook, dvs. EFTER Vite har injiceret entry-scriptet,
// modulepreloads og stylesheets i HTML'en, laeser de faerdige tags og skriver
// dem som en JSON-datablok ind i dokumentet LIGE FOER guard-scriptet:
//
//   <script type="application/json" id="cz-boot-assets">["/assets/…"]</script>
//   <script src="/chunk-selfheal.js"></script>
//
// Rækkefølgen er hele pointen: blokken er parset naar guarden koerer, saa
// listen er komplet foer den foerste ressource-fejl kan fyre.
//
// Hvorfor `type="application/json"` og ikke inline JS: en JSON-datablok
// eksekveres ikke, saa den rammer ikke CSP'ens `script-src` (vercel.json kører
// report-only i dag, men en fremtidig enforcing-CSP skal ikke kunne slukke
// boot-vagtens liste). Guarden laeser den med `getElementById` + `JSON.parse`.
//
// Udvalget af tags er spejlet 1:1 af guardens egen CSS-selector, saa de to
// aldrig kan drive fra hinanden:
//   script[type="module"][src]
//   link[rel="modulepreload"][href]
//   link[rel="stylesheet"][href^="/assets/"]
//
// Fejler noget af dette, fejler BUILDET (ikke runtime): et dokument uden liste
// er et dokument uden boot-vagt, og det skal ikke kunne deployes i stilhed.
//
// Refs #5161 #5162 #4595

export const BOOT_ASSETS_ELEMENT_ID = "cz-boot-assets";

// Guard-scriptet listen skal ligge foran. Samme streng som i index.html.
const GUARD_TAG_PATTERN = /<script\b[^>]*\bsrc=["']\/chunk-selfheal\.js["'][^>]*><\/script>/i;

// Vites dev-klient er ikke et boot-asset (den findes ikke i et build) — den maa
// ikke kunne udloese boot-vagten under `npm run dev`.
const DEV_ONLY_PREFIXES = ["/@vite/", "/@react-refresh", "/@id/"];

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}=("([^"]*)"|'([^']*)')`, "i"));
  if (!match) return null;
  return match[2] !== undefined ? match[2] : match[3];
}

/**
 * Find de URL'er guardens selector ville have fundet, men ud af den FAERDIGE
 * HTML-streng i stedet for en halvparset DOM.
 *
 * @param {string} html faerdig index.html (efter Vites asset-injektion)
 * @param {string} assetsPrefix sti-praefiks for hashede assets, fx "/assets/"
 * @returns {string[]} boot-URL'er i dokument-raekkefoelge, deduplikeret
 */
export function collectBootAssets(html, assetsPrefix = "/assets/") {
  const urls = [];
  const add = (url) => {
    if (!url) return;
    if (DEV_ONLY_PREFIXES.some((prefix) => url.startsWith(prefix))) return;
    if (!urls.includes(url)) urls.push(url);
  };

  const tags = html.match(/<(?:script|link)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const isScript = /^<script\b/i.test(tag);
    if (isScript) {
      if ((attr(tag, "type") || "").toLowerCase() === "module") add(attr(tag, "src"));
      continue;
    }
    const rel = (attr(tag, "rel") || "").toLowerCase();
    const href = attr(tag, "href");
    if (rel === "modulepreload") add(href);
    else if (rel === "stylesheet" && href && href.startsWith(assetsPrefix)) add(href);
  }
  return urls;
}

/**
 * Saet JSON-datablokken ind umiddelbart FOER guard-scriptet.
 *
 * @param {string} html
 * @param {string[]} urls
 * @returns {string}
 */
export function injectBootAssets(html, urls) {
  const match = html.match(GUARD_TAG_PATTERN);
  if (!match) {
    throw new Error(
      "cz-boot-assets-manifest: fandt ikke <script src=\"/chunk-selfheal.js\"> i index.html. " +
        "Boot-listen skal injiceres FOER guarden, ellers er den tom naar guarden installeres (#5161).",
    );
  }
  // `</` i en JSON-streng ville kunne lukke <script>-elementet for tidligt.
  const json = JSON.stringify(urls).replace(/</g, "\\u003c");
  const block =
    `<script type="application/json" id="${BOOT_ASSETS_ELEMENT_ID}">${json}</script>\n    `;
  return html.replace(match[0], block + match[0]);
}

export function bootAssetsManifestPlugin() {
  let isBuild = false;
  let assetsPrefix = "/assets/";

  return {
    name: "cz-boot-assets-manifest",

    configResolved(config) {
      isBuild = config.command === "build";
      const base = config.base || "/";
      assetsPrefix = `${base.endsWith("/") ? base : `${base}/`}${config.build?.assetsDir || "assets"}/`;
    },

    transformIndexHtml: {
      // `post` = efter Vites egen injektion af entry-script, modulepreloads og
      // stylesheets. Et `pre`-hook ville se den samme halvtomme HTML som den
      // runtime-snapshot pluginet erstatter.
      order: "post",
      handler(html) {
        const urls = collectBootAssets(html, assetsPrefix);
        if (isBuild && urls.length === 0) {
          throw new Error(
            "cz-boot-assets-manifest: ingen boot-assets fundet i det byggede index.html. " +
              "Uden liste er boot-vagten slukket (#5161) — afbryder buildet frem for at deploye et dokument uden selvheling.",
          );
        }
        return injectBootAssets(html, urls);
      },
    },
  };
}

export default bootAssetsManifestPlugin;
