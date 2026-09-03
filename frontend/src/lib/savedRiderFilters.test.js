import test from "node:test";
import assert from "node:assert/strict";
import { loadSavedFilters, addSavedFilter, removeSavedFilter, MAX_SAVED_FILTERS } from "./savedRiderFilters.js";

function withMockLocalStorage(fn) {
  const store = new Map();
  const original = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  try {
    fn();
  } finally {
    globalThis.localStorage = original;
  }
}

test("loadSavedFilters: tom liste uden bruger eller uden gemte filtre", () => {
  assert.deepEqual(loadSavedFilters(null), []);
  withMockLocalStorage(() => {
    assert.deepEqual(loadSavedFilters("u1"), []);
  });
});

test("addSavedFilter/loadSavedFilters: round-trip, nyeste først, isoleret pr. bruger", () => {
  withMockLocalStorage(() => {
    addSavedFilter("u1", "Climbers under budget", { rider_type: "climber", max_value: "500000" });
    const list = addSavedFilter("u1", "U23 sprinters", { u23: true, rider_type: "sprinter" });
    assert.equal(list.length, 2);
    assert.equal(list[0].name, "U23 sprinters"); // nyeste først
    assert.equal(list[1].name, "Climbers under budget");
    assert.deepEqual(loadSavedFilters("u2"), []); // ikke lækket til anden bruger
  });
});

test("addSavedFilter: tomt/whitespace-navn eller manglende bruger gemmer intet", () => {
  withMockLocalStorage(() => {
    assert.deepEqual(addSavedFilter("u1", "   ", { q: "x" }), []);
    assert.deepEqual(addSavedFilter(null, "Name", { q: "x" }), []);
  });
});

test("addSavedFilter: capper ved MAX_SAVED_FILTERS, ældste falder ud", () => {
  withMockLocalStorage(() => {
    let list = [];
    for (let i = 0; i < MAX_SAVED_FILTERS + 3; i++) {
      list = addSavedFilter("u1", `Filter ${i}`, { q: String(i) });
    }
    assert.equal(list.length, MAX_SAVED_FILTERS);
    assert.equal(list[0].name, `Filter ${MAX_SAVED_FILTERS + 2}`); // seneste
  });
});

test("removeSavedFilter: fjerner kun den valgte", () => {
  withMockLocalStorage(() => {
    addSavedFilter("u1", "A", { q: "a" });
    const [b] = [addSavedFilter("u1", "B", { q: "b" })[0]];
    const after = removeSavedFilter("u1", b.id);
    assert.equal(after.length, 1);
    assert.equal(after[0].name, "A");
  });
});
