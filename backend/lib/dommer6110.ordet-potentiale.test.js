// DOMMER #6110, regel R17: ORDET ER "POTENTIALE" OVERALT.
// Kilde: ejer 12/11 ("Ordet er Potentiale overalt"). Under XP er det sande tal bag
// skoennet internt "forventet topniveau"; det ord (og andre afloesere) maa ikke naa
// spilleren. Proeven laeser spillerteksterne (dansk og engelsk) og Hjaelp.
// Springes over, hvis frontend-mappen ikke ligger ved siden af backend.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HER = path.dirname(fileURLToPath(import.meta.url));
const LOCALES = path.resolve(HER, "../../frontend/public/locales");

// Ord, der ville vaere et andet navn for det samme tal.
const FORBUDT = Object.freeze({
  da: [/forventet\s+topniveau/i, /forventet\s+top\b/i, /talentloft/i, /udviklingsloft/i, /topniveau-sk[oø]n/i],
  en: [/expected\s+(top|peak)\s+(level|rating)/i, /expected\s+top\b/i, /talent\s+ceiling/i, /development\s+ceiling/i],
});

function tekster(node, sti, ud) {
  if (typeof node === "string") ud.push([sti, node]);
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) tekster(v, `${sti}.${k}`, ud);
  return ud;
}

for (const sprog of ["da", "en"]) {
  const mappe = path.join(LOCALES, sprog);
  test(`R17 ordet Potentiale: ingen afloeser-ord i spillerteksterne (${sprog})`, { skip: existsSync(mappe) ? false : "frontend/public/locales findes ikke her" }, () => {
    const fund = [];
    let potentiale = 0;
    for (const fil of readdirSync(mappe).filter((f) => f.endsWith(".json"))) {
      for (const [sti, tekst] of tekster(JSON.parse(readFileSync(path.join(mappe, fil), "utf8")), fil, [])) {
        if (/potentiale|potential/i.test(tekst)) potentiale += 1;
        for (const ord of FORBUDT[sprog]) if (ord.test(tekst)) fund.push(`${sti}: ${tekst.slice(0, 80)}`);
      }
    }
    assert.ok(potentiale > 0, "ordet Potentiale skal findes i spillerteksterne");
    assert.deepEqual(fund, []);
  });
}
