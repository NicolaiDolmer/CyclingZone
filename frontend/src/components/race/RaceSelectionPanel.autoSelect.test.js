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

// #5098 (CodeRabbit): et `[\s\S]{0,N}?`-vindue kan krydse funktionsgrænsen, så en
// assertion kunne blive opfyldt af kode i en HELT anden handler. Kroppen skæres
// derfor ud først (komponentens funktioner lukker med `}` i 2 mellemrums indryk),
// og matchene nedenfor kan ikke længere sive ud af den funktion de handler om.
function bodyOf(name) {
  const start = source.indexOf(`async function ${name}() {`);
  assert.notEqual(start, -1, `${name}() findes ikke i RaceSelectionPanel.jsx`);
  // CRLF eller LF — filen checkes ud med begge dele afhængigt af platform.
  const offset = source.slice(start).search(/\r?\n {2}\}/);
  assert.notEqual(offset, -1, `kunne ikke finde slutningen på ${name}()`);
  return source.slice(start, start + offset);
}

test("#3310 loadSelection snapshotter requestGeneration FØR authHeaders()-awaitet", () => {
  // authHeaders() kan reelt gå på netværk (Supabase-token-refresh). Hvis
  // requestGeneration blev læst EFTER dette await, kunne et forældet kald (race A)
  // vågne efter raceId var skiftet til B og generationRef var steget, og læse det
  // NYE tal som sit eget — guarden ville så IKKE fange at kaldet var forældet.
  // #5222: vinduet er udvidet 120 -> 260 tegn, fordi authHeaders() nu er flyttet
  // IND i try (en kommentar forklarer hvorfor mellem de to anker-linjer).
  assert.match(
    source,
    /const loadSelection = useCallback\(async \(\) => \{[\s\S]{0,700}?const requestGeneration = generationRef\.current;[\s\S]{0,260}?const headers = await authHeaders\(\);/,
    "requestGeneration skal indfanges FØR det første await-punkt (authHeaders()) i loadSelection",
  );
});

test("#3310 loadSelection kasserer svaret hvis generationen er forældet EFTER fetch", () => {
  // #5222: returnerer nu false i stedet for et bart `return;` — kaldere efter en
  // mutation (autoSelect(), retryReload()) skal kunne se om genindlæsningen lykkedes.
  assert.match(
    source,
    /if \(requestGeneration !== generationRef\.current\) return false;/,
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

test("#3310 busy kombinerer saving, autoStatus === \"loading\" OG autoStatus === \"reloadFailed\" (ikke kun saving)", () => {
  // a523bd4a: uden dette kan en manuel toggle/klik ske MENS auto-select's POST+reload
  // stadig kører, og race mod loadSelection()'s efterfølgende setSel() (sidste skriv
  // vinder, ikke-deterministisk).
  // #5222: reloadFailed låser ligesom loading — panelet må ikke åbne op med en GAMMEL
  // trup fordi genindlæsningen efter et lykkedes auto-udtag fejlede.
  assert.match(
    source,
    /const busy = saving \|\| autoStatus === "loading" \|\| autoStatus === "reloadFailed";/,
    "busy skal låse UI'et under et manuelt gem, et auto-select-kald OG en fejlet post-mutation-genindlæsning",
  );
});

test("#3310 autoSelect() genindlæser via loadSelection() efter et vellykket POST i stedet for at sætte state direkte", () => {
  // #5098: matchet sker nu i autoSelect()'s EGEN krop i stedet for i et
  // tegn-vindue der kunne nå ud i en anden funktion — strammere end før, og
  // uafhængigt af hvor mange guards handleren får med tiden.
  assert.match(
    bodyOf("autoSelect"),
    /await loadSelection\(\);/,
    "autoSelect skal genbruge loadSelection() (samme staleness-guard) frem for at duplikere state-opdateringen",
  );
});

test("#3310 autoSelect() sætter autoStatus til error ved non-ok svar eller netværksfejl, ikke den generiske save-status", () => {
  assert.match(
    source,
    /if \(!res\.ok\) \{ setAutoStatus\("error"\); return; \}/,
    "en fejlet auto-select skal ramme autoStatus, ikke det manuelle gem-flows status/errorKey",
  );
  // #5098: catch-grenen SKAL indledes med generations-guarden og må ikke
  // indeholde andet — et forældet netværksudfald fra et andet løb skal ikke
  // skrive en fejl på det panel spilleren står i nu.
  assert.match(
    bodyOf("autoSelect"),
    /\} catch \{\s*if \(isStale\(gen\)\) return;\s*setAutoStatus\("error"\);\s*\}/,
    "netværksfejl under auto-select skal ramme autoStatus (catch-grenen), og kun når kaldet stadig hører til dette løb",
  );
});

// #3310 quality-fix (reviewer-fund): save() og autoSelect() deler statusvisningen
// (linje ~534-550) men ryddede tidligere aldrig hinandens statusvariabel. Et
// mislykket manuelt Gem efterlod status="error" stående efter et efterfølgende
// vellykket Auto-select (og omvendt: et mislykket Auto-select-forsøg efterlod
// "Could not auto-select" synligt ved siden af et senere vellykket manuelt Gem).
test("#3310 save() rydder autoStatus ved start, så et forældet auto-select-fejlsvar ikke overlever et nyt manuelt Gem", () => {
  assert.match(
    source,
    /async function save\(\) \{[\s\S]{0,700}?if \(autoStatus !== "idle"\) setAutoStatus\("idle"\);/,
    "save() skal nulstille autoStatus til idle ved start, ikke kun sin egen status/errorKey/errorDetail",
  );
});

test("#3310 autoSelect() rydder status/errorKey/errorDetail ved start, så et forældet manuelt gem-fejlsvar ikke overlever et nyt Auto-select", () => {
  assert.match(
    source,
    /async function autoSelect\(\) \{[\s\S]{0,400}?if \(status !== "idle"\) setStatus\("idle"\);[\s\S]{0,120}?if \(errorKey\) setErrorKey\(null\);[\s\S]{0,120}?if \(errorDetail\) setErrorDetail\(null\);/,
    "autoSelect() skal nulstille status, errorKey OG errorDetail til deres idle/null-værdier ved start",
  );
});

// =============================================================================
// #5222 — CodeRabbit-opfølger fra #5206: loadSelection() efter et lykkedes
// auto-udtag (eller Gem-lignende server-mutation) kunne fejle (auth/HTTP/parse/
// netværk) UDEN at panelet nogensinde vidste det — dropDraft() havde allerede
// glemt udkastet og åbnet reload-porten, så panelet lod op med den GAMLE trup,
// som om den var gemt. Reelt DOM/mock-fetch-dækning af dette hører til
// tests/e2e/race-selection.spec.js (Playwright, orkestrator-ejet slot); disse
// er kildekode-struktur-guards i samme stil som resten af filen.
// =============================================================================

test("#5222 loadSelection() returnerer true ved en lykkedes genindlæsning", () => {
  assert.match(
    source,
    /const loadSelection = useCallback\(async \(\) => \{[\s\S]*?return true;[\s\S]*?\}, \[raceId\]\);/,
    "loadSelection() skal returnere true efter setData/setSel, så en kalder kan skelne succes fra fejl",
  );
});

test("#5222 autoSelect() sætter reloadFailed (ikke idle) når post-mutation-genindlæsningen fejler", () => {
  assert.match(
    bodyOf("autoSelect"),
    /const reloaded = await loadSelection\(\);\s*\n\s*if \(isStale\(gen\)\) return;\s*\n\s*setAutoStatus\(reloaded \? "idle" : "reloadFailed"\);/,
    "autoSelect() må kun sætte idle ved en LYKKEDES genindlæsning, ellers reloadFailed så kontrollerne forbliver låste",
  );
});

test("#5222 reloadFailed låser kontrollerne ligesom loading (busy + earlyBusy)", () => {
  assert.match(
    source,
    /const earlyBusy = earlySaving \|\| autoStatus === "loading" \|\| autoStatus === "reloadFailed";/,
    "earlyBusy skal også dække reloadFailed, ellers kan saveBlock/reload-gaten regne forkert i det vindue",
  );
  assert.match(
    source,
    /const busy = saving \|\| autoStatus === "loading" \|\| autoStatus === "reloadFailed";/,
    "busy skal deaktivere checkbokse/rollevælgere/Gem/Auto-select under reloadFailed, ikke kun loading",
  );
});

test("#5222 en \"Prøv igen\"-knap tilbyder et nyt loadSelection()-forsøg og lander på idle eller reloadFailed igen", () => {
  assert.match(
    source,
    /async function retryReload\(\) \{[\s\S]{0,50}?setAutoStatus\("loading"\);[\s\S]{0,50}?const reloaded = await loadSelection\(\);[\s\S]{0,80}?setAutoStatus\(reloaded \? "idle" : "reloadFailed"\);/,
    "retryReload() skal genbruge loadSelection() og selv kunne falde tilbage i reloadFailed hvis forsøget fejler igen",
  );
  assert.match(
    source,
    /autoStatus === "reloadFailed" && \([\s\S]{0,300}?onClick=\{retryReload\}/,
    "reloadFailed-linjen skal vise en knap der kalder retryReload()",
  );
});
