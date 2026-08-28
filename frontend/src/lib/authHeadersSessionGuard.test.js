// #4347 forward-guard — kilde-struktur-scanner over HELE frontend/src.
//
// Fejlen: fire af de 26 authHeaders()-kopier interpolerede `session?.access_token`
// direkte ind i Bearer-strengen uden at tjekke om der var et token. Uden session
// blev headeren strengen "Bearer undefined", og serverens `if (!token)`-værn
// (backend/routes/api.js) fangede den ikke — "undefined" er en ikke-tom streng.
// Resultat: 401 `bad_jwt` i Railway-loggen hvert 60. sekund fra Layout-heartbeatet,
// og "0 online" på skærmen fordi 401-kroppen blev parset som et gyldigt svar.
//
// Hvorfor scanne bredt frem for at teste de fire filer: problemet ER at funktionen
// findes i 26 kopier. En test der kun kigger på de fire kendte kopier ville lade
// kopi nr. 27 gentage præcis samme fejl. Denne test fejler uanset HVOR i src en
// uværnet variant dukker op — også i en fil der ikke findes endnu.
//
// Når #4348 har samlet alle kopier i lib/supabase.ts, bliver den her testen
// billigere (ét fund i stedet for 26), men den skal blive stående: den er netop
// det der forhindrer at nogen skriver en lokal kopi igen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry) && !/\.test\.[jt]sx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// Kroppen af hver `async function authHeaders() { ... }`. Alle kopier er
// top-level-funktioner, så den afsluttende `}` står i kolonne 0.
const DEFINITION = /async function authHeaders\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/g;

// Præcis den defekte form: et optional-chained token hældt direkte ind i Bearer.
const UNGUARDED_BEARER = /Bearer \$\{\s*(?:data\?\.)?session\?\.access_token\s*\}/;

function definitions() {
  const found = [];
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(DEFINITION)) {
      found.push({ file: relative(SRC, file).replace(/\\/g, "/"), body: match[1] });
    }
  }
  return found;
}

test("#4347 scanneren finder faktisk authHeaders-definitioner", () => {
  // Uden den her ville de to tests nedenfor bestå tomt hvis regexet holdt op med
  // at matche (fx efter en omskrivning til arrow-funktion) — en grøn test der
  // ikke tester noget er værre end ingen test.
  assert.ok(
    definitions().length > 0,
    "fandt ingen `async function authHeaders()` i frontend/src — er DEFINITION-regexet forældet?",
  );
});

test("#4347 ingen authHeaders() maa sende 'Bearer undefined'", () => {
  const offenders = definitions()
    .filter(({ body }) => UNGUARDED_BEARER.test(body))
    .map(({ file }) => file);

  assert.deepEqual(
    offenders,
    [],
    `authHeaders() interpolerer et uverificeret token direkte ind i Bearer-strengen i:\n` +
      offenders.map((f) => `  - ${f}`).join("\n") +
      `\n\nUden session bliver headeren strengen "Bearer undefined", som serveren afviser ` +
      `med 401 bad_jwt. Hent token'et ud foerst og returnér null naar det mangler:\n` +
      `  const token = data?.session?.access_token;\n` +
      `  if (!token) return null;`,
  );
});

test("#4347 hver authHeaders() kan returnere null naar sessionen mangler", () => {
  // Bredere end testen ovenfor: fanger ogsaa varianter der undgaar det praecise
  // Bearer-moenster men stadig altid returnerer en header.
  const offenders = definitions()
    .filter(({ body }) => !/return null|:\s*null/.test(body))
    .map(({ file }) => file);

  assert.deepEqual(
    offenders,
    [],
    `authHeaders() returnerer altid en header i:\n` +
      offenders.map((f) => `  - ${f}`).join("\n") +
      `\n\nKontrakten er null = "ingen session, lad vaere med at kalde". Kald-stederne ` +
      `er skrevet til at springe over paa null.`,
  );
});
