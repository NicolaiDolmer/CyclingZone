import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// #2601 — source-string-guard for TeamClubTab-wiringen (spejler KlubPage.wiring.test.js):
// læs kildefilen som tekst og assertér på nøgle-wiring uden jsdom.
const src = readFileSync(new URL("./TeamClubTab.jsx", import.meta.url), "utf8");

test("TeamClubTab bruger useTeamPublicProfile + gater på enabled/error", () => {
  assert.match(src, /useTeamPublicProfile\(teamId\)/);
  assert.match(src, /if \(!enabled\)/);
  assert.match(src, /EmptyState/);
});

test("TeamClubTab genbruger klub- og staff-namespace (ikke ny copy for eksisterende roller/spor)", () => {
  assert.match(src, /useTranslation\("klub"\)/);
  assert.match(src, /useTranslation\("staff"\)/);
  assert.match(src, /tKlub\(`tracks\.\$\{f\.track\}\.name`\)/);
  assert.match(src, /tStaff\(`roles\.\$\{f\.track\}`\)/);
});

test("TeamClubTab har INGEN køb/ansæt/fyr-affordances (read-only per arkitekt-beslutning #2601)", () => {
  assert.doesNotMatch(src, /onUpgrade/);
  assert.doesNotMatch(src, /onOpenStaff/);
  assert.doesNotMatch(src, /onHire/);
  assert.doesNotMatch(src, /onFire/);
  assert.doesNotMatch(src, /StaffPanel/);
  assert.doesNotMatch(src, /ConfirmModal/);
});

test("TeamClubTab eksponerer ALDRIG løn/upgradePrice/seasonCost i render (sanitering matcher backend-kontrakten)", () => {
  assert.doesNotMatch(src, /\.salary\b/, "må aldrig læse .salary — backend-kontrakten leverer det aldrig, men UI'et skal heller aldrig FORSØGE at læse det");
  assert.doesNotMatch(src, /upgradePrice/);
  assert.doesNotMatch(src, /seasonCost/);
});
