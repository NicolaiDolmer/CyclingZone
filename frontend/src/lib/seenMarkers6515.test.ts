// #6515 · Prikkerne for patch notes og roadmap følger brugeren på tværs af enheder.
// Fast ur (mock.timers), forfalsket server og localStorage: to enheder samme
// bruger, serverfejl, første flytning, udlogget bruger og brugerskift.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

import {
  laterSeenMarker,
  planSeenMarkerSync,
  syncSeenMarkers,
  markSeen,
  advanceLocalSeenMarker,
  SEEN_MARKER_LOCAL_KEYS,
  SEEN_MARKERS_OWNER_KEY,
  type SeenMarkers,
  type SeenMarkersBackend,
  type StorageLike,
} from "./seenMarkers6515.ts";
import { isPatchNotesUnread } from "./patchNotesUnread.js";
import { isRoadmapUnread } from "./roadmapUnread.ts";

const PN = SEEN_MARKER_LOCAL_KEYS.patch_notes;
const RM = SEEN_MARKER_LOCAL_KEYS.roadmap;
const LATEST_PATCH = "2026-11-14";
const LATEST_ROADMAP = "2026-11-13T09:00:00.000000+00:00";

function withFixedClock(fn: () => Promise<void> | void) {
  return async () => {
    mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-14T12:00:00Z") });
    try { await fn(); } finally { mock.timers.reset(); }
  };
}

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}

/** Én server (én brugers række) som flere enheder kan tale med. */
function fakeServer({ markers = {} as SeenMarkers, available = true } = {}) {
  const state = { markers: { ...markers }, available, down: false, puts: [] as SeenMarkers[] };
  return {
    state,
    async get() {
      if (state.down) return { ok: false, available: true, markers: undefined };
      return { ok: true, available: state.available, markers: { ...state.markers } };
    },
    async put(patch: SeenMarkers) {
      if (state.down || !state.available) return false;
      state.puts.push(patch);
      for (const [k, v] of Object.entries(patch) as [keyof SeenMarkers, string][]) {
        const next = laterSeenMarker(state.markers[k], v); // serveren: nyeste vinder
        if (next) state.markers[k] = next;
      }
      return true;
    },
  };
}

function device(server: ReturnType<typeof fakeServer>, storage: ReturnType<typeof memoryStorage>, user: { id: string | null }) {
  const announced: SeenMarkers[] = [];
  const backend: SeenMarkersBackend = {
    storage,
    getUserId: async () => user.id,
    fetchMarkers: () => server.get(),
    putMarkers: (m) => server.put(m),
    announce: (m) => { announced.push(m); },
  };
  return { backend, storage, announced };
}

const flush = () => new Promise((r) => setImmediate(r));

test("laterSeenMarker: nyeste vinder, ugyldig tæller som fraværende", () => {
  assert.equal(laterSeenMarker("2026-11-01", "2026-11-14"), "2026-11-14");
  assert.equal(laterSeenMarker("2026-11-14", "2026-11-01"), "2026-11-14");
  assert.equal(laterSeenMarker(null, "2026-11-14"), "2026-11-14");
  assert.equal(laterSeenMarker("2026-11-14", "junk"), "2026-11-14");
  assert.equal(laterSeenMarker(undefined, null), null);
});

test("planSeenMarkerSync: serveren foran rykker lokalt frem, enheden foran sendes op", () => {
  const plan = planSeenMarkerSync(
    { patch_notes: "2026-11-01", roadmap: "2026-11-13T09:00:00Z" },
    { patch_notes: "2026-11-14", roadmap: "2026-11-01T00:00:00Z" },
    true,
  );
  assert.deepEqual(plan.localWrites, { patch_notes: "2026-11-14" });
  assert.deepEqual(plan.push, { roadmap: "2026-11-13T09:00:00Z" });
});

test("planSeenMarkerSync: en anden brugers lokale kopi gælder ikke og sendes ikke op", () => {
  const plan = planSeenMarkerSync({ patch_notes: "2026-11-14", roadmap: "2026-11-13T09:00:00Z" }, { patch_notes: "2026-11-01" }, false);
  assert.deepEqual(plan.localWrites, { patch_notes: "2026-11-01", roadmap: null });
  assert.deepEqual(plan.push, {});
});

