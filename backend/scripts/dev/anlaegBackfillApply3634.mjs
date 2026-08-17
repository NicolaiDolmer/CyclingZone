#!/usr/bin/env node
// backend/scripts/dev/anlaegBackfillApply3634.mjs
// ============================================================================
// #3634 — BACKFILL af ryttere født uden anlægs-sekundær. Kandidat B, ejer-go 15/8.
//
//   Dry-run (default):  infisical run --env=prod -- node scripts/dev/anlaegBackfillApply3634.mjs
//   Kørsel:             ... anlaegBackfillApply3634.mjs --apply
//
// HVAD DEN SKRIVER, OG HVAD DEN BEVIDST IKKE SKRIVER
//
// Kun ÉN kolonne: `riders.archetype_draw`, hvor `secondary` sættes. Ikke
// `riders.secondary_type` og ikke `rider_derived_abilities.ability_caps`.
//
// Det er ikke en afgrænsning for nemheds skyld, det er guardens kontrakt:
// `resolveRiderTypes(archetype_draw, caps, baseline)` er identitets-kilden
// (#3588, `scripts/lintRiderTypeWrites.js`). Bærer rytteren et anlæg, ER anlægget
// identiteten. Sætter vi sekundæren i anlægget, følger både `secondary_type` og
// de anlægs-formede caps med ad produktionens egen vej ved næste derive-kørsel.
// At skrive dem her ville være en fjerde skrivesti til ryttertypen — præcis den
// fejlform #3588 og guarden findes for at forhindre.
//
// VALGET AF SEKUNDÆR (kandidat B). Trukket fra `DEFAULT_DISTRIBUTION` via
// `drawSecondaryArchetype` — samme kilde som akademiet og som generatoren efter
// PR #3800 — seedet DETERMINISTISK fra rytterens UUID. Samme rytter giver samme
// type ved hver kørsel, så dry-run og kørsel viser nøjagtig det samme, og en
// gentagelse kan ikke give et andet resultat.
//
// Kandidat A (frys klassifikatorens gæt) er FRAVALGT af ejeren 15/8. Begrundelsen
// står i `docs/audits/2026-08-15-3634-backfill-dry-run.md`: A ville cementere
// 41,7 % baroudeur og 0 % tt/puncheur, og den var ikke usynlig alligevel — begge
// kandidater flytter det absolutte loft med median 74 L1-point, fordi en forankret
// sekundær vejer 0,82 hvor "ingen sekundær" vejer 0,45.
//
// IDEMPOTENS. Kun rækker hvor `archetype_draw->>'secondary'` er NULL røres, og
// opdateringen bevarer alle øvrige nøgler i objektet (jsonb-merge i JS, ikke
// overskrivning). En gentagen kørsel rammer 0 rækker.
//
// SNAPSHOT. Skrives ALTID før mutation, også i dry-run, til
// `docs/snapshots/3634/`. Uden et læsbart snapshot køres der ikke.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { fetchAllRows } from "../../lib/supabasePagination.js";
import { makeRng } from "../../lib/fictionalRiderGenerator.js";
import {
  drawSecondaryArchetype,
  ARCHETYPE_TYPES,
  DEFAULT_DISTRIBUTION,
} from "../../lib/archetypeDistribution.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = join(__dirname, "../../../docs/snapshots/3634");

