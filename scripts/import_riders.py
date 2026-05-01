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

# ── Manual UCI-name overrides for cases automated matching can't handle ────────
# Key: PCM IDcyclist (pcm_id).  Value: exact normalized UCI name string.
# Add here when PCM stores a nickname (Joe) or alternate spelling (Bjoern/Bjorn)
# that no normalization strategy can bridge automatically.
PCM_UCI_OVERRIDE: dict[int, str] = {
    9151: "BLACKMORE JOSEPH",      # PCM: "Joe";      UCI: "Joseph"
    9934: "KOERDT BJORN",          # PCM: "Bjoern";   UCI: "Bjorn"
    7372: "TESFATSION NATNAEL",    # PCM: "Tesfazion"; UCI: "Tesfatsion" (different transliteration)
}

# ── PCM fkIDregion → ISO 3166-1 alpha-2 nationality code ──────────────────────
# Source: PCM WORLD_DB regions sheet (col 1=IDregion, col 4=fkIDcountry) +
#         PCM countries sheet (IDcountry → CONSTANT → ISO 2-letter).
# Multi-region countries (ITA, FRA, BEL, NED, GER, ESP, SWI, POR, DEN) have
# one entry per region; single-region countries use IDcountry*100+1 pattern.
REGION_TO_ISO: dict[int, str] = {
    # Italy (ITA → IT)
    201: "IT", 202: "IT", 203: "IT", 204: "IT", 205: "IT",
    206: "IT", 207: "IT", 208: "IT", 209: "IT", 210: "IT",
    211: "IT", 212: "IT", 213: "IT", 214: "IT", 215: "IT",
    216: "IT", 217: "IT", 218: "IT", 219: "IT", 220: "IT",
    # France (FRA → FR)
    301: "FR", 302: "FR", 303: "FR", 304: "FR", 305: "FR",
    306: "FR", 307: "FR", 308: "FR", 309: "FR", 310: "FR",
    311: "FR", 312: "FR", 313: "FR", 314: "FR", 315: "FR",
    316: "FR", 317: "FR", 318: "FR", 319: "FR", 320: "FR",
    321: "FR", 322: "FR", 323: "FR", 324: "FR", 325: "FR",
    # Belgium (BEL → BE)
    401: "BE", 402: "BE",
    # Netherlands (NED → NL)
    501: "NL", 502: "NL", 503: "NL", 504: "NL", 505: "NL",
    506: "NL", 507: "NL", 508: "NL", 509: "NL", 510: "NL",
    511: "NL", 512: "NL",
    # USA (USA → US)
    601: "US",
    # Germany (GER → DE)
    701: "DE", 702: "DE", 703: "DE", 704: "DE", 705: "DE",
    706: "DE", 707: "DE", 708: "DE", 709: "DE", 710: "DE",
    711: "DE", 712: "DE", 713: "DE", 714: "DE", 715: "DE",
    716: "DE",
    # Spain (ESP → ES)
    801: "ES", 802: "ES", 803: "ES", 804: "ES", 805: "ES",
    806: "ES", 807: "ES", 808: "ES", 809: "ES", 810: "ES",
    811: "ES", 812: "ES", 813: "ES", 814: "ES", 815: "ES",
    816: "ES", 817: "ES",
    # Cameroon (CMR → CM)
    901: "CM",
    # Denmark (DEN → DK)
    1001: "DK", 1002: "DK", 1003: "DK", 1004: "DK", 1005: "DK",
    # Colombia (COL → CO)
    1101: "CO",
    # Estonia (EST → EE)
    1201: "EE",
    # Kazakhstan (KAZ → KZ)
    1301: "KZ",
    # Lithuania (LTU → LT)
    1401: "LT",
    # Russia (RUS → RU)
    1501: "RU",
    # Latvia (LAT → LV)
    1601: "LV",
    # Switzerland (SWI → CH)
    1701: "CH", 1702: "CH", 1703: "CH",
    # Great Britain (GBR → GB)
    1801: "GB",
    # Luxembourg (LUX → LU)
    1901: "LU",
    # Australia (AUS → AU)
    2001: "AU",
    # Japan (JPN → JP)
    2101: "JP",
    # Canada (CAN → CA)
    2201: "CA",
    # Mexico (MEX → MX)
    2301: "MX",
    # Burkina Faso (BFA → BF)
    2401: "BF",
    # China (CHI → CN)
    2501: "CN",
    # Morocco (MAR → MA)
    2601: "MA",
    # Slovakia (SVK → SK)
    2701: "SK",
    # Slovenia (SLO → SI)
    2801: "SI",
    # Portugal (POR → PT)
    2901: "PT", 2902: "PT", 2903: "PT", 2904: "PT", 2905: "PT",
    # Poland (POL → PL)
    3001: "PL",
    # Ireland (IRL → IE)
    3101: "IE",
    # Sweden (SWD → SE)
    3201: "SE",
    # Czech Republic (CZE → CZ)
    3301: "CZ",
    # New Zealand (NZL → NZ)
    3401: "NZ",
    # Norway (NOR → NO)
    3501: "NO",
    # South Africa (SAR → ZA)
    3601: "ZA",
    # Austria (AUT → AT)
    3701: "AT",
    # Ukraine (UKR → UA)
    3801: "UA",
    # Moldova (MOL → MD)
    3901: "MD",
    # Hungary (HUN → HU)
    4001: "HU",
    # Eritrea (ERI → ER)
    4101: "ER",
    # Rwanda (RWA → RW)
    4201: "RW",
    # Belarus (BLR → BY)
    4301: "BY",
    # Croatia (CRO → HR)
    4401: "HR",
    # Venezuela (VEN → VE)
    4501: "VE",
    # Argentina (ARG → AR)
    4601: "AR",
    # Finland (FIN → FI)
    4701: "FI",
    # Kyrgyzstan (KGZ → KG)
    4801: "KG",
    # Malaysia (MAS → MY)
    4901: "MY",
    # Serbia (SER → RS)
    5001: "RS",
    # Cuba (CUB → CU)
    5101: "CU",
    # Côte d'Ivoire (CIV → CI)
    5201: "CI",
    # Egypt (EGY → EG)
    5301: "EG",
    # Bulgaria (BUL → BG)
    5401: "BG",
    # Algeria (DZA → DZ)
    5501: "DZ",
    # Brazil (BRA → BR)
    5601: "BR",
    # Uzbekistan (UZB → UZ)
    5701: "UZ",
    # Kenya (KEN → KE)
    5801: "KE",
    # Qatar (QAT → QA)
    5901: "QA",
    # Greece (GRE → GR)
    6001: "GR",
    # Costa Rica (CRC → CR)
    6101: "CR",
    # Zimbabwe (ZIM → ZW)
    6201: "ZW",
    # Bermuda (BER → BM)
    6301: "BM",
    # Andorra (AND → AD)
    6401: "AD",
    # San Marino (SMR → SM)
    6501: "SM",
    # Tunisia (TUN → TN)
    6601: "TN",
    # Uruguay (URU → UY)
    6701: "UY",
    # Oman (OMA → OM)
    6801: "OM",
    # Chile (CHL → CL)
    6901: "CL",
    # Israel (ISR → IL)
    7001: "IL",
    # Turkey (TUR → TR)
    7101: "TR",
    # Gabon (GAB → GA)
    7201: "GA",
    # Namibia (NAM → NA)
    7301: "NA",
    # Ethiopia (ETH → ET)
    7401: "ET",
    # Mauritius (MUS → MU)
    7501: "MU",
    # Lesotho (LSO → LS)
    7601: "LS",
    # Angola (AGO → AO)
    7701: "AO",
    # Iran (IRN → IR)
    7801: "IR",
    # South Korea (KOR → KR)
    7901: "KR",
    # Hong Kong (HKG → HK)
    8001: "HK",
    # Syria (SYR → SY)
    8101: "SY",
    # Thailand (THA → TH)
    8201: "TH",
    # Mongolia (MNG → MN)
    8301: "MN",
    # Taiwan (TWN → TW)
    8401: "TW",
    # Indonesia (IDN → ID)
    8501: "ID",
    # India (IND → IN)
    8601: "IN",
    # Pakistan (PAK → PK)
    8701: "PK",
    # Philippines (PHL → PH)
    8801: "PH",
    # Trinidad and Tobago (TTO → TT)
    8901: "TT",
    # Guatemala (GTM → GT)
    9001: "GT",
    # Dominican Republic (DOM → DO)
    9101: "DO",
    # Bolivia (BOL → BO)
    9201: "BO",
    # Curaçao (CUW → CW)
    9301: "CW",
    # Ecuador (ECU → EC)
    9401: "EC",
    # Puerto Rico (PRI → PR)
    9501: "PR",
    # Jamaica (JAM → JM)
    9601: "JM",
    # Albania (ALB → AL)
    9701: "AL",
    # North Macedonia (MKD → MK)
    9801: "MK",
    # Georgia (GEO → GE)
    9901: "GE",
    # Iceland (ISL → IS)
    10001: "IS",
    # Cyprus (CYP → CY)
    10101: "CY",
    # Panama (PAN → PA)
    10201: "PA",
    # Azerbaijan (AZE → AZ)
    10301: "AZ",
    # Romania (ROM → RO)
    10401: "RO",
    # UAE (UAE → AE)
    10501: "AE",
    # Bahrain (BHR → BH)
    10601: "BH",
    # Kuwait (KUW → KW)
    10701: "KW",
    # Bosnia-Herzegovina (BIH → BA)
    10801: "BA",
    # Saudi Arabia (SAU → SA)
    10901: "SA",
    # Paraguay (PRY → PY)
    11001: "PY",
    # Monaco (MCO → MC)
    11101: "MC",
    # Cambodia (KHM → KH)
    11201: "KH",
    # Laos (LAO → LA)
    11301: "LA",
    # Guam (GUM → GU)
    11401: "GU",
    # Uganda (UGA → UG)
    11501: "UG",
    # Congo / DR Congo (COD → CD)
    11601: "CD",
    # Singapore (SGP → SG)
    11701: "SG",
    # Peru (PER → PE)
    11801: "PE",
    # Bahamas (BHS → BS)
    11901: "BS",
    # Brunei (BRN → BN)
    12001: "BN",
    # Malta (MLT → MT)
    12101: "MT",
    # Guyana (GUY → GY)
    12201: "GY",
    # Armenia (ARM → AM)
    12301: "AM",
    # Vietnam (VNM → VN)
    12401: "VN",
    # Liechtenstein (LIE → LI)
    12501: "LI",
    # Timor-Leste (TLS → TL)
    12601: "TL",
    # Palestine (PSE → PS)
    12701: "PS",
    # Nigeria (NGA → NG)
    12801: "NG",
    # Ghana (GHA → GH)
    12901: "GH",
    # Sri Lanka (LKA → LK)
    13001: "LK",
    # Montenegro (MNE → ME)
    13101: "ME",
    # Kosovo (KOS → XK)
    13201: "XK",
    # Iraq (IRQ → IQ)
    13301: "IQ",
    # Honduras (HND → HN)
    13401: "HN",
    # Senegal (SEN → SN)
    13501: "SN",
    # Mali (MLI → ML)
    13601: "ML",
    # Benin (BEN → BJ)
    13701: "BJ",
    # Belize (BLZ → BZ)
    13801: "BZ",
    # Grenada (GRD → GD)
    13901: "GD",
}


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
    """Normalize name: uppercase, strip accent combining chars, then replace
    precomposed characters that NFKD cannot decompose (Polish ł, Nordic Ø, etc.)
    so PCM 'Michal' matches Google-Sheet 'Michał', 'Øxenberg' matches 'Oxenberg'.
    """
    import unicodedata
    nfkd = unicodedata.normalize("NFKD", name.upper())
    s = "".join(c for c in nfkd if not unicodedata.combining(c))
    # Precomposed chars not handled by NFKD — map to ASCII equivalents
    for src, dst in (
        ("Ł", "L"),   # Ł  (Polish)
        ("ł", "L"),   # ł
        ("Ø", "O"),   # Ø  (Nordic)
        ("ø", "O"),   # ø
        ("Æ", "AE"),  # Æ
        ("æ", "AE"),  # æ
        ("ß", "SS"),  # ß  (German)
        ("Đ", "D"),   # Đ  (Croatian)
        ("đ", "D"),   # đ
    ):
        s = s.replace(src, dst)
    return s.strip()


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


