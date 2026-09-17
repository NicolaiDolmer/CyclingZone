// Vite-plugin: modulepreload af det ikke-engelske sprogs message-chunk (#5177).
//
// ── Problemet ──────────────────────────────────────────────────────────────
//
// #5177 flyttede dansk ud af entry-grafen og ind i en lazy chunk
// (`src/i18n/messages.da.js`, gruppe `i18n-messages-da` i vite.config.js). Det
// halverer den kritiske JS for en engelsk besoegende — men en dansk besoegende
// ville ellers betale en EKSTRA rundtur: chunken kan foerst begynde at hente
// naar entry-koden koerer, og main.jsx monterer foerst paa `initialized`.
//
// ── Loesningen ─────────────────────────────────────────────────────────────
//
// Buildet kender chunkens hashede filnavn. Vi skriver det som en JSON-datablok
// og lader et lille inline-script i <head> injicere en <link rel="modulepreload">
// NAAR — og kun naar — det detekterede sprog rent faktisk er det sprog. Saa
// starter hentningen i preload-scanneren, parallelt med entry'en, praecis som da
// begge sprog laa i den statiske chunk.
//
// Sprog-detektionen spejler i18nexts konfiguration i src/i18n/index.js:
//   detection.order = ["localStorage", "navigator", "htmlTag"]
//   lookupLocalStorage = "cz_lang", load = "languageOnly", fallback = "en"
// Rammer den ved siden af (fx en exotisk navigator-vaerdi), er konsekvensen et
// ubrugt preload-hint eller en manglende optimering — ALDRIG forkert sprog:
// i18next henter stadig selv chunken gennem LocaleBundleBackend. Hintet maa
// derfor gerne vaere et hint.
//
// JSON-datablok frem for inline JS med indbagt filnavn: samme begrundelse som
// #5161's boot-asset-manifest — en datablok rammer ikke CSP'ens script-src, og
// selve scriptet er statisk (uden deploy-unikt indhold) og kan derfor staa
// ordret i index.html.
//
// Refs #5177

export const I18N_LANG_ASSETS_ELEMENT_ID = "cz-i18n-lang-assets";

// Ankeret blokken skal staa foran. Samme streng som i index.html.
const ANCHOR_PATTERN = /<script\b[^>]*\bsrc=["']\/chunk-selfheal\.js["'][^>]*><\/script>/i;

// Gruppenavne fra vite.config.js' codeSplitting. Kun sprog der HAR en lazy
// chunk hoerer til her; engelsk ligger inline i `resources` og har ingen.
const LAZY_LANG_CHUNK_PREFIX = "i18n-messages-";

/**
 * Find `{ da: "/assets/i18n-messages-da-<hash>.js" }` ud af Rollup-bundlen.
 *
 * @param {Record<string, {type: string, name?: string, fileName: string}>} bundle
 * @param {string} assetsBase base-praefiks, fx "/"
 * @returns {Record<string, string>}
 */
export function collectLangChunks(bundle, assetsBase = "/") {
  const out = {};
  for (const chunk of Object.values(bundle || {})) {
    if (chunk.type !== "chunk") continue;
    const name = chunk.name || "";
    if (!name.startsWith(LAZY_LANG_CHUNK_PREFIX)) continue;
    const lng = name.slice(LAZY_LANG_CHUNK_PREFIX.length);
    // `i18n-messages-en` er den STATISKE engelske chunk — den er allerede
    // modulepreloadet af Vite selv og skal ikke hintes igen.
    if (!lng || lng === "en") continue;
    out[lng] = `${assetsBase}${chunk.fileName}`;
  }
  return out;
}

/**
 * @param {string} html
 * @param {Record<string, string>} langChunks
 * @returns {string}
 */
export function injectLangPreload(html, langChunks) {
  if (!langChunks || Object.keys(langChunks).length === 0) return html;
  const match = html.match(ANCHOR_PATTERN);
  if (!match) {
    throw new Error(
      "cz-i18n-lang-preload: fandt ikke <script src=\"/chunk-selfheal.js\"> i index.html. " +
        "Ankeret er flyttet — opdatér ANCHOR_PATTERN (#5177)."
    );
  }
  const json = JSON.stringify(langChunks).replace(/</g, "\\u003c");
  const block =
    `<script type="application/json" id="${I18N_LANG_ASSETS_ELEMENT_ID}">${json}</script>\n` +
    `    <script>\n` +
    `      (function () {\n` +
    `        try {\n` +
    `          var el = document.getElementById("${I18N_LANG_ASSETS_ELEMENT_ID}");\n` +
    `          if (!el) return;\n` +
    `          var map = JSON.parse(el.textContent);\n` +
    `          var raw = null;\n` +
    `          try { raw = localStorage.getItem("cz_lang"); } catch (e) {}\n` +
    `          if (!raw) raw = (navigator.languages && navigator.languages[0]) || navigator.language;\n` +
    `          if (!raw) raw = document.documentElement.lang;\n` +
    `          var lng = String(raw || "").toLowerCase().split("-")[0];\n` +
    `          var href = map[lng];\n` +
    `          if (!href) return;\n` +
    `          var link = document.createElement("link");\n` +
    `          link.rel = "modulepreload";\n` +
    `          link.crossOrigin = "";\n` +
    `          link.href = href;\n` +
    `          document.head.appendChild(link);\n` +
    `        } catch (e) {}\n` +
    `      })();\n` +
    `    </script>\n    `;
  return html.replace(match[0], block + match[0]);
}

export function i18nLangPreloadPlugin() {
  let assetsBase = "/";

  return {
    name: "cz-i18n-lang-preload",

    configResolved(config) {
      const base = config.base || "/";
      assetsBase = base.endsWith("/") ? base : `${base}/`;
    },

    transformIndexHtml: {
      // `post` — vi skal se den faerdige bundle, og blokken skal ligge FOER
      // boot-vagten ligesom #5161's manifest (samme anker, begge indsaettes
      // umiddelbart foer guard-tagget; raekkefoelgen dem imellem er ligegyldig,
      // de laeser hver sin datablok).
      order: "post",
      handler(html, ctx) {
        if (!ctx || !ctx.bundle) return html; // dev-server: ingen bundle, intet hint
        return injectLangPreload(html, collectLangChunks(ctx.bundle, assetsBase));
      },
    },
  };
}

export default i18nLangPreloadPlugin;
