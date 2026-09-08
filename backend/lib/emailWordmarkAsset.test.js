// Guards the contract between scripts/build-email-wordmark.mjs and the email
// templates: the filename the backend points at must exist under
// frontend/public/brand and must actually carry that file's content hash.
//
// Why it matters (#2853, fundet 8/9): the mark used to live on the stable URL
// /brand/wordmark-email.png. When its pixels changed, prod served the new
// bytes but Outlook's image proxy kept the copy it had cached under the same
// URL for a week. Hashing the content into the filename makes every version
// its own immutable URL. If someone edits the PNG by hand without re-running
// the build script, the hash stops matching and this test fails.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WORDMARK_FILENAME } from "./emailWordmarkAsset.js";
import { buildWelcomeEmail } from "./emailTemplates.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const BRAND_DIR = path.resolve(here, "../../frontend/public/brand");
const wordmarkPath = path.join(BRAND_DIR, WORDMARK_FILENAME);

test("WORDMARK_FILENAME points at a file that exists in frontend/public/brand", () => {
  assert.match(WORDMARK_FILENAME, /^wordmark-email\.[0-9a-f]{8}\.png$/);
  assert.ok(existsSync(wordmarkPath), `missing brand asset: ${wordmarkPath}`);
});

test("the hash in the filename is the sha256 of the PNG's own bytes", () => {
  const expected = WORDMARK_FILENAME.match(/^wordmark-email\.([0-9a-f]{8})\.png$/)[1];
  const actual = createHash("sha256").update(readFileSync(wordmarkPath)).digest("hex");
  assert.ok(
    actual.startsWith(expected),
    `filename says ${expected}, file hashes to ${actual.slice(0, 8)} - re-run node scripts/build-email-wordmark.mjs`,
  );
});

test("the email HTML uses the hashed URL, never the cacheable un-hashed one", () => {
  const { html } = buildWelcomeEmail({ teamName: "T", unsubscribeUrl: "https://cyclingzone.org/u?token=a.b" });
  assert.ok(
    html.includes(`https://cyclingzone.org/brand/${WORDMARK_FILENAME}`),
    "band image points at the content-hashed brand URL",
  );
  assert.ok(
    !html.includes('wordmark-email.png"'),
    "no template may fall back to the un-hashed URL that mail proxies cache for a week",
  );
});
