// Kontrakt-test for P3-fixet (#1338): Supabase-fejl i historik-pipelines må IKKE
// længere sluges som tom liste — de skal overflades (kastes), så rutens try/catch
// returnerer 500 og fejlen bliver synlig i logs/Sentry.
//
// Tester både den fælles guard direkte OG end-to-end via buildRiderHistory /
// buildTeamTransferHistory, så regressionen fanges uanset hvor guarden måtte
// blive fjernet ved en fremtidig refaktorering.

import test from "node:test";
import assert from "node:assert/strict";

const { assertNoSupabaseError } = await import("./supabaseResultGuard.js");
const { buildRiderHistory } = await import("./riderHistory.js");
const { buildTeamTransferHistory } = await import("./teamTransferHistory.js");

// --- Direkte enhedstest af guarden ---

test("assertNoSupabaseError — passerer når ingen resultater har error", () => {
  assert.doesNotThrow(() => {
    assertNoSupabaseError({
      a: { data: [], error: null },
      b: { data: [{ id: 1 }], error: null },
    }, "ctx");
  });
});

test("assertNoSupabaseError — kaster når mindst ét resultat har error", () => {
  assert.throws(
    () => assertNoSupabaseError({
      a: { data: null, error: { message: "permission denied" } },
      b: { data: [], error: null },
    }, "buildX"),
    (err) => {
      assert.equal(err.code, "SUPABASE_QUERY_ERROR");
      assert.match(err.message, /buildX/);
      assert.match(err.message, /permission denied/);
      assert.deepEqual(err.supabaseErrors, ["a: permission denied"]);
      return true;
    }
  );
});

test("assertNoSupabaseError — samler flere fejl med tabel-kontekst", () => {
  assert.throws(
    () => assertNoSupabaseError({
      auctions: { data: null, error: { message: "timeout" } },
      seasons: { data: null, error: { code: "PGRST301" } },
    }, "buildTeamTransferHistory"),
    (err) => {
      assert.match(err.message, /auctions: timeout/);
      assert.match(err.message, /seasons: PGRST301/);
      return true;
    }
  );
});

// --- Mock-supabase der kan injicere en fejl på en valgt tabel ---

function createErroringSupabase(errorTable, errorObj = { message: "boom" }) {
  function buildQuery(table) {
    const chain = {
      select() { return chain; },
      or() { return chain; },
      in() { return chain; },
      eq() { return chain; },
      order() {
        if (table === errorTable) {
          return Promise.resolve({ data: null, error: errorObj });
        }
        return Promise.resolve({ data: [], error: null });
      },
    };
    return chain;
  }
  return { from(table) { return buildQuery(table); } };
}

// --- End-to-end regression-guards ---

test("buildRiderHistory — kaster (sluger IKKE) når en query fejler (#1338)", async () => {
  const supabase = createErroringSupabase("auctions", { message: "permission denied for table auctions" });
  await assert.rejects(
    () => buildRiderHistory(supabase, "rider-X"),
    (err) => {
      assert.equal(err.code, "SUPABASE_QUERY_ERROR");
      assert.match(err.message, /auctions/);
      return true;
    },
    "en Supabase-fejl skal overflades som kastet fejl, ikke returneres som tom historik"
  );
});

test("buildRiderHistory — returnerer stadig [] når alt lykkes uden rækker", async () => {
  const supabase = createErroringSupabase(null); // ingen tabel fejler
  const events = await buildRiderHistory(supabase, "rider-X");
  assert.deepEqual(events, [], "tom-men-succesfuld historik skal stadig give []");
});

test("buildTeamTransferHistory — kaster når en query fejler (#1338)", async () => {
  const supabase = createErroringSupabase("loan_agreements", { message: "permission denied for table loan_agreements" });
  await assert.rejects(
    () => buildTeamTransferHistory(supabase, "team-X"),
    (err) => {
      assert.equal(err.code, "SUPABASE_QUERY_ERROR");
      assert.match(err.message, /loan_agreements/);
      return true;
    }
  );
});

test("buildTeamTransferHistory — kaster når seasons-query fejler (#1338)", async () => {
  const supabase = createErroringSupabase("seasons", { message: "timeout" });
  await assert.rejects(
    () => buildTeamTransferHistory(supabase, "team-X"),
    (err) => {
      assert.equal(err.code, "SUPABASE_QUERY_ERROR");
      assert.match(err.message, /seasons/);
      return true;
    }
  );
});

test("buildTeamTransferHistory — returnerer stadig [] når alt lykkes uden rækker", async () => {
  const supabase = createErroringSupabase(null);
  const events = await buildTeamTransferHistory(supabase, "team-X");
  assert.deepEqual(events, [], "tom-men-succesfuld historik skal stadig give []");
});