def load_uci_points(path: str) -> tuple[dict[str, int], dict[frozenset, int]]:
    """
    Load UCI top-1000 from CSV export of Google Sheets.
    Returns:
      - exact_map: normalized_name -> uci_points
      - token_map: frozenset(name_tokens) -> uci_points (for fuzzy matching)
    Format expected: columns Pos, Navn, Point
    """
    print(f"📂 Loading UCI points from: {path}")
    df = pd.read_csv(path)

    # Try to find name and points columns flexibly
    name_col = next((c for c in df.columns if "navn" in c.lower() or "name" in c.lower()), None)
    pts_col = next((c for c in df.columns if "point" in c.lower()), None)

    if not name_col or not pts_col:
        raise ValueError(f"Cannot find name/points columns. Found: {list(df.columns)}")

    exact_map: dict[str, int] = {}
    token_map: dict[frozenset, int] = {}
    for _, row in df.iterrows():
        name = str(row[name_col]).strip()
        try:
            pts = int(float(row[pts_col]))
        except (ValueError, TypeError):
            continue
        normalized = normalize_name(name)
        exact_map[normalized] = pts
        tokens = frozenset(normalized.split())
        # Keep highest points when multiple riders share same token set
        if tokens not in token_map or token_map[tokens] < pts:
            token_map[tokens] = pts

    print(f"  ✅ {len(exact_map)} riders with UCI points loaded")
    return exact_map, token_map


