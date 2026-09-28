// #5565 · Tests for billedstationens rene dele. Ingen browser, ingen gh, ingen net.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FALLBACK_OUT_REL,
  FAKE_CLOCK_FLAGS,
  FIXED_ORIGIN,
  FIXED_PORT,
  composeHtml,
  contentTypeFor,
  defaultOutRoot,
  describeRequest,
  formatPlan,
  isAuthFailure,
  isInside,
  isLoginPath,
  isSignOutRequest,
  isStaleProfileCopy,
  isWriteRequest,
  lookupPreviewUrl,
  masterProfileDir,
  mockFor,
  pairShots,
  parseArgs,
  parseClick,
  parseMock,
  parseMockRpc,
  pickPreviewUrl,
  planShoot,
  probeVerdict,
  resolveStaticFile,
  routeSlug,
  shotFileName,
  slugify,
  unmangleMsysPath,
} from "./prShots.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── Argument-parsing ───────────────────────────────────────────────────────

test("parseArgs shoot: spec'ens fulde kommando", () => {
  const opts = parseArgs([
    "shoot", "feat/5589-today-stages", "wt", "/a", "/b",
    "--widths=1440,390", "--click=Taktik", "--click=css:[data-testid=x]",
    "--mock=/api/x=f.json", "--dry-run",
  ]);
  assert.equal(opts.command, "shoot");
  assert.equal(opts.label, "feat-5589-today-stages");
  assert.equal(opts.worktree, "wt");
  assert.deepEqual(opts.routes, ["/a", "/b"]);
  assert.deepEqual(opts.widths, [1440, 390]);
  assert.deepEqual(opts.clicks, [{ kind: "text", value: "Taktik" }, { kind: "css", value: "[data-testid=x]" }]);
  assert.deepEqual(opts.mocks, [{ path: "/api/x", rpc: null, status: 200, file: "f.json" }]);
  assert.equal(opts.dryRun, true);
  assert.equal(opts.build, true);
  assert.equal(opts.channel, "msedge");
  assert.equal(opts.pr, null);
});

test("parseArgs shoot: defaults, kommasepareret routes, --flag vaerdi-form, --pr, --no-build", () => {
  const opts = parseArgs(["shoot", "lbl", "wt", "/dashboard,/team", "--pr", "5589", "--no-build", "--viewports", "390"]);
  assert.deepEqual(opts.routes, ["/dashboard", "/team"]);
  assert.deepEqual(opts.widths, [390]);
  assert.equal(opts.pr, 5589);
  assert.equal(opts.build, false);
  assert.deepEqual(parseArgs(["shoot", "l", "wt", "/x"]).widths, [1440, 390]);
});

test("parseArgs login og compose", () => {
  assert.deepEqual(
    (({ command, worktree, build }) => ({ command, worktree, build }))(parseArgs(["login"])),
    { command: "login", worktree: null, build: true },
  );
  assert.equal(parseArgs(["login", "C:\\Dev\\CyclingZone", "--no-build"]).build, false);
  const c = parseArgs(["compose", "feat/5589-x"]);
  assert.equal(c.label, "feat-5589-x");
  assert.equal(c.before, "main");
  assert.equal(parseArgs(["compose", "x", "--before=main-2609"]).before, "main-2609");
});

