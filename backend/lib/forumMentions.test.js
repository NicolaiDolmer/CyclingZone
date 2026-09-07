import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMentionIndex,
  findForumMentions,
  loadMentionableManagers,
  normalizeMentionName,
  splitMentionSegments,
  uniqueMentionTargets,
} from "./forumMentions.js";

// #5011 — matchereglerne for @-tag i forummet. Kanttilfældene her er dem
// ejeren og spillerne rammer i praksis: navne med mellemrum, æøå, tegnsætning
// lige efter navnet, to tags i samme indlæg, selv-tag og ukendte navne.

const MANAGERS = [
  { userId: "u-nic", teamId: "t-nic", name: "Nicolai" },
  { userId: "u-sky", teamId: "t-sky", name: "Team Sky Racing" },
  { userId: "u-team", teamId: "t-team", name: "Team" },
  { userId: "u-soren", teamId: "t-soren", name: "Søren Kjærgaard" },
  { userId: "u-jr", teamId: "t-jr", name: "J.R." },
];

function namesIn(text, managers = MANAGERS) {
  return findForumMentions(text, managers).map((m) => m.manager.name);
}

test("normalizeMentionName: små bogstaver + kollapset whitespace", () => {
  assert.equal(normalizeMentionName("  Team   Sky  "), "team sky");
  assert.equal(normalizeMentionName("SØREN"), "søren");
  assert.equal(normalizeMentionName(null), "");
});

test("matcher case-insensitivt", () => {
  assert.deepEqual(namesIn("hej @NICOLAI"), ["Nicolai"]);
  assert.deepEqual(namesIn("hej @nicolai"), ["Nicolai"]);
});

test("kun HELE navne — et prefix rammer aldrig", () => {
  assert.deepEqual(namesIn("@Nico kan du se det?"), []);
  assert.deepEqual(namesIn("@Nicolais hold"), []);
});

test("navne med mellemrum matches, og det LÆNGSTE navn vinder", () => {
  assert.deepEqual(namesIn("@Team Sky Racing kører godt"), ["Team Sky Racing"]);
  // "Team" findes også som selvstændig manager — men kun når intet længere passer.
  assert.deepEqual(namesIn("@Team er et hold"), ["Team"]);
});

test("æøå i navnet", () => {
  assert.deepEqual(namesIn("godt kørt @Søren Kjærgaard"), ["Søren Kjærgaard"]);
  assert.deepEqual(namesIn("godt kørt @søren kjærgaard!"), ["Søren Kjærgaard"]);
});

test("tegnsætning lige efter navnet ignoreres", () => {
  for (const suffix of [".", ",", "!", "?", ":", ";", ")", "…", '"']) {
    assert.deepEqual(namesIn(`hej @Nicolai${suffix} resten`), ["Nicolai"], `fejlede for "${suffix}"`);
  }
});

test("et navn der SELV ender på punktum matches råt", () => {
  assert.deepEqual(namesIn("spørg @J.R. om det"), ["J.R."]);
});

test("to tags i samme indlæg giver to matches, i tekstrækkefølge", () => {
  assert.deepEqual(namesIn("@Nicolai og @Team Sky Racing skal se det"), ["Nicolai", "Team Sky Racing"]);
});

test("ukendt navn giver intet match", () => {
  assert.deepEqual(namesIn("@Ukendt Manager her"), []);
});

test("e-mailadresser bliver aldrig til tags", () => {
  assert.deepEqual(namesIn("skriv til nicolai@Nicolai.dk"), []);
});

test("'@' uden navn, eller med mellemrum efter, er ikke et tag", () => {
  assert.deepEqual(namesIn("prisen er 10 @ stykket"), []);
  assert.deepEqual(namesIn("hej @"), []);
});

test("et tag kan ikke løbe hen over et linjeskift", () => {
  assert.deepEqual(namesIn("@Team\nSky Racing"), ["Team"]);
});

test("index/length dækker hele tagget inkl. '@'", () => {
  const [match] = findForumMentions("ja @Nicolai, enig", MANAGERS);
  assert.equal(match.index, 3);
  assert.equal(match.length, "@Nicolai".length);
  assert.equal(match.name, "Nicolai");
});

