import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadSavedFilters, addSavedFilter, removeSavedFilter, savedFilterNameError, MAX_SAVED_FILTERS,
} from "./savedRiderFilters.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const barSource = readFileSync(join(__dirname, "..", "components", "rider", "SavedFiltersBar.jsx"), "utf8");
const ridersPageSource = readFileSync(join(__dirname, "..", "pages", "RidersPage.jsx"), "utf8");

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

// #6286 P0: RidersPage kender først brugeren efter første render. Gemte filtre
// skal vises efter en genindlæsning, selvom userId kommer sent.
test("#6286 gemte filtre vises efter genmontering hvor userId kommer sent", () => {
  withMockLocalStorage(() => {
    addSavedFilter("u1", "Climbers", { rider_type: "climber" });
    // Genmontering: første render har endnu ingen bruger ...
    assert.deepEqual(loadSavedFilters(null), []);
    // ... og når userId ankommer, læses listen igen og filtrene er der.
    assert.deepEqual(loadSavedFilters("u1").map((f) => f.name), ["Climbers"]);
  });
  // Komponenten skal faktisk genlæse ved userId-ændring (ikke kun ved mount).
  assert.match(
    barSource,
    /useEffect\(\(\) => \{\s*setSaved\(loadSavedFilters\(userId\)\);\s*\}, \[userId\]\);/,
    "SavedFiltersBar skal genindlæse listen når userId ændres",
  );
});

test("#6286 dublet-navn afvises (uden hensyn til store/små bogstaver og mellemrum)", () => {
  withMockLocalStorage(() => {
    addSavedFilter("u1", "Climbers", { q: "a" });
    const list = addSavedFilter("u1", "  climbers ", { q: "b" });
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].filters, { q: "a" });
    assert.equal(savedFilterNameError(list, "CLIMBERS"), "duplicate");
    assert.equal(savedFilterNameError(list, "Sprinters"), null);
    assert.equal(savedFilterNameError(list, "   "), "empty");
  });
});

test("#6286 loftet nået giver 'limit', og UI'et forklarer det i stedet for at skjule Save", () => {
  const full = Array.from({ length: MAX_SAVED_FILTERS }, (_, i) => ({ id: `f${i}`, name: `F${i}` }));
  assert.equal(savedFilterNameError(full, "New"), "limit");
  assert.match(barSource, /t\("savedFilters\.limit", \{ max: MAX_SAVED_FILTERS \}\)/);
  assert.doesNotMatch(barSource, /saved\.length < MAX_SAVED_FILTERS &&/);
});

test("#6286 slet er en selvstændig, tastatur-tilgængelig knap (ikke span i button)", () => {
  assert.doesNotMatch(barSource, /role="button"/);
  assert.doesNotMatch(barSource, /tabIndex=\{-1\}/);
  assert.match(barSource, /aria-label=\{t\("savedFilters\.removeNamed", \{ name: f\.name \}\)\}/);
});

test("#6286 ingen 'See Pro'-reklame mens hold/abonnement indlæses", () => {
  assert.match(barSource, /if \(!teamId \|\| subLoading\) return null;/);
  assert.match(ridersPageSource, /teamId=\{myTeam\?\.id\}/);
});
