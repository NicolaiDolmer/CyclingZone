// #5565 · Tests for billedstationens rene dele. Ingen browser, ingen gh, ingen net.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_OUT_DIR,
  FAKE_CLOCK_FLAGS,
  PROFILE_DIR_REL,
  buildPlan,
  formatPlan,
  isLoginPath,
  isSignOutRequest,
  isWriteRequest,
  lookupPreviewUrl,
  parseArgs,
  pickPreviewUrl,
  routeSlug,
  shotFileName,
} from "./prShots.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── Argument-parsing ───────────────────────────────────────────────────────

test("parseArgs: den kanoniske kommando fra issuet", () => {
  const opts = parseArgs(["--pr", "5589", "--routes", "/dashboard,/academy", "--viewports", "1440,390"]);
  assert.equal(opts.pr, 5589);
  assert.deepEqual(opts.routes, ["/dashboard", "/academy"]);
  assert.deepEqual(opts.viewports, [1440, 390]);
  assert.equal(opts.dryRun, false);
  assert.equal(opts.login, false);
  assert.equal(opts.out, "pr-screens/live");
  assert.equal(opts.channel, "msedge");
});

test("parseArgs: defaults, --flag=value-form, --login/--dry-run, --url normaliseres til origin", () => {
  const opts = parseArgs(["--pr=12", "--login", "--dry-run", "--url=https://cycling-zone-git-x-team.vercel.app/dashboard?x=1"]);
  assert.deepEqual(opts.routes, ["/dashboard"]);
  assert.deepEqual(opts.viewports, [1440, 390]);
  assert.equal(opts.login, true);
  assert.equal(opts.dryRun, true);
  assert.equal(opts.url, "https://cycling-zone-git-x-team.vercel.app");
});

test("parseArgs: --pr er paakraevet, ukendte flag og daarlige vaerdier afvises", () => {
  assert.throws(() => parseArgs([]), /--pr/);
  assert.throws(() => parseArgs(["--pr", "x"]), /positivt PR-nummer/);
  assert.throws(() => parseArgs(["--pr", "1", "--bogus"]), /Ukendt flag/);
  assert.throws(() => parseArgs(["--pr", "1", "--routes", "dashboard"]), /starte med/);
  assert.throws(() => parseArgs(["--pr", "1", "--viewports", "1440,abc"]), /helt tal/);
  assert.throws(() => parseArgs(["--pr", "1", "--viewports", "100"]), /mellem 320 og 4000/);
  assert.throws(() => parseArgs(["--pr", "1", "--url", "http://evil.example.com"]), /https/);
  assert.throws(() => parseArgs(["--pr"]), /mangler en vaerdi/);
});

test("parseArgs: et falsk ur afvises altid med henvisning til laeringen (24/9)", () => {
  for (const flag of FAKE_CLOCK_FLAGS) {
    assert.throws(
      () => parseArgs(["--pr", "1", flag, "2026-09-23T21:30"]),
      /2026-09-24-pr-shots-fake-clock-logout/,
      flag,
    );
    assert.throws(() => parseArgs(["--pr", "1", `${flag}=2026-09-23`]), /falsk browser-ur/, `${flag}=`);
  }
});

// ── Filnavne ───────────────────────────────────────────────────────────────

test("routeSlug + shotFileName: <pr>-<route>-<viewport>.png", () => {
  assert.equal(routeSlug("/dashboard"), "dashboard");
  assert.equal(routeSlug("/"), "root");
  assert.equal(routeSlug("/team/12?tab=squad#x"), "team-12");
  assert.equal(routeSlug("/Race-Centre/"), "race-centre");
  assert.equal(shotFileName({ pr: 5589, route: "/dashboard", viewport: 1440 }), "5589-dashboard-1440.png");
  assert.equal(shotFileName({ pr: 5589, route: "/academy", viewport: 390 }), "5589-academy-390.png");
});

