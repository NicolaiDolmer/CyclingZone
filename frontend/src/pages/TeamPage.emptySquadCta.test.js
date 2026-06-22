import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1569 — en ægte tom trup (ny spiller) skal være en guidende start, ikke en
// blindgyde. Tom-tilstanden peger nu på BÅDE markedet (/riders) og auktionerne
// (/auctions), så "hvad gør jeg nu?" har to konkrete svar.
// node --test uden DOM → kildekode-strukturel guard.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "TeamPage.jsx"), "utf8");

test("tom trup-CTA linker til markedet (#1569)", () => {
  assert.match(
    src,
    /<Link to="\/riders"[\s\S]*?squad\.emptyStateCta/,
    "tom-tilstand skal have en primær CTA til /riders",
  );
});

test("tom trup-CTA linker også til auktionerne (#1569)", () => {
  assert.match(
    src,
    /<Link to="\/auctions"[\s\S]*?squad\.emptyStateCtaAuctions/,
    "tom-tilstand skal have en sekundær CTA til /auctions",
  );
});
