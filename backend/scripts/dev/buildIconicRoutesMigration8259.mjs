// #8830 / #8259: skriver database/2026-11-26-8259-iconic-fixed-routes.sql ud fra
// iconicRouteSeedEntries8259(), saa migrationen og JS-kilden aldrig kan glide fra hinanden.
// iconicRoutes8259.test.js holder filen lig med outputtet herfra.
//
// BRUG (fra repo-roden): node backend/scripts/dev/buildIconicRoutesMigration8259.mjs [--check]
//   --check  skriv intet; exit 1 hvis filen ikke matcher.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { iconicRouteSeedEntries8259 } from "../../lib/iconicRoutes8259.js";
import { MINI_SQUADS, miniEditionExternalId } from "../../lib/youthMiniEditions7471.js";

const here = dirname(fileURLToPath(import.meta.url));
export const ICONIC_ROUTES_MIGRATION_PATH = join(here, "../../../database/2026-11-26-8259-iconic-fixed-routes.sql");

const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Migrationens fulde tekst (deterministisk). */
export function buildIconicRoutesMigrationSql(entries = iconicRouteSeedEntries8259()) {
  const values = entries.map((e) => `  (${sqlString(e.external_id)}, ${sqlString(JSON.stringify(e.authored_route))}::jsonb)`).join(",\n");
  return `-- #8259 / #8830 (ejer 26/11): de ${entries.length} faste, haandlavede ruter for de ikoniske
-- endagsloeb (Ardennerne og de kendte klassikere i D1-D4) skrives paa race_pool.authored_route,
-- som monumenterne har i dag. Ungdomsudgaverne (#7471, external_id med U23/junior-praefiks)
-- faar samme rute; generatoren skalerer den ved generering (U23 75 %, junior 60 %,
-- youthMiniEditions7471.js).
--
-- GENERERET af backend/scripts/dev/buildIconicRoutesMigration8259.mjs fra
-- iconicRouteSeedEntries8259(); ret i JS og generer igen, aldrig i haanden.
--
-- Idempotent: opdaterer kun raekker hvis rute afviger (IS DISTINCT FROM). Ingen raekker
-- oprettes eller slettes. Kun endagsloeb (race_type = 'single') roeres.
-- Applies post-merge (auto-migrate.yml). Post-verify:
--   SELECT count(*) FROM public.race_pool WHERE authored_route IS NOT NULL AND race_class <> 'Monuments';
BEGIN;
SET LOCAL lock_timeout = '3s';

WITH routes(senior_external_id, route) AS (VALUES
${values}
),
targets AS (
  SELECT r.senior_external_id AS external_id, r.route FROM routes r
  UNION ALL
  SELECT p.prefix || r.senior_external_id, r.route FROM routes r
  CROSS JOIN (VALUES ${MINI_SQUADS.map((sq) => `(${sqlString(miniEditionExternalId("", sq))})`).join(", ")}) AS p(prefix)
)
UPDATE public.race_pool rp
SET authored_route = t.route
FROM targets t
WHERE rp.external_id = t.external_id
  AND rp.race_type = 'single'
  AND rp.authored_route IS DISTINCT FROM t.route;

COMMIT;
NOTIFY pgrst, 'reload schema';
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sql = buildIconicRoutesMigrationSql();
  if (process.argv.includes("--check")) {
    let cur = "";
    try { cur = readFileSync(ICONIC_ROUTES_MIGRATION_PATH, "utf8"); } catch { /* mangler */ }
    if (cur.replace(/\r\n/g, "\n") !== sql) { console.error("migrationen matcher ikke JS-kilden - koer uden --check"); process.exit(1); }
    console.log("migrationen matcher JS-kilden");
  } else {
    writeFileSync(ICONIC_ROUTES_MIGRATION_PATH, sql);
    console.log(`skrev ${ICONIC_ROUTES_MIGRATION_PATH}`);
  }
}
