// #5539 (forum 22/9, 2 spillere): "hvor mange procent af ET POINT flyttede
// sessionen evnen" — lille tabular-nums-tekst ved siden af progress-baren.
// Kildekode-struktur-guard (samme mønster som RaceSelectionPanel.riderProfile.test.js
// — repoet kører node --test uden DOM-renderer, ingen @testing-library her).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "AbilityReceiptRow.jsx"), "utf8");
const localesDir = join(__dirname, "..", "..", "..", "public", "locales");
const en = JSON.parse(readFileSync(join(localesDir, "en", "training.json"), "utf8"));
const da = JSON.parse(readFileSync(join(localesDir, "da", "training.json"), "utf8"));

test("#5539 komponenten afleder yesterdayGainPct via den delte, unit-testede helper (ingen egen matematik)", () => {
  assert.match(
    source,
    /import \{ abilityReceiptGainPct(?:, [A-Za-z_]+)* \} from "\.\.\/\.\.\/lib\/trainingReport\.js";/,
    "skal genbruge abilityReceiptGainPct fra trainingReport.js",
  );
  assert.match(
    source,
    /const yesterdayGainPct = abilityReceiptGainPct\(row\);/,
  );
});

test("#5539 teksten vises kun når der er en reel > 0 %-værdi, ellers en stille streg", () => {
  assert.match(
    source,
    /\{yesterdayGainPct != null \? t\(gainKey, gainVars\) : "—"\}/,
    "0 %/ingen data skal give streg-glyffen, aldrig den bogstavelige tekst \"0 %\"",
  );
});

test("#5539-fix teksten vælger dag via den delte receiptGainKeys (row.gainDay), ikke en hardcoded 'yesterday'", () => {
  assert.match(source, /const \{ gainKey, contributionKey \} = receiptGainKeys\(gainDay\);/);
  assert.match(source, /title=\{yesterdayGainPct != null \? t\(contributionKey, gainVars\) : undefined\}/);
  assert.doesNotMatch(source, /t\("receipt\.yesterdayGain"/);
});

test("#5539-fix dag-nøglerne (today/dated + contribution) findes i BÅDE en og da, med {pct} og {date} hvor relevant", () => {
  for (const [lang, dict] of [["en", en], ["da", da]]) {
    for (const key of ["todayGain", "datedGain", "todayContribution", "datedContribution", "yesterdayContribution"]) {
      assert.equal(typeof dict.receipt?.[key], "string", `mangler receipt.${key} i ${lang}`);
      assert.match(dict.receipt[key], /\{pct\}/, `receipt.${key} (${lang}) mangler {pct}`);
    }
    assert.match(dict.receipt.datedGain, /\{date\}/);
    assert.match(dict.receipt.datedContribution, /\{date\}/);
  }
});

test("#5539 den nye tekst er ALDRIG hardcoded '0 %' eller '0%' i JSX'en (skal altid gå via streg-faldet)", () => {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  assert.doesNotMatch(withoutComments, /"0\s?%"/);
});

test("#5539 kolonnen har fast bredde og er til stede i alle tre grene (låst/ingen-data/normal), så listens højre kant ikke hopper", () => {
  // Ligger EFTER den lukkede { locked ? ... : pct == null ? ... : (...) }-blok,
  // altså fælles for alle tre grene, ikke kun inde i "normal"-grenen.
  assert.match(
    source,
    /\)\}\s*\n\s*\{\/\* #5539:[\s\S]*?<span className="flex-none w-\[92px\] text-right font-mono tabular-nums text-3xs text-cz-3">/,
  );
});

test("#5539 header reserverer samme bredde som rækkerne (92px) uden XP, uden at overtage en formel kolonne-label", () => {
  assert.match(source, /<span className="flex-none w-\[92px\]" aria-hidden="true" \/>/);
  assert.match(source, /data-testid="ability-receipt-xp-day"/, "under XP staar dagens XP i samme kolonne");
});

test("#7947 (ejer 20/11) under XP deler raekke og overskrift bredderne, og hver kolonne har en overskrift", () => {
  for (const col of ["now", "season", "progress", "day"]) {
    assert.ok(source.includes(`XP_COL.${col}`), `raekken bruger XP_COL.${col}`);
  }
  const head = source.slice(source.indexOf("export function AbilityReceiptHeader"));
  for (const [key, col] of [["colNow", "now"], ["colSeason", "season"], ["colProgress", "progress"], ["colLatest", "day"]]) {
    assert.ok(head.includes(`head("receipt.${key}", XP_COL.${col}`), `${key} staar over XP_COL.${col}`);
  }
  // En overskrift bredere end kolonnen afkortes, den skubber aldrig naboen.
  assert.match(head, /\$\{width\} truncate/);
  // Saeson uden tal = ingen kolonne, i raekke og overskrift.
  assert.match(source, /const showSeason = !xpMode \|\| season;/);
  assert.match(head, /\{season && head\("receipt\.colSeason"/);
});

test("#7947 receipt.colLatest findes i alle fem sprog", () => {
  for (const lang of ["en", "da", "es", "fr", "nl"]) {
    const dict = JSON.parse(readFileSync(join(localesDir, lang, "training.json"), "utf8"));
    assert.equal(typeof dict.receipt?.colLatest, "string", `mangler receipt.colLatest i ${lang}`);
  }
});

test("#5539 i18n-nøglen 'receipt.yesterdayGain' findes i BÅDE en og da training.json (key-parity)", () => {
  assert.equal(typeof en.receipt?.yesterdayGain, "string", "mangler i en/training.json");
  assert.equal(typeof da.receipt?.yesterdayGain, "string", "mangler i da/training.json");
});

test("#5539 EN-copy matcher issuets format ('yesterday +N%'), DA matcher ('i går +N %')", () => {
  assert.match(en.receipt.yesterdayGain, /^yesterday \+\{pct\}%$/);
  assert.match(da.receipt.yesterdayGain, /^i går \+\{pct\} %$/);
});

test("#5539 EN-nøglen er fri for danske tegn (æøå) og omvendt ingen engelsk lækage i DA-nøglen", () => {
  assert.doesNotMatch(en.receipt.yesterdayGain, /[æøåÆØÅ]/);
  assert.match(da.receipt.yesterdayGain, /[æøå]/, "DA-copy bør bruge rigtige æ/ø/å, ikke ae/oe/aa (spec)");
});
