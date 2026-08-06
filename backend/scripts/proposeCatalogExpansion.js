#!/usr/bin/env node
// backend/scripts/proposeCatalogExpansion.js
// #3295: find det MINDSTE sæt nye race_pool-løb der får en sæsonkalender gennem alle
// gates. RØRER INTET I DB (kun SELECT + dry-run-analyse).
//
//   node scripts/proposeCatalogExpansion.js --season 3 --first-day 2026-08-24
//   node scripts/proposeCatalogExpansion.js --season 3 --first-day 2026-08-24 --json
//
// HVORFOR: S3's kalender kan ikke bygges. buildSeasonCalendar.js blokerer på fire brud
// (tier 3: summit 5<8, M-Down 65%, 0 brosten-etapeløb · tier 4: 0 fritstående ITT), og de
// kan IKKE løses med parcours-vægte — de handler om hvilke løb tier-udvalget overhovedet
// har at vælge imellem. raceRouteRealismMetrics.js siger det selv: "Skal båndene hæves,
// skal katalogets summit-forsyning op FØRST."
//
// METODE: grådig fremadrettet udvælgelse. Start fra det rigtige katalog, prøv hver
// kandidat, behold den der fjerner flest brud, gentag til alt er grønt eller ingen
// kandidat hjælper. Deterministisk (ingen RNG); kandidaterne prøves i fast rækkefølge og
// uafgjort brydes af listeordenen.
//
// HVORFOR GRÅDIGT OG IKKE UDTØMMENDE: hver evaluering kører hele selection+packing+
// parcours-pipelinen for fire tiers. Et udtømmende søg over ~20 kandidater er 2^20
// kørsler. Grådigt giver et lille, forklarligt sæt — og scriptet rapporterer ærligt hvis
// det sidder fast, i stedet for at påstå at der ikke findes en løsning.
//
// KLASSE-VALGET ER DET AFGØRENDE (TIER_CLASS_WHITELIST):
//   tier 2: OtherWorldTourB · ProSeries · OtherWorldTourC
//   tier 3: ProSeries · Class1
//   tier 4: Class1 · Class2
// Tiers vælger i rækkefølge 1→4 med cross-tier-dedup, så en højere tier tømmer de knappe
// arketyper først. Et løb der SKAL ende i tier 4 hører derfor til i Class2 (kun tier 4
// må tage den); et der skal til tier 3 hører i Class1 (tier 3 vælger før tier 4).

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { materializeTierCalendars } from "../lib/tierCalendarMaterializer.js";
import { resolveCalendarFrom } from "../lib/calendarStartDate.js";
import { gatePlan, seasonUuid } from "./buildSeasonCalendar.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

// external_id er en 16-tegns hex-nøgle i kataloget. Den SKAL være stabil pr. løb: den er
// parcours-seedens identitet (seedIdentityFor), så et løb der skifter external_id får et
// helt nyt parcours. Udledt deterministisk af navnet — samme navn giver samme id, uanset
// hvornår scriptet køres.
export function externalIdFor(name) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < name.length; i++) {
    h1 = Math.imul(h1 ^ name.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + name.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 16);
}

