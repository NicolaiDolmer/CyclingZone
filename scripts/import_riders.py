#!/usr/bin/env python3
"""
Cycling Zone Manager — Rider Import Script
==========================================
Reads WORLD_DB xlsx (PCM rider database) and merges with
Google Sheets UCI points to populate the riders table.

Usage:
  python import_riders.py --worlddb WORLD_DB_2026_Dyn_Cyclist.xlsx \
                           --sheets-csv uci_top1000.csv \
                           --supabase-url https://xxx.supabase.co \
                           --supabase-key SERVICE_ROLE_KEY
"""

import argparse
import json
import sys
from datetime import date, datetime

import pandas as pd
import requests

# ── Column mapping from PCM WORLD_DB ──────────────────────────────────────────
STAT_MAP = {
    "stat_fl":  "charac_i_plain",
    "stat_bj":  "charac_i_mountain",
    "stat_kb":  "charac_i_medium_mountain",
    "stat_bk":  "charac_i_hill",
    "stat_tt":  "charac_i_timetrial",
    "stat_prl": "charac_i_prologue",
    "stat_bro": "charac_i_cobble",
    "stat_sp":  "charac_i_sprint",
    "stat_acc": "charac_i_acceleration",
    "stat_ned": "charac_i_downhilling",
    "stat_udh": "charac_i_endurance",
    "stat_mod": "charac_i_resistance",
    "stat_res": "charac_i_recuperation",
    "stat_ftr": "charac_i_baroudeur",
}

U25_CUTOFF_YEAR = date.today().year - 25  # born after this year = U25


def parse_birthdate(raw) -> date | None:
    """Parse PCM birthdate integer (YYYYMMDD) to date."""
    try:
        s = str(int(raw))
        return datetime.strptime(s, "%Y%m%d").date()
    except Exception:
        return None


def is_u25(birthdate: date | None) -> bool:
    if birthdate is None:
        return False
    return birthdate.year > U25_CUTOFF_YEAR


def normalize_name(name: str) -> str:
    """Normalize name for matching: uppercase, strip accents best-effort."""
    import unicodedata
    nfkd = unicodedata.normalize("NFKD", name.upper())
    return "".join(c for c in nfkd if not unicodedata.combining(c)).strip()


def load_worlddb(path: str) -> pd.DataFrame:
    """Load and clean WORLD_DB rider sheet."""
    print(f"📂 Loading WORLD_DB from: {path}")
    df = pd.read_excel(path, sheet_name="Dyn_Cyclist", engine="openpyxl")

    required = ["IDcyclist", "gene_sz_lastname", "gene_sz_firstname",
                "gene_i_birthdate", "fkIDteam"]
    for col in required:
        if col not in df.columns:
            raise ValueError(f"Missing required column: {col}")

    # Keep only columns we need
    keep = required + ["fkIDregion", "gene_f_popularity", "gene_i_size",
                       "gene_i_weight"] + list(STAT_MAP.values())
    existing = [c for c in keep if c in df.columns]
    df = df[existing].copy()

    # Parse birthdate
    df["birthdate_parsed"] = df["gene_i_birthdate"].apply(parse_birthdate)
    df["is_u25"] = df["birthdate_parsed"].apply(is_u25)

    # Normalize name for matching
    df["_match_name"] = (
        df["gene_sz_lastname"].fillna("") + " " +
        df["gene_sz_firstname"].fillna("")
    ).apply(normalize_name)

    print(f"  ✅ {len(df)} riders loaded from WORLD_DB")
    return df


def load_uci_points(path: str) -> dict[str, int]:
    """
    Load UCI top-1000 from CSV export of Google Sheets.
    Returns dict: normalized_name -> uci_points
    Format expected: columns Pos, Navn, Point
    """
    print(f"📂 Loading UCI points from: {path}")
    df = pd.read_csv(path)

    # Try to find name and points columns flexibly
    name_col = next((c for c in df.columns if "navn" in c.lower() or "name" in c.lower()), None)
    pts_col = next((c for c in df.columns if "point" in c.lower()), None)

    if not name_col or not pts_col:
        raise ValueError(f"Cannot find name/points columns. Found: {list(df.columns)}")

    result = {}
    for _, row in df.iterrows():
        name = str(row[name_col]).strip()
        try:
            pts = int(float(row[pts_col]))
        except (ValueError, TypeError):
            continue
        # UCI sheets format: "POGAČAR Tadej" → normalize
        normalized = normalize_name(name)
        result[normalized] = pts

    print(f"  ✅ {len(result)} riders with UCI points loaded")
    return result


