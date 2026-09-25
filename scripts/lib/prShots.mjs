// #5565 · Billedstationen: de RENE dele af scripts/pr-shots.mjs.
//
// Ingen I/O her, ingen Playwright, ingen gh. Alt i denne fil kan testes med
// `node --test scripts/lib/prShots.test.mjs` uden afhaengigheder. CLI'en
// (scripts/pr-shots.mjs) laegger build, statisk server, browser og filsystem ovenpaa.
//
// Designet (docs/drafts/spec-5565-billedstation-2026-09-25.md, ejer-ja 23/9):
// EEN fast origin (http://localhost:5173, allerede i backendens CORS-liste) mod
// prod-API'et, EEN persistent profil uden for repoet, EET login. Hver PR's
// frontend bygges i sin egen worktree og serveres paa samme origin, saa
// Supabase-sessionen i profilen gaelder for alle PR'er.
//
// Sikkerhedskontrakt (bindende, .claude/learnings/2026-09-24-pr-shots-fake-clock-logout.md):
//   1. Aldrig et falsk ur: et --shot-at/--clock-flag afvises med en fejl der
//      peger paa laeringen (rejectFakeClockFlag). Andre tidspunkter fremkaldes
//      med GET-mocks af datasvar (--mock), aldrig med uret.
//   2. Skrive-vagten: alle ikke-laesende kald besvares lokalt (isWriteRequest),
//      undtagen Supabase' token-endpoint (login + refresh), og et signOut logges
//      saerskilt (isSignOutRequest), fordi supabase-js rydder den lokale session
//      uanset hvad serveren svarer. Derfor koerer hver serie i en KOPI af profilen.
//   3. Login-probe foer serien (probeVerdict): et redirect til /login eller et
//      401 fra API'et betyder "ikke logget ind". Scriptet laeser ALDRIG tokens,
//      cookies eller storage; proben ser kun paa URL'en og statuskoder.

import { isAbsolute, join, relative, resolve } from "node:path";

// ── Faste vaerdier (origin er kontrakten) ──────────────────────────────────

export const FIXED_PORT = 5173;
export const FIXED_ORIGIN = `http://localhost:${FIXED_PORT}`;
/** Loopback-adresser den statiske server binder paa. Begge skal vaere frie. */
export const BIND_HOSTS = Object.freeze(["127.0.0.1", "::1"]);
export const DEFAULT_WIDTHS = Object.freeze([1440, 390]);
export const DEFAULT_CHANNEL = "msedge";
export const DEFAULT_REPO = "NicolaiDolmer/CyclingZone";
export const DEFAULT_BEFORE_LABEL = "main";
export const BUILD_COMMAND = "npm run build";
/** GET-endpoint den statiske server svarer paa med sin nonce (origin-bevis). */
export const ID_PATH = "/__pr-shots-id";
export const PROFILE_DIR_NAME = "cz-pr-shots-profile";
/** Undermappe i OneDrive-context. Billederne har aegte spillernavne: aldrig i repoet. */
export const ONEDRIVE_OUT_REL = "CyclingZone-context/private-handoffs/pr-shots";
/** Fallback naar OneDrive-context ikke findes. Gitignoreret (pr-screens/ selv er IKKE). */
export const FALLBACK_OUT_REL = "pr-screens/live";
export const REPORT_FILE = "report.json";
export const COMPOSE_FILE = "before-after.png";

/** Flag der ville skrue browser-uret. Afvises altid (laering 1). */
export const FAKE_CLOCK_FLAGS = Object.freeze(["--shot-at", "--clock", "--fake-clock", "--time", "--now"]);

export const FAKE_CLOCK_MESSAGE =
  "Et falsk browser-ur er forbudt i billedstationen: det loggede profilen ud 24/9 " +
  "(se .claude/learnings/2026-09-24-pr-shots-fake-clock-logout.md). " +
  "Tag billederne naar tilstanden findes i prod, eller mock GET-svarene med --mock=<sti>=<json-fil>.";

