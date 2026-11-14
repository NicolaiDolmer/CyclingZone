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

import { saleEscrowTransitionGuard, SALE_ESCROW_FORCE_BLOCKED_ERROR } from "./saleEscrowView6181.js";

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

// ── Dommens manglende veje: manuel saesonstart og manuel saesonafslutning ──
// Den aegte rute-krop fra routes/api.js koeres med den aegte spaerre og en lille
// supabase-attrap. Foerste skrivning (start) og claim'et (afslutning) er vagtposter:
// en spaerret anmodning maa aldrig naa dem.

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const API_SRC = readFileSync(join(__dirname, "../routes/api.js"), "utf8").replace(/\r\n/g, "\n");

/** @param {string} route @param {string[]} names */
function routeHandler(route, names) {
  const start = API_SRC.indexOf(`router.post("${route}"`);
  assert.ok(start > 0, `ruten ${route} findes ikke`);
  const bodyStart = API_SRC.indexOf("async (req, res) => {", start) + "async (req, res) => {".length;
  return new AsyncFunction("req", "res", ...names, API_SRC.slice(bodyStart, API_SRC.indexOf("\n});", bodyStart)));
}

/** Saesoner + sale_escrows + app_config (kontakten), som ruterne og spaerren laeser dem. */
function seasonDb({ status, held = 0, escrowError = null, flag = "off" }) {
  const reads = [];
  const season = { id: "s5", number: 5, status, start_date: null, end_date: null };
  return {
    reads,
    from(table) {
      reads.push(table);
      if (table === "sale_escrows") return escrowCount({ held, error: escrowError }).from(table);
      if (table === "app_config") {
        const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { value: flag }, error: null }) };
        return q;
      }
      if (table === "races") return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      // seasons: .single() giver saesonen; et head-count (aktive saesoner) giver 0.
      const q = {
        select: () => q,
        eq: () => q,
        single: async () => ({ data: season, error: null }),
        then: (resolve, reject) => Promise.resolve({ count: 0, error: null }).then(resolve, reject),
      };
      return q;
    },
  };
}

function captureRes() {
  const out = { status: 200, body: undefined };
  out.res = { status(v) { out.status = v; return out.res; }, json(v) { out.body = v; return out.res; } };
  return out;
}

const REACHED_FIRST_WRITE = new Error("vagtpost: foerste skrivning naaet");

/** Manuel saesonstart: stopper ved spaerren, eller naar foerste skrivning (ensureSeasonStandings). */
async function runManualStart(dbOpts) {
  const supabase = seasonDb({ status: "upcoming", ...dbOpts });
  const handler = routeHandler("/admin/seasons/:id/start", ["supabase", "ensureSeasonStandings", "captureApiRouteError", "saleEscrowTransitionGuard", "SALE_ESCROW_FORCE_BLOCKED_ERROR"]);
  let wrote = false;
  const out = captureRes();
  await handler({ params: { id: "s5" } }, out.res, supabase,
    async () => { wrote = true; throw REACHED_FIRST_WRITE; },
    (e) => { if (e !== REACHED_FIRST_WRITE) throw e; },
    saleEscrowTransitionGuard, SALE_ESCROW_FORCE_BLOCKED_ERROR);
  return { ...out, wrote, reads: supabase.reads };
}

/** Manuel saesonafslutning: stopper ved spaerren, eller naar claim'et (foer alt irreversibelt). */
async function runManualEnd(dbOpts) {
  const supabase = seasonDb({ status: "active", ...dbOpts });
  const handler = routeHandler("/admin/seasons/:id/end", ["supabase", "assessSeasonEndBlockers", "assessFinalTrainingDateSettlement", "claimSeasonEndOrReject", "captureApiRouteError", "saleEscrowTransitionGuard", "SALE_ESCROW_FORCE_BLOCKED_ERROR"]);
  let claimed = false;
  const out = captureRes();
  await handler({ params: { id: "s5" } }, out.res, supabase,
    async () => ({ blocked: false }), async () => ({ blocked: false }),
    async () => { claimed = true; return false; },
    (e) => { throw e; },
    saleEscrowTransitionGuard, SALE_ESCROW_FORCE_BLOCKED_ERROR);
  return { ...out, claimed, reads: supabase.reads };
}

for (const [label, run, sentinel] of [
  ["manuel saesonstart", runManualStart, "wrote"],
  ["manuel saesonafslutning", runManualEnd, "claimed"],
]) {
  test(`${label}: een holdt laas giver 409 og naar aldrig ${sentinel === "wrote" ? "foerste skrivning" : "claim'et"}`, async () => {
    const r = await run({ held: 1 });
    assert.equal(r[sentinel], false);
    assert.equal(r.status, 409);
    assert.deepEqual(r.body, { error: SALE_ESCROW_FORCE_BLOCKED_ERROR, code: "held_sale_escrows", held_sale_escrows: 1 });
  });

  test(`${label}: laesefejl paa sale_escrows stopper (fail-closed)`, async () => {
    const r = await run({ escrowError: { code: "XX000", message: "boom" } });
    assert.equal(r[sentinel], false);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "held_sale_escrows");
  });

  test(`${label}: kontakten slukket og 0 laase er uaendret (koerer videre)`, async () => {
    const r = await run({ held: 0, flag: "off" });
    assert.equal(r[sentinel], true);
    assert.notEqual(r.status, 409);
    assert.ok(!r.reads.includes("app_config"), "spaerren afhaenger af laasene, ikke af kontakten");
  });

  test(`${label}: tabellen findes ikke (laasen aldrig bygget) er uaendret`, async () => {
    const r = await run({ escrowError: { code: "42P01", message: "missing" } });
    assert.equal(r[sentinel], true);
    assert.notEqual(r.status, 409);
  });

  test(`${label}: en holdt laas stopper ogsaa, selv om kontakten er slukket igen`, async () => {
    const r = await run({ held: 2, flag: "off" });
    assert.equal(r[sentinel], false);
    assert.equal(r.body.held_sale_escrows, 2);
  });
}
