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
  return {
    name: "cz-worktree-id",
    configureServer(server) {
      server.middlewares.use(WORKTREE_ID_PATH, handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(WORKTREE_ID_PATH, handler);
    },
  };
};

export default defineConfig({
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
  build: {
    sourcemap: enableSentryUpload,
  },
});
