import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "App.jsx"), "utf8");

test("#4557 /board-routen er en tynd flag-wrapper (BoardroomRoute), ikke direkte BoardPage", () => {
  assert.match(source, /const BoardroomRoute = lazy\(\(\) => import\("\.\/pages\/boardroom\/BoardroomRoute"\)\);/);
  assert.match(
    source,
    /<Route path="board" element=\{<I18nReadyGate ns="board"><I18nReadyGate ns="backendMessages"><BoardroomRoute LegacyBoardPage=\{BoardPage\} \/><\/I18nReadyGate><\/I18nReadyGate>\} \/>/,
  );
});

test("#4557 BoardPage forbliver lazy-importeret (genbruges som LegacyBoardPage-prop, ikke duplikeret)", () => {
  assert.match(source, /const BoardPage = lazy\(\(\) => import\("\.\/pages\/BoardPage"\)\);/);
});
