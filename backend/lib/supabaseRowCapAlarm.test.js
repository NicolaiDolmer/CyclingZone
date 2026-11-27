// #8797 — rækkeloft-alarmen: en læsning uden vindue med præcis 1.000 rækker meldes,
// alt andet lades i fred, og svaret ændres aldrig.
import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  POSTGREST_ROW_CAP,
  createRowCapObserver,
  inspectRowCapResponse,
  rowsFromContentRange,
  withRowCapAlarm,
} from "./supabaseRowCapAlarm.js";
import { createSupabaseFetchWithRetry } from "./supabaseFetchRetry.js";

const BASE = "https://x.supabase.co/rest/v1/";

function pgResponse(rows, { start = 0, total = "*" } = {}) {
  const body = JSON.stringify(Array.from({ length: rows }, (_, i) => ({ id: start + i })));
  const range = rows === 0 ? `*/${total === "*" ? 0 : total}` : `${start}-${start + rows - 1}/${total}`;
  return new Response(body, { status: 200, headers: { "content-type": "application/json", "content-range": range } });
}

test("rowsFromContentRange læser antal rækker", () => {
  assert.equal(rowsFromContentRange("0-999/*"), 1000);
  assert.equal(rowsFromContentRange("1000-1499/1500"), 500);
  assert.equal(rowsFromContentRange("*/0"), null);
  assert.equal(rowsFromContentRange(""), null);
});

test("præcis 1.000 rækker uden vindue meldes med tabel og parameternavne (ingen værdier)", () => {
  const url = `${BASE}race_entries?select=race_id%2Crider_id&team_id=eq.secret-team`;
  const finding = inspectRowCapResponse(url, { method: "GET" }, pgResponse(POSTGREST_ROW_CAP));
  assert.deepEqual(finding, { table: "race_entries", shape: "select,team_id", rows: 1000 });
  assert.ok(!JSON.stringify(finding).includes("secret-team"));
});

test("intet meldes ved 999 rækker, ved .range/.limit, ved .single eller ved skrivninger", () => {
  const url = `${BASE}riders?select=id`;
  assert.equal(inspectRowCapResponse(url, { method: "GET" }, pgResponse(999)), null);
  assert.equal(inspectRowCapResponse(`${url}&offset=0&limit=1000`, { method: "GET" }, pgResponse(1000)), null);
  assert.equal(inspectRowCapResponse(`${url}&limit=1000`, { method: "GET" }, pgResponse(1000)), null);
  assert.equal(inspectRowCapResponse(url, { method: "GET", headers: { Accept: "application/vnd.pgrst.object+json" } }, pgResponse(1000)), null);
  assert.equal(inspectRowCapResponse(url, { method: "GET", headers: { Range: "0-999" } }, pgResponse(1000)), null);
  assert.equal(inspectRowCapResponse(url, { method: "POST" }, pgResponse(1000)), null);
  assert.equal(inspectRowCapResponse("https://x.supabase.co/auth/v1/user", { method: "GET" }, pgResponse(1000)), null);
});

test("embedded limit (riders.limit) tæller ikke som vindue på top-niveau", () => {
  const url = `${BASE}teams?select=id%2Criders(id)&riders.limit=5`;
  assert.equal(inspectRowCapResponse(url, { method: "GET" }, pgResponse(1000))?.table, "teams");
});

test("wrapperen returnerer svaret uændret og deduplikerer samme form", async () => {
  const reports = [];
  let t = 0;
  const original = pgResponse(1000);
  const wrapped = withRowCapAlarm(async () => original, { report: (f) => reports.push(f), now: () => t, dedupeMs: 100 });
  const res = await wrapped(`${BASE}teams?select=id`, { method: "GET" });
  assert.equal(res, original);
  await wrapped(`${BASE}teams?select=id`, { method: "GET" });
  assert.equal(reports.length, 1);
  t = 200;
  await wrapped(`${BASE}teams?select=id`, { method: "GET" });
  assert.equal(reports.length, 2);
});

test("observeren vurderer et modtaget svar uden selv at kalde fetch og deduplikerer", () => {
  const reports = [];
  let t = 0;
  const observe = createRowCapObserver({ report: (f) => reports.push(f), now: () => t, dedupeMs: 100 });
  observe(`${BASE}teams?select=id`, { method: "GET" }, pgResponse(1000));
  observe(`${BASE}teams?select=id`, { method: "GET" }, pgResponse(1000));
  observe(`${BASE}teams?select=id`, { method: "GET" }, pgResponse(999));
  assert.equal(reports.length, 1);
  t = 200;
  observe(`${BASE}teams?select=id`, { method: "GET" }, pgResponse(1000));
  assert.equal(reports.length, 2);
  assert.doesNotThrow(() => observe(null, undefined, undefined));
});

test("en fejl i rapporten vælter aldrig kaldet", async () => {
  const wrapped = withRowCapAlarm(async () => pgResponse(1000), { report: () => { throw new Error("sentry nede"); }, now: () => 0 });
  const res = await wrapped(`${BASE}teams?select=id`, { method: "GET" });
  assert.equal(res.status, 200);
});

test("ægte supabase-js: naiv select meldes, .range() og .limit() gør ikke", async () => {
  const reports = [];
  const baseFetch = async () => pgResponse(1000);
  const supabase = createClient("https://x.supabase.co", "anon", {
    global: { fetch: createSupabaseFetchWithRetry(baseFetch, { rowCapReport: (f) => reports.push(f), rowCapNow: () => 0 }) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await supabase.from("teams").select("id").order("id").range(0, 999);
  await supabase.from("teams").select("id").limit(1000);
  assert.equal(reports.length, 0);
  const { data } = await supabase.from("teams").select("id").eq("is_ai", false);
  assert.equal(data.length, 1000);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].table, "teams");
  assert.equal(reports[0].shape, "is_ai,select");
});