test("parseArgs: ukendt flag/kommando, manglende positionelle og daarlige vaerdier afvises", () => {
  assert.equal(parseArgs([]).help, true);
  assert.equal(parseArgs(["shoot", "--help"]).help, true);
  assert.throws(() => parseArgs(["bogus"]), /Ukendt kommando/);
  assert.throws(() => parseArgs(["--pr", "5589"]), /kommandoer nu/, "den gamle --pr-form peger paa de nye kommandoer");
  assert.throws(() => parseArgs(["shoot", "l", "wt", "/x", "--bogus"]), /Ukendt flag/);
  assert.throws(() => parseArgs(["login", "--widths=390"]), /Ukendt flag for 'login'/);
  assert.throws(() => parseArgs(["shoot", "l", "wt"]), /shoot kraever/);
  assert.throws(() => parseArgs(["shoot", "l", "wt", "dashboard"]), /starte med/);
  assert.throws(() => parseArgs(["shoot", "l", "wt", "/x", "--widths=1440,abc"]), /helt tal/);
  assert.throws(() => parseArgs(["shoot", "l", "wt", "/x", "--widths=100"]), /mellem 320 og 4000/);
  assert.throws(() => parseArgs(["shoot", "l", "wt", "/x", "--widths=390", "--viewports=390"]), /ikke begge/);
  assert.throws(() => parseArgs(["shoot", "l", "wt", "/x", "--pr=x"]), /positivt PR-nummer/);
  assert.throws(() => parseArgs(["shoot", "l", "wt", "/x", "--click"]), /mangler en vaerdi/);
  assert.throws(() => parseArgs(["shoot", "l", "wt", "/x", "--dry-run=1"]), /ingen vaerdi/);
  assert.throws(() => parseArgs(["compose"]), /praecis een label/);
  assert.throws(() => parseArgs(["shoot", "!!!", "wt", "/x"]), /tomt navn/);
});

test("parseArgs: et falsk ur afvises altid med henvisning til laeringen (24/9), i alle kommandoer", () => {
  for (const flag of FAKE_CLOCK_FLAGS) {
    assert.throws(
      () => parseArgs(["shoot", "l", "wt", "/x", flag, "2026-09-23T21:30"]),
      /2026-09-24-pr-shots-fake-clock-logout/,
      flag,
    );
    assert.throws(() => parseArgs(["login", `${flag}=2026-09-23`]), /falsk browser-ur/, `${flag}=`);
    assert.throws(() => parseArgs([flag, "x"]), /falsk browser-ur/, "ogsaa foer kommandoen");
  }
});

test("unmangleMsysPath: Git Bash-omskrevne routes repareres med advarsel", () => {
  assert.deepEqual(unmangleMsysPath("C:/Program Files/Git/dashboard"), { value: "/dashboard", repaired: true });
  assert.deepEqual(unmangleMsysPath("C:\\Program Files\\Git\\team\\12"), { value: "/team/12", repaired: true });
  assert.deepEqual(unmangleMsysPath("/dashboard"), { value: "/dashboard", repaired: false });
  const opts = parseArgs(["shoot", "l", "wt", "C:/Program Files/Git/dashboard", "--mock=C:/Program Files/Git/api/me=status:401"]);
  assert.deepEqual(opts.routes, ["/dashboard"]);
  assert.equal(opts.mocks[0].path, "/api/me");
  assert.equal(opts.warnings.length, 2);
  assert.match(opts.warnings[0], /PowerShell/);
});

test("parseClick og parseMock", () => {
  assert.deepEqual(parseClick("Taktik"), { kind: "text", value: "Taktik" });
  assert.deepEqual(parseClick("css:[data-testid=tab]"), { kind: "css", value: "[data-testid=tab]" });
  assert.throws(() => parseClick("css:"), /mangler en selector/);
  assert.deepEqual(parseMock("/api/me=status:401"), { path: "/api/me", rpc: null, status: 401, file: null });
  assert.deepEqual(parseMock("/api/races?day=today=today.json"), { path: "/api/races?day=today", rpc: null, status: 200, file: "today.json" });
  assert.throws(() => parseMock("/api/x"), /formen/);
  assert.throws(() => parseMock("api/x=f.json"), /starte med/);
  assert.throws(() => parseMock("/api/x=status:999"), /ikke en HTTP-status/);
});

