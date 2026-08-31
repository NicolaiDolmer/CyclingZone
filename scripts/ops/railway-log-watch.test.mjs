// scripts/ops/railway-log-watch.test.mjs
// Regression tests for the pure classification logic + the tag-coverage guard (#4453).
// Run: node --test scripts/ops/railway-log-watch.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  aggregate,
  classifyLine,
  computeFindings,
  loadThresholds,
  normalizeBucket,
  selectDeployments,
  selectDeploymentsDetailed,
  shellQuote,
  tagTotals,
  UNTAGGED,
  windowCoverageError,
} from "./railway-log-watch.mjs";
import { collectRuntimeTags, REPO_ROOT, RUNTIME_PATHS } from "./railway-log-tags.mjs";

// ── classifyLine ────────────────────────────────────────────────────────────

test("classifies a tagged line by its [tag] prefix regardless of Railway's level field", () => {
  // Verified against prod 30/8: console.warn("[shutdown] ...") comes back as level=info,
  // so the level field alone cannot be trusted to find warnings.
  const hit = classifyLine({ message: "[auth] 401 invalid_token GET /api/teams (jwt expired)", level: "info" });
  assert.equal(hit.tag, "auth");
  assert.match(hit.bucket, /^401 invalid_token/);
});

test("keeps 401 and 503 in separate buckets (the whole point of #4165 vs #4369)", () => {
  const a = classifyLine({ message: "[auth] 401 invalid_token GET /api/teams (bad_jwt)", level: "info" });
  const b = classifyLine({ message: "[auth] 503 auth_unavailable GET /api/teams (upstream)", level: "info" });
  assert.notEqual(a.bucket, b.bucket);
});

test("collapses variable ids and timestamps so repeats of one error share a bucket", () => {
  const a = classifyLine({ message: "[forum] failed for dd65bebe-8d25-4d2d-9d5f-e8fdcb780197", level: "error" });
  const b = classifyLine({ message: "[forum] failed for 11111111-2222-3333-4444-555555555555", level: "error" });
  assert.equal(a.bucket, b.bucket);
});

test("counts an untagged error line, but not an untagged info line", () => {
  const err = classifyLine({ message: "graduation sweep failed (abc): not_pending", level: "error" });
  assert.equal(err.tag, UNTAGGED);
  assert.equal(classifyLine({ message: "value-refresh: 7551 scannet", level: "info" }), null);
});

test("drops object-continuation lines from console.error(tag, obj) instead of bucketing them as untagged", () => {
  assert.equal(classifyLine({ message: "  teamId: 'c3d2ad8e', ", level: "error" }), null);
  assert.equal(classifyLine({ message: "}", level: "error" }), null);
  assert.equal(classifyLine({ message: "   ", level: "error" }), null);
});

test("normalizeBucket keeps 3-digit status codes but masks longer numbers", () => {
  assert.equal(normalizeBucket("429 api-baseline POST /api/bids"), "429 api-baseline POST /api/bids");
  assert.equal(normalizeBucket("batch 123456 failed"), "batch <n> failed");
});

// ── aggregate ───────────────────────────────────────────────────────────────

test("aggregates identical signals into one row with a count", () => {
  const rows = aggregate([
    { message: "[rate-limit] 429 api-baseline GET /api/teams", level: "info" },
    { message: "[rate-limit] 429 api-baseline GET /api/teams", level: "info" },
    { message: "[alunta-webhook] signature mismatch", level: "error" },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].cnt, 2);
  assert.equal(rows[0].tag, "rate-limit");
});

// ── computeFindings ─────────────────────────────────────────────────────────

const CONFIG = {
  default: 25,
  newClassThreshold: 5,
  growthMultiplier: 3,
  growthMinimum: 100,
  tags: { auth: 300, "alunta-webhook": 1 },
  ignore: ["shutdown"],
};

test("no findings when everything is below its per-tag threshold", () => {
  const current = [{ tag: "auth", bucket: "401 invalid_token", cnt: 120 }];
  const previous = [{ tag: "auth", bucket: "401 invalid_token", cnt: 110 }];
  const result = computeFindings(current, previous, CONFIG);
  assert.equal(result.hasFindings, false);
});