test("to enheder samme bruger: læst på telefonen = ingen prik på computeren", withFixedClock(async () => {
  const server = fakeServer();
  const user = { id: "user-a" };
  // Begge enheder har været afstemt før (ejer kendt), computeren er bagud.
  const phone = device(server, memoryStorage({ [SEEN_MARKERS_OWNER_KEY]: "user-a", [PN]: "2026-11-01" }), user);
  const laptop = device(server, memoryStorage({ [SEEN_MARKERS_OWNER_KEY]: "user-a", [PN]: "2026-11-01" }), user);

  // Telefonen åbner patch notes og roadmap.
  markSeen("patch_notes", LATEST_PATCH, phone.backend);
  markSeen("roadmap", LATEST_ROADMAP, phone.backend);
  await flush();
  assert.equal(server.state.markers.patch_notes, LATEST_PATCH);

  // Computeren: før afstemning viser den lokale kopi stadig prikken (som i dag).
  assert.equal(isPatchNotesUnread(LATEST_PATCH, laptop.storage.getItem(PN)), true);
  const changed = await syncSeenMarkers(laptop.backend);
  assert.equal(changed, true);
  assert.equal(isPatchNotesUnread(LATEST_PATCH, laptop.storage.getItem(PN)), false);
  assert.equal(isRoadmapUnread(LATEST_ROADMAP, laptop.storage.getItem(RM)), false);
  // Åbne sider får serverens værdier, så deres "nyt"-markeringer også følger med.
  assert.deepEqual(laptop.announced, [{ patch_notes: LATEST_PATCH, roadmap: LATEST_ROADMAP }]);
}));

test("to enheder: computerens gamle kopi kan ikke hive telefonens nyere markør tilbage", withFixedClock(async () => {
  const server = fakeServer({ markers: { patch_notes: LATEST_PATCH } });
  const laptop = device(server, memoryStorage({ [PN]: "2026-11-01" }), { id: "user-a" });
  markSeen("patch_notes", "2026-11-05", laptop.backend); // fx en gammel cachet meta-fil
  await flush();
  assert.equal(server.state.markers.patch_notes, LATEST_PATCH);
}));

test("serverfejl: den lokale kopi bruges som før, ingen ny prik for noget set lokalt", withFixedClock(async () => {
  const server = fakeServer({ markers: { patch_notes: "2026-10-01" } });
  server.state.down = true;
  const laptop = device(server, memoryStorage({ [PN]: LATEST_PATCH }), { id: "user-a" });
  assert.equal(await syncSeenMarkers(laptop.backend), false);
  assert.equal(laptop.storage.getItem(PN), LATEST_PATCH);
  assert.equal(isPatchNotesUnread(LATEST_PATCH, laptop.storage.getItem(PN)), false);
  assert.deepEqual(laptop.announced, []);
}));

test("serverfejl: fetch der kaster, giver heller ingen ændring og intet kast", withFixedClock(async () => {
  const storage = memoryStorage({ [RM]: LATEST_ROADMAP });
  const backend: SeenMarkersBackend = {
    storage,
    getUserId: async () => "user-a",
    fetchMarkers: async () => { throw new Error("netværk nede"); },
    putMarkers: async () => { throw new Error("netværk nede"); },
  };
  assert.equal(await syncSeenMarkers(backend), false);
  assert.equal(storage.getItem(RM), LATEST_ROADMAP);
  markSeen("roadmap", "2026-11-14T10:00:00Z", backend); // kast i PUT må ikke boble op
  await flush();
  assert.equal(storage.getItem(RM), "2026-11-14T10:00:00Z");
}));

test("server ikke migreret endnu (available=false): kun den lokale kopi", withFixedClock(async () => {
  const server = fakeServer({ available: false });
  const laptop = device(server, memoryStorage({ [PN]: LATEST_PATCH }), { id: "user-a" });
  assert.equal(await syncSeenMarkers(laptop.backend), false);
  assert.equal(laptop.storage.getItem(PN), LATEST_PATCH);
  assert.equal(laptop.storage.getItem(SEEN_MARKERS_OWNER_KEY), null);
}));