def merge_data(worlddb: pd.DataFrame, uci_map: dict[str, int]) -> list[dict]:
    """Merge WORLD_DB stats with UCI points."""
    records = []
    matched = 0
    unmatched = 0

    for _, row in worlddb.iterrows():
        # Try direct name match
        match_key = row["_match_name"]
        uci_pts = uci_map.get(match_key)

        # Try reversed name (firstname lastname)
        if uci_pts is None:
            parts = match_key.split()
            if len(parts) >= 2:
                reversed_key = " ".join(reversed(parts))
                uci_pts = uci_map.get(reversed_key)

        if uci_pts is not None:
            matched += 1
        else:
            uci_pts = 1
            unmatched += 1

        record = {
            "pcm_id": int(row["IDcyclist"]),
            "firstname": str(row.get("gene_sz_firstname", "")).strip(),
            "lastname": str(row.get("gene_sz_lastname", "")).strip(),
            "birthdate": row["birthdate_parsed"].isoformat() if row["birthdate_parsed"] else None,
            "height": int(row["gene_i_size"]) if pd.notna(row.get("gene_i_size")) else None,
            "weight": int(row["gene_i_weight"]) if pd.notna(row.get("gene_i_weight")) else None,
            "popularity": int(row.get("gene_f_popularity", 0) or 0),
            "uci_points": uci_pts,
            "salary": 0,
            "is_u25": bool(row["is_u25"]),
            "nationality_code": None,  # Added later
        }

        # Add stats
        for stat_key, pcm_col in STAT_MAP.items():
            val = row.get(pcm_col)
            record[stat_key] = int(val) if pd.notna(val) and val != 0 else None

        records.append(record)

    print(f"  ✅ Matched {matched} riders to UCI points, {unmatched} set to price=1")
    return records


def upsert_to_supabase(records: list[dict], url: str, key: str,
                        dry_run: bool = False) -> dict:
    """Upsert riders to Supabase via REST API."""
    if dry_run:
        print(f"  🔍 DRY RUN — would upsert {len(records)} riders")
        print("  Sample record:", json.dumps(records[0], indent=2, default=str))
        return {"inserted": 0, "updated": 0}

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }

    BATCH_SIZE = 500
    inserted = 0
    errors = []

    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i:i + BATCH_SIZE]
        resp = requests.post(
            f"{url}/rest/v1/riders",
            headers=headers,
            json=batch,
            timeout=30,
        )
        if resp.status_code in (200, 201):
            inserted += len(batch)
            print(f"  ✅ Batch {i//BATCH_SIZE + 1}: {len(batch)} riders upserted")
        else:
            errors.append({"batch": i, "status": resp.status_code, "body": resp.text[:200]})
            print(f"  ❌ Batch {i//BATCH_SIZE + 1} failed: {resp.status_code} — {resp.text[:100]}")

    return {"inserted": inserted, "errors": errors}


def main():
    parser = argparse.ArgumentParser(description="Import riders into Cycling Zone Manager")
    parser.add_argument("--worlddb", required=True, help="Path to WORLD_DB xlsx file")
    parser.add_argument("--sheets-csv", required=True, help="Path to UCI points CSV")
    parser.add_argument("--supabase-url", help="Supabase project URL")
    parser.add_argument("--supabase-key", help="Supabase service role key")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--output-json", help="Also save merged data to JSON file")
    args = parser.parse_args()

    print("🚴 Cycling Zone Manager — Rider Import")
    print("=" * 50)

    worlddb = load_worlddb(args.worlddb)
    uci_map = load_uci_points(args.sheets_csv)
    records = merge_data(worlddb, uci_map)

    print(f"\n📊 Summary:")
    print(f"  Total riders: {len(records)}")
    print(f"  U25 riders: {sum(1 for r in records if r['is_u25'])}")
    print(f"  With UCI points > 1: {sum(1 for r in records if r['uci_points'] > 1)}")

    if args.output_json:
        with open(args.output_json, "w") as f:
            json.dump(records, f, default=str, indent=2)
        print(f"\n💾 Saved to {args.output_json}")

    if args.supabase_url and args.supabase_key:
        print(f"\n⬆️  Upserting to Supabase...")
        result = upsert_to_supabase(records, args.supabase_url,
                                     args.supabase_key, args.dry_run)
        print(f"\n✅ Done: {result['inserted']} riders processed")
    elif not args.dry_run:
        print("\n⚠️  No Supabase credentials provided. Use --dry-run or provide --supabase-url and --supabase-key")

    print("\n🏁 Import complete!")


if __name__ == "__main__":
    main()