export const COMMANDS = Object.freeze(["login", "shoot", "compose"]);

const COMMON_FLAGS = ["--channel", "--dry-run", "--help"];
const FLAGS_BY_COMMAND = {
  login: new Set([...COMMON_FLAGS, "--no-build"]),
  shoot: new Set([
    ...COMMON_FLAGS, "--widths", "--viewports", "--click", "--mock", "--wait-for",
    "--no-build", "--headed", "--out", "--pr", "--repo",
  ]),
  compose: new Set([...COMMON_FLAGS, "--before", "--out"]),
};
const BOOLEAN_FLAGS = new Set(["--dry-run", "--help", "--no-build", "--headed"]);
const REPEATABLE_FLAGS = new Set(["--click", "--mock", "--wait-for"]);

// ── Argument-parsing ───────────────────────────────────────────────────────

/**
 * Git Bash (MSYS) omskriver et argument som `/dashboard` til
 * `C:/Program Files/Git/dashboard`, foer node ser det. Vi reparerer det og
 * siger det, i stedet for at fotografere en Windows-sti.
 */
export function unmangleMsysPath(value) {
  const m = /^[A-Za-z]:[\\/](?:.*[\\/])?Git[\\/](.*)$/i.exec(String(value));
  if (!m) return { value: String(value), repaired: false };
  return { value: `/${m[1].replace(/\\/g, "/")}`, repaired: true };
}

function toRoute(raw, warnings) {
  const { value, repaired } = unmangleMsysPath(raw);
  if (repaired) warnings.push(`'${raw}' lignede en Git Bash-omskrevet sti; bruger '${value}' (koer helst fra PowerShell).`);
  return value;
}

export function parseRoutes(values, warnings = []) {
  const routes = values
    .flatMap((v) => String(v ?? "").split(","))
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => toRoute(r, warnings));
  if (!routes.length) throw new Error("Ingen routes. Eksempel: shoot <label> <worktree> /dashboard /team");
  for (const r of routes) {
    if (!r.startsWith("/")) throw new Error(`Route '${r}' skal starte med '/'.`);
  }
  return [...new Set(routes)];
}

export function parseWidths(value) {
  const widths = String(value ?? "").split(",").map((v) => v.trim()).filter(Boolean).map(Number);
  if (!widths.length) throw new Error("--widths er tom.");
  for (const w of widths) {
    if (!Number.isInteger(w) || w < 320 || w > 4000) throw new Error(`Bredde '${w}' skal vaere et helt tal mellem 320 og 4000.`);
  }
  return [...new Set(widths)];
}

/** `--click=Taktik` (synlig tekst) eller `--click=css:[data-testid=x]`. */
export function parseClick(value) {
  const v = String(value ?? "").trim();
  if (!v) throw new Error("--click er tom.");
  if (v.startsWith("css:")) {
    const selector = v.slice(4).trim();
    if (!selector) throw new Error("--click=css: mangler en selector.");
    return { kind: "css", value: selector };
  }
  return { kind: "text", value: v };
}

/**
 * `--mock=/api/races/today=fil.json` eller `--mock=/api/me=status:401`.
 * Kun GET mockes; en mock er et tilstandsbillede af et datasvar, aldrig et ur.
 */
export function parseMock(value, warnings = []) {
  const v = String(value ?? "");
  const eq = v.indexOf("=");
  if (eq <= 0 || eq === v.length - 1) throw new Error(`--mock skal have formen <sti>=<json-fil> eller <sti>=status:<kode>: '${v}'`);
  const path = toRoute(v.slice(0, eq).trim(), warnings);
  const target = v.slice(eq + 1).trim();
  if (!path.startsWith("/")) throw new Error(`--mock-stien '${path}' skal starte med '/'.`);
  const status = /^status:(\d{3})$/.exec(target);
  if (status) {
    const code = Number(status[1]);
    if (code < 200 || code > 599) throw new Error(`--mock-status ${code} er ikke en HTTP-status.`);
    return { path, status: code, file: null };
  }
  return { path, status: 200, file: target };
}

