// False-green-guard: kører før suiten og fejler højlydt hvis der allerede
// lytter en server på testporten som IKKE serverer denne worktrees kode.
// Uden denne guard genbruger webServer.reuseExistingServer stille en anden
// worktrees dev-server, og hele suiten validerer en fremmed kodebase
// (bidt 2026-05-31 + 2026-06-10 — se .claude/learnings/).
//
// Rækkefølge-uafhængig: lytter ingen på porten endnu, starter Playwright
// bagefter sin egen server fra DENNE worktree (ok). Lytter vores egen server
// allerede (re-run i samme worktree), matcher identiteten (ok).

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveRuntimePort,
  checkWorktreeIdentity,
  WORKTREE_ID_PATH,
} from "../../playwright.ports.js";

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export default async function assertNoForeignServerOnPort() {
  const port = resolveRuntimePort(FRONTEND_ROOT);
  const url = `http://127.0.0.1:${port}${WORKTREE_ID_PATH}`;

  let body;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    body = await res.text();
  } catch {
    return; // intet lytter på porten — Playwright starter sin egen server herfra
  }

  const verdict = checkWorktreeIdentity(body, FRONTEND_ROOT);
  if (verdict.ok) {
    return;
  }

  const who =
    verdict.reason === "wrong-worktree"
      ? `en ANDEN worktree: ${verdict.serverRoot}`
      : "en ukendt/stale server uden worktree-id (fx vite fra før dette fix)";
  throw new Error(
    [
      `FALSE-GREEN-GUARD: port ${port} holdes af ${who}.`,
      `Denne suite ville ellers stille have testet en fremmed kodebase i stedet for ${FRONTEND_ROOT}.`,
      `Fix: dræb processen på porten (netstat -ano | findstr :${port} → Stop-Process -Id <PID> -Force)`,
      `eller kør med en eksplicit fri port: $env:PW_PORT=<port>; npx playwright test`,
    ].join("\n"),
  );
}
