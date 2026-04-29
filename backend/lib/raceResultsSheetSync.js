import { applyRaceResults as applyRaceResultsShared } from "./raceResultsEngine.js";

// Maps Google Sheet "Benævnelse" → race_results.result_type
const BENÆVNELSE_TO_TYPE = {
  "Etapeplacering": "stage",
  "Klassement": "gc",
  "Etapeløb Hold": "team",
  "Ungdomstrøje": "young",
  "Bjergtrøje": "mountain",
  "Pointtrøje": "points",
  "Førertrøje": "leader",
  "Klassiker": "stage",
  "Klassiker Hold": "team",
};

// Maps Benævnelse → race_points.result_type key (spaces removed for multi-word)
const BENÆVNELSE_TO_POINTS_KEY = {
  "Etapeplacering": "Etapeplacering",
  "Klassement": "Klassement",
  "Etapeløb Hold": "EtapelobHold",
  "Ungdomstrøje": "Ungdomstroje",
  "Bjergtrøje": "Bjergtroje",
  "Pointtrøje": "Pointtroje",
  "Førertrøje": "Forertroje",
  "Klassiker": "Klassiker",
  "Klassiker Hold": "KlassikerHold",
};

const RACE_NAME_ALIASES = {
  "volta a la communitat valenciana": "volta comunitat valenciana",
  "volta a la comunitat valenciana": "volta comunitat valenciana",
};

function extractSheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error("Kan ikke udtrække sheet ID fra URL");
  return match[1];
}

