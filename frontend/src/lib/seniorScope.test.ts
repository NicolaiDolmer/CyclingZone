import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SENIOR_SQUAD_OR_FILTER,
  isSeniorSquad,
  filterSeniorSquadRows,
  applySeniorSquadFilter,
  isMissingRetiredAtColumnError,
  withActiveSeniorPools,
} from "./seniorScope.ts";

// Mock-query der opsamler .or()/.is()-kald (efterligner supabase-js's
// kæde-API, samme mønster som riderNameSearch.test.js).
function mockQuery(result: { data: unknown; error: unknown } = { data: [], error: null }) {
  const calls: { or: string[]; is: [string, null][] } = { or: [], is: [] };
  const q: {
    or: (s: string) => typeof q;
    is: (c: string, v: null) => typeof q;
    order: (...args: unknown[]) => typeof q;
    then: PromiseLike<typeof result>["then"];
    _calls: typeof calls;
  } = {
    or(s) { calls.or.push(s); return q; },
    is(c, v) { calls.is.push([c, v]); return q; },
    order() { return q; },
    then(onfulfilled, onrejected) { return Promise.resolve(result).then(onfulfilled, onrejected); },
    _calls: calls,
  };
  return q;
}

test("SENIOR_SQUAD_OR_FILTER er det delte PostgREST-filter (samme streng som backend's racePoolCatalog.js)", () => {
  assert.equal(SENIOR_SQUAD_OR_FILTER, "squad.is.null,squad.eq.senior");
});

test("isSeniorSquad: null/undefined/'senior' er senior, alt andet er ikke", () => {
  assert.equal(isSeniorSquad(null), true);
  assert.equal(isSeniorSquad(undefined), true);
  assert.equal(isSeniorSquad("senior"), true);
  assert.equal(isSeniorSquad("u23"), false);
  assert.equal(isSeniorSquad("junior"), false);
});

test("filterSeniorSquadRows: default læser row.squad direkte", () => {
  const rows = [{ id: 1, squad: null }, { id: 2, squad: "senior" }, { id: 3, squad: "u23" }, { id: 4, squad: "junior" }];
  assert.deepEqual(filterSeniorSquadRows(rows).map((r) => r.id), [1, 2]);
});

test("filterSeniorSquadRows: getSquad kan pege på et indlejret felt (season_standings' pool.squad)", () => {
  const rows = [
    { team_id: "a", pool: { squad: null } },
    { team_id: "b", pool: { squad: "senior" } },
    { team_id: "c", pool: { squad: "u23" } },
    { team_id: "d", pool: undefined },
  ];
  const kept = filterSeniorSquadRows(rows, (r) => r.pool?.squad).map((r) => r.team_id);
  assert.deepEqual(kept, ["a", "b", "d"]);
});

test("filterSeniorSquadRows: ikke-array giver tom liste (aldrig en kastet fejl på et null/undefined svar)", () => {
  assert.deepEqual(filterSeniorSquadRows(null), []);
  assert.deepEqual(filterSeniorSquadRows(undefined), []);
});

test("applySeniorSquadFilter: lægger ÉT .or()-kald med det delte filter", () => {
  const q = applySeniorSquadFilter(mockQuery());
  assert.deepEqual(q._calls.or, [SENIOR_SQUAD_OR_FILTER]);
});

test("isMissingRetiredAtColumnError: kun Postgres 42703 tæller", () => {
  assert.equal(isMissingRetiredAtColumnError(null), false);
  assert.equal(isMissingRetiredAtColumnError({ code: "42703", message: 'column "retired_at" does not exist' }), true);
  assert.equal(isMissingRetiredAtColumnError({ code: "42703", message: 'column "squad" does not exist' }), false); // anden kolonne
});

test("isMissingRetiredAtColumnError: PGRST204/schema-cache tæller IKKE (samme dom som backend's isMissingSquadColumnError)", () => {
  assert.equal(
    isMissingRetiredAtColumnError({ code: "PGRST204", message: "Could not find the 'retired_at' column of 'league_divisions' in the schema cache" }),
    false,
  );
  assert.equal(
    isMissingRetiredAtColumnError({ code: null, message: "retired_at: schema cache stale" }),
    false,
  );
});

test("isMissingRetiredAtColumnError: tekstmønster uden kode ('does not exist'/'undefined column') tæller også", () => {
  assert.equal(isMissingRetiredAtColumnError({ code: null, message: "column retired_at does not exist" }), true);
});

test("withActiveSeniorPools: normal sti lægger BÅDE senior-squad-or OG retired_at-is på", async () => {
  const q = mockQuery({ data: [{ id: 1 }], error: null });
  const result = await withActiveSeniorPools((scope) => scope(q));
  assert.deepEqual(q._calls.or, [SENIOR_SQUAD_OR_FILTER]);
  assert.deepEqual(q._calls.is, [["retired_at", null]]);
  assert.deepEqual(result, { data: [{ id: 1 }], error: null });
});

test("withActiveSeniorPools: {error} med 42703 på retired_at -> fallback-kald UDEN retired_at-filteret", async () => {
  let call = 0;
  const build = () => {
    call += 1;
    if (call === 1) {
      return mockQuery({ data: null, error: { code: "42703", message: 'column "retired_at" does not exist' } });
    }
    return mockQuery({ data: [{ id: 2 }], error: null });
  };
  const result = await withActiveSeniorPools((scope) => scope(build()));
  assert.equal(call, 2);
  assert.deepEqual(result, { data: [{ id: 2 }], error: null });
});

test("withActiveSeniorPools: kastet 42703-fejl (ikke {error}-form) -> samme fallback", async () => {
  let call = 0;
  const throwingQuery = { or: () => throwingQuery, is: () => { throw { code: "42703", message: "retired_at does not exist" }; } };
  const fallbackQuery = mockQuery({ data: [{ id: 3 }], error: null });
  const result = await withActiveSeniorPools((scope) => {
    call += 1;
    if (call === 1) return scope(throwingQuery as never);
    return scope(fallbackQuery);
  });
  assert.equal(call, 2);
  assert.deepEqual(result, { data: [{ id: 3 }], error: null });
});

test("withActiveSeniorPools: en ANDEN fejl (ikke retired_at-42703) bobler uændret op, ingen fallback", async () => {
  const q = mockQuery({ data: null, error: { code: "PGRST301", message: "network error" } });
  const result = await withActiveSeniorPools((scope) => scope(q));
  assert.deepEqual(result, { data: null, error: { code: "PGRST301", message: "network error" } });
});