test("parseMockRpc: funktionsnavn -> POST /rest/v1/rpc/<fn>; fil eller status; daarlige navne afvises", () => {
  assert.deepEqual(parseMockRpc("get_season_recap=recap.json"), {
    path: "/rest/v1/rpc/get_season_recap", rpc: "get_season_recap", status: 200, file: "recap.json",
  });
  assert.deepEqual(parseMockRpc("get_season_honours=status:404"), {
    path: "/rest/v1/rpc/get_season_honours", rpc: "get_season_honours", status: 404, file: null,
  });
  assert.throws(() => parseMockRpc("get_season_recap"), /formen/);
  assert.throws(() => parseMockRpc("=recap.json"), /formen/);
  assert.throws(() => parseMockRpc("/rest/v1/rpc/get_season_recap=recap.json"), /funktionsnavn/, "kun navnet, ikke stien");
  assert.throws(() => parseMockRpc("get season=recap.json"), /funktionsnavn/);
  assert.throws(() => parseMockRpc("get_x=status:999"), /ikke en HTTP-status/);
  const opts = parseArgs(["shoot", "l", "wt", "/season", "--mock-rpc=get_season_recap=recap.json", "--mock=/api/me=status:401"]);
  assert.deepEqual(opts.mocks, [
    { path: "/api/me", rpc: null, status: 401, file: null },
    { path: "/rest/v1/rpc/get_season_recap", rpc: "get_season_recap", status: 200, file: "recap.json" },
  ], "sti-mocks og RPC-mocks samles i een liste, sti-mocks foerst");
  assert.throws(() => parseArgs(["login", "--mock-rpc=f=x.json"]), /Ukendt flag/);
});

test("mockFor: kun GET, praecis sti (query kun naar mocken selv har en)", () => {
  const mocks = [parseMock("/api/me=status:401"), { path: "/api/races?day=today", rpc: null, status: 200, file: "t.json" }];
  assert.equal(mockFor(mocks, "GET", "https://api.example.org/api/me?x=1").status, 401);
  assert.equal(mockFor(mocks, "POST", "https://api.example.org/api/me"), null, "en mock maa aldrig svare paa en skrivning");
  assert.equal(mockFor(mocks, "GET", "https://api.example.org/api/me/team"), null);
  assert.equal(mockFor(mocks, "GET", "https://api.example.org/api/races?day=today").file, "t.json");
  assert.equal(mockFor(mocks, "GET", "https://api.example.org/api/races?day=tomorrow"), null);
  assert.equal(mockFor([], "GET", "https://api.example.org/api/me"), null);
  assert.equal(mockFor(mocks, "GET", "not a url"), null);
});

test("mockFor: en RPC-mock svarer paa POST (supabase-js .rpc() er altid POST) og GET, kun paa sin egen funktion", () => {
  const mocks = [parseMockRpc("get_season_recap=recap.json"), parseMock("/rest/v1/rpc/get_season_honours=h.json")];
  const rpc = "https://abc.supabase.co/rest/v1/rpc/get_season_recap";
  assert.equal(mockFor(mocks, "POST", rpc).file, "recap.json");
  assert.equal(mockFor(mocks, "post", `${rpc}?select=*`).file, "recap.json", "query ignoreres naar mocken ingen har");
  assert.equal(mockFor(mocks, "GET", rpc).file, "recap.json", ".rpc(fn, args, { get: true }) rammer samme mock");
  assert.equal(mockFor(mocks, "POST", "https://abc.supabase.co/rest/v1/rpc/get_season_recap_v2"), null);
  assert.equal(mockFor(mocks, "POST", "https://abc.supabase.co/rest/v1/get_season_recap"), null, "kun under /rpc/");
  assert.equal(mockFor(mocks, "PATCH", rpc), null, "andre verber er skrivninger og gaar til vagten");
  assert.equal(mockFor(mocks, "POST", "https://abc.supabase.co/rest/v1/rpc/get_season_honours"), null,
    "en almindelig --mock paa rpc-stien matcher stadig kun GET; brug --mock-rpc");
  assert.equal(mockFor(mocks, "GET", "https://abc.supabase.co/rest/v1/rpc/get_season_honours").file, "h.json");
});

test("RPC-mock og skrive-vagt: kaldet ER en skrivning for vagten, saa mocken SKAL registreres efter vagten (sidste route vinder)", () => {
  // Kontrakten CLI'en bygger paa: isWriteRequest aendres ikke; mocken svarer foer vagten ser kaldet.
  assert.equal(isWriteRequest("POST", "https://abc.supabase.co/rest/v1/rpc/get_season_recap"), true);
  const cli = readFileSync(join(REPO_ROOT, "scripts", "pr-shots.mjs"), "utf8");
  const guardAt = cli.indexOf("await installWriteGuard(context");
  const mocksAt = cli.indexOf("await installMocks(context");
  assert.ok(guardAt > 0 && mocksAt > guardAt, "installMocks skal kaldes EFTER installWriteGuard i runShoot");
});

