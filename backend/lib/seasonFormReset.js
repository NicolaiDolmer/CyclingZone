// Sæsonskifte-form-nulstilling (#3232) — NYT MODUL, sit EGET håndtag adskilt fra
// trætheds-nulstillingen (#2910, seasonFatigueReset.js). Samme "ét håndtag pr.
// beslutning"-princip som dér: en form-reset der delte flag med trætheden ville
// gøre det umuligt at slå dem til/fra uafhængigt.
//
// BAGGRUND: seasonFatigueReset.js:13-15 dokumenterede bevidst at "form røres
// ikke" ved sæsonskiftet — ryttere bar deres S1-slutform ind i S2 (bekræftet af
// #3202/#3229, FAQ-entry seasonFormCarryoverFaq). Ejer-beslutning 2026-08-03
// (nat-batch): "Nej form skal nulstilles ved sæsonskifte. Vi skal bare finde ud
// af til hvad fremadrettet." Målværdien er IKKE valgt endnu — derfor leverer
// dette modul ALLE TRE kandidat-modes bag config, og ejeren vælger ud fra
// sim-harnessets sammenligning (scripts/formResetSimHarness.js,
// docs/audits/2026-08-03-form-reset-sim-3232.md) FØR mekanikken flippes til live.
//
// Config (app_config, samme flere-nøgler-mønster som transferPriceBand.js —
// IKKE featureStage/evaluateFlagStage, fordi dette er et mode-VALG med fire
// tilstande, ikke et boolean-agtigt on/off/beta-flag):
//   season_form_reset_mode            "off" | "baseline" | "band" | "decay"  (default "off")
//   season_form_reset_baseline_value  mode "baseline": alle ryttere sættes til denne værdi (default 50)
//   season_form_reset_band_min        mode "band": nedre grænse for tilfældigt bånd (default 40)
//   season_form_reset_band_max        mode "band": øvre grænse for tilfældigt bånd (default 60)
//   season_form_reset_decay_target    mode "decay": midtpunktet formen henfalder mod (default 50)
//   season_form_reset_decay_factor    mode "decay": hvor meget af slutformen der "overlever" (default 0.25)
//
// Fail-safe: enhver læse-fejl, manglende række eller ukendt mode-værdi → "off"
// (= NUVÆRENDE ADFÆRD, form røres slet ikke). Samme retning som featureStage
// (manglende/ukendt konfiguration betyder ALDRIG at en ny mekanik vågner op).
//
// IDEMPOTENS (#3232 eksplicit krav, samme disciplin som seasonFatigueReset.js'
// "full"-analyse):
//   - "baseline" er trivielt idempotent: konstant uanset input (f(f(x)) = f(x)).
//   - "band" er SEEDET deterministisk på rider_id + sæson-nummer (seededUnit,
//     samme PRNG som riderProgression.js' vækst/pension-rulninger — INGEN
//     Math.random()). Mål-værdien er en REN FUNKTION af rytter-identitet +
//     sæson, uafhængig af rytterens nuværende form i DB. En gen-kørsel regner
//     derfor samme mål-værdi ud igen — ingen re-rulning.
//   - "decay" er IKKE idempotent ved gen-kørsel: det er en kontraktion mod
//     target baseret på den værdi der STÅR I DB NU (new = target + (old -
//     target) × factor). Kører man den to gange, decayer den yderligere mod
//     target — samme egenskab som "rest_days" i seasonFatigueReset.js.
//
// CLAIM-GUARD MOD DOBBELT-DECAY (#3249, jf. #3249-rapportens anbefaling):
//   applySeasonFormReset claimer den aktive sæson FØRST (season_form_reset_runs,
//   PK season_id) — men KUN i mode "decay", da det er den ENESTE mode der ikke
//   selv er idempotent (baseline er en ren konstant-funktion, band er seedet på
//   rytter+sæson). Samme mønster som season_fatigue_reset_runs (#2910): en
//   PK-kollision på season_id betyder "allerede kørt for denne sæson" →
//   { ran:false, reason:"already_ran" } i stedet for at decaye videre. En
//   operatørs "kør sæsonskiftet igen for en sikkerheds skyld" giver dermed
//   nøjagtig samme sluttilstand som én kørsel.

