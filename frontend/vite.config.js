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

// #2423 P1 — Vercel Skew Protection for en ren Vite-SPA (ikke Next/SvelteKit/Nuxt,
// som har indbygget support). Vercel sætter selv VERCEL_SKEW_PROTECTION_ENABLED='1'
// + VERCEL_DEPLOYMENT_ID på build-containeren når "Skew Protection" er slået til i
// projekt-settings (Advanced) — se https://vercel.com/docs/skew-protection. Uden
// begge env-variabler er dette no-op og buildet 100 % uændret (samme URL'er som i
// dag). Med dem sat lader vi hver bygget asset-URL (inkl. dynamiske chunks, jf.
// Vites egen håndtering af `experimental.renderBuiltUrl` for chunk-preload-kode)
// bære `?dpl=<deployment-id>`, så Vercels edge pinner requesten til netop den
// deployment — det lukker chunk-skew-racet fra #4595/#4545/#2423 (gammel index.html
// rammer en chunk der er roteret væk på en anden edge-node).
const skewProtectionEnabled =
  process.env.VERCEL_SKEW_PROTECTION_ENABLED === "1" &&
  Boolean(process.env.VERCEL_DEPLOYMENT_ID);

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

// #2668: preview-værktøjets "autoPort" (.claude/launch.json) tildeler en fri port
// pr. session via PORT-env i stedet for et hardcodet --port-flag, så parallelle
// worktree-sessioner ikke kolliderer på samme dev-server-port. Vite læser ikke
// PORT automatisk — kun eksplicit her. strictPort kun når PORT er sat eksplicit
// (autoPort har allerede verificeret porten er fri); ellers uændret Vite-default
// (auto-increment ved konflikt) for almindelig manuel `npm run dev`.
const explicitPort = process.env.PORT ? Number(process.env.PORT) : undefined;

export default defineConfig({
  experimental: skewProtectionEnabled
    ? {
        renderBuiltUrl(filename) {
          // filename er relativ til build-root (fx "assets/index-abc123.js").
          // Vite bruger samme hook til entry-HTML'ens <script>/<link> og til
          // chunk-preload-koden bag dynamic import() — begge veje ender her.
          return `/${filename}?dpl=${process.env.VERCEL_DEPLOYMENT_ID}`;
        },
      }
    : {},
  plugins: [
    react(),
    worktreeIdPlugin(),
    patchNotesJsonPlugin(),
    enableSentryUpload
      ? sentryVitePlugin({
          authToken: process.env.SENTRY_AUTH_TOKEN,
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          release: {
            name: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA,
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
