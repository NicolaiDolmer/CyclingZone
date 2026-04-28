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
import sys
import time
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from typing import Callable, TypedDict

import requests

RANKING_PATH = "rankings.php?p=me&s=uci-individual"
PAGE_SIZE = 100
MIN_UCI_POINTS = 5
REQUEST_DELAY_SEC = 1.5  # respektér PCS-serverne
DEFAULT_MIN_EXPECTED_RIDERS = 2400
MAX_MINIMUM_DOWNGRADE_RATIO = 0.10
MAX_MINIMUM_DOWNGRADE_ABSOLUTE = 25


class ScraperValidationError(RuntimeError):
    """Raised when PCS data cannot be trusted for writes."""


class RankingFetchResult(TypedDict):
    riders: list[dict]
    pages_fetched: int
    rank_min: int | None
    rank_max: int | None
    duplicate_ranks: list[int]
    duplicate_names: list[str]
    complete_ranking: bool


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

def parse_rank(value) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        raise ScraperValidationError(f"Ugyldig rank fra PCS: {value!r}")


def rider_name(rider: dict) -> str:
    return str(rider.get("rider_name", rider.get("name", "")) or "").strip()


def _fetch_page_from_pcs(offset: int) -> list[dict]:
    # Lazy import gør unit tests mulige uden scraperens eksterne runtime-deps.
    from procyclingstats import Ranking

    url = f"{RANKING_PATH}&offset={offset}"
    return Ranking(url).individual_ranking()


def validate_ranking_page(
    page_data: list[dict],
    *,
    offset: int,
    seen_ranks: set[int],
) -> list[int]:
    if not page_data:
        raise ScraperValidationError(f"PCS returnerede tom side ved offset {offset}")

    ranks = [parse_rank(r.get("rank")) for r in page_data]
    expected_first = offset + 1
    expected_last = offset + len(page_data)

    if ranks[0] != expected_first:
        raise ScraperValidationError(
            f"PCS pagination drift ved offset {offset}: "
            f"forventede første rank {expected_first}, fik {ranks[0]}"
        )

    expected_ranks = list(range(expected_first, expected_last + 1))
    if ranks != expected_ranks:
        raise ScraperValidationError(
            f"PCS rank-gap ved offset {offset}: forventede "
            f"{expected_first}-{expected_last}, fik {ranks[0]}-{ranks[-1]}"
        )

    duplicates = sorted(set(ranks).intersection(seen_ranks))
    if duplicates:
        raise ScraperValidationError(
            "PCS returnerede dublet-ranks på tværs af sider: "
            + ", ".join(str(r) for r in duplicates[:10])
        )

    return ranks


def build_fetch_report(riders: list[dict], pages_fetched: int, complete_ranking: bool) -> RankingFetchResult:
    ranks = [parse_rank(r.get("rank")) for r in riders]
    names = [normalize_name(rider_name(r)) for r in riders if rider_name(r)]
    duplicate_ranks = sorted([rank for rank, count in Counter(ranks).items() if count > 1])
    duplicate_names = sorted([name for name, count in Counter(names).items() if count > 1])

    return {
        "riders": riders,
        "pages_fetched": pages_fetched,
        "rank_min": min(ranks) if ranks else None,
        "rank_max": max(ranks) if ranks else None,
        "duplicate_ranks": duplicate_ranks,
        "duplicate_names": duplicate_names,
        "complete_ranking": complete_ranking,
    }


