#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { updateRiderValues } from "../lib/economyEngine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

try {
  console.log("=== Rider salary recalculation ===");
  const summary = await updateRiderValues(supabase);
  console.log(`=== Done: ${summary.ridersUpdated} riders updated ===`);
} catch (error) {
  console.error("Rider salary recalculation failed:", error.message);
  process.exit(1);
}
