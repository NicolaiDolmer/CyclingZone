import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHUNK_ERROR_QUERY,
  STOP_RULE_PER_DAY,
  buildDailyWindows,
  buildEventsUrl,
  judgeStopRule,
  parseCount,
  parseReleaseRows,
  renderMarkdown,
  resolveConfig,
  runReport,
} from "./chunk-errors-per-release.mjs";

const CONFIG = { host: "https://sentry.io", org: "org-x", token: "tok" };

test("stopreglen er ejerens tal: under 3 pr. døgn", () => {
  assert.equal(STOP_RULE_PER_DAY, 3);
});

test("events-URL bærer chunk-query, errors-dataset og vindue", () => {
  const url = new URL(buildEventsUrl(CONFIG, { fields: ["release", "count()"], window: { statsPeriod: "72h" }, sort: "-count()", perPage: 50 }));
  assert.equal(url.pathname, "/api/0/organizations/org-x/events/");
  assert.deepEqual(url.searchParams.getAll("field"), ["release", "count()"]);
  assert.equal(url.searchParams.get("query"), CHUNK_ERROR_QUERY);
  assert.equal(url.searchParams.get("dataset"), "errors");
  assert.equal(url.searchParams.get("statsPeriod"), "72h");
  assert.equal(url.searchParams.get("sort"), "-count()");
  assert.ok(!url.toString().includes("tok"), "tokenet hører aldrig hjemme i URL'en");

  const windowed = new URL(buildEventsUrl(CONFIG, { fields: ["count()"], window: { start: "2026-10-09T00:00:00.000Z", end: "2026-10-10T00:00:00.000Z" } }));
  assert.equal(windowed.searchParams.get("start"), "2026-10-09T00:00:00.000Z");
  assert.equal(windowed.searchParams.get("statsPeriod"), null);
});

test("døgnvinduer dækker 72 t uden huller, nyeste først", () => {
  const now = new Date("2026-10-10T12:00:00.000Z");
  const windows = buildDailyWindows(now);
  assert.equal(windows.length, 3);
  assert.equal(windows[0].end, now.toISOString());
  assert.equal(windows[0].start, windows[1].end);
  assert.equal(windows[1].start, windows[2].end);
  assert.equal(windows[2].start, "2026-10-07T12:00:00.000Z");
});

test("release-rækker sorteres efter events og tomme releases navngives", () => {
  const rows = parseReleaseRows({
    data: [
      { release: "aaa", "count()": 2, "count_unique(user)": 1 },
      { release: "", "count()": 5, "count_unique(user)": 3 },
      { release: "bbb", "count()": 0 },
    ],
  });
  assert.deepEqual(rows, [
    { release: "(ingen release)", events: 5, users: 3 },
    { release: "aaa", events: 2, users: 1 },
  ]);
  assert.deepEqual(parseReleaseRows({}), []);
  assert.equal(parseCount({ data: [{ "count()": 4 }, { "count()": 1 }] }), 5);
  assert.equal(parseCount(null), 0);
});

test("dom: holder kun når hvert døgn er under grænsen", () => {
  const ok = judgeStopRule([{ label: "a", events: 2 }, { label: "b", events: 0 }, { label: "c", events: 2 }]);
  assert.equal(ok.holds, true);
  assert.equal(ok.total, 4);
  const bad = judgeStopRule([{ label: "a", events: 3 }, { label: "b", events: 0 }, { label: "c", events: 1 }]);
  assert.equal(bad.holds, false);
  assert.deepEqual(bad.breached.map((d) => d.label), ["a"]);
});

test("markdown viser tabel, døgn og dom", () => {
  const days = [{ label: "seneste 24 t", events: 4 }, { label: "24-48 t siden", events: 0 }, { label: "48-72 t siden", events: 1 }];
  const md = renderMarkdown({ releases: [{ release: "abc|def", events: 4, users: 2 }], days, verdict: judgeStopRule(days) });
  assert.match(md, /\| Release \| Events \| Spillere \|/);
  assert.match(md, /abc\\\|def/, "pipe i release-navnet må ikke bryde tabellen");
  assert.match(md, /Stopreglen brudt/);
  assert.match(md, /ADVISORY/);
});

test("backslash før pipe escapes også, så cellen ikke kan lukkes (CodeQL js/incomplete-sanitization)", () => {
  const days = [{ label: "seneste 24 t", events: 0 }];
  const md = renderMarkdown({ releases: [{ release: "a\\|b", events: 1, users: 1 }], days, verdict: judgeStopRule(days) });
  assert.ok(md.includes("a\\\\\\|b"), "\\ bliver \\\\ og | bliver \\|");
});

test("uden token springes over uden netværk", async () => {
  assert.ok(resolveConfig({}).skip);
  const result = await runReport({ env: {}, fetchImpl: () => assert.fail("intet kald uden token") });
  assert.equal(result.status, "skipped");
  assert.match(result.markdown, /SPRUNGET OVER/);
});

test("API-fejl giver advisory-linje, aldrig et kast, og lækker ikke tokenet", async () => {
  const result = await runReport({ env: { SENTRY_AUTH_TOKEN: "secret-tok" }, fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.equal(result.status, "error");
  assert.match(result.markdown, /401/);
  assert.ok(!result.markdown.includes("secret-tok"));

  const thrown = await runReport({ env: { SENTRY_AUTH_TOKEN: "secret-tok" }, fetchImpl: async () => { throw new Error("ECONNRESET"); } });
  assert.equal(thrown.status, "error");
});

test("fuld kørsel: én release-forespørgsel + tre døgn, med Bearer-token", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(url), auth: init.headers.Authorization });
    const u = new URL(url);
    const body = u.searchParams.getAll("field").includes("release")
      ? { data: [{ release: "r1", "count()": 3, "count_unique(user)": 2 }] }
      : { data: [{ "count()": 1 }] };
    return { ok: true, status: 200, json: async () => body };
  };
  const result = await runReport({ env: { SENTRY_AUTH_TOKEN: "tok", SENTRY_ORG: "org-x" }, fetchImpl, now: new Date("2026-10-10T00:00:00Z") });
  assert.equal(result.status, "ok");
  assert.equal(calls.length, 4);
  assert.ok(calls.every((c) => c.auth === "Bearer tok"));
  assert.ok(calls.every((c) => c.url.pathname === "/api/0/organizations/org-x/events/"));
  assert.equal(result.verdict.holds, true);
  assert.equal(result.verdict.total, 3);
  assert.deepEqual(result.releases, [{ release: "r1", events: 3, users: 2 }]);
});
