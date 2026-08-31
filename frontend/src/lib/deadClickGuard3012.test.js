// #3012 — regressionsværn for de 13 resterende døde klik fra #3005-sweepet.
//
// Komponenterne kan ikke køres uden React-runtime i node --test, så kontrakten
// testes på kilden — samme mønster som networkErrorGuards.test.js /
// useBlockedAction.test.js.
//
// To klasser:
//   A (tavs fejl): en optimistisk/direkte Supabase-mutation der IKKE læste
//     { error } og derfor kunne divergere fra serveren i stilhed.
//   B (disabled uden forklaring): et kontrol-element hvis `disabled`-betingelse
//     var ren validering, uden nogen synlig begrundelse for spilleren.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(dir, p), "utf8");

// #4448: endMarker kan vaere en liste af alternativer — load*-funktioner findes
// baade som `async function loadX(` og som `const loadX = useCallback(` efter
// exhaustive-deps-oprydningen. Samme tilgang som FinancePage.loadStates.test.js.
function body(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `fandt ikke "${startMarker}" i ${label}`);
  const markers = Array.isArray(endMarker) ? endMarker : [endMarker];
  const end = markers
    .map((m) => source.indexOf(m, start + startMarker.length))
    .filter((i) => i > start)
    .sort((a, b) => a - b)[0];
  assert.ok(end > start, `fandt ingen af ${JSON.stringify(markers)} efter "${startMarker}" i ${label}`);
  return source.slice(start, end);
}

// ── Klasse A: hver ramte mutation læser { error } og reagerer på den ─────────

