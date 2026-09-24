// #5565 · Billedstationen: de RENE dele af scripts/pr-shots.mjs.
//
// Ingen I/O her, ingen Playwright, ingen gh. Alt i denne fil kan testes med
// `node --test scripts/lib/prShots.test.mjs` uden afhaengigheder. CLI'en
// (scripts/pr-shots.mjs) laegger browser, gh-kald og filsystem ovenpaa.
//
// Kontrakter (laeringen .claude/learnings/2026-09-24-pr-shots-fake-clock-logout.md):
//   1. Aldrig et falsk ur: et --shot-at/--clock-flag afvises med en fejl der
//      peger paa laeringen (rejectFakeClockFlag).
//   2. Skrive-vagten: alle ikke-laesende kald besvares lokalt (isWriteRequest),
//      og et signOut logges saerskilt (isSignOutRequest), fordi supabase-js
//      rydder den lokale session uanset hvad serveren svarer.
//   3. Login-probe foer serien: et redirect til /login betyder "ikke logget ind"
//      (isLoginPath). Scriptet laeser ALDRIG tokens eller cookies; proben er
//      kun en URL-sammenligning.

export const DEFAULT_ROUTES = Object.freeze(["/dashboard"]);
export const DEFAULT_VIEWPORTS = Object.freeze([1440, 390]);
export const DEFAULT_OUT_DIR = "pr-screens/live";
export const DEFAULT_CHANNEL = "msedge";
export const DEFAULT_REPO = "NicolaiDolmer/CyclingZone";

/** Persistent Playwright-profil. Ligger under `.claude/run/`, som er gitignoreret. */
export const PROFILE_DIR_REL = ".claude/run/pr-shots-profile";

/** Flag der ville skrue browser-uret. Afvises altid (laering 1). */
export const FAKE_CLOCK_FLAGS = Object.freeze(["--shot-at", "--clock", "--fake-clock", "--time", "--now"]);

export const FAKE_CLOCK_MESSAGE =
  "Et falsk browser-ur er forbudt i billedstationen: det loggede profilen ud 24/9 " +
  "(se .claude/learnings/2026-09-24-pr-shots-fake-clock-logout.md). " +
  "Tag billederne naar tilstanden findes i prod, eller mock GET-svarene.";

const KNOWN_FLAGS = new Set([
  "--pr", "--routes", "--viewports", "--url", "--out", "--channel", "--repo",
  "--login", "--dry-run", "--headed", "--help",
]);

/**
 * Parser CLI-argumenterne (uden node og script-stien).
 * Kaster paa ukendte flag, manglende --pr og paa ethvert falsk-ur-flag.
 */
export function parseArgs(argv) {
  const opts = {
    pr: null,
    routes: [...DEFAULT_ROUTES],
    viewports: [...DEFAULT_VIEWPORTS],
    url: null,
    out: DEFAULT_OUT_DIR,
    channel: DEFAULT_CHANNEL,
    repo: DEFAULT_REPO,
    login: false,
    dryRun: false,
    headed: false,
    help: false,
  };
  const args = [...argv];
  while (args.length) {
    const raw = args.shift();
    const eq = raw.indexOf("=");
    const flag = eq === -1 ? raw : raw.slice(0, eq);
    const inlineValue = eq === -1 ? null : raw.slice(eq + 1);
    rejectFakeClockFlag(flag);
    if (!KNOWN_FLAGS.has(flag)) throw new Error(`Ukendt flag: ${raw}. Koer med --help.`);
    const takeValue = () => {
      if (inlineValue !== null) return inlineValue;
      if (!args.length || args[0].startsWith("--")) throw new Error(`${flag} mangler en vaerdi.`);
      return args.shift();
    };
    switch (flag) {
      case "--pr": {
        const n = Number(takeValue());
        if (!Number.isInteger(n) || n <= 0) throw new Error("--pr skal vaere et positivt PR-nummer.");
        opts.pr = n;
        break;
      }
      case "--routes":
        opts.routes = parseRoutes(takeValue());
        break;
      case "--viewports":
        opts.viewports = parseViewports(takeValue());
        break;
      case "--url":
        opts.url = normalizeOrigin(takeValue());
        break;
      case "--out":
        opts.out = takeValue();
        break;
      case "--channel":
        opts.channel = takeValue();
        break;
      case "--repo":
        opts.repo = takeValue();
        break;
      case "--login": opts.login = true; break;
      case "--dry-run": opts.dryRun = true; break;
      case "--headed": opts.headed = true; break;
      case "--help": opts.help = true; break;
      default: throw new Error(`Ukendt flag: ${raw}`);
    }
  }
  if (!opts.help && opts.pr === null) throw new Error("--pr <N> er paakraevet.");
  return opts;
}

export function rejectFakeClockFlag(flag) {
  if (FAKE_CLOCK_FLAGS.includes(flag)) throw new Error(`${flag}: ${FAKE_CLOCK_MESSAGE}`);
}

