import test from "node:test";
import assert from "node:assert/strict";
import {
  DIRECT,
  referrerHost,
  isSelfHost,
  channelFromHost,
  resolveChannel,
} from "./trafficChannel.js";

// Testene bygger på de FAKTISKE referrer-værdier fra prod (signup_attribution,
// målt 27/8), ikke på opdigtede eksempler. Hver case herunder svarer til rækker
// der findes i tabellen.

test("referrerHost: trækker værten ud af en almindelig URL", () => {
  assert.equal(referrerHost("https://www.google.com/search?q=cycling"), "www.google.com");
  assert.equal(referrerHost("https://chatgpt.com/"), "chatgpt.com");
});

test("referrerHost: android-app-referrers giver pakkenavnet som vært", () => {
  // Verificeret WHATWG-URL-adfærd. Hele Gmail- og Reddit-app-mappingen hviler
  // på den, så den skal fejle højlydt hvis Node ændrer sig.
  assert.equal(referrerHost("android-app://com.google.android.gm/"), "com.google.android.gm");
  assert.equal(referrerHost("android-app://com.reddit.frontpage/"), "com.reddit.frontpage");
});

test("referrerHost: tom eller ugyldig værdi", () => {
  assert.equal(referrerHost(null), null);
  assert.equal(referrerHost(""), null);
  assert.equal(referrerHost("   "), null);
  // Ikke-parsebar streng falder tilbage til sig selv frem for at kaste.
  assert.equal(referrerHost("ikke en url"), "ikke en url");
});

test("isSelfHost: vores egne værter, inklusive subdomæner", () => {
  assert.equal(isSelfHost("cyclingzone.org"), true);
  assert.equal(isSelfHost("www.cyclingzone.org"), true);
  assert.equal(isSelfHost("cycling-zone.vercel.app"), true);
  assert.equal(isSelfHost("reddit.com"), false);
  assert.equal(isSelfHost(null), false);
});

test("self-referral tælles som direct, ikke som en kanal (#3819-værn)", () => {
  // 214 af 595 Clarity-sessions var cyclingzone.org → cyclingzone.org. Den
  // klasse af støj må aldrig nå vores egen kanal-rapport.
  assert.equal(resolveChannel({ referrer: "https://cyclingzone.org/login" }), DIRECT);
  assert.equal(resolveChannel({ referrer: "https://www.cyclingzone.org/riders" }), DIRECT);
});

test("Reddit: web og app er SAMME kanal", () => {
  // Før #4320 blev de talt hver for sig: 12 fra www.reddit.com + 4 fra appen.
  // Kanalen var undervurderet med en tredjedel.
  assert.equal(resolveChannel({ referrer: "https://www.reddit.com/r/cycling" }), "reddit");
  assert.equal(resolveChannel({ referrer: "android-app://com.reddit.frontpage/" }), "reddit");
  assert.equal(resolveChannel({ referrer: "https://old.reddit.com/" }), "reddit");
});

test("Gmail-appen er e-mail, ikke ukendt", () => {
  // 11 signups stod som direct/ukendt før #4320.
  assert.equal(resolveChannel({ referrer: "android-app://com.google.android.gm/" }), "email");
  assert.equal(resolveChannel({ referrer: "https://mail.google.com/" }), "email");
});

test("AI-assistenter samles i én kanal, uanset om de kommer via referrer eller UTM", () => {
  // ChatGPT sætter selv utm_source=chatgpt.com. Uden alias ville de to veje
  // blive to forskellige kanaler for samme trafik.
  assert.equal(resolveChannel({ referrer: "https://chatgpt.com/" }), "ai-assistant");
  assert.equal(resolveChannel({ utmSource: "chatgpt.com" }), "ai-assistant");
  assert.equal(resolveChannel({ referrer: "https://www.perplexity.ai/" }), "ai-assistant");
  assert.equal(resolveChannel({ referrer: "https://claude.ai/" }), "ai-assistant");
});

test("Hattrick roterer på nummererede servere", () => {
  // www85..www89 + stage findes alle i prod-data.
  for (const host of ["www85", "www86", "www87", "www88", "www89", "stage"]) {
    assert.equal(resolveChannel({ referrer: `https://${host}.hattrick.org/` }), "hattrick");
  }
});

test("apex-domæne og www-subdomæne er SAMME kanal", () => {
  // Fundet ved at køre aggregatoren mod ægte prod-data 27/8: dugout-online.com
  // og www.dugout-online.com blev to separate kanaler, fordi reglen kun testede
  // suffikset ".dugout-online.com". Samme fejlklasse som Reddit-web vs. app.
  assert.equal(resolveChannel({ referrer: "https://dugout-online.com/" }), "dugout-online");
  assert.equal(resolveChannel({ referrer: "https://www.dugout-online.com/" }), "dugout-online");

  // Gælder alle domæne-regler, ikke kun den ene der blev fundet.
  assert.equal(channelFromHost("hattrick.org"), "hattrick");
  assert.equal(channelFromHost("www89.hattrick.org"), "hattrick");
  assert.equal(channelFromHost("perplexity.ai"), "ai-assistant");
  assert.equal(channelFromHost("www.perplexity.ai"), "ai-assistant");
  assert.equal(channelFromHost("youtube.com"), "youtube");
  assert.equal(channelFromHost("m.youtube.com"), "youtube");
});

test("domæne-regler fanger ikke værter der blot ender på samme bogstaver", () => {
  // "ikkehattrick.org" ender ikke på ".hattrick.org" og må ikke matche.
  assert.equal(channelFromHost("ikkehattrick.org"), "ikkehattrick.org");
  assert.equal(channelFromHost("fakereddit.com"), "fakereddit.com");
});

test("Google-landedomæner er organisk søgning", () => {
  assert.equal(channelFromHost("google.com"), "organic-search");
  assert.equal(channelFromHost("www.google.com"), "organic-search");
  assert.equal(channelFromHost("google.dk"), "organic-search");
  assert.equal(channelFromHost("www.google.co.uk"), "organic-search");
});

test("Google-mønsteret fanger ikke værter der blot indeholder 'google'", () => {
  assert.equal(channelFromHost("notgoogle.com"), "notgoogle.com");
  assert.equal(channelFromHost("google-analytics.com"), "google-analytics.com");
});

test("utm_source vinder over referrer", () => {
  // Har vi selv tagget linket, er taggen sandheden.
  assert.equal(
    resolveChannel({ utmSource: "discord", referrer: "https://www.google.com/" }),
    "discord"
  );
});

test("ukendte værter beholder deres eget navn", () => {
  // De må ikke forsvinde i en "other"-spand: en ny trafikkilde skal kunne ses.
  assert.equal(resolveChannel({ referrer: "https://cyklingsforum.example/" }), "cyklingsforum.example");
});

test("hverken UTM eller referrer giver direct", () => {
  assert.equal(resolveChannel({}), DIRECT);
  assert.equal(resolveChannel({ utmSource: null, referrer: null }), DIRECT);
  assert.equal(resolveChannel(), DIRECT);
});

test("host kan gives direkte i stedet for en fuld referrer", () => {
  // Trafik-siden læser referrer_host fra databasen og har ingen fuld URL.
  assert.equal(resolveChannel({ host: "www.reddit.com" }), "reddit");
  assert.equal(resolveChannel({ host: "cyclingzone.org" }), DIRECT);
});

test("versalfølsomhed betyder ingenting", () => {
  assert.equal(resolveChannel({ referrer: "https://WWW.Reddit.COM/" }), "reddit");
  assert.equal(resolveChannel({ utmSource: "ChatGPT.com" }), "ai-assistant");
});
