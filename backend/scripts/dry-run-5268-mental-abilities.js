// #5268 — ÉN samlet migration af de mentale evner. Dry-run som default.
// ============================================================================
//   infisical run --env=prod -- node backend/scripts/dry-run-5268-mental-abilities.js --dry-run
//   infisical run --env=prod -- node backend/scripts/dry-run-5268-mental-abilities.js --apply --owner-go --variant=v2
//
// `--dry-run` er default OG read-only helt ned i transporten (`readOnlyFetch`
// afviser enhver ikke-GET). `--apply` kræver `--owner-go` oveni: ejeren har låst
// selve point-flytningen bag et eget go-kort med spillerbesked (spec §4 trin 2).
//
// ── HVAD DEN GØR ────────────────────────────────────────────────────────────
// Ejer-beslutninger 15/9 (#3668 + #5268, låst):
//   1. Taktik og aggression må hverken bygge på alder eller på en anden evne.
//   2. Eksisterende ryttere må IKKE miste evne-masse: taktik/aggression sænkes,
//      men de tabte point FLYTTES til Holdarbejde og Lederskab.
//   3. Nye mentale evner fordeles ordentligt fra start, også hos de ryttere der
//      ikke mister noget.
//
// ── DELTA-PRINCIPPET (rapportens §5.1) ──────────────────────────────────────
// En ren re-derivation ville SLETTE al træningsfremgang: kun 21,6 % af rækkerne
// matcher en frisk `deriveAbilities()` i dag, fordi træning og aldersaftrapning
// har flyttet tallene siden fødslen. Derfor:
//
//     fremgang   = nuværende − GAMMEL fødselsværdi
//     reference  = NY fødselsværdi + fremgang        (clamp [1,99])
//
// Rytteren beholder præcis den fremgang han har optjent; kun det forkerte
// alders-offset fjernes. Det er `referencePlan()` herunder.
//
// ── DE TO VARIANTER ─────────────────────────────────────────────────────────
// Referencen er formel-sandheden, men den er svær at forklare en spiller. Begge
// varianters procent-sats er LØST mod referencens samlede sænkning (kalibreret på
// data, ikke gættet), ikke valgt — men den anvendes pr. rytter med en afrunding og
// en clamp ved 1, så den faktiske sum lander TÆT PÅ referencens, ikke eksakt på
// den. Derfor rapporterer dry-run altid sum før/efter pr. evne: det er de MÅLTE
// tal der er go-kortets grundlag, aldrig en lovet procent. De to varianter
// adskiller sig kun i HVEM der betaler:
//
//   V1  én flad procent pr. evne for hele bestanden.
//       "Alle mistede 31 % af deres taktik."  Enkel at sige, men en 17-årig
//       betaler lige så meget som den 34-årige, og det var den 34-åriges
//       alders-bonus der var problemet.
//   V2  én procent pr. evne PR. ALDERSBÅND (16-21/22-24/25-27/28-30/31-33/34+).
//       "Jo ældre rytteren var, jo flere gratis taktik-point havde han, og jo
//       flere flyttes der."  Tættere på sandheden, sværere at sige i én linje.
//
// Begge beregnes i dry-run og rapporteres side om side. Ejeren vælger.
//
// ── HVOR DE TABTE POINT LANDER ──────────────────────────────────────────────
// Fordelingsnøglen er rytterens EGEN profil: forholdet mellem hans to nye
// fødselsværdier (`leadership / (leadership + teamwork)`), klampet til [0,2; 0,8]
// så ingen rytter får 100/0. En veteran-kaptajn har højere lederskabs-prior og
// får derfor mest af sin tabte taktik som Lederskab; en flad motor med lav alder
// får mest som Holdarbejde. Ryttere der intet mister får de to evner som rene
// fødselsværdier (profil + støj) — punkt 3 ovenfor.
//
// ── MASSE-GATEN ─────────────────────────────────────────────────────────────
// Pr. rytter: (taktik + aggression + holdarbejde + lederskab) EFTER skal være
// ≥ (taktik + aggression) FØR. Den kan kun brydes hvis en evne clamper på 99;
// scriptet spilder derfor over i den anden evne først og TÆLLER resten som
// `massTab` i rapporten. Gaten er 0 brud.
//
// ── IDEMPOTENS ──────────────────────────────────────────────────────────────
// `rider_derived_abilities_5268_backup` ER markøren. En rytter med en backup-
// række er allerede migreret og springes over. To kørsler = samme resultat.
// Uden markøren ville anden kørsel sænke taktik ANDEN gang.
//
// Refs #5268 #3668 #1177.