// ── Navne og stier ─────────────────────────────────────────────────────────

test("slugify, routeSlug og shotFileName", () => {
  assert.equal(slugify("feat/5589-today-stages"), "feat-5589-today-stages");
  assert.equal(slugify("Main"), "main");
  assert.equal(routeSlug("/dashboard"), "dashboard");
  assert.equal(routeSlug("/"), "root");
  assert.equal(routeSlug("/team/12?tab=squad#x"), "team-12-tab-squad");
  assert.equal(routeSlug("/Race-Centre/"), "race-centre");
  assert.equal(shotFileName({ route: "/academy", width: 390 }), "academy-390.png");
});

test("masterProfileDir ligger uden for repoet (eet login for alle worktrees)", () => {
  // Absolut sti paa baade Windows og Linux (CI): en "C:\\..."-sti er relativ paa Linux.
  const localAppData = resolve(REPO_ROOT, "..", "AppData-Local");
  const dir = masterProfileDir({ env: { LOCALAPPDATA: localAppData }, homedir: "/home/x" });
  assert.equal(dir, join(localAppData, "cz-pr-shots-profile"));
  assert.equal(isInside(REPO_ROOT, dir), false);
  const fallback = masterProfileDir({ env: {}, homedir: "/home/x" });
  assert.match(fallback, /AppData.Local.cz-pr-shots-profile$/);
  assert.throws(() => masterProfileDir({ env: {}, homedir: "" }), /LOCALAPPDATA/);
});

test("isStaleProfileCopy: kun egne kopier, kun aeldre end en time", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  assert.equal(isStaleProfileCopy("cz-pr-shots-abc123", now - 2 * 3600_000, now), true);
  assert.equal(isStaleProfileCopy("cz-pr-shots-abc123", now - 10 * 60_000, now), false, "en koersel i gang roeres ikke");
  assert.equal(isStaleProfileCopy("playwright-xyz", now - 48 * 3600_000, now), false, "fremmede tmp-mapper roeres aldrig");
});

test("defaultOutRoot: OneDrive-context naar den findes, ellers gitignoreret pr-screens/live", () => {
  const withOneDrive = defaultOutRoot({
    env: { OneDrive: "C:\\Users\\x\\OneDrive" },
    homedir: "C:\\Users\\x",
    repoRoot: "C:\\Dev\\CyclingZone",
    exists: (p) => /CyclingZone-context$/.test(p),
  });
  assert.equal(withOneDrive.private, true);
  assert.match(withOneDrive.dir, /OneDrive.CyclingZone-context.private-handoffs.pr-shots$/);
  const without = defaultOutRoot({ env: {}, homedir: "/home/x", repoRoot: REPO_ROOT, exists: () => false });
  assert.equal(without.private, false);
  assert.equal(without.dir, join(REPO_ROOT, ...FALLBACK_OUT_REL.split("/")));
});

test("fallback-mappen (pr-screens/live) er gitignoreret; pr-screens/ selv er IKKE", () => {
  const gitignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8").split(/\r?\n/);
  assert.ok(gitignore.includes(`${FALLBACK_OUT_REL}/`), `.gitignore skal indeholde '${FALLBACK_OUT_REL}/'`);
});

// ── Plan ───────────────────────────────────────────────────────────────────

