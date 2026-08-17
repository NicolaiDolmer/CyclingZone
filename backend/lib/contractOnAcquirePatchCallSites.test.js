// Forward-guard #3715/#3620: strukturel backwards-check af ALLE kaldesteder for
// contractOnAcquirePatch, ikke kun de der allerede har en per-fil regressionstest.
//
// Rod-årsagen til #3620 var IKKE en fejl i selve contractOnAcquirePatch — den var
// at ÉT kaldested (academyTransfer.js promote()) glemte at SELECT'e
// contract_end_season, som guarden inde i funktionen læser. `undefined != null`
// er false, så guarden blev permanent falsk PRÆCIS på den ene sti, og en
// eksisterende kontrakt blev regenereret i stilhed (se .claude/learnings/2026-08-14-
// guard-widened-select-not-updated-academy-contract.md).
//
// contractSeed.js kaster nu højlydt hvis `salary` er sat men nøglen
// `contract_end_season` slet ikke er til stede på objektet (samme PR) — det gør
// EKSISTERENDE kaldesteder sikre ved runtime. Men det fanger kun fejlen NÅR koden
// rent faktisk kører med en ramt rytter, og et NYT kaldested kan stadig glemme
// kolonnen og først opdage det i prod (præcis sådan #3620 opstod: to isolerede,
// hver-for-sig-korrekte PR'er).
//
// Denne test scanner kildekoden statisk: ethvert kaldested for
// contractOnAcquirePatch( skal ligge i en fil der OGSÅ nævner contract_end_season
// i en .select(...)-kaldestreng. Det er en grov, tekstlig proxy — ikke en fuld
// dataflow-analyse — men den fanger PRÆCIS #3620-mønstret (kolonnen mangler i
// SELECT'en) FØR merge, i stedet for først når en ramt rytter rammer koden i prod.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // backend/

function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "scripts" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.endsWith(".js") && !entry.endsWith(".test.js")) out.push(full);
  }
  return out;
}

function findCallSites() {
  const files = [...listJsFiles(join(ROOT, "lib")), ...listJsFiles(join(ROOT, "routes"))];
  const hits = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    if (src.includes("contractOnAcquirePatch(") && !file.endsWith("contractSeed.js")) {
      hits.push({ file, src });
    }
  }
  return hits;
}

test("#3715/#3620 forward-guard: hvert kaldested for contractOnAcquirePatch har contract_end_season i en .select(...) i samme fil", () => {
  const hits = findCallSites();
  assert.ok(hits.length >= 5, `forventede mindst 5 kendte kaldesteder (academyTransfer, academyGraduation, auctionFinalization, squadEnforcement, transferExecution, api.js) — fandt ${hits.length}. Er scanneren gået i stykker?`);

  const missing = [];
  for (const { file, src } of hits) {
    // Find alle .select("...")-kaldestrenge i filen og se om NOGEN af dem nævner
    // contract_end_season EKSPLICIT, eller henter ALLE kolonner via en bar '*'
    // (fx "*, rider:rider_id(*)" — auktions-stien, som #3698 verificerede aldrig
    // var ramt netop fordi '*' implicit inkluderer contract_end_season).
    const selectCalls = [...src.matchAll(/\.select\(\s*(["'`])([\s\S]*?)\1/g)].map((m) => m[2]);
    const anySelectHasColumn = selectCalls.some((cols) =>
      /\bcontract_end_season\b/.test(cols) || /(^|[,(\s])\*([,)\s]|$)/.test(cols));
    if (!anySelectHasColumn) {
      missing.push({ file: file.replace(ROOT, "backend"), selectCallsFound: selectCalls.length });
    }
  }

  assert.deepEqual(
    missing,
    [],
    `Disse filer kalder contractOnAcquirePatch UDEN en .select(...) der nævner contract_end_season i samme fil — ` +
    `præcis #3620-mønstret (SELECT mangler kolonnen guarden læser, regenererer en eksisterende kontrakt i stilhed):\n` +
    JSON.stringify(missing, null, 2),
  );
});

test("#3715/#3620 forward-guard: kendte kaldesteder er stadig til stede (canary — hvis denne fejler, tjek om scanneren mistede en fil)", () => {
  const hits = findCallSites().map((h) => h.file.replace(ROOT, "backend"));
  for (const expected of [
    "academyTransfer.js",
    "academyGraduation.js",
    "auctionFinalization.js",
    "squadEnforcement.js",
    "transferExecution.js",
  ]) {
    assert.ok(hits.some((f) => f.endsWith(expected)), `forventede et kaldested i ${expected}`);
  }
});
