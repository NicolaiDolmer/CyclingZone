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
// Holder denne logik byte-equivalent med scripts/uci_scraper.py \u2014 sync-divergence
// var root cause for Tobias Lund Andresen-bug 2026-05-04. \u00c6/\u00d8/\u00c5/\u0141 dekomponeres
// IKKE af NFKD og forsvinder ved ASCII-strip \u2014 substitu\u00e9r eksplicit f\u00f8rst.
const VOWEL_SUBS = [
  ["\u00e6", "ae"], ["\u00c6", "AE"],
  ["\u00f8", "oe"], ["\u00d8", "OE"],
  ["\u00e5", "aa"], ["\u00c5", "AA"],
  ["\u0142", "l"], ["\u0141", "L"],
  ["\u00df", "ss"],
];

const HIGH_VALUE_POPULARITY_THRESHOLD = 70;
const HIGH_VALUE_UCI_POINTS_THRESHOLD = 100;

function normalizeName(name) {
  if (!name) return "";
  let s = name;
  for (const [src, dst] of VOWEL_SUBS) s = s.split(src).join(dst);
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[-'.]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function nameTokenKey(name) {
  const norm = normalizeName(name);
  if (!norm) return null;
  return norm.split(" ").sort().join(" ");
}

function nameTokenSet(name) {
  const norm = normalizeName(name);
  return norm ? new Set(norm.split(" ")) : new Set();
}

function isSubset(small, large) {
  for (const t of small) if (!large.has(t)) return false;
  return true;
}

/**
 * Fetch UCI points from Google Sheets published CSV URL.
 * Returns Map: sortedTokenKey → { tokens: Set<string>, points: number }
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
    if (!name || isNaN(pts)) continue;
    const key = nameTokenKey(name);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing || existing.points < pts) {
      map.set(key, { tokens: nameTokenSet(name), points: pts });
    }
  }

  return map;
}

/**
 * Token-set-baseret match. Fanger compound surnames (Lund Andresen, Halland
 * Johannessen) som string-permutationer ikke ville fange.
 */
function findUCIPoints(rider, uciMap) {
  const fullName = `${rider.firstname || ""} ${rider.lastname || ""}`;
  const dbKey = nameTokenKey(fullName);
  if (!dbKey) return null;

  const exact = uciMap.get(dbKey);
  if (exact) return exact.points;

  const dbTokens = nameTokenSet(fullName);

  // DB ⊆ UCI (UCI har middle name DB ikke har)
  for (const { tokens, points } of uciMap.values()) {
    if (isSubset(dbTokens, tokens)) return points;
  }

  // UCI ⊆ DB (DB har middle name UCI ikke har); kræv min. 2 tokens for at undgå false positives
  for (const { tokens, points } of uciMap.values()) {
    if (tokens.size >= 2 && isSubset(tokens, dbTokens)) return points;
  }

  return null;
}

function isHighValueRider(rider) {
  return (
    (rider.popularity || 0) >= HIGH_VALUE_POPULARITY_THRESHOLD ||
    (rider.uci_points || 0) >= HIGH_VALUE_UCI_POINTS_THRESHOLD
  );
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

    // Fetch all riders from DB (popularity needed for high-value safety-gate)
    const { data: riders } = await supabase
      .from("riders")
      .select("id, firstname, lastname, uci_points, popularity")
      .order("uci_points", { ascending: false });

    console.log(`  📂 Processing ${riders?.length || 0} riders in database`);

    const updates = [];
    const highValueProtected = [];
    const MIN_UCI = 5;

    for (const rider of riders || []) {
      const newPoints = findUCIPoints(rider, uciMap);

      if (newPoints === null) {
        notFound++;
        // High-value safety-gate: aldrig auto-downgrade kendte ryttere til MIN
        // pga. name-mismatch (Tobias Lund Andresen-bug 2026-05-04).
        if (isHighValueRider(rider) && rider.uci_points > MIN_UCI) {
          highValueProtected.push({
            id: rider.id,
            name: `${rider.firstname || ""} ${rider.lastname || ""}`.trim(),
            current: rider.uci_points,
            popularity: rider.popularity || 0,
          });
          continue;
        }
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

    if (highValueProtected.length > 0) {
      console.warn(
        `  ⚠ ${highValueProtected.length} high-value ryttere uden match — bevarede nuværende uci_points:`
      );
      for (const r of highValueProtected.slice(0, 10)) {
        console.warn(`    ${r.name} pop=${r.popularity} pts=${r.current}`);
      }
    }

    // Batch update + historiklog
    const syncedAt = new Date().toISOString();
    const historyRows = [];
    const BATCH = 100;
    for (let i = 0; i < updates.length; i += BATCH) {
      const batch = updates.slice(i, i + BATCH);
      for (const u of batch) {
        await supabase.from("riders")
          .update({ uci_points: u.uci_points, updated_at: syncedAt })
          .eq("id", u.id);
        historyRows.push({ rider_id: u.id, uci_points: u.uci_points, synced_at: syncedAt });
      }
    }

    if (historyRows.length > 0) {
      for (let i = 0; i < historyRows.length; i += BATCH) {
        await supabase.from("rider_uci_history").insert(historyRows.slice(i, i + BATCH));
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
      high_value_protected: highValueProtected.length,
      history_logged: historyRows.length,
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
