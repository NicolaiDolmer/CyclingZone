#!/usr/bin/env node
// backend/scripts/dev/catalogSupplyReport.mjs
//
// #5405 — kør forsynings-kontrollen (backend/lib/catalogSupplyCheck.js) mod kataloget og
// skriv svaret ud i klar tekst: for hver division og hvert terræn-mål — hvad er kravet,
// hvad er det tilladte område, hvad kan divisionen bedst opnå, hvad er dommen, og hvilke
// løbstyper mangler der.
//
// **100 % READ-ONLY.** Scriptet laver ét SELECT mod `race_pool` og `league_divisions` og
// skriver ikke en byte nogen steder — ingen `--apply`, ingen migration, ingen mutation af
// kataloget, ingen ændring af udvælgeren. Det kan køres uden prod-credentials mod den
// committede fixture.
//
// BRUG
//   # mod den committede fixture (ingen credentials, ingen netværk)
//   node backend/scripts/dev/catalogSupplyReport.mjs
//
//   # mod prod-kataloget, read-only
//   infisical run --env=prod -- node backend/scripts/dev/catalogSupplyReport.mjs --prod
//
//   # andre flag
//   --race-days N   antal løbsdatoer i sæsonen (default 28, CALENDAR_RULES §2)
//   --json          skriv hele resultatet som JSON på stdout i stedet for tabellen
//   --all           vis også de mål der er grønne (default: kun fund + et sammendrag)
//
// HVORNÅR DEN SKAL KØRES: ved enhver katalog-ændring, og senest EN MÅNED før et
// sæsonskifte. Se CALENDAR_RULES.md §5b1.
//
// EXIT-KODER: 0 = ingen blokerende fund · 1 = mindst ét mål kan ikke nås, eller en gruppe
// af divisioner er bestridt. `luck-dependent` giver 0 — det er en skrøbelighed, ikke et
// brud, og den er dokumenteret i §5.
//
// Refs #5405

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  checkCatalogSupply,
  classifySupplyFindings,
  shortfallOf,
  SUPPLY_DEFAULT_RACE_DAYS,
  VERDICT_LABELS,
  BLOCKING_VERDICTS,
} from "../../lib/catalogSupplyCheck.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "..", "..", "lib", "__fixtures__", "racePoolCatalog.prod.json");

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : fallback;
};

async function loadCatalog() {
  if (!has("--prod")) {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
    return { catalog: fixture.catalog, source: `fixture (hentet ${fixture.hentet}, ${fixture.catalog.length} løb)` };
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error("Mangler SUPABASE-secrets. Kør via: infisical run --env=prod -- node backend/scripts/dev/catalogSupplyReport.mjs --prod");
  }
  const { createClient } = await import("@supabase/supabase-js");
  const { selectSeniorRacePool } = await import("../../lib/racePoolCatalog.js");
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  // Samme forespørgsel-form som dumpRacePoolFixture.mjs. `selectSeniorRacePool` (#5330) er
  // IKKE valgfri: uden den tælles U23-/junior-rækker med i forsyningen, og senior-
  // kalenderen ville blive dømt på løb den aldrig kan vælge — præcis det fund CodeRabbit
  // gjorde i PR #5412's harness.
  const { data, error } = await selectSeniorRacePool(
    (columns) => sb.from("race_pool").select(columns).is("retired_at", null).order("id", { ascending: true }),
    { columns: "id, external_id, terrain_archetype, name, race_class, race_type, stages, date_text" },
  );
  if (error) throw new Error(`race_pool: ${error.message}`);
  return { catalog: data ?? [], source: `prod (read-only, ${data?.length ?? 0} senior-løb)` };
}

const pad = (v, n) => String(v).padEnd(n);
const num = (v, n) => String(v ?? "—").padStart(n);

function printRow(row) {
  const allowed = row.kind === "cap"
    ? `≤ ${row.requirement}`
    : row.toleranceCeiling != null ? `${row.requirement}–${row.toleranceCeiling}` : `≥ ${row.requirement}`;
  console.log(
    `  D${row.tier}  ${pad(row.label, 40)} ${pad(row.rule, 5)} krav ${pad(allowed, 10)}`
    + ` loft ${num(row.bestAchievable, 4)}  garanteret ${num(row.bestGuaranteed, 4)}  → ${VERDICT_LABELS[row.verdict]}`,
  );
}

