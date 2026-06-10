import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRuntimePort } from "./playwright.ports.js";

// Port pr. worktree: main-checkout = 4173 (CI uændret), linked worktrees får en
// deterministisk hash-afledt port, PW_PORT overrider. Se playwright.ports.js
// for hvorfor (false-green via delt port, bidt 2026-05-31 + 2026-06-10).
const FRONTEND_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = resolveRuntimePort(FRONTEND_ROOT);

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.js",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.001,
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    actionTimeout: 10000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 393, height: 852 },
      },
    },
    {
      name: "mobile-webkit",
      use: {
        ...devices["iPhone 13"],
      },
    },
  ],
  webServer: {
    // --strictPort: hellere højlydt bind-fejl end at vite hopper til nabo-port
    // mens baseURL stadig peger på den fremmede server.
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      VITE_API_URL: `http://127.0.0.1:${PORT}`,
      VITE_SUPABASE_URL: "https://cycling-zone-e2e.supabase.co",
      VITE_SUPABASE_ANON_KEY: "e2e-anon-key",
      VITE_PUBLIC_APP_URL: `http://127.0.0.1:${PORT}`,
    },
  },
});
