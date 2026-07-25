import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestEmailFix, editDistance } from "./emailDomainSuggestion.js";

// #2826 — en af de 8 ubekræftede konti i prod var oprettet på "gmal.com".
// Bekræftelsesmailen kunne aldrig ankomme, og spilleren fik ingen indikation
// af hvorfor. Den her hint-funktion er det eneste sted fejlen kan fanges før
// mailen sendes.

test("fanger den faktiske prod-tastefejl gmal.com (#2826)", () => {
  const hit = suggestEmailFix("rytter@gmal.com");
  assert.deepEqual(hit, { suggestion: "rytter@gmail.com", domain: "gmail.com" });
});

test("fanger de almindelige gmail-varianter (#2826)", () => {
  // Ombytning (gmial) skal koste 1, ikke 2 — derfor Damerau og ikke ren Levenshtein.
  assert.equal(suggestEmailFix("a@gmial.com")?.domain, "gmail.com");
  assert.equal(suggestEmailFix("a@gmai.com")?.domain, "gmail.com");
  assert.equal(suggestEmailFix("a@gmail.co")?.domain, "gmail.com");
  assert.equal(suggestEmailFix("a@gmaill.com")?.domain, "gmail.com");
});

test("fanger typiske hotmail/outlook/icloud-fejl (#2826)", () => {
  assert.equal(suggestEmailFix("a@hotmai.com")?.domain, "hotmail.com");
  assert.equal(suggestEmailFix("a@hotmail.con")?.domain, "hotmail.com");
  assert.equal(suggestEmailFix("a@outlok.com")?.domain, "outlook.com");
  assert.equal(suggestEmailFix("a@iclould.com")?.domain, "icloud.com");
});

test("foreslår intet for korrekte adresser (#2826)", () => {
  // Alle domæner der faktisk optræder i prod-brugerbasen skal være tavse.
  for (const domain of [
    "gmail.com",
    "hotmail.com",
    "hotmail.co.uk",
    "outlook.com",
    "live.dk",
    "icloud.com",
    "yahoo.com",
  ]) {
    assert.equal(suggestEmailFix(`spiller@${domain}`), null, `${domain} udløste et falsk hint`);
  }
});

test("foreslår intet for ægte firmadomæner der ikke ligner noget (#2826)", () => {
  // peakbiotech.com er en RIGTIG adresse blandt de ubekræftede konti — den må
  // aldrig få et "mente du"-hint.
  assert.equal(suggestEmailFix("a@peakbiotech.com"), null);
  assert.equal(suggestEmailFix("a@cyclingzone.org"), null);
  assert.equal(suggestEmailFix("a@dtu.dk"), null);
});

test("er tavs mens adressen stadig skrives (#2826)", () => {
  // Hintet må ikke blinke undervejs i indtastningen.
  assert.equal(suggestEmailFix(""), null);
  assert.equal(suggestEmailFix("rytter"), null);
  assert.equal(suggestEmailFix("rytter@"), null);
  assert.equal(suggestEmailFix("rytter@gm"), null); // intet punktum endnu
  assert.equal(suggestEmailFix("@gmail.com"), null); // ingen local-part
});

test("håndterer ugyldigt input uden at kaste (#2826)", () => {
  assert.equal(suggestEmailFix(null), null);
  assert.equal(suggestEmailFix(undefined), null);
  assert.equal(suggestEmailFix(42), null);
  assert.equal(suggestEmailFix("a@b@c.com"), null); // to @ = ikke en adresse
});

test("bevarer local-part uændret og normaliserer kun domænet (#2826)", () => {
  // Local-part er case-sensitiv i teorien; vi må ikke ændre den.
  assert.equal(suggestEmailFix("Rytter.Navn+cz@GMAL.COM")?.suggestion, "Rytter.Navn+cz@gmail.com");
  assert.equal(suggestEmailFix("  a@gmal.com  ")?.suggestion, "a@gmail.com");
});

test("korte domæner får ikke afstand-2-gæt (#2826)", () => {
  // "mail.dk" (7 tegn) er et ægte domæne. Uden længde-gaten ville et vilkårligt
  // 7-tegns domæne 2 fejl væk blive foreslået som rettelse.
  assert.equal(suggestEmailFix("a@mail.dk"), null);
  assert.equal(suggestEmailFix("a@post.dk"), null);
});

test("editDistance tæller transposition som én fejl (#2826)", () => {
  assert.equal(editDistance("gmail.com", "gmail.com"), 0);
  assert.equal(editDistance("gmial.com", "gmail.com"), 1);
  assert.equal(editDistance("gmal.com", "gmail.com"), 1);
  assert.equal(editDistance("abc", "cba"), 2);
});
