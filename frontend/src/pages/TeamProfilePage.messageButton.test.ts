import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #5831 — sekundær "Send besked"-knap på holdsiden (kun her; ikke løbs- eller
// rytterside). Genbruger MessageManagerButton uden ny copy.

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "TeamProfilePage.jsx"), "utf8");

test("TeamProfilePage importerer MessageManagerButton", () => {
  assert.match(
    source,
    /import MessageManagerButton from "\.\.\/components\/messages\/MessageManagerButton";/,
  );
});

test("knappen renderes med team.id, manager_name og secondary/sm", () => {
  assert.match(
    source,
    /<MessageManagerButton teamId=\{team\.id\} managerName=\{team\.manager_name\} variant="secondary" size="sm" \/>/,
  );
});

test("knappen er gated på manager_name og !is_ai/!is_bank", () => {
  assert.match(
    source,
    /const canMessageManager = Boolean\(team\.manager_name\) && !team\.is_ai && !team\.is_bank;/,
  );
  assert.match(source, /canMessageManager && \(\s*<MessageManagerButton/);
});

test("hero-slottet vises også uden global rank", () => {
  assert.match(source, /\(globalRank \|\| canMessageManager\) && \(/);
  assert.match(source, /globalRank && \(\s*<Button/);
});
