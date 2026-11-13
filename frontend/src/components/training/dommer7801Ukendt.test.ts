// #7801 rest-byg: taelleren over traethedsgraensen er UKENDT, naar tallet lige nu ikke kan regnes.
// Skrevet af den uafhaengige dommer FOER foerste kodelinje (AGENTS.md regel 40). Ejes af dommeren.
// Ligger i frontend/src/components/training/. ROED paa main (de to "ukendt"-proever), resten er vagter.
//
// Ejeren 13/11: taelleren "skal vise 'ukendt' i stedet for at taelle paa morgenens tal".
// Serveren sender da fatigue: null for rytteren (backend-proeven K3). Her: modellen maa ikke taelle
// en rytter med ukendt tal som "ikke over graensen". Svaret er null = ukendt.
// Hvad der STAAR paa skaermen ved null er spillertekst og ejerens valg (se regler.md, spoergsmaal 1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ridersOverLimit } from "./FatigueRuleModel.ts";

const team = { threshold: 60, fallback: "light", recoveryAfterStage: false };
const own = { threshold: 50, fallback: "rest", recoveryAfterStage: null };
const off = { threshold: null, fallback: "off", recoveryAfterStage: null };
const r = (id: string, fatigue: number | null) => ({ id, name: id, fatigue }) as never;

test("kendte tal: taelleren er som i dag", () => {
  assert.equal(ridersOverLimit([r("a", 61), r("b", 60), r("c", 55), r("d", 99)], team, { c: own, d: off }), 2);
  assert.equal(ridersOverLimit([r("a", 10)], team, {}), 0);
  assert.equal(ridersOverLimit([r("a", 99)], null, {}), 0);
  assert.equal(ridersOverLimit([], team, {}), 0);
});

test("ROED paa main: ukendt tal for en rytter under en graense giver ukendt (null), ikke et antal", () => {
  assert.equal(ridersOverLimit([r("a", null), r("b", 70)], team, {}), null);
  assert.equal(ridersOverLimit([r("a", null), r("b", null)], team, {}), null);
  assert.equal(ridersOverLimit([r("a", 10), r("c", null)], null, { c: own }), null);
});

test("ukendt tal for en rytter UDEN graense aendrer ikke taelleren", () => {
  assert.equal(ridersOverLimit([r("a", 70), r("d", null)], team, { d: off }), 1);
  assert.equal(ridersOverLimit([r("a", null)], null, {}), 0);
});

test("ROED paa main: modellen siger, at en rytters traethed kan vaere ukendt", () => {
  const src = readFileSync(fileURLToPath(new URL("./FatigueRuleModel.ts", import.meta.url)), "utf8");
  assert.match(src, /export type RosterRider = \{[^}]*fatigue: number \| null/);
});
