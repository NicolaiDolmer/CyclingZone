// #3016 forward-guard: en notifikationstype der findes i kode men ikke i
// constraint-migrationen (eller omvendt) skal fejle HER — ikke tavst i prod.
// 3. gentagelse af mønstret (jf. learnings 2026-06-25 + 2026-07-04).
// #3032 (4. recidiv — Sentry CYCLINGZONE-3F, GET /api/scouting/me): de 20
// events lå ALLE 25/7 18:40–26/7 11:08, dvs. FØR #3016-migrationen blev
// applied i prod (26/7 13:56) — root cause var timing, ikke en kodefejl
// (scout_report_ready var allerede den korrekte type, bare uden ledsagende
// constraint endnu). For at gøre en 5. gentagelse umulig scanner nedenstående
// test nu ALLE backend-kildefiler for konventionen `export const X_TYPE =
// "..."` (den konvention hver af de 3 forrige nye typer fulgte) i stedet for
// kun at tjekke en manuelt vedligeholdt liste — en ny type-konstant kan ikke
// længere smutte forbi uden at nogen husker at opdatere denne fil.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CONTRACT_EXPIRED_RELEASE_TYPE } from "./contractExpiryRelease.js";
import { SCOUT_REPORT_READY_TYPE } from "./notificationService.js";
import { isKnownNotificationType, NOTIFICATION_TYPES } from "./notificationTypes.js";
import { SEASON_TRANSITION_RISK_TYPE } from "./seasonTransitionNotice.js";
import { SQUAD_BELOW_MINIMUM_TYPE } from "./squadBelowMinimumCheck.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(
  __dirname,
  "../../database/2026-08-25-3517-forum-reply-notification-type.sql",
);
const BACKEND_ROOT = join(__dirname, "..");

// Rekursiv .js-filsamler — springer node_modules + *.test.js over. Dækker
// backend/lib, backend/routes, backend/scripts, backend/cron.js, server.js
// (alle steder en ny `_TYPE`-konstant realistisk kan blive introduceret).
function collectJsFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectJsFiles(full, out);
    } else if (entry.endsWith(".js") && !entry.endsWith(".test.js")) {
      out.push(full);
    }
  }
  return out;
}

test("alle kode-typekonstanter findes i NOTIFICATION_TYPES", () => {
  for (const t of [
    SCOUT_REPORT_READY_TYPE,
    CONTRACT_EXPIRED_RELEASE_TYPE,
    SEASON_TRANSITION_RISK_TYPE,
    SQUAD_BELOW_MINIMUM_TYPE,
  ]) {
    assert.ok(isKnownNotificationType(t), `"${t}" mangler i NOTIFICATION_TYPES`);
  }
});

test("#3032 forward-guard: ENHVER exporteret _TYPE-notifikationskonstant i backend findes i NOTIFICATION_TYPES", () => {
  const typeConstRegex = /export const (\w+_TYPE)\s*=\s*["']([a-z_]+)["']/g;
  const found = [];
  for (const file of collectJsFiles(BACKEND_ROOT)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(typeConstRegex)) {
      found.push({ file, name: m[1], value: m[2] });
    }
  }
  // Sanity-check af selve scanneren: hvis regex'en knækker (fx pga. refactor
  // af navnekonventionen) skal testen fejle synligt frem for at "passere
  // tomt" og lade guarden gå i sort uden nogen bemærker det.
  assert.ok(found.length >= 5, `scanner fandt kun ${found.length} _TYPE-konstanter — regex knækket?`);
  for (const { file, name, value } of found) {
    assert.ok(
      isKnownNotificationType(value),
      `${name} = "${value}" (${file}) mangler i NOTIFICATION_TYPES/notifications_type_check`,
    );
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
