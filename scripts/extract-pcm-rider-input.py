#!/usr/bin/env python3
"""Ekstraktor for #669 rename-pipelinen: PCM-xlsx -> TSV-input til Node-generatoren.

Laeser den committede PCM-dump (scripts/WORLD DB 2026 Dyn_Cyclist.xlsx) og
emitterer pcm_id + nationalitet + nuvaerende navn (kun til kollisions-korpus)
som TSV. Region->ISO2-mappingen genbruges fra scripts/import_riders.py
(samme tabel som seedede prod), saa nationaliteten matcher riders-tabellen.

Output (scripts/out/ er gitignoret — PCM-navne maa ikke committes i nye filer):
    scripts/out/669-pcm-rider-input.tsv

Brug:
    python scripts/extract-pcm-rider-input.py
    python scripts/extract-pcm-rider-input.py --xlsx <sti> --out <sti>
"""

import argparse
import os
import sys

import openpyxl

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)
from import_riders import REGION_TO_ISO  # noqa: E402  (har __main__-guard; importerer kun data)

DEFAULT_XLSX = os.path.join(SCRIPT_DIR, "WORLD DB 2026 Dyn_Cyclist.xlsx")
DEFAULT_OUT = os.path.join(SCRIPT_DIR, "out", "669-pcm-rider-input.tsv")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--xlsx", default=DEFAULT_XLSX)
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()

    wb = openpyxl.load_workbook(args.xlsx, read_only=True)
    ws = wb["Dyn_Cyclist"]

    rows = ws.iter_rows(values_only=True)
    header = {name: i for i, name in enumerate(next(rows))}
    for col in ("IDcyclist", "gene_sz_firstname", "gene_sz_lastname", "fkIDregion"):
        if col not in header:
            raise SystemExit(f"Manglende kolonne i xlsx: {col}")

    out_rows = []
    unmapped: dict[int, int] = {}
    for row in rows:
        pcm_id = row[header["IDcyclist"]]
        if pcm_id is None:
            continue
        region = int(row[header["fkIDregion"]] or -1)
        iso = REGION_TO_ISO.get(region)
        if iso is None:
            unmapped[region] = unmapped.get(region, 0) + 1
            continue
        first = str(row[header["gene_sz_firstname"]] or "").strip()
        last = str(row[header["gene_sz_lastname"]] or "").strip()
        out_rows.append((int(pcm_id), iso, first, last))

    if unmapped:
        # Fail fast: en rytter uden nationalitet ville stille ryge ud af rename-scopet.
        raise SystemExit(f"FEJL: {sum(unmapped.values())} ryttere med umappede regioner: {unmapped}")

    out_rows.sort(key=lambda r: r[0])
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("pcm_id\tnationality_code\tfirstname\tlastname\n")
        for pcm_id, iso, first, last in out_rows:
            fh.write(f"{pcm_id}\t{iso}\t{first}\t{last}\n")

    nats = {iso for _, iso, _, _ in out_rows}
    print(f"Skrev {len(out_rows)} ryttere ({len(nats)} nationaliteter) til {args.out}")


if __name__ == "__main__":
    main()
