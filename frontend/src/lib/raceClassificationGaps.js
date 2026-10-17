// #6384 — tidsforskel til føreren i ungdoms- og holdklassementet i etapeløb.
//
// Kun visningslag, ingen motor-ændring. Motoren persisterer "+M:SS"-gabet på
// GC-rækker (leader/gc) og på etape-rækker, men ikke på young/team-rækkerne
// (kun rank). Tiden findes dog i de allerede gemte data, så den afledes her:
//
//  - Ungdom: rangeres på samme kumulative tid som GC, så ungdomsgabet er
//    rytterens GC-gab minus ungdomsførerens GC-gab.
//  - Hold: summen af holdets 3 bedste ryttertider (kun ryttere der har kørt
//    ALLE etaper, som backendens filterCompletedEntrants), lavest vinder. Under
//    official_times_v3 (#6338) uden bonussekunder, ellers med.
//
// SSOT-ADVARSEL: tællereglen spejler backend/lib/raceClassifications.js
// (teamClassification, accumulateStageRows, teamClassificationTime). Parity-
// testen i raceClassificationGaps.test.js importerer begge og holder dem ens.
// Rangordenen er altid motorens egen; her udregnes kun gabet. Passer den
// udregnede orden ikke med de gemte placeringer, vises intet gab hellere end
// et forkert et.

// #6464: official_times_v4 er hele official_times_v3-pakken (backend
// sharedTimeModelGeneration), så den tæller også uden bonussekunder.
// #6369: s5_profiles_v1 (slukket, tom) er hele official_times_v4-pakken.
// #6462: official_times_v5 (slukket) er hele official_times_v4-pakken + togreglen.
export const REVISIONS_WITHOUT_TEAM_BONUS = new Set(["official_times_v3", "official_times_v4", "s5_profiles_v1", "official_times_v5"]);

/** Spejler backend isOfficialTimesV3OrLater. Ukendt/null revision = ældre regler. */
export function isOfficialTimesV3OrLater(revision) {
  return REVISIONS_WITHOUT_TEAM_BONUS.has(revision);
}

/** "+M:SS" — samme format som motorens formatGap, så kolonnen ser ens ud. */
export function formatGap(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "+M:SS" → sekunder, ellers null (tom/uparsebar tid er ukendt, ikke 0). */
export function gapSeconds(finishTime) {
  if (typeof finishTime !== "string") return null;
  const m = /^\+?(\d+):(\d{1,2})$/.exec(finishTime);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Ungdomsgab pr. rytter: GC-gab minus ungdomsførerens GC-gab.
 * @returns {Map<string,string>} rider_id → "+M:SS"
 */
export function youthGaps(gcRows, youngRows) {
  const out = new Map();
  const gcByRider = new Map();
  for (const r of gcRows || []) {
    const s = gapSeconds(r.finish_time);
    if (r.rider_id && s != null) gcByRider.set(r.rider_id, s);
  }
  const ranked = [...(youngRows || [])].filter((r) => r.rider_id).sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
  const leader = ranked.length ? gcByRider.get(ranked[0].rider_id) : undefined;
  if (leader == null) return out;
  let previous = leader;
  for (const r of ranked) {
    const own = gcByRider.get(r.rider_id);
    if (own == null || own < previous) return new Map(); // ukonsistent orden: intet gab
    previous = own;
    out.set(r.rider_id, formatGap(own - leader));
  }
  return out;
}

/**
 * Holdgab pr. hold fra etaperækkerne ("stage"-rækker med finish_time,
 * team_id, bonus_seconds).
 * @param {object} p
 * @param {Array} p.stageRows
 * @param {Array} p.teamRows  holdklassementets rækker (rank, team_id)
 * @param {number|null} p.uptoStage  null = alle etaper
 * @param {string|null} p.revision  races.engine_rules_revision
 * @returns {Map<string,string>} team_id → "+M:SS"
 */
export function teamGaps({ stageRows, teamRows, uptoStage = null, revision = null }) {
  const out = new Map();
  const useRaw = isOfficialTimesV3OrLater(revision);
  const time = new Map();
  const stagesByRider = new Map();
  const teamOf = new Map();
  const stageNumbers = new Set();
  let anyTime = false;
  for (const r of stageRows || []) {
    if (r.result_type !== "stage" || !r.rider_id) continue;
    const stageNo = r.stage_number ?? 1;
    if (uptoStage != null && stageNo > uptoStage) continue;
    const parsed = gapSeconds(r.finish_time);
    if (parsed != null) anyTime = true;
    const gap = parsed ?? 0; // som backendens parseGapSeconds: tom tid = 0
    stageNumbers.add(stageNo);
    const bonus = useRaw ? 0 : Number(r.bonus_seconds) || 0;
    time.set(r.rider_id, (time.get(r.rider_id) || 0) + gap - bonus);
    if (!stagesByRider.has(r.rider_id)) stagesByRider.set(r.rider_id, new Set());
    stagesByRider.get(r.rider_id).add(stageNo);
    if (r.team_id) teamOf.set(r.rider_id, r.team_id);
  }
  if (!anyTime) return out; // gammelt PCM-løb uden tider: intet at regne på
  const byTeam = new Map();
  for (const [riderId, stages] of stagesByRider) {
    if (stages.size < stageNumbers.size) continue; // ikke fuldført alle etaper
    const teamId = teamOf.get(riderId);
    if (!teamId) continue;
    if (!byTeam.has(teamId)) byTeam.set(teamId, []);
    byTeam.get(teamId).push(time.get(riderId));
  }
  const total = new Map();
  for (const [teamId, times] of byTeam) {
    if (times.length < 3) continue;
    total.set(teamId, times.sort((a, b) => a - b).slice(0, 3).reduce((s, v) => s + v, 0));
  }
  const ranked = [...(teamRows || [])].filter((r) => r.team_id).sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
  if (!ranked.length) return out;
  const leader = total.get(ranked[0].team_id);
  if (leader == null) return out;
  let previous = leader;
  for (const r of ranked) {
    const own = total.get(r.team_id);
    if (own == null || own < previous) return new Map(); // ukonsistent orden: intet gab
    previous = own;
    out.set(r.team_id, formatGap(own - leader));
  }
  return out;
}

/**
 * Sæt gabet ind som finish_time på de rækker der ikke har en tid, så den
 * eksisterende gab-kolonne (ResultTable) viser det uden ny markup.
 * @param {Array} rows
 * @param {Map<string,string>} gaps
 * @param {"rider_id"|"team_id"} idKey
 */
export function withGaps(rows, gaps, idKey) {
  if (!rows?.length || !gaps?.size) return rows;
  return rows.map((r) => (r.finish_time || !gaps.has(r[idKey]) ? r : { ...r, finish_time: gaps.get(r[idKey]) }));
}

/**
 * Berig young- og team-rækkerne i et { gc, young, team, ... }-opslag.
 * @param {object} byType
 * @param {{stageRows:Array, uptoStage:number|null, revision:string|null}} ctx
 */
export function withClassificationGaps(byType, { stageRows, uptoStage = null, revision = null }) {
  if (!byType) return byType;
  const young = withGaps(byType.young, youthGaps(byType.gc, byType.young), "rider_id");
  const team = withGaps(byType.team, teamGaps({ stageRows, teamRows: byType.team, uptoStage, revision }), "team_id");
  return { ...byType, young, team };
}