import { seededUnit } from "./riderProgression.js";
import { fetchAllPaged } from "./dbChunk.js";

export const SEASON_FORM_RESET_MODE_KEY = "season_form_reset_mode";

export const SEASON_FORM_RESET_PARAM_KEYS = Object.freeze({
  baselineValue: "season_form_reset_baseline_value",
  bandMin: "season_form_reset_band_min",
  bandMax: "season_form_reset_band_max",
  decayTarget: "season_form_reset_decay_target",
  decayFactor: "season_form_reset_decay_factor",
});

export const SEASON_FORM_RESET_DEFAULTS = Object.freeze({
  mode: "off",
  baselineValue: 50,
  bandMin: 40,
  bandMax: 60,
  decayTarget: 50,
  decayFactor: 0.25,
  upsertChunk: 500,
});

const VALID_MODES = new Set(["off", "baseline", "band", "decay"]);

// Neutral fallback for korrupt/manglende form. Matcher riderCondition.nextForm's
// eget fallback (50), IKKE seasonFatigueReset's 0 — form og træthed har
// forskellig semantisk "nul-tilstand" (fatigue 0 = frisk, form 50 = neutral).
const NEUTRAL_FORM = 50;

function clampInt(n, fallback = NEUTRAL_FORM) {
  // null/undefined skal ALDRIG gennem Number() (Number(null) === 0 er en
  // gyldig, ikke-fejlende værdi — det ville stille en manglende form-række
  // ved siden af en ægte form=0, som er en helt anden ting).
  if (n === null || n === undefined) return fallback;
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : fallback;
}

/**
 * Læs mode + parametre fra app_config. Returnerer ALTID et komplet objekt —
 * aldrig delvist udfyldt — så kaldere kan sprede resultatet direkte ind i
 * seasonResetForm/applySeasonFormReset. Fail-safe: enhver fejl → default
 * (mode "off", resten uændrede default-parametre).
 */
export async function readSeasonFormResetConfig(supabase) {
  const d = SEASON_FORM_RESET_DEFAULTS;
  if (!supabase?.from) return { ...d };
  try {
    const keys = [SEASON_FORM_RESET_MODE_KEY, ...Object.values(SEASON_FORM_RESET_PARAM_KEYS)];
    const { data, error } = await supabase.from("app_config").select("key, value").in("key", keys);
    if (error || !Array.isArray(data)) return { ...d };

    const byKey = Object.fromEntries(data.map((row) => [row.key, row.value]));
    const modeRaw = byKey[SEASON_FORM_RESET_MODE_KEY];
    const mode = typeof modeRaw === "string" && VALID_MODES.has(modeRaw) ? modeRaw : "off";

    const num = (raw, fallback) => (typeof raw === "number" && Number.isFinite(raw) ? raw : fallback);

    return {
      mode,
      baselineValue: num(byKey[SEASON_FORM_RESET_PARAM_KEYS.baselineValue], d.baselineValue),
      bandMin: num(byKey[SEASON_FORM_RESET_PARAM_KEYS.bandMin], d.bandMin),
      bandMax: num(byKey[SEASON_FORM_RESET_PARAM_KEYS.bandMax], d.bandMax),
      decayTarget: num(byKey[SEASON_FORM_RESET_PARAM_KEYS.decayTarget], d.decayTarget),
      decayFactor: num(byKey[SEASON_FORM_RESET_PARAM_KEYS.decayFactor], d.decayFactor),
    };
  } catch {
    // best-effort: config-læsning må aldrig vælte sæsonskiftet. Fail-safe er
    // "off" — samme tilstand som "ingen konfiguration sat endnu".
    return { ...d };
  }
}

/**
 * REN KERNE — den form en rytter går ind til den nye sæson med.
 * Deterministisk: "band" bruger seededUnit(rider_id+season), ALDRIG Math.random().
 * Ingen DB, ingen Date, ingen sideeffekt.
 *
 * @param {{form:number|null, riderId?:string|number, season?:string|number,
 *   mode?:string, baselineValue?:number, bandMin?:number, bandMax?:number,
 *   decayTarget?:number, decayFactor?:number}} args
 * @returns {number} heltal 0-100
 */
