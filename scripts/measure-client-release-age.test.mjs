// Tests for measure-client-release-age.mjs (#5162, K3).
//
// Tallene her er syntetiske test-fixtures (timer og event-antal), ikke målte
// prod-værdier.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { FLOOR_RELEASES, MAX_RELEASES, MIN_WINDOW_HOURS } from "./lib/releaseAssetsStore.mjs";
import {
  RETENTION_QUERY,
  computeRetention,
  measure,
  parsePosthogRows,
  weightedPercentile,
} from "./measure-client-release-age.mjs";

const H = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-07T12:00:00Z");
const quiet = () => {};

/** n releases, nyeste først, med `spacingHours` mellem hver. */
function releases(n, spacingHours = 6) {
  return Array.from({ length: n }, (_, i) => ({ frontend: `rel${String(i).padStart(2, "0")}`, createdAt: NOW - (i + 1) * spacingHours * H }));
}

test("vaegtet percentil (nearest-rank)", () => {
  assert.equal(weightedPercentile([], 99), 0);
  assert.equal(weightedPercentile([{ value: 5, weight: 1 }], 99), 5);
  const samples = [{ value: 1, weight: 98 }, { value: 10, weight: 1 }, { value: 50, weight: 1 }];
  assert.equal(weightedPercentile(samples, 99), 10);
  assert.equal(weightedPercentile(samples, 100), 50);
});

test("p99 af alder efter afloesning styrer vinduet naar det overstiger gulvet (p99 + 24 t)", () => {
  // rel00 nyest, rel09 aeldst (afloest af rel08). Ti dage mellem releases, saa
  // de afloeste releases ligger langt uden for 72-timers-gulvet.
  const rels = releases(10, 24);
  // Events paa rel05 (afloest af rel04 for 5 dage siden): klienter set 100 t efter afloesningen.
  const supersededRel05 = rels[4].createdAt;
  const observations = [
    { frontend: "rel00", hour: NOW - 2 * H, count: 1000 },
    { frontend: "rel05", hour: supersededRel05 + 99 * H, count: 50 },
  ];
  const r = computeRetention({ observations, releases: rels, now: NOW });
  assert.equal(r.p99_stale_hours, 100);
  assert.equal(r.window_hours, 124, "p99 + 24 t");
  assert.ok(r.releases.includes("rel05"), "en release der stadig koerer hos klienter beholdes");
  assert.ok(!r.releases.includes("rel07"), "en release ingen har set i vinduet slippes");
  assert.deepEqual(r.alarms, []);
});

test("gulv 72 t: lav p99 giver aldrig et vindue under gulvet", () => {
  const rels = releases(5);
  const r = computeRetention({ observations: [{ frontend: "rel00", hour: NOW - H, count: 10 }], releases: rels, now: NOW });
  assert.equal(r.p99_stale_hours, 0);
  assert.equal(r.window_hours, MIN_WINDOW_HOURS);
});

test("gulvet: de 3 nyeste beholdes ALTID; tom telemetri giver kun gulvet + alarm", () => {
  const rels = releases(8, 48);
  const r = computeRetention({ observations: [], releases: rels, now: NOW });
  assert.deepEqual(r.releases, ["rel00", "rel01", "rel02"]);
  assert.equal(r.floor.length, FLOOR_RELEASES);
  assert.deepEqual(r.alarms.map((a) => a.kind), ["empty_telemetry"]);
});

test("loft 30: overskrides det, beholdes de 30 nyeste OG der alarmeres (aldrig stille)", () => {
  const rels = releases(35, 1);
  const observations = rels.map((rel) => ({ frontend: rel.frontend, hour: NOW - 2 * H, count: 3 }));
  const r = computeRetention({ observations, releases: rels, now: NOW });
  assert.equal(r.releases.length, MAX_RELEASES);
  assert.equal(r.releases[0], "rel00");
  assert.deepEqual(r.dropped, ["rel30", "rel31", "rel32", "rel33", "rel34"]);
  assert.equal(r.alarms[0].kind, "cap_exceeded");
});

test("releases uden manifest (fra foer carry-forward) taelles men kan ikke beholdes", () => {
  const r = computeRetention({
    observations: [{ frontend: "legacy", hour: NOW - H, count: 4 }, { frontend: "rel00", hour: NOW - H, count: 1 }],
    releases: releases(2),
    now: NOW,
  });
  assert.deepEqual(r.unknown_releases_seen, ["legacy"]);
  assert.ok(!r.releases.includes("legacy"));
  assert.equal(r.total_events, 5);
});

test("PostHog-raekker: HogQL's datetime uden tidszone laeses som UTC; skrald ignoreres", () => {
  const rows = parsePosthogRows({ results: [["fe1", "2026-10-07 10:00:00", 3], ["fe2", "2026-10-07T11:00:00Z", "2"], [null, "x", 1], "skrald"] });
  assert.deepEqual(rows, [
    { frontend: "fe1", hour: Date.parse("2026-10-07T10:00:00Z"), count: 3 },
    { frontend: "fe2", hour: Date.parse("2026-10-07T11:00:00Z"), count: 2 },
  ]);
  assert.match(RETENTION_QUERY, /properties\.cz_frontend/);
  assert.match(RETENTION_QUERY, /INTERVAL 7 DAY/);
});

test("uden PostHog-noegle: springer over, skriver intet", async () => {
  const lines = [];
  const result = await measure({ env: {}, log: (m) => lines.push(m) });
  assert.equal(result.status, "skipped");
  assert.match(lines[0], /springer over: POSTHOG_PERSONAL_API_KEY \+ POSTHOG_PROJECT_ID mangler/);
});

test("maaling skriver KUN retention.json til lageret; PostHog kaldes read-only; --dry-run skriver intet", async () => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cz-retention-"));
  fs.mkdirSync(path.join(storeDir, "manifests"), { recursive: true });
  for (const [i, id] of ["relA", "relB", "relC", "relD"].entries()) {
    const file = path.join(storeDir, "manifests", `${id}.json`);
    fs.writeFileSync(file, "{}");
    const when = new Date(NOW - (40 - i * 10) * H);
    fs.utimesSync(file, when, when);
  }
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ results: [["relA", new Date(NOW - 2 * H).toISOString(), 5], ["relD", new Date(NOW - H).toISOString(), 100]] }),
    };
  };
  const env = { POSTHOG_PERSONAL_API_KEY: "phx_test", POSTHOG_PROJECT_ID: "123", CZ_RELEASE_ASSETS_LOCAL_DIR: storeDir };

  const dry = await measure({ env, dryRun: true, fetchImpl, now: NOW, log: quiet });
  assert.equal(dry.status, "dry-run");
  assert.ok(!fs.existsSync(path.join(storeDir, "retention.json")));

  const result = await measure({ env, fetchImpl, now: NOW, log: quiet });
  assert.equal(result.status, "written");
  const written = JSON.parse(fs.readFileSync(path.join(storeDir, "retention.json"), "utf8"));
  assert.deepEqual(written.releases, ["relD", "relC", "relB", "relA"], "relA er set for nylig og beholdes uden for gulvet");
  assert.equal(calls[0].url, "https://eu.posthog.com/api/projects/123/query/");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(JSON.parse(calls[0].init.body).query.kind, "HogQLQuery");
  assert.deepEqual(fs.readdirSync(storeDir).sort(), ["manifests", "retention.json"], "ingen andre skrivninger");
});
