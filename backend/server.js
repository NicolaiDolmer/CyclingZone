import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";

// Load .env FIRST before any other imports use process.env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, ".env"), quiet: true });

import { initSentry, setupSentryExpressErrorHandler } from "./lib/sentry.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import apiRoutes from "./routes/api.js";
import { startCron, awaitCronsIdle, getCronInFlight } from "./cron.js";

initSentry();

const app = express();
const PORT = process.env.PORT || 3001;

// Railway/Vercel terminate TLS upstream; trust the first proxy hop so req.ip
// reflects the real client (X-Forwarded-For) for rate-limit key fallback.
app.set("trust proxy", 1);

// Security-hardening (2026-06-20): eksplicit HSTS bag Railway/Vercel-TLS. Defense-in-depth
// — instruerer browsere til at tvinge HTTPS i 1 år (inkl. subdomæner) selv hvis et
// proxy-led skulle fejle. maxAge i sekunder (31536000 = 365 dage).
app.use(helmet({ hsts: { maxAge: 31536000, includeSubDomains: true } }));
const ALLOWED_ORIGINS = [
  // cyclingzone.org = primary siden 11/6 (#1296); apex er canonical, www redirecter.
  "https://cyclingzone.org",
  "https://www.cyclingzone.org",
  // Legacy beta-URL — redirecter til .org på Vercel-niveau, men beholdes i CORS
  // som sikkerhedsnet for cachede SPA-bundles der stadig kalder API'et direkte.
  "https://cycling-zone.vercel.app",
  process.env.FRONTEND_URL,
  "http://localhost:5173",
  "http://localhost:4173",
].filter(Boolean);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin)), credentials: true }));
// Webhooks skal have rå body (signatur/verifikation) → undtag fra JSON-parseren.
// Rå-parseren sætter req._body, så den globale express.json() springer pathen over.
app.use("/api/billing/alunta-webhook", express.raw({ type: "*/*" }));
app.use(express.json({ limit: "10mb" }));

app.use("/api", apiRoutes);
// POST /api/admin/sync-uci fjernet 2026-06-12 (#1207, ejer-Option A): UCI-sync er
// pensioneret efter relaunch til fiktive ryttere — uci_points er frossen, og
// sheetsSync.js + verify-scriptet er slettet (git-historik er revert-stien).
// Routes må ikke genopstå her i server.js — backend/routes/api.js ejer admin-routes.

app.get("/health", (_,res) => res.json({status:"ok",timestamp:new Date().toISOString()}));

setupSentryExpressErrorHandler(app);
app.use((err, _req, res, _next) => {
  console.error("[express] unhandled error:", err?.message || err);
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(PORT, () => { console.log(`🚴 Cycling Zone Manager API — port ${PORT}`); startCron(); });

// Graceful shutdown — Railway sender SIGTERM før dyno-kill ved deploy. Uden
// denne handler kunne en cron-tick midt i en sæson-transition afbrydes (cron.js
// håndhæver idempotens per fase, men shutdown bør stadig vente).
const SHUTDOWN_TIMEOUT_MS = 30_000;
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received — stopper accept af nye requests`);
  server.close(() => console.log("[shutdown] HTTP server lukket"));
  const inFlight = getCronInFlight();
  if (inFlight > 0) {
    console.log(`[shutdown] venter på ${inFlight} cron-tick(s) (timeout ${SHUTDOWN_TIMEOUT_MS}ms)`);
  }
  const idle = await awaitCronsIdle(SHUTDOWN_TIMEOUT_MS);
  if (!idle) {
    console.warn(`[shutdown] timeout — ${getCronInFlight()} cron-tick(s) stadig in-flight ved exit`);
  } else {
    console.log("[shutdown] alle cron-ticks afsluttet");
  }
  process.exit(0);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
