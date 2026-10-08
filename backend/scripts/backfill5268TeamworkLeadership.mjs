// #5268 — fyld TOMME Holdarbejde/Lederskab én gang med fødselsformlen (ejer-valg A, 1/10).
// ============================================================================
//   infisical run --env=prod -- node backend/scripts/backfill5268TeamworkLeadership.mjs
//   infisical run --env=prod -- node backend/scripts/backfill5268TeamworkLeadership.mjs \
//     --report-dir=docs/snapshots/5268 --private-dir=<gitignoreret mappe>
//   infisical run --env=prod -- node backend/scripts/backfill5268TeamworkLeadership.mjs \
//     --apply --owner-go --backup-table=backup_5268_rider_derived_abilities_YYYYMMDD --expect-riders=N
//
// Default = TØR KØRSEL. Read-only helt ned i transporten: `readOnlyFetch` afviser
// enhver ikke-GET, så hverken UPDATE, INSERT, RPC eller auth-refresh kan nå
// databasen. `--apply` kræver `--owner-go`, en eksisterende backup-tabel og det
// præcise antal ryttere fra den tørre kørsel (drift-vagt).
//
// ── HVAD DEN GØR ────────────────────────────────────────────────────────────
// Ejer-beslutning 1/10 (valg A + tillæg): eksisterende ryttere røres ikke, MEN
// de tomme felter `teamwork`/`leadership` (NULL i rider_derived_abilities)
// fyldes én gang med fødselsformlen. Felter med en værdi røres ALDRIG — heller
// ikke en lav værdi der måske er opstået fra NULL via træning (det er et åbent
// designpunkt, som den tørre kørsel kun TÆLLER).
//
// Fødselsformlen er `deriveAbilities` (abilityDerivation.js), kaldt PRÆCIS som
// runtime-derive-kæden kalder den for en PCM-rytter (backfillCores.js):
// `deriveAbilities(seedPhysiologyFromLegacy(rider), rider)`. Formlen er
// importeret, aldrig kopieret.
//
// Prior-fødte ryttere (`archetype_draw.birth`) har en ANDEN fødselsformel
// (`deriveBirthAbilities`), og `deriveAbilities` ville udlede dem fra stat_*
// de aldrig fik. De springes derfor over og tælles. I prod 8/10 har ingen af
// dem NULL — de fødes med begge evner.
//
// ── 0 RATINGEFFEKT ──────────────────────────────────────────────────────────
// Holdarbejde/Lederskab står i PENDING_DISPLAY_ABILITIES og er ude af alle
// visnings-opskrifter (#5321). Den tørre kørsel regner ratingen for ALLE
// roller før og efter pr. rytter og rapporterer antallet af ændringer (skal
// være 0). Tilføjes evnerne senere til en opskrift, bliver tallet ≠ 0 og
// `--apply` nægter at køre.
//
// ── IDEMPOTENS ──────────────────────────────────────────────────────────────
// Udvælgelsen er "værdien ER NULL", og opdateringen er betinget af det samme
// (`.is(key, null)` i WHERE). Anden kørsel finder intet at fylde. Et felt der
// har fået en værdi mellem tør kørsel og apply (træning) røres ikke.
//
// Refs #5268 #5912 #5321.

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import { deriveAbilities } from "../lib/abilityDerivation.js";
import { seedPhysiologyFromLegacy } from "../lib/physiologySeeding.js";
import { isBornFromPriors } from "../lib/riderBirthPriors.js";
import { DISPLAY_RECIPE_KEYS, DISPLAY_RECIPE_ABILITIES, ratingForRole } from "../lib/weights/displayRecipes.js";
import { readOnlyFetch, ageOf, bandOf, AGE_BANDS, percentile } from "./dry-run-5268-mental-abilities.js";

export const FILL_KEYS = Object.freeze(["teamwork", "leadership"]);
export const BACKUP_TABLE_PATTERN = /^backup_5268_rider_derived_abilities_\d{8}$/;
// "Lav værdi" i designpunktet: træningsmotoren læser NULL som 0 og skriver evnen
// når baren når et helt point, så en NULL-født rytter der har trænet står lavt.
export const LOW_VALUE_MAX = 5;

const isNull = (v) => v === null || v === undefined;

