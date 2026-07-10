import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1350 + #1349 (FinancePage-delen) — terminale loading/error-states + a11y.
//
// FinancePage.loadAll() havde tidligere INGEN try/catch/finally om initial load:
//   - en rejected request (netværk/auth) lod spinneren hænge for evigt, fordi
//     setLoading(false) aldrig blev nået.
//   - en Supabase-fejl returnerer { data: null, error } i stedet for at reject,
//     så et fejlet transaktions-kald lignede et tomt finans-overblik.
// #1349: mutation-feedback (msg-blokken) var visuel-only uden status-semantik
//   (WCAG 4.1.3) → skærmlæsere annoncerede ikke succes/fejl.
//
// Disse tests er kildekode-strukturelle (samme mønster som
// TeamPage.flashAuction.test.js / AuctionsPage.fields.test.js) — repoet kører
// `node --test` uden DOM-renderer, så vi guard'er invarianterne i kilden.

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "FinancePage.jsx"), "utf8");

// Isolér loadAll-funktionskroppen så vi kan assert'e PÅ den (ikke på resten af filen).
function extractFn(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start !== -1, `kunne ikke finde ${name} i FinancePage.jsx`);
  // Find den matchende afsluttende krølleparentes via dybde-tælling.
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`kunne ikke finde slut på ${name}`);
}

const loadAll = extractFn("loadAll");

test("#1350 FinancePage.loadAll wraps initial load i try/catch/finally", () => {
  assert.match(loadAll, /\btry\s*\{/, "loadAll mangler en try-blok om initial load");
  assert.match(loadAll, /\bcatch\b/, "loadAll mangler en catch — rejected request lader spinneren hænge");
  assert.match(loadAll, /\bfinally\s*\{/, "loadAll mangler finally — loading skal altid settle");
});

test("#1350 FinancePage settler loading i finally (ikke kun på success-stien)", () => {
  const finallyBlock = loadAll.match(/finally\s*\{([\s\S]*?)\}\s*$/);
  assert.ok(finallyBlock, "kunne ikke isolere finally-blokken");
  assert.match(
    finallyBlock[1],
    /setLoading\(false\)/,
    "setLoading(false) skal stå i finally — ellers hænger spinneren ved en rejected request",
  );
  assert.match(
    finallyBlock[1],
    /setForecastLoading\(false\)/,
    "setForecastLoading(false) skal også settle i finally",
  );
});

test("#1350 FinancePage behandler Supabase-error som load-fejl (ikke tom-state)", () => {
  // En Supabase-fejl returnerer { data: null, error } → uden denne guard ses et
  // tomt finans-overblik i stedet for en retry-bar fejl.
  // #2305: prize-query flyttede server-side (finance-report); guard'en dækker nu
  // reportRes.ok (fetch).
  // #2306: transaktionslistens fetch flyttede til sin egen fetchTxPage-funktion
  // (sæson-/kategori-filter + pagination), inkl. sin egen error-guard/state.
  const fetchTxPage = extractFn("fetchTxPage");
  assert.match(
    fetchTxPage,
    /if\s*\(\s*error\s*\)\s*throw\s+error/,
    "fetchTxPage mangler guard på Supabase-error (throw, ikke tavst [])",
  );
  assert.match(fetchTxPage, /setTxError\(true\)/, "fetchTxPage skal sætte txError ved Supabase-fejl");
  assert.match(
    loadAll,
    /if\s*\(\s*!reportRes\.ok\s*\)/,
    "loadAll mangler guard på reportRes.ok (finance-report-fetch, #2305)",
  );
  assert.match(loadAll, /setLoadError\(true\)/, "loadAll skal sætte loadError ved Supabase-fejl");
});

test("#1350 FinancePage renderer en retry-bar fejl-state (ikke evig spinner)", () => {
  assert.match(source, /if\s*\(loadError\)\s*return/, "FinancePage mangler en terminal loadError-render-gren");
  // Retry-knappen skal kalde loadAll igen.
  assert.match(
    source,
    /loadError[\s\S]*?onClick=\{loadAll\}/,
    "loadError-blokken mangler en retry-knap der kalder loadAll",
  );
  assert.match(source, /t\("loadError\.message"\)/, "loadError-blokken mangler lokaliseret besked");
  assert.match(source, /t\("loadError\.retry"\)/, "loadError-blokken mangler lokaliseret retry-tekst");
});

test("#1350 FinancePage resetter loadError ved (re)load", () => {
  assert.match(loadAll, /setLoadError\(false\)/, "loadAll skal nulstille loadError ved start, så retry kan rydde fejlen");
});

test("#1349 FinancePage mutation-feedback har status-semantik (WCAG 4.1.3)", () => {
  // msg-blokken skal have role + aria-live afhængig af type (fejl=assertiv, succes=høflig).
  assert.match(
    source,
    /role=\{msg\.type === "error" \? "alert" : "status"\}/,
    "msg-blokken mangler role=alert/status afhængig af msg.type",
  );
  assert.match(
    source,
    /aria-live=\{msg\.type === "error" \? "assertive" : "polite"\}/,
    "msg-blokken mangler aria-live=assertive/polite afhængig af msg.type",
  );
});

test("#1350/#1349 finance.json har de nye nøgler i både en og da (key-parity #410)", () => {
  const localesDir = join(__dirname, "..", "..", "public", "locales");
  for (const lng of ["en", "da"]) {
    const json = JSON.parse(readFileSync(join(localesDir, lng, "finance.json"), "utf8"));
    assert.equal(typeof json?.page?.loadingAria, "string", `${lng}/finance.json mangler page.loadingAria`);
    assert.equal(typeof json?.loadError?.message, "string", `${lng}/finance.json mangler loadError.message`);
    assert.equal(typeof json?.loadError?.retry, "string", `${lng}/finance.json mangler loadError.retry`);
  }
});
