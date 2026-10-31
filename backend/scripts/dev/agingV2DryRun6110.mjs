#!/usr/bin/env node
// #6499 / #6110 · PRØVEKØRSEL: Udvikling 2.0's tilbagegang ved sæsonskiftet.
//
// 100 % READ-ONLY. Scriptet SELECT'er mod prod og skriver kun lokale filer.
// Ingen --apply, intet flag-flip.
//
// SAMME BEREGNINGSSTI SOM SKIFTET. Prod-rækkerne hentes ÉN gang ind i et
// in-memory øjebliksbillede, og produktionens egen developRidersForSeason
// (riderProgressionEngine.js) køres mod billedet to gange:
//   NY      med den afsluttede sæsons målte belastning
//   NY-HEL  belastningen fremskrevet lineært til en hel sæson
//           (den aktive sæson er ikke slut; ved det rigtige skifte er den det)
// #6499: GAMMEL-kørslen (flaget slukket) er væk. Motoren kender kun den nye
// aldring efter S5-skiftet, så der findes ingen gammel sti at sammenligne med.
// Motorens skrivninger (apply_rider_development) fanges i hukommelsen; der
// findes ingen klient i denne fil der kan skrive til prod. Prod-klienten bruges
// kun til de SELECT'er herunder.
//
// Kør fra backend/:
//   infisical run --env=prod --silent -- node scripts/dev/agingV2DryRun6110.mjs
//
// Output:
//   balance-internals/6110/aging-v2-dry-run-<dato>.md + .json  (gitignoreret:
//     gennemsnit, bremse, fald pr. rytter; må aldrig committes, hard rule 17)
//   docs/snapshots/6110/aging-v2-dry-run-<dato>.md            (kun antal)

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { fetchAllRows } from "../../lib/supabasePagination.js";
import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { developRidersForSeason, SEASON_RIDER_COLUMNS } from "../../lib/riderProgressionEngine.js";
import { RETIREMENT_NOTICE_COLUMNS } from "../../lib/retirementNotice.js";
import { AGING_V2_DECLINING_ABILITIES, agingBrake } from "../../lib/riderProgression.js";
import { loadSeasonDevelopmentLoad } from "../../lib/seasonDevelopmentLoad.js";
import { readFlagStage, evaluateFlagStage } from "../../lib/featureStage.js";
import { DISPLAY_RECIPE_KEYS, ratingForRole } from "../../lib/weights/displayRecipes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "../../..");

export const AGE_BANDS = Object.freeze([
  { key: "<=28", lo: 0, hi: 28 },
  { key: "29-30", lo: 29, hi: 30 },
  { key: "31-33", lo: 31, hi: 33 },
  { key: "34-36", lo: 34, hi: 36 },
  { key: "37+", lo: 37, hi: 999 },
]);
export const GROUPS = Object.freeze(["manager", "AI", "fri"]);

export function ageBand(age) {
  return AGE_BANDS.find((b) => age >= b.lo && age <= b.hi)?.key ?? null;
}

export function riderGroup(teamId, teamById) {
  if (teamId == null) return "fri";
  const t = teamById.get(teamId);
  if (!t) return "fri";
  return t.is_ai || t.is_bank ? "AI" : "manager";
}

function bestRating(abilities) {
  let best = null;
  for (const role of DISPLAY_RECIPE_KEYS) {
    const r = ratingForRole(abilities, role);
    if (r !== null && (best === null || r > best)) best = r;
  }
  return best;
}

// ── In-memory klient over øjebliksbilledet: præcis det motoren læser. ─────────
// Skrivninger findes ikke her: upsert er en no-op, og rpc fanger kun
// apply_rider_development i en liste.
export function snapshotClient(tables, captured) {
  function builder(table, filters = []) {
    const rows = () => (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
    const api = {
      select() { return api; },
      eq(col, val) { return builder(table, [...filters, [col, val]]); },
      order() { return api; },
      range(from, to) { return Promise.resolve({ data: rows().slice(from, to + 1), error: null }); },
      maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }); },
      upsert() { return Promise.resolve({ error: null }); },
    };
    return api;
  }
  return {
    from: (table) => builder(table),
    rpc(fn, args) {
      if (fn !== "apply_rider_development") {
        return Promise.resolve({ data: null, error: { message: `dry-run: rpc ${fn} blocked` } });
      }
      captured.push(args);
      return Promise.resolve({ data: true, error: null });
    },
  };
}

