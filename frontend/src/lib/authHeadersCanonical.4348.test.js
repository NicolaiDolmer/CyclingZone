// #4348 forward-guard — kilde-struktur-scanner over HELE frontend/src.
//
// Rod-årsagen: authHeaders() var skrevet forfra 26 gange (4 uden værn — det var
// #4347). Et værn INDE I hver kopi løser ikke problemet, for problemet ER at der
// er kopier: 22 kopier havde allerede det rigtige værn, og alligevel opstod #4347
// fordi ingen mekanisme spredte rettelsen til de fire der ikke fik den. Denne test
// fejler hvis en `authHeaders()`-DEFINITION optræder ANDRE steder end den kanoniske
// (frontend/src/lib/supabase.ts) — uanset om den nye kopi selv har et værn.
//
// Scanner bredt (hele src, ikke en liste af kendte filer) så den også dækker en
// fil der ikke findes endnu.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL_PATH = "lib/supabase.ts";

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

const DEFINITION = /(?:async\s+)?function\s+authHeaders\s*\(|authHeaders\s*=\s*(?:async\s*)?\(/;

function definitionFiles() {
  const found = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file).replace(/\\/g, "/");
    if (rel === CANONICAL_PATH) continue;
    const source = readFileSync(file, "utf8");
    if (DEFINITION.test(source)) found.push(rel);
  }
  return found;
}

test("#4348 den kanoniske authHeaders() findes rent faktisk i lib/supabase.ts", () => {
  // Uden den her ville testen nedenfor bestå tomt hvis den kanoniske export
  // blev omdøbt/flyttet uden at opdatere denne guard — en grøn test der ikke
  // tester noget er værre end ingen test.
  const canonical = readFileSync(join(SRC, CANONICAL_PATH), "utf8");
  assert.match(
    canonical,
    /export async function authHeaders\s*\(/,
    `forventede en 'export async function authHeaders(' i ${CANONICAL_PATH} — er den flyttet?`,
  );
});

test("#4348 authHeaders() maa KUN defineres i lib/supabase.ts", () => {
  const offenders = definitionFiles();
  assert.deepEqual(
    offenders,
    [],
    `authHeaders() er (gen)defineret uden for ${CANONICAL_PATH} i:\n` +
      offenders.map((f) => `  - ${f}`).join("\n") +
      `\n\nDet var præcis dette mønster — samme lille funktion nedskrevet igen og igen —\n` +
      `der lod fire af de 26 gamle kopier mangle værnet fra #4347. Importér i stedet:\n` +
      `  import { authHeaders } from ".../lib/supabase";`,
  );
});
