// scripts/preflight-season-cutover-structure.mjs
// #6795: preflight-season-cutover.ps1's kalender-SQL ma ikke vise puljer der pensioneres
// ved skiftet som kalenderhuller. Bygges naeste saesons kalender med --target-structure
// (#5795), har D4 E-H stadig retired_at IS NULL og ingen loeb, indtil "Afslut saeson" har
// koert retireD4PoolsS4.js. Samme pool_index/maalstruktur-regel som
// backend/lib/calendarTargetStructure.js bruges her: strukturens tier og antal aktive
// puljer LAESES fra CALENDAR_TARGET_STRUCTURES (ikke kopieret), og "hvilke puljer anvendes
// paa" afgoeres af targetStructureUsageError (kun senior, kun fra strukturens foerste
// saeson).
//
// Reglen er idempotent og klassificerer paa pool_index, ikke retired_at: efter
// pensioneringen giver SQL'en samme svar (de pensionerede puljer taeller stadig med i
// raekkefoelgen, som i resolveCutoverPoolRetirement). Derfor virker samme preflight foer og
// efter skiftet, og den rammer ikke overgange hvor ingen pulje pensioneres.
//
// Ren modul + lille CLI: ingen I/O mod DB. CLI (bruges af preflight-season-cutover.ps1):
//   node scripts/preflight-season-cutover-structure.mjs <toSeasonNumber>
// udskriver CTE'en `senior_pools` (id, label, tier, pool_index, retired_at, ...,
// pensioneres_ved_skiftet) som SQL-blokkene i preflighten bygger videre paa.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CALENDAR_TARGET_STRUCTURES,
  targetStructureUsageError,
} from "../backend/lib/calendarTargetStructure.js";

/**
 * De maalstrukturer der gaelder for kalenderen i `toSeasonNumber` (senior).
 * @param {number} toSeasonNumber
 * @returns {Array<{ key: string, tier: number, activePools: number }>}
 */
export function applicableTargetStructures(toSeasonNumber) {
  return Object.values(CALENDAR_TARGET_STRUCTURES)
    .filter((structure) => targetStructureUsageError({ structure, seasonNumber: toSeasonNumber, squad: "senior" }) === null)
    .map(({ key, tier, activePools }) => ({ key, tier, activePools }));
}

/**
 * SQL-boolean: "denne pulje pensioneres ved skiftet". Seniorens puljer i strukturens tier
 * (alle, ogsaa allerede pensionerede) sorteres paa pool_index; de foerste `activePools`
 * beholdes, resten pensioneres. `false` naar ingen struktur gaelder for saesonen.
 */
export function cutoverRetirementSqlCondition(toSeasonNumber) {
  const conditions = applicableTargetStructures(toSeasonNumber).map(
    ({ tier, activePools }) =>
      `(d.tier = ${Number(tier)} and row_number() over (partition by d.tier order by d.pool_index) > ${Number(activePools)})`,
  );
  return conditions.length ? conditions.join(" or ") : "false";
}

/**
 * CTE med seniorens puljer + flaget pensioneres_ved_skiftet. Window-funktionen skal koere
 * FOER retired_at-filteret (pensionerede puljer taeller med i raekkefoelgen), derfor
 * ligger `retired_at is null` ikke her, men i de SQL-blokke der bruger CTE'en.
 */
export function seniorPoolsCte(toSeasonNumber) {
  return [
    "with senior_pools as (",
    "  select d.*,",
    `         (${cutoverRetirementSqlCondition(toSeasonNumber)}) as pensioneres_ved_skiftet`,
    "  from league_divisions d",
    "  where coalesce(d.squad, 'senior') = 'senior'",
    ")",
  ].join("\n");
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const toSeasonNumber = Number(process.argv[2]);
  if (!Number.isInteger(toSeasonNumber) || toSeasonNumber < 1) {
    console.error("usage: node scripts/preflight-season-cutover-structure.mjs <toSeasonNumber>");
    process.exit(2);
  }
  console.log(seniorPoolsCte(toSeasonNumber));
}
