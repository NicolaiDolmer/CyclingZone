import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";

// Load .env FIRST before any other imports use process.env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, ".env") });

import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import apiRoutes from "./routes/api.js";
import { startCron } from "./cron.js";
import { handleSyncRequest } from "./lib/sheetsSync.js";
import { processSeasonStart, processSeasonEnd } from "./lib/economyEngine.js";
import { notifySeasonEvent } from "./lib/discordNotifier.js";
import {
  applyRaceResults,
  buildRacePrizeLookup,
} from "./lib/raceResultsEngine.js";

const app = express();
const PORT = process.env.PORT || 3001;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ok = file.mimetype.includes("spreadsheet") || file.originalname.endsWith(".xlsx");
    cb(null, ok);
  },
});

const SHEET_TO_TYPE = {
  "stage results": "stage",
  "general results": "gc",
  points: "points",
  mountain: "mountain",
  "team results": "team",
  "young results": "young",
};

const DEFAULT_PRIZES = {
  stage: { 1: 50, 2: 30, 3: 20, 4: 15, 5: 12, 6: 10, 7: 8, 8: 6, 9: 4, 10: 2 },
  gc: { 1: 200, 2: 150, 3: 100, 4: 75, 5: 50, 6: 40, 7: 30, 8: 20, 9: 15, 10: 10 },
  points: { 1: 30, 2: 20, 3: 15 },
  mountain: { 1: 30, 2: 20, 3: 15 },
  team: { 1: 100, 2: 70, 3: 50, 4: 30, 5: 20 },
  young: { 1: 50, 2: 30, 3: 20 },
};

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function logActivity(type, data = {}) {
  try {
    await supabase.from("activity_feed").insert({
      type,
      team_id: data.team_id || null,
      team_name: data.team_name || null,
      rider_id: data.rider_id || null,
      rider_name: data.rider_name || null,
      amount: data.amount || null,
      meta: data.meta || {},
    });
  } catch (e) {
    // Activity logging must never block the import flow.
  }
}

app.use(helmet());
const ALLOWED_ORIGINS = [
  "https://cycling-zone.vercel.app",
  process.env.FRONTEND_URL,
  "http://localhost:5173",
  "http://localhost:4173",
].filter(Boolean);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin)), credentials: true }));
app.use(express.json({ limit: "10mb" }));

async function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Invalid token" });
  const { data: u } = await supabase.from("users").select("role").eq("id", user.id).single();
  if (u?.role !== "admin") return res.status(403).json({ error: "Admin only" });
  req.user = user;
  next();
}

app.use("/api", apiRoutes);
app.post("/api/admin/sync-uci", requireAdmin, handleSyncRequest);

app.post("/api/admin/import-results", requireAdmin, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const { race_id, stage_number = 1 } = req.body;
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
      defaultsByType: DEFAULT_PRIZES,
    });

    const XLSX = await import("xlsx");
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const allRecords = [];
    for (const sheetName of wb.SheetNames) {
      const resultType = SHEET_TO_TYPE[sheetName.trim().toLowerCase()];
      if (!resultType) continue;
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
      if (rows.length < 2) continue;
      const headers = rows[1].map(h => String(h||"").trim().toLowerCase());
      const rankIdx = headers.findIndex(h => h==="rank");
      const nameIdx = headers.findIndex(h => h==="name");
      const teamIdx = headers.findIndex(h => h==="team");
      const timeIdx = headers.findIndex(h => h==="time");
      for (const row of rows.slice(2)) {
        const rank = parseInt(row[rankIdx]);
        if (isNaN(rank)) continue;
        const prize = prizeLookup[`${resultType}__${rank}`] || 0;
        const riderName = resultType==="team" ? null : String(row[nameIdx]||"").trim()||null;
        const teamName = String(row[teamIdx]||"").trim()||null;
        let riderId=null, dbTeamId=null;
        if (riderName) {
          const parts = riderName.split(" ");
          const { data: r } = await supabase.from("riders").select("id").ilike("lastname",`%${parts[parts.length-1]}%`).limit(1);
          riderId = r?.[0]?.id||null;
        }
        if (teamName) {
          const { data: t } = await supabase.from("teams").select("id").ilike("name",`%${teamName.slice(0,20)}%`).limit(1);
          dbTeamId = t?.[0]?.id||null;
        }
        allRecords.push({
          race_id,
          stage_number: parseInt(stage_number, 10) || 1,
          result_type: resultType,
          rank,
          rider_id: riderId,
          rider_name: riderName,
          team_id: dbTeamId,
          team_name: teamName,
          finish_time: String(row[timeIdx] || "").trim() || null,
          points_earned: prize,
          prize_money: prize,
        });
      }
    }
    if (!allRecords.length) {
      return res.status(400).json({ error: "No rows found in workbook" });
    }

    const result = await applyRaceResults({
      supabase,
      race,
      resultRows: allRecords,
    });

    await logActivity("race_results_approved", {
      meta: {
        race_id: race.id,
        race_name: race.name,
        season_id: race.season_id,
        rows_imported: result.rowsImported,
      },
    });

    res.json({
      success: true,
      records_imported: result.rowsImported,
      teams_paid: result.teamsPaid,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/admin/seasons/:id/start", requireAdmin, async (req, res) => {
  try {
    // 1. Close any open transfer windows
    await supabase.from("transfer_windows")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("status", "open");

    // 2. Process all pending transfers (move pending_team_id → team_id)
    const { data: pendingRiders } = await supabase
      .from("riders").select("id, pending_team_id").not("pending_team_id", "is", null);
    for (const rider of (pendingRiders || [])) {
      await supabase.from("riders")
        .update({ team_id: rider.pending_team_id, pending_team_id: null })
        .eq("id", rider.id);
    }

    // 3. Recalculate all salaries to 10% of current UCI price
    const { data: allRiders } = await supabase
      .from("riders").select("id, uci_points").not("team_id", "is", null);
    for (const rider of (allRiders || [])) {
      const newSalary = Math.max(1, Math.round((rider.uci_points || 1) * 0.10));
      await supabase.from("riders").update({ salary: newSalary }).eq("id", rider.id);
    }

    // 4. Start season
    await supabase.from("seasons").update({status:"active"}).eq("id",req.params.id);
    const results = await processSeasonStart(req.params.id);
    const { data: s } = await supabase.from("seasons").select("number").eq("id",req.params.id).single();
    notifySeasonEvent({ type:"season_started", seasonNumber: s?.number }).catch(()=>{});
    res.json({success:true, results, pending_transfers: pendingRiders?.length || 0, salaries_updated: allRiders?.length || 0}); }
  catch (err) { res.status(500).json({error:err.message}); }
});

app.post("/api/admin/seasons/:id/end", requireAdmin, async (req, res) => {
  try {
    await processSeasonEnd(req.params.id);
    const { data: s } = await supabase.from("seasons").select("number").eq("id",req.params.id).single();
    notifySeasonEvent({ type:"season_ended", seasonNumber: s?.number }).catch(()=>{});
    res.json({success:true}); }
  catch (err) { res.status(500).json({error:err.message}); }
});

app.get("/health", (_,res) => res.json({status:"ok",timestamp:new Date().toISOString()}));

app.listen(PORT, () => { console.log(`🚴 Cycling Zone Manager API — port ${PORT}`); startCron(); });
