import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "NextActionsCard.jsx"), "utf8");
const read = (lang: string) =>
  JSON.parse(readFileSync(join(__dirname, "../../public/locales", lang, "dashboard.json"), "utf8"));

test("#6962: kortet laeser tiderne fra pending.next_updates og viser dem i dansk tid", () => {
  assert.match(source, /pending\?\.next_updates\?\.value_update_at/);
  assert.match(source, /pending\?\.next_updates\?\.academy_intake_at/);
  assert.match(source, /timeZone: "Europe\/Copenhagen"/);
});

test("#6962: EN+DA-noegler findes og bruger {when}", () => {
  for (const lang of ["en", "da"]) {
    const n = read(lang).nextActions;
    assert.match(n.nextValueUpdate, /\{when\}/);
    assert.match(n.nextAcademyIntake, /\{when\}/);
  }
});
