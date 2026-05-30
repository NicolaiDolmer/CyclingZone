// PCM-results-import-pipeline (#668).
//
// Tager én eller flere PCM-eksportfiler for ÉT løb, oversætter dem til
// race_results-rækker med korrekt point/præmie, og (når ikke dry-run)
// skriver dem via den delte applyRaceResults-path.
//
// === Scoring-model (bekræftet med Nicolai 2026-05-30) ===
//
// Endagsløb (titel "after stage 1/1"):
//   - General results → result_type "gc"  (→ Klassiker for race_type=single)
//   - Team results    → result_type "team" (→ KlassikerHold)
//   (Stage results er identisk med General for endagsløb → bruges IKKE,
//    ellers dobbelttælling.)
//
// Etapeløb, hver mellem-etape (current < total):
//   - Stage results → "stage" (Etapeplacering), alle ryttere
//   - Trøje-LEDERE (for at "holde trøjen" den dag):
//       General results rank 1 → "leader"       (Forertroje)
//       Points         rank 1 → "points_day"    (PointtrojeDag)
//       Mountain       rank 1 → "mountain_day"   (BjergtrojeDag)
//       Ungdoms-LEDER  (parens (1) i General Time) → "young_day" (UngdomstrojeDag)
//
// Etapeløb, sidste etape (current == total): hele klassementet udbetales
//   - Stage results → "stage"  (Etapeplacering) for selve etapen
//   - General results → "gc"    (Klassement), alle ryttere
//   - Points         → "points" (Pointtroje)
//   - Mountain       → "mountain" (Bjergtroje)
//   - Young (parens-rank) → "young" (Ungdomstroje)
//   - Team (parens-rank)  → "team"  (EtapelobHold)
//
// Point/præmie genbruger buildRacePointsLookup + PRIZE_PER_POINT (point×1500).
// race_points har kun seedet de scorende ranks (fx ProSeries: Etapeplacering
// 1-5, Klassement 1-40, trøjer 1-3); øvrige ranks → 0 point.

import {
  applyRaceResults as applyRaceResultsShared,
  buildRacePointsLookup,
  PRIZE_PER_POINT,
} from "./raceResultsEngine.js";
import { parsePcmWorkbook, headerIndex } from "./pcmResultsParser.js";
import { resolvePcmTeamName, PCM_TEAMS_WITHOUT_OWNER } from "./pcmTeamAliases.js";
import { buildRiderMatcher, buildTeamMatcher } from "./pcmRiderMatcher.js";
import { recomputeSeasonRaceDays } from "./seasonRaceDays.js";

// Normalisér løbsnavn til match mod DB-`races`.name. Folder accenter, sænker,
// erstatter tegnsætning med mellemrum. "Hauts-de-France" == "Hauts de France".
export function normalizeRaceName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Race-navn fra en PCM-arktitel: "RACE: Sheet after stage X/Y: desc" → "RACE".
export function raceNameFromTitle(title) {
  const s = String(title || "");
  const idx = s.indexOf(": ");
  return (idx >= 0 ? s.slice(0, idx) : s).trim();
}

