import { PRIZE_PER_POINT } from "./raceResultsEngine.js";

const SHEET_TO_TYPE = {
  "stage results": "stage",
  "general results": "gc",
  points: "points",
  mountain: "mountain",
  "team results": "team",
  "young results": "young",
};

function ensureDependency(name, value) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
}

export function createAdminImportResultsHandler({
  supabase,
  buildRacePointsLookup,
  applyRaceResults,
  ensureSeasonStandings,
  updateStandings,
  logActivity,
  xlsxImporter = () => import("xlsx"),
  sheetToType = SHEET_TO_TYPE,
} = {}) {
  ensureDependency("supabase", supabase?.from);
  ensureDependency("buildRacePointsLookup", buildRacePointsLookup);
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
        .select("id, name, season_id, race_type, race_class")
        .eq("id", race_id)
        .single();
      if (raceError) return res.status(500).json({ error: raceError.message });
      if (!race) return res.status(404).json({ error: "Race not found" });

      let racePoints = [];
      if (race.race_class) {
        const { data: pts, error: ptsError } = await supabase
          .from("race_points")
          .select("result_type, rank, points")
          .eq("race_class", race.race_class);
        if (ptsError) return res.status(500).json({ error: ptsError.message });
        racePoints = pts || [];
      }

      const pointsLookup = buildRacePointsLookup({ racePoints, raceType: race.race_type });

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

          const pts = pointsLookup[`${resultType}__${rank}`] || 0;
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
            points_earned: pts,
            prize_money: pts * PRIZE_PER_POINT,
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
