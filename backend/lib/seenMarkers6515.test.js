// #6515 · Sidst set patch notes/roadmap paa brugeren: validering, nyeste-vinder-flet og lager.
import test from "node:test";
import assert from "node:assert/strict";
import {
  SEEN_MARKER_KEYS, isValidSeenMarker, laterSeenMarker, publicSeenMarkers, sanitizeSeenMarkersPatch,
  mergeSeenMarkers, isMissingSeenMarkersStorage, readSeenMarkers, writeSeenMarkers,
} from "./seenMarkers6515.js";

const NOW = () => "2026-11-14T12:00:00.000Z";

function fakeSupabase({ row = null, readError = null, writeError = null } = {}) {
  const calls = { selects: [], upserts: [] };
  return {
    calls,
    from(table) {
      assert.equal(table, "user_ui_prefs");
      return {
        select(cols) { calls.selects.push(cols); return this; },
        eq() { return this; },
        limit: async () => ({ data: readError ? null : (row ? [row] : []), error: readError }),
        upsert: async (value, opts) => {
          calls.upserts.push({ value, opts });
          return { error: writeError };
        },
      };
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

test("laterSeenMarker: nyeste vinder, ugyldig taeller som fravaerende", () => {
  assert.equal(laterSeenMarker("2026-11-10", "2026-11-14"), "2026-11-14");
  assert.equal(laterSeenMarker("2026-11-14", "2026-11-10"), "2026-11-14");
  assert.equal(laterSeenMarker(undefined, "2026-11-10"), "2026-11-10");
  assert.equal(laterSeenMarker("2026-11-10", "junk"), "2026-11-10");
  assert.equal(laterSeenMarker(null, undefined), null);
});

test("publicSeenMarkers: kun kendte noegler med gyldig vaerdi", () => {
  assert.deepEqual(publicSeenMarkers({ patch_notes: "2026-11-14", roadmap: "x", other: "2026-11-14" }), { patch_notes: "2026-11-14" });
  assert.deepEqual(publicSeenMarkers(null), {});
  assert.deepEqual(publicSeenMarkers(["2026-11-14"]), {});
});

test("sanitize: gyldige markoerer gaar igennem, resten afvises med errorCode", () => {
  assert.deepEqual(sanitizeSeenMarkersPatch({ markers: { patch_notes: "2026-11-14" } }), { ok: true, patch: { patch_notes: "2026-11-14" } });
  assert.equal(sanitizeSeenMarkersPatch({ markers: { forum: "2026-11-14" } }).errorCode, "seen_markers_unknown_keys");
  assert.equal(sanitizeSeenMarkersPatch({ markers: { roadmap: "soon" } }).errorCode, "seen_markers_invalid_value");
  assert.equal(sanitizeSeenMarkersPatch({ markers: {} }).errorCode, "seen_markers_invalid_payload");
  assert.equal(sanitizeSeenMarkersPatch({ markers: ["2026-11-14"] }).errorCode, "seen_markers_invalid_payload");
  assert.equal(sanitizeSeenMarkersPatch(null).errorCode, "seen_markers_invalid_payload");
});

test("merge: en aeldre markoer kan aldrig hive en nyere tilbage", () => {
  const { merged, changed } = mergeSeenMarkers({ patch_notes: "2026-11-14" }, { patch_notes: "2026-11-01" });
  assert.deepEqual(merged, { patch_notes: "2026-11-14" });
  assert.equal(changed, false);
});

test("merge: nyere markoer rykker frem, andre markoerer staar urort", () => {
  const { merged, changed } = mergeSeenMarkers(
    { patch_notes: "2026-11-01", roadmap: "2026-10-01T00:00:00+00:00" },
    { patch_notes: "2026-11-14" },
  );
  assert.deepEqual(merged, { patch_notes: "2026-11-14", roadmap: "2026-10-01T00:00:00+00:00" });
  assert.equal(changed, true);
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

test("write: to enheder samme bruger, telefonens nyere markoer overlever computerens aeldre", async () => {
  // Telefonen har allerede gemt den nyeste note; computeren sender sin gamle lokale kopi.
  const sb = fakeSupabase({ row: { seen_markers: { patch_notes: "2026-11-14" } } });
  const out = await writeSeenMarkers(sb, "u1", { patch_notes: "2026-11-01" }, NOW);
  assert.deepEqual(out, { markers: { patch_notes: "2026-11-14" }, available: true });
  assert.equal(sb.calls.upserts.length, 0, "intet rykkede frem, saa intet skrives");
});

test("write: ny markoer upsertes paa user_id og roerer kun seen_markers (ikke prefs)", async () => {
  const sb = fakeSupabase({ row: { seen_markers: { roadmap: "2026-10-01T00:00:00+00:00" } } });
  const out = await writeSeenMarkers(sb, "u1", { patch_notes: "2026-11-14" }, NOW);
  assert.deepEqual(out.markers, { roadmap: "2026-10-01T00:00:00+00:00", patch_notes: "2026-11-14" });
  assert.deepEqual(sb.calls.upserts, [{
    value: { user_id: "u1", seen_markers: { roadmap: "2026-10-01T00:00:00+00:00", patch_notes: "2026-11-14" }, updated_at: "2026-11-14T12:00:00.000Z" },
    opts: { onConflict: "user_id" },
  }]);
  assert.equal("prefs" in sb.calls.upserts[0].value, false);
});

test("write: manglende kolonne skriver intet", async () => {
  const sb = fakeSupabase({ readError: { code: "PGRST204" } });
  assert.deepEqual(await writeSeenMarkers(sb, "u1", { roadmap: "2026-10-01T00:00:00+00:00" }), { markers: {}, available: false });
  assert.equal(sb.calls.upserts.length, 0);
});

test("write: fejl ved upsert kastes (ruten svarer 500, klienten beholder sin lokale kopi)", async () => {
  const sb = fakeSupabase({ writeError: { code: "XX000", message: "boom" } });
  await assert.rejects(() => writeSeenMarkers(sb, "u1", { patch_notes: "2026-11-14" }, NOW));
});

test("isMissingSeenMarkersStorage", () => {
  assert.equal(isMissingSeenMarkersStorage({ code: "42703" }), true);
  assert.equal(isMissingSeenMarkersStorage({ message: "Could not find the 'seen_markers' column of 'user_ui_prefs' in the schema cache" }), true);
  assert.equal(isMissingSeenMarkersStorage({ code: "23505" }), false);
  assert.equal(isMissingSeenMarkersStorage(null), false);
});
