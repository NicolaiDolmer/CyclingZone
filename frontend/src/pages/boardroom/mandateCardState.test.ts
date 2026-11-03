// #7540 · Afgoerelseslogik for mandatkortene. Syntetiske data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMandateCardState } from "./mandateCardState.ts";

test("underskrevet mandat vinder altid, ogsaa mens aarsmoedet indlaeses", () => {
  assert.equal(resolveMandateCardState({ mandate: { id: 1 }, meetingLoaded: false }), "signed");
  assert.equal(
    resolveMandateCardState({ mandate: { id: 1 }, proposedMeeting: { available: true }, meetingLoaded: true }),
    "signed",
  );
});

test("intet mandat og meeting-kaldet er ikke faerdigt giver loading, aldrig empty", () => {
  assert.equal(resolveMandateCardState({ mandate: null, proposedMeeting: null, meetingLoaded: false }), "loading");
});

test("intet mandat og aabent aarsmoede giver proposed", () => {
  assert.equal(
    resolveMandateCardState({ mandate: null, proposedMeeting: { available: true }, meetingLoaded: true }),
    "proposed",
  );
});

test("empty kun naar kaldet er faerdigt og der ikke er noget forslag", () => {
  assert.equal(resolveMandateCardState({ mandate: null, proposedMeeting: null, meetingLoaded: true }), "empty");
  assert.equal(
    resolveMandateCardState({ mandate: null, proposedMeeting: { available: false }, meetingLoaded: true }),
    "empty",
  );
});

test("meetingLoaded defaulter til true saa kaldere uden flaget opfoerer sig som foer", () => {
  assert.equal(resolveMandateCardState({ mandate: null, proposedMeeting: null }), "empty");
});

test("#7540 kilde: kortene bruger afgoerelsen og viser Skeleton, ikke tom-tilstand, under indlaesning", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  for (const f of ["./MandateCard.jsx", "./MandateSummaryCard.jsx"]) {
    const src = read(f);
    assert.match(src, /resolveMandateCardState\(/);
    assert.match(src, /cardState === "loading"[\s\S]*SkeletonLines/);
  }
  assert.match(read("./BoardroomPage.jsx"), /meetingLoaded=\{meetingLoaded\}/);
});
