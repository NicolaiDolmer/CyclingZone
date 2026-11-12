import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #7932 (ejervalg 9/11 og 12/11): rytteres lofter vises ikke, og en uscoutet
// rytter viser kun Scout-knappen. node --test har ingen DOM, så reglerne holdes
// af kilde-tekst-guards (samme mønster som TeamDevelopmentTab.test.js).

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");
const locales = join(here, "..", "..", "..", "public", "locales");

const scoutable = read("ScoutablePotentiale.jsx");
const estimate = read("PotentialEstimate.tsx");
const scoutingTab = read("profile/RiderScoutingTab.jsx");

test("loft-suffiks og loft-tooltip er væk fra ScoutablePotentiale", () => {
  assert.doesNotMatch(scoutable, /loftShort|loftTitle|loftPastPeak|data-potential-loft|estimate\.loft/);
});

test("uscoutet viser aldrig teksten 'Ikke scoutet' hverken i tal+ord-visningen eller bånd-visningen", () => {
  for (const [name, src] of [["ScoutablePotentiale", scoutable], ["PotentialEstimate", estimate]]) {
    assert.doesNotMatch(src, /scouting\.notScouted"/, `${name}: ingen 'Ikke scoutet'-tekst`);
    assert.doesNotMatch(src, /hideNotScouted|hideUnscoutedLabel/, `${name}: skjul-prop'en er overflødig`);
  }
});

test("uscoutet uden knap viser en tankestreg-pladsholder", () => {
  assert.match(estimate, /action \?\? \(\s*<span className="text-cz-3"[^>]*>—<\/span>/);
  assert.match(scoutable, /<span className="text-cz-3"[^>]*>—<\/span>/);
});

test("Scout-kortet har ingen overskrift 'Ikke scoutet'", () => {
  assert.doesNotMatch(scoutingTab, /notScoutedTitle/);
});

test("de døde nøgler er slettet i en og da", () => {
  const dead = ["loftShort", "loftTitle", "loftPastPeakShort", "loftPastPeakTitle", "notScouted"];
  for (const lng of ["en", "da"]) {
    const rider = JSON.parse(readFileSync(join(locales, lng, "rider.json"), "utf8"));
    for (const key of dead) assert.equal(rider.scouting?.[key], undefined, `${lng}: scouting.${key} skal være slettet`);
    assert.equal(rider.profile?.scouting?.notScoutedTitle, undefined, `${lng}: profile.scouting.notScoutedTitle skal være slettet`);
    const team = JSON.parse(readFileSync(join(locales, lng, "team.json"), "utf8"));
    assert.doesNotMatch(team.page.youthSquadCountsTooltip, /\b(12|10)\b/, `${lng}: trupgrænse-tallene må ikke stå direkte i teksten`);
    assert.doesNotMatch(team.squad.headers.potentialTitle, /ceiling|loft/i, `${lng}: potentialTitle har intet loft-sprog`);
  }
});