function printSources(row) {
  const present = row.missingSources?.present ?? [];
  const absent = row.missingSources?.absentFromWindow ?? [];
  if (present.length) {
    const top = present.slice(0, 5).map((s) => `${s.archetype} (${s.races} løb, højst ${s.maxStages} etaper)`);
    console.log(`        kilder i vinduet: ${top.join(" · ")}${present.length > 5 ? ` · +${present.length - 5} flere` : ""}`);
  } else {
    console.log("        kilder i vinduet: INGEN — ingen løbstype i divisionens klasse-vindue kan bidrage");
  }
  if (absent.length) console.log(`        findes i kataloget, men uden for vinduet: ${absent.join(", ")}`);
}

async function main() {
  const { catalog, source } = await loadCatalog();
  const raceDays = Number(valueOf("--race-days", SUPPLY_DEFAULT_RACE_DAYS));
  const result = checkCatalogSupply({ catalog, raceDays });

  if (has("--json")) {
    console.log(JSON.stringify({ source, ...result }, null, 2));
  } else {
    console.log(`\nFORSYNINGS-KONTROL AF KALENDER-KATALOGET (#5405)`);
    console.log(`Kilde: ${source}`);
    console.log(`Sæson-ramme: ${raceDays} løbsdatoer → kvoter ${JSON.stringify(result.quotas)}\n`);

    for (const [tier, ok] of Object.entries(result.quotaReachable)) {
      if (!ok) console.log(`  [!] D${tier}: kataloget kan ikke ramme kvoten ${result.quotas[tier]} EKSAKT (§1b).`);
    }

    const shown = has("--all") ? result.rows : result.rows.filter((r) => r.verdict !== "reachable");
    console.log(shown.length ? "TERRÆN-MÅL" : "TERRÆN-MÅL: alle grønne.");
    for (const row of shown) {
      printRow(row);
      if (row.verdict !== "reachable") printSources(row);
      if (row.contestedWith) {
        console.log(`        deler forsyning med D${row.contestedWith.group.join("+")}:`
          + ` ${row.contestedWith.supply} til rådighed mod ${row.contestedWith.demand} krævet`);
      }
    }

    const resShown = has("--all") ? result.reservations : result.reservations.filter((r) => r.verdict !== "reachable");
    console.log(resShown.length ? "\nARKETYPE-RESERVATIONER (§5)" : "\nARKETYPE-RESERVATIONER (§5): alle grønne.");
    for (const row of resShown) {
      console.log(`  D${row.tier}  ${pad(row.label, 40)} krav ${num(row.requirement, 3)} løb`
        + `  i vinduet ${num(row.supplyInWindow, 3)}  → ${VERDICT_LABELS[row.verdict]}`);
    }

    const { unexpected, expected, expired } = classifySupplyFindings(result.findings, {
      today: new Date().toISOString().slice(0, 10),
    });
    console.log("\nSAMMENDRAG");
    console.log(`  ${result.rows.length + result.reservations.length} domme · ${result.findings.length} fund`
      + ` (${result.findings.filter((f) => BLOCKING_VERDICTS.includes(f.verdict)).length} blokerende)`);
    for (const { finding, deviation } of expected) {
      console.log(`  [forventet] ${deviation.id} · D${finding.tier} ${finding.goalId}`
        + ` · mangler ${shortfallOf(finding)} · genbesøg senest ${deviation.reviewBy}`);
    }
    for (const f of unexpected) {
      console.log(`  [NYT] D${f.tier} ${f.goalId}: ${VERDICT_LABELS[f.verdict]} · mangler ${shortfallOf(f)}`);
    }
    for (const d of expired) console.log(`  [UDLØBET] ${d.id} skulle have været genbesøgt ${d.reviewBy}`);
    console.log("");
    console.log("  Loftet er OPTIMISTISK: et mål over loftet kan ikke nås, men et mål under");
    console.log("  loftet er ikke dermed nået. Se docstringen i backend/lib/catalogSupplyCheck.js.");
    console.log("");
  }

  const blocking = result.findings.filter((f) => BLOCKING_VERDICTS.includes(f.verdict));
  process.exitCode = blocking.length ? 1 : 0;
}

main().catch((err) => {
  console.error("[fatal]", err?.message ?? err);
  process.exitCode = 1;
});
