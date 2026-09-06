// backend/scripts/lib/headToHeadTeamPlay.js
// Race Engine v4 M16 (#4246): HOLDSPILS-MAALINGEN til head-to-head-harnesset.
//
// HVORFOR ET EGET MAAL og ikke bare et anker: scorecardets holddominans-anker
// (`same_team_top10_share_4plus`) er en REGRESSIONSVAGT mod det MODSATTE
// problem — at ét hold besaetter top-10. Baade v3 og v4 laa paa 0,0 % foer og
// efter M16-wiringen, dvs. ankeret ligger paa sit gulv og kan hverken
// bekraefte eller afkraefte at holdspillet virker. Praecis samme fund som
// #4885 gjorde om hale-spredningen: "et anker-tal kan derfor hverken
// bekraefte eller afkraefte det".
//
// Det maal DER kan: den gennemsnitlige placering pr. ROLLE. v3's to
// holdspils-kanaler (raceSimulator.teamComponent + raceRoles.workCost) giver
// den beskyttede rytter en bedre gennemsnitsplacering end sine hjaelpere,
// UD OVER hvad evneforskellen alene giver. Den afstand er tallet v4 skal
// reproducere ved flip. Maales pr. motor paa PRAECIS samme etaper, felt,
// roller og seeds, saa de to tal er direkte sammenlignelige.
//
// EVNE-KONTROLLEN er hele pointen: en kaptajn er per konstruktion holdets
// staerkeste rytter (headToHeadOrders.assignTeamRoles vaelger ham paa evne),
// saa han ville staa bedst ogsaa uden holdspil. Derfor rapporteres BAADE den
// raa gennemsnitsplacering OG placeringen relativt til rytterens EGEN
// evne-rang i feltet ("over/under forventet"): det er dén stoerrelse
// holdspillet kan flytte, og den er nul for en motor uden holdspil.
//
// 100% READ-ONLY: rene funktioner over harnessets egne rows. Ingen DB, ingen
// fs, ingen rng.

/** Roller vi rapporterer separat. Raekkefoelgen er rapportens raekkefoelge. */
export const REPORTED_ROLES = Object.freeze([
  "captain",
  "sprint_captain",
  "helper",
  "hunter",
  "free_role",
]);

