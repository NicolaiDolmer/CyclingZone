#!/usr/bin/env python3
"""
Cycling Zone Manager — Race Results Import Script
=================================================
Parses PCM exported Excel result files and imports into database.

Handles sheets:
  - Stage results
  - General results (GC)
  - Points
  - Mountain
  - Team results
  - Young results (U25)

Usage:
  python import_race_results.py \
    --file "Tour_de_France_Stage21.xlsx" \
    --race-id UUID \
    --stage-number 21 \
    --supabase-url https://xxx.supabase.co \
    --supabase-key SERVICE_ROLE_KEY
"""

import argparse
import json
import re
import sys

import pandas as pd
import requests

SHEET_TO_TYPE = {
    "stage results": "stage",
    "general results": "gc",
    "points": "points",
    "mountain": "mountain",
    "team results": "team",
    "young results": "young",
}

# Prize money tables (points) — editable per race type
# Format: {result_type: {rank: prize}}
DEFAULT_PRIZES = {
    "stage": {1: 50, 2: 30, 3: 20, 4: 15, 5: 12, 6: 10, 7: 8, 8: 6, 9: 4, 10: 2},
    "gc":    {1: 200, 2: 150, 3: 100, 4: 75, 5: 50, 6: 40, 7: 30, 8: 20, 9: 15, 10: 10},
    "points":{1: 30, 2: 20, 3: 15},
    "mountain":{1: 30, 2: 20, 3: 15},
    "team":  {1: 100, 2: 70, 3: 50, 4: 30, 5: 20},
    "young": {1: 50, 2: 30, 3: 20},
}


def parse_result_sheet(df_raw: pd.DataFrame, result_type: str) -> list[dict]:
    """Parse a raw result sheet into structured records."""
    # Row 0 is the header row (it's stored as data due to merged title cell)
    headers = df_raw.iloc[0].tolist()
    df = df_raw.iloc[1:].copy()
    df.columns = [str(h).strip().lower() if pd.notna(h) else f"col_{i}"
                  for i, h in enumerate(headers)]
    df = df.dropna(subset=["rank"]).copy()
    df = df[df["rank"].astype(str).str.match(r"^\d+$")].copy()

    records = []
    prizes = DEFAULT_PRIZES.get(result_type, {})

    for _, row in df.iterrows():
        try:
            rank = int(row.get("rank", 0))
        except (ValueError, TypeError):
            continue

        name = str(row.get("name", "")).strip()
        team_name = str(row.get("team", "")).strip()
        finish_time = str(row.get("time", "")).strip()

        # Points columns vary by sheet type
        pts_earned = 0
        for col in ["points", "mountain", "stage points"]:
            if col in df.columns:
                try:
                    pts_earned = int(float(str(row.get(col, 0)).replace(",", ".")))
                except (ValueError, TypeError):
                    pass
                break

        prize = prizes.get(rank, 0)

        record = {
            "result_type": result_type,
            "rank": rank,
            "rider_name": name if result_type != "team" else None,
            "team_name": team_name,
            "finish_time": finish_time if finish_time not in ("nan", "") else None,
            "points_earned": pts_earned,
            "prize_money": prize,
        }
        records.append(record)

    return records


def load_result_file(path: str) -> dict[str, list[dict]]:
    """Load all sheets from PCM export and return typed result records."""
    print(f"📂 Loading race results from: {path}")
    xls = pd.ExcelFile(path, engine="openpyxl")
    all_results = {}

    for sheet_name in xls.sheet_names:
        normalized = sheet_name.strip().lower()
        result_type = SHEET_TO_TYPE.get(normalized)
        if result_type is None:
            print(f"  ⏭  Skipping unknown sheet: {sheet_name}")
            continue

        df_raw = pd.read_excel(xls, sheet_name=sheet_name, header=None)
        records = parse_result_sheet(df_raw, result_type)
        all_results[result_type] = records
        print(f"  ✅ {sheet_name}: {len(records)} results parsed")

    return all_results