def find_uci_points(match_key: str, exact_map: dict[str, int],
                    token_map: dict[frozenset, int]) -> int | None:
    """
    Multi-strategy UCI points lookup to handle compound surnames, middle names,
    and name variants between PCM WORLD_DB and UCI ranking format.

    Strategies (in order):
    1. Exact normalized match  (e.g. "PEDERSEN MADS")
    2. Reversed token order    (e.g. "MADS PEDERSEN" → "PEDERSEN MADS")
    3. Exact token-set match   (handles reordered compound names,
                                e.g. PCM "SOJBERG PEDERSEN RASMUS" ↔ UCI "PEDERSEN RASMUS SOJBERG")
    4. PCM tokens ⊆ UCI tokens (handles UCI adding middle/extra names,
                                e.g. PCM "HONORE MIKKEL" ⊆ UCI "HONORE MIKKEL FROLICH")
    5. UCI tokens ⊆ PCM tokens (handles UCI dropping part of PCM compound surname,
                                e.g. UCI "CORT MAGNUS" ⊆ PCM "CORT NIELSEN MAGNUS")
    """
    # Strategy 1: exact match
    pts = exact_map.get(match_key)
    if pts is not None:
        return pts

    # Strategy 2: reversed
    parts = match_key.split()
    if len(parts) >= 2:
        pts = exact_map.get(" ".join(reversed(parts)))
        if pts is not None:
            return pts

    if not parts:
        return None

    pcm_tokens = frozenset(parts)

    # Strategy 3: exact token-set (same words, different order)
    pts = token_map.get(pcm_tokens)
    if pts is not None:
        return pts

    # Strategies 4 & 5: subset matching — require ≥2 shared tokens to avoid
    # false positives on common single-word last names.
    if len(pcm_tokens) >= 2:
        for uci_tokens, uci_pts in token_map.items():
            if len(uci_tokens) >= 2:
                if pcm_tokens.issubset(uci_tokens) or uci_tokens.issubset(pcm_tokens):
                    return uci_pts

    return None


