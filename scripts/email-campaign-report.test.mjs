import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultOutPath, parseOptions, readPosthogUtm, writePrivateReport } from "./email-campaign-report.mjs";

test("options: defaults, valid flags and refusals", () => {
  assert.deepEqual(parseOptions([]), { campaign: "s6_season", edition: "before-start", holdout: 0, out: null, json: false, graceHours: 2 });
  const o = parseOptions(["--edition", "started", "--holdout", "0.1", "--json", "--grace-hours", "6", "--out", "x.md"]);
  assert.deepEqual([o.edition, o.holdout, o.json, o.graceHours, o.out], ["started", 0.1, true, 6, "x.md"]);
  for (const bad of [["--campaign", "winback"], ["--edition", "later"], ["--holdout", "0.9"], ["--grace-hours", "-1"], ["--out"], ["--nope"]]) {
    assert.throws(() => parseOptions(bad), (err) => err.exitCode === 1, bad.join(" "));
  }
});

test("default out path sits in the private OneDrive folder; without OneDrive --out is required", () => {
  const now = new Date("2026-11-26T10:05:00.000Z");
  const out = defaultOutPath({ env: { OneDrive: path.join("C:", "OD") }, campaign: "s6_season", edition: "before-start", now });
  assert.equal(out, path.join("C:", "OD", "CyclingZone-context", "private", "email-kampagner", "s6_season-before-start-20261126-1005.md"));
  assert.throws(() => defaultOutPath({ env: {}, campaign: "s6_season", edition: "before-start", now }), /--out/);
});

test("write: refuses any target inside a Git checkout, writes privately outside, never overwrites", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cz-8807-"));
  try {
    const repo = path.join(root, "repo");
    await fs.mkdir(path.join(repo, "sub"), { recursive: true });
    await fs.writeFile(path.join(repo, ".git"), "gitdir: elsewhere");
    await assert.rejects(writePrivateReport(path.join(repo, "sub", "new", "r.md"), "x"), /uden for Git/);
    const target = path.join(root, "private", "deep", "r.md");
    assert.equal(await writePrivateReport(target, "tal"), path.resolve(target));
    assert.equal(await fs.readFile(target, "utf8"), "tal");
    await assert.rejects(writePrivateReport(target, "igen"), /EEXIST/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("posthog: skipped without a key; rows mapped; an odd utm_campaign is refused before any request", async () => {
  assert.equal(await readPosthogUtm({ env: {}, utmCampaign: "s6-before-start", firstSendMs: 1 }), null);
  const env = { POSTHOG_PERSONAL_API_KEY: "k", POSTHOG_PROJECT_ID: "1" };
  assert.equal(await readPosthogUtm({ env, utmCampaign: "s6-before-start", firstSendMs: null }), null);
  let body = null;
  const fetchImpl = async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ results: [["active-a", 3, 4], [null, "2", "2"]] }) };
  };
  const rows = await readPosthogUtm({ env, utmCampaign: "s6-before-start", firstSendMs: Date.parse("2026-11-26T10:00:00Z"), fetchImpl });
  assert.deepEqual(rows, [{ utmContent: "active-a", persons: 3, sessions: 4 }, { utmContent: "", persons: 2, sessions: 2 }]);
  assert.match(body.query.query, /utm_campaign = 's6-before-start'/);
  await assert.rejects(
    readPosthogUtm({ env, utmCampaign: "s6'; DROP", firstSendMs: 1, fetchImpl: async () => assert.fail("no request") }),
    /ugyldig/
  );
});
