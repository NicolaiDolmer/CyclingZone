#!/usr/bin/env node
// Skriver ejerens go som markør på et issue (#7336, ejer 23/11: "Behold
// vagten, fjern bremsen"). Bruges af PC1 lige efter ejerens ordrette ja i
// AskUserQuestion, i stedet for en ekstra PR til scripts/build-stop.json.
//
//   node scripts/build-stop-go.mjs --issue N --area <område> --quote '<ejerens ordrette ja>' [--dry-run] [--repo owner/name]
//
// Kommentaren får ejerens citat og markøren
//   <!-- build-stop: ejer-go area=<område> -->
// som PR-CI (scripts/check-build-stop-pr.mjs) og bølge-/Codex-admission
// (scripts/lib/build-stop.mjs) læser. Kun kommentarer fra repo-ejerens konto
// tæller. Efter skrivningen læses markøren tilbage gennem samme parser som
// håndhævelsen bruger; findes den ikke (fx anden gh-konto), er exit 1.
//
// Exit: 0 = skrevet og læst tilbage (eller --dry-run), 1 = gh-fejl eller
// markøren tæller ikke, 2 = forkert brug.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { OWNER_GO_MARKER_RE, findOwnerGo, ghOwnerGo } from './lib/build-stop.mjs';

export const DEFAULT_REPO = 'NicolaiDolmer/CyclingZone';
const AREA_RE = /^[\p{L}\p{N}._-]{1,40}$/u;

export function parseArgs(argv) {
  const out = { dryRun: false, repo: DEFAULT_REPO };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') { out.dryRun = true; continue; }
    if (!['--issue', '--area', '--quote', '--repo'].includes(a)) throw Error(`ukendt argument: ${a}`);
    const v = argv[++i];
    if (v === undefined) throw Error(`${a} mangler en værdi`);
    out[a.slice(2)] = v;
  }
  return out;
}

// -> { issue, area, quote } eller kaster med en forklaring.
export function validateGo({ issue, area, quote }) {
  const n = Number(issue);
  if (!Number.isSafeInteger(n) || n <= 0) throw Error('--issue skal være et issue-nummer');
  const a = String(area ?? '').trim();
  if (!AREA_RE.test(a)) throw Error('--area skal være 1-40 tegn: bogstaver, tal, punktum, bindestreg eller understreg');
  const q = String(quote ?? '').replace(/\s+/g, ' ').trim();
  if (!q) throw Error('--quote skal være ejerens ordrette ja');
  if (/["“”„]/.test(q)) throw Error("--quote må ikke indeholde dobbelte anførselstegn (brug ')");
  if (/<!--|-->/.test(q)) throw Error('--quote må ikke indeholde HTML-kommentarer');
  return { issue: n, area: a, quote: q };
}

export function buildComment({ area, quote }) {
  return `**Ejer-go (byggestop):** "${quote}"\n\nIssuet tæller som på listen i byggestoppet (område: ${area}).\n\n<!-- build-stop: ejer-go area=${area} -->`;
}

export function run(argv, { exec = execFileSync, readBack = ghOwnerGo, log = console.log } = {}) {
  let go, repo, dryRun;
  try {
    const args = parseArgs(argv);
    ({ repo, dryRun } = args);
    go = validateGo(args);
  } catch (e) {
    log(`[build-stop-go] ${e.message}`);
    log("Brug: node scripts/build-stop-go.mjs --issue N --area <område> --quote '<ejerens ordrette ja>' [--dry-run]");
    return 2;
  }
  const body = buildComment(go);
  // Selvtjek: kommentaren skal kunne læses af samme parser som håndhævelsen.
  const self = findOwnerGo([{ login: 'owner', body }], { ownerLogin: 'owner' });
  if (!self || self.area !== go.area || !OWNER_GO_MARKER_RE.test(body)) {
    log('[build-stop-go] intern fejl: kommentaren kan ikke læses af byggestoppet');
    return 1;
  }
  if (dryRun) {
    log(`[build-stop-go] --dry-run, intet skrevet til #${go.issue}:\n${body}`);
    return 0;
  }
  try {
    exec('gh', ['issue', 'comment', String(go.issue), '--repo', repo, '--body', body], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    log(`[build-stop-go] kunne ikke skrive kommentaren på #${go.issue}: ${String(e?.message || e).split('\n')[0]}`);
    return 1;
  }
  const back = readBack(go.issue, { repo });
  if (!back || back.area !== go.area || back.quote !== go.quote) {
    log(`[build-stop-go] kommentaren er skrevet på #${go.issue}, men markøren tæller ikke: den skal komme fra repo-ejerens konto (${repo.split('/')[0]}). Tjek 'gh auth status'.`);
    return 1;
  }
  log(`[build-stop-go] #${go.issue} tæller nu som på listen (område ${back.area}). PR-CI: kør build-stop-checket igen (push eller redigér PR-body).`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  process.exit(run(process.argv.slice(2)));
}
