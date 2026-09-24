import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SQUAD_CAPS,
  academyTargetSquad,
  isSquadFull,
  squadCapRows,
  demoteCapLabels,
  fetchAcademySquadCounts,
} from "./squadCaps.ts";

const SEASON_YEAR = 2027;

test("academyTargetSquad: sæsonalder <= 18 -> junior, 19+ -> u23 (også 23+, Graduation Day)", () => {
  assert.equal(academyTargetSquad("2010-05-01", SEASON_YEAR), "junior"); // 17
  assert.equal(academyTargetSquad("2009-12-31", SEASON_YEAR), "junior"); // 18
  assert.equal(academyTargetSquad("2008-01-01", SEASON_YEAR), "u23"); // 19
  assert.equal(academyTargetSquad("2003-01-01", SEASON_YEAR), "u23"); // 24
});

test("academyTargetSquad: ukendt fødselsdato -> junior, ukendt sæson -> null (intet gæt)", () => {
  assert.equal(academyTargetSquad(null, SEASON_YEAR), "junior");
  assert.equal(academyTargetSquad("2008-01-01", null), null);
});

test("isSquadFull: tæller mod MÅL-truppens eget loft", () => {
  assert.equal(isSquadFull("u23", { u23: 8, junior: 0 }), false);
  assert.equal(isSquadFull("u23", { u23: SQUAD_CAPS.u23, junior: 0 }), true);
  assert.equal(isSquadFull("junior", { u23: 0, junior: SQUAD_CAPS.junior - 1 }), false);
  assert.equal(isSquadFull("junior", { u23: 0, junior: SQUAD_CAPS.junior }), true);
});

test("isSquadFull: ukendt antal eller trup er aldrig fuld", () => {
  assert.equal(isSquadFull("u23", { u23: null, junior: null }), false);
  assert.equal(isSquadFull(null, { u23: 99, junior: 99 }), false);
  assert.equal(isSquadFull("u23", null), false);
});

test("squadCapRows: 'U23 5/12 · Junior 3/10' i fast rækkefølge", () => {
  assert.deepEqual(squadCapRows({ u23: 5, junior: 10 }), [
    { squad: "u23", used: 5, max: SQUAD_CAPS.u23, full: false },
    { squad: "junior", used: 10, max: SQUAD_CAPS.junior, full: true },
  ]);
  assert.deepEqual(squadCapRows(null).map((r) => r.used), [0, 0]);
});

test("demoteCapLabels: nedrykningsdialogen viser MÅL-truppen, ikke hele akademiet", () => {
  assert.deepEqual(demoteCapLabels({ targetSquad: "u23", squadUsed: 8, squadMax: 12 }), {
    capSquad: "u23", capLabel: "8 / 12", capAfterLabel: "9 / 12",
  });
  assert.deepEqual(demoteCapLabels({ targetSquad: "junior", squadUsed: 3, squadMax: 10 }), {
    capSquad: "junior", capLabel: "3 / 10", capAfterLabel: "4 / 10",
  });
});

test("demoteCapLabels: manglende/ufuldstændig quote -> null (rækken udelades, intet fladt tal)", () => {
  assert.equal(demoteCapLabels(null), null);
  assert.equal(demoteCapLabels({ targetSquad: "senior", squadUsed: 1, squadMax: 30 }), null);
  assert.equal(demoteCapLabels({ targetSquad: "u23", squadUsed: null, squadMax: 12 }), null);
  assert.equal(demoteCapLabels({ targetSquad: "u23", squadUsed: 3 }), null);
});

test("fetchAcademySquadCounts: én head-optælling pr. trup på riders.squad", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const counts: Record<string, number> = { u23: 8, junior: 2 };
  type Client = Parameters<typeof fetchAcademySquadCounts>[0];
  type Builder = ReturnType<ReturnType<Client["from"]>["select"]>;
  type Result = { count?: number | null; error?: unknown };
  const makeBuilder = (filters: Record<string, unknown>): Builder => ({
    eq: (col: string, val: unknown) => makeBuilder({ ...filters, [col]: val }),
    then<T1 = Result, T2 = never>(
      onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
      onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ): PromiseLike<T1 | T2> {
      calls.push({ ...filters });
      return Promise.resolve<Result>({ count: counts[filters.squad as string], error: null }).then(onfulfilled, onrejected);
    },
  });
  const client: Client = {
    from(table: "riders") {
      assert.equal(table, "riders");
      return { select: () => makeBuilder({}) };
    },
  };
  assert.deepEqual(await fetchAcademySquadCounts(client, "team-A"), { u23: 8, junior: 2 });
  assert.deepEqual(calls, [{ team_id: "team-A", squad: "u23" }, { team_id: "team-A", squad: "junior" }]);
  assert.deepEqual(await fetchAcademySquadCounts(client, null), { u23: null, junior: null });
});
