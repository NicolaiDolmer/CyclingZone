// #7778 · Visningsvalg: serveren er sandheden, localStorage kun en hurtig kopi.
import test from "node:test";
import assert from "node:assert/strict";
import {
  createUiPrefsStore, mergeServerPrefs, parseUiPrefs, readLocalUiPrefs, UI_PREFS_LOCAL_KEY, writeLocalUiPrefs,
  type UiPrefKey, type UiPrefsBackend,
} from "./userUiPrefs.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => (k in data ? data[k] : null), setItem: (k: string, v: string) => { data[k] = v; } };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** En forfalsket server: hvert kald venter, til testen slipper det. */
function fakeBackend(storage = memoryStorage()) {
  let userId: string | null = "user-a";
  const gets: Array<ReturnType<typeof deferred<{ ok: boolean; available: boolean; prefs: unknown }>>> = [];
  const puts: Array<{ key: UiPrefKey; value: boolean; done: ReturnType<typeof deferred<"saved">> }> = [];
  const serverWrites: boolean[] = [];
  const backend: UiPrefsBackend = {
    storage,
    getUserId: async () => userId,
    fetchPrefs: () => { const d = deferred<{ ok: boolean; available: boolean; prefs: unknown }>(); gets.push(d); return d.promise; },
    putPref: (key, value) => {
      const done = deferred<"saved">();
      puts.push({ key, value, done });
      return done.promise.then((r) => { serverWrites.push(value); return r; });
    },
  };
  return { backend, storage, gets, puts, serverWrites, setUser: (id: string | null) => { userId = id; } };
}

test("parseUiPrefs beholder kun kendte noegler med rigtig type", () => {
  assert.deepEqual(parseUiPrefs({ race_route_hidden: true, other: 1 }), { race_route_hidden: true });
  assert.deepEqual(parseUiPrefs({ race_route_hidden: "true" }), {});
  assert.deepEqual(parseUiPrefs(null), {});
  assert.deepEqual(parseUiPrefs([true]), {});
});

test("den lokale kopi taaler tom, ugyldig og manglende storage", () => {
  assert.deepEqual(readLocalUiPrefs(memoryStorage()), { userId: null, prefs: {} });
  assert.deepEqual(readLocalUiPrefs(memoryStorage({ [UI_PREFS_LOCAL_KEY]: "{not json" })), { userId: null, prefs: {} });
  assert.deepEqual(readLocalUiPrefs(null), { userId: null, prefs: {} });
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.deepEqual(readLocalUiPrefs(throwing), { userId: null, prefs: {} });
  assert.doesNotThrow(() => writeLocalUiPrefs({ userId: "u", prefs: { race_route_hidden: true } }, throwing));
});

test("skriv og laes den lokale kopi med ejer; en kopi uden ejer laeses stadig", () => {
  const storage = memoryStorage();
  writeLocalUiPrefs({ userId: "user-a", prefs: { race_route_hidden: true } }, storage);
  assert.deepEqual(readLocalUiPrefs(storage), { userId: "user-a", prefs: { race_route_hidden: true } });
  const legacy = memoryStorage({ [UI_PREFS_LOCAL_KEY]: JSON.stringify({ race_route_hidden: true }) });
  assert.deepEqual(readLocalUiPrefs(legacy), { userId: null, prefs: { race_route_hidden: true } });
});

test("serveren vinder over den lokale kopi for de noegler den kender", () => {
  assert.deepEqual(mergeServerPrefs({ race_route_hidden: true }, { race_route_hidden: false }), { race_route_hidden: false });
  assert.deepEqual(mergeServerPrefs({ race_route_hidden: true }, {}), { race_route_hidden: true });
});

test("serverens svar overskriver den lokale kopi, naar spilleren ikke har valgt imens", async () => {
  const f = fakeBackend(memoryStorage({ [UI_PREFS_LOCAL_KEY]: JSON.stringify({ userId: "user-a", prefs: { race_route_hidden: false } }) }));
  const store = createUiPrefsStore(f.backend);
  const load = store.ensureLoaded();
  await tick();
  f.gets[0].resolve({ ok: true, available: true, prefs: { race_route_hidden: true } });
  await load;
  assert.equal(store.getState().prefs.race_route_hidden, true);
  assert.deepEqual(readLocalUiPrefs(f.storage).prefs, { race_route_hidden: true });
});

test("et valg truffet mens hentningen er paa vej, vinder over det aeldre svar", async () => {
  const f = fakeBackend();
  const store = createUiPrefsStore(f.backend);
  const load = store.ensureLoaded();
  await tick();
  const saved = store.set("race_route_hidden", true);
  await tick();
  f.puts[0].done.resolve("saved");
  assert.equal(await saved, "saved");
  f.gets[0].resolve({ ok: true, available: true, prefs: { race_route_hidden: false } });
  await load;
  assert.equal(store.getState().prefs.race_route_hidden, true);
  assert.equal(store.getState().saveState.race_route_hidden, "saved");
});