test("planShoot: fast origin og port, build-cwd = <worktree>/frontend, bredder yderst, routes inderst", () => {
  const opts = parseArgs(["shoot", "feat/x", "C:\\wt\\feat-x", "/dashboard", "/academy"]);
  const plan = planShoot(opts, { outRoot: "C:\\out" });
  assert.equal(plan.origin, FIXED_ORIGIN);
  assert.equal(plan.origin, "http://localhost:5173");
  assert.equal(plan.port, FIXED_PORT);
  assert.equal(plan.buildCwd, join(resolve("C:\\wt\\feat-x"), "frontend"));
  assert.equal(plan.buildCommand, "npm run build");
  assert.equal(plan.outDir, join("C:\\out", "feat-x"));
  assert.deepEqual(plan.shots.map((s) => `${s.route}@${s.width}`), [
    "/dashboard@1440", "/academy@1440", "/dashboard@390", "/academy@390",
  ]);
  assert.equal(plan.shots[0].url, "http://localhost:5173/dashboard");
  assert.equal(plan.shots[3].file, join("C:\\out", "feat-x", "academy-390.png"));
  assert.equal(planShoot({ ...opts, build: false }, { outRoot: "C:\\out" }).buildCommand, null);
});

test("planShoot: to routes med samme filnavn afvises", () => {
  const opts = parseArgs(["shoot", "l", "wt", "/team/1", "/team-1"]);
  assert.throws(() => planShoot(opts, { outRoot: "o" }), /samme filnavn/);
});

test("formatPlan: viser mocks, klik og advarsel om fallback; ingen em-dash", () => {
  const opts = parseArgs(["shoot", "l", "wt", "/x", "--click=Taktik", "--mock=/api/me=status:401", "--mock-rpc=get_season_recap=r.json", "--wait-for=[data-testid=a]"]);
  const plan = planShoot(opts, { outRoot: "o" });
  const text = formatPlan(opts, plan, { profileDir: "P", outPrivate: false });
  assert.match(text, /origin: http:\/\/localhost:5173/);
  assert.match(text, /MOCK GET \/api\/me -> status 401/);
  assert.match(text, /MOCK RPC get_season_recap \(POST \/rest\/v1\/rpc\/get_season_recap\) -> r\.json/);
  assert.match(text, /klik: tekst 'Taktik'/);
  assert.match(text, /vent paa: \[data-testid=a\]/);
  assert.match(text, /ADVARSEL/);
  assert.doesNotMatch(text, /\u2014/, "ingen em-dash i output");
});

// ── Statisk server ─────────────────────────────────────────────────────────

test("resolveStaticFile: fil foerst, prerendrede ruter, SPA-fallback til app.html (ikke den prerendrede forside)", () => {
  const dist = resolve("C:\\wt\\frontend\\dist");
  const files = new Set([
    join(dist, "index.html"),
    join(dist, "app.html"),
    join(dist, "assets", "main-abc.js"),
    join(dist, "privacy", "index.html"),
  ]);
  const isFile = (p) => files.has(p);
  assert.equal(resolveStaticFile(dist, "/", isFile), join(dist, "index.html"));
  assert.equal(resolveStaticFile(dist, "/assets/main-abc.js?v=1", isFile), join(dist, "assets", "main-abc.js"));
  assert.equal(resolveStaticFile(dist, "/privacy", isFile), join(dist, "privacy", "index.html"));
  assert.equal(resolveStaticFile(dist, "/dashboard", isFile), join(dist, "app.html"), "app-ruter faar app.html (#5494)");
  assert.equal(resolveStaticFile(dist, "/team/12?tab=a", isFile), join(dist, "app.html"));
  assert.equal(resolveStaticFile(dist, "/assets/missing.js", isFile), null, "manglende asset = 404, ikke HTML");
  assert.equal(resolveStaticFile(dist, "/../../secret.txt", isFile), null, "aldrig uden for dist");
  assert.equal(resolveStaticFile(dist, "/%2e%2e/%2e%2e/secret", isFile), null);
  assert.equal(resolveStaticFile(dist, "/%E0%A4%A", isFile), null, "ugyldig URI-kodning");
  assert.equal(contentTypeFor("x/app.html"), "text/html; charset=utf-8");
  assert.equal(contentTypeFor("main.JS"), "text/javascript; charset=utf-8");
  assert.equal(contentTypeFor("font.woff2"), "font/woff2");
  assert.equal(contentTypeFor("blob"), "application/octet-stream");
});

// ── Skrive-vagt og login-probe ─────────────────────────────────────────────

