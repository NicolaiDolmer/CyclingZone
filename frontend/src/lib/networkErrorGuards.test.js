// #3628 — regressionsværn for "knappen sidder fast i loading på et tabt net".
//
// Backwards-checket efter #3619 (som selv var backwards-checket efter #2719).
// `fetch()` REJECTER ved netværksudfald; mobil-WebKit kaster "TypeError: Load
// failed". Sker det i en handler der lige har sat en loading-tilstand, springes
// oprydningen over: knappen bliver stående i "Gemmer..." og er typisk `disabled`,
// så spilleren hverken ser fejlen eller kan prøve igen.
//
// Invarianten testes pr. HANDLER, ikke pr. fil: for hver af de seks rettede
// handlere skal kroppen indeholde (1) en try om det udgående kald, (2) en
// catch/finally der forlader loading-tilstanden, og (3) en cause videre til
// Sentry. Skrevet som en liste-invariant frem for enkeltassertions, fordi det
// netop var "naboen i samme fil fik aldrig samme kur" der lod #2719 gentage sig
// som #3619.
//
// Komponenterne kan ikke køres uden React-runtime i node --test, så kontrakten
// testes på kilden — samme mønster som useBlockedAction.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(dir, p), "utf8");

const profile = read("../pages/ProfilePage.jsx");
const riderStats = read("../pages/RiderStatsPage.jsx");
const board = read("../pages/BoardPage.jsx");

/** Klip kroppen af en handler ud af en kilde, fra startMarker til endMarker. */
function handlerBody(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `fandt ikke ${startMarker} i ${label}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `fandt ikke ${endMarker} efter ${startMarker} i ${label}`);
  return source.slice(start, end);
}

// De handlere #3628 rettede. `clears` er det udtryk der SKAL stå i catch/finally
// og forlade loading-/optimistik-tilstanden — det er den halvdel af kuren som en
// bar try/catch ikke giver af sig selv.
const FIXED_HANDLERS = [
  {
    label: "ProfilePage.toggleDmEnabled",
    source: profile,
    start: "async function toggleDmEnabled(",
    end: "async function toggleDmPref(",
    clears: /finally \{\s*setSavingDmEnabled\(false\);/,
  },
  {
    label: "ProfilePage.toggleDmPref",
    source: profile,
    start: "async function toggleDmPref(",
    end: "async function sendTestDm(",
    // Optimistisk UI: her er kuren ikke et loading-flag men en TILBAGERULNING —
    // uden den stod spilleren med en DM-type slået til som serveren aldrig fik.
    clears: /catch \(cause\) \{[\s\S]*await refreshDmStatus\(\);/,
  },
  {
    label: "ProfilePage.sendTestDm",
    source: profile,
    start: "async function sendTestDm(",
    end: "async function saveTeamInfo(",
    clears: /finally \{\s*setTestingDm\(false\);/,
  },
  {
    label: "ProfilePage.saveTeamInfo",
    source: profile,
    start: "async function saveTeamInfo(",
    end: "if (loading) return",
    clears: /finally \{\s*setSavingTeam\(false\);/,
  },
  {
    label: "RiderStatsPage.startAuction",
    source: riderStats,
    start: "async function startAuction(",
    end: "// Full-bleed-ruten",
    clears: /setAuctionError\(t\("errors:generic\.networkError"\)\)/,
  },
  {
    label: "BoardPage.fetchBoardProposal",
    source: board,
    start: "async function fetchBoardProposal(",
    end: "function openWizard(",
    // Kontrakten er "kaster aldrig": begge kaldere laver et bart await, og
    // loadPreview rydder previewLoading ud fra returværdien.
    clears: /return \{ error: t\("errors:generic\.networkError"\) \};/,
  },
];

for (const { label, source, start, end, clears } of FIXED_HANDLERS) {
  test(`${label}: et tabt net efterlader ikke handlingen i loading (#3628)`, () => {
    const body = handlerBody(source, start, end, label);
    assert.match(body, /\btry\s*\{/, `${label} skal have en try om sit udgående kald`);
    assert.match(body, /catch \(cause\) \{/, `${label} skal fange og navngive fejlen 'cause'`);
    assert.match(body, clears, `${label}: catch/finally skal forlade loading-/optimistik-tilstanden`);
    assert.match(
      body,
      /reportActionFailure\(/,
      `${label}: netværksfejlen skal tælles i Sentry, ikke bare tabes`,
    );
    assert.match(
      body,
      /reason: "network"/,
      `${label}: rapportér årsagen som "network" så den kan skilles fra afviste kald`,
    );
  });
}

test("de rettede handlere viser en lokaliseret netvaerksbesked, ikke en tom fejl (#3628)", () => {
  // errors:generic.networkError findes i BÅDE en og da (verificeret 14/8).
  assert.equal(
    (profile.match(/t\("errors:generic\.networkError"\)/g) || []).length,
    4,
    "alle fire Profil-handlere skal vise netværks-teksten",
  );
  assert.match(riderStats, /setAuctionError\(t\("errors:generic\.networkError"\)\)/);
  assert.match(board, /t\("errors:generic\.networkError"\)/);
});

test("AuctionButton rydder loading-flaget uanset om onStart kaster (#3628)", () => {
  // Loading-flaget ejes af submitAuction, ikke af startAuction — det var samme
  // rollefordeling som lod #3619 opstå: hver side regnede med at den anden
  // ryddede op. Her ryddes flaget hvor det sættes.
  const body = handlerBody(riderStats, "async function submitAuction(", "function handleSubmit(", "RiderStatsPage");
  assert.match(body, /try \{\s*await onStart\(/);
  assert.match(body, /finally \{\s*setLoading\(false\);/);
});