export function seasonResetForm({
  form,
  riderId = null,
  season = null,
  mode = SEASON_FORM_RESET_DEFAULTS.mode,
  baselineValue = SEASON_FORM_RESET_DEFAULTS.baselineValue,
  bandMin = SEASON_FORM_RESET_DEFAULTS.bandMin,
  bandMax = SEASON_FORM_RESET_DEFAULTS.bandMax,
  decayTarget = SEASON_FORM_RESET_DEFAULTS.decayTarget,
  decayFactor = SEASON_FORM_RESET_DEFAULTS.decayFactor,
} = {}) {
  if (!VALID_MODES.has(mode)) throw new Error(`seasonResetForm: ukendt mode '${mode}'`);

  const start = clampInt(form, NEUTRAL_FORM);

  if (mode === "off") return start;
  if (mode === "baseline") return clampInt(baselineValue, NEUTRAL_FORM);

  if (mode === "band") {
    // Ren funktion af rytter-identitet + sæson — IKKE af `start`. Det er selve
    // pointen: bånd-mode hverken belønner eller straffer S-slut-formen.
    if (riderId === null || riderId === undefined || season === null || season === undefined) {
      throw new Error("seasonResetForm: mode 'band' skal have riderId + season (idempotens-seed)");
    }
    const lo = Math.min(bandMin, bandMax);
    const hi = Math.max(bandMin, bandMax);
    const unit = seededUnit(`form_reset:${riderId}:${season}`);
    return clampInt(lo + unit * (hi - lo), NEUTRAL_FORM);
  }

  // decay: bevarer et svagt, LINEÆRT aftryk af slutformen (korrelation
  // start→resultat er analytisk ~1.0, uanset factor — det er en ren skalering
  // omkring target, ikke en uafhængig ny trækning).
  const next = decayTarget + (start - decayTarget) * decayFactor;
  return clampInt(next, NEUTRAL_FORM);
}

/**
 * Slå den aktive sæson op. Bevidst en LOKAL forespørgsel (ikke en delt import)
 * — modulet skal kunne stå alene, samme begrundelse som
 * seasonFatigueReset.js' resolveActiveSeason.
 */
async function resolveActiveSeason(supabase) {
  const { data, error } = await supabase
    .from("seasons").select("id, number").eq("status", "active").maybeSingle();
  if (error) throw new Error(`season form reset: season lookup: ${error.message}`);
  return data ?? null;
}

// Stempl claim-rækken færdig. completed_at skiller "kørslen nåede igennem" fra
// "kørslen døde undervejs og formen er delvist decayet". Best-effort: en fejl
// her må ikke kaste efter at formen ER skrevet — ellers ville kaldestedet tro
// intet skete, mens sluttilstanden faktisk er korrekt (samme disciplin som
// seasonFatigueReset.js' finishRun).
async function finishRun(supabase, seasonId, summary, nowIso) {
  const { error } = await supabase
    .from("season_form_reset_runs")
    .update({
      riders: summary.riders,
      changed: summary.changed,
      avg_before: summary.avgBefore,
      avg_after: summary.avgAfter,
      completed_at: nowIso,
    })
    .eq("season_id", seasonId);
  if (error) {
    console.error(`season form reset: failed to stamp claim row completed: ${error.message}`);
  }
}

/**
 * Anvend sæsonskifte-form-nulstillingen på HELE rider_condition-tabellen.
 *
 * - Config-gated (fail-safe "off"). Kaldes fra seasonStartHooks.js, aldrig
 *   direkte fra transitionen — samme kaldemønster som applySeasonFatigueReset.
 * - Rører KUN kolonnen form (+ updated_at). fatigue/injured_until er urørt
 *   (samme upsert-kontrakt som applySeasonFatigueReset: kun angivne kolonner
 *   opdateres på UPDATE-stien).
 * - `season` SKAL angives når mode er "band" (bruges som seed-komponent for
 *   idempotens pr. sæson) — mangler den, kaster funktionen FØR første række,
 *   i stedet for at falde tavst tilbage til en fælles/forkert seed.
 * - MODE "DECAY" er claim-guardet mod dobbelt-kørsel (#3249): claimer den
 *   aktive sæson FØRST i season_form_reset_runs (PK season_id). Ingen aktiv
 *   sæson → { ran:false, reason:"no_active_season" }. Allerede claimet →
 *   { ran:false, reason:"already_ran" }. dryRun brænder ALDRIG claimet (en
 *   efterfølgende rigtig kørsel skal stadig kunne køre). baseline/band claimer
 *   intet — de er allerede bevisligt idempotente og skal ikke pådrages ekstra
 *   DB-trafik for en garanti de ikke har brug for.
 *
 * @returns {Promise<{ran:boolean, reason?:string, mode?:string, riders?:number,
 *   changed?:number, avgBefore?:number, avgAfter?:number, dryRun?:boolean,
 *   seasonId?:string, seasonNumber?:number}>}
 */
