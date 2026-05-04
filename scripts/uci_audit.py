#!/usr/bin/env python3
"""
UCI name-mismatch audit
=======================
Identificerer DB-ryttere der har `uci_points = 5` (fallback-default)
selvom et token-baseret match mod CSV ville give >5.

Output:
  - Liste over kandidater (pcm_id, name, expected_pts) til konsollen
  - SQL fix-migration til `database/2026-05-04-fix-uci-points-token-mismatch.sql`

Brug:
  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python scripts/uci_audit.py

Køres som engangsscript før `uci_scraper.py` får ny match-logik.
Efter den nye scraper er deployet, vil mandags-cron'en selv fange disse.
"""
from __future__ import annotations

import csv
import os
import sys
from pathlib import Path

import requests

# Genbrug normalisering fra scraperen — én sandhedskilde
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))
from uci_scraper import normalize_name, name_tokens  # noqa: E402

CSV_PATH = SCRIPT_DIR / "uci_top1000.csv"
OUT_SQL = SCRIPT_DIR.parent / "database" / "2026-05-04-fix-uci-points-token-mismatch.sql"


def _clean_env(var: str) -> str:
    return "".join(os.environ[var].split())


def load_uci_csv(path: Path) -> dict[frozenset[str], tuple[str, int]]:
    """Returnér map: token-set → (csv_name, points)."""
    out: dict[frozenset[str], tuple[str, int]] = {}
    with path.open(encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            name = row["Name"].strip()
            try:
                pts = int(row["UCI Points"])
            except (TypeError, ValueError):
                continue
            tokens = name_tokens(name)
            if not tokens:
                continue
            # Hvis to UCI-ryttere har samme token-set, behold den med flest points
            if tokens not in out or out[tokens][1] < pts:
                out[tokens] = (name, pts)
    return out


def fetch_db_riders() -> list[dict]:
    headers = {
        "apikey": _clean_env("SUPABASE_SERVICE_KEY"),
        "Authorization": f"Bearer {_clean_env('SUPABASE_SERVICE_KEY')}",
    }
    base = f"{_clean_env('SUPABASE_URL')}/rest/v1/riders"
    out: list[dict] = []
    page_size = 1000
    offset = 0
    while True:
        url = f"{base}?select=id,pcm_id,firstname,lastname,uci_points,popularity&limit={page_size}&offset={offset}"
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        page = resp.json()
        out.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return out


def find_match(rider: dict, uci_map: dict[frozenset[str], tuple[str, int]]) -> tuple[str, int] | None:
    fn = rider.get("firstname") or ""
    ln = rider.get("lastname") or ""
    db_tokens = name_tokens(f"{fn} {ln}")
    if not db_tokens:
        return None

    # 1. Eksakt token-set match
    if db_tokens in uci_map:
        return uci_map[db_tokens]

    # 2. DB ⊆ UCI (UCI har middle name DB ikke har)
    for uci_tokens, value in uci_map.items():
        if db_tokens.issubset(uci_tokens):
            return value

    # 3. UCI ⊆ DB (DB har middle name UCI ikke har, fx "Mateo Pablo Ramírez" vs "RAMÍREZ Mateo")
    for uci_tokens, value in uci_map.items():
        if uci_tokens.issubset(db_tokens) and len(uci_tokens) >= 2:
            return value

    return None


def main() -> None:
    print(f"Læser CSV: {CSV_PATH}")
    uci_map = load_uci_csv(CSV_PATH)
    print(f"  {len(uci_map)} unikke token-set-keys")

    print("Henter DB-ryttere...")
    db_riders = fetch_db_riders()
    print(f"  {len(db_riders)} riders i DB")

    candidates: list[dict] = []
    for rider in db_riders:
        if rider["uci_points"] != 5:
            continue
        match = find_match(rider, uci_map)
        if match is None:
            continue
        csv_name, csv_pts = match
        if csv_pts <= 5:
            continue
        candidates.append({
            **rider,
            "csv_name": csv_name,
            "expected_pts": csv_pts,
        })

    candidates.sort(key=lambda r: -r["expected_pts"])

    print(f"\n=== {len(candidates)} kandidater ===")
    for c in candidates:
        print(
            f"  pcm_id={c['pcm_id']:>5} pop={c['popularity']:>3}  "
            f"DB: {c['firstname']!r:<25} {c['lastname']!r:<30} "
            f"-> UCI: {c['csv_name']!r} = {c['expected_pts']}"
        )

    if not candidates:
        print("Ingen kandidater fundet — alle uci_points=5 er legitim.")
        return

    OUT_SQL.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = [
        "-- Auto-genereret af scripts/uci_audit.py 2026-05-04",
        "-- Token-baseret match fanger compound surnames (Lund Andresen, Halland Johannessen).",
        "-- salary er GENERATED siden v2.25 — opdateres automatisk.",
        "UPDATE riders SET uci_points = v.pts",
        "FROM (VALUES",
    ]
    for i, c in enumerate(candidates):
        sep = "," if i < len(candidates) - 1 else ""
        comment = f"-- {c['firstname']} {c['lastname']} ← UCI: {c['csv_name']}"
        lines.append(f"  ({c['pcm_id']:>5}, {c['expected_pts']:>5}){sep}  {comment}")
    lines.append(") AS v(pcm_id, pts)")
    lines.append("WHERE riders.pcm_id = v.pcm_id;")
    OUT_SQL.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nFix-migration skrevet: {OUT_SQL}")


if __name__ == "__main__":
    main()
