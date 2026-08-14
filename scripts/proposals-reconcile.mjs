#!/usr/bin/env node
// proposals-reconcile.mjs — fanger forslag der er anvendt i prod men stadig
// ligger i database/proposals/ som om de afventer beslutning.
//
// ── Hvorfor ──────────────────────────────────────────────────────────────────
//
// `database/proposals/` er BEVIDST uden for auto-migrate-globben
// (`find database -maxdepth 1`). Mappen findes efter hændelsen 18/7-2026, hvor
// en backfill markeret "IKKE KØRT — forberedt til ejer-review" blev committet
// som `database/2026-*.sql` og auto-applied ~3 min efter merge. Den beskyttelse
// skal bevares — dette script ændrer den ikke.
//
// Reglen i `database/proposals/README.md` er klar: **når ejeren godkender,
// flyttes filen til top-niveau i en PR — merge = kørsel.** Problemet er at intet
// håndhæver eller opdager at reglen brydes. Bliver et forslag anvendt i hånden
// (MCP, Studio, psql) uden at filen flyttes, ser det bagefter nøjagtig ud som
// et uanvendt udkast. Mappen holder op med at fortælle sandheden.
//
// Det kostede #3765: `apply_race_results_batch` blev anvendt i hånden fra
// `proposals/`, men kun CREATE-delen kom med — de to REVOKE-linjer nederst i
// filen blev aldrig kørt. Funktionen stod anon-kaldbar i ni dage. Filen så
// uskyldig ud, fordi et halvt anvendt forslag og et uanvendt udkast er umulige
// at skelne uden at spørge databasen.
//
// Måling 14/8: **6 af 10 forslag var live i prod** mens de stadig lå som udkast.
//
// ── Hvad scriptet gør ────────────────────────────────────────────────────────
//
// Læser hver `database/proposals/*.sql`, trækker de objekter ud filen opretter
// (tabeller, indekser, funktioner, constraints), og udskriver ÉN SQL-forespørgsel
// der spørger prod om hvilke af dem der findes. Klassifikationen sker i SQL, så
// scriptet ikke behøver en Postgres-klient (repoet har ingen `pg`-dependency —
// backend/testdb kører PGlite).
//
//   0 objekter lever   → ægte udkast. Intet fund.
//   ALLE lever         → WARN: anvendt, men aldrig forfremmet. Filen lyver.
//   NOGLE lever        → CRITICAL: delvist anvendt. Det var #3765's tilstand.
//
// Filer der ikke erklærer nogen objekter (ren data-SQL, REVOKE/GRANT-only) kan
// ikke tjekkes på denne måde. De rapporteres eksplicit som INFO — et hul i
// dækningen skal kunne ses, ikke fortier sig som "ingen fund".
//
// Brug:
//   node scripts/proposals-reconcile.mjs            # udskriv SQL til stdout
//   node scripts/proposals-reconcile.mjs --list     # menneskelig oversigt over parsede objekter
//
// I CI: node scripts/proposals-reconcile.mjs | psql "$DB_URL" -tA -F '|'
// Kontrakt som scripts/db-health.sql: tom output = sundt. Kolonner:
// severity | check | detail.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROPOSALS_DIR = resolve(__dirname, "..", "database", "proposals");

// Kun objekt-typer vi kan slå entydigt op i pg_catalog. `create policy` er
// bevidst udeladt: policy-navne er kun unikke pr. tabel, så et navne-opslag
// alene ville give falske positiver.
const PATTERNS = [
  { kind: "table", re: /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi },
  { kind: "index", re: /\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([a-z0-9_]+)/gi },
  { kind: "function", re: /\bcreate\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)/gi },
  { kind: "constraint", re: /\badd\s+constraint\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)/gi },
];

// `inherits` og `if` fanges af regexerne fra hhv. `CREATE TABLE ... INHERITS (...)`
// og `ADD CONSTRAINT IF NOT EXISTS`-varianter. De er SQL-nøgleord, ikke objekter.
const SQL_KEYWORDS = new Set(["inherits", "if", "not", "exists", "only", "concurrently"]);

