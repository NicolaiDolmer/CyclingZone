import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// #1075 · De kanoniske schema-spejl skal matche prod (migration 2026-04-24):
// per-(board_id, season_number) — ikke det oprindelige per-team-index
// (2026-04-22), som tillod kun 1 request/hold/sæson. Parallelle 1/3/5-års-
// planer betyder op til 3 requests/hold/sæson (én pr. plan). De historiske
// migrations bevares uændret som point-in-time-records og asserteres ikke her.
test("board request schema enforces one request per board (plan) per season", () => {
  const canonicalFiles = [
    resolve(__dirname, "../../database/schema.sql"),
    resolve(__dirname, "../../database/supabase_setup.sql"),
  ];

  for (const filePath of canonicalFiles) {
    const content = readFileSync(filePath, "utf8");
    assert.match(
      content,
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_board_request_log_board_season_unique[\s\S]*\(board_id,\s*season_number\)[\s\S]*WHERE season_number IS NOT NULL/,
      `${filePath} skal definere per-board unique-index (matcher prod-migration 2026-04-24)`
    );
    // Forward-guard mod re-drift: det udfasede per-team-index må ikke gen-opstå.
    assert.doesNotMatch(
      content,
      /idx_board_request_log_team_season_unique/,
      `${filePath} må ikke længere referere det udfasede per-team-index`
    );
  }
});
