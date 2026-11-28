import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs, runSeasonStartResets } from "./seasonStartResets7470.js";

const NOW = new Date("2026-11-28T19:20:00Z"); // AGENTS rule 16: fast ur

function seasonsClient(rows) {
  return {
    from(table) {
      assert.equal(table, "seasons");
      const q = { select: () => q, in: async () => ({ data: rows, error: null }) };
      return q;
    },
  };
}

test("#7470 script: --to-season is required and the injury mode is validated", () => {
  assert.throws(() => parseArgs([]), /--to-season/);
  assert.throws(() => parseArgs(["--to-season", "6", "--injury-mode", "off"]), /injury-mode/);
  assert.deepEqual(parseArgs(["--to-season", "6", "--execute"]), { execute: true, toSeason: 6, injuryMode: "clear", formMode: "decay" });
  assert.equal(parseArgs(["--to-season", "6"]).execute, false, "dry-run by default");
});

test("#7470 script: refuses before the transition (new season not active, old not completed)", async () => {
  const log = () => {};
  await assert.rejects(() => runSeasonStartResets({ supabase: seasonsClient([{ id: "s5", number: 5, status: "active" }, { id: "s6", number: 6, status: "upcoming" }]), toSeason: 6, execute: false, log, now: NOW }), /Sæson 6 er ikke aktiv/);
  await assert.rejects(() => runSeasonStartResets({ supabase: seasonsClient([{ id: "s5", number: 5, status: "active" }, { id: "s6", number: 6, status: "active" }]), toSeason: 6, execute: false, log, now: NOW }), /Sæson 5 er ikke afsluttet/);
});