export function extractObjects(sql) {
  const out = [];
  const seen = new Set();
  // Fjern linjekommentarer først: proposals-filerne har lange headere der ofte
  // citerer den SQL de beskriver, og et citat er ikke en erklæring.
  const code = sql.replace(/^\s*--.*$/gm, "");
  for (const { kind, re } of PATTERNS) {
    for (const m of code.matchAll(re)) {
      const name = m[1].toLowerCase();
      if (SQL_KEYWORDS.has(name)) continue;
      const key = `${kind}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, name });
    }
  }
  return out;
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function buildSql(entries) {
  const rows = entries.flatMap(({ file, objects }) =>
    objects.map((o) => `    (${sqlLiteral(file)}, ${sqlLiteral(o.kind)}, ${sqlLiteral(o.name)})`),
  );
  const uncheckable = entries.filter((e) => e.objects.length === 0).map((e) => e.file);

  const infoRows = uncheckable.length
    ? `
select 'INFO' as severity,
       'proposal_not_checkable' as check,
       ${sqlLiteral(uncheckable.join(", "))} || ' — erklaerer ingen tabeller/indekser/funktioner/constraints (ren data- eller grant-SQL). Kan ikke afgoeres automatisk; gennemgaa i haanden.' as detail
`
    : "";

  if (rows.length === 0) {
    return `${infoRows.trim() || "select null::text as severity, null::text as check, null::text as detail where false"};\n`;
  }

  return `-- Genereret af scripts/proposals-reconcile.mjs — rediger ikke i haanden.
with declared(file, kind, name) as (
  values
${rows.join(",\n")}
),
checked as (
  select d.file, d.kind, d.name,
         case d.kind
           when 'table'      then to_regclass('public.' || d.name) is not null
           when 'index'      then exists (select 1 from pg_indexes
                                          where schemaname = 'public' and indexname = d.name)
           when 'function'   then exists (select 1 from pg_proc p
                                          join pg_namespace n on n.oid = p.pronamespace
                                          where n.nspname = 'public' and p.proname = d.name)
           when 'constraint' then exists (select 1 from pg_constraint where conname = d.name)
         end as live
  from declared d
),
agg as (
  select file,
         count(*) as n,
         count(*) filter (where live) as n_live,
         string_agg(kind || ' ' || name, ', ') filter (where live)     as live_objects,
         string_agg(kind || ' ' || name, ', ') filter (where not live) as missing_objects
  from checked group by file
)
select case when n_live = n then 'WARN' else 'CRITICAL' end as severity,
       case when n_live = n then 'proposal_applied_not_promoted'
                            else 'proposal_partially_applied' end as check,
       file || ' — ' || n_live || '/' || n || ' objekter lever i prod'
         || case when n_live = n
                 then '. Forslaget er anvendt, men ligger stadig som udkast. ADVARSEL: at objekterne findes beviser at scriptet STARTEDE, ikke at det koerte faerdigt — en datareparation kan have oprettet sit backup-bord og vaere stoppet foer sin UPDATE. Verificer filens EFFEKT foer du forfremmer den; registrer derefter i schema_migrations og flyt filen, saa auto-migrate springer den over.'
                 else '. DELVIST anvendt — samme tilstand som #3765. Lever: ' || coalesce(live_objects,'-')
                      || '. Mangler: ' || coalesce(missing_objects,'-')
                      || '. Afgoer om resten skal koeres, eller om det anvendte skal rulles tilbage.'
            end as detail
from agg
where n_live > 0
${infoRows ? `union all${infoRows}` : ""}
-- Positionel sortering: "check" er et reserveret ord i Postgres og kan ikke
-- staa bart i ORDER BY, selvom det er et gyldigt kolonne-alias i SELECT-listen.
order by 1, 2;
`;
}

async function main() {
  const files = (await readdir(PROPOSALS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const entries = [];
  for (const file of files) {
    const sql = await readFile(join(PROPOSALS_DIR, file), "utf8");
    entries.push({ file, objects: extractObjects(sql) });
  }

  if (process.argv.includes("--list")) {
    for (const { file, objects } of entries) {
      console.log(`${file}`);
      if (objects.length === 0) console.log("  (ingen objekter — ren data-/grant-SQL, ikke automatisk tjekbar)");
      for (const o of objects) console.log(`  ${o.kind} ${o.name}`);
    }
    console.log(`\n${entries.length} fil(er), ${entries.reduce((n, e) => n + e.objects.length, 0)} objekt(er).`);
    return;
  }

  process.stdout.write(buildSql(entries));
}

if (process.argv[1]?.endsWith("proposals-reconcile.mjs")) await main();