// ── Plan (ren, testbar) ─────────────────────────────────────────────────────
// Kun rækker hvor mindst én af de to evner er NULL. `fill` indeholder KUN de
// nøgler der er NULL i dag — en eksisterende værdi kommer aldrig med i planen.
export function buildFillPlan(riders, abilityRows) {
  const ridersById = new Map(riders.map((r) => [r.id, r]));
  const entries = [];
  const skipped = { noRider: 0, priorBorn: 0, invalid: 0 };
  for (const row of abilityRows) {
    const nullKeys = FILL_KEYS.filter((k) => isNull(row[k]));
    if (!nullKeys.length) continue;
    const rider = ridersById.get(row.rider_id);
    if (!rider) { skipped.noRider += 1; continue; }
    if (isBornFromPriors(rider)) { skipped.priorBorn += 1; continue; }
    const birth = deriveAbilities(seedPhysiologyFromLegacy(rider), rider);
    const fill = {};
    let ok = true;
    for (const k of nullKeys) {
      const v = birth[k];
      if (!Number.isInteger(v) || v < 1 || v > 99) { ok = false; break; }
      fill[k] = v;
    }
    if (!ok) { skipped.invalid += 1; continue; }
    entries.push({ riderId: row.rider_id, rider, abilities: row, fill });
  }
  return { entries, skipped };
}

// Rækken efter fyldning. Defensiv: en nøgle med værdi beholdes, uanset hvad
// `fill` måtte indeholde.
export function applyFillToRow(row, fill) {
  const out = { ...row };
  for (const k of FILL_KEYS) {
    if (isNull(row[k]) && fill[k] !== undefined) out[k] = fill[k];
  }
  return out;
}

// Rating for alle visnings-roller, før vs. efter, pr. rytter.
export function ratingImpact(entries) {
  let changedRiders = 0;
  let changedPairs = 0;
  for (const e of entries) {
    const after = applyFillToRow(e.abilities, e.fill);
    let changed = false;
    for (const role of DISPLAY_RECIPE_KEYS) {
      if (ratingForRole(e.abilities, role) !== ratingForRole(after, role)) { changedPairs += 1; changed = true; }
    }
    if (changed) changedRiders += 1;
  }
  return { riders: entries.length, roles: DISPLAY_RECIPE_KEYS.length, changedRiders, changedPairs };
}

// ── Optælling af NULL (aktive vs. alle) ─────────────────────────────────────
export function countNulls(riders, abilityRows) {
  const activeById = new Map(riders.map((r) => [r.id, r.is_retired === false]));
  const c = {
    all: { rows: 0, teamwork: 0, leadership: 0, either: 0, both: 0 },
    active: { rows: 0, teamwork: 0, leadership: 0, either: 0, both: 0 },
  };
  for (const row of abilityRows) {
    const groups = activeById.get(row.rider_id) ? [c.all, c.active] : [c.all];
    const tw = isNull(row.teamwork);
    const ld = isNull(row.leadership);
    for (const g of groups) {
      g.rows += 1;
      if (tw) g.teamwork += 1;
      if (ld) g.leadership += 1;
      if (tw || ld) g.either += 1;
      if (tw && ld) g.both += 1;
    }
  }
  return c;
}

// ── Fordeling af de nye værdier ─────────────────────────────────────────────
const PCTS = Object.freeze([0.1, 0.25, 0.5, 0.75, 0.9]);
function pctRow(values) {
  return { n: values.length, ...Object.fromEntries(PCTS.map((p) => [`p${Math.round(p * 100)}`, percentile(values, p)])) };
}

export function distribution(entries) {
  const out = {};
  for (const k of FILL_KEYS) {
    const filled = entries.filter((e) => e.fill[k] !== undefined);
    const byBand = {};
    for (const band of AGE_BANDS) {
      byBand[band.key] = pctRow(filled.filter((e) => bandOf(ageOf(e.rider)) === band.key).map((e) => e.fill[k]));
    }
    const byType = {};
    for (const e of filled) {
      const t = e.rider.primary_type ?? "(ingen)";
      (byType[t] ??= []).push(e.fill[k]);
    }
    out[k] = {
      all: pctRow(filled.map((e) => e.fill[k])),
      byBand,
      byType: Object.fromEntries(Object.entries(byType).sort(([a], [b]) => a.localeCompare(b)).map(([t, v]) => [t, pctRow(v)])),
    };
  }
  return out;
}