/** Hvilken mock (hvis nogen) svarer paa dette kald. Kun GET, stien skal matche praecist. */
export function mockFor(mocks, method, url) {
  if (String(method).toUpperCase() !== "GET") return null;
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  for (const m of mocks) {
    const withQuery = m.path.includes("?");
    const candidate = withQuery ? `${u.pathname}${u.search}` : u.pathname;
    if (candidate === m.path) return m;
  }
  return null;
}

export function rejectFakeClockFlag(flag) {
  if (FAKE_CLOCK_FLAGS.includes(flag)) throw new Error(`${flag}: ${FAKE_CLOCK_MESSAGE}`);
}

/** `feat/5589-today-stages` -> `feat-5589-today-stages`. */
export function slugify(value) {
  const s = String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!s) throw new Error(`Label '${value}' giver et tomt navn.`);
  return s;
}

/**
 * Parser CLI-argumenterne (uden node og script-stien).
 * `<login|shoot|compose> [positionelle] [--flag=vaerdi | --flag vaerdi]`.
 * Kaster paa ukendte kommandoer/flag, manglende positionelle og paa ethvert falsk-ur-flag.
 */
export function parseArgs(argv) {
  const args = [...argv];
  const warnings = [];
  for (const raw of args) {
    if (raw.startsWith("--")) rejectFakeClockFlag(raw.split("=")[0]);
  }
  if (!args.length || args.includes("--help") || args[0] === "help") return { help: true, warnings };

  const command = args.shift();
  if (!COMMANDS.includes(command)) {
    if (String(command).startsWith("--")) {
      throw new Error(`Billedstationen har kommandoer nu: ${COMMANDS.join(" | ")} (fx 'shoot <label> <worktree> /dashboard'). Koer med --help.`);
    }
    throw new Error(`Ukendt kommando: ${command}. Brug ${COMMANDS.join(" | ")}.`);
  }

  const allowed = FLAGS_BY_COMMAND[command];
  const flags = {};
  const positionals = [];
  while (args.length) {
    const raw = args.shift();
    if (!raw.startsWith("--")) { positionals.push(raw); continue; }
    const eq = raw.indexOf("=");
    const flag = eq === -1 ? raw : raw.slice(0, eq);
    const inlineValue = eq === -1 ? null : raw.slice(eq + 1);
    if (!allowed.has(flag)) throw new Error(`Ukendt flag for '${command}': ${raw}. Koer med --help.`);
    let value = true;
    if (!BOOLEAN_FLAGS.has(flag)) {
      if (inlineValue !== null) value = inlineValue;
      else if (args.length && !args[0].startsWith("--")) value = args.shift();
      else throw new Error(`${flag} mangler en vaerdi.`);
    } else if (inlineValue !== null) {
      throw new Error(`${flag} tager ingen vaerdi.`);
    }
    if (REPEATABLE_FLAGS.has(flag)) (flags[flag] ??= []).push(value);
    else flags[flag] = value;
  }

  const opts = {
    help: false,
    command,
    channel: flags["--channel"] ?? DEFAULT_CHANNEL,
    dryRun: Boolean(flags["--dry-run"]),
    warnings,
  };

  if (command === "login") {
    if (positionals.length > 1) throw new Error("login tager hoejst een worktree-sti.");
    return { ...opts, worktree: positionals[0] ?? null, build: !flags["--no-build"] };
  }

  if (command === "compose") {
    if (positionals.length !== 1) throw new Error("compose kraever praecis een label: compose <label> [--before=main]");
    return {
      ...opts,
      label: slugify(positionals[0]),
      before: slugify(flags["--before"] ?? DEFAULT_BEFORE_LABEL),
      out: flags["--out"] ?? null,
    };
  }

  // shoot
  if (positionals.length < 3) throw new Error("shoot kraever <label> <worktree> <routes...>, fx: shoot feat-5589 C:\\Dev\\CyclingZone-worktrees\\feat-5589 /dashboard");
  const [label, worktree, ...routeArgs] = positionals;
  if (flags["--widths"] && flags["--viewports"]) throw new Error("Brug enten --widths eller --viewports, ikke begge.");
  let pr = null;
  if (flags["--pr"] !== undefined) {
    pr = Number(flags["--pr"]);
    if (!Number.isInteger(pr) || pr <= 0) throw new Error("--pr skal vaere et positivt PR-nummer.");
  }
  return {
    ...opts,
    label: slugify(label),
    worktree,
    routes: parseRoutes(routeArgs, warnings),
    widths: flags["--widths"] || flags["--viewports"] ? parseWidths(flags["--widths"] ?? flags["--viewports"]) : [...DEFAULT_WIDTHS],
    clicks: (flags["--click"] ?? []).map(parseClick),
    mocks: (flags["--mock"] ?? []).map((m) => parseMock(m, warnings)),
    waitFor: (flags["--wait-for"] ?? []).map((w) => String(w).trim()).filter(Boolean),
    build: !flags["--no-build"],
    headed: Boolean(flags["--headed"]),
    out: flags["--out"] ?? null,
    pr,
    repo: flags["--repo"] ?? DEFAULT_REPO,
  };
}

