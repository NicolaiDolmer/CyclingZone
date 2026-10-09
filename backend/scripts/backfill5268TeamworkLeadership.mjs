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
// ── TRÆNET OVEN I FORMLEN (ejer 9/10 aften) ──────────────────────────────────
// En PCM-rytter hvis felt i dag har en værdi, men hvis historik viser feltet som
// NULL, har trænet evnen op fra 0 (træningsmotoren læser NULL som 0). Ejeren:
// "læg det rytterne selv har trænet oven i det de ville have fået" — 2 trænet +
// 12 fra formlen = 14. Samme behandling som en født rytter: grundtal + træning.
// Værn: er den FØRSTE værdi efter NULL højere end LOW_VALUE_MAX, kom den ikke fra
// én trænings-dag (fx et spring fra NULL til 33). Så tælles intet oven i; rytteren
// får max(nu, formlen), så ingen værdi falder. Loft: MENTAL_ABILITY_TAG_CEILING.
// Et felt uden NULL i historikken røres ikke. Apply er betinget af den værdi den
// tørre kørsel så (`.eq(key, fra)`), så træning imellem aldrig overskrives.
//
// Refs #5268 #5912 #5321.

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import { deriveAbilities } from "../lib/abilityDerivation.js";
import { seedPhysiologyFromLegacy } from "../lib/physiologySeeding.js";
import { isBornFromPriors } from "../lib/riderBirthPriors.js";
import { MENTAL_ABILITY_TAG_CEILING } from "../lib/riderProgression.js";
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

// ── Trænet oven i formlen ───────────────────────────────────────────────────
// Oprindelse pr. (rytter, evne) fra historikken: blev feltet set som NULL, og
// hvad var den første værdi efter (kronologisk; rækker sorteret af kalderen).
export function originByKey(historyRows) {
  const out = new Map();
  for (const h of historyRows) {
    for (const k of FILL_KEYS) {
      const key = `${h.rider_id}:${k}`;
      const o = out.get(key) ?? { nullSeen: false, first: null };
      const v = Number(h[k]);
      if (isNull(h[k])) o.nullSeen = true;
      else if (Number.isFinite(v) && o.first === null && o.nullSeen) o.first = v;
      out.set(key, o);
    }
  }
  return out;
}

export function buildTopupPlan(riders, abilityRows, origins) {
  const ridersById = new Map(riders.map((r) => [r.id, r]));
  const entries = [];
  const stats = Object.fromEntries(FILL_KEYS.map((k) => [k, {
    withValue: 0, fromNull: 0, plus: 0, plusCapped: 0, guardedMax: 0, guardedNoChange: 0, noNullHistory: 0,
  }]));
  for (const row of abilityRows) {
    const rider = ridersById.get(row.rider_id);
    if (!rider || isBornFromPriors(rider)) continue;
    let birth = null;
    const set = {};
    for (const k of FILL_KEYS) {
      if (isNull(row[k])) continue;
      const v = Number(row[k]);
      if (!Number.isFinite(v)) continue;
      const st = stats[k];
      st.withValue += 1;
      const o = origins.get(`${row.rider_id}:${k}`);
      if (!o?.nullSeen) { st.noNullHistory += 1; continue; }
      st.fromNull += 1;
      birth ??= deriveAbilities(seedPhysiologyFromLegacy(rider), rider);
      const b = birth[k];
      if (!Number.isInteger(b) || b < 1 || b > 99) continue;
      const cap = MENTAL_ABILITY_TAG_CEILING[k];
      if (o.first !== null && o.first <= LOW_VALUE_MAX) {
        const to = Math.max(v, Math.min(cap, b + v));
        if (to === v) continue;
        if (b + v > cap) st.plusCapped += 1;
        st.plus += 1;
        set[k] = { from: v, to, kind: "plus", birth: b };
      } else if (b > v) {
        st.guardedMax += 1;
        set[k] = { from: v, to: b, kind: "max", birth: b };
      } else {
        st.guardedNoChange += 1;
      }
    }
    if (Object.keys(set).length) entries.push({ riderId: row.rider_id, rider, abilities: row, set });
  }
  return { entries, stats };
}

// Fyldning (NULL -> formel) og tillæg samlet til én ændringsliste pr. rytter.
export function combineChanges(fillPlan, topupPlan) {
  const byId = new Map();
  for (const e of fillPlan.entries) {
    const set = Object.fromEntries(Object.entries(e.fill).map(([k, v]) => [k, { from: null, to: v, kind: "fill", birth: v }]));
    byId.set(e.riderId, { riderId: e.riderId, rider: e.rider, abilities: e.abilities, set });
  }
  for (const e of topupPlan.entries) {
    const cur = byId.get(e.riderId);
    if (cur) Object.assign(cur.set, e.set);
    else byId.set(e.riderId, { ...e, set: { ...e.set } });
  }
  return [...byId.values()];
}