// Udtræk GC-rank fra "General Time"-kolonnen i Young/Team-ark: "+ 43 (3)" → 3,
// "8h11'09 (1)" → 1. Disse ark er etape-sorterede; den rigtige klassements-
// placering står i parentes. Returnerer null hvis intet tal i parentes.
export function extractParensRank(generalTimeCell) {
  const m = /\((\d+)\)\s*$/.exec(String(generalTimeCell || "").trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isNaN(n) ? null : n;
}

function sheetByName(workbook, name) {
  const want = name.toLowerCase();
  return workbook.sheets.find((s) => s.name.toLowerCase() === want) || null;
}

// Træk (rank, name, team)-rækker ud af et individuelt resultat-ark.
// rankSource: "sheet" = brug Rank-kolonnen; "parens" = brug (N) i General Time.
function extractIndividualRows(sheet, { rankSource = "sheet" } = {}) {
  if (!sheet || !sheet.rows.length) return [];
  const ri = headerIndex(sheet.headers, "Rank");
  const ni = headerIndex(sheet.headers, "Name");
  const ti = headerIndex(sheet.headers, "Team");
  const gi = headerIndex(sheet.headers, "General Time");
  const out = [];
  for (const row of sheet.rows) {
    let rank;
    if (rankSource === "parens") {
      rank = extractParensRank(gi >= 0 ? row[gi] : "");
    } else {
      rank = Number.parseInt(row[ri], 10);
    }
    if (rank === null || Number.isNaN(rank)) continue;
    const name = ni >= 0 ? String(row[ni] || "").trim() : "";
    const team = ti >= 0 ? String(row[ti] || "").trim() : "";
    out.push({ rank, name, team });
  }
  return out;
}

// Træk hold-rækker ud af "Team results"-arket. Layout: Rank|Team|Time|General Time|Player.
// rankSource "parens" bruger (N) i General Time (etape-sorteret); "sheet" bruger Rank.
function extractTeamRows(sheet, { rankSource = "parens" } = {}) {
  if (!sheet || !sheet.rows.length) return [];
  const ri = headerIndex(sheet.headers, "Rank");
  const ti = headerIndex(sheet.headers, "Team");
  const gi = headerIndex(sheet.headers, "General Time");
  const out = [];
  for (const row of sheet.rows) {
    let rank;
    if (rankSource === "parens") {
      rank = extractParensRank(gi >= 0 ? row[gi] : "");
      if (rank === null) rank = Number.parseInt(row[ri], 10);
    } else {
      rank = Number.parseInt(row[ri], 10);
    }
    if (rank === null || Number.isNaN(rank)) continue;
    const team = ti >= 0 ? String(row[ti] || "").trim() : "";
    out.push({ rank, team });
  }
  return out;
}

// Byg race_results-rækker for ÉT løb ud fra dets sorterede etape-workbooks.
// raceFiles: [{ filename, workbook }] sorteret efter stageInfo.current.
// Returnerer { resultRows, perTypeCounts, leaders }.
export function buildPcmResultRows({ raceFiles, race, riderMatcher, teamMatcher, pointsLookup }) {
  const resultRows = [];
  const isSingle = race.race_type === "single";

  function pushIndividual({ resultType, rank, name, stageNumber }) {
    const matched = riderMatcher.match(name);
    const pts = pointsLookup[`${resultType}__${rank}`] || 0;
    resultRows.push({
      race_id: race.id,
      stage_number: stageNumber,
      result_type: resultType,
      rank,
      rider_id: matched.riderId,
      rider_name: name || null,
      team_id: matched.teamId, // ejer-hold udledes af rytter
      team_name: null,
      finish_time: null,
      points_earned: pts,
      prize_money: pts * PRIZE_PER_POINT,
      _match_status: matched.status, // intern; fjernes før insert
    });
  }

  function pushTeam({ resultType, rank, pcmTeamName, stageNumber }) {
    const gameName = resolvePcmTeamName(pcmTeamName);
    const m = teamMatcher.matchGameName(gameName);
    const pts = pointsLookup[`${resultType}__${rank}`] || 0;
    resultRows.push({
      race_id: race.id,
      stage_number: stageNumber,
      result_type: resultType,
      rank,
      rider_id: null,
      rider_name: null,
      team_id: m.teamId,
      team_name: pcmTeamName || null,
      finish_time: null,
      points_earned: pts,
      prize_money: pts * PRIZE_PER_POINT,
      _match_status: m.teamId
        ? "exact"
        : PCM_TEAMS_WITHOUT_OWNER.has(pcmTeamName)
          ? "no_owner"
          : "missing",
    });
  }

  if (isSingle) {
    // Endagsløb: ét workbook. General results = Klassiker; Team = KlassikerHold.
    const wb = raceFiles[0]?.workbook;
    if (wb) {
      const gc = sheetByName(wb, "General results");
      for (const r of extractIndividualRows(gc)) {
        pushIndividual({ resultType: "gc", rank: r.rank, name: r.name, stageNumber: 1 });
      }
      const team = sheetByName(wb, "Team results");
      for (const r of extractTeamRows(team, { rankSource: "sheet" })) {
        pushTeam({ resultType: "team", rank: r.rank, pcmTeamName: r.team, stageNumber: 1 });
      }
    }
    return finalize(resultRows);
  }

  // Etapeløb: gennemløb hver etape.
  for (const { workbook } of raceFiles) {
    const info = workbook.stageInfo;
    if (!info) continue;
    const stageNumber = info.current;

    // Stage results → Etapeplacering (hver etape, alle ryttere).
    const stage = sheetByName(workbook, "Stage results");
    for (const r of extractIndividualRows(stage)) {
      pushIndividual({ resultType: "stage", rank: r.rank, name: r.name, stageNumber });
    }

    if (!info.isFinalStage) {
      // Mellem-etape: kun trøje-LEDERE (rank 1 / parens(1)) for "at holde trøjen".
      const gc = sheetByName(workbook, "General results");
      const gcLeader = extractIndividualRows(gc).find((r) => r.rank === 1);
      if (gcLeader) pushIndividual({ resultType: "leader", rank: 1, name: gcLeader.name, stageNumber });

      const points = sheetByName(workbook, "Points");
      const pLeader = extractIndividualRows(points).find((r) => r.rank === 1);
      if (pLeader) pushIndividual({ resultType: "points_day", rank: 1, name: pLeader.name, stageNumber });

      const mountain = sheetByName(workbook, "Mountain");
      const mLeader = extractIndividualRows(mountain).find((r) => r.rank === 1);
      if (mLeader) pushIndividual({ resultType: "mountain_day", rank: 1, name: mLeader.name, stageNumber });

      // Ungdoms-leder: Young-arket er etape-sorteret; leder = parens(1).
      const young = sheetByName(workbook, "Young results");
      const yLeader = extractIndividualRows(young, { rankSource: "parens" }).find((r) => r.rank === 1);
      if (yLeader) pushIndividual({ resultType: "young_day", rank: 1, name: yLeader.name, stageNumber });
    } else {
      // Sidste etape: hele klassementet udbetales.
      const gc = sheetByName(workbook, "General results");
      for (const r of extractIndividualRows(gc)) {
        pushIndividual({ resultType: "gc", rank: r.rank, name: r.name, stageNumber });
      }
      const points = sheetByName(workbook, "Points");
      for (const r of extractIndividualRows(points)) {
        pushIndividual({ resultType: "points", rank: r.rank, name: r.name, stageNumber });
      }
      const mountain = sheetByName(workbook, "Mountain");
      for (const r of extractIndividualRows(mountain)) {
        pushIndividual({ resultType: "mountain", rank: r.rank, name: r.name, stageNumber });
      }
      const young = sheetByName(workbook, "Young results");
      for (const r of extractIndividualRows(young, { rankSource: "parens" })) {
        pushIndividual({ resultType: "young", rank: r.rank, name: r.name, stageNumber });
      }
      const team = sheetByName(workbook, "Team results");
      for (const r of extractTeamRows(team, { rankSource: "parens" })) {
        pushTeam({ resultType: "team", rank: r.rank, pcmTeamName: r.team, stageNumber });
      }
    }
  }

  return finalize(resultRows);
}

function finalize(resultRows) {
  const perTypeCounts = {};
  let unmatchedRiders = 0;
  let unmatchedScoring = 0; // umatchede MED point (>0) — det er de vigtige
  const unmatchedNames = new Set();
  for (const r of resultRows) {
    perTypeCounts[r.result_type] = (perTypeCounts[r.result_type] || 0) + 1;
    if (r.rider_name && !r.rider_id) {
      unmatchedRiders += 1;
      if (r.points_earned > 0) {
        unmatchedScoring += 1;
        unmatchedNames.add(r.rider_name);
      }
    }
  }
  return {
    resultRows,
    perTypeCounts,
    unmatchedRiders,
    unmatchedScoring,
    unmatchedScoringNames: [...unmatchedNames],
  };
}

// Byg et detaljeret Discord-embed pr. resultat-type for ét importeret løb.
// Ren funktion (ingen I/O) → testbar. Bruges af route'en via sendDiscordNotification.
export function buildPcmImportEmbed({ race, preview, resultRows }) {
  const naming = (r) => r.rider_name || r.team_name || "?";
  const fields = [];

  // Etape-vindere (rank 1 i "stage" pr. etape).
  const stageWins = resultRows
    .filter((r) => r.result_type === "stage" && r.rank === 1)
    .sort((a, b) => a.stage_number - b.stage_number);
  if (stageWins.length) {
    fields.push({
      name: race.race_type === "single" ? "🏁 Vinder" : "🏁 Etapevindere",
      value: stageWins.map((r) => `Etape ${r.stage_number}: ${naming(r)}`).join("\n").slice(0, 1024),
      inline: false,
    });
  }

  // Klassement / Klassiker-podie (top 3 i "gc").
  const gc = resultRows.filter((r) => r.result_type === "gc").sort((a, b) => a.rank - b.rank).slice(0, 3);
  if (gc.length) {
    fields.push({
      name: race.race_type === "single" ? "🏆 Resultat" : "🏆 Klassement",
      value: gc.map((r) => `${r.rank}. ${naming(r)}`).join("\n"),
      inline: true,
    });
  }

  // Trøjevindere (final-etape klassifikationer).
  for (const [type, label] of [["points", "🟢 Point"], ["mountain", "⛰️ Bjerg"], ["young", "🤍 Ungdom"]]) {
    const w = resultRows.find((r) => r.result_type === type && r.rank === 1);
    if (w) fields.push({ name: label, value: naming(w), inline: true });
  }

  // Hold-vinder.
  const teamWin = resultRows.find((r) => r.result_type === "team" && r.rank === 1);
  if (teamWin) fields.push({ name: "👥 Hold", value: naming(teamWin), inline: true });

  const descParts = [`${preview.rows} resultater importeret`];
  if (preview.unmatched_scoring > 0) {
    descParts.push(`⚠️ ${preview.unmatched_scoring} umatchede scorende ryttere`);
  }

  return {
    title: `📊 Resultater: ${race.name}`,
    description: descParts.join(" · "),
    fields,
    color: 0x1e90ff,
  };
}

// Match et PCM-løbsnavn til en DB-race. Eksakt normaliseret match først
// (skelner "4 Jours de Dunkerque…" fra "Classique Dunkerque…"); kun hvis
// præcis ÉN race indeholder navnet som fallback. Returnerer { race, status }.
export function matchRaceName(pcmName, dbRaces) {
  const norm = normalizeRaceName(pcmName);
  const exact = dbRaces.filter((r) => normalizeRaceName(r.name) === norm);
  if (exact.length === 1) return { race: exact[0], status: "exact" };
  if (exact.length > 1) return { race: null, status: "ambiguous" };

  // Fallback: præcis ét DB-navn der indeholder PCM-navnet (eller omvendt).
  const contains = dbRaces.filter((r) => {
    const dn = normalizeRaceName(r.name);
    return dn.includes(norm) || norm.includes(dn);
  });
  if (contains.length === 1) return { race: contains[0], status: "contains" };
  if (contains.length > 1) return { race: null, status: "ambiguous" };
  return { race: null, status: "missing" };
}

// Strip interne felter (_match_status) før DB-insert.
function stripInternal(rows) {
  return rows.map(({ _match_status, ...rest }) => rest);
}

// Orchestrator: tag rå PCM-filer, gruppér pr. løb, match mod DB, byg rækker,
// og (når ikke dryRun) skriv via applyRaceResults. Discord via injiceret callback.
//
// files: [{ filename, buffer }]
// Returnerer en rapport med per-løb-preview (matchede/umatchede + point).
export async function importPcmResults({
  supabase,
  files = [],
  dryRun = false,
  applyRaceResults = applyRaceResultsShared,
  ensureSeasonStandings = async () => {},
  updateStandings = async () => {},
  notifyDiscord = null,
  adminUserId = null,
}) {
  if (!supabase?.from) throw new Error("supabase client kræves");
  if (!files.length) throw new Error("Ingen filer uploadet");

  // 1) Parse alle filer; gruppér pr. løbsnavn fra arktitlen.
  const groups = new Map(); // raceName -> [{ filename, workbook }]
  const parseErrors = [];
  for (const f of files) {
    let workbook;
    try {
      workbook = parsePcmWorkbook(f.buffer);
    } catch (err) {
      parseErrors.push({ filename: f.filename, error: err.message });
      continue;
    }
    const titled =
      workbook.sheets.find((s) => s.name.toLowerCase() === "stage results") ||
      workbook.sheets.find((s) => s.name.toLowerCase() === "general results");
    const raceName = raceNameFromTitle(titled?.title || "");
    if (!raceName) {
      parseErrors.push({ filename: f.filename, error: "Kunne ikke læse løbsnavn fra fil" });
      continue;
    }
    if (!groups.has(raceName)) groups.set(raceName, []);
    groups.get(raceName).push({ filename: f.filename, workbook });
  }

  // 2) Aktiv sæson + dens løb.
  const { data: season, error: seasonErr } = await supabase
    .from("seasons")
    .select("id, number")
    .eq("status", "active")
    .single();
  if (seasonErr || !season) {
    throw new Error("Ingen aktiv sæson fundet");
  }
  const { data: dbRaces, error: racesErr } = await supabase
    .from("races")
    .select("id, name, race_type, race_class, season_id, stages")
    .eq("season_id", season.id);
  if (racesErr) throw new Error(`Kunne ikke hente løb: ${racesErr.message}`);

  // 3) Byg matchers én gang.
  const riderMatcher = await buildRiderMatcher(supabase);
  const teamMatcher = await buildTeamMatcher(supabase);

  const racePointsCache = new Map(); // race_class -> racePoints[]
  async function loadRacePoints(raceClass) {
    if (!raceClass) return [];
    if (racePointsCache.has(raceClass)) return racePointsCache.get(raceClass);
    const { data, error } = await supabase
      .from("race_points")
      .select("result_type, rank, points")
      .eq("race_class", raceClass);
    if (error) throw new Error(`race_points-fejl: ${error.message}`);
    racePointsCache.set(raceClass, data || []);
    return data || [];
  }

  // 4) Pr. løbsgruppe.
  const perRace = [];
  const skipped = [];
  let totalRowsWritten = 0;

  for (const [raceName, raceFiles] of groups) {
    const { race, status } = matchRaceName(raceName, dbRaces || []);
    if (!race) {
      skipped.push({ race_name: raceName, reason: status, files: raceFiles.map((f) => f.filename) });
      continue;
    }

    raceFiles.sort(
      (a, b) => (a.workbook.stageInfo?.current || 1) - (b.workbook.stageInfo?.current || 1)
    );

    const racePoints = await loadRacePoints(race.race_class);
    const pointsLookup = buildRacePointsLookup({ racePoints, raceType: race.race_type });

    const built = buildPcmResultRows({ raceFiles, race, riderMatcher, teamMatcher, pointsLookup });
    const totalPoints = built.resultRows.reduce((s, r) => s + (r.points_earned || 0), 0);
    const stagesSeen = [...new Set(raceFiles.map((f) => f.workbook.stageInfo?.current).filter(Boolean))];
    const hasFinal = raceFiles.some((f) => f.workbook.stageInfo?.isFinalStage);

    const preview = {
      pcm_race_name: raceName,
      db_race_name: race.name,
      race_type: race.race_type,
      match_status: status,
      files: raceFiles.map((f) => f.filename),
      stages_seen: stagesSeen,
      has_final_stage: hasFinal,
      rows: built.resultRows.length,
      per_type: built.perTypeCounts,
      total_points: totalPoints,
      total_prize: totalPoints * PRIZE_PER_POINT,
      unmatched_scoring: built.unmatchedScoring,
      unmatched_scoring_names: built.unmatchedScoringNames,
    };
    perRace.push(preview);

    if (!dryRun) {
      // Idempotent: slet eksisterende resultater for løbet før insert.
      await supabase.from("race_results").delete().eq("race_id", race.id);
      const insertRows = stripInternal(built.resultRows);
      const applied = await applyRaceResults({
        supabase,
        race: { ...race, season_id: season.id },
        resultRows: insertRows,
        ensureSeasonStandings,
        updateStandings,
      });
      totalRowsWritten += applied.rowsImported;
      await supabase.from("races").update({ status: "completed" }).eq("id", race.id);

      if (notifyDiscord) {
        try {
          await notifyDiscord({ race, preview, resultRows: built.resultRows });
        } catch {
          // Discord-fejl må ikke vælte importen.
        }
      }
    }
  }

  if (!dryRun) {
    // #804 — opdatér seasons.race_days_completed nu hvor løb er sat completed.
    // Recompute (ikke increment) → idempotent ved re-import.
    await recomputeSeasonRaceDays({ supabase, seasonId: season.id });

    await supabase.from("import_log").insert({
      import_type: "race_results_pcm",
      rows_processed: files.length,
      rows_updated: totalRowsWritten,
      rows_inserted: totalRowsWritten,
      errors: [...parseErrors.map((e) => `${e.filename}: ${e.error}`), ...skipped.map((s) => `${s.race_name}: ${s.reason}`)],
      imported_by: adminUserId,
    });
  }

  return {
    success: true,
    dry_run: dryRun,
    season: season.number,
    races: perRace,
    skipped,
    parse_errors: parseErrors,
    rows_written: totalRowsWritten,
  };
}