// ── Stier ──────────────────────────────────────────────────────────────────

/**
 * Mesterprofilen ligger uden for ALLE checkouts, saa eet login gaelder uanset
 * hvilken worktree scriptet koeres fra: `%LOCALAPPDATA%\cz-pr-shots-profile`.
 */
export function masterProfileDir({ env = {}, homedir }) {
  const base = env.LOCALAPPDATA || (homedir ? join(homedir, "AppData", "Local") : null);
  if (!base) throw new Error("Kan ikke finde LOCALAPPDATA til billedstationens profil.");
  return join(base, PROFILE_DIR_NAME);
}

/** OneDrive-context hvis den findes, ellers den gitignorerede pr-screens/live i repoet. */
export function defaultOutRoot({ env = {}, homedir, repoRoot, exists }) {
  const oneDrive = env.OneDrive || env.ONEDRIVE || (homedir ? join(homedir, "OneDrive") : null);
  if (oneDrive && exists(join(oneDrive, "CyclingZone-context"))) {
    return { dir: join(oneDrive, ...ONEDRIVE_OUT_REL.split("/")), private: true };
  }
  return { dir: join(repoRoot, ...FALLBACK_OUT_REL.split("/")), private: false };
}

export function isInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// ── Plan ───────────────────────────────────────────────────────────────────

/** `/dashboard` -> `dashboard`, `/` -> `root`, `/team/12?tab=a` -> `team-12-tab-a`. */
export function routeSlug(route) {
  const path = String(route).split("#")[0].replace(/^\/+|\/+$/g, "").toLowerCase();
  return path.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "root";
}

export function shotFileName({ route, width }) {
  return `${routeSlug(route)}-${width}.png`;
}

/**
 * Planen for `shoot`: fast origin + port, build i worktreets egen frontend-mappe
 * (ellers mister Tailwind sin config), bredder yderst og routes inderst.
 */
