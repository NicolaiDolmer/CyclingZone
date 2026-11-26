// #8797 — browser-klienten melder læsninger der rammer 1.000-rækkeloftet.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRowCapAlarmFetch } from "./supabaseRowCapAlarm.js";

function pgResponse(rows) {
  return new Response("[]", { status: 200, headers: { "content-range": `0-${rows - 1}/*` } });
}

test("naiv læsning med præcis 1.000 rækker rapporteres, .range() gør ikke", async () => {
  const reports = [];
  const f = createRowCapAlarmFetch(async () => pgResponse(1000), (x) => reports.push(x));
  await f("https://x.supabase.co/rest/v1/riders?select=nationality_code", { method: "GET" });
  await f("https://x.supabase.co/rest/v1/riders?select=id&offset=0&limit=1000", { method: "GET" });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].table, "riders");
});

test("supabase.ts sætter alarm-fetchen på browser-klienten", () => {
  const src = readFileSync(new URL("./supabase.ts", import.meta.url), "utf8");
  assert.match(src, /global:\s*\{\s*fetch:\s*createRowCapAlarmFetch\(\)\s*\}/);
});
