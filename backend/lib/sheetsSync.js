/**
 * Cycling Zone Manager — Google Sheets Sync
 * ==========================================
 * Pulls UCI points from Google Sheets and updates rider prices.
 *
 * Setup:
 *   1. In Google Sheets: File → Share → Publish to web → CSV
 *   2. Or use Google Sheets API v4 with service account
 *   3. Set GOOGLE_SHEETS_CSV_URL or GOOGLE_SHEETS_ID + credentials
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Normalize a name for fuzzy matching.
 * Handles: "POGAČAR Tadej" → "POGACAR TADEJ"
 */
function normalizeName(name) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Fetch UCI points from Google Sheets published CSV URL.
 * Returns Map: normalizedName → points
 */
async function fetchUCIPointsFromCSV(csvUrl) {
  const res = await fetch(csvUrl);
  if (!res.ok) throw new Error(`Failed to fetch CSV: ${res.status}`);

  const text = await res.text();
  const lines = text.split("\n").filter(Boolean);
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase());

  const nameIdx = headers.findIndex(h => h.includes("navn") || h.includes("name"));
  const ptsIdx = headers.findIndex(h => h.includes("point"));

  if (nameIdx === -1 || ptsIdx === -1) {
    throw new Error(`Could not find name/points columns. Headers: ${headers.join(", ")}`);
  }

  const map = new Map();
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const name = (cols[nameIdx] || "").replace(/"/g, "").trim();
    const pts = parseInt(cols[ptsIdx]);
    if (name && !isNaN(pts)) {
      map.set(normalizeName(name), pts);
    }
  }

  return map;
}

/**
 * Try multiple name formats to find a match in the UCI map.
 */
function findUCIPoints(rider, uciMap) {
  const attempts = [
    // "LASTNAME Firstname"
    normalizeName(`${rider.lastname} ${rider.firstname}`),
    // "Firstname LASTNAME"
    normalizeName(`${rider.firstname} ${rider.lastname}`),
    // Just lastname
    normalizeName(rider.lastname),
  ];

  for (const attempt of attempts) {
    if (uciMap.has(attempt)) return uciMap.get(attempt);
    // Try partial match (last name only in longer strings)
    for (const [key, val] of uciMap) {
      if (key.includes(normalizeName(rider.lastname)) &&
          key.includes(normalizeName(rider.firstname).split(" ")[0])) {
        return val;
      }
    }
  }
  return null;
}

/**
 * Main sync function.
 * Fetches UCI points and upserts rider prices in database.
 */
export async function syncUCIPoints(csvUrl, adminUserId) {
  console.log("🔄 Starting UCI points sync from Google Sheets...");
  const startTime = Date.now();

  const errors = [];
  let updated = 0;
  let unchanged = 0;
  let notFound = 0;

  try {
    const uciMap = await fetchUCIPointsFromCSV(csvUrl);
    console.log(`  📊 Fetched ${uciMap.size} riders from Google Sheets`);

    // Fetch all riders from DB
    const { data: riders } = await supabase
      .from("riders")
      .select("id, firstname, lastname, uci_points")
      .order("uci_points", { ascending: false });

    console.log(`  📂 Processing ${riders?.length || 0} riders in database`);

    const updates = [];

    for (const rider of riders || []) {
      const newPoints = findUCIPoints(rider, uciMap);

      const MIN_UCI = 5;

      if (newPoints === null) {
        notFound++;
        // Rider dropped off UCI list — sæt til minimum
        if (rider.uci_points !== MIN_UCI) {
          updates.push({ id: rider.id, uci_points: MIN_UCI });
        }
        continue;
      }

      const clampedPoints = Math.max(MIN_UCI, newPoints);
      if (clampedPoints !== rider.uci_points) {
        updates.push({ id: rider.id, uci_points: clampedPoints });
        updated++;
      } else {
        unchanged++;
      }
    }

    // Batch update
    const BATCH = 100;
    for (let i = 0; i < updates.length; i += BATCH) {
      const batch = updates.slice(i, i + BATCH);
      for (const u of batch) {
        await supabase.from("riders")
          .update({ uci_points: u.uci_points, updated_at: new Date().toISOString() })
          .eq("id", u.id);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // Log import
    await supabase.from("import_log").insert({
      import_type: "uci_points_sheets",
      rows_processed: riders?.length || 0,
      rows_updated: updates.length,
      rows_inserted: 0,
      errors: errors,
      imported_by: adminUserId,
    });

    const result = {
      success: true,
      sheets_riders: uciMap.size,
      db_riders: riders?.length || 0,
      updated: updates.length,
      unchanged,
      not_found: notFound,
      duration_seconds: parseFloat(duration),
    };

    console.log(`  ✅ Sync complete in ${duration}s:`, result);
    return result;

  } catch (err) {
    console.error("  ❌ Sync failed:", err.message);
    await supabase.from("import_log").insert({
      import_type: "uci_points_sheets",
      rows_processed: 0,
      errors: [{ message: err.message }],
      imported_by: adminUserId,
    });
    throw err;
  }
}

/**
 * Express route handler for admin panel sync button.
 */
export async function handleSyncRequest(req, res) {
  const csvUrl = process.env.GOOGLE_SHEETS_CSV_URL;

  if (!csvUrl) {
    return res.status(400).json({
      error: "GOOGLE_SHEETS_CSV_URL not configured in backend .env",
      hint: "Publish your Google Sheet as CSV: File → Share → Publish to web → CSV",
    });
  }

  try {
    const result = await syncUCIPoints(csvUrl, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
