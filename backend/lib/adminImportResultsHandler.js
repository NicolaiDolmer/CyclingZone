const SHEET_TO_TYPE = {
  "stage results": "stage",
  "general results": "gc",
  points: "points",
  mountain: "mountain",
  "team results": "team",
  "young results": "young",
};

const DEFAULT_PRIZES = {
  stage: { 1: 200000, 2: 120000, 3: 80000, 4: 60000, 5: 48000, 6: 40000, 7: 32000, 8: 24000, 9: 16000, 10: 8000 },
  gc: { 1: 800000, 2: 600000, 3: 400000, 4: 300000, 5: 200000, 6: 160000, 7: 120000, 8: 80000, 9: 60000, 10: 40000 },
  points: { 1: 120000, 2: 80000, 3: 60000 },
  mountain: { 1: 120000, 2: 80000, 3: 60000 },
  team: { 1: 400000, 2: 280000, 3: 200000, 4: 120000, 5: 80000 },
  young: { 1: 200000, 2: 120000, 3: 80000 },
};

function ensureDependency(name, value) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
}

export function createAdminImportResultsHandler({
  supabase,
  buildRacePrizeLookup,
  applyRaceResults,
  ensureSeasonStandings,
  updateStandings,
  logActivity,
  xlsxImporter = () => import("xlsx"),
  sheetToType = SHEET_TO_TYPE,
  defaultsByType = DEFAULT_PRIZES,
} = {}) {
  ensureDependency("supabase", supabase?.from);
  ensureDependency("buildRacePrizeLookup", buildRacePrizeLookup);
  ensureDependency("applyRaceResults", applyRaceResults);
  ensureDependency("ensureSeasonStandings", ensureSeasonStandings);
  ensureDependency("updateStandings", updateStandings);
  ensureDependency("logActivity", logActivity);

  return async function adminImportResults(req, res) {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const { race_id, stage_number = 1 } = req.body || {};
    if (!race_id) return res.status(400).json({ error: "race_id required" });

    try {
      const { data: race, error: raceError } = await supabase
        .from("races")
        .select("id, name, season_id, race_type")
        .eq("id", race_id)
        .single();
      if (raceError) return res.status(500).json({ error: raceError.message });
      if (!race) return res.status(404).json({ error: "Race not found" });

      const { data: prizes, error: prizesError } = await supabase
        .from("prize_tables")
        .select("result_type, rank, prize_amount")
        .eq("race_type", race.race_type);
      if (prizesError) return res.status(500).json({ error: prizesError.message });

      const prizeLookup = buildRacePrizeLookup({
        prizes,
        defaultsByType,
      });

      const XLSX = await xlsxImporter();
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const parsedStageNumber = Number.parseInt(stage_number, 10) || 1;
      const resultRows = [];

      for (const sheetName of workbook.SheetNames) {
        const resultType = sheetToType[sheetName.trim().toLowerCase()];
        if (!resultType) continue;

        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
        if (rows.length < 2) continue;

        const headers = rows[1].map((header) => String(header || "").trim().toLowerCase());
        const rankIdx = headers.findIndex((header) => header === "rank");
        const nameIdx = headers.findIndex((header) => header === "name");
        const teamIdx = headers.findIndex((header) => header === "team");
        const timeIdx = headers.findIndex((header) => header === "time");

        for (const row of rows.slice(2)) {
          const rank = Number.parseInt(row[rankIdx], 10);
          if (Number.isNaN(rank)) continue;

          const prize = prizeLookup[`${resultType}__${rank}`] || 0;
          const riderName = resultType === "team"
            ? null
            : String(row[nameIdx] || "").trim() || null;
          const teamName = String(row[teamIdx] || "").trim() || null;

          let riderId = null;
          let teamId = null;

          if (riderName) {
            const parts = riderName.split(" ");
            const { data: riders } = await supabase
              .from("riders")
              .select("id")
              .ilike("lastname", `%${parts[parts.length - 1]}%`)
              .limit(1);
            riderId = riders?.[0]?.id || null;
          }

          if (teamName) {
            const { data: teams } = await supabase
              .from("teams")
              .select("id")
              .ilike("name", `%${teamName.slice(0, 20)}%`)
              .limit(1);
            teamId = teams?.[0]?.id || null;
          }

          resultRows.push({
            race_id,
            stage_number: parsedStageNumber,
            result_type: resultType,
            rank,
            rider_id: riderId,
            rider_name: riderName,
            team_id: teamId,
            team_name: teamName,
            finish_time: String(row[timeIdx] || "").trim() || null,
            points_earned: prize,
            prize_money: prize,
          });
        }
      }

      if (!resultRows.length) {
        return res.status(400).json({ error: "No rows found in workbook" });
      }

      const result = await applyRaceResults({
        supabase,
        race,
        resultRows,
        ensureSeasonStandings,
        updateStandings,
      });

      await logActivity("race_results_approved", {
        meta: {
          race_id: race.id,
          race_name: race.name,
          season_id: race.season_id,
          rows_imported: result.rowsImported,
        },
      });

      return res.json({
        success: true,
        records_imported: result.rowsImported,
        teams_paid: result.teamsPaid,
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  };
}