// Eksempler spredt over fordelingen (sorteret på holdarbejde), ikke yderpunkter.
export function pickExamples(entries, n = 10) {
  const sorted = [...entries].sort((a, b) =>
    (a.fill.teamwork ?? a.fill.leadership ?? 0) - (b.fill.teamwork ?? b.fill.leadership ?? 0)
    || String(a.riderId).localeCompare(String(b.riderId)));
  if (!sorted.length) return [];
  const picked = [];
  const seen = new Set();
  for (let i = 0; i < n; i += 1) {
    const idx = Math.min(sorted.length - 1, Math.round((i / Math.max(1, n - 1)) * (sorted.length - 1)));
    if (seen.has(idx)) continue;
    seen.add(idx);
    picked.push(sorted[idx]);
  }
  return picked;
}

// ── Det åbne designpunkt: lave værdier der sandsynligvis er opstået fra NULL ─
// En værdi 1-5 kan ikke skelnes fra en ægte lav fødselsværdi uden historik.
// Tre signaler pr. (rytter, evne), alle kun for PCM-ryttere (prior-fødte er
// født med begge evner, og deres lave værdier er ægte fødselsværdier):
//   neverAbove   — ingen historik-række viser en værdi over LOW_VALUE_MAX
//                  (rytteren er aldrig set med en "rigtig" fødselsværdi)
//   birthAbove   — fødselsformlen giver i dag MERE end den nuværende værdi
//                  (træning trækker ikke en evne ned under fødslen)
//   likely       — begge signaler: sandsynligvis opstået fra NULL via træning
// Intet besluttes her. Tallene er beslutningsgrundlag til ejeren.
export function lowValueDesignPoint(riders, abilityRows, historyRows = []) {
  const ridersById = new Map(riders.map((r) => [r.id, r]));
  const histMax = new Map();
  for (const h of historyRows) {
    for (const k of FILL_KEYS) {
      const v = Number(h[k]);
      if (isNull(h[k]) || !Number.isFinite(v)) continue;
      const key = `${h.rider_id}:${k}`;
      histMax.set(key, Math.max(histMax.get(key) ?? -Infinity, v));
    }
  }
  const out = {};
  for (const k of FILL_KEYS) {
    const r = { total: 0, active: 0, priorBorn: 0, pcm: 0, pcmActive: 0, neverAbove: 0, birthAbove: 0, likely: 0, likelyActive: 0, noHistoryAtAll: 0 };
    for (const row of abilityRows) {
      const v = Number(row[k]);
      if (isNull(row[k]) || !Number.isFinite(v) || v < 1 || v > LOW_VALUE_MAX) continue;
      const rider = ridersById.get(row.rider_id);
      if (!rider) continue;
      const active = rider.is_retired === false;
      r.total += 1;
      if (active) r.active += 1;
      if (isBornFromPriors(rider)) { r.priorBorn += 1; continue; }
      r.pcm += 1;
      if (active) r.pcmActive += 1;
      const hm = histMax.get(`${row.rider_id}:${k}`);
      if (hm === undefined) r.noHistoryAtAll += 1;
      const neverAbove = hm === undefined || hm <= LOW_VALUE_MAX;
      const birth = deriveAbilities(seedPhysiologyFromLegacy(rider), rider)[k];
      const birthAbove = Number.isFinite(birth) && birth > v;
      if (neverAbove) r.neverAbove += 1;
      if (birthAbove) r.birthAbove += 1;
      if (neverAbove && birthAbove) { r.likely += 1; if (active) r.likelyActive += 1; }
    }
    out[k] = r;
  }
  return out;
}

// ── SQL til apply-sporet ────────────────────────────────────────────────────
export function backupTableName(date = new Date()) {
  const d = date.toISOString().slice(0, 10).replaceAll("-", "");
  return `backup_5268_rider_derived_abilities_${d}`;
}

export function backupSql(table) {
  if (!BACKUP_TABLE_PATTERN.test(table)) throw new Error(`Ugyldigt backup-navn: ${table}`);
  return [
    `CREATE TABLE IF NOT EXISTS public.${table} AS`,
    "  SELECT rider_id, teamwork, leadership, now() AS backed_up_at",
    "  FROM public.rider_derived_abilities",
    "  WHERE teamwork IS NULL OR leadership IS NULL;",
    `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`,
    `SELECT count(*) FROM public.${table};`,
  ].join("\n");
}

