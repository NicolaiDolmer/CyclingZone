// #3016 forward-guard: en notifikationstype der findes i kode men ikke i
// constraint-migrationen (eller omvendt) skal fejle HER — ikke tavst i prod.
// 3. gentagelse af mønstret (jf. learnings 2026-06-25 + 2026-07-04).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CONTRACT_EXPIRED_RELEASE_TYPE } from "./contractExpiryRelease.js";
import { SCOUT_REPORT_READY_TYPE } from "./notificationService.js";
import { isKnownNotificationType, NOTIFICATION_TYPES } from "./notificationTypes.js";
import { SEASON_TRANSITION_RISK_TYPE } from "./seasonTransitionNotice.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(
  __dirname,
  "../../database/2026-07-26-3016-notification-type-constraint.sql",
);

test("alle kode-typekonstanter findes i NOTIFICATION_TYPES", () => {
  for (const t of [
    SCOUT_REPORT_READY_TYPE,
    CONTRACT_EXPIRED_RELEASE_TYPE,
    SEASON_TRANSITION_RISK_TYPE,
  ]) {
    assert.ok(isKnownNotificationType(t), `"${t}" mangler i NOTIFICATION_TYPES`);
  }
});

test("NOTIFICATION_TYPES og constraint-migrationen er i paritet", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  const sqlTypes = [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const sqlSet = new Set(sqlTypes);

  for (const t of NOTIFICATION_TYPES) {
    assert.ok(sqlSet.has(t), `"${t}" findes i NOTIFICATION_TYPES men ikke i migrationen`);
  }
  for (const t of sqlSet) {
    assert.ok(
      isKnownNotificationType(t),
      `"${t}" findes i migrationen men ikke i NOTIFICATION_TYPES`,
    );
  }
});

test("ingen dubletter i NOTIFICATION_TYPES", () => {
  assert.equal(new Set(NOTIFICATION_TYPES).size, NOTIFICATION_TYPES.length);
});
