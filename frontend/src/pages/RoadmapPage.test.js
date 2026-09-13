import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1600 — Roadmap-vedligehold: historik-visning (shipped) + admin-flade.
// Testen holder os ærlige på to ting der let regredierer:
//   1. Privacy-fix'et (#1599) skal stå urørt: egne stemmer hentes med
//      .eq("user_id", uid) OG votesByItemId(...) som forsvars-lag 2.
//   2. Item-querien skal hente BÅDE active og shipped (ellers forsvinder
//      historikken igen, som da frontend hårdt læste status='active').

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "RoadmapPage.jsx"), "utf8");

test("RoadmapPage bevarer privacy-fix: egne stemmer + votesByItemId-lag (#1599)", () => {
  assert.match(
    source,
    /from\("roadmap_votes"\)[\s\S]*?\.eq\("user_id", uid\)/,
    "votes-querien skal filtrere til egen bruger med .eq(\"user_id\", uid)",
  );
  assert.match(
    source,
    /votesByItemId\(voteData, uid\)/,
    "votesByItemId(voteData, uid) er forsvars-lag 2 — må ikke fjernes",
  );
});

test("RoadmapPage henter både active og shipped items (#1600)", () => {
  assert.match(
    source,
    /\.in\("status", \["active", "shipped"\]\)/,
    "item-querien skal hente status IN (active, shipped), ikke kun active",
  );
});

test("RoadmapPage gater admin-flade via is_admin RPC (#1600)", () => {
  assert.match(
    source,
    /supabase\.rpc\("is_admin"\)/,
    "admin-handlinger skal gates client-side med rpc(\"is_admin\") — RLS er source of truth",
  );
});

test("RoadmapPage kalder KUN is_admin-RPC'en naar der er en session (#5153)", () => {
  // /roadmap er en OFFENTLIG rute (#2042/#2824 — registreret uden for
  // ProtectedRoute i App.jsx), og #5153 revoker anon-EXECUTE paa is_admin().
  // Et ubetinget kald giver derfor 403/42501 for hver udlogget besoegende.
  // Ikke brugersynligt (fejlen destruktureres vaek, isAdmin bliver false), og
  // netop derfor er det en fejl der kun fanges af en guard som denne.
  assert.match(
    source,
    /supabase\.auth\.getSession\(\)/,
    "session skal laeses foer RPC-kaldet (getSession er lokal, ingen ekstra rundtur)",
  );
  assert.match(
    source,
    /session \? supabase\.rpc\("is_admin"\) : Promise\.resolve\(/,
    "rpc(\"is_admin\") skal vaere gated paa en session — ellers kalder anon den",
  );
});

test("RoadmapPage har historik-sektion + admin status-toggle (#1600)", () => {
  assert.match(source, /shipped\.title/, "skal rendere en \"shipped\"-historik-sektion");
  assert.match(
    source,
    /handleSetStatus\(item, "shipped"\)/,
    "admin skal kunne flytte item active → shipped",
  );
  assert.match(
    source,
    /handleSetStatus\(item, "active"\)/,
    "admin skal kunne flytte item shipped → active igen",
  );
});

test("RoadmapPage admin-create indsætter i roadmap_items uden migration (#1600)", () => {
  assert.match(
    source,
    /from\("roadmap_items"\)\s*\.insert\(/,
    "admin-create-form skal INSERT'e direkte i roadmap_items (RLS admin-policy)",
  );
});
