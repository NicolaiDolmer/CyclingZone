// Ret-runde PR #4728, fund #2+#4: den udfoldede praemie-sammensaetning
// (#4697/#4698) viste kun "Etape N placering: X CZ$" / "Klassifikation:
// X CZ$" uden rytternavn - selvom backend (buildPrizeBreakdown,
// backend/lib/myTeamLatestResult.js) allerede samler en riders[]-liste pr.
// gruppe. Det modsagde #4697's udtrykkeligt bekraeftede krav ("+ rider in
// the same view?" -> "Yes"). Denne fil er en kildekode-struktur-guard (samme
// moenster som MyLatestResultCard.seenServerFlag.test.js) - repoet koerer
// node --test uden DOM-renderer, saa vi verificerer render-logikken via
// kildeteksten i stedet for at rendere komponenten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "MyLatestResultCard.jsx"), "utf8");

test("#4697 breakdownRiderRows renderer én linje PR rytter (group.riders), ikke kun gruppens sum", () => {
  assert.match(
    source,
    /function breakdownRiderRows\(\{ group, keyPrefix, label \}\)/,
    "helperen der udfolder rytternavne pr. etape/klassifikation-gruppe skal findes",
  );
  assert.match(
    source,
    /group\.riders\?\.length > 0/,
    "skal grene på om gruppen har rytterdata",
  );
  assert.match(
    source,
    /group\.riders\.map\(\(r, i\) => \(/,
    "skal iterere ÉN linje pr. rytter i gruppen",
  );
});

test("#4697 hver rytterlinje viser rytternavnet og rytterens EGEN andel (r.amount), ikke gruppens total", () => {
  // r.rider_name skal stå i selve label-linjen ({label} · {r.rider_name})
  assert.match(
    source,
    /\{label\}\s*\{" · "\}\s*\{r\.rider_name\}/,
    "rytterlinjen skal vise rytternavnet ved siden af etape-/klassifikationslabelen",
  );
  // beløbet skal komme fra r.amount (den enkelte rytters andel), IKKE
  // group.amount (gruppens sum) — ellers smelter to ryttere i samme gruppe
  // sammen til én anonym sum igen (regression af selve fundet).
  assert.match(
    source,
    /formatNumber\(r\.amount\)/,
    "rytterlinjens beløb skal være rytterens EGEN andel (r.amount)",
  );
});

test("#4697 stages og classifications bruger begge breakdownRiderRows (ikke kun stages)", () => {
  assert.match(
    source,
    /\(prizeBreakdown\?\.stages \|\| \[\]\)\.flatMap\(\(s\) =>\s*breakdownRiderRows\(\{/,
    "etape-gruppen skal route gennem breakdownRiderRows",
  );
  assert.match(
    source,
    /\(prizeBreakdown\?\.classifications \|\| \[\]\)\.flatMap\(\(c\) =>\s*breakdownRiderRows\(\{/,
    "klassifikations-gruppen skal route gennem breakdownRiderRows",
  );
});

test("#4697 fallback: ingen rytterdata på gruppen -> én anonym sum-linje (group.amount), aldrig en tom liste", () => {
  assert.match(
    source,
    /formatNumber\(group\.amount\)/,
    "fallback-grenen skal stadig vise gruppens sum når der ikke er rytternavne at vise",
  );
});
