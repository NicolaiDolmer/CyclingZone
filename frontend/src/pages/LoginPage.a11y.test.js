import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1349 (auth-formular-del) + #1348 — LoginPage skal have stabile input-id'er +
// htmlFor, aria-describedby for hjælp/fejl, aria-invalid på felter ved fejl,
// og en role="alert" live-region for fejlblokken. Desuden skal submit-handleren
// have en catch-gren (#1348), så rejected auth-kald ikke efterlader formularen
// uden fejlbesked. Source-assertion-mønster (ingen jsdom i repoet).

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "LoginPage.jsx"), "utf8");

test("hver label har htmlFor og det matchende input har samme id (#1349)", () => {
  const pairs = [
    ["auth-team-name", /htmlFor="auth-team-name"/, /id="auth-team-name"/],
    ["auth-manager-name", /htmlFor="auth-manager-name"/, /id="auth-manager-name"/],
    ["auth-email", /htmlFor="auth-email"/, /id="auth-email"/],
    ["auth-password", /htmlFor="auth-password"/, /id="auth-password"/],
  ];
  for (const [name, labelRe, inputRe] of pairs) {
    assert.match(src, labelRe, `label for '${name}' mangler htmlFor`);
    assert.match(src, inputRe, `input '${name}' mangler matchende id`);
  }
});

test("fejlblokken er en role=alert live-region med stabilt id (#1349)", () => {
  assert.match(
    src,
    /id="auth-error"[\s\S]*?role="alert"|role="alert"[\s\S]*?id="auth-error"/,
    "fejlblokken skal have role=\"alert\" + id=\"auth-error\" så skærmlæsere annoncerer fejlen",
  );
});

test("inputs får aria-invalid og aria-describedby peger på fejlen ved error (#1349)", () => {
  assert.match(src, /aria-invalid=\{error \? true : undefined\}/, "felter mangler aria-invalid ved fejl");
  // mindst ét felt skal kunne binde til fejl-id'et via aria-describedby
  assert.match(src, /error \? "auth-error" : null/, "aria-describedby binder ikke til fejlblokken");
});

test("hjælpetekster har id'er der matcher aria-describedby (#1349)", () => {
  for (const id of ["auth-team-name-help", "auth-manager-name-help", "auth-email-help", "auth-password-help"]) {
    assert.match(src, new RegExp(`id="${id}"`), `hjælpetekst mangler id="${id}"`);
    assert.match(src, new RegExp(`"${id}"`), `aria-describedby refererer ikke "${id}"`);
  }
});

test("success-blokken annonceres via role=status (#1349)", () => {
  assert.match(src, /role="status"/, "success-beskeden bør annonceres som en status-live-region");
});

test("handleSubmit har en catch-gren der sætter en fejlbesked (#1348)", () => {
  // Bug: try/finally UDEN catch — et rejected Supabase-kald clearede loading men
  // efterlod formularen uden fejl.
  assert.match(
    src,
    /\}\s*catch\s*\([^)]*\)\s*\{[\s\S]*?setError\(mapSupabaseAuthError\([^)]*\)\)/,
    "handleSubmit skal catche rejected auth-kald og sætte en mapSupabaseAuthError-besked",
  );
});

test("loading clears stadig i finally (#1348)", () => {
  assert.match(src, /finally\s*\{\s*setLoading\(false\);?\s*\}/, "finally skal stadig clear loading");
});
