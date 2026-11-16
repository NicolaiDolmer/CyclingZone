#!/usr/bin/env node
// #5865 READ-ONLY dry-run: hvad ville hver mode (A clear / B cap / C light) gøre ved
// de skader der er aktive NU, hvis sæsonskiftet kørte med en given sæsonstart?
//
// Brug:
//   infisical run --env=prod -- node scripts/dry-run-5865-season-injury-reset.mjs --season-start 2026-12-02
//   (valgfrit: --today YYYY-MM-DD  --cap N  --light N)
//
// SKRIVER ALDRIG. Der findes ingen --apply: tændingen sker via app_config-rækken
// season_injury_reset_mode (ejer-go), og selve skiftet kører i seasonStartHooks.js.
// Output er kun aggregerede tal (ingen rytter-, hold- eller bruger-id'er), men tallene
// er motor-målinger: læg dem i balance-internals/, ikke i repoet (hard rule 17).

import { pathToFileURL } from "node:url";
import {
  seasonResetInjury,
  injuryDatesIntoSeason,
  SEASON_INJURY_RESET_DEFAULTS,
} from "../backend/lib/seasonInjuryReset.js";
import { copenhagenDateString } from "../backend/lib/copenhagenTime.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/**
 * REN: sammendrag pr. mode for et sæt skade-rækker.
 * @param {{rows: Array<object>, seasonStartDate: string, today: string, capDates?: number, lightMaxDates?: number}} args
 */
export function summarize({
  rows,
  seasonStartDate,
  today,
  capDates = SEASON_INJURY_RESET_DEFAULTS.capDates,
  lightMaxDates = SEASON_INJURY_RESET_DEFAULTS.lightMaxDates,
}) {
  const active = (rows ?? []).filter((r) => typeof r.injured_until === "string" && r.injured_until >= today);
  const buckets = { endsBeforeStart: 0, dates1: 0, dates2to3: 0, dates4plus: 0 };
  const byCause = {};
  for (const r of active) {
    const into = injuryDatesIntoSeason({ injuredUntil: r.injured_until, seasonStartDate });
    if (into === 0) buckets.endsBeforeStart++;
    else if (into === 1) buckets.dates1++;
    else if (into <= 3) buckets.dates2to3++;
    else buckets.dates4plus++;
    const cause = r.injury_cause ?? "unknown";
    byCause[cause] = (byCause[cause] ?? 0) + (into > 0 ? 1 : 0);
  }
  const modes = {};
  for (const mode of ["off", "clear", "cap", "light"]) {
    let cleared = 0;
    let shortened = 0;
    for (const r of active) {
      const next = seasonResetInjury({ condition: r, mode, seasonStartDate, today, capDates, lightMaxDates });
      if (!next) continue;
      if (next.injured_until === null) cleared++;
      else shortened++;
    }
    modes[mode] = { cleared, shortened, unchanged: active.length - cleared - shortened };
  }
  const stillInjuredAtStart = active.length - buckets.endsBeforeStart;
  return { activeNow: active.length, stillInjuredAtStart, buckets, stillInjuredByCause: byCause, modes, capDates, lightMaxDates };
}

export async function run({ supabase, seasonStartDate, today, capDates, lightMaxDates, log = console.log }) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("rider_condition")
      .select("injured_until, injury_cause")
      .gte("injured_until", today)
      .order("rider_id")
      .range(from, from + 999);
    if (error) throw new Error(`rider_condition: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const out = summarize({ rows, seasonStartDate, today, capDates, lightMaxDates });
  log(JSON.stringify({ today, seasonStartDate, ...out }, null, 2));
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2);
  const today = argValue(argv, "--today") ?? copenhagenDateString(new Date());
  const seasonStartDate = argValue(argv, "--season-start");
  if (!DATE_RE.test(today) || !DATE_RE.test(seasonStartDate ?? "")) {
    console.error("Usage: --season-start YYYY-MM-DD [--today YYYY-MM-DD] [--cap N] [--light N]");
    process.exit(2);
  }
  const capDates = Number(argValue(argv, "--cap") ?? SEASON_INJURY_RESET_DEFAULTS.capDates);
  const lightMaxDates = Number(argValue(argv, "--light") ?? SEASON_INJURY_RESET_DEFAULTS.lightMaxDates);
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required (run via infisical).");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  await run({ supabase, seasonStartDate, today, capDates, lightMaxDates });
}
