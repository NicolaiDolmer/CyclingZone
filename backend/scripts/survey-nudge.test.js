import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SLUG,
  NOTIFICATION_TYPE,
  NUDGE_CODES,
  NUDGE_NOT_STARTED,
  NUDGE_STARTED,
  buildNudge,
  classifyRecipients,
  formatDryRunReport,
  nudgedUserIds,
  parseArgs,
  pendingRecipients,
  recipientIdsFromTeams,
  sampleUserIds,
  userIdSet,
  validateArgs,
} from "./survey-nudge.js";

test("dry-run er default: kun --execute skriver", () => {
  assert.equal(parseArgs([]).execute, false);
  assert.equal(parseArgs(["--dry-run"]).execute, false);
  assert.equal(parseArgs(["--execute"]).execute, true);
});

test("--survey defaulter til det aktive skema og kan overskrives", () => {
  assert.equal(parseArgs([]).slug, DEFAULT_SLUG);
  assert.equal(parseArgs(["--survey", "2027-01-features"]).slug, "2027-01-features");
});

test("et flag laeses aldrig som vaerdien til det foregaaende flag", () => {
  // Uden dette ville `--survey --execute` sende til et skema der hedder "--execute".
  assert.equal(parseArgs(["--survey", "--execute"]).slug, DEFAULT_SLUG);
  assert.equal(parseArgs(["--survey", "--execute"]).execute, true);
  assert.equal(parseArgs(["--set-closes-at", "--execute"]).setClosesAt, null);
  assert.equal(parseArgs(["--set-closes-at", "--execute"]).setClosesAtRequested, true);
});

test("--set-closes-at kraever --execute og en gyldig dato", () => {
  assert.deepEqual(validateArgs(parseArgs(["--execute"])), []);
  assert.deepEqual(validateArgs(parseArgs(["--execute", "--set-closes-at", "2026-09-14T21:59:00Z"])), []);

  const withoutExecute = validateArgs(parseArgs(["--set-closes-at", "2026-09-14T21:59:00Z"]));
  assert.equal(withoutExecute.length, 1);
  assert.match(withoutExecute[0], /kraever --execute/);

  const missingValue = validateArgs(parseArgs(["--execute", "--set-closes-at"]));
  assert.match(missingValue.join(" "), /mangler en ISO-dato/);

  const badDate = validateArgs(parseArgs(["--execute", "--set-closes-at", "soendag"]));
  assert.match(badDate.join(" "), /ikke en gyldig dato/);
});

test("modtagere er unikke user_id i stabil raekkefoelge, uden tomme", () => {
  assert.deepEqual(
    recipientIdsFromTeams([{ user_id: "u-2" }, { user_id: "u-1" }, { user_id: "u-2" }, { user_id: null }, {}, null]),
    ["u-2", "u-1"]
  );
  assert.deepEqual(recipientIdsFromTeams(null), []);
});

test("userIdSet ignorerer tomme raekker", () => {
  const ids = userIdSet([{ user_id: "u-1" }, { user_id: "u-1" }, { user_id: null }, null]);
  assert.deepEqual([...ids], ["u-1"]);
  assert.equal(userIdSet(null).size, 0);
});

test("modtagerne deles i gennemfoert, begyndt og ikke begyndt", () => {
  const groups = classifyRecipients({
    recipientIds: ["u-done", "u-started", "u-cold"],
    completedUserIds: new Set(["u-done"]),
    // En gennemfoert besvarelse har OGSAA svar-raekker. Den maa ikke tælle
    // som "begyndt": completion vinder.
    respondedUserIds: new Set(["u-done", "u-started"]),
  });
  assert.deepEqual(groups.completed, ["u-done"]);
  assert.deepEqual(groups.started, ["u-started"]);
  assert.deepEqual(groups.notStarted, ["u-cold"]);
});

test("classifyRecipients taager imod arrays saavel som Sets og taaler tomme input", () => {
  const groups = classifyRecipients({ recipientIds: ["u-1"], completedUserIds: [], respondedUserIds: ["u-1"] });
  assert.deepEqual(groups.started, ["u-1"]);
  assert.deepEqual(classifyRecipients({}), { completed: [], started: [], notStarted: [] });
});

test("et skub sendes kun een gang pr. bruger pr. skema (idempotens)", () => {
  const existing = [
    { user_id: "u-1", metadata: { surveySlug: DEFAULT_SLUG, surveyNudge: NUDGE_NOT_STARTED } },
    { user_id: "u-3", metadata: { surveySlug: DEFAULT_SLUG, surveyNudge: NUDGE_STARTED } },
  ];
  assert.deepEqual(pendingRecipients(["u-1", "u-2", "u-3"], existing, DEFAULT_SLUG), ["u-2"]);
  // Gentaget koersel paa uaendret data vaelger nul.
  assert.deepEqual(pendingRecipients(["u-1", "u-3"], existing, DEFAULT_SLUG), []);
});

test("variantskift giver ikke skub nummer to", () => {
  // u-1 fik "ikke begyndt"-skubbet og satte derefter eet kryds. Ved naeste
  // koersel er han "begyndt" — men han har allerede faaet sin ene besked.
  const existing = [{ user_id: "u-1", metadata: { surveySlug: DEFAULT_SLUG, surveyNudge: NUDGE_NOT_STARTED } }];
  assert.deepEqual(pendingRecipients(["u-1"], existing, DEFAULT_SLUG), []);
});

