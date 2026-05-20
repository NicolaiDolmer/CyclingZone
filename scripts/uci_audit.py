#!/usr/bin/env python3
"""
UCI name-mismatch audit
=======================
To audit-modes:

  --mode exact      (default) — Token-set-match (eksakt + subset). Fanger
                    compound surnames og middle-name-drift. Originalt skrevet
                    til Tobias Lund Andresen-fix 2026-05-04. Output: SQL-fix.

  --mode translit   — Fuzzy first-name-match med exact lastname-token.
                    Fanger translitterations-divergens (Matvey/Matvei,
                    Sergey/Sergei, Andrey/Andrei, Dmitry/Dmitri etc.).
                    Output: UCI_NAME_OVERRIDE-entries til uci_scraper.py.

To kilder:

  --source csv      (default) — Lokal scripts/uci_top1000.csv (hurtig, men
                    kan vaere stale; advarer hvis > 7 dage gammel).
  --source live     — Fresh scrape fra ProCyclingStats (~75 sek for top-3000).
                    Bruger procyclingstats-libben — samme som uci_scraper.py.
  --source sheet    — Google Sheet via service account (~3 sek). Kraever
                    GOOGLE_SERVICE_ACCOUNT_JSON + GOOGLE_SHEET_ID env-vars
                    (sat af .github/workflows/uci-translit-audit.yml).

Brug:
  python scripts/uci_audit.py                        # exact-mode, csv
  python scripts/uci_audit.py --mode translit        # translit-mode, csv
  python scripts/uci_audit.py --mode translit --source live    # friskeste data

Output skrives til:
  database/2026-05-04-fix-uci-points-token-mismatch.sql  (exact-mode)
  audit-output/uci_translit_<dato>.{csv,py}              (translit-mode)
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

import requests

SCRIPT_DIR = Path(__file__).parent
ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))
from uci_scraper import (  # noqa: E402
    UCI_NAME_OVERRIDE,
    fetch_rankings,
    name_tokens,
    normalize_name,
    rider_name,
)

CSV_PATH = SCRIPT_DIR / "uci_top1000.csv"
OUT_SQL = ROOT / "database" / "2026-05-04-fix-uci-points-token-mismatch.sql"
AUDIT_DIR = ROOT / "audit-output"

# Translit-mode defaults
FUZZY_THRESHOLD = 0.6   # SequenceMatcher.ratio() — fanger Matvey/Matvei (~0.83)
MIN_SHEET_POINTS = 10   # skip noise lavt i top-3000
STALE_CSV_DAYS = 7


def _clean_env(var: str) -> str:
    return "".join(os.environ[var].split())


# ── Data-kilder ─────────────────────────────────────────────────────────────

def load_uci_csv(path: Path) -> list[dict]:
    """Returnerer liste af {name, points} dicts. Advarer hvis stale."""
    if not path.exists():
        sys.exit(f"FEJL: {path} findes ikke. Brug --source live for fresh scrape.")

    rows: list[dict] = []
    csv_updated: str | None = None
    with path.open(encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            name = row.get("Name", "").strip()
            try:
                pts = int(row.get("UCI Points", "0"))
            except (TypeError, ValueError):
                continue
            if not name:
                continue
            rows.append({"name": name, "points": pts})
            if csv_updated is None and row.get("Updated"):
                csv_updated = row["Updated"]

    if csv_updated:
        try:
            ts = datetime.fromisoformat(csv_updated.replace("Z", "+00:00"))
            age_days = (datetime.now(timezone.utc) - ts).days
            if age_days > STALE_CSV_DAYS:
                print(
                    f"  ADVARSEL: CSV er {age_days} dage gammel (opdateret {csv_updated[:10]}). "
                    f"Brug --source live for fresh data."
                )
        except ValueError:
            pass

    return rows


def load_uci_live(limit: int) -> list[dict]:
    """Fresh PCS-scrape via procyclingstats. ~75 sek for top-3000."""
    print(f"  Henter PCS top-{limit} (~{limit * 1.5 / 100:.0f} sek)...")
    report = fetch_rankings(limit)
    return [
        {"name": rider_name(r), "points": int(r.get("points", 0) or 0)}
        for r in report["riders"]
    ]


def load_uci_sheet() -> list[dict]:
    """Laes Google Sheet via service account (samme som uci_scraper.py skriver).
    Kraever GOOGLE_SERVICE_ACCOUNT_JSON + GOOGLE_SHEET_ID i env (set af GitHub Actions)."""
    import json
    import gspread
    from google.oauth2.service_account import Credentials

    creds_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    sheet_id = os.environ.get("GOOGLE_SHEET_ID")
    if not creds_json or not sheet_id:
        sys.exit(
            "FEJL: --source sheet kraever GOOGLE_SERVICE_ACCOUNT_JSON + "
            "GOOGLE_SHEET_ID env-vars. Koer via GitHub Actions eller saet lokalt."
        )

    print(f"  Aabner Google Sheet {sheet_id[:12]}... via service account")
    creds = Credentials.from_service_account_info(
        json.loads(creds_json),
        scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
    )
    client = gspread.authorize(creds)
    sheet = client.open_by_key(sheet_id).sheet1
    rows = sheet.get_all_values()
    if not rows or len(rows) < 2:
        sys.exit("FEJL: Sheet er tomt.")

    header = [h.strip().lower() for h in rows[0]]
    name_idx = next((i for i, h in enumerate(header) if "name" in h), -1)
    pts_idx = next((i for i, h in enumerate(header) if "point" in h), -1)
    if name_idx < 0 or pts_idx < 0:
        sys.exit(f"FEJL: kunne ikke finde name/points kolonner i header: {header}")

    out: list[dict] = []
    for row in rows[1:]:
        if not row or len(row) <= max(name_idx, pts_idx):
            continue
        name = row[name_idx].strip()
        try:
            pts = int(row[pts_idx])
        except (TypeError, ValueError):
            continue
        if not name:
            continue
        out.append({"name": name, "points": pts})
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
        url = (
            f"{base}?select=id,pcm_id,firstname,lastname,uci_points,popularity,"
            f"nationality_code&limit={page_size}&offset={offset}"
        )
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        page = resp.json()
        out.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return out


# ── EXACT mode (original) ───────────────────────────────────────────────────

def build_uci_token_map(rows: list[dict]) -> dict[frozenset[str], tuple[str, int]]:
    """Returner map: token-set -> (name, points). Hvis dublet, behold hoejeste pts."""
    out: dict[frozenset[str], tuple[str, int]] = {}
    for r in rows:
        tokens = name_tokens(r["name"])
        if not tokens:
            continue
        if tokens not in out or out[tokens][1] < r["points"]:
            out[tokens] = (r["name"], r["points"])
    return out


def find_exact_match(
    rider: dict, uci_map: dict[frozenset[str], tuple[str, int]]
) -> tuple[str, int] | None:
    fn = rider.get("firstname") or ""
    ln = rider.get("lastname") or ""
    db_tokens = name_tokens(f"{fn} {ln}")
    if not db_tokens:
        return None

    if db_tokens in uci_map:
        return uci_map[db_tokens]
    for uci_tokens, value in uci_map.items():
        if db_tokens.issubset(uci_tokens):
            return value
    for uci_tokens, value in uci_map.items():
        if uci_tokens.issubset(db_tokens) and len(uci_tokens) >= 2:
            return value
    return None


def run_exact_mode(uci_rows: list[dict], db_riders: list[dict]) -> int:
    uci_map = build_uci_token_map(uci_rows)
    print(f"  {len(uci_map)} unikke UCI token-set-keys")

    candidates: list[dict] = []
    for rider in db_riders:
        if rider["uci_points"] != 5:
            continue
        match = find_exact_match(rider, uci_map)
        if match is None:
            continue
        csv_name, csv_pts = match
        if csv_pts <= 5:
            continue
        candidates.append({**rider, "csv_name": csv_name, "expected_pts": csv_pts})

    candidates.sort(key=lambda r: -r["expected_pts"])
    print(f"\n=== EXACT-mode: {len(candidates)} kandidater ===")
    for c in candidates:
        print(
            f"  pcm_id={c['pcm_id']:>5} pop={c['popularity']:>3}  "
            f"DB: {c['firstname']!r:<25} {c['lastname']!r:<30} "
            f"-> UCI: {c['csv_name']!r} = {c['expected_pts']}"
        )

    if not candidates:
        print("Ingen kandidater fundet — alle uci_points=5 er legitime via exact-match.")
        return 0

    OUT_SQL.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = [
        "-- Auto-genereret af scripts/uci_audit.py --mode exact",
        f"-- Genereret: {datetime.now().strftime('%Y-%m-%d')}",
        "-- Token-baseret match fanger compound surnames + middle-name-drift.",
        "-- salary er GENERATED siden v2.25 - opdateres automatisk.",
        "UPDATE riders SET uci_points = v.pts",
        "FROM (VALUES",
    ]
    for i, c in enumerate(candidates):
        sep = "," if i < len(candidates) - 1 else ""
        comment = f"-- {c['firstname']} {c['lastname']} <- UCI: {c['csv_name']}"
        lines.append(f"  ({c['pcm_id']:>5}, {c['expected_pts']:>5}){sep}  {comment}")
    lines.append(") AS v(pcm_id, pts)")
    lines.append("WHERE riders.pcm_id = v.pcm_id;")
    OUT_SQL.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nFix-migration skrevet: {OUT_SQL}")
    return len(candidates)


# ── TRANSLIT mode (ny) ──────────────────────────────────────────────────────

def first_name_similarity(db_full: str, sheet_full: str, shared: frozenset[str]) -> float:
    db_norm = normalize_name(db_full).split()
    sheet_norm = normalize_name(sheet_full).split()
    db_first = " ".join(t for t in db_norm if t not in shared)
    sheet_first = " ".join(t for t in sheet_norm if t not in shared)
    if not db_first or not sheet_first:
        return 0.0
    return SequenceMatcher(None, db_first, sheet_first).ratio()


def run_translit_mode(
    uci_rows: list[dict],
    db_riders: list[dict],
    threshold: float,
    min_points: int,
) -> int:
    # Index alle UCI-tokens -> liste af {name, points, tokens}
    sheet_by_token: dict[str, list[dict]] = {}
    for r in uci_rows:
        if r["points"] < min_points:
            continue
        tokens = name_tokens(r["name"])
        if len(tokens) < 2:
            continue
        entry = {"name": r["name"], "points": r["points"], "tokens": tokens}
        for t in tokens:
            sheet_by_token.setdefault(t, []).append(entry)
    print(f"  {sum(len(v) for v in sheet_by_token.values())} token-pointers fra "
          f"{len(uci_rows)} UCI-ryttere")

    already_overridden = set(UCI_NAME_OVERRIDE.keys())
    stuck = [r for r in db_riders if r["uci_points"] == 5]
    print(f"  {len(stuck)} DB-ryttere paa MIN=5 ud af {len(db_riders)} total")

    candidates: list[dict] = []
    for rider in stuck:
        fn = rider.get("firstname") or ""
        ln = rider.get("lastname") or ""
        db_full = f"{fn} {ln}".strip()
        if normalize_name(db_full) in already_overridden:
            continue
        db_tokens = name_tokens(db_full)
        if len(db_tokens) < 2:
            continue

        best: dict | None = None
        best_sim = 0.0
        seen: set[str] = set()

        for db_tok in db_tokens:
            for entry in sheet_by_token.get(db_tok, []):
                if entry["name"] in seen:
                    continue
                # Skip hvis scraperen ALLEREDE matcher (eksakt / subset)
                if db_tokens == entry["tokens"]:
                    continue
                if db_tokens.issubset(entry["tokens"]) or entry["tokens"].issubset(db_tokens):
                    continue
                shared = db_tokens & entry["tokens"]
                if not shared:
                    continue
                seen.add(entry["name"])
                sim = first_name_similarity(db_full, entry["name"], shared)
                if sim > best_sim and sim >= threshold:
                    best_sim = sim
                    best = entry

        if best is not None:
            candidates.append({
                "rider_id": rider["id"],
                "pcm_id": rider["pcm_id"],
                "db_name": db_full,
                "db_nationality": rider.get("nationality_code") or "",
                "sheet_name": best["name"],
                "sheet_points": best["points"],
                "similarity": round(best_sim, 3),
                "popularity": rider.get("popularity") or 0,
            })

    candidates.sort(key=lambda c: (-c["sheet_points"], -c["similarity"]))

    AUDIT_DIR.mkdir(exist_ok=True)
    date = datetime.now().strftime("%Y-%m-%d")
    csv_path = AUDIT_DIR / f"uci_translit_candidates_{date}.csv"
    override_path = AUDIT_DIR / f"uci_translit_overrides_{date}.py"

    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=[
            "pcm_id", "rider_id", "db_name", "db_nationality",
            "sheet_name", "sheet_points", "similarity", "popularity",
        ])
        w.writeheader()
        w.writerows(candidates)

    with open(override_path, "w", encoding="utf-8") as f:
        f.write("# Foreslaaede UCI_NAME_OVERRIDE-entries.\n")
        f.write(f"# Genereret af scripts/uci_audit.py --mode translit paa {date}.\n")
        f.write("# Inspicer CSV foerst; ingen entry merges uden brugerens godkendelse.\n")
        f.write("# Paste indenfor UCI_NAME_OVERRIDE-dict literal'en i scripts/uci_scraper.py.\n\n")
        for c in candidates:
            f.write(
                f"    # {c['db_name']:30s} ({c['db_nationality']:2s}) "
                f"-> {c['sheet_name']:30s}  pts={c['sheet_points']:5d} "
                f"sim={c['similarity']:.2f} pop={c['popularity']}\n"
            )
            f.write(
                f"    normalize_name({c['db_name']!r}): "
                f"normalize_name({c['sheet_name']!r}),\n"
            )

    print(f"\n=== TRANSLIT-mode: {len(candidates)} kandidater ===")
    print(f"  CSV:       {csv_path}")
    print(f"  Overrides: {override_path}")
    if candidates:
        print(f"\nTop 25 (efter sheet-points = stoerst CZ$-paavirkning):")
        print(f"  {'pts':>5}  {'sim':>5}  {'pop':>3}  {'db':<30s} {'sheet':<30s}")
        for c in candidates[:25]:
            print(
                f"  {c['sheet_points']:5d}  {c['similarity']:.2f}   {c['popularity']:>3}  "
                f"{c['db_name'][:30]:<30s} {c['sheet_name'][:30]:<30s}"
            )
    return len(candidates)


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="UCI name-mismatch audit")
    parser.add_argument("--mode", choices=["exact", "translit"], default="exact")
    parser.add_argument("--source", choices=["csv", "live", "sheet"], default="csv",
                        help="csv=lokal stale snapshot, live=fresh PCS scrape, "
                             "sheet=Google Sheet via service account (kraever creds)")
    parser.add_argument("--limit", type=int, default=3000,
                        help="Live: hvor mange PCS-ryttere (default 3000)")
    parser.add_argument("--threshold", type=float, default=FUZZY_THRESHOLD,
                        help=f"Translit: similarity-cutoff (default {FUZZY_THRESHOLD})")
    parser.add_argument("--min-points", type=int, default=MIN_SHEET_POINTS,
                        help=f"Translit: skip PCS-ryttere < N pts (default {MIN_SHEET_POINTS})")
    args = parser.parse_args()

    # Auto-load .env hvis dotenv tilgaengelig
    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / "backend" / ".env")
    except ImportError:
        pass

    if not os.environ.get("SUPABASE_URL"):
        sys.exit("FEJL: SUPABASE_URL ikke sat. Loeg backend/.env eller eksporter manuelt.")

    print(f"=== UCI Audit {datetime.now(timezone.utc).isoformat()} ===")
    print(f"Mode: {args.mode}  Source: {args.source}")

    print(f"\n[1/3] Henter UCI-data ({args.source})...")
    if args.source == "live":
        uci_rows = load_uci_live(args.limit)
    elif args.source == "sheet":
        uci_rows = load_uci_sheet()
    else:
        uci_rows = load_uci_csv(CSV_PATH)
    print(f"      {len(uci_rows)} UCI-ryttere indlaest")

    print(f"\n[2/3] Henter DB-ryttere fra Supabase...")
    db_riders = fetch_db_riders()
    print(f"      {len(db_riders)} ryttere i DB")

    print(f"\n[3/3] Koerer {args.mode}-mode...")
    if args.mode == "exact":
        n = run_exact_mode(uci_rows, db_riders)
    else:
        n = run_translit_mode(uci_rows, db_riders, args.threshold, args.min_points)

    print(f"\nFaerdig. {n} kandidater.")


if __name__ == "__main__":
    main()