test("buildPlan: deterministisk raekkefoelge (viewport yderst, route inderst), fulde URL'er", () => {
  const opts = parseArgs(["--pr", "7", "--routes", "/dashboard,/academy", "--viewports", "1440,390"]);
  const plan = buildPlan(opts, "https://p.vercel.app");
  assert.deepEqual(plan.map((s) => s.file), [
    "pr-screens/live/7-dashboard-1440.png",
    "pr-screens/live/7-academy-1440.png",
    "pr-screens/live/7-dashboard-390.png",
    "pr-screens/live/7-academy-390.png",
  ]);
  assert.equal(plan[0].url, "https://p.vercel.app/dashboard");
  const text = formatPlan(opts, "https://p.vercel.app", plan);
  assert.match(text, /PR #7/);
  assert.match(text, /7-academy-390\.png/);
  assert.doesNotMatch(text, /—/, "ingen em-dash i output");
});

// ── Preview-URL ────────────────────────────────────────────────────────────

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
  assert.match(fromComment.warning, /sidste udvej/i, "kommentar-kilden skal give en advarsel til opkalderen");

  const fromStatusState = pickPreviewUrl({
    statusCheckRollup: [{ context: "Vercel", state: "success", targetUrl: "https://cycling-zone-q1w2-team.vercel.app/dashboard" }],
  });
  assert.deepEqual(fromStatusState, { url: "https://cycling-zone-q1w2-team.vercel.app", source: "status-check" });

  const fromStatusConclusion = pickPreviewUrl({
    statusCheckRollup: [{ name: "Vercel", conclusion: "success", detailsUrl: "https://cycling-zone-abcd-team.vercel.app" }],
  });
  assert.equal(fromStatusConclusion.url, "https://cycling-zone-abcd-team.vercel.app");
  assert.equal(fromStatusConclusion.source, "status-check");

  assert.equal(pickPreviewUrl({}), null);
  assert.equal(pickPreviewUrl({ statusCheckRollup: [{ context: "Vercel", targetUrl: "https://vercel.com/x/y" }] }), null);
});

test("pickPreviewUrl: statusCheckRollup uden bekraeftet success ignoreres og falder tilbage til kommentaren", () => {
  const pendingOnly = pickPreviewUrl({
    statusCheckRollup: [{ context: "Vercel", state: "pending", targetUrl: "https://cycling-zone-pending-team.vercel.app" }],
  });
  assert.equal(pendingOnly, null, "en status-check uden bekraeftet success maa ikke give en preview-URL");

  const fallsBackToComment = pickPreviewUrl({
    statusCheckRollup: [{ context: "Vercel", state: "pending", targetUrl: "https://cycling-zone-pending-team.vercel.app" }],
    comments: [{ author: { login: "vercel[bot]" }, body: "https://cycling-zone-comment-team.vercel.app" }],
  });
  assert.equal(fallsBackToComment.url, "https://cycling-zone-comment-team.vercel.app");
  assert.equal(fallsBackToComment.source, "vercel-comment");
  assert.ok(fallsBackToComment.warning, "sidste-udvej-kilden skal give en advarsel");
});