test("tom tekst, tekst uden '@' og tomt manager-index koster ingen match", () => {
  assert.deepEqual(findForumMentions("", MANAGERS), []);
  assert.deepEqual(findForumMentions("helt uden tags", MANAGERS), []);
  assert.deepEqual(findForumMentions("@Nicolai", []), []);
  assert.deepEqual(findForumMentions(null, MANAGERS), []);
});

test("buildMentionIndex: første navn vinder ved kollision", () => {
  const index = buildMentionIndex([
    { userId: "a", name: "Dublet" },
    { userId: "b", name: "dublet" },
  ]);
  assert.equal(index.size, 1);
  assert.equal(index.get("dublet").userId, "a");
});

test("uniqueMentionTargets: én pr. bruger, aldrig skribenten selv", () => {
  const matches = findForumMentions("@Nicolai @nicolai @Team Sky Racing", MANAGERS);
  assert.equal(matches.length, 3);
  const targets = uniqueMentionTargets(matches, { excludeUserId: "u-sky" });
  assert.deepEqual(targets.map((t) => t.userId), ["u-nic"]);
});

test("uniqueMentionTargets: selv-tag alene giver ingen modtagere", () => {
  const targets = uniqueMentionTargets(findForumMentions("@Nicolai selv", MANAGERS), { excludeUserId: "u-nic" });
  assert.deepEqual(targets, []);
});

test("splitMentionSegments skærer teksten op uden at tabe et tegn", () => {
  const text = "hej @Nicolai, og @Team Sky Racing!";
  const segments = splitMentionSegments(text, MANAGERS);
  assert.equal(segments.map((s) => s.text).join(""), text);
  assert.deepEqual(
    segments.map((s) => s.type),
    ["text", "mention", "text", "mention", "text"],
  );
  assert.equal(segments[1].manager.teamId, "t-nic");
  assert.equal(segments[3].text, "@Team Sky Racing");
});

test("splitMentionSegments på tekst uden tags giver ét tekst-stykke", () => {
  assert.deepEqual(splitMentionSegments("bare tekst", MANAGERS), [{ type: "text", text: "bare tekst" }]);
  assert.deepEqual(splitMentionSegments("", MANAGERS), []);
});

// ── loadMentionableManagers ────────────────────────────────────────────────

function fakeSupabase({ teams, users }) {
  return {
    from(table) {
      const rows = table === "teams" ? teams : users;
      const builder = {
        select: () => builder,
        in: () => builder,
        limit: () => Promise.resolve({ data: rows, error: null }),
      };
      return builder;
    },
  };
}

test("loadMentionableManagers: AI-hold, bank og navnløse konti er ikke taggbare", async () => {
  const managers = await loadMentionableManagers({
    supabase: fakeSupabase({
      teams: [
        { id: "t1", user_id: "u1", is_ai: false, is_bank: false },
        { id: "t2", user_id: "u2", is_ai: true, is_bank: false },
        { id: "t3", user_id: "u3", is_ai: false, is_bank: true },
        { id: "t4", user_id: null, is_ai: false, is_bank: false },
        { id: "t5", user_id: "u5", is_ai: false, is_bank: false },
      ],
      users: [
        { id: "u1", username: "Zeta" },
        { id: "u2", username: "AI Bot" },
        { id: "u3", username: "Bank" },
        { id: "u5", username: null },
      ],
    }),
  });
  assert.deepEqual(managers, [{ userId: "u1", teamId: "t1", name: "Zeta" }]);
});

test("loadMentionableManagers: sorteret alfabetisk (stabil autocomplete-liste)", async () => {
  const managers = await loadMentionableManagers({
    supabase: fakeSupabase({
      teams: [
        { id: "t1", user_id: "u1", is_ai: false, is_bank: false },
        { id: "t2", user_id: "u2", is_ai: false, is_bank: false },
      ],
      users: [
        { id: "u1", username: "Zeta" },
        { id: "u2", username: "alpha" },
      ],
    }),
  });
  assert.deepEqual(managers.map((m) => m.name), ["alpha", "Zeta"]);
});