export function parseRoutes(value) {
  const routes = String(value ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  if (!routes.length) throw new Error("--routes er tom.");
  for (const r of routes) {
    if (!r.startsWith("/")) throw new Error(`Route '${r}' skal starte med '/'.`);
  }
  return [...new Set(routes)];
}

export function parseViewports(value) {
  const widths = String(value ?? "").split(",").map((v) => v.trim()).filter(Boolean).map(Number);
  if (!widths.length) throw new Error("--viewports er tom.");
  for (const w of widths) {
    if (!Number.isInteger(w) || w < 320 || w > 4000) throw new Error(`Viewport '${w}' skal vaere et helt tal mellem 320 og 4000.`);
  }
  return [...new Set(widths)];
}

/** `https://x.vercel.app/foo?x` -> `https://x.vercel.app` (kun origin). */
export function normalizeOrigin(value) {
  let u;
  try { u = new URL(String(value)); } catch { throw new Error(`Ugyldig URL: ${value}`); }
  if (u.protocol !== "https:" && u.hostname !== "localhost") throw new Error(`Preview-URL skal vaere https: ${value}`);
  return u.origin;
}

/** `/dashboard` -> `dashboard`, `/` -> `root`, `/team/12?tab=a` -> `team-12`. */
export function routeSlug(route) {
  const path = String(route).split(/[?#]/)[0].replace(/^\/+|\/+$/g, "").toLowerCase();
  if (!path) return "root";
  return path.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "root";
}

/** Filnavn pr. billede: `<pr>-<route>-<viewport>.png`. */
export function shotFileName({ pr, route, viewport }) {
  return `${pr}-${routeSlug(route)}-${viewport}.png`;
}

/** Planen for en koersel: deterministisk raekkefoelge, viewports yderst, routes inderst. */
export function buildPlan({ pr, routes, viewports, out }, origin) {
  const shots = [];
  for (const viewport of viewports) {
    for (const route of routes) {
      shots.push({
        route,
        viewport,
        url: origin ? `${origin}${route}` : null,
        file: `${out}/${shotFileName({ pr, route, viewport })}`,
      });
    }
  }
  return shots;
}

// ── Preview-URL-opslag ─────────────────────────────────────────────────────

const VERCEL_PREVIEW_RE = /https:\/\/[a-z0-9][a-z0-9.-]*\.vercel\.app(?=[/\s")'>,]|$)/gi;

function vercelUrlsIn(text) {
  return [...String(text ?? "").matchAll(VERCEL_PREVIEW_RE)].map((m) => m[0].toLowerCase());
}

/**
 * Vaelger preview-URL'en blandt de kilder gh kan give os, i prioriteret raekkefoelge:
 *  1. GitHub Deployments (Vercel saetter `environment_url` paa status `success`),
 *  2. statusCheckRollup-konteksten "Vercel" (targetUrl er oftest inspektoren paa
 *     vercel.com, men en *.vercel.app-URL accepteres) — KUN naar checken selv
 *     bekraefter success (`state`-kontekster) eller `conclusion` (check runs);
 *     en pending/failure-status maa aldrig give en preview-URL.
 *  3. Vercel-bottens PR-kommentar ("Preview: https://...vercel.app") som SIDSTE
 *     udvej: en kommentar har ingen success-status at verificere imod, saa den
 *     bruges kun naar de to foerste intet fandt, og svaret faar et `warning`-felt
 *     opkalderen boer logge.
 * Branch-aliaset (`...-git-<branch>-...vercel.app`) foretraekkes indenfor hver kilde:
 * det er den samme origin for hvert push paa PR'en, saa ejerens login holder hele
 * PR'ens levetid.
 */
export function pickPreviewUrl({ deploymentStatuses = [], comments = [], statusCheckRollup = [] } = {}) {
  const candidates = [];
  for (const s of deploymentStatuses) {
    if (!s || s.state !== "success") continue;
    for (const url of vercelUrlsIn(s.environment_url)) candidates.push({ url, source: "deployment-status" });
  }
  for (const s of statusCheckRollup) {
    const ctx = String(s?.context ?? s?.name ?? "").toLowerCase();
    if (!ctx.includes("vercel")) continue;
    if (s?.state !== "success" && s?.conclusion !== "success") continue;
    for (const url of vercelUrlsIn(s.targetUrl ?? s.detailsUrl)) candidates.push({ url, source: "status-check" });
  }
  if (candidates.length) {
    const alias = candidates.find((c) => /-git-/.test(c.url));
    const chosen = alias ?? candidates[0];
    return { url: new URL(chosen.url).origin, source: chosen.source };
  }

  const commentCandidates = [];
  for (const c of comments) {
    const login = String(c?.author?.login ?? c?.user?.login ?? "").toLowerCase();
    if (!login.includes("vercel")) continue;
    for (const url of vercelUrlsIn(c.body)) commentCandidates.push({ url, source: "vercel-comment" });
  }
  if (!commentCandidates.length) return null;
  const alias = commentCandidates.find((c) => /-git-/.test(c.url));
  const chosen = alias ?? commentCandidates[0];
  return {
    url: new URL(chosen.url).origin,
    source: chosen.source,
    warning:
      "Preview-URL fra Vercel-bottens PR-kommentar (sidste udvej): hverken deployment-status " +
      "eller status-check bekraeftede success for denne URL.",
  };
}

/**
 * Slaar preview-URL'en op via gh. `runGh(args) -> string` injiceres, saa
 * opslaget kan testes uden gh. Returnerer { url, source, headSha } eller kaster.
 */
export function lookupPreviewUrl({ repo, pr, runGh }) {
  const view = JSON.parse(runGh(["pr", "view", String(pr), "--repo", repo, "--json", "headRefOid,statusCheckRollup,comments"]));
  const headSha = view.headRefOid;
  if (!headSha) throw new Error(`PR #${pr}: intet head-SHA fra gh pr view.`);

  const deploymentStatuses = [];
  let deployments = [];
  try {
    deployments = JSON.parse(runGh(["api", `repos/${repo}/deployments?sha=${headSha}&per_page=20`]));
  } catch { deployments = []; }
  for (const d of Array.isArray(deployments) ? deployments : []) {
    if (!/preview/i.test(String(d?.environment ?? ""))) continue;
    try {
      const statuses = JSON.parse(runGh(["api", `repos/${repo}/deployments/${d.id}/statuses?per_page=10`]));
      if (Array.isArray(statuses)) deploymentStatuses.push(...statuses);
    } catch { /* en enkelt deployment uden statuser er ikke en fejl; de andre kilder proeves */ }
  }

  const picked = pickPreviewUrl({
    deploymentStatuses,
    comments: view.comments ?? [],
    statusCheckRollup: view.statusCheckRollup ?? [],
  });
  if (!picked) {
    throw new Error(
      `PR #${pr}: ingen Vercel-preview fundet for ${headSha.slice(0, 7)} (deployments, Vercel-kommentar, status-check). ` +
      "Er previewet bygget? Ellers giv --url <https://...vercel.app>.",
    );
  }
  return { ...picked, headSha };
}

// ── Skrive-vagt ────────────────────────────────────────────────────────────

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function pathnameOf(url) {
  try { return new URL(String(url)).pathname; } catch { return String(url); }
}

/**
 * Alt der ikke er en laesning besvares lokalt (204), uanset host: prod-API'et,
 * Supabase REST/RPC/storage, PostHog, Sentry, Vercel-insights. Den ENESTE
 * undtagelse er Supabase' token-endpoint: `POST /auth/v1/token` er baade login
 * (grant_type=password, kun i --login) og refresh af den gemte session. Blokeres
 * den, doer sessionen efter en time, og "eet login" holder ikke.
 */
export function isWriteRequest(method, url) {
  if (READ_METHODS.has(String(method).toUpperCase())) return false;
  return !/\/auth\/v1\/token$/.test(pathnameOf(url));
}

/** `POST /auth/v1/logout` (supabase-js signOut). Besvares 204 OG logges. */
export function isSignOutRequest(url) {
  return /\/auth\/v1\/logout$/.test(pathnameOf(url));
}

/** Login-proben: landede vi paa login-siden? */
export function isLoginPath(url) {
  const p = pathnameOf(url).replace(/\/+$/, "");
  return p === "/login" || p === "/signup" || p === "/auth";
}

export function formatPlan(opts, origin, shots) {
  const lines = [
    `PR #${opts.pr}  preview: ${origin ?? "(slaas op via gh)"}`,
    `profil: ${PROFILE_DIR_REL} (kopi pr. koersel)  kanal: ${opts.channel}  out: ${opts.out}`,
    `routes: ${opts.routes.join(", ")}  viewports: ${opts.viewports.join(", ")}`,
  ];
  for (const s of shots) lines.push(`  ${s.file}  <-  ${s.url ?? s.route} @ ${s.viewport}`);
  return lines.join("\n");
}

export const HELP_TEXT = `Billedstationen (#5565): aegte-data-billeder af en PR's Vercel-preview.

  node scripts/pr-shots.mjs --pr <N> [--routes /dashboard,/academy] [--viewports 1440,390]
                            [--login] [--dry-run] [--url <origin>] [--out pr-screens/live]
                            [--channel msedge|chrome|chromium] [--headed] [--repo owner/name]

  --login     aabn browseren (headed) paa previewets /login, log ind selv; scriptet
              lukker selv naar login er gemt. Én gang pr. preview-origin.
  --dry-run   print planen (URL-opslag + filnavne) uden at starte browser.
  --url       spring gh-opslaget over og brug denne preview-origin.

Scriptet laeser, skriver og logger ALDRIG tokens eller cookies, skruer aldrig
browser-uret, og besvarer alle skrivende kald lokalt (204). Billederne indeholder
aegte spillerdata: commit dem ikke.`;
