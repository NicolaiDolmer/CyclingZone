# 2026-05-28 — UCI scraper matched-zero safety gate

## Symptom

High-value riders were protected when `find_uci_match` returned `None`, but not when the upstream ranking matched the rider name and returned `0` points.

## Root cause

`sync_supabase` only ran the high-value safety-gate in the unmatched branch. A matched zero followed the normal matched path and was clamped to `MIN_UCI_POINTS`, allowing stars to be downgraded to minimum.

## Fix

Before the unmatched branch, treat `new_pts <= MIN_UCI_POINTS` for high-value riders as `None` unless the rider is explicitly allowlisted in `UCI_FORCE_MINIMUM`. This reuses the existing protection and history logging path.

## Forward guard

`test_high_value_rider_matched_with_zero_falls_to_protection` covers a Vingegaard-style matched-zero response and verifies no rider patch is emitted while history preserves the existing value.

Refs #702 and the earlier decimal-points incident learning from 2026-05-27.
