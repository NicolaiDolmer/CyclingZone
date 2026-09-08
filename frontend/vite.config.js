import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatWorktreeId, WORKTREE_ID_PATH } from "./playwright.ports.js";
import { patchNotesJsonPlugin } from "./vite-plugins/patch-notes-json.js";

const enableSentryUpload = Boolean(
  process.env.SENTRY_AUTH_TOKEN &&
  process.env.SENTRY_ORG &&
  process.env.SENTRY_PROJECT
);

// Dev/preview-only endpoint der identificerer hvilken worktree serveren kører
// fra, så Playwrights globalSetup kan afvise en fremmed worktrees server på
// porten (false-green-guard, se playwright.ports.js). Rører ikke prod-builds.
const FRONTEND_ROOT = path.dirname(fileURLToPath(import.meta.url));
const worktreeIdPlugin = () => {
  const handler = (req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.end(formatWorktreeId(FRONTEND_ROOT));
  };
  let isSsrBuild = false;
  return {
    name: "cz-worktree-id",
    configResolved(config) {
      isSsrBuild = Boolean(config.build?.ssr);
    },
    configureServer(server) {
      server.middlewares.use(WORKTREE_ID_PATH, handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(WORKTREE_ID_PATH, handler);
    },
    // #2960: e2e-serveren er en ren statisk server (scripts/e2e-static-server.mjs)
    // uden middleware-hook, saa id'et emittes ogsaa som statisk fil i dist/ ved
    // build — samme ejerfil som dev/preview-middleware'en, én mekanisme.
    generateBundle() {
      if (isSsrBuild) return;
      this.emitFile({
        type: "asset",
        fileName: WORKTREE_ID_PATH.replace(/^\//, ""),
        source: formatWorktreeId(FRONTEND_ROOT),
      });
    },
  };
};

// #4595: release-sha'en må IKKE ende i en hashet asset. Den injiceres i stedet som
// <meta name="cz-release"> i index.html (og dermed også i den kopierede app.html,
// se scripts/prerender.mjs) og læses runtime af src/lib/release.js.
//
// Baggrund: Vercel auto-eksponerer `VITE_VERCEL_GIT_COMMIT_SHA` til Vite-builds.
// Da main.jsx og lib/sentry.jsx læste den, ændrede entry-chunkens indhold sig på
// HVERT deploy — også et docs-only commit — så dens Rollup-hash roterede, og med
// den hele grafen af route-chunks der importerer entry'en. Resultatet var at hver
// åben fane pegede på asset-filer der ikke længere fandtes (CYCLINGZONE-56).
// HTML'en er kort-cachet og følger deployet; assets er `immutable` og skal derfor
// være byte-identiske når koden er uændret.
//
// Bevidst UDEN `VITE_`-prefix: variablen læses her i build-processen (Node), ikke
// i klient-koden, netop for at Vite ikke kan inline den i en asset.
const releaseSha = process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || "";
const releaseMetaPlugin = () => ({
  name: "cz-release-meta",
  // Kun HTML — rører ikke en eneste hashet asset.
  transformIndexHtml() {
    return [
      {
        tag: "meta",
        attrs: { name: "cz-release", content: releaseSha },
        injectTo: "head",
      },
    ];
  },
});

// #2668: preview-værktøjets "autoPort" (.claude/launch.json) tildeler en fri port
// pr. session via PORT-env i stedet for et hardcodet --port-flag, så parallelle
// worktree-sessioner ikke kolliderer på samme dev-server-port. Vite læser ikke
// PORT automatisk — kun eksplicit her. strictPort kun når PORT er sat eksplicit
// (autoPort har allerede verificeret porten er fri); ellers uændret Vite-default
// (auto-increment ved konflikt) for almindelig manuel `npm run dev`.
const explicitPort = process.env.PORT ? Number(process.env.PORT) : undefined;

// #2423: Vercel Skew Protection. Vi bager KUN to konstanter ind — deployment-id
// og build-tidspunkt — som `src/lib/skewProtection.js` bruger til at sætte
// Vercels `__vdpl`-cookie ved boot. Asset-URL'erne røres IKKE (se #4745-
// postmortem: `experimental.renderBuiltUrl` med `?dpl=` gav dobbelt-loadede
// moduler og knækkede hele appen). Uden begge Vercel-env-variabler er buildet
// bit-for-bit uændret: id = "" og build-tid = 0 ⇒ cookie-koden er en no-op.
//
// KUN PRODUCTION. Preview-deploys må ALDRIG pinnes: ejeren tester rettelser på
// samme branch-alias, og en pinnet klient ville hænge fast på det gamle
// preview-build. Værre: previews fjernes rutinemæssigt af retention, og en
// cookie der peger på et slettet deployment giver en HÅRD 404 uden selvheling.
// Derfor kræves både Vercels toggle OG `VERCEL_ENV === "production"`.
const skewProtectionEnabled =
  process.env.VERCEL_SKEW_PROTECTION_ENABLED === "1" && process.env.VERCEL_ENV === "production";
const skewDeploymentId = skewProtectionEnabled ? process.env.VERCEL_DEPLOYMENT_ID || "" : "";
const skewBuildTime = skewDeploymentId ? Date.now() : 0;

export default defineConfig({
  define: {
    __CZ_SKEW_DEPLOYMENT_ID__: JSON.stringify(skewDeploymentId),
    __CZ_SKEW_BUILD_TIME__: JSON.stringify(skewBuildTime),
  },
  plugins: [
    react(),
    worktreeIdPlugin(),
    releaseMetaPlugin(),
    patchNotesJsonPlugin(),
    enableSentryUpload
      ? sentryVitePlugin({
          authToken: process.env.SENTRY_AUTH_TOKEN,
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          release: {
            name: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA,
            // #4595 rod-årsag 2: pluginets default (`inject: true`) skriver
            // `window.SENTRY_RELEASE={id:"<sha>"}` ind i ENTRY-chunken selv —
            // en deploy-unik streng i en hashet asset, præcis den klasse resten
            // af denne fil eksisterer for at undgå. Fordi hver route-chunk
            // importerer entry'en, roterede HELE asset-træet på hvert deploy,
            // også docs-/backend-only commits uden en eneste frontend-ændring
            // (målt: 268 af 387 commits siden 1/9). #4970 lukkede kun
            // `import.meta.env`-vejen; denne injektion sker i pluginet selv og
            // er derfor usynlig for den vagt. Releasen er stadig korrekt sat på
            // Sentry-events (source maps matcher) via `Sentry.init({ release })`
            // i src/lib/sentry.jsx, som læser `<meta name="cz-release">` — en
            // kilde der IKKE ligger i en hashet chunk.
            inject: false,
          },
          sourcemaps: {
            assets: "./dist/**",
          },
        })
      : null,
  ].filter(Boolean),
  server: {
    port: explicitPort,
    strictPort: Boolean(explicitPort),
  },
  build: {
    sourcemap: enableSentryUpload,
  },
});