test("isWriteRequest: alle skrivninger blokeres, ogsaa telemetri; kun /auth/v1/token slipper igennem", () => {
  assert.equal(isWriteRequest("POST", "https://x.supabase.co/rest/v1/riders"), true);
  assert.equal(isWriteRequest("PATCH", "https://x.supabase.co/rest/v1/riders?id=eq.1"), true);
  assert.equal(isWriteRequest("POST", "https://x.supabase.co/rest/v1/rpc/do_thing"), true);
  assert.equal(isWriteRequest("DELETE", "https://api.cyclingzone.org/api/training/plan"), true);
  assert.equal(isWriteRequest("PUT", "http://localhost:5173/ingest/e"), true, "samme origin er ingen undtagelse");
  assert.equal(isWriteRequest("POST", "https://eu.i.posthog.com/e/?ip=1"), true, "billedkoersler taeller ikke som spillere");
  assert.equal(isWriteRequest("POST", "https://o123.ingest.sentry.io/api/1/envelope/"), true);
  assert.equal(isWriteRequest("POST", "https://x.supabase.co/auth/v1/logout?scope=global"), true, "signOut er ogsaa en skrivning");
  assert.equal(isWriteRequest("POST", "https://x.supabase.co/auth/v1/token?grant_type=refresh_token"), false, "refresh holder sessionen i live");
  assert.equal(isWriteRequest("GET", "https://x.supabase.co/rest/v1/riders"), false);
  assert.equal(isWriteRequest("get", "https://api.cyclingzone.org/api/me"), false);
  assert.equal(isWriteRequest("OPTIONS", "https://api.cyclingzone.org/api/me"), false);
});

test("isSignOutRequest, isLoginPath, isAuthFailure og describeRequest", () => {
  assert.equal(isSignOutRequest("https://x.supabase.co/auth/v1/logout?scope=global"), true);
  assert.equal(isSignOutRequest("https://x.supabase.co/auth/v1/token?grant_type=password"), false);
  assert.equal(isLoginPath("http://localhost:5173/login"), true);
  assert.equal(isLoginPath("http://localhost:5173/login/"), true);
  assert.equal(isLoginPath("http://localhost:5173/dashboard"), false);
  assert.equal(isAuthFailure(401, "https://api.example.org/api/me"), true);
  assert.equal(isAuthFailure(401, "https://x.supabase.co/auth/v1/user"), true);
  assert.equal(isAuthFailure(403, "https://api.example.org/api/admin"), false);
  assert.equal(isAuthFailure(401, "https://eu.i.posthog.com/decide"), false);
  assert.equal(describeRequest("post", "https://x.supabase.co/rest/v1/rpc/f?id=eq.1&token=abc"), "POST https://x.supabase.co/rest/v1/rpc/f", "aldrig query i rapporten");
});

test("probeVerdict: login-side eller 401 = ikke logget ind", () => {
  assert.deepEqual(probeVerdict({ finalUrl: "http://localhost:5173/dashboard" }), { ok: true, reason: "logget ind" });
  assert.equal(probeVerdict({ finalUrl: "http://localhost:5173/login" }).ok, false);
  const dead = probeVerdict({ finalUrl: "http://localhost:5173/dashboard", authFailures: ["GET https://api.example.org/api/me"] });
  assert.equal(dead.ok, false);
  assert.match(dead.reason, /401 fra GET/);
});

// ── Compose ────────────────────────────────────────────────────────────────

test("pairShots: een raekke pr. route x bredde; mangler paa en side = null", () => {
  const before = { shots: [{ route: "/a", width: 1440, file: "b-a-1440" }, { route: "/old", width: 1440, file: "b-old" }] };
  const after = { shots: [{ route: "/a", width: 1440, file: "a-a-1440" }, { route: "/a", width: 390, file: "a-a-390" }] };
  assert.deepEqual(pairShots(before, after), [
    { route: "/a", width: 1440, before: "b-a-1440", after: "a-a-1440" },
    { route: "/a", width: 390, before: null, after: "a-a-390" },
    { route: "/old", width: 1440, before: "b-old", after: null },
  ]);
});

