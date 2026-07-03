// Vite-plugin: emitér patch-notes-prosaen som en STATISK JSON i stedet for at
// bundte den ind i JS (#2108/#2060). SSOT er fortsat src/data/patchNotes.js —
// dette plugin læser PATCHES derfra ved build-tid og skriver dist/patch-notes.json,
// som PatchNotesPage henter on-demand via src/lib/patchNotes.js-loaderen.
//
// Hvorfor: hele changelog-prosaen (~945 KB rå / ~215 KB gzipped) lå i den route-
// lazy PatchNotesPage-chunk og fyldte bundle-budgettet. Statisk JSON serveres af
// CDN'en uden JS-parse-omkostning og tæller ikke i dist/assets/*.js-budgettet.
//
// - build: emitFile → dist/patch-notes.json (Vercel serverer den fra roden).
// - dev + preview: middleware serverer /patch-notes.json så npm run dev og den
//   e2e-preview-server (playwright kører mod vite preview) begge kan fetche den.
//
// SSOT-disciplin: JSON'en genereres altid fra PATCHES — der committes ALDRIG en
// håndredigeret patch-notes.json. CI-gaten scripts/check-patch-notes-version.js
// læser stadig src/data/patchNotes.js direkte, så version-bump-gaten er uændret.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(PLUGIN_DIR, "..", "src", "data", "patchNotes.js");
export const PATCH_NOTES_ASSET = "patch-notes.json";
const PATCH_NOTES_ROUTE = `/${PATCH_NOTES_ASSET}`;

async function loadPatches() {
  // Cache-bust import'en så en edit i data-filen afspejles ved re-build (dev-watch
  // rammer ikke dette plugin, men build/preview kører i friske processer).
  const url = `${pathToFileURL(DATA_FILE).href}?t=${Date.now()}`;
  const mod = await import(url);
  if (!Array.isArray(mod.PATCHES)) {
    throw new Error(
      `patch-notes-json: PATCHES er ikke en array i ${DATA_FILE} — kan ikke emitte JSON.`
    );
  }
  return mod.PATCHES;
}

function serializePatches(patches) {
  // Kompakt JSON (ingen pretty-print) — den skal fetches, ikke læses af mennesker;
  // SSOT'en er den formaterede .js-fil.
  return JSON.stringify(patches);
}

export function patchNotesJsonPlugin() {
  let isSsrBuild = false;

  return {
    name: "cz-patch-notes-json",

    configResolved(config) {
      // `vite build --ssr src/entry-server.jsx` sætter build.ssr → den emitter
      // ingen client-assets og slettes af prerender.mjs, så vi springer den over
      // og undgår en overflødig dist-ssr/patch-notes.json.
      isSsrBuild = Boolean(config.build && config.build.ssr);
    },

    // Build (client-bundle): skriv JSON'en til dist-roden.
    async generateBundle() {
      if (isSsrBuild) return;
      const patches = await loadPatches();
      this.emitFile({
        type: "asset",
        fileName: PATCH_NOTES_ASSET,
        source: serializePatches(patches),
      });
    },

    // dev-server (npm run dev): server JSON'en fra hukommelsen.
    configureServer(server) {
      server.middlewares.use(PATCH_NOTES_ROUTE, async (req, res, next) => {
        try {
          const patches = await loadPatches();
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(serializePatches(patches));
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default patchNotesJsonPlugin;
