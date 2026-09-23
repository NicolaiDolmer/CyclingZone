// #4948 · Hjaelp-sidens flag-gatede dele foelger ÉT svar (GET /api/feature-flags).
// Tester den rene gate-logik direkte, krydstjekker flag-navnene mod backendens
// allowlist, og vogter mod at de gamle hardkodede gates kommer tilbage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HELP_BLOCK_FLAGS,
  HELP_SECTION_FLAGS,
  helpGateFlagKeys,
  isHelpBlockVisible,
  isHelpSectionVisible,
} from "./helpFlagGates.js";
import { PLAYER_VISIBLE_FLAG_KEYS } from "../../../backend/lib/stageFlagCatalog.js";
import { betaAccessMockRoute } from "../preview/betaAccessMock.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "HelpPage.jsx"), "utf8");

const ALL_OFF = { race_engine_v4: false, board_mandate_model_enabled: false, training_tick_per_race_day: false };

test("raceDay vises naar race_engine_v4 er on, skjult ellers", () => {
  assert.equal(isHelpSectionVisible("raceDay", { ...ALL_OFF, race_engine_v4: true }), true);
  assert.equal(isHelpSectionVisible("raceDay", ALL_OFF), false);
  // Manglende noegle, fejlsvar ({}) og mens svaret hentes (null) er skjult.
  assert.equal(isHelpSectionVisible("raceDay", {}), false);
  assert.equal(isHelpSectionVisible("raceDay", null), false);
  // Kun et strengt true taeller: et raat stadie der sniger sig igennem er ikke "on".
  assert.equal(isHelpSectionVisible("raceDay", { race_engine_v4: "on" }), false);
  assert.equal(isHelpSectionVisible("raceDay", { race_engine_v4: "beta" }), false);
});

test("mandate foelger board_mandate_model_enabled (samme mekanisme som raceDay)", () => {
  assert.equal(isHelpSectionVisible("mandate", { ...ALL_OFF, board_mandate_model_enabled: true }), true);
  assert.equal(isHelpSectionVisible("mandate", ALL_OFF), false);
  assert.equal(isHelpSectionVisible("mandate", null), false);
  // Flagene er uafhaengige: v4 on taender ikke mandatet.
  assert.equal(isHelpSectionVisible("mandate", { ...ALL_OFF, race_engine_v4: true }), false);
});

test("sektioner uden gate er altid synlige, ogsaa mens svaret hentes", () => {
  for (const key of ["start", "board", "dailytraining", "raceSelection"]) {
    assert.equal(isHelpSectionVisible(key, null), true, key);
    assert.equal(isHelpSectionVisible(key, {}), true, key);
  }
  // Prototype-navne er ikke gates.
  assert.equal(isHelpSectionVisible("constructor", null), true);
  assert.equal(isHelpSectionVisible("toString", {}), true);
});

test("traenings-blokkene: runDayNow og trainToday staar aldrig side om side", () => {
  const on = { ...ALL_OFF, training_tick_per_race_day: true };
  assert.equal(isHelpBlockVisible("dailytraining", "runDayNow", on), true);
  assert.equal(isHelpBlockVisible("dailytraining", "trainToday", on), false);

  assert.equal(isHelpBlockVisible("dailytraining", "runDayNow", ALL_OFF), false);
  assert.equal(isHelpBlockVisible("dailytraining", "trainToday", ALL_OFF), true);

  // Fejlsvar = off (fail-safe): den nuvaerende model beskrives.
  assert.equal(isHelpBlockVisible("dailytraining", "runDayNow", {}), false);
  assert.equal(isHelpBlockVisible("dailytraining", "trainToday", {}), true);

  // Mens svaret hentes vises ingen af dem, saa siden aldrig viser den forkerte
  // model og derefter skifter.
  assert.equal(isHelpBlockVisible("dailytraining", "runDayNow", null), false);
  assert.equal(isHelpBlockVisible("dailytraining", "trainToday", null), false);
});

