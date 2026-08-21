// READ-ONLY genmåling af #3459-stop-grænsen i RÅ LOFT-ENHEDER (post-#3666-enhed).
// Skriver INTET til databasen og har ingen credentials — input er en JSON-fil
// med AI-rytternes nuværende tilstand, hentet read-only (MCP/psql) med:
//
//   select r.id, r.birthdate, r.potentiale, r.primary_type, r.secondary_type,
//          r.archetype_draw, d.ability_caps, d.<VISIBLE_ABILITIES-kolonnerne>
//   from riders r join rider_derived_abilities d on d.rider_id = r.id
//   join teams t on t.id = r.team_id
//   where t.is_ai = true and r.retired_at is null;
//
// Brug:
//   node scripts/dev/remeasureGate3459.mjs <sti-til-json> <sæsonnummer>
//
// Gate (drejebogens verifikationspunkt 4, genmålt 21/8): forventet 0 ændrede
// lofter. Stop hvis >1 % af AI-populationen har bedste-af-8-delta ≠ 0, eller
// p10 < −5 loft-point. Baseline-måling 21/8: 2.961 ryttere, 0 ændrede.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..", "..");
const toFileUrl = (p) => pathToFileURL(path.join(REPO, p)).href;

const { buildCapsForRider } = await import(toFileUrl("backend/lib/riderProgression.js"));
const { VISIBLE_ABILITIES } = await import(toFileUrl("backend/lib/abilityDerivation.js"));
const { ageForSeason } = await import(toFileUrl("backend/lib/riderSeasonAge.js"));
const { percentileSummary, capSum, topNMean } = await import(toFileUrl("backend/scripts/lib/cutover3645.js"));

const [inputPath, seasonArg] = process.argv.slice(2);
if (!inputPath || !seasonArg) {
  console.error("Brug: node scripts/dev/remeasureGate3459.mjs <sti-til-json> <sæsonnummer>");
  process.exit(2);
}
const SEASON_NUMBER = Number(seasonArg);
if (!Number.isInteger(SEASON_NUMBER) || SEASON_NUMBER < 1) {
  console.error(`Ugyldigt sæsonnummer: ${seasonArg}`);
  process.exit(2);
}

const rows = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));
console.log(`Ryttere indlæst: ${rows.length} · sæson ${SEASON_NUMBER}`);

const deltaCapSums = [];
const deltaTop8s = [];
let capsIdentical = 0;
let capsChanged = 0;
let missingCurrentCaps = 0;

for (const r of rows) {
  const baseline = {};
  for (const k of VISIBLE_ABILITIES) if (r[k] != null) baseline[k] = Number(r[k]);

  // Samme type-valg som backfillCores.js: archetype_draw vinder hvis den findes.
  const draw = r.archetype_draw;
  const primaryType = (draw && draw.primary) ? draw.primary : r.primary_type;
  const secondaryType = (draw && draw.primary) ? (draw.secondary || null) : r.secondary_type;

  const age = ageForSeason(r.birthdate, SEASON_NUMBER);
  const newCaps = buildCapsForRider(baseline, { potentiale: r.potentiale, age }, primaryType, secondaryType);

  const currentCaps = r.ability_caps;
  if (!currentCaps || typeof currentCaps !== "object") {
    missingCurrentCaps++;
    continue;
  }

  const identical = VISIBLE_ABILITIES.every((k) => Number(newCaps[k]) === Number(currentCaps[k]));
  if (identical) {
    capsIdentical++;
  } else {
    capsChanged++;
    deltaCapSums.push(capSum(newCaps, VISIBLE_ABILITIES) - capSum(currentCaps, VISIBLE_ABILITIES));
    deltaTop8s.push(topNMean(newCaps, VISIBLE_ABILITIES, 8) - topNMean(currentCaps, VISIBLE_ABILITIES, 8));
  }
}

console.log(`\nRækker uden gemte caps (sprunget over): ${missingCurrentCaps}`);
console.log(`Lofter identiske med ny formel : ${capsIdentical}`);
console.log(`Lofter der ville ÆNDRE sig      : ${capsChanged}  (${(100 * capsChanged / Math.max(1, capsChanged + capsIdentical)).toFixed(1)}%)`);

const fmt = (s, label, unit) => {
  if (!s.n) { console.log(`${label}: ingen ændrede rækker.`); return; }
  console.log(`${label} (${unit}, NY minus NUVÆRENDE — negativ = tab ved flip):`);
  console.log(`   n ${s.n} · min ${s.min.toFixed(2)} · p10 ${s.p10.toFixed(2)} · p50 ${s.p50.toFixed(2)} · p90 ${s.p90.toFixed(2)} · max ${s.max.toFixed(2)} · snit ${s.mean.toFixed(2)}`);
};

console.log("");
fmt(percentileSummary(deltaCapSums), "Loft-sum-delta", `sum over ${VISIBLE_ABILITIES.length} evner`);
fmt(percentileSummary(deltaTop8s), "Bedste-af-8-delta", "snit af de 8 højeste lofter");

const lossCount = deltaTop8s.filter((d) => d < 0).length;
const changedShareOfAll = rows.length ? (100 * capsChanged / rows.length) : 0;
console.log(`\nAndel med TAB i bedste-af-8: ${lossCount}/${deltaTop8s.length} · ændrede i alt: ${changedShareOfAll.toFixed(1)}% af alle AI-ryttere`);

const gateBroken = changedShareOfAll > 1 || (deltaTop8s.length && percentileSummary(deltaTop8s).p10 < -5);
console.log(gateBroken ? "\nGATE RØD: divergens fundet — flip IKKE uden ny undersøgelse." : "\nGATE GRØN: ingen divergens over grænsen.");
process.exit(gateBroken ? 1 : 0);
