// Per-worktree Playwright-port + server-identity-guard.
//
// Problem (bidt 2026-05-31 og igen 2026-06-10): alle worktrees delte hardcodet
// port 4173, og webServer.reuseExistingServer genbrugte stille en ANDEN worktrees
// dev-server → grøn suite mod forkert kodebase (false-green).
//
// Strategi:
//   1. PW_PORT env-var overrider alt (eksplicit kontrol).
//   2. Main-checkout (".git" er en mappe) beholder 4173 — CI og snapshots uændret.
//   3. Linked worktrees (".git" er en fil) får en deterministisk port afledt af
//      worktree-stien i [WORKTREE_PORT_MIN, WORKTREE_PORT_MAX] — parallelle
//      worktrees kolliderer ikke uden manuel handling.
//   4. /__worktree-id-endpointet (vite.config.js) + checkWorktreeIdentity
//      (tests/e2e/global-setup.js) fejler højlydt hvis serveren på porten
//      serverer en anden rod end testens egen worktree.
//
// Normalisering er win32-orienteret (case-insensitiv, \ og / ens) — CI (linux)
// kører altid main-checkout-grenen og rammer aldrig hash-derivationen.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MAIN_PORT = 4173;
export const WORKTREE_PORT_MIN = 4300;
export const WORKTREE_PORT_MAX = 4999;
export const WORKTREE_ID_PATH = "/__worktree-id";

const WORKTREE_ID_PREFIX = "cz-worktree-root:";

function normalizeRoot(root) {
  return String(root).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function derivePort({ envPort, repoRoot, isLinkedWorktree }) {
  if (envPort !== undefined && envPort !== null && envPort !== "") {
    const port = Number(envPort);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error(
        `PW_PORT="${envPort}" er ikke en gyldig port — forventer et heltal i 1024-65535.`,
      );
    }
    return port;
  }
  if (!isLinkedWorktree) {
    return MAIN_PORT;
  }
  const span = WORKTREE_PORT_MAX - WORKTREE_PORT_MIN + 1;
  const digest = crypto.createHash("sha256").update(normalizeRoot(repoRoot)).digest();
  return WORKTREE_PORT_MIN + (digest.readUInt32BE(0) % span);
}

// Tynd I/O-wrapper om derivePort: detekterer linked worktree via ".git"-fil
// (main-checkout har en .git-MAPPE). Antager repo-rod = parent af frontend/,
// hvilket gælder for både main-checkout og alle worktrees i dette repo.
export function resolveRuntimePort(frontendRoot, env = process.env) {
  const repoRoot = path.dirname(frontendRoot);
  const gitPath = path.join(repoRoot, ".git");
  const isLinkedWorktree = fs.existsSync(gitPath) && fs.statSync(gitPath).isFile();
  return derivePort({ envPort: env.PW_PORT, repoRoot, isLinkedWorktree });
}

export function formatWorktreeId(frontendRoot) {
  return WORKTREE_ID_PREFIX + normalizeRoot(frontendRoot);
}

export function checkWorktreeIdentity(body, expectedRoot) {
  if (typeof body !== "string" || !body.startsWith(WORKTREE_ID_PREFIX)) {
    return { ok: false, reason: "foreign-server" };
  }
  const serverRoot = body.slice(WORKTREE_ID_PREFIX.length).trim();
  if (serverRoot === normalizeRoot(expectedRoot)) {
    return { ok: true };
  }
  return { ok: false, reason: "wrong-worktree", serverRoot };
}
