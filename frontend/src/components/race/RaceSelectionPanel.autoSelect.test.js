// #3310 quality-fix — Auto-select havde INGEN testdækning: hverken knappen, den
// generiske busy-lås (saving || autoStatus === "loading", commit a523bd4a) eller
// loadSelection()'s generations-baserede staleness-guard. Uden en regressionstest
// kan en fremtidig refaktorering af loadSelection reintroducere præcis den race-
// condition a523bd4a rettede (requestGeneration skal snapshottes FØR det første
// await-punkt, ikke efter). Kildekode-struktur-guard, samme mønster som
// MyLatestResultCard.seenServerFlag.test.js og
// NotificationsPage.stageResultLink.test.js — repoet kører node --test uden
// DOM-renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "RaceSelectionPanel.jsx"), "utf8");

test("#3310 loadSelection snapshotter requestGeneration FØR authHeaders()-awaitet", () => {
  // authHeaders() kan reelt gå på netværk (Supabase-token-refresh). Hvis
  // requestGeneration blev læst EFTER dette await, kunne et forældet kald (race A)
  // vågne efter raceId var skiftet til B og generationRef var steget, og læse det
  // NYE tal som sit eget — guarden ville så IKKE fange at kaldet var forældet.
  assert.match(
    source,
    /const loadSelection = useCallback\(async \(\) => \{[\s\S]{0,700}?const requestGeneration = generationRef\.current;[\s\S]{0,120}?const headers = await authHeaders\(\);/,
    "requestGeneration skal indfanges FØR det første await-punkt (authHeaders()) i loadSelection",
  );
});

test("#3310 loadSelection kasserer svaret hvis generationen er forældet EFTER fetch", () => {
  assert.match(
    source,
    /if \(requestGeneration !== generationRef\.current\) return;/,
    "staleness-guarden skal sammenligne det indfangede generationsnummer mod den aktuelle ref efter fetch'et",
  );
});

test("#3310 Auto-select-knappen kalder autoSelect og låses af den delte busy-lås", () => {
  assert.match(
    source,
    /onClick=\{autoSelect\}\s*\n\s*disabled=\{busy\}/,
    "Auto-select-knappen skal kalde autoSelect() og deaktiveres via den samme busy-variabel som resten af panelet",
  );
});

test("#3310 busy kombinerer saving OG autoStatus === \"loading\" (ikke kun saving)", () => {
  // a523bd4a: uden dette kan en manuel toggle/klik ske MENS auto-select's POST+reload
  // stadig kører, og race mod loadSelection()'s efterfølgende setSel() (sidste skriv
  // vinder, ikke-deterministisk).
  assert.match(
    source,
    /const busy = saving \|\| autoStatus === "loading";/,
    "busy skal låse UI'et under BÅDE et manuelt gem og et auto-select-kald",
  );
});

test("#3310 autoSelect() genindlæser via loadSelection() efter et vellykket POST i stedet for at sætte state direkte", () => {
  assert.match(
    source,
    /async function autoSelect\(\) \{[\s\S]{0,400}?await loadSelection\(\);/,
    "autoSelect skal genbruge loadSelection() (samme staleness-guard) frem for at duplikere state-opdateringen",
  );
});

test("#3310 autoSelect() sætter autoStatus til error ved non-ok svar eller netværksfejl, ikke den generiske save-status", () => {
  assert.match(
    source,
    /if \(!res\.ok\) \{ setAutoStatus\("error"\); return; \}/,
    "en fejlet auto-select skal ramme autoStatus, ikke det manuelle gem-flows status/errorKey",
  );
  assert.match(
    source,
    /async function autoSelect\(\) \{[\s\S]*?\} catch \{\s*setAutoStatus\("error"\);\s*\}/,
    "netværksfejl under auto-select skal også ramme autoStatus (catch-grenen)",
  );
});
