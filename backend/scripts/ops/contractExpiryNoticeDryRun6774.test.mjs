// #6774/#6855: tørkørslen må aldrig sende, skal tælle modtagere som --live
// gør, og varsels-teksten skal pege på Kontrakter-fanen (EN + DA).
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_KEY ??= "test-service-key";

const { buildDryRunReport } = await import("./contractExpiryNoticeDryRun6774.mjs");

const fakeSupabase = { from() { throw new Error("must not query: rows are injected"); } };
const rows = [
  { teamId: "t1", userId: "u1", teamName: "Secret Team One", expiringCount: 3, retirementRiskCount: 1 },
  { teamId: "t2", userId: "u2", teamName: "Secret Team Two", expiringCount: 2, retirementRiskCount: 0 },
];

test("tørkørsel: tæller modtagere og sender intet", async () => {
  const report = await buildDryRunReport({ supabase: fakeSupabase, activeSeasonNumber: 4, fetchTeamRiskRows: async () => rows });
  assert.equal(report.recipients, 2);
  assert.equal(report.totalExpiring, 5);
  assert.equal(report.totalRetirementRisk, 1);
  assert.equal(report.sent, 0);
});

test("tørkørsel: holdnavne printes aldrig, kun aliaser", async () => {
  const report = await buildDryRunReport({ supabase: fakeSupabase, activeSeasonNumber: 4, fetchTeamRiskRows: async () => rows });
  const text = JSON.stringify(report);
  assert.doesNotMatch(text, /Secret Team/);
  assert.deepEqual(report.samples.map((s) => s.team), ["Hold A", "Hold B"]);
});

test("varsels-teksten peger på Kontrakter-fanen på EN og DA, uden em-dash", async () => {
  const report = await buildDryRunReport({ supabase: fakeSupabase, activeSeasonNumber: 4, fetchTeamRiskRows: async () => [] });
  const both = report.variants.find((v) => v.key === "both");
  const expiring = report.variants.find((v) => v.key === "expiringOnly");
  for (const v of [both, expiring]) {
    assert.match(v.en.message, /Contracts tab on My Team/);
    assert.match(v.da.message, /fanen Kontrakter på Mit hold/);
    assert.match(v.en.message, /3 rider\(s\)/);
    assert.doesNotMatch(v.en.message + v.da.message, /—/);
  }
  assert.equal(report.link, "/team?tab=contracts");
});