export function rowAfterSet(row, set) {
  const out = { ...row };
  for (const [k, c] of Object.entries(set)) out[k] = c.to;
  return out;
}

// Gevinst pr. tillæg (nu -> efter) og antal der ramte loftet, til rapporten.
export function topupSummary(changes) {
  const out = {};
  for (const k of FILL_KEYS) {
    const plus = changes.map((c) => c.set[k]).filter((c) => c?.kind === "plus");
    const max = changes.map((c) => c.set[k]).filter((c) => c?.kind === "max");
    out[k] = {
      plus: plus.length, max: max.length,
      trained: pctRow(plus.map((c) => c.from)),
      after: pctRow(plus.map((c) => c.to)),
      atCap: plus.filter((c) => c.to === MENTAL_ABILITY_TAG_CEILING[k]).length,
    };
  }
  return out;
}

// Rating for alle visnings-roller, før vs. efter, pr. rytter (samlet ændringsliste).
export function ratingImpactChanges(changes) {
  let changedRiders = 0;
  let changedPairs = 0;
  for (const c of changes) {
    const after = rowAfterSet(c.abilities, c.set);
    let changed = false;
    for (const role of DISPLAY_RECIPE_KEYS) {
      if (ratingForRole(c.abilities, role) !== ratingForRole(after, role)) { changedPairs += 1; changed = true; }
    }
    if (changed) changedRiders += 1;
  }
  return { riders: changes.length, roles: DISPLAY_RECIPE_KEYS.length, changedRiders, changedPairs };
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
    // filled_* skrives af applyPlan EFTER hver vellykket opdatering: rollback
    // rører kun felter scriptet faktisk fyldte (ikke felter træning skrev imens).
    "  SELECT rider_id, teamwork, leadership,",
    "    NULL::integer AS filled_teamwork, NULL::integer AS filled_leadership, now() AS backed_up_at",
    // Hele tabellen: tillægget rører også felter der HAR en værdi (ejer 9/10).
    "  FROM public.rider_derived_abilities;",
    `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`,
    `SELECT count(*) FROM public.${table};`,
  ].join("\n");
}

// Rollback sætter KUN felter tilbage som applyPlan faktisk ændrede (filled_* er
// sat), til værdien i backuppen (NULL for en fyldning, det trænede tal for et
// tillæg). Et felt træning skrev mellem backup og apply blev sprunget over af
// apply og røres heller ikke her. Bemærk: træningsfremgang optjent på de
// ændrede felter EFTER apply går tabt ved rollback.
export function rollbackSql(table) {
  if (!BACKUP_TABLE_PATTERN.test(table)) throw new Error(`Ugyldigt backup-navn: ${table}`);
  return [
    "BEGIN;",
    "UPDATE public.rider_derived_abilities a SET teamwork = b.teamwork",
    `  FROM public.${table} b WHERE a.rider_id = b.rider_id AND b.filled_teamwork IS NOT NULL;`,
    "UPDATE public.rider_derived_abilities a SET leadership = b.leadership",
    `  FROM public.${table} b WHERE a.rider_id = b.rider_id AND b.filled_leadership IS NOT NULL;`,
    "COMMIT;",
  ].join("\n");
}