import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { deriveAbilities, CALIBRATION, FILL_TAIL_GENERATION_TAG, FILL_TAIL_ABILITY_CAP } from "../lib/abilityDerivation.js";
import { DISPLAY_RECIPE_KEYS, ratingForRole } from "../lib/weights/displayRecipes.js";
import { birthYearFrom } from "../lib/riderSeasonAge.js";

export const BACKUP_TABLE = "rider_derived_abilities_5268_backup";
export const VARIANTS = Object.freeze(["v1", "v2"]);
export const MOVED_ABILITIES = Object.freeze(["tactics", "aggression"]);
export const NEW_ABILITIES = Object.freeze(["teamwork", "leadership"]);

// Aldersbåndene er rapportens egne (§1.3) — de samme tal målingen af skævheden
// blev lavet på, så før/efter kan sammenlignes linje for linje.
export const AGE_BANDS = Object.freeze([
  { key: "16-21", min: 16, max: 21 },
  { key: "22-24", min: 22, max: 24 },
  { key: "25-27", min: 25, max: 27 },
  { key: "28-30", min: 28, max: 30 },
  { key: "31-33", min: 31, max: 33 },
  { key: "34+", min: 34, max: 999 },
]);

// Hvor stor en andel af de tabte point der MAKSIMALT må gå til én af de to nye
// evner. Uden klampen ville en rytter hvis profil peger 95/5 reelt kun få den
// ene evne, og den anden ville stå på sin nøgne fødselsværdi.
export const SHARE_CLAMP = Object.freeze({ min: 0.2, max: 0.8 });

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = (n) => Math.round(n);

// ── Den GAMLE formel, bevaret her og kun her ────────────────────────────────
// `abilityDerivation.js` har ikke længere alders-leddene (det er hele pointen),
// men delta-princippet kræver den GAMLE fødselsværdi for at kunne trække
// træningsfremgangen ud. Formlen er kopieret ordret fra commit'en før #5268
// (abilityDerivation.js:238 + :243) og må ALDRIG "opdateres" — den er et
// historisk faktum om hvordan de nuværende tal blev til, ikke levende kode.
export function legacyMentalBirthValues(riderRow, asOfYear = CALIBRATION.asOfYear) {
  const pcmFrac = (stat) => {
    const v = Number(stat);
    if (!Number.isFinite(v)) return 0;
    return clamp((v - CALIBRATION.pcmFloor) / (CALIBRATION.pcmCeil - CALIBRATION.pcmFloor), 0, 1);
  };
  const scoreFrac = (f) => clamp(round(1 + clamp(f, 0, 1) * 98), 1, 99);
  const age = ageOf(riderRow, asOfYear);
  const youth = clamp((32 - age) / (32 - 21), 0, 1);
  const experience = clamp((age - 20) / (31 - 20), 0, 1);
  const aggressionFrac = 0.85 * pcmFrac(riderRow.stat_ftr) + 0.15 * youth;
  const out = {
    aggression: scoreFrac(aggressionFrac),
    tactics: scoreFrac(0.55 * experience + 0.45 * aggressionFrac),
  };
  // #4311-loftet lå EFTER afledningen og ramte også de to mentale evner. Uden
  // det her ville fyld-ryttere få en kunstig stor delta og dermed en kunstig
  // stor sænkning.
  if (riderRow.generation_tag === FILL_TAIL_GENERATION_TAG) {
    for (const k of Object.keys(out)) out[k] = Math.min(out[k], FILL_TAIL_ABILITY_CAP);
  }
  return out;
}

// Alder som derivationen selv regner den: clampet [16,45], snit 25 uden fødselsdato.
export function ageOf(riderRow, asOfYear = CALIBRATION.asOfYear) {
  if (!riderRow?.birthdate) return 25;
  const year = birthYearFrom(riderRow.birthdate);
  if (year === null) return 25;
  return clamp(asOfYear - year, 16, 45);
}

export function bandOf(age) {
  return AGE_BANDS.find((b) => age >= b.min && age <= b.max)?.key ?? AGE_BANDS[0].key;
}