test("RidersPage.toggleWatchlist læser { error } fra begge writes", () => {
  const src = read("../pages/RidersPage.jsx");
  const fn = body(src, "async function toggleWatchlist(", ["async function loadRiders(", "const loadRiders = useCallback("], "RidersPage.toggleWatchlist");
  assert.match(fn, /const \{ error \} = await supabase\.from\("rider_watchlist"\)\.delete\(\)/);
  assert.match(fn, /const \{ error \} = await supabase\.from\("rider_watchlist"\)\.insert\(/);
  assert.match(fn, /if \(error\) \{/);
});

test("WatchlistPage.removeFromWatchlist + saveNote læser { error }", () => {
  const src = read("../pages/WatchlistPage.jsx");
  const removeFn = body(src, "async function removeFromWatchlist(", "async function saveNote(", "WatchlistPage.removeFromWatchlist");
  assert.match(removeFn, /const \{ error \} = await supabase\.from\("rider_watchlist"\)/);
  assert.match(removeFn, /if \(error\) \{/);
  const saveFn = body(src, "async function saveNote(", "async function startAuction(", "WatchlistPage.saveNote");
  assert.match(saveFn, /const \{ error \} = await supabase\.from\("rider_watchlist"\)/);
  assert.match(saveFn, /if \(error\) \{/);
});

test("ActivityPage.removeFromWatchlist læser { error }", () => {
  const src = read("../pages/ActivityPage.jsx");
  const fn = body(src, "async function removeFromWatchlist(", "// \"Needs action\"", "ActivityPage.removeFromWatchlist");
  assert.match(fn, /const \{ error \} = await supabase\.from\("rider_watchlist"\)/);
  assert.match(fn, /if \(error\) \{/);
});

test("RiderStatsPage.toggleWatchlist læser { error } fra begge writes", () => {
  const src = read("../pages/RiderStatsPage.jsx");
  const fn = body(src, "async function toggleWatchlist(", ["async function loadHistory(", "const loadHistory = useCallback("], "RiderStatsPage.toggleWatchlist");
  assert.match(fn, /const \{ error \} = await supabase\.from\("rider_watchlist"\)\.delete\(\)/);
  assert.match(fn, /const \{ data, error \} = await supabase\.from\("rider_watchlist"\)/);
  assert.match(fn, /if \(error\) \{/);
});

test("NotificationsPage: alle fem mutationer læser { error } og ruller tilbage", () => {
  const src = read("../pages/NotificationsPage.jsx");
  for (const [start, end, label] of [
    ["async function markRead(", "async function markManyRead(", "markRead"],
    ["async function markManyRead(", "async function deleteMany(", "markManyRead"],
    ["async function deleteMany(", "function toggleAggregate(", "deleteMany"],
    ["async function deleteNotif(", "async function deleteAllRead(", "deleteNotif"],
    ["async function deleteAllRead(", "const unreadCount", "deleteAllRead"],
  ]) {
    const fn = body(src, start, end, label);
    assert.match(fn, /const \{ error \} = await supabase\.from\("notifications"\)/, `${label}: mangler { error }-læsning`);
    assert.match(fn, /if \(error\) \{/, `${label}: mangler if (error)`);
    assert.match(fn, /setNotifications\(prev\)/, `${label}: ruller ikke optimistisk state tilbage`);
  }
});

test("Layout.signOut læser { error } fra supabase.auth.signOut()", () => {
  const src = read("../components/Layout.jsx");
  const fn = body(src, "async function signOut(", "function toggleGroup(", "Layout.signOut");
  assert.match(fn, /const \{ error \} = await supabase\.auth\.signOut\(\)/);
  assert.match(fn, /reportActionFailure\("auth_sign_out"/);
});

// ── Klasse B: hvert ramte kontrol-element forklarer hvorfor det er blokeret ──

test("FinancePage RepayButton bruger useBlockedAction + BlockedNote (ikke bar disabled)", () => {
  const src = read("../pages/FinancePage.jsx");
  const fn = body(src, "function RepayButton(", "function FinancePage()", "FinancePage.RepayButton");
  assert.match(fn, /useBlockedAction\(/);
  assert.match(fn, /<BlockedNote/);
});

test("PlannerDrawer PeakButton bruger useBlockedAction + BlockedNote", () => {
  const src = read("../components/planner/PlannerDrawer.jsx");
  const fn = body(src, "function PeakButton(", "function RaceDrawer(", "PlannerDrawer.PeakButton");
  assert.match(fn, /useBlockedAction\(/);
  assert.match(fn, /<BlockedNote/);
});

test("RaceSelectionPanel Gem-knappen viser altid en begrundelse (ikke touched-gated)", () => {
  const src = read("../components/race/RaceSelectionPanel.jsx");
  assert.match(src, /const saveBlock = useBlockedAction\(/);
  // Reason-noten må IKKE være betinget af `touched` — det var selve bugget.
  const noteBlock = body(src, "{saveBlock.blocked && (", "</div>", "RaceSelectionPanel save-note");
  assert.doesNotMatch(noteBlock, /touched/);
});

test("StandingsPage compare-knappen bruger useBlockedAction + BlockedNote", () => {
  const src = read("../pages/StandingsPage.jsx");
  assert.match(src, /const compareBlock = useBlockedAction\(/);
  assert.match(src, /compareBlock\.guard\(openCompare\)/);
  assert.match(src, /<BlockedNote id=\{compareBlock\.reasonId\}/);
});

test("TransfersPage OwnListingActions + MarketOfferForm bruger useBlockedAction", () => {
  const src = read("../pages/TransfersPage.jsx");
  const ownListing = body(src, "function OwnListingActions(", "function MarketStatBar(", "TransfersPage.OwnListingActions");
  assert.match(ownListing, /const priceBlock = useBlockedAction\(/);
  assert.match(ownListing, /<BlockedNote/);
  const offerForm = body(src, "function MarketOfferForm(", "function MarketRow(", "TransfersPage.MarketOfferForm");
  assert.match(offerForm, /const offerBlock = useBlockedAction\(/);
  assert.match(offerForm, /<BlockedNote/);
});

test("BoardPage WizardStep1 Start-knappen forklarer en tom preview", () => {
  const src = read("../pages/BoardPage.jsx");
  const fn = body(src, "function WizardStep1(", "function WizardStep2(", "BoardPage.WizardStep1");
  assert.match(fn, /const startBlock = useBlockedAction\(/);
  assert.match(fn, /<BlockedNote/);
});
