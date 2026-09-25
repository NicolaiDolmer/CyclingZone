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
// #5177 spor 2 (LCP): admin-create-formen blev udskilt til egen lazy-loaded
// chunk (mindre JS for ikke-admin besøgende) — dens kilde ligger derfor ikke
// længere i RoadmapPage.jsx.
const adminFormSource = readFileSync(
  join(__dirname, "..", "components", "RoadmapAdminCreateForm.jsx"),
  "utf8",
);

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
    adminFormSource,
    /from\("roadmap_items"\)\s*\.insert\(/,
    "admin-create-form skal INSERT'e direkte i roadmap_items (RLS admin-policy)",
  );
});

test("RoadmapPage lazy-loader admin-create-formen via lazyWithRetry (#5177 spor 2, LCP + #5014 chunk-retry)", () => {
  assert.match(
    source,
    /lazyWithRetry\(\(\) => import\("\.\.\/components\/RoadmapAdminCreateForm\.jsx"\)\)/,
    "AdminCreateForm skal splittes via lazyWithRetry (ikke bart React.lazy — #5014 chunk-retry-guard), og ikke bundles ind i alles roadmap-chunk",
  );
});

// #5673: gul ulæst-prik ved nye roadmap-punkter — samme storage-strategi
// (localStorage, lib/roadmapUnread.ts) som Patch Notes, ikke en server-side
// last-read-tabel som forum.
test("RoadmapPage bruger roadmapUnread.ts til prikken på det enkelte punkt (#5673)", () => {
  assert.match(
    source,
    /from "\.\.\/lib\/roadmapUnread\.ts"/,
    "skal importere fra lib/roadmapUnread.ts, ikke genopfinde sammenligningen lokalt",
  );
  assert.match(
    source,
    /isRoadmapItemNew\(item\.created_at, lastSeenBeforeVisit\)/,
    "hvert punkt skal vise sin egen \"ny\"-prik ud fra isRoadmapItemNew",
  );
});

test("RoadmapPage fanger lastSeen ÉN gang ved mount, FØR den overskrives (#5673)", () => {
  assert.match(
    source,
    /useState\(\(\) => readLastSeenRoadmap\(\)\)/,
    "lastSeenBeforeVisit skal initialiseres fra readLastSeenRoadmap() i en useState-lazy-initializer, ikke genlæses ved hvert render",
  );
});

test("RoadmapPage nulstiller lastSeen ved besøg — skriver nyeste created_at blandt de hentede punkter (#5673)", () => {
  assert.match(
    source,
    /writeLastSeenRoadmap\(latestRoadmapCreatedAt\(all\)\)/,
    "besøg af /roadmap skal skrive nyeste created_at som ny lastSeen, ellers forsvinder nav-prikken (Layout.jsx) aldrig",
  );
});

test("RoadmapPage's item-query henter created_at (via ROADMAP_ITEM_COLUMNS, #5673)", () => {
  assert.match(
    source,
    /\.select\(ROADMAP_ITEM_COLUMNS\)/,
    "items-querien skal bruge den delte kolonneliste (nu inkl. created_at)",
  );
});
