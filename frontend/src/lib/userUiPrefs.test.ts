// #7778 · Visningsvalg: serveren er sandheden, localStorage kun en hurtig kopi.
import test from "node:test";
import assert from "node:assert/strict";
import { mergeServerPrefs, parseUiPrefs, readLocalUiPrefs, UI_PREFS_LOCAL_KEY, writeLocalUiPrefs } from "./userUiPrefs.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => (k in data ? data[k] : null), setItem: (k: string, v: string) => { data[k] = v; } };
}

test("parseUiPrefs beholder kun kendte noegler med rigtig type", () => {
  assert.deepEqual(parseUiPrefs({ race_route_hidden: true, other: 1 }), { race_route_hidden: true });
  assert.deepEqual(parseUiPrefs({ race_route_hidden: "true" }), {});
  assert.deepEqual(parseUiPrefs(null), {});
  assert.deepEqual(parseUiPrefs([true]), {});
});

test("den lokale kopi taaler tom, ugyldig og manglende storage", () => {
  assert.deepEqual(readLocalUiPrefs(memoryStorage()), {});
  assert.deepEqual(readLocalUiPrefs(memoryStorage({ [UI_PREFS_LOCAL_KEY]: "{not json" })), {});
  assert.deepEqual(readLocalUiPrefs(null), {});
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.deepEqual(readLocalUiPrefs(throwing), {});
  assert.doesNotThrow(() => writeLocalUiPrefs({ race_route_hidden: true }, throwing));
});

test("skriv og laes den lokale kopi", () => {
  const storage = memoryStorage();
  writeLocalUiPrefs({ race_route_hidden: true }, storage);
  assert.deepEqual(readLocalUiPrefs(storage), { race_route_hidden: true });
});

test("serveren vinder over den lokale kopi for de noegler den kender", () => {
  assert.deepEqual(mergeServerPrefs({ race_route_hidden: true }, { race_route_hidden: false }), { race_route_hidden: false });
  assert.deepEqual(mergeServerPrefs({ race_route_hidden: true }, {}), { race_route_hidden: true });
});
