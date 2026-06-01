import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { repairBoardMembersAfterDna } from "../lib/boardEngine.js";

config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);
const summary = await repairBoardMembersAfterDna({ supabase });

console.log(JSON.stringify(summary, null, 2));