def resolve_team_ids(records: list[dict], supabase_url: str,
                      supabase_key: str) -> list[dict]:
    """Try to match rider/team names to database IDs."""
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
    }

    # Fetch all teams
    resp = requests.get(f"{supabase_url}/rest/v1/teams?select=id,name",
                        headers=headers)
    teams = {t["name"].lower(): t["id"] for t in resp.json()} if resp.ok else {}

    # Fetch all riders (name -> id)
    resp = requests.get(
        f"{supabase_url}/rest/v1/riders?select=id,firstname,lastname",
        headers=headers
    )
    riders = {}
    if resp.ok:
        for r in resp.json():
            full = f"{r['firstname']} {r['lastname']}".lower()
            riders[full] = r["id"]

    for rec in records:
        if rec.get("rider_name"):
            rec["rider_id"] = riders.get(rec["rider_name"].lower())
        if rec.get("team_name"):
            rec["team_id"] = teams.get(rec["team_name"].lower())

    return records


def upsert_results(race_id: str, stage_number: int, all_results: dict,
                    supabase_url: str, supabase_key: str,
                    dry_run: bool = False) -> dict:
    """Insert race results and trigger prize money updates."""
    flat_records = []
    for result_type, records in all_results.items():
        for rec in records:
            rec["race_id"] = race_id
            rec["stage_number"] = stage_number
            flat_records.append(rec)

    if dry_run:
        print(f"\n🔍 DRY RUN — {len(flat_records)} result records")
        for rt, recs in all_results.items():
            print(f"  {rt}: {len(recs)} records, "
                  f"total prizes: {sum(r['prize_money'] for r in recs)} pts")
        return {}

    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    resp = requests.post(
        f"{supabase_url}/rest/v1/race_results",
        headers=headers,
        json=flat_records,
        timeout=30,
    )

    if resp.status_code in (200, 201):
        print(f"  ✅ {len(flat_records)} results inserted")
        _distribute_prizes(all_results, supabase_url, supabase_key)
        return {"inserted": len(flat_records)}
    else:
        print(f"  ❌ Failed: {resp.status_code} — {resp.text[:200]}")
        return {"error": resp.text}


def _distribute_prizes(all_results: dict, url: str, key: str):
    """Credit prize money to team balances based on results."""
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    # Fetch team balances
    resp = requests.get(f"{url}/rest/v1/teams?select=id,name,balance,user_id",
                        headers=headers)
    if not resp.ok:
        print("  ⚠️  Could not fetch teams for prize distribution")
        return

    teams_by_name = {t["name"].lower(): t for t in resp.json()}
    team_prizes: dict[str, int] = {}

    for result_type, records in all_results.items():
        for rec in records:
            if rec.get("prize_money", 0) > 0 and rec.get("team_name"):
                t_key = rec["team_name"].lower()
                team_prizes[t_key] = team_prizes.get(t_key, 0) + rec["prize_money"]

    for team_name, total_prize in team_prizes.items():
        team = teams_by_name.get(team_name)
        if not team:
            continue

        new_balance = team["balance"] + total_prize
        # Update balance
        requests.patch(
            f"{url}/rest/v1/teams?id=eq.{team['id']}",
            headers=headers,
            json={"balance": new_balance},
        )
        # Log transaction
        requests.post(
            f"{url}/rest/v1/finance_transactions",
            headers=headers,
            json={
                "team_id": team["id"],
                "type": "prize",
                "amount": total_prize,
                "description": f"Race prize money",
            },
        )

    print(f"  💰 Prize money distributed to {len(team_prizes)} teams")


def main():
    parser = argparse.ArgumentParser(description="Import race results")
    parser.add_argument("--file", required=True, help="PCM export Excel file")
    parser.add_argument("--race-id", required=True, help="Race UUID in database")
    parser.add_argument("--stage-number", type=int, default=1)
    parser.add_argument("--supabase-url")
    parser.add_argument("--supabase-key")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("🏆 Cycling Zone Manager — Race Results Import")
    print("=" * 50)

    all_results = load_result_file(args.file)

    total = sum(len(v) for v in all_results.items())
    total_prize = sum(
        r["prize_money"] for recs in all_results.values() for r in recs
    )
    print(f"\n📊 Loaded {len(all_results)} result categories")
    print(f"   Total prize pool: {total_prize} pts")

    if args.supabase_url and args.supabase_key:
        result = upsert_results(
            args.race_id, args.stage_number, all_results,
            args.supabase_url, args.supabase_key, args.dry_run
        )
        print(f"\n✅ Done: {result}")
    else:
        print("\n⚠️  No Supabase credentials — showing dry run")
        upsert_results(args.race_id, args.stage_number, all_results,
                       "", "", dry_run=True)

    print("\n🏁 Import complete!")


if __name__ == "__main__":
    main()