test("a zero-tolerance tag fires on a single occurrence", () => {
  const current = [{ tag: "alunta-webhook", bucket: "signature mismatch", cnt: 1 }];
  const result = computeFindings(current, [{ tag: "alunta-webhook", bucket: "signature mismatch", cnt: 1 }], CONFIG);
  assert.equal(result.spikes.length, 1);
  assert.equal(result.spikes[0].threshold, 1);
});

test("per-tag threshold beats the default: 120 auth-lines are quiet, 120 forum-lines are not", () => {
  const auth = computeFindings([{ tag: "auth", bucket: "401", cnt: 120 }], [], CONFIG);
  const forum = computeFindings([{ tag: "forum", bucket: "insert failed", cnt: 120 }], [], CONFIG);
  assert.equal(auth.spikes.length, 0);
  assert.equal(forum.spikes.length, 1);
  assert.equal(forum.spikes[0].threshold, 25);
});

test("ignored tags never produce findings, no matter the volume", () => {
  const result = computeFindings([{ tag: "shutdown", bucket: "SIGTERM received", cnt: 5000 }], [], CONFIG);
  assert.equal(result.hasFindings, false);
});

test("flags a bucket absent from the previous window as a new error class", () => {
  const result = computeFindings([{ tag: "presence", bucket: "upsert failed", cnt: 7 }], [], CONFIG);
  assert.equal(result.newClasses.length, 1);
  assert.equal(result.hasFindings, true);
});

test("does not flag a new-looking bucket below newClassThreshold (avoids one-off noise)", () => {
  const result = computeFindings([{ tag: "presence", bucket: "upsert failed", cnt: 2 }], [], CONFIG);
  assert.equal(result.hasFindings, false);
});

test("carries yesterday's count on a spike so the report can answer 'is it rising?'", () => {
  const current = [{ tag: "auth", bucket: "401 invalid_token", cnt: 900 }];
  const previous = [{ tag: "auth", bucket: "401 invalid_token", cnt: 400 }];
  const result = computeFindings(current, previous, CONFIG);
  assert.equal(result.spikes[0].previousCnt, 400);
});

test("keys new-class detection on (tag, bucket), not bucket alone", () => {
  const current = [{ tag: "forum", bucket: "timeout", cnt: 9 }];
  const previous = [{ tag: "presence", bucket: "timeout", cnt: 9 }];
  const result = computeFindings(current, previous, CONFIG);
  assert.equal(result.newClasses.length, 1);
  assert.equal(result.newClasses[0].tag, "forum");
});

test("catches a wide outage that keeps every single bucket under its threshold", () => {
  // Review af PR #4469: normalizeBucket beholder request-stien, saa et auth-udfald
  // der rammer 30 ruter med 250 linjer hver giver 7.500 [auth]-linjer og NUL
  // taerskel-brud under den rene per-spand-regel. Vaekstreglen paa tag-totalen
  // er det led der fanger den.
  const current = Array.from({ length: 30 }, (_, i) => ({ tag: "auth", bucket: `401 invalid_token GET /api/r${i}`, cnt: 250 }));
  const previous = Array.from({ length: 30 }, (_, i) => ({ tag: "auth", bucket: `401 invalid_token GET /api/r${i}`, cnt: 20 }));
  const result = computeFindings(current, previous, CONFIG);
  assert.equal(result.spikes.length, 0, "ingen enkelt spand naar 300 - det er hele pointen");
  assert.equal(result.growth.length, 1);
  assert.equal(result.growth[0].cnt, 7500);
  assert.equal(result.growth[0].previousCnt, 600);
  assert.equal(result.hasFindings, true);
});

test("growth rule stays quiet on normal day-to-day drift", () => {
  const current = [{ tag: "auth", bucket: "401", cnt: 700 }];
  const previous = [{ tag: "auth", bucket: "401", cnt: 650 }];
  assert.equal(computeFindings(current, previous, CONFIG).growth.length, 0);
});

