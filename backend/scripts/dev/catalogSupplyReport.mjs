#!/usr/bin/env node
// backend/scripts/dev/catalogSupplyReport.mjs
//
// #5405 — kør forsynings-kontrollen (backend/lib/catalogSupplyCheck.js) mod kataloget og
// skriv svaret ud i klar tekst: for hver division og hvert terræn-mål — hvad er kravet,
// hvad er det tilladte område, hvad kan divisionen bedst opnå, hvad er dommen, og hvilke
// løbstyper mangler der.
//
// **100 % READ-ONLY.** Scriptet laver udelukkende SELECT mod `race_pool` og skriver ikke en
// byte nogen steder — ingen `--apply`, ingen migration, ingen mutation af kataloget, ingen
// ændring af udvælgeren. Det kan køres uden prod-credentials mod den committede fixture.
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
  const { fetchAllRows } = await import("../../lib/supabasePagination.js");
  const {
    withSeniorSquadColumns, applySeniorSquadFilter, filterSeniorSquadRows, isMissingSquadColumnError,
  } = await import("../../lib/racePoolCatalog.js");
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const COLUMNS = "id, external_id, terrain_archetype, name, race_class, race_type, stages, date_text";
  // PAGINERET. Et bart `.select()` returnerer maks 1.000 rækker UDEN en fejl (se
  // lib/supabasePagination.js), og et afkortet katalog ville få kontrollen til at melde
  // mangel der ikke findes — eller, værre, at melde grønt på en forsyning den ikke har set.
  // Kataloget er under 1.000 løb i dag; det er præcis derfor guarden skal ligge her nu.
  const fetchPages = (columns, withSeniorFilter) => fetchAllRows(() => {
    const query = sb.from("race_pool").select(columns).is("retired_at", null).order("id", { ascending: true });
    return withSeniorFilter ? applySeniorSquadFilter(query) : query;
  });

  // Senior-kontrakten (#5330) er IKKE valgfri: uden den tælles U23-/junior-rækker med i
  // forsyningen, og seniorkalenderen ville blive dømt på løb den aldrig kan vælge — præcis
  // det fund CodeRabbit gjorde i PR #5412's harness. Samme to-trins-form som
  // `selectSeniorRacePool`: mangler `squad`-kolonnen helt, kan #5262's migration ikke være
  // kørt, og så er hele kataloget per definition senior. Alt andet bobler op.
  let rows;
  try {
    rows = await fetchPages(withSeniorSquadColumns(COLUMNS), true);
  } catch (err) {
    if (!isMissingSquadColumnError(err)) throw err;
    rows = await fetchPages(COLUMNS, false);
  }
  const catalog = filterSeniorSquadRows(rows);
  return { catalog, source: `prod (read-only, ${catalog.length} senior-løb)` };
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
  // Valideres FØR kataloget hentes: `valueOf` returnerer bare det næste argument, så
  // `--race-days --json` eller en tastefejl ville give NaN. quotasForRaceDays mapper NaN til
  // 0 løbsdage, og en rapport mod en kvote på nul er ikke bare forkert — den er misvisende,
  // fordi den ligner en kørsel der har kontrolleret noget.
  const rawRaceDays = valueOf("--race-days", String(SUPPLY_DEFAULT_RACE_DAYS));
  const raceDays = Number(rawRaceDays);
  if (!Number.isInteger(raceDays) || raceDays <= 0) {
    throw new Error(`--race-days skal være et positivt heltal (fik "${rawRaceDays}")`);
  }

  const { catalog, source } = await loadCatalog();
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
