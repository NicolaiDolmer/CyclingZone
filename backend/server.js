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
import { createClient } from "@supabase/supabase-js";
import apiRoutes from "./routes/api.js";
import { startCron } from "./cron.js";
import { handleSyncRequest } from "./lib/sheetsSync.js";

const app = express();
const PORT = process.env.PORT || 3001;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

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

app.get("/health", (_,res) => res.json({status:"ok",timestamp:new Date().toISOString()}));

app.listen(PORT, () => { console.log(`🚴 Cycling Zone Manager API — port ${PORT}`); startCron(); });