test("growth rule respects the volume floor so a 2 -> 20 tag stays quiet", () => {
  const result = computeFindings([{ tag: "forum", bucket: "timeout", cnt: 20 }], [{ tag: "forum", bucket: "timeout", cnt: 2 }], CONFIG);
  assert.equal(result.growth.length, 0);
});

test("growth rule never fires on an ignored tag", () => {
  const result = computeFindings([{ tag: "shutdown", bucket: "SIGTERM", cnt: 9000 }], [{ tag: "shutdown", bucket: "SIGTERM", cnt: 10 }], CONFIG);
  assert.equal(result.growth.length, 0);
  assert.equal(result.hasFindings, false);
});

// ── tagTotals ───────────────────────────────────────────────────────────────

test("tagTotals answers the acceptance question in #4453: volume per tag, this window vs the last", () => {
  const totals = tagTotals(
    [{ tag: "auth", bucket: "401", cnt: 700 }, { tag: "auth", bucket: "503", cnt: 12 }],
    [{ tag: "auth", bucket: "401", cnt: 500 }],
  );
  assert.equal(totals.length, 1);
  assert.equal(totals[0].cnt, 712);
  assert.equal(totals[0].previousCnt, 500);
});

// ── selectDeployments ───────────────────────────────────────────────────────

const DEPLOYMENTS = [
  { id: "d3", createdAt: "2026-08-30T20:20:00.000Z" },
  { id: "d2", createdAt: "2026-08-30T18:00:00.000Z" },
  { id: "d1", createdAt: "2026-08-29T10:00:00.000Z" },
  { id: "d0", createdAt: "2026-08-20T10:00:00.000Z" },
];

test("selects every deployment whose run overlaps the window, not just the newest", () => {
  // Railway's CLI scopes logs to a deployment, so a 24h window that spans three
  // deploys needs all three - this is what made the naive one-deployment version
  // return 45 lines for a whole day.
  const ids = selectDeployments(DEPLOYMENTS, "2026-08-30T00:00:00.000Z", "2026-08-30T21:00:00.000Z");
  assert.deepEqual(ids, ["d3", "d2", "d1"]);
});

test("excludes deployments that ended before the window started", () => {
  const ids = selectDeployments(DEPLOYMENTS, "2026-08-30T19:00:00.000Z", "2026-08-30T21:00:00.000Z");
  assert.deepEqual(ids, ["d3", "d2"]);
});

test("excludes deployments created after the window ended", () => {
  // d3 (20:20) og d2 (18:00) er begge oprettet efter vinduets slut. d1 koerte
  // gennem hele vinduet, og d0 koerte indtil d1 startede kl. 10 den 29. - begge
  // overlapper og skal med.
  const ids = selectDeployments(DEPLOYMENTS, "2026-08-29T00:00:00.000Z", "2026-08-30T12:00:00.000Z");
  assert.deepEqual(ids, ["d1", "d0"]);
});

test("respects the max-deployments cap and keeps the newest ones", () => {
  const ids = selectDeployments(DEPLOYMENTS, "2026-08-01T00:00:00.000Z", "2026-08-31T00:00:00.000Z", 2);
  assert.deepEqual(ids, ["d3", "d2"]);
});

test("SIGNALS truncation instead of silently dropping the oldest hours of the window", () => {
  // Listen er nyest-foerst, saa loftet skaerer de AELDSTE timer vaek. En
  // undertaelling der lander under alle taerskler ser ud som et sundt doegn -
  // derfor skal afkortningen ud af scriptet og videre til Actions-outputtet.
  const capped = selectDeploymentsDetailed(DEPLOYMENTS, "2026-08-01T00:00:00.000Z", "2026-08-31T00:00:00.000Z", 2);
  assert.equal(capped.truncated, true);
  assert.equal(capped.overlapping, 4);
  assert.equal(capped.ids.length, 2);

  const full = selectDeploymentsDetailed(DEPLOYMENTS, "2026-08-01T00:00:00.000Z", "2026-08-31T00:00:00.000Z", 50);
  assert.equal(full.truncated, false);
  assert.equal(full.ids.length, 4);
});

