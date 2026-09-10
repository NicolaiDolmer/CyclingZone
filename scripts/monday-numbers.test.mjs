// Guard for kanal-grupperingen i monday-numbers.mjs. Grupperne bærer
// kanal-tabellen i docs/GROWTH_STACK.md §2.1, så en stille ændring her ville
// flytte et tal i SSOT'en uden at nogen opdagede det.
//
// Kør: node --test scripts/monday-numbers.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { classifyChannel } from "./monday-numbers.mjs";

test("AI-assistenter samles i én gruppe (#4322)", () => {
  for (const host of ["https://chatgpt.com/", "https://www.perplexity.ai/x", "https://claude.ai/"]) {
    assert.equal(classifyChannel({ referrer: host }), "AI assistant");
  }
  // ChatGPT saetter selv utm_source; det maa ikke lande som sin egen kanal.
  assert.equal(classifyChannel({ utm_source: "chatgpt.com" }), "AI assistant");
});

test("Gmail-appens referrer er VORES egne mails, ikke en tredjepartskanal", () => {
  assert.equal(classifyChannel({ referrer: "android-app://com.google.android.gm/" }), "email (vores egne mails)");
});

test("Reddit-appen og reddit.com er samme kanal", () => {
  assert.equal(classifyChannel({ referrer: "android-app://com.reddit.frontpage/" }), "reddit");
  assert.equal(classifyChannel({ referrer: "https://www.reddit.com/r/procyclingmanager/" }), "reddit");
});

test("www-praefiks splitter ikke en kanal i to raekker", () => {
  assert.equal(classifyChannel({ referrer: "https://www.dugout-online.com/" }), classifyChannel({ referrer: "https://dugout-online.com/" }));
  assert.equal(classifyChannel({ referrer: "https://www85.hattrick.org/x" }), "hattrick");
});

test("utm_source vinder over referrer, fordi den er vores egen maerkning", () => {
  assert.equal(classifyChannel({ utm_source: "discord", referrer: "https://www.google.com/" }), "discord");
});

test("tom attribution er 'direct / ukendt', aldrig en kanal", () => {
  assert.equal(classifyChannel({}), "(direct / ukendt)");
  assert.equal(classifyChannel({ utm_source: "  ", referrer: "" }), "(direct / ukendt)");
});

test("soegemaskiner samles, og self-referral holdes ude af kanal-listen", () => {
  assert.equal(classifyChannel({ referrer: "https://www.google.at/" }), "soegning (organisk)");
  assert.equal(classifyChannel({ referrer: "https://duckduckgo.com/" }), "soegning (organisk)");
  assert.equal(classifyChannel({ referrer: "https://cyclingzone.org/dashboard" }), "self-referral");
});

test("lookalike domains cannot impersonate Hattrick or self-referrals", () => {
  for (const domain of ["hattrick.org", "cyclingzone.org", "cycling-zone.vercel.app"]) {
    for (const impostor of [`${domain}.example.com`, `evil-${domain}`]) {
      assert.equal(classifyChannel({ referrer: `https://${impostor}/` }), impostor);
      assert.equal(classifyChannel({ utm_source: impostor }), impostor);
    }
    assert.equal(classifyChannel({ referrer: `https://example.com/${domain}` }), "example.com");
    assert.equal(classifyChannel({ referrer: `https://${domain}@example.com/` }), "example.com");
  }
});

test("genuine hostnames and their subdomains retain their channel", () => {
  for (const [domain, expected] of [["hattrick.org", "hattrick"], ["cyclingzone.org", "self-referral"], ["cycling-zone.vercel.app", "self-referral"]]) {
    assert.equal(classifyChannel({ referrer: `https://sub.${domain}/` }), expected);
    assert.equal(classifyChannel({ utm_source: domain }), expected);
  }
});