test("blokke uden gate er altid synlige", () => {
  assert.equal(isHelpBlockVisible("dailytraining", "someOtherBlock", null), true);
  assert.equal(isHelpBlockVisible("start", "intro", null), true);
  assert.equal(isHelpBlockVisible("dailytraining", "constructor", {}), true);
});

test("hvert flag Hjaelp-siden gater paa staar i backendens allowlist", () => {
  const missing = helpGateFlagKeys().filter((key) => !PLAYER_VISIBLE_FLAG_KEYS.includes(key));
  assert.deepEqual(
    missing,
    [],
    "GET /api/feature-flags svarer kun paa PLAYER_VISIBLE_FLAG_KEYS (backend/lib/stageFlagCatalog.js); " +
      `et flag udenfor listen ville holde delen skjult for evigt: ${missing.join(", ")}`,
  );
});

test("preview-mocken svarer med praecis backendens allowlist (ingen drift i kopien)", async () => {
  const res = betaAccessMockRoute("https://preview.example/api/feature-flags", "GET");
  assert.ok(res, "preview-mocken svarer ikke paa GET /api/feature-flags");
  const body = await res.json();
  assert.deepEqual(Object.keys(body.flags).sort(), [...PLAYER_VISIBLE_FLAG_KEYS].sort());
  for (const value of Object.values(body.flags)) assert.equal(typeof value, "boolean");
  // Admin-ruten maa ikke fanges af spiller-ruten.
  const admin = await betaAccessMockRoute("https://preview.example/api/admin/feature-flags", "GET").json();
  assert.ok(Array.isArray(admin.flags), "admin-tavlens svar blev overskygget af spiller-svaret");
});

test("hver gated sektion og blok findes i SECTION_DEFS i HelpPage.jsx", () => {
  const match = source.match(/const SECTION_DEFS = \[([\s\S]*?)\n\];/);
  assert.ok(match, "HelpPage.jsx mangler 'const SECTION_DEFS = [...]'");
  const defs = new Map(
    [...match[1].matchAll(/key: "(\w+)",[\s\S]*?blocks: \[([\s\S]*?)\]/g)].map((m) => [
      m[1],
      [...m[2].matchAll(/id: "(\w+)"/g)].map((b) => b[1]),
    ]),
  );
  for (const key of Object.keys(HELP_SECTION_FLAGS)) {
    assert.ok(defs.has(key), `HELP_SECTION_FLAGS.${key} peger paa en sektion der ikke findes`);
  }
  for (const [key, blocks] of Object.entries(HELP_BLOCK_FLAGS)) {
    assert.ok(defs.has(key), `HELP_BLOCK_FLAGS.${key} peger paa en sektion der ikke findes`);
    for (const id of Object.keys(blocks)) {
      assert.ok(defs.get(key).includes(id), `HELP_BLOCK_FLAGS.${key}.${id} peger paa en blok der ikke findes`);
    }
  }
});

test("HelpPage bruger ÉN mekanisme: ingen hardkodede gates eller saerkald tilbage", () => {
  assert.doesNotMatch(source, /raceDayEnabled\s*=/, "hardkodet raceDay-gate er tilbage");
  assert.doesNotMatch(source, /TRAINING_TICK_PER_RACE_DAY_HELP_ENABLED/, "hardkodet traenings-gate er tilbage");
  assert.doesNotMatch(source, /fetchBoardRoom/, "mandat-sektionens saerkald til /board/room er tilbage");
  assert.match(source, /fetchPlayerFeatureFlags\(\)/, "HelpPage henter ikke flag-svaret");
  assert.match(source, /isHelpSectionVisible\(/, "sektionerne filtreres ikke gennem helpFlagGates");
  assert.match(source, /isHelpBlockVisible\(/, "blokkene filtreres ikke gennem helpFlagGates");
});