test("ignores rows with an unparseable createdAt instead of throwing", () => {
  const ids = selectDeployments([{ id: "bad", createdAt: "not-a-date" }, ...DEPLOYMENTS], "2026-08-30T19:00:00.000Z", "2026-08-30T21:00:00.000Z");
  assert.equal(ids.includes("bad"), false);
});

// ── windowCoverageError: ingen data maa aldrig ligne "alt er fint" ──────────

test("an empty deployment list is an error, not a healthy zero", () => {
  // Review af PR #4469: opgraderes @railway/cli (workflowet installerer den
  // upinnet) og pakker JSON i et objekt, bliver listen tom, entries tomme,
  // hasFindings false og jobbet groent - uden at have set en eneste linje.
  const err = windowCoverageError({ deploymentTotal: 0, selectedCount: 0 });
  assert.match(String(err), /nul deployments/);
});

test("a full deployment list with nothing selected is an error too (renamed createdAt)", () => {
  const err = windowCoverageError({
    deploymentTotal: 37, selectedCount: 0, startIso: "2026-08-30T00:00:00.000Z", endIso: "2026-08-31T00:00:00.000Z",
  });
  assert.match(String(err), /ingen af de 37 deployments overlapper vinduet/);
});

test("all fetches failing is an error, but a partial failure still returns data", () => {
  assert.match(String(windowCoverageError({ deploymentTotal: 12, selectedCount: 12, failedCount: 12, lastError: "401" })), /ingen af de 12 deployments kunne hentes/);
  assert.equal(windowCoverageError({ deploymentTotal: 50, selectedCount: 50, failedCount: 49 }), null);
});

test("full coverage returns no error", () => {
  assert.equal(windowCoverageError({ deploymentTotal: 15, selectedCount: 3, failedCount: 0 }), null);
});

// ── Forward-guard: intet runtime-tag maa staa uden modtager ─────────────────

test("FORWARD-GUARD: every structured runtime tag has a threshold or an explicit ignore", () => {
  // #4453 opstod fordi #2817, #4165, #4369 og #4451 hver isaer gjorde en tavs
  // fejlgren synlig i en logstroem uden modtager. Denne test er det led der
  // forhindrer at det sker igen: tilfoejer nogen et nyt console.warn("[nyt-tag]")
  // uden at tage stilling til taerskel eller ignore, fejler CI her.
  const config = loadThresholds();
  const known = new Set([...Object.keys(config.tags ?? {}), ...(config.ignore ?? [])]);
  const found = collectRuntimeTags();
  // Uden denne assertion er guarden tandloes: en scanner der finder NUL tags
  // sammenligner en tom liste mod en fyldt og melder groent. Bevist i review af
  // PR #4469 - de fire filer koert i et traee uden backend/ gav 25/25 groent.
  // Nulpunkt maalt 31/8-2026: 52 tags. Gulvet er sat lavere end nulpunktet, saa
  // det er en sanity-check paa at der blev scannet noget, ikke et laas paa
  // antallet.
  assert.ok(
    found.length >= 40,
    `Tag-scanneren fandt kun ${found.length} runtime-tags (nulpunkt 31/8-2026: 52). `
    + "Enten er RUNTIME_PATHS i railway-log-tags.mjs bagud i forhold til hvor backend-koden ligger, "
    + "eller ogsaa scanner den ikke det den tror. Guarden nedenfor er vaerdiloes uden dette.",
  );
  const missing = found.map((t) => t.tag).filter((tag) => !known.has(tag));
  assert.deepEqual(
    missing,
    [],
    `Ukendte log-tags i backendens runtime. Tilfoej hvert tag til "tags" (med taerskel) eller "ignore" i scripts/ops/railway-log-thresholds.json: ${missing.join(", ")}`,
  );
});

test("FORWARD-GUARD: thresholds file has no tag in both tags and ignore", () => {
  const config = loadThresholds();
  const both = Object.keys(config.tags ?? {}).filter((tag) => (config.ignore ?? []).includes(tag));
  assert.deepEqual(both, [], `Tag staar baade i "tags" og "ignore": ${both.join(", ")}`);
});

