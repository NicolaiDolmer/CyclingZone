// #4123 — kompakt, deterministisk "gylden" repræsentation af den offline S3-kalender
// (backend/scripts/dev/lib/s3OfflineCalendarPlan.mjs), til commit + CI-diff.
//
// FORMÅL: enhver PR der rører pakkeren/generatoren viser sin fulde konsekvens som en
// LÆSBAR diff — hvilke løb flyttede sig, hvilke dage ændrede form — i stedet for at et
// menneske skal køre en dry-run i hånden og eyeballe tallene (det var præcis den
// arbejdsgang der lod #3546's bytte-mekanisme bryde GT-real-day-separationen uopdaget,
// jf. #4123's issue-tekst).
//
// FORM. Én pulje pr. tier er repræsentativ (§2.276-invarianten, verificeret af
// eksisterende tests). Snapshottet er derfor PR. TIER, ikke pr. pulje:
//   { tier, løb: [{ navn, klasse, type, etaper: N }], dage: [{ dato, game_days: [...],
//     etaper: [{ løb, etapenummer, game_day }] }] }
// Sorteret deterministisk (dato, så game_day, så løbsnavn) så to kørsler med samme kode
// giver byte-identisk JSON — ellers ville diff'en vise støj fra Map-iterationsrækkefølge
// i stedet for ægte ændringer.
//
// Refs #4123 #4218 #4121

import { buildS3OfflineCalendarPlan } from "./s3OfflineCalendarPlan.mjs";

/**
 * @returns {{genereret: {firstDay: string, lastDay: string, realDays: number},
 *   tiers: Array<{tier: number, løb: number, etaper: number, dage: Array<{dato: string,
 *   etaper: Array<{løb: string, etapenummer: number, game_day: number}>}>}>}}
 */
export function buildCalendarGoldenSnapshot() {
  const { tierPlans, firstDay, lastDay, realDays } = buildS3OfflineCalendarPlan();

  const tiers = tierPlans.map((plan) => {
    const pool = (plan.pools ?? [])[0] ?? { raceRows: [], stageRows: [] };
    const meta = new Map((pool.raceRows ?? []).map((r) => [r.pool_race_id, r]));

    const byDate = new Map(); // "YYYY-MM-DD" -> stage-rækker
    for (const s of pool.stageRows ?? []) {
      const dato = String(s.scheduled_at).slice(0, 10);
      if (!byDate.has(dato)) byDate.set(dato, []);
      byDate.get(dato).push({
        løb: meta.get(s.pool_race_id)?.name ?? `(ukendt ${s.pool_race_id})`,
        etapenummer: s.stage_number,
        game_day: s.game_day,
      });
    }

    const dage = [...byDate.keys()].sort().map((dato) => ({
      dato,
      etaper: byDate.get(dato)
        .slice()
        .sort((a, b) => a.game_day - b.game_day || a.løb.localeCompare(b.løb))
        .map((e) => ({ løb: e.løb, etapenummer: e.etapenummer, game_day: e.game_day })),
    }));

    return {
      tier: plan.tier,
      løb: (pool.raceRows ?? []).length,
      etaper: (pool.stageRows ?? []).length,
      dage,
    };
  }).sort((a, b) => a.tier - b.tier);

  return { genereret: { firstDay, lastDay, realDays }, tiers };
}

/**
 * Læsbar diff mellem to snapshots, til fejlbeskeder og PR-kommentarer. Rapporterer på
 * tier-niveau: hvilke datoer der har fået/mistet etaper, og løb-tælling pr. tier — nok
 * til at se HVAD der flyttede sig uden at dumpe hele JSON'en.
 * @returns {string[]} linjer, tom hvis identiske
 */
export function diffCalendarGoldenSnapshots(gylden, ny) {
  const linjer = [];
  const tiersGylden = new Map(gylden.tiers.map((t) => [t.tier, t]));
  const tiersNy = new Map(ny.tiers.map((t) => [t.tier, t]));
  const alleTiers = [...new Set([...tiersGylden.keys(), ...tiersNy.keys()])].sort((a, b) => a - b);

  for (const tier of alleTiers) {
    const g = tiersGylden.get(tier);
    const n = tiersNy.get(tier);
    if (!g) { linjer.push(`tier ${tier}: ny i den regenererede kalender (fandtes ikke i den gyldne)`); continue; }
    if (!n) { linjer.push(`tier ${tier}: forsvundet fra den regenererede kalender`); continue; }
    if (g.løb !== n.løb) linjer.push(`tier ${tier}: løb ${g.løb} → ${n.løb}`);
    if (g.etaper !== n.etaper) linjer.push(`tier ${tier}: etaper ${g.etaper} → ${n.etaper}`);

    const gDage = new Map(g.dage.map((d) => [d.dato, d]));
    const nDage = new Map(n.dage.map((d) => [d.dato, d]));
    const alleDatoer = [...new Set([...gDage.keys(), ...nDage.keys()])].sort();
    for (const dato of alleDatoer) {
      const gd = gDage.get(dato);
      const nd = nDage.get(dato);
      if (!gd) { linjer.push(`tier ${tier} ${dato}: ny dag (${nd.etaper.length} etaper)`); continue; }
      if (!nd) { linjer.push(`tier ${tier} ${dato}: dagen forsvandt (havde ${gd.etaper.length} etaper)`); continue; }
      const gJson = JSON.stringify(gd.etaper);
      const nJson = JSON.stringify(nd.etaper);
      if (gJson !== nJson) {
        const gNavne = gd.etaper.map((e) => `${e.løb}#${e.etapenummer}`).join(", ");
        const nNavne = nd.etaper.map((e) => `${e.løb}#${e.etapenummer}`).join(", ");
        linjer.push(`tier ${tier} ${dato}: [${gNavne}] → [${nNavne}]`);
      }
    }
  }
  return linjer;
}
