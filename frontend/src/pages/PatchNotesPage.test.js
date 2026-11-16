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
  // Adfærden (gammelt stage: "beta" giver beta) bevises i patchNotes.test.js på effectiveRollout;
  // her sikres kun at siden bruger den, så mærket og filteret aldrig kan glide fra hinanden.
  assert.match(src, /effectiveRollout\(/);
  assert.doesNotMatch(src, /change\.stage === "beta"/);
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

test("én segment-række + 'Kun beta'-kontakt; 'Nu for alle' er fjernet (#6717)", () => {
  assert.match(src, /<Segmented[\s\S]*?value=\{category\}/);
  assert.match(src, /<Toggle[\s\S]*?filter\.betaOnly/);
  assert.doesNotMatch(src, /now_live|nowLive/);
  // Ingen haandrullede runde kategori-piller ved siden af Segmented.
  assert.doesNotMatch(src, /rounded-cz-pill border transition-colors/);
  for (const lang of ["en", "da"]) {
    const j = JSON.parse(readFileSync(join(__dirname, `../../public/locales/${lang}/patchnotes.json`), "utf8"));
    assert.ok(j.filter?.betaOnly, `${lang}: filter.betaOnly`);
    for (const c of ["all", "new", "improved", "fixed"]) assert.ok(j.filter?.category?.[c], `${lang}: filter.category.${c}`);
    assert.equal(j.filter?.rollout, undefined, `${lang}: filter.rollout skal vaere fjernet`);
  }
});

// #7543: bøjede dags-tællere, kun første ord med stort, ingen dobbelt "Små rettelser".
test("dags-tællere bruger i18n-flertal i alle 5 sprog (#7543)", () => {
  assert.match(src, /t\(`summary\.\$\{cat\}`, \{ count:/);
  for (const l of ["da", "en", "es", "fr", "nl"]) {
    const j = JSON.parse(readFileSync(join(__dirname, `../../public/locales/${l}/patchnotes.json`), "utf8"));
    for (const c of ["new", "improved", "fixed"]) {
      assert.match(j.summary[c], /^{count, plural, one {.*} other {.*}}$/, `${l}.${c}`);
    }
  }
});

test("datoen får kun stort begyndelsesbogstav, ikke capitalize på hvert ord (#7543)", () => {
  assert.doesNotMatch(src, /text-cz-1 capitalize/);
  assert.match(src, /charAt\(0\)\.toLocaleUpperCase/);
});

test("2/11 har kun ét \"Små rettelser\"-punkt (#7543)", async () => {
  const { PATCHES: notes } = await import("../data/patchNotes.js");
  const titles = notes.filter((v) => v.date === "2026-11-02").flatMap((v) => v.changes).map((c) => c.da.title);
  assert.equal(titles.filter((x) => x === "Små rettelser").length, 1);
});

// ── #8049: kontakten vælger siden; den gamle side er uændret bag "off" ──────
const partsSrc = readFileSync(join(__dirname, "../components/patchnotes/PatchNoteParts.jsx"), "utf8");
const v2Src = readFileSync(join(__dirname, "../components/patchnotes/PatchNotesV2Page.jsx"), "utf8");

test("#8049: kontakten læses med viewerens login, og ukendt/fejl er den gamle side", () => {
  assert.match(src, /loadFeatureFlagStages\(\)/);
  assert.match(src, /stages\?\.\[PATCH_NOTES_V2_FLAG\] \?\? "off"/);
  assert.match(src, /\.catch\(\(\) => \{ if \(active\) setStage\("off"\); \}\)/);
  assert.ok(src.includes("isPatchNotesV2Stage(stage) ? <PatchNotesV2Route arrivalMarker={arrivalMarker} /> : <LegacyPatchNotesPage />"));
  // "Sidst set" fanges ved ankomst, før menuen når at markere siden som set.
  assert.match(src, /const \[arrivalMarker\] = useState\(\(\) => readLocalSeenMarker\("patch_notes"\)\)/);
  // Den nye side er sin egen chunk: den gamle side henter ikke et byte mere.
  assert.match(src, /lazy\(\(\) => import\("\.\.\/components\/patchnotes\/PatchNotesV2Page\.jsx"\)\)/);
  // Den gamle side henter stadig hele patch-notes.json, som før.
  assert.match(src, /function LegacyPatchNotesPage\(\)[\s\S]*loadPatches\(\)/);
});

test("#8049: mærkerne er firkantede (5px), aldrig piller; ingen guld-knap; stroke-ikoner", () => {
  const tag = partsSrc.slice(partsSrc.indexOf("export function PatchTag"), partsSrc.indexOf("export function NewDot"));
  assert.match(tag, /rounded-cz border/);
  assert.doesNotMatch(tag, /rounded-cz-pill|rounded-full/);
  assert.doesNotMatch(v2Src, /variant="primary"/);
  assert.doesNotMatch(v2Src + partsSrc, /shadow-|gradient/);
});

test("#8049: arkivmåneder og titelindekset hentes først ved klik eller søgning", () => {
  assert.match(v2Src, /patchNotesRecentUrl\(lang\)/);
  assert.match(v2Src, /const toggleMonth = [\s\S]*loadMonth\(m\)/);
  assert.match(v2Src, /if \(!searching \|\|[\s\S]*patchNotesIndexUrl\(lang\)/);
  assert.match(v2Src, /markSeen\("patch_notes", recent\.seenKey\)/);
});