test("FORWARD-GUARD: every threshold is a positive number", () => {
  const config = loadThresholds();
  const bad = Object.entries(config.tags ?? {}).filter(([, n]) => !Number.isFinite(n) || n < 1);
  assert.deepEqual(bad.map(([tag]) => tag), []);
});

test("thresholds file keeps the zero-tolerance tags from #4453 at 1", () => {
  const config = loadThresholds();
  assert.equal(config.tags["alunta-webhook"], 1);
  assert.equal(config.tags.fatal, 1);
});

test("FORWARD-GUARD: every RUNTIME_PATHS entry exists, so nothing is scanned in silence", () => {
  // backend/middleware stod paa listen indtil 31/8 uden at findes i repoet, og
  // walk() slugte fejlen. En sti der ikke findes skal fejle synligt her frem for
  // at goere inventaret mindre end nogen tror.
  const missing = RUNTIME_PATHS.filter((rel) => !fs.existsSync(path.join(REPO_ROOT, rel)));
  assert.deepEqual(missing, [], `RUNTIME_PATHS peger paa stier der ikke findes: ${missing.join(", ")}`);
});

test("FORWARD-GUARD: the scanner sees every console level, not just warn and error", () => {
  // classifyLine bucketer enhver linje der starter med [tag] uanset niveau, saa
  // en scanner der kun ser warn/error melder groent for tags der fint kan
  // udloese et fund. [discord-dm:stdout] (console.log) og [discord-dm:muted]
  // (console.info) var praecis den blinde vinkel indtil 31/8.
  const tags = new Set(collectRuntimeTags().map((t) => t.tag));
  for (const tag of ["discord-dm:stdout", "discord-dm:muted", "discord-dm:no-recipient"]) {
    assert.ok(tags.has(tag), `${tag} emitteres via console.log/info og skal vaere synlig for scanneren`);
  }
});

// ── shellQuote (CodeQL #353) ────────────────────────────────────────────────

test("quotes UNCONDITIONALLY, not only when the argument has spaces", () => {
  // "citér kun ved mellemrum" var hul nr. 2 i #353. Ubetinget citering betyder
  // at en senere udvidelse af allowlisten ikke kan genaabne hullet lydloest.
  assert.equal(shellQuote("CyclingZone"), '"CyclingZone"');
  assert.equal(shellQuote("My Service"), '"My Service"');
});

test("passes the argument shapes the watch actually sends", () => {
  // Faste flag, uuid, ISO-tidsstempel og heltal - alt hvad runRailway bygger.
  for (const arg of [
    "--service",
    "eebd4f5f-e440-45bf-8adc-97a7355bc439",
    "2026-08-31T04:00:00.000Z",
    "1000",
    "production",
  ]) {
    assert.equal(shellQuote(arg), `"${arg}"`);
  }
});

test("REGRESSION #353: rejects shell metacharacters instead of passing them through unquoted", () => {
  // Den gamle escape citerede kun ved mellemrum/citationstegn, saa 'svc&whoami'
  // gik raat til cmd.exe hvor & er en kommandoseparator.
  for (const bad of ["svc&whoami", "svc|more", "svc^x", "%PATH%", "!DELAYED!", "$(id)", "a`b", "svc;ls", "svc>out"]) {
    assert.throws(() => shellQuote(bad), /argument afvist/, `${bad} skal afvises`);
  }
});

test("REGRESSION #353: rejects a trailing backslash, which escaped the closing quote", () => {
  // `"C:\tools\"` - den afsluttende backslash aad citationstegnet, og resten af
  // kommandolinjen blev laest som noget andet end tiltaenkt.
  assert.throws(() => shellQuote("C:\\tools\\", { allowBackslash: true }), /argument afvist/);
  assert.throws(() => shellQuote('a"b'), /argument afvist/);
});

test("only the CLI path may contain backslashes", () => {
  assert.equal(shellQuote("C:\\tools\\railway.cmd", { allowBackslash: true }), '"C:\\tools\\railway.cmd"');
  assert.throws(() => shellQuote("C:\\tools\\railway.cmd"), /argument afvist/);
});