test("composeHtml: to kolonner, een raekke pr. route, mobil 50 %, mocks markeret, HTML escapet, ingen em-dash", () => {
  const html = composeHtml({
    before: "main",
    after: "feat-x",
    rows: [
      { route: "/dashboard", width: 1440, beforeSrc: "data:image/png;base64,AA", afterSrc: "data:image/png;base64,BB" },
      { route: "/dashboard", width: 390, beforeSrc: null, afterSrc: "data:image/png;base64,CC" },
      { route: "/<script>", width: 1440, beforeSrc: null, afterSrc: null },
    ],
    mocks: ["feat-x: /api/me"],
  });
  assert.match(html, /Foer: main/);
  assert.match(html, /Efter: feat-x/);
  assert.equal((html.match(/<section>/g) ?? []).length, 3);
  assert.match(html, /base64,CC" style="width:50%"/);
  assert.match(html, /base64,AA" style="width:100%"/);
  assert.match(html, /mangler/);
  assert.match(html, /MOCK \(ikke prod-tilstand\): feat-x: \/api\/me/);
  assert.doesNotMatch(html, /<script>/, "route-tekst escapes");
  assert.doesNotMatch(html, /\u2014/);
});

// ── Preview-link (valgfrit, --pr) ──────────────────────────────────────────

test("pickPreviewUrl: deployment-status foerst, branch-alias foretraekkes, kun *.vercel.app", () => {
  const picked = pickPreviewUrl({
    deploymentStatuses: [
      { state: "pending", environment_url: "https://cycling-zone-abc123-team.vercel.app" },
      { state: "success", environment_url: "https://cycling-zone-abc123-team.vercel.app" },
      { state: "success", environment_url: "https://cycling-zone-git-feat-x-team.vercel.app" },
    ],
    statusCheckRollup: [{ context: "Vercel", targetUrl: "https://vercel.com/team/cycling-zone/abc" }],
  });
  assert.deepEqual(picked, { url: "https://cycling-zone-git-feat-x-team.vercel.app", source: "deployment-status" });
});

test("pickPreviewUrl: status-check kraever success, Vercel-kommentaren er sidste udvej med advarsel; ingen kilde = null", () => {
  const fromComment = pickPreviewUrl({
    comments: [
      { author: { login: "NicolaiDolmer" }, body: "https://not-a-bot.vercel.app" },
      { author: { login: "vercel[bot]" }, body: "**Preview:** [https://cycling-zone-xyz-team.vercel.app](https://cycling-zone-xyz-team.vercel.app)\n" },
    ],
  });
  assert.equal(fromComment.url, "https://cycling-zone-xyz-team.vercel.app");
  assert.equal(fromComment.source, "vercel-comment");
  assert.match(fromComment.warning, /sidste udvej/i);

  const fromStatusState = pickPreviewUrl({
    statusCheckRollup: [{ context: "Vercel", state: "success", targetUrl: "https://cycling-zone-q1w2-team.vercel.app/dashboard" }],
  });
  assert.deepEqual(fromStatusState, { url: "https://cycling-zone-q1w2-team.vercel.app", source: "status-check" });

  const pendingOnly = pickPreviewUrl({
    statusCheckRollup: [{ context: "Vercel", state: "pending", targetUrl: "https://cycling-zone-pending-team.vercel.app" }],
  });
  assert.equal(pendingOnly, null, "en status-check uden bekraeftet success maa ikke give en preview-URL");
  assert.equal(pickPreviewUrl({}), null);
});

test("lookupPreviewUrl: gh-kaldene i raekkefoelge (pr view -> deployments -> statuses), uden net", () => {
  const calls = [];
  const runGh = (args) => {
    calls.push(args.join(" "));
    if (args[0] === "pr") return JSON.stringify({ headRefOid: "abcdef1234567890", statusCheckRollup: [], comments: [] });
    if (args[1].startsWith("repos/NicolaiDolmer/CyclingZone/deployments?sha=abcdef1234567890")) {
      return JSON.stringify([{ id: 9, environment: "Production" }, { id: 7, environment: "Preview" }]);
    }
    if (args[1] === "repos/NicolaiDolmer/CyclingZone/deployments/7/statuses?per_page=10") {
      return JSON.stringify([{ state: "success", environment_url: "https://cycling-zone-git-feat-team.vercel.app" }]);
    }
    throw new Error(`uventet gh-kald: ${args.join(" ")}`);
  };
  const out = lookupPreviewUrl({ repo: "NicolaiDolmer/CyclingZone", pr: 5589, runGh });
  assert.equal(out.url, "https://cycling-zone-git-feat-team.vercel.app");
  assert.equal(out.headSha, "abcdef1234567890");
  assert.equal(calls.length, 3, "Production-deploymentet slaas ikke op");

  const none = (args) => {
    if (args[0] === "pr") return JSON.stringify({ headRefOid: "0123456789abcdef", statusCheckRollup: [], comments: [] });
    throw new Error("gh api 404");
  };
  assert.throws(() => lookupPreviewUrl({ repo: "o/r", pr: 1, runGh: none }), /ingen Vercel-preview fundet for 0123456/);
});

// ── CLI: kildetekst-vagt og dry-run ────────────────────────────────────────

test("CLI'en laeser aldrig tokens, cookies eller storage og skruer aldrig uret (kildetekst-vagt)", () => {
  const cli = readFileSync(join(REPO_ROOT, "scripts", "pr-shots.mjs"), "utf8");
  for (const forbidden of [
    "localStorage", "sessionStorage", "cookies(", "storageState", "clock.install", "addInitScript",
    "auth-token", "page.evaluate", "evaluateHandle", "Date.now = ",
  ]) {
    assert.ok(!cli.includes(forbidden), `scripts/pr-shots.mjs maa ikke indeholde '${forbidden}'`);
  }
  assert.ok(cli.includes('serviceWorkers: "block"'), "service workers skal blokeres, saa intet kald gaar uden om vagten");
});

test("dry-run: shoot printer planen (inkl. RPC-mock) og starter hverken build eller browser", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cz-pr-shots-test-"));
  const recap = join(tmp, "recap.json");
  writeFileSync(recap, '{"season_id": 1, "champion": "Testhold"}');
  try {
    const res = spawnSync(process.execPath, [
      join(REPO_ROOT, "scripts", "pr-shots.mjs"), "shoot", "x", REPO_ROOT, "/dashboard", "--dry-run",
      `--mock-rpc=get_season_recap=${recap}`, "--out", join(REPO_ROOT, "pr-screens", "live"),
    ], { encoding: "utf8", timeout: 30_000 });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /origin: http:\/\/localhost:5173/);
    assert.match(res.stdout, /dashboard-1440\.png/);
    assert.match(res.stdout, /dashboard-390\.png/);
    assert.match(res.stdout, /MOCK RPC get_season_recap/);
    assert.match(res.stdout, /ingen browser startet, ingen build/);
    const missing = spawnSync(process.execPath, [
      join(REPO_ROOT, "scripts", "pr-shots.mjs"), "shoot", "x", REPO_ROOT, "/dashboard", "--dry-run",
      "--mock-rpc=get_season_recap=findes-ikke.json", "--out", join(REPO_ROOT, "pr-screens", "live"),
    ], { encoding: "utf8", timeout: 30_000 });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /mock-filen findes ikke/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("dry-run: login og compose, og den gamle --pr-form giver en tydelig fejl", () => {
  const cli = join(REPO_ROOT, "scripts", "pr-shots.mjs");
  const login = spawnSync(process.execPath, [cli, "login", "--dry-run"], { encoding: "utf8", timeout: 30_000 });
  assert.equal(login.status, 0, login.stderr);
  assert.match(login.stdout, /cz-pr-shots-profile/);
  const compose = spawnSync(process.execPath, [cli, "compose", "x", "--dry-run", "--out", "o"], { encoding: "utf8", timeout: 30_000 });
  assert.equal(compose.status, 0, compose.stderr);
  assert.match(compose.stdout, /before-after\.png/);
  const old = spawnSync(process.execPath, [cli, "--pr", "5589"], { encoding: "utf8", timeout: 30_000 });
  assert.equal(old.status, 1);
  assert.match(old.stderr, /kommandoer nu/);
});
