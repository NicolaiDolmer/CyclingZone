// #6818: dommen i read-only-tjekket foer taend af s5_profiles_v2.
import test from "node:test";
import assert from "node:assert/strict";
import { verdict } from "./verifyS5v2Taend.mjs";

test("#6818 verifyS5v2Taend: klar kun naar migration er applied, formtoppe slukket og intet loeb bundet til v2", () => {
  assert.equal(verdict({ migrationApplied: true, formPeaksEnabled: false, boundToV2: 0 }).ready, true);
  assert.equal(verdict({ migrationApplied: false, formPeaksEnabled: false, boundToV2: 0 }).ready, false);
  assert.equal(verdict({ migrationApplied: true, formPeaksEnabled: true, boundToV2: 0 }).ready, false);
  assert.equal(verdict({ migrationApplied: true, formPeaksEnabled: false, boundToV2: 3 }).ready, false);
  // Ukendt (fx null fra en fejlet laesning) er aldrig "klar".
  assert.equal(verdict({ migrationApplied: true, formPeaksEnabled: null, boundToV2: null }).ready, false);
});

test("#6818 verifyS5v2Taend: migrationen findes med og uden database/-praefiks (auto-migrate gemmer stien)", async () => {
  const { migrationRow, S5_V2_MIGRATION } = await import("./verifyS5v2Taend.mjs");
  assert.equal(migrationRow([{ filename: `database/${S5_V2_MIGRATION}` }])?.filename, `database/${S5_V2_MIGRATION}`);
  assert.equal(migrationRow([{ filename: S5_V2_MIGRATION }])?.filename, S5_V2_MIGRATION);
  assert.equal(migrationRow([{ filename: "database\\" + S5_V2_MIGRATION }]) !== null, true, "Windows-sti");
  assert.equal(migrationRow([{ filename: "database/2026-10-16-6462-engine-rules-revision-official-times-v5.sql" }]), null);
  assert.equal(migrationRow([{ filename: `x${S5_V2_MIGRATION}` }]), null, "kun hele filnavnet");
  assert.equal(migrationRow([]), null);
  assert.equal(migrationRow(null), null);
});

test("#6818 verifyS5v2Taend: en laesefejl paa formtop-flaget kaster i stedet for at ligne slukket", async () => {
  const { readFormPeaksEnabled } = await import("./verifyS5v2Taend.mjs");
  const db = (result) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }) });
  await assert.rejects(readFormPeaksEnabled(db({ data: null, error: { message: "boom" } })), /app_config \(race_form_peaks\): boom/);
  assert.equal(await readFormPeaksEnabled(db({ data: null, error: null })), false, "manglende raekke = slukket, som spillet");
  assert.equal(await readFormPeaksEnabled(db({ data: { value: "off" }, error: null })), false);
  assert.equal(await readFormPeaksEnabled(db({ data: { value: "on" }, error: null })), true);
});
