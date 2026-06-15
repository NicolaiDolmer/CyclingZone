import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1349 (auth-formular-del) + #1348 — ResetPasswordPage skal have stabile
// input-id'er + htmlFor, aria-describedby for hjælp/fejl, aria-invalid på felter
// ved fejl, role=alert/role=status live-regions, og en catch-gren på submit
// (#1348) så et rejected updateUser-kald ikke efterlader formularen uden fejl.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "ResetPasswordPage.jsx"), "utf8");

test("hver label har htmlFor og det matchende input har samme id (#1349)", () => {
  const pairs = [
    ["reset-new-password", /htmlFor="reset-new-password"/, /id="reset-new-password"/],
    ["reset-confirm-password", /htmlFor="reset-confirm-password"/, /id="reset-confirm-password"/],
  ];
  for (const [name, labelRe, inputRe] of pairs) {
    assert.match(src, labelRe, `label for '${name}' mangler htmlFor`);
    assert.match(src, inputRe, `input '${name}' mangler matchende id`);
  }
});

test("fejlblokken er en role=alert live-region med stabilt id (#1349)", () => {
  assert.match(
    src,
    /id="reset-error"[\s\S]*?role="alert"|role="alert"[\s\S]*?id="reset-error"/,
    "fejlblokken skal have role=\"alert\" + id=\"reset-error\"",
  );
});

test("inputs får aria-invalid og binder aria-describedby til fejlen (#1349)", () => {
  // UI-fundament Plan 4 (#671): felterne bruger <Input error={…}>-primitiven, der
  // internt sætter aria-invalid={error || undefined} (testet i field.source.test.js).
  assert.match(src, /error=\{Boolean\(error\)\}/, "felter mangler error-prop (driver aria-invalid i Input-primitiven) ved fejl");
  assert.match(src, /error \? "reset-error"/, "aria-describedby binder ikke til fejlblokken");
});

test("ny-password hjælpetekst har id der matcher aria-describedby (#1349)", () => {
  assert.match(src, /id="reset-new-password-help"/, "hjælpetekst mangler id");
  assert.match(src, /"reset-new-password-help"/, "aria-describedby refererer ikke hjælpeteksten");
});

test("'link inaktiv'-blokken og success annonceres som live-regions (#1349)", () => {
  assert.match(src, /role="alert"/, "udløbet-link-blokken bør være en role=alert");
  assert.match(src, /role="status"/, "success/checking bør annonceres som role=status");
});

test("handleSubmit har en catch-gren der sætter en fejlbesked (#1348)", () => {
  assert.match(
    src,
    /\}\s*catch\s*\([^)]*\)\s*\{[\s\S]*?setError\(mapSupabaseAuthError\([^)]*\)\)/,
    "handleSubmit skal catche rejected updateUser-kald og sætte en mapSupabaseAuthError-besked",
  );
});

test("loading clears stadig i finally (#1348)", () => {
  assert.match(src, /finally\s*\{\s*setLoading\(false\);?\s*\}/, "finally skal stadig clear loading");
});