// ── Rapporter ───────────────────────────────────────────────────────────────
const cell = (v) => (v == null ? "-" : String(v));
const name = (r) => `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim() || "(uden navn)";

function commonHeader(ctx) {
  const { stamp, nulls, plan, impact, design } = ctx;
  const L = [];
  L.push(`Koert: ${stamp} (${ctx.apply ? "APPLY" : "TOER KOERSEL, READ-ONLY, ingen skrivninger"}).`);
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
  if (ctx.topup) {
    const t = ctx.topup.stats;
    L.push("");
    L.push("## Traenet oven i formlen (ejer 9/10 aften)");
    L.push("");
    L.push(`Felter med en vaerdi hvor historikken viser NULL: formlen + det traenede (loft ${MENTAL_ABILITY_TAG_CEILING.teamwork}). `
      + `Vaern: foerste vaerdi efter NULL > ${LOW_VALUE_MAX} -> max(nu, formlen), intet tillaeg.`);
    L.push("");
    L.push("| Evne | med vaerdi (PCM) | fra NULL | + traenet | heraf ramt loftet | vaern: max(nu, formel) | vaern: uaendret | uden NULL i historik (uroert) |");
    L.push("|---|---:|---:|---:|---:|---:|---:|---:|");
    for (const k of FILL_KEYS) {
      const d = t[k];
      L.push(`| ${k} | ${d.withValue} | ${d.fromNull} | **${d.plus}** | ${d.plusCapped} | ${d.guardedMax} | ${d.guardedNoChange} | ${d.noNullHistory} |`);
    }
    L.push("");
    L.push(`- Ryttere i alt med mindst een aendring (fyldning eller tillaeg): **${ctx.changes.length}** `
      + `(aktive: ${ctx.changes.filter((c) => c.rider.is_retired === false).length})`);
  } else {
    L.push("- Felter med en vaerdi roeres ikke (heller ikke lave vaerdier, se designpunktet).");
  }
  L.push("");
  L.push("## Rating");
  L.push("");
  L.push(`- Rating regnet foer/efter for ${impact.riders} ryttere x ${impact.roles} visnings-roller (fyldning + tillaeg).`);
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
  L.push(`infisical run --env=prod -- node backend/scripts/backfill5268TeamworkLeadership.mjs --apply --owner-go --backup-table=${table} --expect-riders=${ctx.changes ? ctx.changes.length : plan.entries.length}`);
  L.push("```");
  L.push("");
  L.push("3. Rollback (saetter kun felter apply faktisk fyldte tilbage til NULL; traening optjent efter apply paa de felter gaar tabt):");
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
  L.push("Kvalitativt: Lederskab stiger med alderen (formlens modenhedsrampe). Holdarbejde har intet alders-led;");
  L.push("unge ligger alligevel lavere, fordi de evner formlen bygger paa (placering, taktik, holdbarhed) er lavere hos dem.");
  L.push("En betydelig andel af de nye Holdarbejde-vaerdier lander i bunden af skalaen.");
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
  if (ctx.topupSum) {
    for (const k of FILL_KEYS) {
      const d = ctx.topupSum[k];
      L.push("");
      L.push(`## Tillaeg: ${k} (${d.plus} + traenet, ${d.max} vaern-max, ${d.atCap} paa loftet)`);
      L.push("");
      L.push(...pctTable("Fordeling", [["traenet (foer)", d.trained], ["efter", d.after]]));
    }
    const ex = ctx.changes.filter((c) => Object.values(c.set).some((v) => v.kind !== "fill")).slice(0, 10);
    L.push("");
    L.push("## Tillaeg: eksempler");
    L.push("");
    L.push("| Rytter | teamwork | leadership |");
    L.push("|---|---|---|");
    const fmt = (c) => (c ? `${cell(c.from)} -> ${c.to} (${c.kind}, formel ${c.birth})` : "-");
    for (const c of ex) L.push(`| ${name(c.rider)} | ${fmt(c.set.teamwork)} | ${fmt(c.set.leadership)} |`);
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
  const sel = "id, rider_id, snapshot_date, created_at, teamwork:abilities->teamwork, leadership:abilities->leadership";
  const a = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase.from("rider_derived_ability_history")
    .select(sel).in("rider_id", chunk).order("id"));
  const b = await fetchAllRowsChunkedIn(riderIds, (chunk) => supabase.from("rider_ability_race_day_history")
    .select(sel).in("rider_id", chunk).order("id"));
  // Kronologisk på tværs af de to tabeller (originByKey læser "første værdi efter NULL").
  const ts = (h) => String(h.created_at ?? h.snapshot_date ?? "");
  return [...a, ...b].sort((x, y) => ts(x).localeCompare(ts(y)));
}

