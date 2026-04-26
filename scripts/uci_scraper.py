#!/usr/bin/env python3
"""
CyclingZone UCI Scraper
-----------------------
Henter UCI individuel world ranking (top N ryttere) fra ProCyclingStats,
skriver til Google Sheets og synkroniserer direkte til Supabase.

Kører automatisk via GitHub Actions hver mandag kl. 06:00 UTC.
Kan også køres manuelt:
  python uci_scraper.py              # fuld kørsel
  python uci_scraper.py --dry-run    # hent + skriv Sheets, spring Supabase over
  python uci_scraper.py --limit 100  # kun første 100 ryttere (test)
"""

import argparse
import json
import os
import time
import unicodedata
from datetime import datetime, timezone

import gspread
from google.oauth2.service_account import Credentials
from procyclingstats import Ranking
from supabase import create_client

RANKING_PATH = "rankings/me/uci-individual"
PAGE_SIZE = 100
MIN_UCI_POINTS = 5
REQUEST_DELAY_SEC = 1.5  # respektér PCS-serverne


# ── Navn-normalisering (matcher logik i sheetsSync.js) ──────────────────────

def normalize_name(name: str) -> str:
    return (
        unicodedata.normalize("NFKD", name)
        .encode("ascii", "ignore")
        .decode()
        .upper()
        .strip()
        .replace("  ", " ")
    )


# ── Hent rankings fra ProCyclingStats ───────────────────────────────────────

def fetch_rankings(limit: int) -> list[dict]:
    riders: list[dict] = []
    offset = 0

    while len(riders) < limit:
        url = f"{RANKING_PATH}?offset={offset}"
        try:
            page_data = Ranking(url).individual_ranking()
        except Exception as exc:
            print(f"  Advarsel: fejl ved offset {offset}: {exc}")
            break

        if not page_data:
            break

        want = min(PAGE_SIZE, limit - len(riders))
        riders.extend(page_data[:want])
        print(f"  Hentet {len(riders)}/{limit} (offset {offset})")

        if len(page_data) < PAGE_SIZE:
            break  # sidste side

        offset += PAGE_SIZE
        if len(riders) < limit:
            time.sleep(REQUEST_DELAY_SEC)

    return riders


# ── Google Sheets ────────────────────────────────────────────────────────────

def open_sheet(creds_json: str, sheet_id: str):
    creds_dict = json.loads(creds_json)
    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    creds = Credentials.from_service_account_info(creds_dict, scopes=scopes)
    client = gspread.authorize(creds)
    return client.open_by_key(sheet_id).sheet1


def write_to_sheet(sheet, riders: list[dict], updated_at: str) -> None:
    if riders:
        # Udskriv felt-navne fra første rytter så vi kan verificere formatet
        print(f"  PCS felt-navne: {list(riders[0].keys())}")

    rows = [["Rank", "Name", "Team", "Nationality", "UCI Points", "Updated"]]
    for r in riders:
        rows.append([
            r.get("rank", ""),
            r.get("rider_name", r.get("name", "")),
            r.get("team_name", r.get("team", "")),
            r.get("nationality", ""),
            int(r.get("points", 0) or 0),
            updated_at,
        ])

    sheet.clear()
    sheet.update("A1", rows, value_input_option="RAW")
    print(f"  Skrev {len(riders)} rækker til Google Sheets")


# ── Supabase-sync ────────────────────────────────────────────────────────────

def sync_supabase(riders: list[dict], synced_at: str, dry_run: bool) -> None:
    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_KEY"],
    )

    # Byg UCI-map: normaliseret navn → points
    uci_map: dict[str, int] = {}
    for r in riders:
        name = r.get("rider_name", r.get("name", ""))
        pts = int(r.get("points", 0) or 0)
        if name:
            uci_map[normalize_name(name)] = pts

    # Hent alle ryttere fra DB
    result = supabase.table("riders").select("id, firstname, lastname, uci_points").execute()
    db_riders = result.data or []
    print(f"  Matcher {len(uci_map)} UCI-ryttere mod {len(db_riders)} DB-ryttere")

    rider_updates: list[dict] = []
    history_rows: list[dict] = []
    not_found = 0

    for rider in db_riders:
        fn = rider.get("firstname") or ""
        ln = rider.get("lastname") or ""

        # Primære match-kandidater: "LASTNAME Firstname" og "Firstname LASTNAME"
        candidates = [
            normalize_name(f"{ln} {fn}"),
            normalize_name(f"{fn} {ln}"),
        ]
        new_pts: int | None = None
        for key in candidates:
            if key in uci_map:
                new_pts = uci_map[key]
                break

        # Fallback: delvis match på efternavn + første fornavn
        if new_pts is None:
            norm_ln = normalize_name(ln)
            norm_fn_first = normalize_name(fn).split()[0] if fn else ""
            if norm_ln and norm_fn_first:
                for uci_name, pts in uci_map.items():
                    if norm_ln in uci_name and norm_fn_first in uci_name:
                        new_pts = pts
                        break

        if new_pts is None:
            not_found += 1
            new_pts = MIN_UCI_POINTS

        new_pts = max(MIN_UCI_POINTS, new_pts)
        history_rows.append({
            "rider_id": rider["id"],
            "uci_points": new_pts,
            "synced_at": synced_at,
        })

        if new_pts != rider["uci_points"]:
            rider_updates.append({"id": rider["id"], "uci_points": new_pts})

    print(f"  {len(rider_updates)} ryttere opdateres, {not_found} ikke fundet i UCI-data")

    if dry_run:
        print("  [DRY RUN] springer Supabase-skrivning over")
        return

    # Opdatér riders
    for u in rider_updates:
        supabase.table("riders").update({
            "uci_points": u["uci_points"],
            "updated_at": synced_at,
        }).eq("id", u["id"]).execute()

    # Insert historikrækker i batches
    BATCH = 500
    for i in range(0, len(history_rows), BATCH):
        supabase.table("rider_uci_history").insert(history_rows[i:i + BATCH]).execute()

    print(f"  Loggede {len(history_rows)} historikrækker")


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="CyclingZone UCI scraper")
    parser.add_argument("--dry-run", action="store_true",
                        help="Hent + skriv Sheets, spring Supabase over")
    parser.add_argument("--limit", type=int, default=3000,
                        help="Maks antal ryttere (standard: 3000)")
    args = parser.parse_args()

    now = datetime.now(timezone.utc).isoformat()
    print(f"=== UCI Scraper {now} ===")
    print(f"Henter top {args.limit} ryttere fra ProCyclingStats...")

    riders = fetch_rankings(args.limit)
    print(f"Hentet {len(riders)} ryttere i alt")

    creds_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    sheet_id = os.environ.get("GOOGLE_SHEET_ID")

    if creds_json and sheet_id:
        print("Skriver til Google Sheets...")
        sheet = open_sheet(creds_json, sheet_id)
        write_to_sheet(sheet, riders, now)
    else:
        print("Springer Sheets over (GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_SHEET_ID mangler)")

    if os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_KEY"):
        print("Synkroniserer til Supabase...")
        sync_supabase(riders, now, args.dry_run)
    else:
        print("Springer Supabase over (env-variable mangler)")

    print("=== Færdig ===")


if __name__ == "__main__":
    main()
