// #2960: sirv (statisk static-file-server, se playwright.config.js's webServer)
// har ingen middleware-hook som vite's `configurePreviewServer`, så
// worktreeIdPlugin i vite.config.js (der servede WORKTREE_ID_PATH dynamisk)
// virker ikke længere efter skiftet væk fra `vite preview`. False-green-guarden
// i tests/e2e/global-setup.js kræver stadig et svar på den sti — uden det
// tolker den sirv selv som "en ukendt/stale server uden worktree-id" og fejler
// højlydt (se .claude/learnings/2026-09-01-vite-preview-ci-smoke-random-stalls.md).
//
// Løsning: bag WORKTREE_ID_PATH ind som en almindelig statisk fil i dist/ FØR
// sirv starter (kaldes fra "preview:e2e"-scriptet i package.json). Filen er
// worktree-specifik og skal ALDRIG committes — den regenereres ved hvert
// preview-boot, ligesom selve dist/-mappen.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatWorktreeId, WORKTREE_ID_PATH } from "../playwright.ports.js";

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = path.join(FRONTEND_ROOT, "dist", WORKTREE_ID_PATH.replace(/^\//, ""));

fs.writeFileSync(outPath, formatWorktreeId(FRONTEND_ROOT), "utf8");