def merge_data(worlddb: pd.DataFrame,
               uci_map: tuple[dict[str, int], dict[frozenset, int]] | dict[str, int],
               team_map: dict[int, str] | None = None) -> list[dict]:
    """Merge WORLD_DB stats with UCI points."""
    # Accept both old dict form (backwards compat) and new tuple form
    if isinstance(uci_map, tuple):
        exact_map, token_map = uci_map
    else:
        exact_map = uci_map
        token_map = {frozenset(k.split()): v for k, v in uci_map.items()}

    records = []
    matched = 0
    unmatched = 0

    for _, row in worlddb.iterrows():
        pcm_id = int(row["IDcyclist"])
        match_key = row["_match_name"]

        # Strategy 0: explicit override for cases normal matching can't bridge
        if pcm_id in PCM_UCI_OVERRIDE:
            uci_pts = exact_map.get(PCM_UCI_OVERRIDE[pcm_id])
        else:
            uci_pts = None

        if uci_pts is None:
            uci_pts = find_uci_points(match_key, exact_map, token_map)

        if uci_pts is not None:
            matched += 1
        else:
            uci_pts = 1
            unmatched += 1

        fk_team = int(row["fkIDteam"]) if pd.notna(row.get("fkIDteam")) else None

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
            "nationality_code": REGION_TO_ISO.get(
                int(row["fkIDregion"]) if pd.notna(row.get("fkIDregion")) else -1
            ),
        }

        # Only set ai_team_id for bank team riders (fkIDteam = 119)
        if fk_team == 119 and team_map:
            bank_id = team_map.get(119)
            if bank_id:
                record["ai_team_id"] = bank_id

        # Add stats
        for stat_key, pcm_col in STAT_MAP.items():
            val = row.get(pcm_col)
            record[stat_key] = int(val) if pd.notna(val) and val != 0 else None

        records.append(record)

    print(f"  ✅ Matched {matched} riders to UCI points, {unmatched} set to price=1")
    return records