// ── Trin 1: referencen (delta-princippet, formel-sandheden) ─────────────────
export function referencePlan(rows, asOfYear = CALIBRATION.asOfYear) {
  return rows.map(({ rider, abilities }) => {
    const oldBirth = legacyMentalBirthValues(rider, asOfYear);
    const newBirth = deriveAbilities({}, rider, { asOfYear });
    const age = ageOf(rider, asOfYear);
    const current = {
      tactics: Number(abilities.tactics),
      aggression: Number(abilities.aggression),
    };
    const reference = {};
    for (const ability of MOVED_ABILITIES) {
      const progress = current[ability] - oldBirth[ability];
      reference[ability] = clamp(round(newBirth[ability] + progress), 1, 99);
    }
    return {
      riderId: rider.id,
      name: `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim(),
      age,
      band: bandOf(age),
      abilities,
      current,
      newBirth,
      reference,
    };
  });
}

// ── Trin 2: kalibrér variantens procenter mod referencens samlede sænkning ──
// Procenten er IKKE valgt, den er LØST: for hver gruppe (hele bestanden i V1, ét
// aldersbånd i V2) findes den p der ville flytte lige så mange point som
// referencen gjorde i den gruppe. Ingen håndsat konstant, intet at tune.
//
// Satsen er kontinuert, anvendelsen er heltallig: `round(current × (1 − p))` pr.
// rytter plus clamp ved 1 gør den faktiske sum en smule anderledes end referencens
// (afrunding kan gå begge veje, clampen kun én). Afvigelsen er lille og MÅLT — se
// `summarise().sums` — men den er der, og ingen tekst må love andet.
export function calibrateRates(plan, variant) {
  const groupKey = (entry) => (variant === "v1" ? "all" : entry.band);
  const rates = {};
  for (const ability of MOVED_ABILITIES) {
    const totals = new Map();
    for (const entry of plan) {
      const key = groupKey(entry);
      const t = totals.get(key) ?? { current: 0, dropped: 0 };
      t.current += entry.current[ability];
      t.dropped += Math.max(0, entry.current[ability] - entry.reference[ability]);
      totals.set(key, t);
    }
    rates[ability] = {};
    for (const [key, t] of totals) {
      rates[ability][key] = t.current > 0 ? clamp(t.dropped / t.current, 0, 1) : 0;
    }
  }
  return { variant, groupKey, rates };
}

// ── Trin 3: anvend varianten + flyt de tabte point ──────────────────────────
export function applyVariant(plan, variant) {
  const { groupKey, rates } = calibrateRates(plan, variant);
  return plan.map((entry) => {
    const next = {};
    let lost = 0;
    for (const ability of MOVED_ABILITIES) {
      const rate = rates[ability][groupKey(entry)] ?? 0;
      next[ability] = clamp(round(entry.current[ability] * (1 - rate)), 1, 99);
      lost += Math.max(0, entry.current[ability] - next[ability]);
    }

    // Fordelingsnøglen: rytterens egen profil, aflæst på hans to fødselsværdier.
    const baseTw = entry.newBirth.teamwork;
    const baseLd = entry.newBirth.leadership;
    const denom = baseTw + baseLd;
    const shareLd = clamp(denom > 0 ? baseLd / denom : 0.5, SHARE_CLAMP.min, SHARE_CLAMP.max);

    // HELTALS-split, ikke to uafhængige afrundinger: `round(a) + round(b)` kan
    // give ét point MERE end `lost` (lost 1, share 0,5 ⇒ 1 + 1 = 2). Det ville
    // opfinde evne-masse ud af ingenting. Her rundes kun det ene ben, og det
    // andet får resten, så summen er `lost` pr. konstruktion.
    const leadershipGain = round(shareLd * lost);
    const teamworkGain = lost - leadershipGain;
    let teamwork = clamp(baseTw + teamworkGain, 1, 99);
    let leadership = clamp(baseLd + leadershipGain, 1, 99);
    // Spild over i den anden evne hvis en af dem ramte 99, så massen bliver i
    // rytteren i stedet for at forsvinde i en clamp.
    let placed = (teamwork - baseTw) + (leadership - baseLd);
    if (placed < lost) {
      const spill = lost - placed;
      if (teamwork < 99) teamwork = clamp(teamwork + spill, 1, 99);
      else if (leadership < 99) leadership = clamp(leadership + spill, 1, 99);
      placed = (teamwork - baseTw) + (leadership - baseLd);
    }

    const massBefore = entry.current.tactics + entry.current.aggression;
    const massAfter = next.tactics + next.aggression + teamwork + leadership;
    return {
      ...entry,
      variant,
      next: { ...next, teamwork, leadership },
      lost,
      massBefore,
      massAfter,
      massLoss: Math.max(0, lost - placed),
      massOk: massAfter >= massBefore,
    };
  });
}

// ── Statistik ───────────────────────────────────────────────────────────────
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp(Math.floor(p * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[idx];
}

const ALL_FOUR = Object.freeze([...MOVED_ABILITIES, ...NEW_ABILITIES]);

// Evne-sæt før/efter til rating-sammenligningen. FØR har hverken teamwork eller
// leadership (kolonnerne var NULL), og `ratingForRole` springer manglende evner
// over i både tæller og nævner — så sammenligningen er ærlig.
function abilitiesAfter(entry) {
  return { ...entry.abilities, ...entry.next };
}

function bestRole(abilities) {
  let best = null;
  let bestValue = -1;
  for (const role of DISPLAY_RECIPE_KEYS) {
    const value = ratingForRole(abilities, role);
    if (value != null && value > bestValue) { bestValue = value; best = role; }
  }
  return best;
}

export function summarise(applied) {
  const touched = applied.filter((e) => e.lost > 0);
  const sums = {};
  for (const ability of ALL_FOUR) {
    const before = applied.reduce((s, e) => s + (Number(e.abilities[ability]) || 0), 0);
    const after = applied.reduce((s, e) => s + e.next[ability], 0);
    sums[ability] = { before, after, delta: after - before };
  }
  const bands = AGE_BANDS.map((band) => {
    const inBand = applied.filter((e) => e.band === band.key);
    const stat = {};
    for (const ability of ALL_FOUR) {
      const before = inBand.map((e) => Number(e.abilities[ability]) || 0);
      const after = inBand.map((e) => e.next[ability]);
      stat[ability] = {
        medianBefore: percentile(before, 0.5), p90Before: percentile(before, 0.9),
        medianAfter: percentile(after, 0.5), p90After: percentile(after, 0.9),
      };
    }
    return { band: band.key, n: inBand.length, ...stat };
  });

  // Rating-konsekvensen har TO kilder, og de skal skilles ad for at kunne
  // bedømmes: (a) taktik/aggression falder, (b) to nye evner kommer ind i fire
  // af de otte opskrifter. Et samlet tal ville skjule hvilken af de to der gør
  // arbejdet, og de har hver sin knap.
  let roleChanged = 0;
  let roleChangedRescaleOnly = 0;
  for (const entry of applied) {
    const before = bestRole(entry.abilities);
    if (before !== bestRole(abilitiesAfter(entry))) roleChanged += 1;
    const rescaleOnly = { ...entry.abilities, tactics: entry.next.tactics, aggression: entry.next.aggression };
    if (before !== bestRole(rescaleOnly)) roleChangedRescaleOnly += 1;
  }

  return {
    variant: applied[0]?.variant ?? null,
    n: applied.length,
    touched: touched.length,
    sums,
    bands,
    roleChanged,
    roleChangedRescaleOnly,
    massViolations: applied.filter((e) => !e.massOk).length,
    massLossPoints: applied.reduce((s, e) => s + e.massLoss, 0),
    totalMassBefore: applied.reduce((s, e) => s + e.massBefore, 0),
    totalMassAfter: applied.reduce((s, e) => s + e.massAfter, 0),
  };
}

// ── Rapport ────────────────────────────────────────────────────────────────
const cell = (v) => (v == null ? "-" : String(v));

export function renderSummary(summary, sampleNames = []) {
  const lines = [];
  // `variant` er null når planen er tom (summarise læser den af første post).
  lines.push(`### Variant ${(summary.variant ?? "—").toUpperCase()}`);
  lines.push("");
  lines.push(`Ryttere i alt: ${summary.n} · ryttere der mister point: ${summary.touched}`);
  lines.push(`Masse før: ${summary.totalMassBefore} · efter: ${summary.totalMassAfter} `
    + `· brud på masse-gaten: ${summary.massViolations} · point tabt i clamp: ${summary.massLossPoints}`);
  lines.push(`Ryttere der skifter bedste rolle (8 displayRecipes-roller): ${summary.roleChanged} `
    + `(heraf ${summary.roleChangedRescaleOnly} alene af taktik/aggression-sænkningen; `
    + `resten kommer af at de to nye evner tæller med i 4 af de 8 opskrifter)`);
  lines.push("");
  lines.push("| Evne | Sum før | Sum efter | Forskel |");
  lines.push("|---|---:|---:|---:|");
  for (const [ability, s] of Object.entries(summary.sums)) {
    lines.push(`| ${ability} | ${s.before} | ${s.after} | ${s.delta >= 0 ? "+" : ""}${s.delta} |`);
  }
  lines.push("");
  lines.push("| Aldersbånd | n | tac med. f/e | tac p90 f/e | agg med. f/e | agg p90 f/e | tw med./p90 | ld med./p90 |");
  lines.push("|---|---:|---|---|---|---|---|---|");
  for (const b of summary.bands) {
    lines.push(`| ${b.band} | ${b.n} `
      + `| ${cell(b.tactics.medianBefore)} → ${cell(b.tactics.medianAfter)} `
      + `| ${cell(b.tactics.p90Before)} → ${cell(b.tactics.p90After)} `
      + `| ${cell(b.aggression.medianBefore)} → ${cell(b.aggression.medianAfter)} `
      + `| ${cell(b.aggression.p90Before)} → ${cell(b.aggression.p90After)} `
      + `| ${cell(b.teamwork.medianAfter)} / ${cell(b.teamwork.p90After)} `
      + `| ${cell(b.leadership.medianAfter)} / ${cell(b.leadership.p90After)} |`);
  }
  if (sampleNames.length) {
    lines.push("");
    lines.push("| Rytter | alder | taktik f→e | aggression f→e | holdarbejde | lederskab | masse f→e |");
    lines.push("|---|---:|---|---|---:|---:|---|");
    for (const e of sampleNames) {
      lines.push(`| ${cell(e.name)} | ${e.age} `
        + `| ${e.current.tactics} → ${e.next.tactics} `
        + `| ${e.current.aggression} → ${e.next.aggression} `
        + `| ${e.next.teamwork} | ${e.next.leadership} `
        + `| ${e.massBefore} → ${e.massAfter} |`);
    }
  }
  return lines.join("\n");
}

// G-A1: fødes de fire mentale evner på samme skala som descending/positioning?
export function birthScaleReport(plan) {
  const keys = [...ALL_FOUR, "descending", "positioning"];
  const lines = ["| Evne | fødsels-median | fødsels-p90 |", "|---|---:|---:|"];
  for (const key of keys) {
    const vals = plan.map((e) => e.newBirth[key]).filter((v) => Number.isFinite(v));
    lines.push(`| ${key} | ${cell(percentile(vals, 0.5))} | ${cell(percentile(vals, 0.9))} |`);
  }
  return lines.join("\n");
}

// ── CLI ────────────────────────────────────────────────────────────────────
export function parseArgs(args) {
  let apply = false;
  let ownerGo = false;
  let variant = null;
  let sample = 5;
  for (const arg of args) {
    if (arg === "--dry-run") continue;
    else if (arg === "--apply") apply = true;
    else if (arg === "--owner-go") ownerGo = true;
    else if (/^--variant=(v1|v2)$/.test(arg)) variant = arg.slice(10);
    else if (/^--sample=\d+$/.test(arg)) sample = Number(arg.slice(9));
    else throw new Error(`Ukendt argument: ${arg}`);
  }
  if (apply && !ownerGo) {
    throw new Error("--apply kræver --owner-go. Point-flytningen er ejer-gated (spec §4 trin 2).");
  }
  if (apply && !variant) {
    throw new Error("--apply kræver --variant=v1 eller --variant=v2. Vælg den ejeren godkendte.");
  }
  return { apply, variant, sample };
}

// Transport-guard: i dry-run kan hverken INSERT, UPDATE, RPC eller auth-refresh
// nå databasen, uanset hvad applikationskoden måtte finde på.
export function readOnlyFetch(input, init = {}) {
  const method = (init.method || input?.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") throw new Error("Dry-run afviste en ikke-læsende forespørgsel");
  return fetch(input, init);
}

// Postgres 42P01 = undefined_table; PostgREST svarer PGRST205 når skema-cachen
// ikke kender tabellen. Alt andet er en RIGTIG fejl og skal op.
export function isMissingTableError(err) {
  const code = err?.code ?? err?.cause?.code;
  if (code === "42P01" || code === "PGRST205") return true;
  const msg = String(err?.message ?? "");
  return /does not exist|could not find the table/i.test(msg) && /relation|table|schema cache/i.test(msg);
}

export async function loadRows(supabase) {
  const riders = await fetchAllRows(() => supabase.from("riders")
    .select("id, firstname, lastname, birthdate, potentiale, generation_tag, team_id, "
      + "stat_bj, stat_fl, stat_ned, stat_bro, stat_ftr, stat_sp, stat_acc, stat_bk, "
      + "stat_kb, stat_tt, stat_prl, stat_udh, stat_res, stat_mod")
    .eq("is_retired", false).order("id"));
  // `select("*")`: teamwork/leadership findes ikke i skemaet før migrationen er
  // kørt, og en eksplicit kolonneliste ville 400'e på en dry-run FØR merge.
  const abilityRows = await fetchAllRows(() => supabase.from("rider_derived_abilities")
    .select("*").order("rider_id"));
  // Backup-tabellen er idempotens-markøren. Den findes først når migrationen er
  // kørt; en dry-run FØR merge skal stadig kunne køre, så en manglende tabel er
  // "ingen er migreret endnu", ikke en fejl.
  let migrated = new Set();
  try {
    const already = await fetchAllRows(() => supabase.from(BACKUP_TABLE)
      .select("rider_id").order("rider_id"));
    migrated = new Set(already.map((r) => r.rider_id));
  } catch (err) {
    // KUN "tabellen findes ikke" må blive til en tom mængde. Enhver anden fejl
    // (auth, netværk, timeout, rate limit) ville ellers stille nulstille
    // idempotens-markøren, og en `--apply` ville sænke allerede migrerede
    // ryttere ANDEN gang. Det er den dyreste fejl scriptet kan lave, så den er
    // eksplicit fremfor fail-open.
    if (!isMissingTableError(err)) throw err;
    console.log(`(${BACKUP_TABLE} findes ikke endnu — migrationen er ikke kørt. Ingen ryttere springes over.)`);
  }
  return selectRows(riders, abilityRows, migrated);
}

// Udvælgelsen er ren og testbar: DEN er idempotensen. En rytter med en
// backup-række er allerede migreret og må ikke røres igen — det er den eneste
// reelle beskyttelse mod en dobbelt sænkning, fordi selve regnestykket ikke kan
// se på et tal om det allerede er behandlet.
export function selectRows(riders, abilityRows, migrated = new Set()) {
  const byRider = new Map(abilityRows.map((row) => [row.rider_id, row]));
  const rows = [];
  const skipped = [];
  for (const rider of riders) {
    const abilities = byRider.get(rider.id);
    if (!abilities) continue;
    if (migrated.has(rider.id)) { skipped.push(rider.id); continue; }
    // `!= null` eksplicit: Number(null) === 0 er finit, så en NULL-kolonne ville
    // ellers slippe igennem som et gyldigt nul og få sænket "sin" taktik fra 0.
    if (abilities.tactics == null || abilities.aggression == null) continue;
    if (!Number.isFinite(Number(abilities.tactics)) || !Number.isFinite(Number(abilities.aggression))) continue;
    rows.push({ rider, abilities });
  }
  return { rows, skipped };
}

// Apply: backup FØRST (den er idempotens-markøren), derefter opdateringen.
// Rækkefølgen er ikke kosmetisk — en afbrudt kørsel skal efterlade en rytter
// enten urørt eller med et før-billede, aldrig opdateret uden backup.
// PR. RYTTER, ikke pr. chunk. Der findes ingen transaktion over to PostgREST-kald,
// så vinduet mellem backup og opdatering kan ikke lukkes helt herfra — men det kan
// gøres ÉN rytter bredt i stedet for 200. Tog vi backup for hele chunken først og
// en opdatering derefter fejlede, ville op til 199 urørte ryttere stå med en
// backup-række, og markøren ville få næste kørsel til at springe dem over: en
// permanent halv migration som ingen gentagelse kan hele.
//
// Her er sekvensen pr. rytter: skriv backup → opdatér → ved fejl, fjern backuppen
// igen og kast. Restrisikoen er et crash i selve fejl-stien (proces dræbt mellem
// en mislykket opdatering og oprydningen), altså præcis ÉN rytter, og den er
// synlig: hans backup-række findes, men hans evner er uændrede.
// Den fulde løsning er en service-role-RPC der gør begge dele i én transaktion —
// den hører til i apply-sporet med ejer-go, ikke her, hvor intet skrives.
export async function applyPlan(supabase, applied, variant) {
  let written = 0;
  for (const e of applied) {
    const { error: backupError } = await supabase.from(BACKUP_TABLE)
      .upsert([{
        rider_id: e.riderId,
        old_tactics: e.current.tactics,
        old_aggression: e.current.aggression,
        old_teamwork: e.abilities.teamwork ?? null,
        old_leadership: e.abilities.leadership ?? null,
        variant,
      }], { onConflict: "rider_id", ignoreDuplicates: true });
    if (backupError) throw backupError;

    const { error } = await supabase.from("rider_derived_abilities")
      .update({
        tactics: e.next.tactics, aggression: e.next.aggression,
        teamwork: e.next.teamwork, leadership: e.next.leadership,
      })
      .eq("rider_id", e.riderId);
    if (error) {
      // Fjern markøren igen, ellers ville en gentagelse springe en rytter over
      // der aldrig blev opdateret.
      await supabase.from(BACKUP_TABLE).delete().eq("rider_id", e.riderId);
      throw error;
    }
    written += 1;
  }
  return written;
}

async function main() {
  const { apply, variant, sample } = parseArgs(process.argv.slice(2));
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error("Kør gennem Infisical med Supabase-credentials (infisical run --env=prod -- ...)");
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(apply ? {} : { global: { fetch: readOnlyFetch } }),
  });

  const { rows, skipped } = await loadRows(supabase);
  const plan = referencePlan(rows);
  console.log(`#5268 ${apply ? `APPLY (${variant})` : "DRY-RUN"} — ${new Date().toISOString()}`);
  console.log(`Ryttere med evne-række: ${rows.length}${skipped.length ? ` (${skipped.length} allerede migreret, sprunget over)` : ""}`);
  console.log("");
  console.log("## G-A1 — fødsels-skala for de mentale evner (mål: samme spænd som descending/positioning)");
  console.log(birthScaleReport(plan));

  const results = {};
  for (const v of VARIANTS) {
    const applied = applyVariant(plan, v);
    // Navngivne eksempler SPREDT over fordelingen, ikke de fem hårdest ramte:
    // yderpunkterne alene ville give et forkert indtryk af hvad en typisk rytter
    // oplever (rapportens §3.3 valgte også en blanding af profiler).
    const sorted = [...applied].sort((a, b) => a.lost - b.lost);
    // Tom plan (alle allerede migreret) ⇒ ingen eksempler. Uden guarden ville
    // Array.from fylde `undefined` ind og rapporten crashe på e.name, altså
    // fejle netop når kørslen korrekt er et no-op.
    const named = sorted.length
      ? Array.from({ length: sample }, (_, i) =>
        sorted[Math.min(sorted.length - 1, Math.round((i / Math.max(1, sample - 1)) * (sorted.length - 1)))])
      : [];
    results[v] = applied;
    console.log("");
    console.log(renderSummary(summarise(applied), named));
  }

  if (!apply) {
    console.log("");
    console.log("Dry-run: intet er skrevet. Vælg variant og kør igen med --apply --owner-go --variant=vN.");
    return;
  }
  const written = await applyPlan(supabase, results[variant], variant);
  console.log("");
  console.log(`APPLY færdig: ${written} ryttere opdateret, før-billede i ${BACKUP_TABLE}.`);
  console.log("Rollback: UPDATE rider_derived_abilities FROM backup-tabellen (se migrationens header).");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    // Aldrig SDK-fejl eller request-objekter i loggen: de kan bære credentials.
    console.error(`#5268-kørslen fejlede: ${err?.message ?? "ukendt fejl"}`);
    process.exitCode = 1;
  });
}