// Alle PCM-ryttere med mindst én værdi (kandidater til tillægget).
export function topupCandidateIds(riders, abilityRows) {
  const ridersById = new Map(riders.map((r) => [r.id, r]));
  const ids = new Set();
  for (const row of abilityRows) {
    const rider = ridersById.get(row.rider_id);
    if (!rider || isBornFromPriors(rider)) continue;
    if (FILL_KEYS.some((k) => !isNull(row[k]))) ids.add(row.rider_id);
  }
  return [...ids];
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
// Indgang: `plan.entries` med `fill` (kun NULL -> formel) ELLER `set`
// ({ key: { from, to } }, også tillæg). Opdateringen er betinget af `from`:
// `.is(key, null)` for en fyldning, `.eq(key, from)` for et tillæg.
const setOf = (e) => e.set ?? Object.fromEntries(Object.entries(e.fill).map(([k, v]) => [k, { from: null, to: v }]));
const sameVal = (a, b) => (isNull(a) && isNull(b)) || (!isNull(a) && !isNull(b) && Number(a) === Number(b));

export async function applyPlan(supabase, plan, { backupTable, log = console.log } = {}) {
  const backup = await fetchAllRows(() => supabase.from(backupTable).select("rider_id, teamwork, leadership, filled_teamwork, filled_leadership").order("rider_id"));
  const backupById = new Map(backup.map((b) => [b.rider_id, b]));
  const missing = plan.entries.filter((e) => {
    const b = backupById.get(e.riderId);
    return !b || Object.entries(setOf(e)).some(([k, c]) => !sameVal(b[k], c.from));
  });
  if (missing.length) {
    throw new Error(`${missing.length} ryttere i planen mangler i ${backupTable} (eller havde en anden vaerdi ved backup). Tag backup igen.`);
  }
  let fields = 0;
  let skippedSinceDryRun = 0;
  for (const e of plan.entries) {
    for (const [k, { from, to: v }] of Object.entries(setOf(e))) {
      const q = supabase.from("rider_derived_abilities").update({ [k]: v }).eq("rider_id", e.riderId);
      const { data, error } = await (isNull(from) ? q.is(k, null) : q.eq(k, from)).select("rider_id");
      if (error) throw error;
      if (!data?.length) { skippedSinceDryRun += 1; continue; }
      // Markér feltet som fyldt (rollback-grundlaget). EFTER opdateringen: et
      // crash imellem efterlader højst ét fyldt felt umarkeret, aldrig et
      // trænings-felt markeret som "fyldt".
      const { error: markError } = await supabase.from(backupTable)
        .update({ [`filled_${k}`]: v }).eq("rider_id", e.riderId);
      if (markError) throw markError;
      fields += 1;
    }
  }
  log(`APPLY: ${fields} felter skrevet, ${skippedSinceDryRun} havde aendret sig siden toer koersel (urort).`);
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
  await run({ supabase, opts });
}

// Orkestrering med injiceret klient (testbar uden netværk). I tør kørsel kalder
// den udelukkende læsende builder-metoder; `applyPlan` nås kun med `opts.apply`.
export async function run({ supabase, opts, log = console.log, now = new Date() }) {
  const { riders, abilityRows } = await loadState(supabase);
  const plan = buildFillPlan(riders, abilityRows);
  const nulls = countNulls(riders, abilityRows);
  const history = await loadHistory(supabase, topupCandidateIds(riders, abilityRows));
  const design = lowValueDesignPoint(riders, abilityRows, history);
  const topup = buildTopupPlan(riders, abilityRows, originByKey(history));
  const changes = combineChanges(plan, topup);
  const impact = ratingImpactChanges(changes);
  const stamp = now.toISOString();
  const tsSlug = stamp.slice(0, 19).replaceAll(":", "-");
  const table = opts.backupTable ?? backupTableName(now);
  const privateFile = opts.privateDir ? join(opts.privateDir, `dry-run-${tsSlug}-private.md`) : null;
  const ctx = {
    stamp, nulls, plan, impact, design, table, apply: opts.apply,
    topup, changes, topupSum: topupSummary(changes),
    dist: distribution(plan.entries),
    examples: pickExamples(plan.entries, opts.sample),
    privateFile: privateFile ? basename(privateFile) : null,
  };

  const publicReport = renderPublicReport(ctx);
  log(publicReport);
  if (opts.reportDir) {
    mkdirSync(opts.reportDir, { recursive: true });
    const f = join(opts.reportDir, `dry-run-${tsSlug}.md`);
    writeFileSync(f, publicReport);
    log(`Offentlig rapport: ${f}`);
  }
  if (privateFile) {
    mkdirSync(opts.privateDir, { recursive: true });
    writeFileSync(privateFile, renderPrivateReport(ctx));
    log(`Privat rapport: ${privateFile}`);
  }

  if (!opts.apply) {
    log("Toer koersel: intet er skrevet.");
    return { plan, topup, changes, impact, nulls, design, applied: null };
  }
  if (impact.changedRiders !== 0) {
    throw new Error(`Rating ville aendre sig for ${impact.changedRiders} ryttere. Apply afvist (0 ratingeffekt er et krav).`);
  }
  if (changes.length !== opts.expectRiders) {
    throw new Error(`Planen har ${changes.length} ryttere, --expect-riders=${opts.expectRiders}. Koer toer koersel igen.`);
  }
  const result = await applyPlan(supabase, { entries: changes }, { backupTable: opts.backupTable, log });
  log(`Rollback-SQL:\n${rollbackSql(opts.backupTable)}`);
  return { plan, topup, changes, impact, nulls, design, applied: result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    // Aldrig SDK-fejl eller request-objekter i loggen: de kan baere credentials.
    console.error(`#5268-opfyldningen fejlede: ${err?.message ?? "ukendt fejl"}`);
    process.exitCode = 1;
  });
}
