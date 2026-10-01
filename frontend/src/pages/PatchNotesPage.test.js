import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "PatchNotesPage.jsx"), "utf8");

test("bruger aktivt sprog via i18n.language", () => {
  assert.match(src, /i18n\.language/);
});

test("renderer via runtime-lib (filterChanges + groupByDay)", () => {
  assert.match(src, /filterChanges/);
  assert.match(src, /groupByDay/);
});

test("renderer IKKE rå items direkte (ingen dobbelt-sprog)", () => {
  assert.doesNotMatch(src, /section\.items\.map/);
});

test("gemmer last-seen i localStorage", () => {
  assert.match(src, /cz_patchnotes_last_seen/);
});

test("viser Beta-badge pr. punkt for beta-only ændringer (#5422), også fra gammelt stage-felt", () => {
  assert.match(src, /change\.stage === "beta" \? "beta"/);
});

test("rollout-chip pr. change: fire markeringer, live uden chip (#6014)", () => {
  for (const r of ["beta", "beta_to_live", "switched_on", "event"]) {
    assert.match(src, new RegExp(`\\b${r}: "`));
  }
  assert.doesNotMatch(src, /\blive: "/);
  assert.match(src, /t\(`rollout\.\$\{rollout\}`\)/);
  // TASTE: 5px-radius og hairline, ingen guld/accent og ingen fyldt baggrund.
  assert.match(src, /rounded-cz me-2/);
  const chip = src.slice(src.indexOf("const ROLLOUT_CHIP"), src.indexOf("function rolloutOf"));
  assert.doesNotMatch(chip, /accent|gold|bg-/);
});

test("rollout-noeglerne findes paa begge sprog (#6014)", () => {
  for (const lang of ["en", "da"]) {
    const j = JSON.parse(readFileSync(join(__dirname, `../../public/locales/${lang}/patchnotes.json`), "utf8"));
    for (const r of ["beta", "beta_to_live", "switched_on", "event"]) {
      assert.ok(j.rollout?.[r], `${lang}: rollout.${r}`);
    }
    assert.ok(j.footer?.rolloutNote, `${lang}: footer.rolloutNote`);
  }
});