test("lookupPreviewUrl: gh-kaldene i raekkefoelge (pr view -> deployments -> statuses), uden net", () => {
  const calls = [];
  const runGh = (args) => {
    calls.push(args.join(" "));
    if (args[0] === "pr") return JSON.stringify({ headRefOid: "abcdef1234567890", statusCheckRollup: [], comments: [] });
    if (args[1].startsWith("repos/NicolaiDolmer/CyclingZone/deployments?sha=abcdef1234567890")) {
      return JSON.stringify([
        { id: 9, environment: "Production" },
        { id: 7, environment: "Preview" },
      ]);
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
  assert.match(calls[0], /^pr view 5589 --repo NicolaiDolmer\/CyclingZone --json headRefOid,statusCheckRollup,comments$/);
});

test("lookupPreviewUrl: ingen preview = tydelig fejl med --url som udvej; fejlet deployments-kald er ikke fatalt", () => {
  const runGh = (args) => {
    if (args[0] === "pr") return JSON.stringify({ headRefOid: "0123456789abcdef", statusCheckRollup: [], comments: [] });
    throw new Error("gh api 404");
  };
  assert.throws(() => lookupPreviewUrl({ repo: "o/r", pr: 1, runGh }), /ingen Vercel-preview fundet for 0123456.*--url/);
});

// ── Skrive-vagt og login-probe ─────────────────────────────────────────────

test("isWriteRequest: alle skrivninger blokeres, ogsaa telemetri; kun /auth/v1/token slipper igennem", () => {
  assert.equal(isWriteRequest("POST", "https://x.supabase.co/rest/v1/riders"), true);
  assert.equal(isWriteRequest("PATCH", "https://x.supabase.co/rest/v1/riders?id=eq.1"), true);
  assert.equal(isWriteRequest("POST", "https://x.supabase.co/rest/v1/rpc/do_thing"), true);
  assert.equal(isWriteRequest("DELETE", "https://api.cyclingzone.org/api/training/plan"), true);
  assert.equal(isWriteRequest("POST", "https://eu.i.posthog.com/e/?ip=1"), true, "billedkoersler taeller ikke som spillere");
  assert.equal(isWriteRequest("POST", "https://o123.ingest.sentry.io/api/1/envelope/"), true);
  assert.equal(isWriteRequest("POST", "https://x.supabase.co/auth/v1/logout?scope=global"), true, "signOut er ogsaa en skrivning");
  assert.equal(isWriteRequest("POST", "https://x.supabase.co/auth/v1/token?grant_type=refresh_token"), false, "refresh holder sessionen i live");
  assert.equal(isWriteRequest("GET", "https://x.supabase.co/rest/v1/riders"), false);
  assert.equal(isWriteRequest("get", "https://api.cyclingzone.org/api/me"), false);
  assert.equal(isWriteRequest("OPTIONS", "https://api.cyclingzone.org/api/me"), false);
});

test("isSignOutRequest og isLoginPath", () => {
  assert.equal(isSignOutRequest("https://x.supabase.co/auth/v1/logout?scope=global"), true);
  assert.equal(isSignOutRequest("https://x.supabase.co/auth/v1/token?grant_type=password"), false);
  assert.equal(isLoginPath("https://p.vercel.app/login"), true);
  assert.equal(isLoginPath("https://p.vercel.app/login/"), true);
  assert.equal(isLoginPath("https://p.vercel.app/dashboard"), false);
});

// ── Profilen maa aldrig committes ──────────────────────────────────────────

test("profil-mappen ligger under en gitignoreret sti", () => {
  const gitignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8").split(/\r?\n/);
  const parent = PROFILE_DIR_REL.split("/").slice(0, 2).join("/") + "/";
  assert.ok(gitignore.includes(parent), `.gitignore skal indeholde '${parent}' (profilen: ${PROFILE_DIR_REL})`);
});

test("DEFAULT_OUT_DIR ligger under en gitignoreret sti (pr-screens/ selv er IKKE gitignoreret)", () => {
  const gitignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8").split(/\r?\n/);
  const ignoredDir = `${DEFAULT_OUT_DIR}/`;
  assert.ok(
    gitignore.includes(ignoredDir),
    `.gitignore skal indeholde '${ignoredDir}': aegte spillerdata i DEFAULT_OUT_DIR ('${DEFAULT_OUT_DIR}') maa aldrig kunne committes ved et rutine-'git add'.`,
  );
});

test("CLI'en laeser aldrig tokens eller cookies og skruer aldrig uret (kildetekst-vagt)", () => {
  const cli = readFileSync(join(REPO_ROOT, "scripts", "pr-shots.mjs"), "utf8");
  for (const forbidden of ["localStorage", "cookies(", "storageState", "clock.install", "addInitScript", "auth-token"]) {
    assert.ok(!cli.includes(forbidden), `scripts/pr-shots.mjs maa ikke indeholde '${forbidden}'`);
  }
});
