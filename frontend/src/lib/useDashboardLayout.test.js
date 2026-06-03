import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DASHBOARD_MODULES, defaultLayout, loadLayout } from "./useDashboardLayout.js";

const STORAGE_KEY = "cz-dashboard-layout";

function stubWindow(store) {
  globalThis.window = {
    localStorage: {
      getItem: key => (key === STORAGE_KEY && store.value !== undefined ? store.value : null),
    },
  };
}

afterEach(() => {
  delete globalThis.window;
});

test("defaultLayout — alle moduler synlige", () => {
  const layout = defaultLayout();
  assert.equal(Object.keys(layout).length, DASHBOARD_MODULES.length);
  for (const m of DASHBOARD_MODULES) {
    assert.equal(layout[m.id], true);
  }
});

test("loadLayout — uden window returnerer defaults", () => {
  assert.equal(typeof globalThis.window, "undefined");
  assert.deepEqual(loadLayout(), defaultLayout());
});

test("loadLayout — tom localStorage returnerer defaults", () => {
  const store = { value: undefined };
  stubWindow(store);
  assert.deepEqual(loadLayout(), defaultLayout());
});

test("loadLayout — merger gemte booleans over defaults", () => {
  const store = { value: JSON.stringify({ board: false, recentResults: false }) };
  stubWindow(store);
  const layout = loadLayout();
  assert.equal(layout.board, false);
  assert.equal(layout.recentResults, false);
  // resten skal stadig være synlige (merge-mod-defaults)
  assert.equal(layout.auctions, true);
  assert.equal(layout.riderRanking, true);
});

test("loadLayout — ukendte nøgler ignoreres, manglende falder tilbage til default-visible", () => {
  const store = { value: JSON.stringify({ ghostModule: false }) };
  stubWindow(store);
  const layout = loadLayout();
  assert.equal(layout.ghostModule, undefined);
  for (const m of DASHBOARD_MODULES) {
    assert.equal(layout[m.id], true);
  }
});

test("loadLayout — ugyldig JSON crasher ikke", () => {
  const store = { value: "{ not json" };
  stubWindow(store);
  assert.deepEqual(loadLayout(), defaultLayout());
});

test("loadLayout — privacy-mode (localStorage kaster) crasher ikke", () => {
  globalThis.window = {
    localStorage: {
      getItem() { throw new Error("SecurityError: localStorage disabled"); },
    },
  };
  assert.deepEqual(loadLayout(), defaultLayout());
});
