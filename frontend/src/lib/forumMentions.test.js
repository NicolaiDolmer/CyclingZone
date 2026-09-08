// #5011 — klientsidens @-tag-hjælpere: hvad caret'en står i, hvilke navne der
// foreslås, og hvordan det valgte navn sættes ind.
//
// Selve match-reglerne (hele navne, case-insensitivt, aldrig e-mails, aldrig
// hen over linjeskift) er dækket af backend/lib/forumMentions.test.js og
// håndhæves som identiske af forumMentions.parity.test.js — de gentages ikke
// her. Denne fil dækker KUN det klienten selv gør.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MENTION_MIN_QUERY,
  applyMentionSelection,
  filterMentionCandidates,
  findMentionQuery,
  splitMentionSegments,
} from "./forumMentions.js";

const MANAGERS = [
  { name: "Nicolai", team_id: "team-1" },
  { name: "nico_b", team_id: "team-2" },
  { name: "Sofie R", team_id: "team-3" },
  { name: "peloton_pete", team_id: "team-4" },
];

// ── findMentionQuery ────────────────────────────────────────────────────────

test("listen åbner først ved 2 tegn efter '@'", () => {
  assert.equal(MENTION_MIN_QUERY, 2);
  assert.equal(findMentionQuery("hej @n", 6), null);
  assert.deepEqual(findMentionQuery("hej @ni", 7), { start: 4, query: "ni" });
});

test("caret'en midt i et ord læser kun tegnene FØR den", () => {
  // "hej @nicolai" med caret efter "nic" — resten af ordet hører til det man
  // endnu ikke har skrevet færdigt.
  assert.deepEqual(findMentionQuery("hej @nicolai", 8), { start: 4, query: "nic" });
});

test("et '@' i en e-mail åbner aldrig listen", () => {
  assert.equal(findMentionQuery("skriv til nicolai@dolmer.dk", 24), null);
});

test("listen lukker på linjeskift — et navn går aldrig over to linjer", () => {
  assert.equal(findMentionQuery("@nicolai\nnæste linje", 20), null);
});

test("navne med mellemrum kan skrives færdige, men et dobbelt mellemrum lukker", () => {
  assert.deepEqual(findMentionQuery("hej @Sofie R", 12), { start: 4, query: "Sofie R" });
  assert.equal(findMentionQuery("hej @Sofie  R", 13), null);
});

test("uden et '@' inden for scan-vinduet er der intet forslag", () => {
  assert.equal(findMentionQuery("helt almindelig tekst", 21), null);
});

// ── filterMentionCandidates ─────────────────────────────────────────────────

test("præfiks-match kommer før navne hvor teksten står inde i navnet", () => {
  // "pete" står INDE i peloton_pete, "nico" står forrest i begge de to andre —
  // præfiks-gruppen skal ligge først, uanset alfabetisk rækkefølge.
  const hits = filterMentionCandidates([...MANAGERS, { name: "pete_x", team_id: "team-5" }], "pete");
  assert.deepEqual(hits.map((m) => m.name), ["pete_x", "peloton_pete"]);
});

test("matchningen er case-insensitiv og rækkefølgen er deterministisk", () => {
  assert.deepEqual(filterMentionCandidates(MANAGERS, "NICO").map((m) => m.name), ["nico_b", "Nicolai"]);
});

test("tom eller ukendt tekst giver ingen forslag", () => {
  assert.deepEqual(filterMentionCandidates(MANAGERS, ""), []);
  assert.deepEqual(filterMentionCandidates(MANAGERS, "zzz"), []);
});

test("listen er afkortet til grænsen", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ name: `rider${i}`, team_id: `t${i}` }));
  assert.equal(filterMentionCandidates(many, "rider").length, 6);
  assert.equal(filterMentionCandidates(many, "rider", 2).length, 2);
});

// ── applyMentionSelection ───────────────────────────────────────────────────

test("det valgte navn erstatter det halvskrevne tag og får ét mellemrum efter", () => {
  const text = "hej @nic og godmorgen";
  const selection = findMentionQuery(text, 8);
  const next = applyMentionSelection(text, selection, "Nicolai");
  assert.equal(next.text, "hej @Nicolai og godmorgen");
  assert.equal(next.caret, "hej @Nicolai ".length);
});

// CodeRabbit-fund 8/9: caret'en må stå MIDT i ordet (man klikker tilbage i et
// halvskrevet navn). Uden at æde resten af ordet blev "@nic|olai" til
// "@Nicolaiolai" — et tag der matcher ingen manager, altså hverken notifikation
// eller link.
test("et navn valgt midt i ordet æder resten af ordet", () => {
  const text = "godt kørt @nicolai i går";
  const selection = findMentionQuery(text, 14); // caret efter "@nic"
  assert.deepEqual(selection, { start: 10, query: "nic" });
  assert.equal(applyMentionSelection(text, selection, "Nicolai").text, "godt kørt @Nicolai i går");
});

test("indsættelse midt i teksten rører ikke resten af feltet", () => {
  const text = "@so\nnæste linje står urørt";
  const selection = findMentionQuery(text, 3);
  const next = applyMentionSelection(text, selection, "Sofie R");
  assert.equal(next.text, "@Sofie R \nnæste linje står urørt");
});

test("uden et aktivt tag ændres teksten ikke", () => {
  assert.deepEqual(applyMentionSelection("ingen tags her", null, "Nicolai"), {
    text: "ingen tags her",
    caret: "ingen tags her".length,
  });
});

// ── splitMentionSegments (renderingens grundlag) ────────────────────────────

test("teksten skæres op i rene stykker og tags, med manageren på hvert tag", () => {
  const segments = splitMentionSegments("godt kørt @Nicolai!", MANAGERS);
  assert.deepEqual(segments.map((s) => s.type), ["text", "mention", "text"]);
  assert.equal(segments[1].text, "@Nicolai");
  assert.equal(segments[1].manager.team_id, "team-1");
  assert.equal(segments[2].text, "!");
});

test("tekst uden kendte navne bliver ét rent stykke", () => {
  assert.deepEqual(splitMentionSegments("ingen navne her", MANAGERS), [
    { type: "text", text: "ingen navne her" },
  ]);
});

test("uden en managerliste rendres teksten uændret (listen er ikke hentet endnu)", () => {
  assert.deepEqual(splitMentionSegments("hej @Nicolai", []), [
    { type: "text", text: "hej @Nicolai" },
  ]);
});
