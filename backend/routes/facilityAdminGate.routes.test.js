import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const api = readFileSync(join(here, "api.js"), "utf8");

test("facility-ruter resolver facilitiesEnabled fra flag ELLER admin", () => {
  assert.match(api, /readFlagStage\(\s*supabase\s*,\s*["']facilities_enabled["']\s*\)/);
  assert.match(api, /isViewerAdmin\(req\)/);
  assert.match(api, /resolveFacilitiesEnabled/);
});

test("alle 6 /club/-ruter tråder flags ind i handleren", () => {
  const clubHandlerCalls = api.match(/\b(getClubFacilitiesHandler|postFacilityUpgradeHandler|getStaffCandidatesHandler|postStaffHireHandler|postStaffFireHandler|getStaffProfileHandler)\([^)]*\)/g) || [];
  assert.ok(clubHandlerCalls.length >= 6, "forventede mindst 6 handler-kald");
  for (const call of clubHandlerCalls) {
    assert.match(call, /flags/, `handler-kald mangler flags: ${call}`);
  }
});
