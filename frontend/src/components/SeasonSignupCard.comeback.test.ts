// #5643 (spor A4) · SeasonSignupCard: et parkeret hold kommer tilbage STRAKS via
// POST /api/season/comeback, og kortet viser den nye division.
//
// Repoet kører `node --test` uden DOM-renderer, så wiringen guardes kildekode-
// strukturelt (samme mønster som SeasonWrapNudgeCard.goldCta.test.js), og copy'en
// guardes i begge sprogfiler.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "SeasonSignupCard.jsx"), "utf8");
const locale = (lang: string) =>
  JSON.parse(readFileSync(join(here, "..", "..", "public", "locales", lang, "dashboard.json"), "utf8")).seasonSignup;

const COMEBACK_KEYS = ["bodyParkedComeback", "ctaComeback", "comebackTitle", "comebackConfirmed", "comebackError"];

test("parkeret: knappen kalder /api/season/comeback gennem apiFetch", () => {
  assert.match(source, /apiFetch\("\/api\/season\/comeback"/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /onClick=\{parked \? handleComeback : onSignUp\}/);
});

test("sovende: knappen bruger stadig onSignUp fra DashboardPage", () => {
  assert.match(source, /t\(parked \? "seasonSignup\.ctaComeback" : "seasonSignup\.cta"\)/);
});

test("bekræftelsen viser divisionen fra serverens svar, ikke et optimistisk flueben", () => {
  assert.match(source, /comebackConfirmed", \{ division: comeback\.division \}/);
  assert.match(source, /if \(result\) setComeback\(result\)/);
});

test("en fejl vises som tekst, og knappen bliver stående", () => {
  assert.match(source, /parked && comebackFailed && !done/);
  assert.match(source, /\{!done && \(/);
});

test("én guld pr. view er uændret: knappen følger primary-prop'en", () => {
  assert.match(source, /variant=\{primary \? "primary" : "secondary"\}/);
});

for (const lang of ["en", "da"]) {
  test(`${lang}: comeback-nøglerne findes, uden em-dash`, () => {
    const copy = locale(lang);
    for (const key of COMEBACK_KEYS) {
      assert.equal(typeof copy[key], "string", `${lang}.seasonSignup.${key} mangler`);
      assert.ok(copy[key].length > 0);
      assert.doesNotMatch(copy[key], /—/, `${lang}.seasonSignup.${key} må ikke have em-dash`);
    }
    assert.match(copy.comebackConfirmed, /\{division\}/);
  });
}

test("den gamle parkerede brødtekst er fjernet (kortet lover ikke længere 'næste sæson')", () => {
  assert.equal(locale("en").bodyParked, undefined);
  assert.equal(locale("da").bodyParked, undefined);
  assert.doesNotMatch(source, /seasonSignup\.bodyParked"/);
});