// Kandidat-løb. Navnene følger katalogets konvention: geografisk plausible, fiktive
// varianter af rigtige løb med et lokalt "ny/mindre"-suffiks (Nouveau/Mineur/Nuovo/
// Menor/Neu). Etapeantallet respekterer CLASS_STAGE_LENGTH_BAND (#3328) — Class1/Class2
// har intet bånd, så 3-5 etaper er valgt for at ligne resten af katalogets lave klasser.
//
// Rækkefølgen er den grådige søgnings tie-break: mest målrettede kandidat først.
export const CANDIDATES = Object.freeze([
  // ── Tier 4's manglende fritstående ITT ──
  // Class2 er tier 4's EKSKLUSIVE klasse (tier 3 må ikke tage den), så et ITT-endagsløb
  // her rammer garanteret tier 4. Verificeret: dette ene løb fjerner bruddet.
  { name: "Chrono des Herbiers Mineur", country: "France", race_class: "Class2", race_type: "single", stages: 1, terrain_archetype: "itt_classic",
    why: "tier 4: fritstående ITT 0 → 1. Class2 = tier 4's eksklusive klasse" },

  // ── Tier 3's summit-underskud + M-Down ──
  // SKAL være ProSeries: tier 3 fylder sin kvote prestige-først og når aldrig ned til
  // Class1 (målt — Class1-kandidater havner i tier 4). ProSeries deles med tier 2, så der
  // skal flere til end tier 3 selv bruger; 4 er det målte minimum hvor BÅDE summit ≥ 8 og
  // M-Down ≤ 55 % holder.
  { name: "Vuelta a los Lagos de Asturias", country: "Spain", race_class: "ProSeries", race_type: "stage_race", stages: 5, terrain_archetype: "summit_tour",
    why: "tier 3 summit 5 → 8+; summit_tour er eneste arketype med 2x high_mountain-garanti" },
  { name: "Giro delle Dolomiti Minore", country: "Italy", race_class: "ProSeries", race_type: "stage_race", stages: 5, terrain_archetype: "summit_tour",
    why: "tier 3's summit-forsyning hvilede på kun 2 løb" },
  { name: "Tour des Pyrénées Centrales", country: "France", race_class: "ProSeries", race_type: "stage_race", stages: 5, terrain_archetype: "summit_tour",
    why: "margin, så ét uheldigt parcours-træk ikke fælder båndet" },
  { name: "Volta a Portugal Central", country: "Portugal", race_class: "ProSeries", race_type: "stage_race", stages: 5, terrain_archetype: "summit_tour",
    why: "fjerde summit_tour — det målte minimum for at M-Down også falder under 55 %" },

  // ── Brosten-forsyning ──
  // NB: disse løser IKKE tier 3's brosten-garanti (se rapportens note) — de løfter
  // brosten-andelen i tier 2 fra 1,8 % og giver tier 4 dækning.
  { name: "Ronde van de Vlaamse Ardennen", country: "Belgium", race_class: "ProSeries", race_type: "stage_race", stages: 4, terrain_archetype: "cobbled_tour",
    why: "brosten-etapeløb; tier 2's brosten-andel var 1,8 %" },
  { name: "Driedaagse van de Schelde", country: "Belgium", race_class: "ProSeries", race_type: "stage_race", stages: 4, terrain_archetype: "cobbled_tour",
    why: "andet brosten-etapeløb" },
  { name: "Ronde van Vlaams-Limburg", country: "Belgium", race_class: "ProSeries", race_type: "stage_race", stages: 4, terrain_archetype: "cobbled_tour",
    why: "tredje — cobbled_tour er i SCARCE_TERRAIN_ARCHETYPES og opsnappes af tier 2" },
  { name: "Tour du Nord-Pas-de-Calais", country: "France", race_class: "ProSeries", race_type: "stage_race", stages: 4, terrain_archetype: "cobbled_tour",
    why: "fjerde — målt minimum for at brosten-andelen holder samlet" },

  // ── #3371: bredde i lave divisioner (ikke gate-blokerende, men efterspurgt) ──
  { name: "Ronde van Zuid-Holland", country: "Netherlands", race_class: "Class1", race_type: "stage_race", stages: 3, terrain_archetype: "sprinters_week",
    why: "#3371: flere sprinter-venlige etapeløb i lave divisioner" },
  { name: "Giro dell'Appennino Tosco-Emiliano", country: "Italy", race_class: "Class1", race_type: "stage_race", stages: 4, terrain_archetype: "hilly_tour",
    why: "#3371 + #3327: hilly_tour er den mest pålidelige kilde til bjergfrie etapeløb" },
  { name: "Vuelta a la Rioja Menor", country: "Spain", race_class: "Class2", race_type: "stage_race", stages: 3, terrain_archetype: "hilly_tour",
    why: "samme for tier 4" },
  // Ekstra kandidat-pulje. Hvilken TIER et løb havner i afhænger bl.a. af dets external_id
  // (afledt af navnet) via seededKey's tie-break inden for samme prestige+størrelse — så
  // ProSeries-løb fordeler sig mellem tier 2 og 3 på en måde man ikke kan designe sig til.
  // Puljen er derfor bredere end det sæt søgningen ender med at vælge; de valgte er dem
  // der MÅLT lander hvor der er brug for dem.
  { name: "Vuelta a los Puertos de León", country: "Spain", race_class: "ProSeries", race_type: "stage_race", stages: 5, terrain_archetype: "summit_tour",
    why: "summit-forsyning til tier 3" },
  { name: "Giro dell'Alto Adige", country: "Italy", race_class: "ProSeries", race_type: "stage_race", stages: 4, terrain_archetype: "summit_tour",
    why: "summit-forsyning til tier 3" },
  { name: "Tour du Massif Central", country: "France", race_class: "ProSeries", race_type: "stage_race", stages: 5, terrain_archetype: "summit_tour",
    why: "summit-forsyning til tier 3" },
  { name: "Volta a Galicia das Montañas", country: "Spain", race_class: "ProSeries", race_type: "stage_race", stages: 4, terrain_archetype: "summit_tour",
    why: "summit-forsyning til tier 3" },
  { name: "Giro della Valle d'Aosta Maggiore", country: "Italy", race_class: "ProSeries", race_type: "stage_race", stages: 5, terrain_archetype: "summit_tour",
    why: "summit-forsyning til tier 3" },
  { name: "Tour des Alpes Maritimes Majeur", country: "France", race_class: "ProSeries", race_type: "stage_race", stages: 4, terrain_archetype: "summit_tour",
    why: "summit-forsyning til tier 3" },
  { name: "Omloop van de Zandstraten", country: "Belgium", race_class: "ProSeries", race_type: "stage_race", stages: 4, terrain_archetype: "cobbled_tour",
    why: "brosten-etapeløb til tier 3" },
  { name: "Ronde van het Hageland", country: "Belgium", race_class: "ProSeries", race_type: "stage_race", stages: 3, terrain_archetype: "cobbled_tour",
    why: "brosten-etapeløb til tier 3" },
  { name: "Tour de Picardie Nouveau", country: "France", race_class: "ProSeries", race_type: "stage_race", stages: 4, terrain_archetype: "cobbled_tour",
    why: "brosten-etapeløb til tier 3" },
]);