test("hurtige skift: skrivningerne koeres i raekkefoelge, og serveren ender med det sidste valg", async () => {
  const f = fakeBackend();
  const store = createUiPrefsStore(f.backend);
  const first = store.set("race_route_hidden", true);
  await tick();
  const second = store.set("race_route_hidden", false);
  await tick();
  assert.equal(f.puts.length, 1, "den anden skrivning venter paa den foerste");
  f.puts[0].done.resolve("saved");
  await first;
  await tick();
  assert.equal(f.puts.length, 2);
  f.puts[1].done.resolve("saved");
  assert.equal(await second, "saved");
  assert.deepEqual(f.serverWrites, [true, false]);
  assert.equal(store.getState().prefs.race_route_hidden, false);
});

test("et afloest valg i koeen sendes ikke", async () => {
  const f = fakeBackend();
  const store = createUiPrefsStore(f.backend);
  void store.set("race_route_hidden", true);
  await tick();
  void store.set("race_route_hidden", false);
  const third = store.set("race_route_hidden", true);
  await tick();
  f.puts[0].done.resolve("saved");
  await tick(); await tick();
  assert.equal(f.puts.length, 2, "false er afloest af true og springes over");
  assert.equal(f.puts[1].value, true);
  f.puts[1].done.resolve("saved");
  assert.equal(await third, "saved");
  assert.deepEqual(f.serverWrites, [true, true]);
});

test("en ny bruger uden genindlaesning: den forriges valg ryddes og hentes paa ny", async () => {
  const f = fakeBackend();
  const store = createUiPrefsStore(f.backend);
  const loadA = store.ensureLoaded();
  await tick();
  f.gets[0].resolve({ ok: true, available: true, prefs: { race_route_hidden: true } });
  await loadA;
  assert.equal(store.getState().prefs.race_route_hidden, true);

  f.setUser("user-b");
  const loadB = store.ensureLoaded();
  await tick();
  assert.equal(store.getState().userId, "user-b");
  assert.equal(store.getState().prefs.race_route_hidden, undefined, "A's valg vises ikke for B");
  assert.equal(f.gets.length, 2, "B's valg hentes");
  f.gets[1].resolve({ ok: true, available: true, prefs: {} });
  await loadB;
  assert.equal(store.getState().prefs.race_route_hidden, undefined);
  assert.deepEqual(readLocalUiPrefs(f.storage), { userId: "user-b", prefs: {} });
});

test("en lokal kopi fra en anden bruger bruges ikke", async () => {
  const f = fakeBackend(memoryStorage({ [UI_PREFS_LOCAL_KEY]: JSON.stringify({ userId: "user-x", prefs: { race_route_hidden: true } }) }));
  const store = createUiPrefsStore(f.backend);
  const load = store.ensureLoaded();
  await tick();
  assert.equal(store.getState().prefs.race_route_hidden, undefined);
  f.gets[0].resolve({ ok: true, available: true, prefs: {} });
  await load;
  assert.equal(store.getState().prefs.race_route_hidden, undefined);
});

test("svaret til en bruger, der er logget ud imens, smides vaek", async () => {
  const f = fakeBackend();
  const store = createUiPrefsStore(f.backend);
  const loadA = store.ensureLoaded();
  await tick();
  // B logger ind og viser en side, mens A's hentning stadig er paa vej.
  f.setUser("user-b");
  const loadB = store.ensureLoaded();
  f.gets[0].resolve({ ok: true, available: true, prefs: { race_route_hidden: true } });
  await loadA;
  assert.equal(store.getState().prefs.race_route_hidden, undefined, "A's svar naar aldrig lageret");
  await tick(); await tick();
  assert.equal(store.getState().userId, "user-b");
  assert.equal(f.gets.length, 2, "B's valg hentes bagefter");
  f.gets[1].resolve({ ok: true, available: true, prefs: {} });
  await loadB;
  assert.equal(store.getState().prefs.race_route_hidden, undefined);
});

test("uden tabel (available: false) beholdes den lokale kopi, og hentningen proeves ikke igen", async () => {
  const f = fakeBackend(memoryStorage({ [UI_PREFS_LOCAL_KEY]: JSON.stringify({ userId: "user-a", prefs: { race_route_hidden: true } }) }));
  const store = createUiPrefsStore(f.backend);
  const load = store.ensureLoaded();
  await tick();
  f.gets[0].resolve({ ok: true, available: false, prefs: {} });
  await load;
  assert.equal(store.getState().prefs.race_route_hidden, true);
  await store.ensureLoaded();
  assert.equal(f.gets.length, 1);
});
