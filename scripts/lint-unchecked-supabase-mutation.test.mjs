// scripts/lint-unchecked-supabase-mutation.test.mjs
// ============================================================
// Tests for forward-guarden mod utjekkede (fire-and-forget) Supabase-mutationer
// (#2974 / #2898-rodårsagen).
// Run: node --test scripts/lint-unchecked-supabase-mutation.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findUncheckedMutations, collectFiles } from "./lint-unchecked-supabase-mutation.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

// ── Kernemønsteret: det der dublerede point og præmier (#2898) ───────────────

test("flager bart `await supabase.from(...).delete()`", () => {
  const src = `await supabase.from("race_results").delete().eq("race_id", id);`;
  const findings = findUncheckedMutations(src);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].method, "delete");
});

test("flager det faktiske #2898-mønster: utjekket delete umiddelbart før insert", () => {
  const src = `
    await supabase.from("race_simulation_runs").delete().eq("race_id", race.id)
      .in("stage_number", stages);
    const { error } = await supabase.from("race_simulation_runs").insert(rows);
    if (error) throw new Error(error.message);
  `;
  const findings = findUncheckedMutations(src);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].method, "delete");
  assert.equal(findings[0].line, 2);
});

test("flager bart update / upsert / insert", () => {
  assert.equal(findUncheckedMutations(`await supabase.from("races").update({ status: "completed" }).eq("id", id);`).length, 1);
  assert.equal(findUncheckedMutations(`await supabase.from("rider_condition").upsert(rows, { onConflict: "rider_id" });`).length, 1);
  assert.equal(findUncheckedMutations(`await supabase.from("import_log").insert(row);`).length, 1);
});

test("flager multi-linje-kæde (den faktiske skrivestil i raceRunner.js)", () => {
  const src = `
    await supabase
      .from("race_incidents")
      .delete()
      .eq("race_id", race.id)
      .in("stage_number", stageNumbers);
  `;
  const findings = findUncheckedMutations(src);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 2);
});

test("flager mutation inde i et bart `await Promise.all([...])`", () => {
  // Promise.all afviser kun hvis promiset afviser — supabase-js afviser aldrig,
  // så fejlen er lige så tavs som i det direkte kald.
  const src = `await Promise.all([supabase.from("x").delete().eq("id", 1)]);`;
  assert.equal(findUncheckedMutations(src).length, 1);
});

test("flager bart kald efter en if-header uden tuborg", () => {
  const src = `if (stages.length) await supabase.from("race_results").delete().eq("race_id", id);`;
  assert.equal(findUncheckedMutations(src).length, 1);
});

// ── De korrekte mønstre må IKKE flages ───────────────────────────────────────

test("destruktureret error → ikke flaget", () => {
  const src = `const { error } = await supabase.from("x").delete().eq("id", id);\nif (error) throw new Error(error.message);`;
  assert.equal(findUncheckedMutations(src).length, 0);
});

test("aliaseret error → ikke flaget", () => {
  const src = `const { error: deleteError } = await supabase.from("x").delete().eq("id", id);`;
  assert.equal(findUncheckedMutations(src).length, 0);
});

test("bundet til en variabel → ikke flaget (resultatet KAN læses)", () => {
  const src = `const res = await supabase.from("x").delete().eq("id", id);\nif (res.error) throw res.error;`;
  assert.equal(findUncheckedMutations(src).length, 0);
});

test("return'et → ikke flaget (delegeret til opkalderen)", () => {
  const src = `return await supabase.from("x").delete().eq("id", id);`;
  assert.equal(findUncheckedMutations(src).length, 0);
});

test("ren læsning uden mutation → ikke flaget", () => {
  const src = `await supabase.from("races").select("id").eq("season_id", id);`;
  assert.equal(findUncheckedMutations(src).length, 0);
});

test("ikke-Supabase await → ikke flaget", () => {
  const src = `await notifyDiscord({ race });\nawait flushDeferredTransfersSafe({ supabase, race });`;
  assert.equal(findUncheckedMutations(src).length, 0);
});

test("bart .rpc(-kald → ikke flaget (bevidst uden for scope)", () => {
  const src = `await supabase.rpc("apply_stage_result", { p_race_id: id });`;
  assert.equal(findUncheckedMutations(src).length, 0);
});

// ── Escape-hatch ─────────────────────────────────────────────────────────────

test("`// best-effort`-markør undertrykker fundet", () => {
  const src = `await supabase.from("x").delete().eq("id", id); // best-effort: audit-log, må ikke vælte flowet`;
  assert.equal(findUncheckedMutations(src).length, 0);
});

test("`// error-ok`-markør undertrykker fundet", () => {
  const src = `await supabase.from("x").update({ a: 1 }).eq("id", id); // error-ok`;
  assert.equal(findUncheckedMutations(src).length, 0);
});

test("markøren undertrykker IKKE et andet, umarkeret kald", () => {
  const src = [
    `await supabase.from("x").delete().eq("id", 1); // best-effort`,
    `await supabase.from("y").delete().eq("id", 2);`,
  ].join("\n");
  const findings = findUncheckedMutations(src);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 2);
});

// ── Strenge/kommentarer må ikke give falske fund ─────────────────────────────

test("mønster i en kommentar → ikke flaget", () => {
  const src = `// await supabase.from("x").delete().eq("id", id);\nconst a = 1;`;
  assert.equal(findUncheckedMutations(src).length, 0);
});

test("mønster i en streng → ikke flaget", () => {
  const src = `const doc = "await supabase.from('x').delete()";`;
  assert.equal(findUncheckedMutations(src).length, 0);
});

// ── Fil-udvælgelse: intet hardkodet, hele træet walkes ───────────────────────

test("collectFiles dækker backend/lib, backend/routes og cron.js", () => {
  const rels = collectFiles(ROOT).map((f) => f.slice(ROOT.length + 1).replace(/\\/g, "/"));
  assert.ok(rels.includes("backend/lib/raceRunner.js"), "backend/lib skal walkes");
  assert.ok(rels.includes("backend/routes/api.js"), "backend/routes skal walkes");
  assert.ok(rels.includes("backend/cron.js"), "cron.js skal med");
  assert.ok(rels.length > 50, `forventede et helt træ-walk, fik ${rels.length} filer`);
});

test("test-filer scannes ikke (de må gerne fyre-og-glemme)", () => {
  const rels = collectFiles(ROOT).map((f) => f.slice(ROOT.length + 1).replace(/\\/g, "/"));
  assert.equal(rels.filter((r) => r.endsWith(".test.js")).length, 0);
});

// ── Regression: de sites #2974 rettede må ikke komme tilbage ─────────────────

test("raceRunner.js og pcmResultsImport.js har ingen utjekkede mutationer (#2974)", async () => {
  const { readFileSync } = await import("node:fs");
  for (const rel of ["backend/lib/raceRunner.js", "backend/lib/pcmResultsImport.js"]) {
    const src = readFileSync(resolve(ROOT, rel), "utf8");
    const findings = findUncheckedMutations(src);
    const unexpected = findings.filter((f) => f.method === "delete" || f.method === "update");
    assert.deepEqual(
      unexpected,
      [],
      `${rel} har utjekket delete/update igen: ${JSON.stringify(findings)}`,
    );
  }
});