/** Katalog-række-form (race_pool). id = deterministisk pseudo-uuid, KUN til dry-run. */
export function toCatalogRow(c) {
  const ext = externalIdFor(c.name);
  return {
    id: `ffffffff-0000-4000-8000-${ext.slice(0, 12)}`,
    external_id: ext,
    name: c.name,
    race_class: c.race_class,
    race_type: c.race_type,
    stages: c.stages,
    terrain_archetype: c.terrain_archetype,
  };
}

/** Kør alle gates for ét kandidat-sæt. */
export async function evaluateWith({ supabase, seasonId, from, firstDay, extra }) {
  const plan = await materializeTierCalendars({
    supabase, seasonId, seasonStartDate: firstDay || null, from, dryRun: true, log: () => {},
    extraCatalogRows: extra.map(toCatalogRow),
  });
  const { blocking, compositionDrift, severity, report } = gatePlan(plan);
  return { blocking, compositionDrift, severity, report, plan };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argOf = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };
  const seasonNumber = Number(argOf("--season") ?? 3);
  const firstDay = argOf("--first-day");
  const asJson = process.argv.includes("--json");

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("⚠ Missing SUPABASE creds"); process.exit(2); }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const seasonId = seasonUuid(seasonNumber);
  const from = resolveCalendarFrom({ firstRaceDate: firstDay || undefined });

  try {
    console.log(`\n=== Katalog-udvidelse for sæson ${seasonNumber} (dry-run, intet skrives) ===\n`);

    const base = await evaluateWith({ supabase, seasonId, from, firstDay, extra: [] });
    console.log(`Uden nye løb: ${base.blocking.length} blokerende brud (samlet afstand til båndene ${base.severity.toFixed(1)})`);
    for (const b of base.blocking) console.log(`   · ${b}`);
    if (base.blocking.length === 0) {
      console.log(`\n✅ Kalenderen er allerede grøn — ingen katalog-udvidelse nødvendig.\n`);
      process.exit(0);
    }

    // Grådigt: tilføj den kandidat der fjerner flest brud, gentag.
    const chosen = [];
    let current = base;
    const remaining = [...CANDIDATES];

    while (current.blocking.length > 0 && remaining.length > 0) {
      let best = null;
      for (const cand of remaining) {
        const trial = await evaluateWith({ supabase, seasonId, from, firstDay, extra: [...chosen, cand] });
        // Scorer på AFSTAND til båndene, ikke antal brud: tier 3's summit-bånd lukkes først
        // af fire nye løb, så ingen enkelt kandidat fjerner bruddet. En antal-baseret søgning
        // ville se dem alle som værdiløse og stoppe efter det ene ITT-løb (målt 6/8).
        const gained = current.severity - trial.severity;
        if (gained > 1e-9 && (!best || gained > best.gained)) best = { cand, trial, gained };
      }
      if (!best) break;
      chosen.push(best.cand);
      current = best.trial;
      const idx = remaining.indexOf(best.cand);
      remaining.splice(idx, 1);
      console.log(`\n+ ${best.cand.name} (${best.cand.race_class}, ${best.cand.terrain_archetype}) → ${current.blocking.length} brud tilbage`);
    }

    console.log(`\n── FORSLAG: ${chosen.length} nye løb ──`);
    for (const c of chosen) {
      console.log(`  ${c.name}`);
      console.log(`     ${c.country} · ${c.race_class} · ${c.race_type}${c.race_type === "stage_race" ? ` (${c.stages} etaper)` : ""} · ${c.terrain_archetype}`);
      console.log(`     external_id ${externalIdFor(c.name)} — ${c.why}`);
    }

    console.log(`\n── EFTER ──`);
    if (current.blocking.length === 0) {
      console.log(`✅ Alle blokerende gates grønne.`);
    } else {
      console.log(`❌ ${current.blocking.length} brud kan IKKE løses med de foreslåede kandidater:`);
      for (const b of current.blocking) console.log(`   · ${b}`);
      console.log(`   → udvid CANDIDATES-listen, eller båndene skal justeres (ejer-beslutning).`);
    }
    for (const r of current.report.rows) {
      console.log(`  ${r.label.padEnd(9)} ${r.actual.toFixed(1).padStart(5)} %  mål ${String(r.target).padStart(2)} %  ${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(1)} pp  ${r.pass ? "OK" : "UDENFOR"}`);
    }
    if (current.compositionDrift.length) {
      console.log(`\n⚠ Kompositions-afvigelse (ikke blokerende):`);
      for (const c of current.compositionDrift) console.log(`   · ${c}`);
    }

    if (asJson) {
      console.log(`\n${JSON.stringify({ chosen: chosen.map((c) => ({ ...c, external_id: externalIdFor(c.name) })), blockingAfter: current.blocking }, null, 2)}`);
    }
    console.log(`\nIngen af løbene findes i race_pool — dette er et FORSLAG til ejer-godkendelse.\n`);
    process.exitCode = current.blocking.length === 0 ? 0 : 1;
  } catch (e) {
    console.error(e);
    process.exitCode = 2;
  }
}
