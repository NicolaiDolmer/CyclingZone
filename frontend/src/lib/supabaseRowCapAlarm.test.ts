// #8797 — browser-klienten melder læsninger der rammer 1.000-rækkeloftet.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createBrowserRowCapObserver, type RowCapFinding } from "./supabaseRowCapAlarm.ts";
import { createLazyRowCapAlarmFetch } from "./supabaseRowCapAlarmLazy.ts";

function pgResponse(rows: number): Response {
  return new Response("[]", { status: 200, headers: { "content-range": `0-${rows - 1}/*` } });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("naiv læsning med præcis 1.000 rækker rapporteres, .range() gør ikke", async () => {
  const reports: RowCapFinding[] = [];
  const f = createLazyRowCapAlarmFetch(
    async () => pgResponse(1000),
    async () => createBrowserRowCapObserver((x) => reports.push(x), () => 0),
  );
  await f("https://x.supabase.co/rest/v1/riders?select=nationality_code", { method: "GET" });
  await f("https://x.supabase.co/rest/v1/riders?select=id&offset=0&limit=1000", { method: "GET" });
  await settle();
  assert.equal(reports.length, 1);
  assert.equal(reports[0].table, "riders");
});

test("alarm-modulet hentes én gang, og svaret returneres uændret", async () => {
  let loads = 0;
  const original = pgResponse(1000);
  const f = createLazyRowCapAlarmFetch(async () => original, async () => {
    loads += 1;
    return createBrowserRowCapObserver(() => {}, () => 0);
  });
  assert.equal(await f("https://x.supabase.co/rest/v1/teams?select=id", { method: "GET" }), original);
  await f("https://x.supabase.co/rest/v1/teams?select=id", { method: "GET" });
  await settle();
  assert.equal(loads, 1);
});

test("et alarm-modul der ikke kan hentes vælter aldrig kaldet", async () => {
  const f = createLazyRowCapAlarmFetch(async () => pgResponse(1000), () => Promise.reject(new Error("chunk mangler")));
  const res = await f("https://x.supabase.co/rest/v1/teams?select=id", { method: "GET" });
  await settle();
  assert.equal(res.status, 200);
});

test("supabase.ts sætter den dovne alarm-fetch på browser-klienten og importerer ikke alarmen statisk", () => {
  const src = readFileSync(new URL("./supabase.ts", import.meta.url), "utf8");
  assert.match(src, /global:\s*\{\s*fetch:\s*createLazyRowCapAlarmFetch\(\)\s*\}/);
  assert.doesNotMatch(src, /from\s+["']\.\/supabaseRowCapAlarm\.ts["']/);
  const lazySrc = readFileSync(new URL("./supabaseRowCapAlarmLazy.ts", import.meta.url), "utf8");
  assert.doesNotMatch(lazySrc, /^import\s+(?!type\b)[^;]*["']\.\/supabaseRowCapAlarm\.ts["']/m);
});
