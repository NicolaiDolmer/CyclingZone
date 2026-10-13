import test from "node:test";
import assert from "node:assert/strict";
import { resolveBulkScope, groupBulkIds } from "./bulkDayScope.ts";

test("#6523: intet markeret => alle i visningen", () => {
  const s = resolveBulkScope(new Set(), null, ["a", "b", "c"]);
  assert.equal(s.kind, "all");
  assert.deepEqual(s.ids, ["a", "b", "c"]);
});

test("#6523: markering vinder over 'alle'", () => {
  const s = resolveBulkScope(new Set(["b"]), null, ["a", "b", "c"]);
  assert.equal(s.kind, "selected");
  assert.deepEqual(s.ids, ["b"]);
});

test("#6523: markering uden for filtret tæller ikke; så er det 'alle i filtret'", () => {
  const s = resolveBulkScope(new Set(["x"]), new Set(["a", "b"]), ["a", "b"]);
  assert.equal(s.kind, "all");
  assert.deepEqual(s.ids, ["a", "b"]);
});

test("#6523: gruppens ryttere begrænses til dem der er i visningen", () => {
  assert.deepEqual(groupBulkIds(["a", "z", "b"], ["a", "b", "c"]), ["a", "b"]);
});
