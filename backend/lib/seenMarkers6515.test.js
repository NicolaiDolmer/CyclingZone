// #6515 · Sidst set patch notes/roadmap paa brugeren: validering og lager.
// Selve nyeste-vinder-fletningen sker atomisk i databasen og proeves mod en rigtig
// Postgres i seenMarkers6515.pglite.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import {
  SEEN_MARKER_KEYS, isValidSeenMarker, publicSeenMarkers, sanitizeSeenMarkersPatch,
  isMissingSeenMarkersStorage, readSeenMarkers, writeSeenMarkers,
} from "./seenMarkers6515.js";

function fakeSupabase({ row = null, readError = null, rpcResult = {}, rpcError = null } = {}) {
  const calls = { selects: [], rpcs: [], upserts: 0 };
  return {
    calls,
    from(table) {
      assert.equal(table, "user_ui_prefs");
      return {
        select(cols) { calls.selects.push(cols); return this; },
        eq() { return this; },
        limit: async () => ({ data: readError ? null : (row ? [row] : []), error: readError }),
        upsert: async () => { calls.upserts += 1; return { error: null }; },
      };
    },
    rpc: async (name, args) => {
      calls.rpcs.push({ name, args });
      return { data: rpcError ? null : rpcResult, error: rpcError };
    },
  };
}

test("markoererne er patch notes og roadmap og intet andet", () => {
  assert.deepEqual([...SEEN_MARKER_KEYS], ["patch_notes", "roadmap"]);
});

test("isValidSeenMarker: patch-dato og PostgREST-tidsstempel godkendes, alt andet afvises", () => {
  assert.equal(isValidSeenMarker("2026-11-14"), true);
  assert.equal(isValidSeenMarker("2026-09-24T10:11:12.123456+00:00"), true);
  assert.equal(isValidSeenMarker("2026-09-24T10:11:12Z"), true);
  assert.equal(isValidSeenMarker(""), false);
  assert.equal(isValidSeenMarker("i morgen"), false);
  assert.equal(isValidSeenMarker("2026-13-45"), false);
  assert.equal(isValidSeenMarker(20261114), false);
  assert.equal(isValidSeenMarker(null), false);
  assert.equal(isValidSeenMarker(`2026-11-14${"0".repeat(60)}`), false);
});

test("publicSeenMarkers: kun kendte noegler med gyldig vaerdi", () => {
  assert.deepEqual(publicSeenMarkers({ patch_notes: "2026-11-14", roadmap: "x", other: "2026-11-14" }), { patch_notes: "2026-11-14" });
  assert.deepEqual(publicSeenMarkers(null), {});
  assert.deepEqual(publicSeenMarkers(["2026-11-14"]), {});
});

test("sanitize: gyldige markoerer gaar igennem, resten afvises med errorCode", () => {
  assert.deepEqual(sanitizeSeenMarkersPatch({ markers: { patch_notes: "2026-11-14" } }), { ok: true, patch: { patch_notes: "2026-11-14" } });
  assert.equal(sanitizeSeenMarkersPatch({ markers: { forum: "2026-11-14" } }).reason, "seen_markers_unknown_keys");
  assert.equal(sanitizeSeenMarkersPatch({ markers: { roadmap: "soon" } }).reason, "seen_markers_invalid_value");
  assert.equal(sanitizeSeenMarkersPatch({ markers: {} }).reason, "seen_markers_invalid_payload");
  assert.equal(sanitizeSeenMarkersPatch({ markers: ["2026-11-14"] }).reason, "seen_markers_invalid_payload");
  assert.equal(sanitizeSeenMarkersPatch(null).reason, "seen_markers_invalid_payload");
});

test("read: ingen raekke = tomt objekt, laeser kun seen_markers-kolonnen", async () => {
  const sb = fakeSupabase();
  assert.deepEqual(await readSeenMarkers(sb, "u1"), { markers: {}, available: true });
  assert.deepEqual(sb.calls.selects, ["seen_markers"]);
});

test("read: manglende kolonne/tabel giver available=false, anden fejl kastes", async () => {
  assert.deepEqual(await readSeenMarkers(fakeSupabase({ readError: { code: "42703" } }), "u1"), { markers: {}, available: false });
  assert.deepEqual(await readSeenMarkers(fakeSupabase({ readError: { code: "PGRST205" } }), "u1"), { markers: {}, available: false });
  await assert.rejects(() => readSeenMarkers(fakeSupabase({ readError: { code: "XX000", message: "boom" } }), "u1"));
});

test("write: eet atomisk databasekald med kun de kendte markoerer, ingen laes-saa-skriv", async () => {
  const sb = fakeSupabase({ rpcResult: { patch_notes: "2026-11-14", roadmap: "2026-10-01T00:00:00+00:00", junk: 1 } });
  const out = await writeSeenMarkers(sb, "u1", { patch_notes: "2026-11-14" });
  assert.deepEqual(sb.calls.rpcs, [{ name: "merge_seen_markers_6515", args: { p_user_id: "u1", p_patch: { patch_notes: "2026-11-14" } } }]);
  assert.deepEqual(sb.calls.selects, [], "ingen forudgaaende laesning");
  assert.equal(sb.calls.upserts, 0, "ingen hel-objekt-upsert");
  // Svaret er raekkens tilstand efter fletningen, kun kendte markoerer.
  assert.deepEqual(out, { markers: { patch_notes: "2026-11-14", roadmap: "2026-10-01T00:00:00+00:00" }, available: true });
});

test("write: funktionen findes ikke endnu (PGRST202 / 42883 for netop den) = available false", async () => {
  for (const rpcError of [
    { code: "PGRST202", message: "Could not find the function public.merge_seen_markers_6515(p_patch, p_user_id) in the schema cache" },
    { code: "42883", message: "function public.merge_seen_markers_6515(uuid, jsonb) does not exist" },
  ]) {
    assert.deepEqual(await writeSeenMarkers(fakeSupabase({ rpcError }), "u1", { roadmap: "2026-10-01T00:00:00+00:00" }), { markers: {}, available: false });
  }
});

test("write: en anden manglende funktion eller databasefejl kastes (ruten svarer 500, klienten beholder sin lokale kopi)", async () => {
  await assert.rejects(() => writeSeenMarkers(fakeSupabase({ rpcError: { code: "XX000", message: "boom" } }), "u1", { patch_notes: "2026-11-14" }));
  await assert.rejects(() => writeSeenMarkers(fakeSupabase({ rpcError: { code: "42883", message: "function public.other_fn(text) does not exist" } }), "u1", { patch_notes: "2026-11-14" }));
});

test("write: intet gyldigt i patchen = ingen skrivning, kun laesning", async () => {
  const sb = fakeSupabase({ row: { seen_markers: { patch_notes: "2026-11-14" } } });
  assert.deepEqual(await writeSeenMarkers(sb, "u1", { patch_notes: "junk" }), { markers: { patch_notes: "2026-11-14" }, available: true });
  assert.deepEqual(sb.calls.rpcs, []);
});

test("isMissingSeenMarkersStorage", () => {
  assert.equal(isMissingSeenMarkersStorage({ code: "42703" }), true);
  assert.equal(isMissingSeenMarkersStorage({ message: "Could not find the 'seen_markers' column of 'user_ui_prefs' in the schema cache" }), true);
  assert.equal(isMissingSeenMarkersStorage({ code: "23505" }), false);
  assert.equal(isMissingSeenMarkersStorage(null), false);
});