export async function applySeasonFormReset({
  supabase,
  dryRun = false,
  now = new Date(),
  season = null,
  config = null,
  readConfig = readSeasonFormResetConfig,
  resolveSeason = resolveActiveSeason,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const cfg = config ?? (await readConfig(supabase));
  if (cfg.mode === "off") return { ran: false, reason: "flag_off" };

  if (cfg.mode === "band" && (season === null || season === undefined || season === "")) {
    throw new Error("applySeasonFormReset: 'season' er obligatorisk for mode 'band'");
  }

  const nowIso = now instanceof Date ? now.toISOString() : String(now);

  // Claim-FØRST — kun mode "decay", kun i apply-mode (en dry-run må aldrig
  // brænde sæsonens claim, se docstring ovenfor).
  let claimedSeason = null;
  if (cfg.mode === "decay" && !dryRun) {
    const activeSeason = await resolveSeason(supabase);
    if (!activeSeason) return { ran: false, reason: "no_active_season" };

    const { data: claim, error: claimErr } = await supabase
      .from("season_form_reset_runs")
      .upsert(
        { season_id: activeSeason.id, mode: cfg.mode, started_at: nowIso },
        { onConflict: "season_id", ignoreDuplicates: true }
      )
      .select("season_id");
    if (claimErr) throw new Error(`season form reset claim: ${claimErr.message}`);
    if (!claim?.length) {
      return {
        ran: false,
        reason: "already_ran",
        seasonId: activeSeason.id,
        seasonNumber: activeSeason.number,
      };
    }
    claimedSeason = activeSeason;
  }

  const { data: conditions, error } = await fetchAllPaged(() =>
    supabase.from("rider_condition").select("rider_id, form").order("rider_id")
  );
  if (error) throw new Error(`season form reset: rider_condition load: ${error.message}`);
  if (!conditions?.length) {
    if (claimedSeason) {
      await finishRun(supabase, claimedSeason.id, { riders: 0, changed: 0, avgBefore: 0, avgAfter: 0 }, nowIso);
    }
    return { ran: true, mode: cfg.mode, riders: 0, changed: 0, dryRun };
  }

  const rows = [];
  let sumBefore = 0;
  let sumAfter = 0;
  let changed = 0;

  for (const c of conditions) {
    const before = clampInt(c.form, NEUTRAL_FORM);
    const after = seasonResetForm({
      form: before,
      riderId: c.rider_id,
      season,
      mode: cfg.mode,
      baselineValue: cfg.baselineValue,
      bandMin: cfg.bandMin,
      bandMax: cfg.bandMax,
      decayTarget: cfg.decayTarget,
      decayFactor: cfg.decayFactor,
    });
    sumBefore += before;
    sumAfter += after;
    if (after !== before) {
      changed++;
      rows.push({ rider_id: c.rider_id, form: after, updated_at: nowIso });
    }
  }

  const summary = {
    ran: true,
    dryRun,
    mode: cfg.mode,
    riders: conditions.length,
    changed,
    avgBefore: Math.round((sumBefore / conditions.length) * 10) / 10,
    avgAfter: Math.round((sumAfter / conditions.length) * 10) / 10,
  };

  if (dryRun) return summary;

  for (let i = 0; i < rows.length; i += SEASON_FORM_RESET_DEFAULTS.upsertChunk) {
    const chunk = rows.slice(i, i + SEASON_FORM_RESET_DEFAULTS.upsertChunk);
    const { error: upErr } = await supabase
      .from("rider_condition")
      .upsert(chunk, { onConflict: "rider_id" });
    if (upErr) throw new Error(`season form reset upsert: ${upErr.message}`);
  }

  if (claimedSeason) await finishRun(supabase, claimedSeason.id, summary, nowIso);
  return summary;
}
