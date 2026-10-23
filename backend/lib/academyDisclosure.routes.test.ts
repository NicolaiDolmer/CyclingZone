import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync(new URL("../routes/api.js", import.meta.url), "utf8");
const prognosis = { stage: "learning", daysOnTeam: 0, nextStageDays: 1, band: null };
const rider = { id: "a", team_id: "own", is_academy: true, primary_type: "climber" };
function route(method: string, path: string, extra: Record<string, unknown> = {}) {
  const marker = `router.${method}("${path}"`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0);
  const block = source.slice(start, source.indexOf("\n});", start) + 4);
  let handler: any;
  const context: any = {
    Date: class extends Date { constructor() { super("2026-10-20T12:00:00Z"); } },
    router: { [method]: (...args: any[]) => { handler = args.at(-1); } },
    requireAuth() {}, presencePulseLimiter() {},
    supabase: { from(table: string) {
      const query: any = { select(columns: string) { if (table === "riders") assert.ok(columns.includes("is_academy")); return query; },
        eq() { return query; }, in() { return query; }, order() { return query; },
        maybeSingle: async () => ({ data: rider }), then: (resolve: any) => resolve({ data: [rider] }) };
      return query;
    } },
    loadScoutState: async () => ({ state: { maxLevel: 3, levels: {} } }),
    loadScout: async () => ({}), getActiveSeasonNumber: async () => 4,
    fetchAllRowsChunkedIn: async (_ids: any, query: any) => (await query([])).data,
    isAcademyKnowledgeEnabled: async () => true,
    loadAcademyPrognoses: async () => new Map([[rider.id, prognosis]]),
    academyEstimate: (p: unknown) => ({ academyPrognosis: p }),
    buildScoutEstimate() { throw new Error("full scout estimate must not be computed"); },
    ...extra,
  };
  vm.runInNewContext(block, context);
  return async () => {
    let status = 200; let body: any;
    const res: any = { status(code: number) { status = code; return res; }, json(value: unknown) { body = value; return res; } };
    await handler({ team: { id: "own" }, params: { id: "a" }, body: { riderIds: ["a"] } }, res);
    assert.equal(status, 200, JSON.stringify(body));
    return JSON.parse(JSON.stringify(body));
  };
}
test("My Team and profile hero estimates return only academy knowledge", async () => {
  const out = await route("post", "/scouting/estimates")();
  assert.deepEqual(out.estimates.a, { academyPrognosis: prognosis });
});
test("profile scouting tab cannot obtain stars, verdict or other role forecasts", async () => {
  const out = await route("get", "/riders/:id/scouting-report")();
  assert.deepEqual(out, { own: true, academyPrognosis: prognosis });
});
test("legacy development projection cannot disclose hidden ability caps", async () => {
  const out = await route("get", "/riders/:id/development-projection")();
  assert.deepEqual(out, { own: true, capsMissing: true });
});
