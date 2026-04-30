import { createClient } from "@supabase/supabase-js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../.env") });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Map PCM dyn_cyclist column names → DB rider fields (all integer after rounding)
const STAT_MAP = {
  charac_i_plain:           "stat_fl",
  charac_i_mountain:        "stat_bj",
  charac_i_medium_mountain: "stat_kb",
  charac_i_hill:            "stat_bk",
  charac_i_timetrial:       "stat_tt",
  charac_i_prologue:        "stat_prl",
  charac_i_cobble:          "stat_bro",
  charac_i_sprint:          "stat_sp",
  charac_i_acceleration:    "stat_acc",
  charac_i_downhilling:     "stat_ned",
  charac_i_endurance:       "stat_udh",
  charac_i_resistance:      "stat_mod",
  charac_i_recuperation:    "stat_res",
  charac_i_baroudeur:       "stat_ftr",
  gene_i_size:              "height",
  gene_i_weight:            "weight",
  gene_f_popularity:        "popularity",
  value_f_potentiel:        "potentiale",
};

function extractSheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error("Kan ikke udtrække sheet ID fra URL");
  return match[1];
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

async function fetchCsv(sheetId) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Sheets fejl ${res.status}`);
  return res.text();
}

export async function syncDynCyclist(spreadsheetUrl, adminUserId) {
  const sheetId = extractSheetId(spreadsheetUrl);
  const csv = await fetchCsv(sheetId);

  const lines = csv.split("\n").filter(l => l.trim());
  if (lines.length < 2) throw new Error("CSV er tom eller har ingen datarækker");

  const headers = parseCsvLine(lines[0]).map(h => h.replace(/"/g, "").trim());

  const pcmIdIdx = headers.indexOf("IDcyclist");
  if (pcmIdIdx === -1) throw new Error("IDcyclist kolonne ikke fundet i arket");

  // Build map: colIdx → dbField for all stats we want to sync
  const statColumns = new Map();
  for (const [colName, dbField] of Object.entries(STAT_MAP)) {
    const idx = headers.indexOf(colName);
    if (idx !== -1) statColumns.set(idx, dbField);
  }

  // Fetch all riders with pcm_id from DB once
  const { data: riders } = await supabase
    .from("riders")
    .select("id, pcm_id")
    .not("pcm_id", "is", null);

  const pcmToId = new Map((riders || []).map(r => [r.pcm_id, r.id]));

  const updates = [];
  let notFound = 0;

  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const pcmId = parseInt(cols[pcmIdIdx]);
    if (isNaN(pcmId)) continue;

    const riderId = pcmToId.get(pcmId);
    if (!riderId) { notFound++; continue; }

    const update = { updated_at: new Date().toISOString() };
    for (const [idx, dbField] of statColumns) {
      const val = parseFloat(cols[idx]);
      if (!isNaN(val)) {
        update[dbField] = dbField === "potentiale"
          ? Math.round(val * 2) / 2  // round to nearest 0.5
          : Math.round(val);
      }
    }

    if (Object.keys(update).length > 1) {
      updates.push({ id: riderId, ...update });
    }
  }

  // Batch update + historiklog
  const syncedAt = new Date().toISOString();
  const STAT_FIELDS = [
    "stat_fl","stat_bj","stat_kb","stat_bk","stat_tt","stat_prl",
    "stat_bro","stat_sp","stat_acc","stat_ned","stat_udh","stat_mod",
    "stat_res","stat_ftr","height","weight","popularity",
  ];
  const historyRows = [];
  const BATCH = 100;
  for (let i = 0; i < updates.length; i += BATCH) {
    for (const { id, ...fields } of updates.slice(i, i + BATCH)) {
      await supabase.from("riders").update(fields).eq("id", id);
      const historyRow = { rider_id: id, synced_at: syncedAt };
      for (const f of STAT_FIELDS) {
        if (fields[f] !== undefined) historyRow[f] = fields[f];
      }
      historyRows.push(historyRow);
    }
  }

  if (historyRows.length > 0) {
    for (let i = 0; i < historyRows.length; i += BATCH) {
      await supabase.from("rider_stat_history").insert(historyRows.slice(i, i + BATCH));
    }
  }

  await supabase.from("import_log").insert({
    import_type: "dyn_cyclist_sheets",
    rows_processed: lines.length - 1,
    rows_updated: updates.length,
    rows_inserted: 0,
    errors: [],
    imported_by: adminUserId,
  });

  return {
    success: true,
    rows_in_sheet: lines.length - 1,
    rows_matched: updates.length,
    not_found: notFound,
  };
}

export async function handleDynCyclistSyncRequest(req, res) {
  const { spreadsheet_url } = req.body;
  if (!spreadsheet_url) {
    return res.status(400).json({ error: "spreadsheet_url påkrævet" });
  }
  try {
    const result = await syncDynCyclist(spreadsheet_url, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