export function planShoot(opts, { outRoot }) {
  const worktree = resolve(opts.worktree);
  const outDir = join(outRoot, opts.label);
  const seen = new Map();
  const shots = [];
  for (const width of opts.widths) {
    for (const route of opts.routes) {
      const file = join(outDir, shotFileName({ route, width }));
      const clash = seen.get(file);
      if (clash && clash !== route) throw new Error(`Routes '${clash}' og '${route}' giver samme filnavn. Giv dem forskellige stier.`);
      seen.set(file, route);
      shots.push({ route, width, url: `${FIXED_ORIGIN}${route}`, file });
    }
  }
  return {
    label: opts.label,
    worktree,
    buildCwd: join(worktree, "frontend"),
    buildCommand: opts.build ? BUILD_COMMAND : null,
    distDir: join(worktree, "frontend", "dist"),
    origin: FIXED_ORIGIN,
    port: FIXED_PORT,
    outDir,
    reportFile: join(outDir, REPORT_FILE),
    shots,
  };
}

export function formatPlan(opts, plan, { profileDir, outPrivate }) {
  const lines = [
    `shoot ${plan.label}  origin: ${plan.origin} (fast, port ${plan.port})`,
    `build: ${plan.buildCommand ? `${plan.buildCommand} i ${plan.buildCwd}` : `ingen (--no-build), serverer ${plan.distDir}`}`,
    `profil: kopi af ${profileDir} pr. koersel  kanal: ${opts.channel}`,
    `out: ${plan.outDir}${outPrivate ? "" : "  (ADVARSEL: OneDrive-context ikke fundet, gitignoreret fallback)"}`,
    `routes: ${opts.routes.join(", ")}  bredder: ${opts.widths.join(", ")}`,
  ];
  for (const c of opts.clicks) lines.push(`klik: ${c.kind === "css" ? `css:${c.value}` : `tekst '${c.value}'`}`);
  for (const w of opts.waitFor) lines.push(`vent paa: ${w}`);
  for (const m of opts.mocks) lines.push(`MOCK GET ${m.path} -> ${m.file ?? `status ${m.status}`}`);
  for (const s of plan.shots) lines.push(`  ${s.file}  <-  ${s.url} @ ${s.width}`);
  return lines.join("\n");
}

// ── Statisk server (pure del) ──────────────────────────────────────────────

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

export function contentTypeFor(file) {
  const m = /\.[a-z0-9]+$/i.exec(String(file));
  return (m && CONTENT_TYPES[m[0].toLowerCase()]) || "application/octet-stream";
}

/**
 * Samme opslag som produktionen (frontend/vercel.json) og e2e-serveren (#5494):
 * filsystemet foerst (fil, `<sti>.html`, `<sti>/index.html`), ellers SPA-fallback
 * til app.html. `vite preview` ville falde tilbage til index.html, som er den
 * prerendrede forside, og /dashboard ville faa forsidens HTML.
 * Returnerer den absolutte fil eller null (404). Stier uden for dist afvises.
 */
