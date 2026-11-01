import { test } from "node:test";
import assert from "node:assert/strict";
import { pickNewestArtifacts, parseArtifactInput } from "./pickNewestArtifacts.mjs";

const P = "e2e-shard-metrics-";

test("vælger den nyeste udgave når en lane er genkørt", () => {
  const picked = pickNewestArtifacts(
    [
      { id: 1, name: `${P}a`, created_at: "2026-11-01T10:00:00Z" },
      { id: 2, name: `${P}a`, created_at: "2026-11-01T10:30:00Z" },
      { id: 3, name: `${P}b`, created_at: "2026-11-01T10:05:00Z" },
    ],
    { prefix: P },
  );
  assert.deepEqual(picked.map((a) => a.id), [2, 3]);
});

test("rækkefølgen i inputtet er ligegyldig", () => {
  const picked = pickNewestArtifacts(
    [
      { id: 2, name: `${P}a`, created_at: "2026-11-01T10:30:00Z" },
      { id: 1, name: `${P}a`, created_at: "2026-11-01T10:00:00Z" },
    ],
    { prefix: P },
  );
  assert.deepEqual(picked.map((a) => a.id), [2]);
});

test("samme tidsstempel: højeste id vinder", () => {
  const picked = pickNewestArtifacts(
    [
      { id: 9, name: `${P}a`, created_at: "2026-11-01T10:00:00Z" },
      { id: 10, name: `${P}a`, created_at: "2026-11-01T10:00:00Z" },
    ],
    { prefix: P },
  );
  assert.deepEqual(picked.map((a) => a.id), [10]);
});

test("filtrerer på præfiks og springer udløbne over", () => {
  const picked = pickNewestArtifacts(
    [
      { id: 1, name: "e2e-flakes", created_at: "2026-11-01T10:00:00Z" },
      { id: 2, name: `${P}a`, created_at: "2026-11-01T11:00:00Z", expired: true },
      { id: 3, name: `${P}a`, created_at: "2026-11-01T10:00:00Z", expired: false },
    ],
    { prefix: P },
  );
  assert.deepEqual(picked.map((a) => a.id), [3]);
});

test("ugyldigt input giver tom liste, ingen crash", () => {
  assert.deepEqual(pickNewestArtifacts(undefined, { prefix: P }), []);
  assert.deepEqual(pickNewestArtifacts([null, {}, { name: 5 }], { prefix: P }), []);
});

test("manglende created_at taber til et artefakt med dato", () => {
  const picked = pickNewestArtifacts(
    [
      { id: 5, name: `${P}a` },
      { id: 4, name: `${P}a`, created_at: "2026-11-01T10:00:00Z" },
    ],
    { prefix: P },
  );
  assert.deepEqual(picked.map((a) => a.id), [4]);
});

test("parseArtifactInput forstår API-svar, array og ndjson", () => {
  const a = { id: 1, name: "x" };
  const b = { id: 2, name: "y" };
  assert.deepEqual(parseArtifactInput(JSON.stringify({ artifacts: [a, b] })), [a, b]);
  assert.deepEqual(parseArtifactInput(JSON.stringify([a, b])), [a, b]);
  assert.deepEqual(parseArtifactInput(`${JSON.stringify(a)}\n${JSON.stringify(b)}\n`), [a, b]);
  assert.deepEqual(parseArtifactInput(""), []);
});