test("invitationen fra #4943 undertrykker ikke skubbet", () => {
  // Invitationen baerer surveySlug men INGEN surveyNudge. Ville den taelle,
  // fik ingen af de 218 nogensinde et skub.
  const invite = [{ user_id: "u-1", metadata: { surveySlug: DEFAULT_SLUG } }];
  assert.deepEqual(pendingRecipients(["u-1"], invite, DEFAULT_SLUG), ["u-1"]);
  assert.equal(nudgedUserIds(invite, DEFAULT_SLUG).size, 0);
});

test("et skub til ET skema undertrykker ikke skubbet til det naeste", () => {
  const existing = [
    { user_id: "u-1", metadata: { surveySlug: DEFAULT_SLUG, surveyNudge: NUDGE_NOT_STARTED } },
    { user_id: "u-2", metadata: null },
    { user_id: "u-2", metadata: {} },
  ];
  assert.deepEqual(pendingRecipients(["u-1", "u-2"], existing, "2027-01-features"), ["u-1", "u-2"]);
  assert.deepEqual(pendingRecipients(["u-1", "u-2"], [], DEFAULT_SLUG), ["u-1", "u-2"]);
  assert.deepEqual(pendingRecipients(["u-1", "u-2"], null, DEFAULT_SLUG), ["u-1", "u-2"]);
});

test("skubbet er en admin_notice med variant, slug og svartal i metadata", () => {
  const nudge = buildNudge({ slug: DEFAULT_SLUG, variant: NUDGE_NOT_STARTED, count: 28 });
  assert.equal(nudge.type, NOTIFICATION_TYPE);
  assert.equal(nudge.type, "admin_notice", "en ny type ville kraeve constraint + TYPE_CONFIG + parity-tests");
  assert.equal(nudge.metadata.surveySlug, DEFAULT_SLUG);
  assert.equal(nudge.metadata.surveyNudge, NUDGE_NOT_STARTED);
  assert.equal(nudge.metadata.titleCode, NUDGE_CODES[NUDGE_NOT_STARTED].titleCode);
  assert.equal(nudge.metadata.messageCode, NUDGE_CODES[NUDGE_NOT_STARTED].messageCode);
  assert.deepEqual(nudge.metadata.messageParams, { count: 28 });

  // EN-fallback i selve raekken skal vaere rigtig tekst, ikke noeglen: det er
  // det en klient uden i18n viser, og det er en del af dedupe-noeglen.
  assert.ok(nudge.title.length > 0);
  assert.notEqual(nudge.title, NUDGE_CODES[NUDGE_NOT_STARTED].titleCode);
  assert.ok(nudge.message.includes("28"), "svartallet skal vaere renderet ind i EN-fallbacken");
});

test("de to varianter har hver sin tekst", () => {
  const cold = buildNudge({ slug: DEFAULT_SLUG, variant: NUDGE_NOT_STARTED, count: 28 });
  const started = buildNudge({ slug: DEFAULT_SLUG, variant: NUDGE_STARTED, count: 28 });
  assert.notEqual(cold.title, started.title);
  assert.notEqual(cold.message, started.message);
  assert.throws(() => buildNudge({ slug: DEFAULT_SLUG, variant: "nope", count: 1 }), /unknown nudge variant/);
});

test("eksempel-brugere er anonymiserede id-praefikser", () => {
  const samples = sampleUserIds(["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "11111111-2222-3333-4444-555555555555"]);
  assert.deepEqual(samples, ["aaaaaaaa...", "11111111..."]);
  for (const sample of samples) {
    assert.equal(sample.length, 11, "kun praefiks, aldrig et helt user_id");
  }
  assert.equal(sampleUserIds(["a", "b", "c", "d"]).length, 3);
  assert.deepEqual(sampleUserIds(null), []);
});

test("dry-run-tabellen viser de fem tal og tre eksempler", () => {
  const report = formatDryRunReport({
    slug: DEFAULT_SLUG,
    status: "open",
    closesAt: "2026-09-14T21:59:00+00:00",
    groups: {
      completed: ["c-1", "c-2"],
      started: ["s-1", "s-2"],
      notStarted: ["n-1", "n-2", "n-3", "n-4"],
    },
    pending: { notStarted: ["n-2", "n-3", "n-4"], started: ["s-2"] },
  }).join("\n");

  assert.match(report, /Gennemfoert:\s+2/);
  assert.match(report, /Ikke begyndt:\s+4/);
  assert.match(report, /Begyndt, ikke sendt:\s+2/);
  assert.match(report, /Har allerede faaet:\s+2/, "6 udvalgte minus 4 ventende");
  assert.match(report, /Ville faa besked:\s+4/);
  assert.match(report, /2026-09-14T21:59:00/);
  assert.match(report, /n-2\.\.\. n-3\.\.\. n-4\.\.\./);
});

test("dry-run-tabellen siger det hoejt naar lukkedatoen ikke er sat", () => {
  const report = formatDryRunReport({
    slug: DEFAULT_SLUG,
    status: "open",
    closesAt: null,
    groups: { completed: [], started: [], notStarted: ["n-1"] },
    pending: { notStarted: ["n-1"], started: [] },
  }).join("\n");
  assert.match(report, /lukker ikke sat/);
  assert.match(report, /Har allerede faaet:\s+0/);
});