// Rollback sætter KUN felter tilbage til NULL der var NULL ved backup. Bemærk:
// træningsfremgang optjent på de fyldte felter efter apply går tabt ved rollback.
export function rollbackSql(table) {
  if (!BACKUP_TABLE_PATTERN.test(table)) throw new Error(`Ugyldigt backup-navn: ${table}`);
  return [
    "BEGIN;",
    "UPDATE public.rider_derived_abilities a SET teamwork = NULL",
    `  FROM public.${table} b WHERE a.rider_id = b.rider_id AND b.teamwork IS NULL;`,
    "UPDATE public.rider_derived_abilities a SET leadership = NULL",
    `  FROM public.${table} b WHERE a.rider_id = b.rider_id AND b.leadership IS NULL;`,
    "COMMIT;",
  ].join("\n");
}

// ── Rapporter ───────────────────────────────────────────────────────────────
const cell = (v) => (v == null ? "-" : String(v));
const name = (r) => `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim() || "(uden navn)";

function commonHeader(ctx) {
  const { stamp, nulls, plan, impact, design } = ctx;
  const L = [];
  L.push(`Koert: ${stamp} (TOER KOERSEL, READ-ONLY, ingen skrivninger).`);
  L.push("");
  L.push("## Tomme felter i dag (`rider_derived_abilities`)");
  L.push("");
  L.push("| | Raekker | teamwork NULL | leadership NULL | mindst en NULL | begge NULL |");
  L.push("|---|---:|---:|---:|---:|---:|");
  for (const [label, g] of [["Aktive ryttere", nulls.active], ["Alle ryttere", nulls.all]]) {
    L.push(`| ${label} | ${g.rows} | ${g.teamwork} | ${g.leadership} | ${g.either} | ${g.both} |`);
  }
  L.push("");
  L.push("## Plan");
  L.push("");
  const tw = plan.entries.filter((e) => e.fill.teamwork !== undefined).length;
  const ld = plan.entries.filter((e) => e.fill.leadership !== undefined).length;
  const act = plan.entries.filter((e) => e.rider.is_retired === false).length;
  L.push(`- Ryttere der faar mindst et felt fyldt: **${plan.entries.length}** (heraf aktive: ${act})`);
  L.push(`- Felter: teamwork ${tw}, leadership ${ld}`);
  L.push(`- Sprunget over: prior-foedte ${plan.skipped.priorBorn}, uden rytter-raekke ${plan.skipped.noRider}, ugyldig foedselsvaerdi ${plan.skipped.invalid}`);
  L.push("- Felter med en vaerdi roeres ikke (heller ikke lave vaerdier, se designpunktet).");
  L.push("");
  L.push("## Rating");
  L.push("");
  L.push(`- Rating regnet foer/efter for ${impact.riders} ryttere x ${impact.roles} visnings-roller.`);
  L.push(`- Ryttere med aendret rating: **${impact.changedRiders}** (rolle-par: ${impact.changedPairs}). Maal: 0.`);
  L.push("");
  L.push(`## Aabent designpunkt: lave vaerdier (1-${LOW_VALUE_MAX}) der sandsynligvis er opstaaet fra NULL`);
  L.push("");
  L.push("Kun talt, intet besluttet. Signaler pr. evne for PCM-ryttere (prior-foedte er foedt med evnen):");
  L.push("`aldrig over` = ingen historik-raekke viser en hoejere vaerdi end graensen;");
  L.push("`foedsel over` = foedselsformlen giver i dag mere end den nuvaerende vaerdi;");
  L.push("`sandsynligvis fra NULL` = begge.");
  L.push("");
  L.push("| Evne | 1-5 i alt (aktive) | prior-foedte | PCM (aktive) | uden historik | aldrig over | foedsel over | sandsynligvis fra NULL (aktive) |");
  L.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const k of FILL_KEYS) {
    const d = design[k];
    L.push(`| ${k} | ${d.total} (${d.active}) | ${d.priorBorn} | ${d.pcm} (${d.pcmActive}) | ${d.noHistoryAtAll} | ${d.neverAbove} | ${d.birthAbove} | **${d.likely}** (${d.likelyActive}) |`);
  }
  return L;
}

