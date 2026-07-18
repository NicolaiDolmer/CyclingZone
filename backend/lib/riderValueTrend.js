// #2499 — værdi-bevægelse skal kunne SES: on-demand delta (7/14 dage) beregnet
// fra rider_derived_ability_history-snapshots via den eksisterende værdimodel
// (recomputeRiderValue, samme kæde som riderValueRefresh.js/refreshChangedRiderValues).
// INGEN ny tabel/migration — historik læses fra den allerede eksisterende
// snapshot-tabel (siden 29/6, database/2026-06-29-rider-derived-ability-history.sql).
//
// Forenkling (bevidst, dokumenteret her — ingen skjult antagelse): vi har INGEN
// historik for prize_earnings_bonus, kun for abilities (→ base_value). Fordi
// market_value = base_value + prize_earnings_bonus, og vi ikke fabrikerer en
// historisk bonus vi ikke har data for, antager vi bonus KONSTANT over vinduet.
// Under den antagelse er delta-på-base_value identisk med delta-på-market_value
// (bonus-leddet går ud på begge sider af subtraktionen) — ingen dobbelt-udregning
// nødvendig, og deltaet forbliver 100% ærligt for den trænings-drevne bevægelse
// #2459 allerede har verificeret (median +7,6 % / 14 dage på rigtige hold).
import { recomputeRiderValue } from "./riderValueRefresh.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const VALUE_TREND_WINDOWS = [7, 14];

// snapshotsAsc: [{ snapshot_date, abilities }] sorteret ASC på snapshot_date.
// Finder den SENESTE snapshot PÅ ELLER FØR referenceMs — rent retrospektivt,
// ALDRIG en fremtidig/projekteret værdi (#2100 er ejer-udskudt, ikke denne PR).
function findSnapshotAtOrBefore(snapshotsAsc, referenceMs) {
  let found = null;
  for (const s of snapshotsAsc) {
    const t = new Date(s.snapshot_date).getTime();
    if (Number.isNaN(t)) continue;
    if (t <= referenceMs) found = s;
    else break; // ASC-sorteret: resten af listen ligger kun længere ude i tiden
  }
  return found;
}

// Beregn delta-vinduer for ÉN rytter. currentBaseValue = riders.base_value
// (den AUTORITATIVE DB-værdi — genberegnes ikke her, for at matche det viste
// market_value 1:1 uden model-afrundingsdrift).
// Returnerer { "7": {delta, pct, actualDaysAgo, snapshotDate} | null, "14": {...} | null }.
// null for et vindue betyder: historikken rækker ikke langt nok tilbage endnu
// (fx nytilkommen rytter) — UI'et skal da bare UDELADE deltaet, aldrig fabrikere.
// #2594: `rider` bærer age + potentiale (v4-modellen kræver dem til karriere-NPV'en).
// Historikken er ≤14 dage gammel = samme sæson, så nuværende alder er korrekt for
// snapshottet (alder er sæson-drevet).
export function computeRiderValueTrend({ currentBaseValue, rider = {}, snapshotsAsc = [], baseline, model, now = new Date() }) {
  const windows = {};
  const nowMs = now.getTime();
  // Number(null) === 0 (falsk-finite) — eksplicit null/undefined-tjek FØRST,
  // ellers ville en rytter uden base_value stille vise et 0-baseret delta.
  const validCurrent = currentBaseValue != null && Number.isFinite(Number(currentBaseValue));
  for (const days of VALUE_TREND_WINDOWS) {
    if (!validCurrent || !baseline || !model) { windows[days] = null; continue; }
    const targetMs = nowMs - days * DAY_MS;
    const snap = findSnapshotAtOrBefore(snapshotsAsc, targetMs);
    if (!snap?.abilities) { windows[days] = null; continue; }
    const historical = recomputeRiderValue(rider, snap.abilities, baseline, model);
    if (historical.base_value == null || historical.base_value <= 0) { windows[days] = null; continue; }
    const delta = Math.round(Number(currentBaseValue) - historical.base_value);
    const pct = Math.round((delta / historical.base_value) * 1000) / 10; // 1 decimal
    const actualDaysAgo = Math.max(1, Math.round((nowMs - new Date(snap.snapshot_date).getTime()) / DAY_MS));
    windows[days] = { delta, pct, actualDaysAgo, snapshotDate: snap.snapshot_date };
  }
  return windows;
}

// Grupér flade snapshot-rækker (fra ét .in("rider_id", ids)-kald) pr. rytter,
// sorteret ASC pr. gruppe (computeRiderValueTrend kræver ASC). Delt af
// batch-endpointet (holdliste/trup-oversigt — én query, ingen N+1).
export function groupSnapshotsByRider(rows = []) {
  const map = new Map();
  for (const row of rows) {
    if (!row?.rider_id) continue;
    if (!map.has(row.rider_id)) map.set(row.rider_id, []);
    map.get(row.rider_id).push(row);
  }
  for (const list of map.values()) {
    list.sort((a, b) => new Date(a.snapshot_date) - new Date(b.snapshot_date));
  }
  return map;
}
