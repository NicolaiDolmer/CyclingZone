// #2593 (del 2) — "Nyt"-badget på MyLatestResultCard (#2466) brugte
// localStorage til at huske senest sete løb; det nulstiller sig pr.
// enhed/browser (54,9% af besøg er mobil), så mange spillere så badgen "Nyt"
// igen for et løb de allerede havde set på en anden enhed. Fix: server-side
// seen-flag (teams.my_result_seen_race_id, race.seen i GET-payloaden) +
// POST /api/dashboard/my-latest-result/seen.
//
// Kildekode-struktur-guard (samme mønster som
// DashboardPage.onboardingServerPersist.test.js) — repoet kører node --test
// uden DOM-renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "MyLatestResultCard.jsx"), "utf8");

test("#2593 badge-state afledes af race.seen (server), ikke af et localStorage-flag", () => {
  // Kun selve API-kaldene (window.localStorage.getItem/setItem) skal væk — det
  // er OK at nævne "localStorage" i en forklarende kommentar om hvorfor det er
  // fjernet (#2466-arven).
  assert.doesNotMatch(
    source,
    /window\.localStorage\.(get|set)Item/,
    "det device-scopede localStorage-flag fra #2466 skal være fjernet — server er nu eneste sandhedskilde",
  );
  assert.match(
    source,
    /setIsNew\(!race\.seen\)/,
    "isNew skal afledes af det server-leverede race.seen-felt",
  );
});

test("#2593 useSeenBadge poster til /api/dashboard/my-latest-result/seen med race_id når et usét løb vises", () => {
  assert.match(
    source,
    /dashboard\/my-latest-result\/seen/,
    "skal kalde mark-seen-endpointet",
  );
  assert.match(
    source,
    /method:\s*"POST"/,
    "mark-seen-kaldet skal være en POST",
  );
  assert.match(
    source,
    /body:\s*JSON\.stringify\(\{\s*race_id:\s*raceId\s*\}\)/,
    "POST-body skal sende det viste løbs race_id",
  );
});

test("#2593 mark-seen kaldes IKKE når race.seen allerede er true (idempotent på klienten, undgår unødige roundtrips)", () => {
  assert.match(
    source,
    /if \(race\.seen \|\| markedRef\.current === raceId\) return;/,
    "effekten skal springe POST-kaldet over når løbet allerede er markeret set",
  );
});
