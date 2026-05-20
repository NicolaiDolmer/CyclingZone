#!/usr/bin/env python3
"""
CyclingZone UCI Scraper
-----------------------
Henter UCI individuel world ranking (top N ryttere) fra ProCyclingStats,
skriver til Google Sheets og synkroniserer direkte til Supabase.

Kører automatisk via GitHub Actions hver onsdag kl. 06:17 UTC.
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
DB_RIDER_PAGE_SIZE = 1000
MIN_UCI_POINTS = 5
REQUEST_DELAY_SEC = 1.5  # respektér PCS-serverne
DEFAULT_MIN_EXPECTED_RIDERS = 2400
MAX_MINIMUM_DOWNGRADE_RATIO = 0.10
MAX_MINIMUM_DOWNGRADE_ABSOLUTE = 25

# Ryttere over disse tærskler må ikke auto-downgrades til MIN ved name-mismatch.
# Beskytter mod gentagelse af Tobias Lund Andresen-bug 2026-05-04 hvor compound
# surnames blev nullet ud i mandags-cron'en.
HIGH_VALUE_POPULARITY_THRESHOLD = 70
HIGH_VALUE_UCI_POINTS_THRESHOLD = 100


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
#
# NB: æ/ø/å/ł dekomponeres IKKE af NFKD, så uden eksplicit substitution forsvinder
# de helt ved ASCII-strip ("Mørkøv" → "Mrkv"). Erstat dem først så de bliver
# konsistent ASCII inden normalisering.

_VOWEL_SUBS = {
    "æ": "ae", "Æ": "AE",
    "ø": "oe", "Ø": "OE",
    "å": "aa", "Å": "AA",
    "ł": "l", "Ł": "L",
    "ß": "ss",
}


def normalize_name(name: str) -> str:
    if not name:
        return ""
    for src, dst in _VOWEL_SUBS.items():
        name = name.replace(src, dst)
    name = (
        unicodedata.normalize("NFKD", name)
        .encode("ascii", "ignore")
        .decode()
        .upper()
    )
    # Bindestreger, apostroffer og punktummer skal være whitespace,
    # så "Lund-Andresen" og "O'Connor" tokeniseres ens på begge sider.
    for ch in "-'.":
        name = name.replace(ch, " ")
    return " ".join(name.split())  # collapse whitespace


def name_tokens(name: str) -> frozenset[str]:
    """Token-set bruges til ordrækkefølge-uafhængigt match (compound surnames)."""
    return frozenset(normalize_name(name).split())


# Runtime overrides for known DB ↔ PCS name variants.
# Key: normalized DB name (firstname lastname). Value: normalized PCS/UCI name.
#
# De første 4 er pre-#508 manual fixes. De resterende 45 er translit-victims
# afdækket af scripts/uci_audit.py --mode translit + GitHub Actions workflow
# "UCI Translit Audit" (kører ad hoc) — verificeret 2026-05-20 (Refs #508).
# Backwards-fixet ligger i database/2026-05-20-fix-uci-translit-mismatches.sql.
UCI_NAME_OVERRIDE: dict[str, str] = {
    normalize_name("Benjamí Prades"): normalize_name("PRADES Benjamín"),
    normalize_name("Bjoern Koerdt"): normalize_name("KOERDT Bjorn"),
    normalize_name("Joe Blackmore"): normalize_name("BLACKMORE Joseph"),
    normalize_name("Natnael Tesfazion"): normalize_name("TESFATSION Natnael"),
    # ── Translit-victims fixet 2026-05-20 (Refs #508) ────────────────────────
    # Sorteret efter sheet-points descending (storst CZ$-paavirkning forst).
    normalize_name("Tegshbayar Batsaikhan"): normalize_name("BATSAIKHAN Tegsh-Bayar"),
    normalize_name("Mohammad Al Mutaiwei"): normalize_name("ALMUTAIWEI Mohammad"),
    normalize_name("Alfie George"): normalize_name("GEORGE Alfred"),
    normalize_name("Edinson Alejandro Callejas"): normalize_name("CALLEJAS Edison Alejandro"),
    normalize_name("Nahom Zerai"): normalize_name("ZERAY Nahom"),
    normalize_name("Finlay Walsh"): normalize_name("WALSH Finn"),
    normalize_name("Cristofer Robin Jurado"): normalize_name("JURADO Christofer Robín"),
    normalize_name("Will Smith"): normalize_name("SMITH William"),
    normalize_name("Akil Campbell"): normalize_name("CAMPBELL Akill"),
    normalize_name("Matvey Boldyrev"): normalize_name("BOLDYREV Matvei"),
    normalize_name("Martin Pluto"): normalize_name("PLUTO Mārtiņš"),
    normalize_name("Luis Fernando Bomfim de Almeida"): normalize_name("BOMFIM DE ALMEIDA Luiz Fernando"),
    normalize_name("Muhammad Abdurrohman"): normalize_name("ABDURRAHMAN Muhammad"),
    normalize_name("Brayan Obando"): normalize_name("OBANDO Bryan Raul"),
    normalize_name("Joshua Kench"): normalize_name("KENCH Josh"),
    normalize_name("Serdar Anil Depe"): normalize_name("DEPE Serdar Anıl"),
    normalize_name("Thavone Phon Asa"): normalize_name("PHONASA Thavone"),
    normalize_name("David Jónsson"): normalize_name("JÓNSSON Davíð"),
    normalize_name("Wooho Jung"): normalize_name("JUNG Woo-Ho"),
    normalize_name("Mattie Dodd"): normalize_name("DODD Matthew"),
    normalize_name("Mohamed Alaleeli"): normalize_name("ALALEELI Mohammed"),
    normalize_name("Nattawat Mongkonwong"): normalize_name("MONGKONWONG Natawat"),
    normalize_name("Maher Habouria"): normalize_name("MAHER Habouriya"),
    normalize_name("Ioannis Kyriakidis"): normalize_name("KIRIAKIDIS Ioannis"),
    normalize_name("Hassan Elseify"): normalize_name("ELSAIFY Hassan"),
    normalize_name("Ahmed Khalid Al Nuaimi"): normalize_name("ALNUAIMI Khalid"),
    normalize_name("Hyeongmin Choe"): normalize_name("CHOE Hyeong Min"),
    normalize_name("Sasha Bergaud"): normalize_name("BERGAUD Sacha"),
    normalize_name("Saif Al Kaabi"): normalize_name("ALKAABI Saif"),
    normalize_name("Julio Amicar Ispache"): normalize_name("ISPACHE Julio Amilcar"),
    normalize_name("Abderaouf Bengayou"): normalize_name("BENGAYOU Abdelraouf"),
    normalize_name("Maksim Bilyi"): normalize_name("BILYI Maksym"),
    normalize_name("Dionisyos Douzas"): normalize_name("DOUZAS Dionysios"),
    normalize_name("Nadhem Ben Amar"): normalize_name("BEN AMOR Nadhem"),
    normalize_name("Fanis Kyritsis"): normalize_name("KYRITSIS Theofanis"),
    normalize_name("Matthijs De Clercq"): normalize_name("DE CLERCQ Mathijs"),
    normalize_name("Thanakone Vongdeaune"): normalize_name("VONGDEUANE Thanakone"),
    normalize_name("Zer Abruk Debay"): normalize_name("DEBAY Filimon Zerabruk"),
    normalize_name("Alex Correll"): normalize_name("CORRELL Alexander"),
    normalize_name("Julen Arriola-Bengoa"): normalize_name("ARRIOLABENGOA Julen"),
    normalize_name("Sergei Rostovtsev"): normalize_name("ROSTOVTSEV Sergey"),
    normalize_name("Abdallah Ben Youcef"): normalize_name("BENYOUCEF Abdallah"),
    normalize_name("Kyunggu Jang"): normalize_name("JANG Kyung-Gu"),
    normalize_name("Vitaliy Hryniv"): normalize_name("GRYNIV Vitaliy"),
    normalize_name("Cristhian Triminio Martinez"): normalize_name("TRIMINIO Cristian"),
}

# Explicitly approved as not found in current PCS top-3000; allow minimum downgrade
# despite high-value safety thresholds. Keep this list tiny and audited.
UCI_FORCE_MINIMUM: set[str] = {
    normalize_name("Shu Chen"),
    normalize_name("Frederik Wandahl"),
}


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


def fetch_db_riders(headers: dict, page_size: int = DB_RIDER_PAGE_SIZE) -> list[dict]:
    """Fetch all DB riders; PostgREST/Supabase returns 1000 rows by default."""
    riders: list[dict] = []
    offset = 0
    while True:
        end = offset + page_size - 1
        resp = requests.get(
            _sb_url("riders?select=id,firstname,lastname,uci_points,popularity&order=id.asc"),
            headers={**headers, "Range-Unit": "items", "Range": f"{offset}-{end}"},
            timeout=30,
        )
        resp.raise_for_status()
        page = resp.json()
        riders.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return riders


def _is_high_value_rider(rider: dict) -> bool:
    popularity = rider.get("popularity") or 0
    points = rider.get("uci_points") or 0
    return (
        popularity >= HIGH_VALUE_POPULARITY_THRESHOLD
        or points >= HIGH_VALUE_UCI_POINTS_THRESHOLD
    )


def find_uci_match(
    rider: dict,
    uci_token_map: dict[frozenset[str], int],
) -> int | None:
    """Token-set-baseret match — handler compound surnames og middle-name-drift."""
    fn = rider.get("firstname") or ""
    ln = rider.get("lastname") or ""
    db_tokens = name_tokens(f"{fn} {ln}")
    if not db_tokens:
        return None

    override_name = UCI_NAME_OVERRIDE.get(normalize_name(f"{fn} {ln}"))
    if override_name:
        return uci_token_map.get(name_tokens(override_name))

    # 1. Eksakt token-set match (fanger ordrækkefølge-permutationer)
    if db_tokens in uci_token_map:
        return uci_token_map[db_tokens]

    # 2. DB ⊆ UCI — UCI har middle name DB ikke har (fx DB "Magnus Cort" → UCI "CORT Magnus" har 2 tokens; ikke et faktisk subset her, men relevant for "Mikkel Honoré" → "HONORÉ Mikkel Frølich")
    for uci_tokens, pts in uci_token_map.items():
        if db_tokens.issubset(uci_tokens):
            return pts

    # 3. UCI ⊆ DB — DB har middle name UCI ikke har (fx DB "Mateo Pablo Ramírez" → UCI "RAMÍREZ Mateo")
    for uci_tokens, pts in uci_token_map.items():
        if len(uci_tokens) >= 2 and uci_tokens.issubset(db_tokens):
            return pts

    return None


def sync_supabase(riders: list[dict], synced_at: str, dry_run: bool, complete_ranking: bool) -> None:
    headers = _sb_headers()

    # Byg UCI token-map: frozenset(tokens) → points
    # Hvis to UCI-navne har samme token-set, behold den med flest points
    uci_token_map: dict[frozenset[str], int] = {}
    for r in riders:
        name = r.get("rider_name", r.get("name", ""))
        pts = int(r.get("points", 0) or 0)
        tokens = name_tokens(name)
        if not tokens:
            continue
        existing = uci_token_map.get(tokens)
        if existing is None or existing < pts:
            uci_token_map[tokens] = pts

    # Hent alle ryttere fra DB (popularity bruges af high-value safety-gate)
    db_riders = fetch_db_riders(headers)
    print(f"  Matcher {len(uci_token_map)} UCI-ryttere mod {len(db_riders)} DB-ryttere")

    rider_updates: list[dict] = []
    history_rows: list[dict] = []
    not_found = 0
    matched = 0
    restored_from_minimum = 0
    minimum_downgrades = 0
    high_value_protected: list[dict] = []
    old_points_by_id = {rider["id"]: rider["uci_points"] for rider in db_riders}

    for rider in db_riders:
        new_pts = find_uci_match(rider, uci_token_map)

        if new_pts is None:
            not_found += 1
            if not complete_ranking:
                # Ufuldstændige scrapes må aldrig nedskrive eksisterende data.
                continue
            force_minimum = normalize_name(
                f"{rider.get('firstname','')} {rider.get('lastname','')}"
            ) in UCI_FORCE_MINIMUM
            # High-value safety-gate: aldrig auto-downgrade kendte/værdifulde ryttere
            # til MIN udelukkende pga. name-mismatch. Bevar nuværende værdi og log.
            if (
                not force_minimum
                and _is_high_value_rider(rider)
                and rider["uci_points"] > MIN_UCI_POINTS
            ):
                high_value_protected.append({
                    "id": rider["id"],
                    "name": f"{rider.get('firstname','')} {rider.get('lastname','')}".strip(),
                    "current_pts": rider["uci_points"],
                    "popularity": rider.get("popularity") or 0,
                })
                # Log historikrækken med eksisterende værdi så grafen ikke ser et hul
                history_rows.append({
                    "rider_id": rider["id"],
                    "uci_points": rider["uci_points"],
                    "synced_at": synced_at,
                })
                continue
            new_pts = MIN_UCI_POINTS
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
        f"high_value_protected={len(high_value_protected)}, "
        f"complete_ranking={complete_ranking}"
    )
    if high_value_protected:
        print(
            "  WARN: High-value ryttere uden match (bevarede nuvaerende uci_points; "
            "koer scripts/uci_audit.py for fix-migration):"
        )
        for entry in high_value_protected[:20]:
            print(
                f"    rider_id={entry['id']} {entry['name']} "
                f"pop={entry['popularity']} pts={entry['current_pts']}"
            )
        if len(high_value_protected) > 20:
            print(f"    ...og {len(high_value_protected) - 20} flere")
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
