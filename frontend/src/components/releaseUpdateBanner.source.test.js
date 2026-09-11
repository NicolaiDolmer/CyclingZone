import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "ReleaseUpdateBanner.jsx"), "utf8");
const en = JSON.parse(readFileSync(join(here, "../../public/locales/en/banners.json"), "utf8"));
const da = JSON.parse(readFileSync(join(here, "../../public/locales/da/banners.json"), "utf8"));

// #5159 review-fund 6 (TASTE §P3: ÉN gold primary pr. view). Banneret er en
// stribe oven paa en vilkaarlig side — laegger den sin egen guld-knap i
// billedet, er viewets egen primary (Gem, Log ind) ikke laengere den ene.
test("bannerets knapper er ALDRIG gold primary (TASTE §P3)", () => {
  assert.ok(!/variant="primary"/.test(src), 'banneret maa ikke bruge variant="primary"');
  assert.match(src, /variant="secondary"/);
});

// #5159 review-fund 2: klikket springer stadig porten over — det er spillerens
// egen beslutning — men det skal SIGE hvad det koster foerst.
test("manuelt klik med lukket port bekraefter foerst, uden browser-confirm", () => {
  assert.match(src, /isReloadAllowed\(\)/, "porten laeses paa klik-tidspunktet");
  assert.match(src, /setConfirming\(true\)/);
  // Kommentarer strippes foerst: prosaen NAEVNER browser-confirm for at forklare
  // hvorfor den ikke bruges, og vagten skal se paa kode, ikke paa prosa.
  const code = src.replace(/\/\/[^\n]*/g, "");
  assert.ok(!/\bconfirm\s*\(/.test(code), "ingen browser-confirm() — den er en fokus-faelde");
  // To veje ud: gem foerst (luk banneret, intet reload) eller opdater alligevel.
  assert.match(src, /release-update-save-first/);
  assert.match(src, /onDismiss\?\.\(\)/);
  assert.match(src, /releaseUpdate\.updateAnyway/);
});

test("bekraeftelses-copyen findes paa BEGGE sprog (EN foerst, DA under)", () => {
  for (const key of ["title", "action", "unsavedTitle", "saveFirst", "updateAnyway", "regionAriaLabel"]) {
    assert.equal(typeof en.releaseUpdate[key], "string", `EN mangler releaseUpdate.${key}`);
    assert.equal(typeof da.releaseUpdate[key], "string", `DA mangler releaseUpdate.${key}`);
    assert.notEqual(en.releaseUpdate[key].trim(), "", `EN releaseUpdate.${key} er tom`);
    assert.notEqual(da.releaseUpdate[key].trim(), "", `DA releaseUpdate.${key} er tom`);
  }
  // TONE_OF_VOICE: spilleren tiltales "you"/"du" — aldrig "we"/"vi".
  assert.match(en.releaseUpdate.unsavedTitle, /^You have unsaved changes\./);
  assert.match(da.releaseUpdate.unsavedTitle, /^Du har ugemte ændringer\./);
});

// #5159 review-fund 5: banneret deler `fixed inset-x-0 bottom-0 z-toast` med
// cookie-banneret og NPS-prompten og tegner ovenpaa dem.
test("banneret gater sig selv paa samtykke-banneret og paa anonym landing", () => {
  assert.match(src, /consentBannerOpen/);
  assert.match(src, /anonymousOnLanding/);
  assert.match(src, /!hasSession && pathname === "\/"/);
  assert.match(src, /const visible = Boolean\(show\) && !consentBannerOpen && !anonymousOnLanding/);
});

// App er rodkomponenten: et abonnement dér gen-renderer HELE traeet, inklusive
// den prerendrede landing, hver gang samtykket eller ruten aendrer sig. Gaten
// hoerer derfor til i bladet. (Den blev flyttet under jagten paa et React
// #418-flake i WebKit; flytningen fjernede ikke flaket — det er maalt paa
// bee33ecf4 uden dette spors aendringer — men placeringen er den rigtige uanset.)
test("App abonnerer IKKE paa samtykke-contexten (roden gen-renderer hele traeet)", () => {
  const app = readFileSync(join(here, "../App.jsx"), "utf8");
  assert.ok(!/useConsent/.test(app), "App maa ikke laese samtykke-contexten — banneret goer det selv");
  assert.match(app, /hasSession=\{Boolean\(session\)\}/, "session kommer som prop, ikke som et nyt abonnement");
});
