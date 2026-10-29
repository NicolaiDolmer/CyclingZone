// #7239: udtagelsespanelet kan vaelge den delte kaptajn, og intet gem herfra nulstiller ham.
// Ingen jsdom i kodebasen, saa wiringen pin'es som kildekode-guards (samme moenster som
// de oevrige RaceSelectionPanel.*.test-filer); logikken er testet i raceSelectionLogic.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("./RaceSelectionPanel.jsx", import.meta.url), "utf8");

test("#7239: serverens delte kaptajn laeses ind i panelets state", () => {
  assert.match(panel, /coCaptainId: body\.selection\.co_captain_id \?\? null/);
  assert.match(panel, /const EMPTY_SELECTION = \{[^}]*coCaptainId: null[^}]*\}/);
});

test("#7239: gem sender altid co_captain_id (aldrig udeladt, saa intet nulstilles i stilhed)", () => {
  const saveIdx = panel.indexOf("async function save()");
  const autoIdx = panel.indexOf("async function autoSelect()");
  const save = panel.slice(saveIdx, autoIdx);
  assert.match(save, /co_captain_id: coCaptainId,/);
  assert.match(save, /sel\.riderIds\.includes\(sel\.coCaptainId\)/);
});

test("#7239: vaelgeren vises kun i loeb der kender rollen og er laast uden kaptajn", () => {
  const idx = panel.indexOf('label={t("selection.coCaptain")}');
  assert.ok(idx > 0, "delt kaptajn-vaelgeren findes");
  const block = panel.slice(panel.lastIndexOf("{data.sprint_leader_allowed === true && (", idx), idx + 600);
  assert.ok(block.startsWith("{data.sprint_leader_allowed === true && ("), "bag samme v3-gate som spurtkaptajn alene");
  assert.match(block, /!sel\.captainId && !sel\.coCaptainId/);
  assert.match(block, /selection\.errors\.selection_co_captain_requires_captain/);
});