async function runEngine(tables, { seasonNumber, seasonLoadByRider }) {
  const captured = [];
  const summary = await developRidersForSeason({
    supabase: snapshotClient(tables, captured),
    seasonId: `dry-run-6110-s${seasonNumber}`,
    seasonNumber,
    notify: false,
    seasonLoadByRider,
    detectGraduatesFn: async () => {},
  });
  return { summary, byRider: new Map(captured.map((c) => [c.p_rider_id, c])) };
}

// Pr. rytter: fysisk fald, vækst, ændring i tekniske/mentale, synligt ratingfald.
export function riderDelta(before, after) {
  let physicalDrop = 0;
  let grew = false;
  let stableChanged = false;
  for (const k of VISIBLE_ABILITIES) {
    const b = before[k];
    const a = after[k];
    if (b == null || a == null) continue;
    if (a > b) grew = true;
    if (AGING_V2_DECLINING_ABILITIES.includes(k)) physicalDrop += Math.max(0, b - a);
    else if (a !== b) stableChanged = true;
  }
  const rb = bestRating(before);
  const ra = bestRating(after);
  return { physicalDrop, grew, stableChanged, ratingDrop: rb != null && ra != null && ra < rb };
}

function emptyCell() {
  return {
    n: 0, raceDays: 0, hardDays: 0, brake: 0, brakeFull: 0,
    neu: { drop: 0, anyDrop: 0, grew: 0, stable: 0, ratingDrop: 0 },
    full: { drop: 0, anyDrop: 0, grew: 0, stable: 0, ratingDrop: 0 },
  };
}

function addDelta(acc, d) {
  acc.drop += d.physicalDrop;
  if (d.physicalDrop >= 1) acc.anyDrop++;
  if (d.grew) acc.grew++;
  if (d.stableChanged) acc.stable++;
  if (d.ratingDrop) acc.ratingDrop++;
}