def fetch_rankings(
    limit: int,
    *,
    min_expected: int | None = None,
    page_fetcher: Callable[[int], list[dict]] | None = None,
) -> RankingFetchResult:
    riders: list[dict] = []
    offset = 0
    seen_ranks: set[int] = set()
    pages_fetched = 0
    complete_ranking = False
    fetch_page = page_fetcher or _fetch_page_from_pcs

    while len(riders) < limit:
        try:
            page_data = fetch_page(offset)
        except Exception as exc:
            raise ScraperValidationError(f"Fejl ved PCS offset {offset}: {exc}") from exc

        page_ranks = validate_ranking_page(page_data, offset=offset, seen_ranks=seen_ranks)
        seen_ranks.update(page_ranks)

        want = min(PAGE_SIZE, limit - len(riders))
        riders.extend(page_data[:want])
        pages_fetched += 1
        print(f"  Hentet {len(riders)}/{limit} (offset {offset})")

        if len(page_data) < PAGE_SIZE:
            complete_ranking = True
            break  # sidste side

        offset += PAGE_SIZE
        if page_fetcher is None and len(riders) < limit:
            time.sleep(REQUEST_DELAY_SEC)

    if len(riders) >= limit:
        complete_ranking = True

    report = build_fetch_report(riders, pages_fetched, complete_ranking)
    required = min_expected if min_expected is not None else (
        DEFAULT_MIN_EXPECTED_RIDERS if limit >= DEFAULT_MIN_EXPECTED_RIDERS else None
    )
    if required is not None and len(riders) < required:
        raise ScraperValidationError(
            f"Coverage-gate fejlede: hentede kun {len(riders)} ryttere, "
            f"kræver mindst {required}. Ingen writes må køres."
        )
    if report["duplicate_ranks"]:
        raise ScraperValidationError(
            "Dublet-ranks i samlet PCS-data: "
            + ", ".join(str(r) for r in report["duplicate_ranks"][:10])
        )

    return report


# ── Google Sheets ────────────────────────────────────────────────────────────

def open_sheet(creds_json: str, sheet_id: str):
    import gspread
    from google.oauth2.service_account import Credentials

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
    sheet.update(values=rows, range_name="A1", value_input_option="RAW")
    print(f"  Skrev {len(riders)} rækker til Google Sheets")


# ── Supabase-sync (direkte REST via requests — undgår httpx/HTTP2-problemer) ─

def _clean_env(var: str) -> str:
    return "".join(os.environ[var].split())  # fjerner AL whitespace inkl. embedded newlines

def _sb_headers() -> dict:
    key = _clean_env("SUPABASE_SERVICE_KEY")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

def _sb_url(path: str) -> str:
    return f"{_clean_env('SUPABASE_URL')}/rest/v1/{path}"

