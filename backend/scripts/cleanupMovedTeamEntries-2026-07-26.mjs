#!/usr/bin/env node
// ENGANGS (cutover 26/7, drejebog skridt 6): sletningen af de 93 gamle-pulje-
// entries er kørt via SQL (26/7 ~21:50, se #2846-kommentar) — dette script sender
// KUN manager-notifikationerne via engine-stien (notifyTeamOwner, admin_notice).
//   railway run --service CyclingZone -- node scripts/cleanupMovedTeamEntries-2026-07-26.mjs --execute

import { createClient } from "@supabase/supabase-js";
import { notifyTeamOwner } from "../lib/notificationService.js";

const EXECUTE = process.argv.includes("--execute");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const AFFECTED = [
  { teamId: "dd7665b4-1990-4040-96dc-5f95b3303908", name: "Lidl–Leffe Pro Drinking", removed: 47 },
  { teamId: "ff613180-6f69-4a34-ac9c-e9b823f2675e", name: "Bacon Fræsers", removed: 28 },
  { teamId: "bde9e5a2-5418-49ae-a6da-59a4971a62c5", name: "International Cycling Team", removed: 12 },
  { teamId: "193791bb-d8c5-4888-b7c9-3e7cc80c947f", name: "RMF Pro Athletic", removed: 6 },
];

if (!EXECUTE) {
  console.log("DRY-RUN — ville notificere:", AFFECTED.map((a) => `${a.name} (${a.removed})`).join(" · "));
  process.exit(0);
}

for (const a of AFFECTED) {
  await notifyTeamOwner({
    supabase,
    teamId: a.teamId,
    type: "admin_notice",
    title: "Season 2: race entries updated after your division change",
    message:
      `Your team was placed in a new division for season 2, so ${a.removed} manually planned ` +
      `race entries pointing at your previous division's races were removed. Auto-generated entries ` +
      `for your new division are in place — open the race planner to review and adjust your selections.`,
    relatedId: null,
    metadata: { source: "season2_compression_entry_cleanup", removed: a.removed },
  });
  console.log(`  ✅ ${a.name} notificeret (${a.removed} fjernet)`);
}
console.log("Færdig.");