function applyFooter(ctx) {
  const { table, plan } = ctx;
  const L = [];
  L.push("");
  L.push("## Apply (ejer-gated, IKKE koert)");
  L.push("");
  L.push("1. Backup (via SQL, foer apply):");
  L.push("");
  L.push("```sql");
  L.push(backupSql(table));
  L.push("```");
  L.push("");
  L.push("2. Apply:");
  L.push("");
  L.push("```");
  L.push(`infisical run --env=prod -- node backend/scripts/backfill5268TeamworkLeadership.mjs --apply --owner-go --backup-table=${table} --expect-riders=${plan.entries.length}`);
  L.push("```");
  L.push("");
  L.push("3. Rollback (saetter kun de fyldte felter tilbage til NULL; traening optjent efter apply paa de felter gaar tabt):");
  L.push("");
  L.push("```sql");
  L.push(rollbackSql(table));
  L.push("```");
  return L;
}

// Offentlig rapport (repoet er offentligt, hard rule 17): antal og kvalitativ
// beskrivelse. Percentiler og eksempel-vaerdier staar KUN i den private fil.
export function renderPublicReport(ctx) {
  const L = [`# #5268 toer koersel: fyld tomme Holdarbejde/Lederskab`, ""];
  L.push(...commonHeader(ctx));
  L.push("");
  L.push("## Fordeling af de nye vaerdier");
  L.push("");
  L.push("Percentiler (samlet, pr. aldersbaand og pr. primaertype) og de 10 navngivne eksempler med");
  L.push("vaerdier staar i den gitignorerede detaljefil" + (ctx.privateFile ? ` \`${ctx.privateFile}\`` : "") + ".");
  L.push("Offentligt repo: ingen maalte fordelinger fra foedselsformlen her.");
  L.push("Kvalitativt: Lederskab stiger med alderen (formlens modenhedsrampe), Holdarbejde goer ikke.");
  L.push("");
  L.push("| Aldersbaand | Ryttere med teamwork fyldt | Ryttere med leadership fyldt |");
  L.push("|---|---:|---:|");
  for (const band of AGE_BANDS) {
    L.push(`| ${band.key} | ${ctx.dist.teamwork.byBand[band.key].n} | ${ctx.dist.leadership.byBand[band.key].n} |`);
  }
  L.push("");
  L.push("## 10 eksempler (navne; vaerdier i detaljefilen)");
  L.push("");
  L.push("| Rytter | Alder | Primaertype | Aktiv |");
  L.push("|---|---:|---|---|");
  for (const e of ctx.examples) {
    L.push(`| ${name(e.rider)} | ${ageOf(e.rider)} | ${cell(e.rider.primary_type)} | ${e.rider.is_retired === false ? "ja" : "nej"} |`);
  }
  L.push(...applyFooter(ctx));
  L.push("");
  L.push("Alder = derivationens alder (abilityDerivation-kalibreringsaaret), samme alder som formlen bruger.");
  return L.join("\n") + "\n";
}

function pctTable(title, rows) {
  const L = [`| ${title} | n | p10 | p25 | p50 | p75 | p90 |`, "|---|---:|---:|---:|---:|---:|---:|"];
  for (const [label, r] of rows) {
    L.push(`| ${label} | ${r.n} | ${cell(r.p10)} | ${cell(r.p25)} | ${cell(r.p50)} | ${cell(r.p75)} | ${cell(r.p90)} |`);
  }
  return L;
}