function extractGid(url) {
  const match = url.match(/[?&#]gid=(\d+)/);
  return match ? match[1] : "0";
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function findHeader(headers, name) {
  let idx = headers.indexOf(name);
  if (idx >= 0) return idx;
  return headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
}

function normalizeRaceName(name) {
  const normalized = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return RACE_NAME_ALIASES[normalized] || normalized;
}

function raceNamesMatch(sheetName, dbName) {
  const sheetNorm = normalizeRaceName(sheetName);
  const dbNorm = normalizeRaceName(dbName);
  if (!sheetNorm || !dbNorm) return false;
  if (dbNorm === sheetNorm) return true;

  const sheetPrefix = sheetNorm.slice(0, 12);
  const dbPrefix = dbNorm.slice(0, 12);
  return dbNorm.includes(sheetPrefix) || sheetNorm.includes(dbPrefix);
}

function resolveTeamResultName(row, teamIdByName) {
  if (row.name) return row.name;
  if (row.team && teamIdByName.has(row.team)) return row.team;
  return row.team || null;
}

async function fetchCsv(sheetId, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Sheets fejl ${res.status}`);
  return res.text();
}

export async function syncRaceResultsFromSheets({
  spreadsheetUrl,
  supabase,
  applyRaceResults = applyRaceResultsShared,
  ensureSeasonStandings = async () => {},
  updateStandings,
  adminUserId,
  fetchCsvFn = fetchCsv,
}) {
  const sheetId = extractSheetId(spreadsheetUrl);
  const gid = extractGid(spreadsheetUrl);

  const csv = await fetchCsvFn(sheetId, gid);
  const lines = csv.split("\n").filter(l => l.trim());
  if (lines.length < 2) throw new Error("CSV er tom eller mangler datarækker");

  const headers = parseCsvLine(lines[0]).map(h => h.replace(/"/g, "").trim());
  const rankIdx = findHeader(headers, "Rank");
  const nameIdx = findHeader(headers, "Name");
  const teamIdx = findHeader(headers, "Team");
  const benIdx = findHeader(headers, "Benævnelse");
  const løbIdx = findHeader(headers, "Løb");
  const sæsonIdx = findHeader(headers, "Sæson");

  if (rankIdx < 0) throw new Error(`Kolonnen 'Rank' ikke fundet. Headers: ${headers.join(", ")}`);
  if (benIdx < 0) throw new Error(`Kolonnen 'Benævnelse' ikke fundet. Headers: ${headers.join(", ")}`);
  if (løbIdx < 0) throw new Error(`Kolonnen 'Løb' ikke fundet. Headers: ${headers.join(", ")}`);
  if (sæsonIdx < 0) throw new Error(`Kolonnen 'Sæson' ikke fundet. Headers: ${headers.join(", ")}`);

  // Parse all rows — keep sæson value per row
  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const sæsonVal = parseInt(cols[sæsonIdx]);
    if (isNaN(sæsonVal)) continue;

    const rank = parseInt(cols[rankIdx]);
    if (isNaN(rank)) continue;

    const benævnelse = (cols[benIdx] || "").replace(/"/g, "").trim();
    const løb = (cols[løbIdx] || "").replace(/"/g, "").trim();
    if (!benævnelse || !løb || !BENÆVNELSE_TO_TYPE[benævnelse]) continue;

    rows.push({
      rank,
      name: nameIdx >= 0 ? (cols[nameIdx] || "").replace(/"/g, "").trim() || null : null,
      team: teamIdx >= 0 ? (cols[teamIdx] || "").replace(/"/g, "").trim() || null : null,
      benævnelse,
      løb,
      sæson: sæsonVal,
    });
  }

  if (!rows.length) throw new Error("Ingen gyldige rækker fundet — tjek at Sæson-kolonnen er udfyldt og kolonnenavne er korrekte");

  // Batch-resolve rider names → IDs once across all rows
  const allRiderNames = [...new Set(rows.map(r => r.name).filter(Boolean))];
  const riderIdByName = new Map();
  for (const fullName of allRiderNames) {
    const parts = fullName.trim().split(" ");
    const lastName = parts[parts.length - 1];
    const { data: riders } = await supabase
      .from("riders")
      .select("id, firstname, lastname")
      .ilike("lastname", `%${lastName}%`)
      .limit(5);
    if (!riders?.length) continue;
    if (riders.length === 1) {
      riderIdByName.set(fullName, riders[0].id);
    } else {
      const firstName = parts.slice(0, -1).join(" ").toLowerCase();
      const best = riders.find(r => r.firstname?.toLowerCase().startsWith(firstName.slice(0, 3))) || riders[0];
      riderIdByName.set(fullName, best.id);
    }
  }

  // Batch-resolve team names → IDs once across all rows
  const allTeamNames = [...new Set(rows.flatMap(r => {
    const names = [];
    if (r.team) names.push(r.team);
    if ((r.benævnelse === "Etapeløb Hold" || r.benævnelse === "Klassiker Hold") && r.name) {
      names.push(r.name);
    }
    return names;
  }))];
  const teamIdByName = new Map();
  if (allTeamNames.length) {
    const { data: dbTeams } = await supabase.from("teams").select("id, name");
    for (const teamName of allTeamNames) {
      const tn = teamName.toLowerCase().trim();
      const match = (dbTeams || []).find(t => {
        const dbn = t.name.toLowerCase().trim();
        return dbn === tn
          || dbn.startsWith(tn.slice(0, 15))
          || tn.startsWith(dbn.slice(0, 15));
      });
      if (match) teamIdByName.set(teamName, match.id);
    }
  }

  // Group rows by sæson number
  const rowsBySæson = new Map();
  for (const row of rows) {
    if (!rowsBySæson.has(row.sæson)) rowsBySæson.set(row.sæson, []);
    rowsBySæson.get(row.sæson).push(row);
  }

  const allRacesImported = [];
  const allRacesSkipped = [];
  let totalImported = 0;
  const seasonsSummary = [];

  for (const [sæsonNum, sæsonRows] of rowsBySæson) {
    // Find DB season
    const { data: season } = await supabase
      .from("seasons")
      .select("id, number")
      .eq("number", sæsonNum)
      .single();
    if (!season) {
      allRacesSkipped.push(`(sæson ${sæsonNum} ikke fundet i DB)`);
      continue;
    }

    // Get all races for this season
    const { data: dbRaces } = await supabase
      .from("races")
      .select("id, name, race_class, race_type")
      .eq("season_id", season.id);

    // Match sheet race names to DB races
    const raceMatches = new Map();
    const unmatched = [];
    const uniqueRaceNames = [...new Set(sæsonRows.map(r => r.løb).filter(Boolean))];

    for (const sheetName of uniqueRaceNames) {
      const match = (dbRaces || []).find(r => raceNamesMatch(sheetName, r.name));
      if (match) raceMatches.set(sheetName, match);
      else unmatched.push(sheetName);
    }

    allRacesSkipped.push(...unmatched);

    if (!raceMatches.size) continue;

    // Load points for this season's race classes
    const raceClasses = [...new Set([...raceMatches.values()].map(r => r.race_class).filter(Boolean))];
    const pointsLookup = new Map();
    if (raceClasses.length) {
      const { data: pRows } = await supabase
        .from("race_points")
        .select("race_class, result_type, rank, points")
        .in("race_class", raceClasses);
      for (const p of pRows || []) {
        pointsLookup.set(`${p.race_class}__${p.result_type}__${p.rank}`, p.points || 0);
      }
    }

    // Group season rows by race name
    const rowsByRace = new Map();
    for (const row of sæsonRows) {
      if (!raceMatches.has(row.løb)) continue;
      if (!rowsByRace.has(row.løb)) rowsByRace.set(row.løb, []);
      rowsByRace.get(row.løb).push(row);
    }

    let seasonImported = 0;
    const seasonRaces = [];

    for (const [løbName, raceRows] of rowsByRace) {
      const race = raceMatches.get(løbName);

      // Delete existing results (idempotent re-import)
      await supabase.from("race_results").delete().eq("race_id", race.id);

      // Build result rows with stage number detection
      const stageTracker = {};
      const resultRows = [];

      for (const row of raceRows) {
        const resultType = BENÆVNELSE_TO_TYPE[row.benævnelse];
        if (!resultType) continue;

        if (!stageTracker[row.benævnelse]) {
          stageTracker[row.benævnelse] = { stage: 1, prevRank: null };
        }
        const tracker = stageTracker[row.benævnelse];

        if (row.rank === 1 && tracker.prevRank !== null) tracker.stage++;
        tracker.prevRank = row.rank;

        const isTeamResult = row.benævnelse === "Etapeløb Hold" || row.benævnelse === "Klassiker Hold";
        const riderId = !isTeamResult && row.name ? (riderIdByName.get(row.name) || null) : null;
        const teamName = isTeamResult ? resolveTeamResultName(row, teamIdByName) : row.team;
        const teamId = teamName ? (teamIdByName.get(teamName) || null) : null;

        const pointsKey = BENÆVNELSE_TO_POINTS_KEY[row.benævnelse];
        const points = race.race_class && pointsKey
          ? (pointsLookup.get(`${race.race_class}__${pointsKey}__${row.rank}`) ?? 0)
          : 0;

        resultRows.push({
          race_id: race.id,
          stage_number: tracker.stage,
          result_type: resultType,
          rank: row.rank,
          rider_id: riderId,
          rider_name: isTeamResult ? null : (row.name || null),
          team_id: teamId,
          team_name: teamName || null,
          finish_time: null,
          points_earned: points,
          prize_money: points,
        });
      }

      if (!resultRows.length) continue;

      const importResult = await applyRaceResults({
        supabase,
        race: { ...race, season_id: season.id },
        resultRows,
        ensureSeasonStandings,
        updateStandings,
      });

      await supabase.from("races").update({ status: "completed" }).eq("id", race.id);

      seasonImported += importResult.rowsImported;
      seasonRaces.push(løbName);
    }

    totalImported += seasonImported;
    allRacesImported.push(...seasonRaces);
    seasonsSummary.push({ season: sæsonNum, races: seasonRaces.length, rows: seasonImported });
  }

  await supabase.from("import_log").insert({
    import_type: "race_results_sheets",
    rows_processed: rows.length,
    rows_updated: totalImported,
    rows_inserted: totalImported,
    errors: allRacesSkipped.length ? allRacesSkipped : [],
    imported_by: adminUserId,
  });

  return {
    success: true,
    rows_imported: totalImported,
    races_imported: allRacesImported,
    races_skipped: allRacesSkipped,
    seasons: seasonsSummary,
  };
}
