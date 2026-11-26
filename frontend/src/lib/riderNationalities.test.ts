// #8797 — nationalitetsfiltret mangler ingen nationer, heller ikke over 1.000 ryttere.
import test from "node:test";
import assert from "node:assert/strict";
import { loadRiderNationalities } from "./riderNationalities.ts";

type Row = Record<string, unknown>;

// Minimal PostgREST-agtig fake: afkorter ved 1.000 uden .range(), som prod.
function fakeSupabase(tables: Record<string, Row[]>, { viewError = null }: { viewError?: { message: string } | null } = {}) {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let range: [number, number] | null = null;
      const q = {
        select() { return q; },
        eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return q; },
        neq(c: string, v: unknown) { filters.push((r) => r[c] !== v); return q; },
        order() { return q; },
        range(from: number, to: number) { range = [from, to]; return q; },
        then(resolve: (v: { data: Row[] | null; error: unknown }) => unknown) {
          if (table === "rider_nationality_codes" && viewError) return resolve({ data: null, error: viewError });
          let rows = (tables[table] || []).filter((r) => filters.every((f) => f(r)));
          rows = range ? rows.slice(range[0], range[1] + 1) : rows.slice(0, 1000);
          return resolve({ data: rows, error: null });
        },
      };
      return q;
    },
  };
}

// 2.500 ryttere, hvor de sidste nationer kun findes efter række 1.000.
const riders: Row[] = Array.from({ length: 2500 }, (_, i) => ({
  id: i, is_retired: false, nationality_code: i < 2400 ? "DK" : (i % 2 ? "NO" : "SE"),
}));

test("viewet bruges når det findes", async () => {
  const sb = fakeSupabase({ rider_nationality_codes: [{ nationality_code: "SE" }, { nationality_code: "DK" }] });
  assert.deepEqual(await loadRiderNationalities(sb), ["DK", "SE"]);
});

test("uden viewet pagineres rytterne, så nationer efter række 1.000 kommer med", async () => {
  const sb = fakeSupabase({ riders }, { viewError: { message: "relation does not exist" } });
  assert.deepEqual(await loadRiderNationalities(sb), ["DK", "NO", "SE"]);
});