def fetch_team_map(url: str, key: str) -> dict[int, str]:
    """Fetch ai_source_id → team UUID mapping from Supabase."""
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }
    resp = requests.get(
        f"{url}/rest/v1/teams?select=id,ai_source_id&is_ai=eq.true&ai_source_id=not.is.null",
        headers=headers,
        timeout=15,
    )
    if resp.status_code != 200:
        print(f"  ⚠️  Could not fetch teams: {resp.status_code}")
        return {}
    teams = resp.json()
    mapping = {t["ai_source_id"]: t["id"] for t in teams if t.get("ai_source_id")}
    print(f"  ✅ Loaded {len(mapping)} AI team mappings (incl. bank team)")
    return mapping


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

    team_map = {}
    if args.supabase_url and args.supabase_key:
        print(f"\n🔗 Fetching AI team mappings from Supabase...")
        team_map = fetch_team_map(args.supabase_url, args.supabase_key)

    records = merge_data(worlddb, uci_map, team_map)

    print(f"\n📊 Summary:")
    print(f"  Total riders: {len(records)}")
    print(f"  U25 riders: {sum(1 for r in records if r['is_u25'])}")
    print(f"  With UCI points > 1: {sum(1 for r in records if r['uci_points'] > 1)}")
    with_nat = sum(1 for r in records if r["nationality_code"])
    print(f"  With nationality_code: {with_nat} / {len(records)} ({100*with_nat//len(records) if records else 0}%)")

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
