#!/usr/bin/env node
// frontend/scripts/dev-preview.mjs
//
// Starter dev-serveren med preview-mocken slået til (VITE_PREVIEW_MOCK), så appen
// kan åbnes uden login og uden backend — den samme mock Vercel-preview'et og
// Playwright-fixtures bruger (src/preview/installPreviewMock.js).
//
// HVORFOR ET SCRIPT OG IKKE EN .env-FIL: `.env.*` er gitignored (rod-.gitignore
// linje 14), så en `.env.preview` ville være lokal-only — den ville virke på den
// maskine der lavede den og ingen andre. Et committet script virker overalt og
// kræver ingen ny dependency (cross-env findes ikke i projektet).
//
// Brug:
//   npm run dev:preview --prefix frontend
//   → http://localhost:5173/planning virker uden at logge ind
//
// Baggrund: "ejeren skal kunne teste på preview FØR live" har bidt tre gange
// (25/6 + 25/7), hver gang fordi den mock-drevne sti krævede en env-variabel
// ingen huskede. Den er nu ét kommando-kald.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

const child = spawn("npx", ["vite", ...args], {
  cwd: frontendDir,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, VITE_PREVIEW_MOCK: "1" },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
