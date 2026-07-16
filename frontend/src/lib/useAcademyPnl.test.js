import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #2485 (Akademi-regnskabet) — kildekode-strukturelle tests, samme mønster som
// FinancePage.loadStates.test.js: repoet kører `node --test` uden DOM-renderer,
// så React-hooks guardes ved at assert'e på kilden i stedet for at rendere dem.
//
// #1350-klassen: en rejected fetch (netværk/auth) eller en Supabase/API-fejl skal
// ALTID settle loading via finally, ellers hænger spinneren for evigt på Akademi-siden.

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "useAcademyPnl.js"), "utf8");

function extractFn(name) {
  const start = source.indexOf(`const ${name} = useCallback(async`);
  assert.ok(start !== -1, `kunne ikke finde ${name} i useAcademyPnl.js`);
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

const refresh = extractFn("refresh");

test("#2485 useAcademyPnl.refresh wraps fetch i try/catch/finally", () => {
  assert.match(refresh, /\btry\s*\{/, "refresh mangler en try-blok om fetch");
  assert.match(refresh, /\bcatch\b/, "refresh mangler en catch — en rejected fetch må ikke lade spinneren hænge");
  assert.match(refresh, /\bfinally\s*\{/, "refresh mangler finally — loading skal altid settle");
});

test("#2485 useAcademyPnl.refresh settler loading i finally (ikke kun på success-stien)", () => {
  const finallyBlock = refresh.match(/finally\s*\{([\s\S]*?)\}\s*$/);
  assert.ok(finallyBlock, "kunne ikke isolere finally-blokken");
  assert.match(finallyBlock[1], /setLoading\(false\)/, "setLoading(false) skal stå i finally");
});

test("#2485 useAcademyPnl håndterer 409 (academy_disabled) uden at kaste — spejler useAcademy", () => {
  assert.match(refresh, /res\.status === 409/, "skal tjekke 409 (samme flag-gate som /academy/me)");
  assert.match(refresh, /academy_disabled/, "skal genkende academy_disabled-fejlkoden");
  assert.match(refresh, /setEnabled\(false\)/, "skal sætte enabled=false ved academy_disabled");
});

test("#2485 useAcademyPnl eksponerer data/enabled/loading/error/refresh", () => {
  assert.match(source, /return\s*\{\s*data,\s*enabled,\s*loading,\s*error,\s*refresh\s*\}/);
});
