import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("board request schema enforces one request per team per season", () => {
  const files = [
    resolve(__dirname, "../../database/schema.sql"),
    resolve(__dirname, "../../database/supabase_setup.sql"),
    resolve(__dirname, "../../database/2026-04-22-board-request-log.sql"),
  ];

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf8");
    assert.match(
      content,
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_board_request_log_team_season_unique[\s\S]*\(team_id,\s*season_number\)[\s\S]*WHERE season_number IS NOT NULL/
    );
  }
});
