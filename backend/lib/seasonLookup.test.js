// backend/lib/seasonLookup.test.js
// #4270/#4557: laaser kontrakten "en 'upcoming'-raekke er NOK til at aarsmoedet finder
// naeste saeson". Uden den kan et fremtidigt opslag stille begynde at filtrere paa
// status='active' — og saa faar intet hold et mandat for saeson 4, uden at noget fejler.

import test from "node:test";
import assert from "node:assert/strict";

import { findNextSeason, findSeasonByNumber } from "./seasonLookup.js";

/**
 * Minimal stub der efterligner PostgREST-kaeden supabase-js bygger:
 * from("seasons").select(cols).eq(col, val).maybeSingle().
 * Registrerer HVILKE filtre der blev sat, saa testen kan bevise at status IKKE filtreres.
 */
function stubSupabase(rows, { error = null } = {}) {
  const calls = { table: null, columns: null, filters: [] };
  const builder = {
    select(cols) { calls.columns = cols; return builder; },
    eq(col, val) { calls.filters.push([col, val]); return builder; },
    async maybeSingle() {
      if (error) return { data: null, error };
      const match = rows.find((r) => calls.filters.every(([c, v]) => r[c] === v)) ?? null;
      return { data: match, error: null };
    },
  };
  return {
    calls,
    from(table) { calls.table = table; return builder; },
  };
}

const S3 = { id: "00000000-0000-0000-0000-000000000003", number: 3, status: "active", start_date: "2026-08-28" };
const S4_UPCOMING = { id: "00000000-0000-0000-0000-000000000004", number: 4, status: "upcoming", start_date: "2026-09-28" };

test("#4270: en 'upcoming'-række for sæson 4 er nok — årsmødet finder den", async () => {
  const supabase = stubSupabase([S3, S4_UPCOMING]);
  const res = await findNextSeason({ supabase, currentNumber: 3 });

  assert.equal(res.found, true);
  assert.equal(res.number, 4);
  assert.equal(res.season.status, "upcoming");
  assert.equal(res.season.id, S4_UPCOMING.id);
});

test("#4270: opslaget filtrerer KUN på number — aldrig på status", async () => {
  const supabase = stubSupabase([S3, S4_UPCOMING]);
  await findNextSeason({ supabase, currentNumber: 3 });

  assert.equal(supabase.calls.table, "seasons");
  assert.deepEqual(supabase.calls.filters, [["number", 4]]);
  assert.equal(supabase.calls.filters.some(([col]) => col === "status"), false,
    "et status-filter ville gøre en pre-oprettet 'upcoming'-sæson usynlig for årsmødet");
});

test("#4270: mangler rækken, siger opslaget fra i stedet for at gætte", async () => {
  const supabase = stubSupabase([S3]);
  const res = await findNextSeason({ supabase, currentNumber: 3 });

  assert.equal(res.found, false);
  assert.equal(res.season, null);
  assert.equal(res.number, 4);
});

test("#4270: findSeasonByNumber slår op på præcis det nummer den får", async () => {
  const supabase = stubSupabase([S3, S4_UPCOMING]);
  const res = await findSeasonByNumber({ supabase, number: 3 });

  assert.equal(res.found, true);
  assert.equal(res.season.number, 3);
});

test("#4270: en DB-fejl må ikke ligne 'sæsonen findes ikke'", async () => {
  const supabase = stubSupabase([], { error: { message: "statement timeout" } });
  await assert.rejects(
    () => findNextSeason({ supabase, currentNumber: 3 }),
    /seasons lookup failed: statement timeout/,
  );
});

test("#4270: currentNumber skal være et tal", async () => {
  const supabase = stubSupabase([S3]);
  await assert.rejects(() => findNextSeason({ supabase, currentNumber: "tre" }), /currentNumber/);
});