test("første flytning: den lokale tilstand flyttes op, ingen gamle prikker kommer tilbage", withFixedClock(async () => {
  const server = fakeServer(); // tom række: brugeren har aldrig haft markører på serveren
  // En kopi fra før udrulningen: ingen ejer-nøgle.
  const laptop = device(server, memoryStorage({ [PN]: LATEST_PATCH, [RM]: LATEST_ROADMAP }), { id: "user-a" });
  const changed = await syncSeenMarkers(laptop.backend);
  await flush();
  assert.equal(changed, false, "den lokale kopi var allerede nyest");
  assert.deepEqual(server.state.markers, { patch_notes: LATEST_PATCH, roadmap: LATEST_ROADMAP });
  assert.equal(isPatchNotesUnread(LATEST_PATCH, laptop.storage.getItem(PN)), false);
  assert.equal(isRoadmapUnread(LATEST_ROADMAP, laptop.storage.getItem(RM)), false);
  assert.equal(laptop.storage.getItem(SEEN_MARKERS_OWNER_KEY), "user-a");

  // En anden enhed (aldrig åbnet noget) arver nu markørerne i stedet for alle prikker.
  const phone = device(server, memoryStorage(), { id: "user-a" });
  await syncSeenMarkers(phone.backend);
  assert.equal(isPatchNotesUnread(LATEST_PATCH, phone.storage.getItem(PN)), false);
}));

test("udlogget bruger: ingen serverkald, prikken styres af den lokale kopi som i dag", withFixedClock(async () => {
  const server = fakeServer({ markers: { patch_notes: LATEST_PATCH } });
  let fetched = 0;
  const storage = memoryStorage();
  const backend: SeenMarkersBackend = {
    storage,
    getUserId: async () => null,
    fetchMarkers: async () => { fetched += 1; return server.get(); },
    putMarkers: (m) => server.put(m),
  };
  assert.equal(await syncSeenMarkers(backend), false);
  assert.equal(fetched, 0);
  assert.equal(isPatchNotesUnread(LATEST_PATCH, storage.getItem(PN)), true);
  markSeen("patch_notes", LATEST_PATCH, backend);
  await flush();
  assert.equal(storage.getItem(PN), LATEST_PATCH);
  assert.equal(server.state.puts.length, 0);
  assert.equal(isPatchNotesUnread(LATEST_PATCH, storage.getItem(PN)), false);
}));

test("brugerskift på samme enhed: den forriges markører gælder ikke og sendes ikke op", withFixedClock(async () => {
  const server = fakeServer({ markers: { patch_notes: "2026-10-01" } }); // user-b's række
  const storage = memoryStorage({ [SEEN_MARKERS_OWNER_KEY]: "user-a", [PN]: LATEST_PATCH, [RM]: LATEST_ROADMAP });
  const shared = device(server, storage, { id: "user-b" });
  assert.equal(await syncSeenMarkers(shared.backend), true);
  await flush();
  assert.equal(storage.getItem(PN), "2026-10-01");
  assert.equal(storage.getItem(RM), null);
  assert.equal(storage.getItem(SEEN_MARKERS_OWNER_KEY), "user-b");
  assert.deepEqual(server.state.puts, []);
}));

test("brugeren skifter mens svaret er på vej: svaret smides væk", withFixedClock(async () => {
  const server = fakeServer({ markers: { patch_notes: LATEST_PATCH } });
  const user = { id: "user-a" as string | null };
  const storage = memoryStorage();
  const backend: SeenMarkersBackend = {
    storage,
    getUserId: async () => user.id,
    fetchMarkers: async () => { const r = await server.get(); user.id = "user-b"; return r; },
    putMarkers: (m) => server.put(m),
  };
  assert.equal(await syncSeenMarkers(backend), false);
  assert.equal(storage.getItem(PN), null);
}));

test("en markør denne fane selv sendte op, slukker ikke sidens nyt-markeringer", withFixedClock(async () => {
  const server = fakeServer();
  const laptop = device(server, memoryStorage({ [SEEN_MARKERS_OWNER_KEY]: "user-a" }), { id: "user-a" });
  markSeen("patch_notes", LATEST_PATCH, laptop.backend); // dette besøg
  await flush();
  await syncSeenMarkers(laptop.backend);
  assert.deepEqual(laptop.announced, []);
}));

test("advanceLocalSeenMarker: rykker kun frem", () => {
  const storage = memoryStorage({ [PN]: LATEST_PATCH });
  assert.deepEqual(advanceLocalSeenMarker("patch_notes", "2026-11-01", storage), { value: LATEST_PATCH, advanced: false });
  assert.deepEqual(advanceLocalSeenMarker("patch_notes", "2026-11-20", storage), { value: "2026-11-20", advanced: true });
  assert.deepEqual(advanceLocalSeenMarker("patch_notes", null, storage), { value: "2026-11-20", advanced: false });
});

test("localStorage-nøglerne er de samme som prikken altid har brugt", () => {
  assert.equal(PN, "cz_patchnotes_last_seen");
  assert.equal(RM, "cz_roadmap_last_seen");
});