def sync_supabase(riders: list[dict], synced_at: str, dry_run: bool, complete_ranking: bool) -> None:
    headers = _sb_headers()

    # Byg UCI-map: normaliseret navn → points
    uci_map: dict[str, int] = {}
    for r in riders:
        name = r.get("rider_name", r.get("name", ""))
        pts = int(r.get("points", 0) or 0)
        if name:
            uci_map[normalize_name(name)] = pts

    # Hent alle ryttere fra DB
    resp = requests.get(
        _sb_url("riders?select=id,firstname,lastname,uci_points"),
        headers=headers,
        timeout=30,
    )
    resp.raise_for_status()
    db_riders = resp.json()
    print(f"  Matcher {len(uci_map)} UCI-ryttere mod {len(db_riders)} DB-ryttere")

    rider_updates: list[dict] = []
    history_rows: list[dict] = []
    not_found = 0
    matched = 0
    restored_from_minimum = 0
    minimum_downgrades = 0
    old_points_by_id = {rider["id"]: rider["uci_points"] for rider in db_riders}

    for rider in db_riders:
        fn = rider.get("firstname") or ""
        ln = rider.get("lastname") or ""

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
            if complete_ranking:
                new_pts = MIN_UCI_POINTS
            else:
                # Ufuldstændige scrapes må aldrig nedskrive eksisterende data.
                continue
        else:
            matched += 1

        new_pts = max(MIN_UCI_POINTS, new_pts)
        history_rows.append({
            "rider_id": rider["id"],
            "uci_points": new_pts,
            "synced_at": synced_at,
        })

        if new_pts != rider["uci_points"]:
            if rider["uci_points"] == MIN_UCI_POINTS and new_pts > MIN_UCI_POINTS:
                restored_from_minimum += 1
            if new_pts == MIN_UCI_POINTS and rider["uci_points"] != MIN_UCI_POINTS:
                minimum_downgrades += 1
            rider_updates.append({"id": rider["id"], "uci_points": new_pts})

    downgrade_limit = max(
        MAX_MINIMUM_DOWNGRADE_ABSOLUTE,
        int(len(db_riders) * MAX_MINIMUM_DOWNGRADE_RATIO),
    )
    largest_changes = sorted(
        (
            {
                "id": u["id"],
                "old": old_points_by_id[u["id"]],
                "new": u["uci_points"],
                "delta": u["uci_points"] - old_points_by_id[u["id"]],
            }
            for u in rider_updates
        ),
        key=lambda row: abs(row["delta"]),
        reverse=True,
    )[:10]

    print(
        "  Supabase safety report: "
        f"matched={matched}, not_found={not_found}, updates={len(rider_updates)}, "
        f"restored_from_minimum={restored_from_minimum}, "
        f"minimum_downgrades={minimum_downgrades}/{downgrade_limit}, "
        f"complete_ranking={complete_ranking}"
    )
    if largest_changes:
        print("  Største pointændringer:")
        for row in largest_changes:
            print(f"    rider_id={row['id']} {row['old']} -> {row['new']} ({row['delta']:+})")

    if (
        minimum_downgrades > downgrade_limit
        and os.environ.get("UCI_ALLOW_MASS_MINIMUM_DOWNGRADE") != "1"
    ):
        raise ScraperValidationError(
            f"Safety-gate fejlede: sync ville nedskrive {minimum_downgrades} "
            f"ryttere til {MIN_UCI_POINTS} point (grænse {downgrade_limit}). "
            "Sæt kun UCI_ALLOW_MASS_MINIMUM_DOWNGRADE=1 efter manuel audit."
        )

    if dry_run:
        print("  [DRY RUN] springer Supabase-skrivning over")
        return

    # Opdatér riders én ad gangen
    for u in rider_updates:
        requests.patch(
            _sb_url(f"riders?id=eq.{u['id']}"),
            json={"uci_points": u["uci_points"], "updated_at": synced_at},
            headers=headers,
            timeout=10,
        ).raise_for_status()

    # Insert historikrækker i batches
    BATCH = 500
    for i in range(0, len(history_rows), BATCH):
        requests.post(
            _sb_url("rider_uci_history"),
            json=history_rows[i:i + BATCH],
            headers={**headers, "Prefer": "return=minimal"},
            timeout=30,
        ).raise_for_status()

    print(f"  Loggede {len(history_rows)} historikrækker")


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="CyclingZone UCI scraper")
    parser.add_argument("--dry-run", action="store_true",
                        help="Hent og validér data, men skriv hverken Sheets eller Supabase")
    parser.add_argument("--limit", type=int, default=3000,
                        help="Maks antal ryttere (standard: 3000)")
    parser.add_argument("--min-expected", type=int, default=None,
                        help="Minimum antal ryttere der skal hentes før writes tillades")
    parser.add_argument("--skip-sheets", action="store_true",
                        help="Spring Google Sheets-skrivning over")
    parser.add_argument("--skip-supabase", action="store_true",
                        help="Spring Supabase-sync over")
    args = parser.parse_args()

    now = datetime.now(timezone.utc).isoformat()
    print(f"=== UCI Scraper {now} ===")
    print(f"Henter top {args.limit} ryttere fra ProCyclingStats...")

    try:
        fetch_report = fetch_rankings(args.limit, min_expected=args.min_expected)
    except ScraperValidationError as exc:
        print(f"FEJL: UCI scrape er ikke godkendt: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc

    riders = fetch_report["riders"]
    print(
        "Coverage report: "
        f"pages={fetch_report['pages_fetched']}, total={len(riders)}, "
        f"rank_min={fetch_report['rank_min']}, rank_max={fetch_report['rank_max']}, "
        f"duplicate_ranks={len(fetch_report['duplicate_ranks'])}, "
        f"duplicate_names={len(fetch_report['duplicate_names'])}, "
        f"complete_ranking={fetch_report['complete_ranking']}"
    )

    creds_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    sheet_id = os.environ.get("GOOGLE_SHEET_ID")

    if args.dry_run:
        print("[DRY RUN] skriver hverken Google Sheets eller Supabase")

    if not args.dry_run and not args.skip_sheets and creds_json and sheet_id:
        print("Skriver til Google Sheets...")
        sheet = open_sheet(creds_json, sheet_id)
        write_to_sheet(sheet, riders, now)
    else:
        print("Springer Sheets over")

    if not args.dry_run and not args.skip_supabase and os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_KEY"):
        if riders:
            print("Synkroniserer til Supabase...")
            sync_supabase(riders, now, args.dry_run, fetch_report["complete_ranking"])
        else:
            print("Springer Supabase over — ingen ryttere hentet")
    else:
        print("Springer Supabase over")

    print("=== Færdig ===")


if __name__ == "__main__":
    main()
