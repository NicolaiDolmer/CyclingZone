// #3597 — regressionstest for kontrakt-forlængelses-gaten.
//
// Den afgørende test er "kapacitet brugt op, men ALDRIG afvist" nedenfor: præcis
// den tilstand en succesfuld forlængelse efterlader (extendCapped === false,
// extensionCap.remainingExtensions === 0), og præcis den tilstand der lod
// spillere klikke sig ind i en garanteret 409 i runde 3 af CYCLINGZONE-45.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extendCapGate } from "./extendCapGate.js";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(dir, p), "utf8");

// ── Gaten selv ──────────────────────────────────────────────────────────────

test("#3597: kapaciteten er brugt op selvom vi aldrig er blevet afvist → spærret", () => {
  // Tilstanden EFTER en succesfuld forlængelse der brugte sidste tilladte sæson.
  // POST /extend-contract svarede 200 med extensionCap 3/3; intet 409 er set,
  // så extendCapped er (korrekt) stadig false. Knappen skal alligevel være låst.
  const gate = extendCapGate({
    capped: false,
    capInfo: { maxSeason: 5, maxExtensions: 3, usedExtensions: 3, remainingExtensions: 0 },
    capSeason: null,
  });
  assert.equal(gate.atCap, true, "0 tilbage skal spærre uanset at ingen 409 er set");
  assert.equal(gate.season, 5, "forklaringen skal kunne nævne sæsonen uden en 409-errorParams");
});

test("#3597: kapacitet tilbage → åben, også lige efter en forlængelse", () => {
  // Samme flow, men rytteren var på 0/3 og er nu på 1/3. Knappen SKAL være
  // klikbar igen — fixet må ikke spærre en rytter der stadig har forlængelser.
  const gate = extendCapGate({
    capped: false,
    capInfo: { maxSeason: 5, maxExtensions: 3, usedExtensions: 1, remainingExtensions: 2 },
  });
  assert.equal(gate.atCap, false);
});

test("bekræftet 409 spærrer stadig, også uden extensionCap i svaret", () => {
  const gate = extendCapGate({ capped: true, capInfo: null, capSeason: 5 });
  assert.equal(gate.atCap, true);
  assert.equal(gate.season, 5);
});

test("manglende/ugyldig extensionCap betyder 'ved ikke' — ikke '0 tilbage'", () => {
  // Et svar uden extensionCap (netværksfejl, ældre backend) må ALDRIG spærre
  // knappen permanent; så ville fixet bytte en afvisning ud med en død knap.
  assert.equal(extendCapGate({}).atCap, false);
  assert.equal(extendCapGate({ capInfo: {} }).atCap, false);
  assert.equal(extendCapGate({ capInfo: { remainingExtensions: null } }).atCap, false);
  assert.equal(extendCapGate({ capInfo: { remainingExtensions: "x" } }).atCap, false);
  assert.equal(extendCapGate().season, null);
});

test("negativ remaining (data-drift) spærrer i stedet for at åbne", () => {
  assert.equal(extendCapGate({ capInfo: { remainingExtensions: -1 } }).atCap, true);
});

test("season: 409'ens errorParams.maxSeason vinder over extensionCap.maxSeason", () => {
  const gate = extendCapGate({
    capped: true,
    capSeason: 7,
    capInfo: { maxSeason: 5, maxExtensions: 3, usedExtensions: 3, remainingExtensions: 0 },
  });
  assert.equal(gate.season, 7);
});

// ── Kald-stederne (kontrakt: begge flader gater på SAMME udledning) ─────────
//
// Runde 1 og 2 af denne fejl fikserede rytter-profilen og holdsiden hver for
// sig. Gaten er nu én delt funktion — disse checks fejler hvis en fremtidig
// ændring falder tilbage til det afvisnings-afledte flag alene på én af dem.

const manage = read("../components/rider/RiderManageActions.jsx");
const teamPage = read("../pages/TeamPage.jsx");

test("#3597: rytter-profilens forlæng-knap gater på extendCap.atCap, ikke på extendCapped", () => {
  assert.match(manage, /import \{ extendCapGate \}/);
  assert.match(
    manage,
    /onClick=\{openExtend\} disabled=\{extendCap\.atCap \|\| extendLoading\}/,
    "triggerknappen skal spærres af kapacitets-gaten"
  );
  assert.ok(
    !/disabled=\{extendCapped\b/.test(manage),
    "ingen disabled-prop må hænge på det afvisnings-afledte extendCapped alene"
  );
});

test("#3597: holdsidens Forlæng-fane gater på samme delte udledning", () => {
  assert.match(teamPage, /import \{ extendCapGate \}/);
  assert.match(
    teamPage,
    /const disabled = tab === "extend" && \(extendCap\.atCap \|\| extendCapChecking\)/,
    "fanen skal spærres af kapacitets-gaten, ikke af extendCapped alene"
  );
});

test("#3597: rytter-profilen nulstiller extend-state når rytteren skifter", () => {
  // Uden nulstillingen bar rytter B videre på A's quote/cap-state (samme
  // route-element → ingen remount). Kontrakten er at mount-effekten rydder op.
  const effect = manage.slice(manage.indexOf("useEffect(() => {"), manage.indexOf("// ── Forlæng kontrakt"));
  for (const setter of ["setExtendQuote(null)", "setExtendCapped(false)", "setExtendCapInfo(null)"]) {
    assert.ok(effect.includes(setter), `mount-effekten skal kalde ${setter} ved rytterskift`);
  }
});