// Privat rapport: alt, inkl. percentiler og eksempel-vaerdier.
export function renderPrivateReport(ctx) {
  const L = [`# #5268 toer koersel (PRIVAT, hard rule 17): fyld tomme Holdarbejde/Lederskab`, ""];
  L.push(...commonHeader(ctx));
  for (const k of FILL_KEYS) {
    const d = ctx.dist[k];
    L.push("");
    L.push(`## Fordeling: ${k}`);
    L.push("");
    L.push(...pctTable("Samlet", [["alle", d.all]]));
    L.push("");
    L.push(...pctTable("Aldersbaand", AGE_BANDS.map((b) => [b.key, d.byBand[b.key]])));
    L.push("");
    L.push(...pctTable("Primaertype", Object.entries(d.byType)));
  }
  L.push("");
  L.push("## 10 eksempler");
  L.push("");
  L.push("| Rytter | Alder | Primaertype | Aktiv | teamwork foer -> efter | leadership foer -> efter |");
  L.push("|---|---:|---|---|---|---|");
  for (const e of ctx.examples) {
    const after = applyFillToRow(e.abilities, e.fill);
    L.push(`| ${name(e.rider)} | ${ageOf(e.rider)} | ${cell(e.rider.primary_type)} | ${e.rider.is_retired === false ? "ja" : "nej"} `
      + `| ${cell(e.abilities.teamwork)} -> ${cell(after.teamwork)} | ${cell(e.abilities.leadership)} -> ${cell(after.leadership)} |`);
  }
  L.push(...applyFooter(ctx));
  return L.join("\n") + "\n";
}

// ── CLI ────────────────────────────────────────────────────────────────────
export function parseArgs(args) {
  const o = { apply: false, ownerGo: false, backupTable: null, expectRiders: null, reportDir: null, privateDir: null, sample: 10 };
  for (const arg of args) {
    if (arg === "--dry-run") continue;
    else if (arg === "--apply") o.apply = true;
    else if (arg === "--owner-go") o.ownerGo = true;
    else if (arg.startsWith("--backup-table=")) o.backupTable = arg.slice("--backup-table=".length);
    else if (/^--expect-riders=\d+$/.test(arg)) o.expectRiders = Number(arg.slice("--expect-riders=".length));
    else if (arg.startsWith("--report-dir=")) o.reportDir = arg.slice("--report-dir=".length);
    else if (arg.startsWith("--private-dir=")) o.privateDir = arg.slice("--private-dir=".length);
    else if (/^--sample=\d+$/.test(arg)) o.sample = Number(arg.slice("--sample=".length));
    else throw new Error(`Ukendt argument: ${arg}`);
  }
  if (o.apply) {
    if (!o.ownerGo) throw new Error("--apply kraever --owner-go (ejer-gated, #5268).");
    if (!o.backupTable || !BACKUP_TABLE_PATTERN.test(o.backupTable)) {
      throw new Error("--apply kraever --backup-table=backup_5268_rider_derived_abilities_YYYYMMDD (oprettet via backup-SQL'en).");
    }
    if (o.expectRiders == null) throw new Error("--apply kraever --expect-riders=N fra den toerre koersel.");
  }
  return o;
}

const RIDER_SELECT = "id, firstname, lastname, birthdate, potentiale, generation_tag, archetype_draw, is_retired, primary_type, "
  + "height, weight, stat_bj, stat_fl, stat_ned, stat_bro, stat_ftr, stat_sp, stat_acc, stat_bk, "
  + "stat_kb, stat_tt, stat_prl, stat_udh, stat_res, stat_mod";

export async function loadState(supabase) {
  const riders = await fetchAllRows(() => supabase.from("riders").select(RIDER_SELECT).order("id"));
  const abilityRows = await fetchAllRows(() => supabase.from("rider_derived_abilities")
    .select(`rider_id, ${DISPLAY_RECIPE_ABILITIES.join(", ")}, teamwork, leadership`).order("rider_id"));
  return { riders, abilityRows };
}

// Historik kun for kandidaterne til designpunktet (lave værdier hos PCM-ryttere).
export async function loadHistory(supabase, riderIds) {
  if (!riderIds.length) return [];
  const sel = "rider_id, teamwork:abilities->teamwork, leadership:abilities->leadership";
  const a = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase.from("rider_derived_ability_history")
    .select(sel).in("rider_id", chunk).order("id"));
  const b = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase.from("rider_ability_race_day_history")
    .select(sel).in("rider_id", chunk).order("id"));
  return [...a, ...b];
}

export function lowValueCandidateIds(riders, abilityRows) {
  const ridersById = new Map(riders.map((r) => [r.id, r]));
  const ids = new Set();
  for (const row of abilityRows) {
    const rider = ridersById.get(row.rider_id);
    if (!rider || isBornFromPriors(rider)) continue;
    for (const k of FILL_KEYS) {
      const v = Number(row[k]);
      if (!isNull(row[k]) && Number.isFinite(v) && v >= 1 && v <= LOW_VALUE_MAX) ids.add(row.rider_id);
    }
  }
  return [...ids];
}

