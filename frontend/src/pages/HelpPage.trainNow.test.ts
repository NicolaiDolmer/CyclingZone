// #7737 · Traen nu for alle: Hjaelp skifter af sig selv ved taending.
//
// Traen nu-afsnittet findes i to udgaver bag `training_train_now_instant`:
//   - trainNowBeta: dagens tekst med beta-forbeholdet (kontakten off for viewer'en).
//   - trainNowInstant: samme regel uden forbeholdet (beta-testere nu, alle ved "on").
// Kontrakterne her:
//   1. De to staar aldrig side om side, heller ikke mens flag-svaret hentes.
//   2. Ikke-beta-spillere ser praecis dagens tekst, nu blot under egen overskrift
//      (runDayNow + trainNowBeta = den gamle runDayNow, ord for ord, paa alle fem sprog).
//   3. trainNowInstant er trainNowBeta uden beta-saetningen: ingen ny regel, intet nyt tal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HELP_BLOCK_FLAGS, helpGateFlagKeys, isHelpBlockFlagVisible, isHelpBlockVisible } from "./helpFlagGates.js";

type Flags = Record<string, unknown> | null;
type Block = { title: string; text: string };

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "HelpPage.jsx"), "utf8");
const localesDir = join(here, "..", "..", "public", "locales");
const LANGS = ["en", "da", "es", "fr", "nl"] as const;
const FLAG = "training_train_now_instant";
const TICK = "training_tick_per_race_day";

function daily(lng: string): Record<string, Block> {
  return JSON.parse(readFileSync(join(localesDir, lng, "help.json"), "utf8")).sections.dailytraining;
}

// SECTION_DEFS-blokkens eget `flag` (#5274) AND tabel-gaten, som HelpPage filtrerer.
function visible(id: string, flags: Flags): boolean {
  const def = source.match(new RegExp(`\\{ id: "${id}", kind: "text"(?:, flag: "(\\w+)")? \\}`));
  assert.ok(def, `${id} mangler i SECTION_DEFS`);
  return isHelpBlockVisible("dailytraining", id, flags as never) && isHelpBlockFlagVisible(def[1], flags as never);
}

const BETA_SENTENCE: Record<(typeof LANGS)[number], RegExp> = {
  en: /During the beta/,
  da: /I beta gælder/,
  es: /Durante la beta/,
  fr: /Pendant la bêta/,
  nl: /Tijdens de bèta/,
};

test("tvillingerne er gatet paa Traen nu-kontakten, og kontakten er spiller-synlig", () => {
  const gates = HELP_BLOCK_FLAGS.dailytraining as Record<string, { flag: string; when: boolean }>;
  assert.deepEqual(gates.trainNowBeta, { flag: FLAG, when: false });
  assert.deepEqual(gates.trainNowInstant, { flag: FLAG, when: true });
  assert.ok(helpGateFlagKeys().includes(FLAG));
});

test("ikke-beta ser beta-teksten, beta-tester og 'on' ser teksten for alle, aldrig begge", () => {
  const offForViewer = { [TICK]: true, [FLAG]: false };
  const onForViewer = { [TICK]: true, [FLAG]: true };
  assert.equal(visible("trainNowBeta", offForViewer), true);
  assert.equal(visible("trainNowInstant", offForViewer), false);
  assert.equal(visible("trainNowBeta", onForViewer), false);
  assert.equal(visible("trainNowInstant", onForViewer), true);
  const states: Flags[] = [offForViewer, onForViewer, {}, null, { [TICK]: true }, { [TICK]: false, [FLAG]: true }, { [TICK]: true, [FLAG]: "beta" }];
  for (const flags of states) {
    assert.ok(!(visible("trainNowBeta", flags) && visible("trainNowInstant", flags)), JSON.stringify(flags));
  }
  // Mens svaret hentes: ingen af dem (fail-safe som resten af siden).
  assert.equal(visible("trainNowBeta", null), false);
  assert.equal(visible("trainNowInstant", null), false);
  // Uden loebsdags-modellen findes Traen nu-afsnittet ikke, som runDayNow.
  assert.equal(visible("trainNowInstant", { [TICK]: false, [FLAG]: true }), false);
});

test("tvillingerne staar lige efter runDayNow", () => {
  const ids = [...source.matchAll(/\{ id: "(\w+)", kind: "text"/g)].map((m) => m[1]);
  const i = ids.indexOf("runDayNow");
  assert.deepEqual(ids.slice(i, i + 3), ["runDayNow", "trainNowBeta", "trainNowInstant"]);
});

for (const lng of LANGS) {
  test(`${lng}: teksten for alle er beta-teksten uden beta-saetningen`, () => {
    const s = daily(lng);
    for (const id of ["runDayNow", "trainNowBeta", "trainNowInstant"]) {
      assert.ok(s[id]?.title && s[id]?.text, `${lng}: ${id} mangler title/text`);
    }
    assert.match(s.trainNowBeta.text, BETA_SENTENCE[lng]);
    assert.doesNotMatch(s.trainNowInstant.text, BETA_SENTENCE[lng]);
    assert.doesNotMatch(s.runDayNow.text, BETA_SENTENCE[lng], `${lng}: runDayNow beholdt beta-saetningen`);
    assert.ok(s.trainNowBeta.text.startsWith(s.trainNowInstant.text), `${lng}: teksten for alle er ikke en forkortelse`);
    assert.equal(s.trainNowInstant.title, s.trainNowBeta.title);
    // Ingen nye tal i forhold til dagens tekst.
    const allowed = new Set(s.trainNowBeta.text.match(/\d+/g) ?? []);
    assert.deepEqual((s.trainNowInstant.text.match(/\d+/g) ?? []).filter((n) => !allowed.has(n)), []);
    assert.doesNotMatch(s.trainNowInstant.text + s.trainNowInstant.title, /—/, `${lng}: em-dash`);
  });
}