const APPLY = process.argv.includes("--apply");
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE secrets (kør via: infisical run --env=prod -- node ...)");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Samme seed-afledning som dry-run-scriptet, så de to viser samme resultat.
function seedFromId(id) {
  let h = 0;
  for (const ch of String(id)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return h >>> 0;
}

// Pagineret (#3331): mængden er 72 i dag, men den er ikke bundet af noget —
// issuet handler netop om at den voksede med 24 i døgnet.
const fetchMissing = () => fetchAllRows(() => sb
  .from("riders")
  .select("id, firstname, lastname, archetype_draw, primary_type, secondary_type, team_id")
  .eq("is_retired", false)
  .not("archetype_draw->>primary", "is", null)
  .is("archetype_draw->>secondary", null)
  .order("id", { ascending: true }));

console.log(`\n=== #3634 backfill — kandidat B ${APPLY ? "KØRSEL" : "DRY-RUN"} ===`);

const before = await fetchMissing();
console.log(`Ryttere uden anlægs-sekundær: ${before.length}`);
if (!before.length) {
  console.log("Ingenting at gøre. (Idempotent: en tidligere kørsel har allerede dækket dem.)");
  process.exit(0);
}

// ── Snapshot FØR mutation ────────────────────────────────────────────────────
mkdirSync(SNAPSHOT_DIR, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const snapshotPath = join(SNAPSHOT_DIR, `backfill-foer-${stamp}.json`);
writeFileSync(snapshotPath, JSON.stringify({
  issue: 3634,
  kandidat: "B",
  taget: new Date().toISOString(),
  antal: before.length,
  raekker: before,
}, null, 2));
console.log(`Snapshot skrevet: ${snapshotPath}`);

// ── Plan ─────────────────────────────────────────────────────────────────────
const plan = before.map((r) => ({
  id: r.id,
  navn: `${r.firstname} ${r.lastname}`,
  primary: r.archetype_draw.primary,
  foer: r.secondary_type ?? "(ingen)",
  efter: drawSecondaryArchetype(makeRng(seedFromId(r.id)), r.archetype_draw.primary),
  draw: r.archetype_draw,
}));

const fordeling = {};
let skifter = 0;
for (const p of plan) {
  fordeling[p.efter] = (fordeling[p.efter] || 0) + 1;
  if (p.foer !== p.efter) skifter++;
}
console.log(`Ryttere hvis SYNLIGE andentype skifter: ${skifter}/${plan.length}`);
console.log(`\n${"type".padEnd(16)} | ${"antal".padStart(5)} | ${"%".padStart(6)} | mål %`);
console.log("-".repeat(48));
for (const t of ARCHETYPE_TYPES) {
  const n = fordeling[t] || 0;
  console.log(`${t.padEnd(16)} | ${String(n).padStart(5)} | ${((100 * n) / plan.length).toFixed(1).padStart(6)} | ${DEFAULT_DISTRIBUTION[t].toFixed(2)}`);
}

if (!APPLY) {
  console.log("\nDRY-RUN. Intet skrevet. Kør med --apply for at gennemføre.\n");
  process.exit(0);
}

// ── Kørsel ───────────────────────────────────────────────────────────────────
console.log("\nSkriver…");
let opdateret = 0;
const fejl = [];
for (const p of plan) {
  // Bevar alle øvrige nøgler i anlægget; sæt kun `secondary`.
  const nyDraw = { ...p.draw, secondary: p.efter };
  const { error } = await sb
    .from("riders")
    .update({ archetype_draw: nyDraw })
    .eq("id", p.id)
    .is("archetype_draw->>secondary", null); // idempotens-vagt: rør kun rækker der stadig mangler
  if (error) fejl.push({ id: p.id, error: error.message });
  else opdateret++;
}
console.log(`Opdateret: ${opdateret}/${plan.length}${fejl.length ? ` · FEJL: ${fejl.length}` : ""}`);
if (fejl.length) {
  console.error(JSON.stringify(fejl.slice(0, 5), null, 2));
  process.exitCode = 1;
}

// ── Efterverifikation ────────────────────────────────────────────────────────
const efter = await fetchMissing();
console.log(`\n── Efterverifikation ──`);
console.log(`  Ryttere uden anlægs-sekundær nu: ${efter.length} (forventet 0)`);

const kontrol = await fetchAllRows(() => sb
  .from("riders")
  .select("id, archetype_draw")
  .in("id", plan.map((p) => p.id))
  .order("id", { ascending: true }));
let matcher = 0;
let ugyldige = 0;
const planById = new Map(plan.map((p) => [p.id, p]));
for (const r of kontrol) {
  const sek = r.archetype_draw?.secondary;
  if (sek === planById.get(r.id)?.efter) matcher++;
  if (!sek || sek === r.archetype_draw?.primary || !ARCHETYPE_TYPES.includes(sek)) ugyldige++;
}
console.log(`  Skrevet som planlagt: ${matcher}/${plan.length}`);
console.log(`  Ugyldige anlæg (tom, = primær, ukendt type): ${ugyldige} (forventet 0)`);

const ok = efter.length === 0 && matcher === plan.length && ugyldige === 0 && fejl.length === 0;
console.log(`\n  ${ok ? "GRØN — backfill gennemført og verificeret" : "RØD — se tallene ovenfor"}`);
console.log(
  `\nBemærk: spillerens SYNLIGE andentype (riders.secondary_type) og de anlægs-formede\n` +
  `lofter opdateres ved næste derive-kørsel, ikke af dette script. Det er med vilje —\n` +
  `anlægget er identiteten, og produktionen læser det selv (resolveRiderTypes).\n` +
  `Rollback: snapshottet ovenfor indeholder de oprindelige archetype_draw-objekter.\n`,
);
if (!ok) process.exitCode = 1;