function mean(values) {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * Evne-rang i feltet (1 = bedst) ud fra etapens demand_vector-vaegtede
 * evne-sum. Bevidst den SAMME simple vaegtning for begge motorer: maalet er
 * ikke at forudsige placeringen praecist, men at give en NEUTRAL forventning
 * som begge motorer maales mod. Ties brydes paa rider_id (determinisme).
 *
 * @param {Array<{rider_id: string}>} riderIds
 * @param {Map<string, Record<string, number>>} abilitiesByRider
 * @param {Record<string, number>} demandVector
 * @returns {Map<string, number>} rider_id -> evne-rang, 1-baseret
 */
export function abilityRankInField(riderIds, abilitiesByRider, demandVector) {
  const scored = riderIds.map((riderId) => {
    const abilities = abilitiesByRider.get(riderId) ?? {};
    let score = 0;
    for (const [key, weight] of Object.entries(demandVector ?? {})) {
      const value = Number(abilities[key]);
      if (Number.isFinite(value) && Number.isFinite(weight)) score += value * weight;
    }
    return { riderId, score };
  });
  scored.sort((a, b) => b.score - a.score || a.riderId.localeCompare(b.riderId));
  return new Map(scored.map((entry, index) => [entry.riderId, index + 1]));
}

/** Tom akkumulator pr. rolle. */
function emptyAcc() {
  const byRole = {};
  for (const role of REPORTED_ROLES) byRole[role] = { ranks: [], deltas: [] };
  return { byRole, stages: 0, fieldRiders: 0 };
}

function addObservation(acc, role, rank, abilityRank) {
  const bucket = acc.byRole[role];
  if (!bucket) return;
  bucket.ranks.push(rank);
  // POSITIV delta = bedre end evnen alene forudsiger (rykket FREM).
  bucket.deltas.push(abilityRank - rank);
}

/**
 * Maaler holdspils-effekten pr. motor over harnessets rows.
 *
 * @param {Array<object>} rows runHeadToHead()-rows (kraever `raw` + `raw.roles`)
 * @param {{abilitiesByRider: Map<string, Record<string, number>>}} deps
 * @returns {{v3: object, v4: object}}
 */
export function measureTeamPlay(rows, { abilitiesByRider }) {
  const v3 = emptyAcc();
  const v4 = emptyAcc();

  for (const row of rows) {
    const roles = row.raw?.roles;
    // Uden roller (orders=none) er der intet holdspil at maale — spring over
    // i stedet for at rapportere alle som free_role, hvilket ville se ud som
    // "holdspillet virker ikke".
    if (!roles || roles.size === 0) continue;

    const demandVector = row.raw.stageRow?.demand_vector ?? {};
    const v3Ranked = row.raw.v3Output?.ranked ?? [];
    const v4Results = row.raw.v4Output?.results ?? [];
    const fieldIds = v4Results.map((r) => r.rider_id);
    if (fieldIds.length === 0) continue;
    const abilityRank = abilityRankInField(fieldIds, abilitiesByRider, demandVector);

    v3.stages += 1;
    v4.stages += 1;
    v3.fieldRiders += v3Ranked.length;
    v4.fieldRiders += v4Results.length;

    for (const r of v3Ranked) {
      const role = roles.get(r.rider_id);
      if (role) addObservation(v3, role, r.rank, abilityRank.get(r.rider_id) ?? r.rank);
    }
    for (const r of v4Results) {
      const role = roles.get(r.rider_id);
      if (role) addObservation(v4, role, r.rank, abilityRank.get(r.rider_id) ?? r.rank);
    }
  }

  return { v3: summarize(v3), v4: summarize(v4) };
}

function summarize(acc) {
  const byRole = {};
  for (const role of REPORTED_ROLES) {
    const bucket = acc.byRole[role];
    byRole[role] = {
      n: bucket.ranks.length,
      meanRank: mean(bucket.ranks),
      meanDelta: mean(bucket.deltas),
    };
  }
  // NOEGLETALLET: afstanden mellem den beskyttede rytter og hans hjaelpere,
  // maalt i "pladser bedre end evnen alene forudsiger". Nul = motoren har
  // intet holdspil; positiv = beskyttelsen virker.
  const captain = byRole.captain.meanDelta;
  const sprintCaptain = byRole.sprint_captain.meanDelta;
  const helper = byRole.helper.meanDelta;
  const leader = [captain, sprintCaptain].filter((v) => v !== null);
  const leaderDelta = leader.length > 0 ? mean(leader) : null;
  return {
    stages: acc.stages,
    byRole,
    leaderDelta,
    helperDelta: helper,
    protectionGap: leaderDelta !== null && helper !== null ? leaderDelta - helper : null,
  };
}

function fmt(value, decimals = 2) {
  return value === null || !Number.isFinite(value) ? "n/a" : value.toFixed(decimals);
}

/** Laesbar rapport (samme stil som formatOrderEffect/formatIncidentSummary). */
export function formatTeamPlay({ v3, v4 }) {
  const lines = [];
  lines.push("-- Holdspil (M16): placering pr. rolle, v3 mod v4 --");
  lines.push(`Etaper med roller: ${v4.stages}`);
  lines.push("(delta = pladser BEDRE end rytterens egen evne-rang i feltet forudsiger; 0 = motoren har intet holdspil)");
  lines.push("rolle             v3 gns.plads  v3 delta   v4 gns.plads  v4 delta");
  for (const role of REPORTED_ROLES) {
    const a = v3.byRole[role];
    const b = v4.byRole[role];
    if (a.n === 0 && b.n === 0) continue;
    lines.push(
      `${role.padEnd(18)}${fmt(a.meanRank, 1).padStart(12)}${fmt(a.meanDelta).padStart(11)}` +
        `${fmt(b.meanRank, 1).padStart(15)}${fmt(b.meanDelta).padStart(10)}`,
    );
  }
  lines.push(
    `Beskyttelses-gab (leder minus hjaelper): v3 ${fmt(v3.protectionGap)} · v4 ${fmt(v4.protectionGap)}`,
  );
  return lines.join("\n");
}