const avg = (sum, n) => (n ? Math.round((sum / n) * 100) / 100 : 0);

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_KEY mangler (kør via infisical run --env=prod)");
    process.exit(1);
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ── SELECT'erne (de eneste prod-kald) ───────────────────────────────────────
  const { data: active, error: seasonErr } = await sb
    .from("seasons").select("id, number, race_days_total, race_days_completed")
    .eq("status", "active").order("number", { ascending: false }).limit(1).maybeSingle();
  if (seasonErr || !active) throw new Error(`aktiv sæson: ${seasonErr?.message ?? "ingen"}`);
  const newSeasonNumber = Number(active.number) + 1;

  const [riders, abilityRows, teams, dailyTrainingStage, load] = await Promise.all([
    fetchAllRows(() => sb.from("riders")
      .select(`${SEASON_RIDER_COLUMNS}, ${RETIREMENT_NOTICE_COLUMNS}`).eq("is_retired", false).order("id")),
    fetchAllRows(() => sb.from("rider_derived_abilities")
      .select(`rider_id, ${VISIBLE_ABILITIES.join(", ")}, ability_caps`).order("rider_id")),
    fetchAllRows(() => sb.from("teams").select("id, is_ai, is_bank, is_frozen, is_test_account").order("id")),
    readFlagStage(sb, "daily_training_enabled"),
    loadSeasonDevelopmentLoad({ supabase: sb, seasonId: active.id }),
  ]);
  const dailyTrainingEnabled = evaluateFlagStage(dailyTrainingStage);

  // Fremskrivning til hel sæson: lineært på den andel af løbsdagene der er kørt.
  const total = Number(active.race_days_total) || 0;
  const done = Number(active.race_days_completed) || 0;
  const scale = total > 0 && done > 0 ? total / done : 1;
  const fullLoad = new Map([...load.byRider].map(([id, l]) => [id, { raceDays: l.raceDays * scale, hardDays: l.hardDays * scale }]));

  const tables = {
    riders: riders.map((r) => ({ ...r, is_retired: false })),
    rider_derived_abilities: abilityRows,
    teams,
    rider_development_log: [],
    app_config: [],
    rider_derived_ability_history: [],
  };

  const neu = await runEngine(tables, { seasonNumber: newSeasonNumber, seasonLoadByRider: load.byRider });
  const full = await runEngine(tables, { seasonNumber: newSeasonNumber, seasonLoadByRider: fullLoad });

  // ── Tabellen ────────────────────────────────────────────────────────────────
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const abilityByRider = new Map(abilityRows.map((a) => [a.rider_id, a]));
  const cells = new Map();
  const totals = emptyCell();
  for (const r of riders) {
    const n = neu.byRider.get(r.id);
    const f = full.byRider.get(r.id);
    if (!n || !f) continue; // motoren sprang rytteren over (samme for begge)
    const age = Number(n.p_log.age);
    const key = `${ageBand(age)}|${riderGroup(r.team_id, teamById)}`;
    if (!cells.has(key)) cells.set(key, emptyCell());
    const before = abilityByRider.get(r.id);
    const l = load.byRider.get(r.id) ?? { raceDays: 0, hardDays: 0 };
    // D6: som motoren (riderProgressionEngine) bremser hårde dage kun managerryttere.
    const isManager = riderGroup(r.team_id, teamById) === "manager";
    const eff = (x) => (isManager || !x ? x : { ...x, hardDays: 0 });
    for (const c of [cells.get(key), totals]) {
      c.n++;
      c.raceDays += l.raceDays;
      c.hardDays += l.hardDays;
      c.brake += agingBrake(eff(l));
      c.brakeFull += agingBrake(eff(fullLoad.get(r.id)));
      addDelta(c.neu, riderDelta(before, n.p_log.abilities));
      addDelta(c.full, riderDelta(before, f.p_log.abilities));
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  const orderedKeys = [];
  for (const b of AGE_BANDS) for (const g of GROUPS) orderedKeys.push(`${b.key}|${g}`);

  // Privat: gennemsnit og fald (balance-internals, gitignoreret).
  const priv = [];
  priv.push(`# Udvikling 2.0 tilbagegang — prøvekørsel ${date} (PRIVAT, hard rule 17)`);
  priv.push("");
  priv.push(`Aktiv sæson ${active.number} → skifte til sæson ${newSeasonNumber}. Alder = alder i den NYE sæson (motorens input).`);
  priv.push(`Løbsdage kørt: ${done} af ${total} (fremskrivning ×${Math.round(scale * 100) / 100}). Daglig træning: ${dailyTrainingEnabled ? "on" : "off"}. Løb i sæsonen: ${load.raceCount}, heraf endagsløb: ${load.singleRaceCount} (${load.oneDayRiderDays} rytter-løbsdage fra endagsløb).`);
  priv.push("");
  priv.push("Fald = sum af fysiske evner + brosten pr. rytter (snit). ≥1 = antal ryttere med mindst ét points fald. Vækst/tek+mental/ratingfald = antal ryttere.");
  priv.push("");
  priv.push("| Alder | Gruppe | N | Løbsdage | Hårde dage | Bremse (målt / hel) | Fald (målt / hel) | ≥1 fald (målt / hel) | Vækst | Tek+mental ændret | Synligt ratingfald (målt / hel) |");
  priv.push("|---|---|---|---|---|---|---|---|---|---|---|");
  const row = (label, group, c) => `| ${label} | ${group} | ${c.n} | ${avg(c.raceDays, c.n)} | ${avg(c.hardDays, c.n)} | ${avg(c.brake, c.n)} / ${avg(c.brakeFull, c.n)} | ${avg(c.neu.drop, c.n)} / ${avg(c.full.drop, c.n)} | ${c.neu.anyDrop} / ${c.full.anyDrop} | ${c.neu.grew} | ${c.neu.stable} | ${c.neu.ratingDrop} / ${c.full.ratingDrop} |`;
  for (const k of orderedKeys) {
    const c = cells.get(k);
    if (!c) continue;
    const [band, group] = k.split("|");
    priv.push(row(band, group, c));
  }
  priv.push(row("**Alle**", "", totals));
  priv.push("");
  priv.push(`Motor-summary ny: ${JSON.stringify(neu.summary)}`);
  priv.push(`Motor-summary ny-hel: ${JSON.stringify(full.summary)}`);

  const privDir = join(REPO, "balance-internals", "6110");
  mkdirSync(privDir, { recursive: true });
  writeFileSync(join(privDir, `aging-v2-dry-run-${date}.md`), priv.join("\n") + "\n");
  writeFileSync(join(privDir, `aging-v2-dry-run-${date}.json`), JSON.stringify({
    date, activeSeason: active.number, newSeasonNumber, raceDaysDone: done, raceDaysTotal: total, scale,
    dailyTrainingEnabled, cells: Object.fromEntries(cells), totals,
  }, null, 2) + "\n");

  // Offentligt: KUN antal (ingen gennemsnit, ingen fald-størrelser, ingen navne).
  const pub = [];
  pub.push(`# Udvikling 2.0 del 1 — prøvekørsel af tilbagegangen (${date})`);
  pub.push("");
  pub.push("Read-only prøvekørsel af `backend/scripts/dev/agingV2DryRun6110.mjs` mod prod (#6499, #6110).");
  pub.push("Produktionens egen sæsonskifte-motor er kørt mod et øjebliksbillede med den nye aldring (eneste regel siden #6499).");
  pub.push("\"Ny (hel)\" fremskriver den igangværende sæsons belastning til en hel sæson. Alder = alder i den nye sæson.");
  pub.push("Kun antal ryttere står her; gennemsnit og fald-størrelser ligger privat i `balance-internals/6110/`.");
  pub.push("");
  pub.push("| Alder | Gruppe | Ryttere | ≥1 fald (ny / ny hel) | Vækst ved skiftet | Tekniske+mentale ændret | Synligt ratingfald (ny / ny hel) |");
  pub.push("|---|---|---|---|---|---|---|");
  const pubRow = (label, group, c) => `| ${label} | ${group} | ${c.n} | ${c.neu.anyDrop} / ${c.full.anyDrop} | ${c.neu.grew} | ${c.neu.stable} | ${c.neu.ratingDrop} / ${c.full.ratingDrop} |`;
  for (const k of orderedKeys) {
    const c = cells.get(k);
    if (!c) continue;
    const [band, group] = k.split("|");
    pub.push(pubRow(band, group, c));
  }
  pub.push(pubRow("**Alle**", "", totals));
  pub.push("");
  pub.push(`Kontrol: vækst ved skiftet (ny) = ${totals.neu.grew}, tekniske+mentale ændret (ny) = ${totals.neu.stable}. Begge skal være 0.`);
  pub.push(`Endagsløb tæller med i løbsdagene: ${load.singleRaceCount} endagsløb i sæsonen gav ${load.oneDayRiderDays} rytter-løbsdage (fra rytterens 'gc'-række; endagsløb har ingen 'stage'-rækker).`);
  // #6751: generalprøven kalder med --no-public-snapshot, så en gentaget kørsel
  // ikke efterlader en ny offentlig fil i docs/ (alt output bliver privat).
  const writePublic = !process.argv.includes("--no-public-snapshot");
  if (writePublic) {
    const pubDir = join(REPO, "docs", "snapshots", "6110");
    mkdirSync(pubDir, { recursive: true });
    writeFileSync(join(pubDir, `aging-v2-dry-run-${date}.md`), pub.join("\n") + "\n");
  }

  console.log(`[6110-dry-run] ${totals.n} ryttere. Ny: vækst=${totals.neu.grew}, tek+mental=${totals.neu.stable}.`);
  console.log(`[6110-dry-run] privat: balance-internals/6110/aging-v2-dry-run-${date}.md`);
  if (writePublic) console.log(`[6110-dry-run] offentligt: docs/snapshots/6110/aging-v2-dry-run-${date}.md`);
  if (totals.neu.grew !== 0 || totals.neu.stable !== 0) process.exitCode = 2;
}

const isMain = process.argv[1]
  && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (isMain) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