// Apply: verificér backup → pr. rytter pr. felt en BETINGET opdatering
// (`.is(key, null)`), så et felt der har fået en værdi siden aldrig overskrives.
export async function applyPlan(supabase, plan, { backupTable, log = console.log } = {}) {
  const backup = await fetchAllRows(() => supabase.from(backupTable).select("rider_id, teamwork, leadership").order("rider_id"));
  const backupById = new Map(backup.map((b) => [b.rider_id, b]));
  const missing = plan.entries.filter((e) => {
    const b = backupById.get(e.riderId);
    return !b || Object.keys(e.fill).some((k) => !isNull(b[k]));
  });
  if (missing.length) {
    throw new Error(`${missing.length} ryttere i planen mangler i ${backupTable} (eller havde en vaerdi ved backup). Tag backup igen.`);
  }
  let fields = 0;
  let skippedSinceDryRun = 0;
  for (const e of plan.entries) {
    for (const [k, v] of Object.entries(e.fill)) {
      const { data, error } = await supabase.from("rider_derived_abilities")
        .update({ [k]: v }).eq("rider_id", e.riderId).is(k, null).select("rider_id");
      if (error) throw error;
      if (data?.length) fields += 1; else skippedSinceDryRun += 1;
    }
  }
  log(`APPLY: ${fields} felter fyldt, ${skippedSinceDryRun} havde faaet en vaerdi siden (urort).`);
  return { fields, skippedSinceDryRun };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error("Koer gennem Infisical med Supabase-credentials (infisical run --env=prod -- ...)");
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(opts.apply ? {} : { global: { fetch: readOnlyFetch } }),
  });

  const { riders, abilityRows } = await loadState(supabase);
  const plan = buildFillPlan(riders, abilityRows);
  const impact = ratingImpact(plan.entries);
  const nulls = countNulls(riders, abilityRows);
  const history = await loadHistory(supabase, lowValueCandidateIds(riders, abilityRows));
  const design = lowValueDesignPoint(riders, abilityRows, history);
  const now = new Date();
  const stamp = now.toISOString();
  const tsSlug = stamp.slice(0, 19).replaceAll(":", "-");
  const table = opts.backupTable ?? backupTableName(now);
  const privateFile = opts.privateDir ? join(opts.privateDir, `dry-run-${tsSlug}-private.md`) : null;
  const ctx = {
    stamp, nulls, plan, impact, design, table,
    dist: distribution(plan.entries),
    examples: pickExamples(plan.entries, opts.sample),
    privateFile: privateFile ? privateFile.replaceAll("\\", "/") : null,
  };

  const publicReport = renderPublicReport(ctx);
  console.log(publicReport);
  if (opts.reportDir) {
    mkdirSync(opts.reportDir, { recursive: true });
    const f = join(opts.reportDir, `dry-run-${tsSlug}.md`);
    writeFileSync(f, publicReport);
    console.log(`Offentlig rapport: ${f}`);
  }
  if (privateFile) {
    mkdirSync(opts.privateDir, { recursive: true });
    writeFileSync(privateFile, renderPrivateReport(ctx));
    console.log(`Privat rapport: ${privateFile}`);
  }

  if (!opts.apply) {
    console.log("Toer koersel: intet er skrevet.");
    return;
  }
  if (impact.changedRiders !== 0) {
    throw new Error(`Rating ville aendre sig for ${impact.changedRiders} ryttere. Apply afvist (0 ratingeffekt er et krav).`);
  }
  if (plan.entries.length !== opts.expectRiders) {
    throw new Error(`Planen har ${plan.entries.length} ryttere, --expect-riders=${opts.expectRiders}. Koer toer koersel igen.`);
  }
  await applyPlan(supabase, plan, { backupTable: opts.backupTable });
  console.log(`Rollback-SQL:\n${rollbackSql(opts.backupTable)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    // Aldrig SDK-fejl eller request-objekter i loggen: de kan baere credentials.
    console.error(`#5268-opfyldningen fejlede: ${err?.message ?? "ukendt fejl"}`);
    process.exitCode = 1;
  });
}
