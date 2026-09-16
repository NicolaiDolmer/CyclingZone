// #3042 — bind Dashboard-nudgens kontrakt til SAMME payload-form som
// GET /api/races/:id/selection (det RaceSelectionPanel/løbssiden bruger).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSquadSelectionMissing } from "./raceSquadSelectionStatus.js";

test("full trup (kun auto-fyldte entries, 0 manuelle) -> IKKE missing (#3042 repro)", () => {
  // Reproducerer prod-bugget: raceEntryGenerator har top-fyldt hele truppen
  // automatisk (is_auto_filled=true for alle), ingen manuelle valg — men truppen
  // ER fuld, ligesom løbssiden viser (sel.riderIds.length >= size.max).
  const body = {
    enabled: true,
    size: { min: 8, max: 8 },
    selection: { rider_ids: Array.from({ length: 8 }, (_, i) => `r${i}`), is_auto_filled: true },
  };
  assert.equal(isSquadSelectionMissing(body), false);
});

test("delvis manuel trup under target -> missing", () => {
  const body = {
    enabled: true,
    size: { min: 6, max: 6 },
    selection: { rider_ids: ["r1", "r2", "r3"], is_auto_filled: false },
  };
  assert.equal(isSquadSelectionMissing(body), true);
});

test("ingen entries overhovedet (selection=null) -> missing", () => {
  const body = { enabled: true, size: { min: 6, max: 6 }, selection: null };
  assert.equal(isSquadSelectionMissing(body), true);
});

test("fuld manuel trup -> IKKE missing", () => {
  const body = {
    enabled: true,
    size: { min: 6, max: 6 },
    selection: { rider_ids: ["r1", "r2", "r3", "r4", "r5", "r6"], is_auto_filled: false },
  };
  assert.equal(isSquadSelectionMissing(body), false);
});

test("flag OFF (enabled:false) -> aldrig missing (feature ikke aktiv)", () => {
  assert.equal(isSquadSelectionMissing({ enabled: false, race: { id: "x", status: "scheduled" } }), false);
});

test("manglende/ukendt payload -> aldrig false-positive nudge", () => {
  assert.equal(isSquadSelectionMissing(null), false);
  assert.equal(isSquadSelectionMissing(undefined), false);
  assert.equal(isSquadSelectionMissing({ enabled: true, selection: null }), false); // size.max ukendt
});

// #5301 — et AFMELDT hold mangler ikke en udtagelse, det har truffet et valg.
// Prod-repro (Discord 16/9, egomadsen): Bacon Fræsers meldte fra til Tour du Hedjaz,
// de 5 manuelt udtagne entries blev bevaret (#4306), size.max var 8 — og Dashboard
// bad derfor om en trup til et løb holdet bevidst ikke stillede op i.
test("afmeldt hold med bevaret delvis trup -> IKKE missing (#5301 repro)", () => {
  const body = {
    enabled: true,
    withdrawn: true,
    size: { min: 6, max: 8 },
    selection: { rider_ids: ["r1", "r2", "r3", "r4", "r5"], is_auto_filled: false },
  };
  assert.equal(isSquadSelectionMissing(body), false);
});

test("afmeldt hold HELT uden entries -> IKKE missing (#5301)", () => {
  const body = { enabled: true, withdrawn: true, size: { min: 6, max: 6 }, selection: null };
  assert.equal(isSquadSelectionMissing(body), false);
});

test("withdrawn:false aendrer intet — delvis trup er stadig missing (#5301)", () => {
  const body = {
    enabled: true,
    withdrawn: false,
    size: { min: 6, max: 6 },
    selection: { rider_ids: ["r1"], is_auto_filled: false },
  };
  assert.equal(isSquadSelectionMissing(body), true);
});

// Forward-guard: et endpoint der (endnu) ikke sender feltet maa opfoere sig
// praecis som foer #5301 — ellers ville fixet skjule aegte manglende udtagelser.
test("manglende withdrawn-felt -> uaendret adfaerd (#5301)", () => {
  const body = { enabled: true, size: { min: 6, max: 6 }, selection: { rider_ids: ["r1"] } };
  assert.equal(isSquadSelectionMissing(body), true);
});