export function resolveStaticFile(distDir, urlPath, isFile) {
  let pathname;
  try { pathname = decodeURIComponent(String(urlPath).split(/[?#]/)[0]); } catch { return null; }
  if (pathname.includes("\0")) return null;
  const base = resolve(distDir);
  const target = resolve(base, `.${pathname.startsWith("/") ? pathname : `/${pathname}`}`);
  if (!isInside(base, target)) return null;
  const candidates = pathname.endsWith("/")
    ? [join(target, "index.html")]
    : [target, `${target}.html`, join(target, "index.html")];
  for (const c of candidates) if (isFile(c)) return c;
  const lastSegment = pathname.split("/").pop() ?? "";
  if (/\.[a-z0-9]+$/i.test(lastSegment)) return null;
  for (const fallback of ["app.html", "index.html"]) {
    const f = join(base, fallback);
    if (isFile(f)) return f;
  }
  return null;
}

// ── Skrive-vagt og login-probe ─────────────────────────────────────────────

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function pathnameOf(url) {
  try { return new URL(String(url)).pathname; } catch { return String(url); }
}

/**
 * Alt der ikke er en laesning besvares lokalt (204), uanset host: prod-API'et,
 * Supabase REST/RPC/storage, PostHog, Sentry, Vercel-insights. Den ENESTE
 * undtagelse er Supabase' token-endpoint: `POST /auth/v1/token` er baade login
 * (grant_type=password, kun i `login`) og refresh af den gemte session. Blokeres
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

/** Til rapporten: metode + origin + sti, aldrig query eller body. */
export function describeRequest(method, url) {
  try {
    const u = new URL(String(url));
    return `${String(method).toUpperCase()} ${u.origin}${u.pathname}`;
  } catch {
    return `${String(method).toUpperCase()} ${String(url).split("?")[0]}`;
  }
}

/** Login-proben: landede vi paa login-siden? */
export function isLoginPath(url) {
  const p = pathnameOf(url).replace(/\/+$/, "");
  return p === "/login" || p === "/signup" || p === "/auth";
}

/** Et 401 fra app-API'et eller Supabase-auth under proben = doed session. */
export function isAuthFailure(status, url) {
  if (status !== 401) return false;
  const p = pathnameOf(url);
  return p.startsWith("/api/") || p.startsWith("/auth/v1/");
}

/**
 * Proben: `/dashboard` aabnet i profil-kopien. Logget ind = vi blev ikke sendt
 * til /login OG intet API-/auth-kald svarede 401. Ingen storage laeses.
 */
export function probeVerdict({ finalUrl, authFailures = [] }) {
  if (isLoginPath(finalUrl)) return { ok: false, reason: "sendt til login-siden" };
  if (authFailures.length) return { ok: false, reason: `401 fra ${authFailures[0]}` };
  return { ok: true, reason: "logget ind" };
}

// ── Compose (foer/efter) ───────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Parrer foer- og efter-rapporternes billeder: een raekke pr. route x bredde i
 * efter-rapportens raekkefoelge; et billede der kun findes paa den ene side faar
 * `null` paa den anden (vises som "mangler").
 */
export function pairShots(beforeReport, afterReport) {
  const key = (s) => `${s.route}@${s.width}`;
  const before = new Map((beforeReport?.shots ?? []).map((s) => [key(s), s]));
  const rows = [];
  const used = new Set();
  for (const s of afterReport?.shots ?? []) {
    rows.push({ route: s.route, width: s.width, before: before.get(key(s))?.file ?? null, after: s.file });
    used.add(key(s));
  }
  for (const s of beforeReport?.shots ?? []) {
    if (!used.has(key(s))) rows.push({ route: s.route, width: s.width, before: s.file, after: null });
  }
  return rows;
}

/**
 * HTML til det samlede foer/efter-billede. `rows[].beforeSrc/afterSrc` er
 * data-URI'er (eller null). Mobil (< 800 px) vises i halv kolonnebredde.
 */
export function composeHtml({ before, after, rows, mocks = [] }) {
  const cell = (src, width) =>
    src
      ? `<img src="${escapeHtml(src)}" style="width:${width < 800 ? "50%" : "100%"}" alt="">`
      : `<div class="missing">mangler</div>`;
  const mockNote = mocks.length
    ? `<p class="mock">MOCK (ikke prod-tilstand): ${mocks.map((m) => escapeHtml(m)).join(", ")}</p>`
    : "";
  const body = rows
    .map(
      (r) => `<section>
<h2>${escapeHtml(r.route)} · ${escapeHtml(r.width)} px</h2>
<div class="row"><div class="col">${cell(r.beforeSrc, r.width)}</div><div class="col">${cell(r.afterSrc, r.width)}</div></div>
</section>`,
    )
    .join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
body{margin:0;padding:24px;background:#fff;color:#111;font:14px/1.4 system-ui,sans-serif;width:1480px}
header,.row{display:grid;grid-template-columns:1fr 1fr;gap:24px}
header div{font-weight:600;font-size:18px}
h2{font-size:15px;margin:28px 0 8px;font-weight:600}
.col{border:1px solid #ddd;padding:8px;text-align:center}
.col img{display:block;margin:0 auto}
.missing{padding:48px 0;color:#888}
.mock{color:#a40;font-weight:600}
</style></head><body>
<header><div>Foer: ${escapeHtml(before)}</div><div>Efter: ${escapeHtml(after)}</div></header>
${mockNote}
${body}
</body></html>`;
}

// ── Preview-URL-opslag (valgfrit link i rapporten, --pr) ───────────────────

const VERCEL_PREVIEW_RE = /https:\/\/[a-z0-9][a-z0-9.-]*\.vercel\.app(?=[/\s")'>,]|$)/gi;

function vercelUrlsIn(text) {
  return [...String(text ?? "").matchAll(VERCEL_PREVIEW_RE)].map((m) => m[0].toLowerCase());
}

/**
 * Vaelger preview-URL'en blandt de kilder gh kan give os, i prioriteret raekkefoelge:
 *  1. GitHub Deployments (Vercel saetter `environment_url` paa status `success`),
 *  2. statusCheckRollup-konteksten "Vercel", KUN naar checken selv bekraefter
 *     success (`state`-kontekster) eller `conclusion` (check runs),
 *  3. Vercel-bottens PR-kommentar som SIDSTE udvej, med et `warning`-felt.
 * Branch-aliaset (`...-git-<branch>-...vercel.app`) foretraekkes indenfor hver kilde.
 * Billedstationen fotograferer ALDRIG previewet (det kraever et login pr. origin);
 * linket skrives kun i rapporten, saa go-kortet kan linke til det.
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
    throw new Error(`PR #${pr}: ingen Vercel-preview fundet for ${headSha.slice(0, 7)} (deployments, Vercel-kommentar, status-check).`);
  }
  return { ...picked, headSha };
}

// ── Hjaelp ─────────────────────────────────────────────────────────────────

export const HELP_TEXT = `Billedstationen (#5565): aegte-data-billeder fra EEN fast lokal origin (${FIXED_ORIGIN})
mod prod-API'et, med EET login for alle PR'er.

  node scripts/pr-shots.mjs login [<worktree>] [--no-build]
      Bygger frontenden (default: denne checkout), serverer den paa ${FIXED_ORIGIN}
      og aabner Edge paa /login. Log ind selv; vinduet lukker, naar login er gemt
      i %LOCALAPPDATA%\\${PROFILE_DIR_NAME}. Een gang, ca. 1 min + build.

  node scripts/pr-shots.mjs shoot <label> <worktree> <routes...> [--widths=1440,390]
                            [--click=<tekst>|--click=css:<selector>]... [--wait-for=<selector>]...
                            [--mock=<sti>=<json-fil>|--mock=<sti>=status:<kode>]...
                            [--pr=<N>] [--no-build] [--headed] [--out=<mappe>] [--dry-run]
      Bygger worktreets frontend (cwd = <worktree>/frontend), serverer den paa
      ${FIXED_ORIGIN} og fotograferer hver route i hver bredde i en KOPI af profilen.
      Output: <OneDrive>\\${ONEDRIVE_OUT_REL.replace(/\//g, "\\")}\\<label>\\<route>-<bredde>.png + ${REPORT_FILE}.
      --pr skriver PR'ens Vercel-preview-link i rapporten (til go-kortet).

  node scripts/pr-shots.mjs compose <label> [--before=main]
      Eet samlet foer/efter-billede (<label>\\${COMPOSE_FILE}). "Foer" tages med
      shoot main <main-checkout> <samme routes>.

Faelles: --channel=msedge|chrome|chromium, --dry-run (plan uden build/browser).

Scriptet laeser, skriver og logger ALDRIG tokens, cookies eller storage, skruer
aldrig browser-uret, og besvarer alle skrivende kald lokalt (204), undtagen
Supabase' token-refresh. Billederne indeholder aegte spillerdata: aldrig i repoet.`;
