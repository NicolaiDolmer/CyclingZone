// #6181 · Saesonskiftet venter paa laaste salg (ejer 13/11, fast regel), dommerens B8.
//
// Spaerren i scriptet executeSeasonTransition.js er flyttet til en lille funktion,
// saa den kan proeves paa adfaerd: een holdt laas stopper, ingen lader skiftet koere,
// en laesefejl stopper. Scriptet kalder funktionen, foer skiftet koerer.
//
// Refs #6181
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { saleEscrowTransitionGuard } from "./saleEscrowView6181.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Svarer som supabase-js paa select("id", { count, head }).eq("status", "held"). */
function escrowCount({ held = 0, error = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      const q = {
        select() { return q; },
        eq(col, val) {
          assert.deepEqual([col, val], ["status", "held"]);
          return Promise.resolve(error ? { count: null, error } : { count: held, error: null });
        },
      };
      return q;
    },
  };
}

test("een holdt laas stopper skiftet", async () => {
  assert.deepEqual(await saleEscrowTransitionGuard(escrowCount({ held: 1 }), { execute: true }), { blocked: true, held: 1 });
});

test("ingen holdte laase: skiftet koerer", async () => {
  assert.deepEqual(await saleEscrowTransitionGuard(escrowCount({ held: 0 }), { execute: true }), { blocked: false, held: 0 });
});

test("laesefejl stopper skiftet (fail-closed)", async () => {
  const res = await saleEscrowTransitionGuard(escrowCount({ error: { code: "XX000", message: "boom" } }), { execute: true });
  assert.equal(res.blocked, true);
});

test("tabellen findes ikke (laasen er aldrig bygget): skiftet koerer", async () => {
  const res = await saleEscrowTransitionGuard(escrowCount({ error: { code: "42P01", message: "missing" } }), { execute: true });
  assert.deepEqual(res, { blocked: false, held: 0 });
});

test("proevekoersel uden --execute laeser ikke og stopper ikke", async () => {
  const supabase = escrowCount({ held: 3 });
  assert.deepEqual(await saleEscrowTransitionGuard(supabase, { execute: false }), { blocked: false, held: 0 });
  assert.deepEqual(supabase.calls, []);
});

test("scriptet kalder spaerren og stopper, foer skiftet koerer", () => {
  const src = readFileSync(join(__dirname, "../scripts/executeSeasonTransition.js"), "utf8").replace(/\r\n/g, "\n");
  const guard = src.indexOf("await saleEscrowTransitionGuard(supabase, { execute: EXECUTE })");
  const run = src.indexOf("await transitionToNextSeason(");
  assert.ok(guard > 0 && guard < run, "spaerren skal ligge foer skiftet");
  assert.match(src.slice(guard, run), /if \(saleEscrowGuard\.blocked\) \{\n\s*console\.error\([^\n]*\);\n\s*process\.exit\(1\);\n\}/);
});
