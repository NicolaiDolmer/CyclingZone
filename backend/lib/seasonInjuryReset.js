// Skader ved sæsonskiftet (#5865) — NYT MODUL, kaldt fra seasonStartHooks.js
// (samme kaldepunkt som træthedens nulstilling, #2910).
//
// PROBLEMET: trætheden nulstilles ved sæsonskiftet, men en skade følger med over
// pausen. Spillerne forventer det modsatte (Discord 28/9, ejeren: "lyder som en fin
// ide"). Design og målinger: docs/design/reviews/2026-11-16-5865-skader-ved-saesonskiftet.md.
//
// SÆSONGRÆNSENS AKSE: en skade der krydser skiftet lever på DATO-aksen. Løbsdags-
// koordinaten (injury_end_game_day/injury_season_id) hører til den gamle sæson og
// kan ikke slås op på den nye sæsons akse — træningsmotoren nulstiller den selv ved
// første tick i den nye sæson, og injuryRaceDays.js beholder injured_until som den
// konservative fallback. Derfor regner dette modul den resterende varighed i
// LØBSDATOER fra den nye sæsons første løbsdato, ikke i løbsdage.
//
// Config (app_config, samme flere-nøgler-mønster som seasonFormReset.js — et
// mode-VALG, ikke en ja/nej-kontakt):
//   season_injury_reset_mode            "off" | "clear" | "cap" | "light"  (default "off")
//   season_injury_reset_cap_dates       mode "cap": højst så mange løbsdatoer ind i den nye sæson
//   season_injury_reset_light_max_dates mode "light": skader der højst rækker så langt ind, forsvinder
//
// Modes (designnotens A/B/C):
//   "off"   → identitet. Nuværende adfærd, bit for bit.
//   "clear" → A: alle aktive skader og sygdomme forsvinder ved skiftet.
//   "cap"   → B: skaden afkortes, så den højst rækker et loft ind i den nye sæson.
//   "light" → C: kun de korte skader forsvinder; de lange løber uændret videre.
//
// FAIL-SAFE: manglende række, ukendt mode eller en læsefejl → "off". Et slukket
// mode returnerer { ran:false, reason:"flag_off" }, så seasonStartHooks.js ikke
// skriver en fase-række (bit-identisk fase-log med adfærden før #5865).
//
// IDEMPOTENS: alle tre modes er idempotente afbildninger for en fast sæsonstart.
// "clear" efterlader ingen aktive skader; "cap" er et min() mod samme loft; "light"
// fjerner de korte, og de lange er stadig lange ved næste kørsel. En gen-kørsel af
// sæsonskiftet skriver derfor nul rækker — ingen claim-tabel, samme begrundelse som
// seasonFatigueReset.js.
//
// Rører KUN skade-kolonnerne (+ updated_at). form/fatigue er urørt (supabase-js
// upsert opdaterer kun de angivne kolonner på UPDATE-stien, samme kontrakt som
// seasonFatigueReset.applySeasonFatigueReset).

import { copenhagenDateString } from "./copenhagenTime.js";
import { fetchAllPaged } from "./dbChunk.js";

export const SEASON_INJURY_RESET_MODE_KEY = "season_injury_reset_mode";

export const SEASON_INJURY_RESET_PARAM_KEYS = Object.freeze({
  capDates: "season_injury_reset_cap_dates",
  lightMaxDates: "season_injury_reset_light_max_dates",
});

export const SEASON_INJURY_RESET_DEFAULTS = Object.freeze({
  mode: "off",
  capDates: 1,
  lightMaxDates: 2,
  upsertChunk: 500,
});

const VALID_MODES = new Set(["off", "clear", "cap", "light"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcMs(dateStr) {
  return Date.UTC(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10)));
}

function addDays(dateStr, days) {
  return new Date(toUtcMs(dateStr) + days * DAY_MS).toISOString().slice(0, 10);
}

function positiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

/**
 * Løbsdatoer skaden rækker ind i den nye sæson, INKLUSIV første løbsdato
 * (samme inklusiv-semantik som injuryRaceDaysLeft, #1672). 0 = rask ved start.
 */
export function injuryDatesIntoSeason({ injuredUntil, seasonStartDate } = {}) {
  if (typeof injuredUntil !== "string" || !DATE_RE.test(injuredUntil)) return 0;
  if (typeof seasonStartDate !== "string" || !DATE_RE.test(seasonStartDate)) return 0;
  const diff = Math.round((toUtcMs(injuredUntil) - toUtcMs(seasonStartDate)) / DAY_MS);
  return diff >= 0 ? diff + 1 : 0;
}

/**
 * Læs mode + parametre fra app_config. Returnerer ALTID et komplet objekt.
 * Fail-safe: enhver fejl → default (mode "off").
 */
export async function readSeasonInjuryResetConfig(supabase) {
  const d = SEASON_INJURY_RESET_DEFAULTS;
  if (!supabase?.from) return { ...d };
  try {
    const keys = [SEASON_INJURY_RESET_MODE_KEY, ...Object.values(SEASON_INJURY_RESET_PARAM_KEYS)];
    const { data, error } = await supabase.from("app_config").select("key, value").in("key", keys);
    if (error || !Array.isArray(data)) return { ...d };
    const byKey = Object.fromEntries(data.map((row) => [row.key, row.value]));
    const modeRaw = byKey[SEASON_INJURY_RESET_MODE_KEY];
    return {
      ...d,
      mode: typeof modeRaw === "string" && VALID_MODES.has(modeRaw) ? modeRaw : "off",
      capDates: positiveInt(byKey[SEASON_INJURY_RESET_PARAM_KEYS.capDates], d.capDates),
      lightMaxDates: positiveInt(byKey[SEASON_INJURY_RESET_PARAM_KEYS.lightMaxDates], d.lightMaxDates),
    };
  } catch {
    // best-effort: config-læsning må aldrig vælte sæsonskiftet. Fail-safe er "off",
    // samme tilstand som "ingen konfiguration sat endnu".
    return { ...d };
  }
}

const CLEARED = Object.freeze({
  injured_until: null,
  injury_cause: null,
  injury_end_game_day: null,
  injury_season_id: null,
  injury_race_days_left: null,
});

/**
 * REN KERNE — skade-kolonnerne en rytter går ind i den nye sæson med.
 * Deterministisk, ingen DB, ingen Date.now.
 *
 * @param {{condition: object|null, mode?: string, seasonStartDate: string,
 *   today?: string|null, capDates?: number, lightMaxDates?: number}} args
 *   `today` = skiftets danske dato; en skade der allerede er udløbet før i dag, røres ikke.
 * @returns {object|null} de skade-kolonner der skal skrives, eller null = uændret.
 */
export function seasonResetInjury({
  condition,
  mode = SEASON_INJURY_RESET_DEFAULTS.mode,
  seasonStartDate,
  today = null,
  capDates = SEASON_INJURY_RESET_DEFAULTS.capDates,
  lightMaxDates = SEASON_INJURY_RESET_DEFAULTS.lightMaxDates,
} = {}) {
  if (!VALID_MODES.has(mode)) throw new Error(`seasonResetInjury: unknown mode '${mode}'`);
  if (mode === "off") return null;

  const until = condition?.injured_until ?? null;
  if (typeof until !== "string" || !DATE_RE.test(until)) return null;
  // En skade der er udløbet før skiftet, ejer træningsmotoren stadig (den rydder den).
  if (today && DATE_RE.test(today) && until < today) return null;
  if (typeof seasonStartDate !== "string" || !DATE_RE.test(seasonStartDate)) {
    throw new Error("seasonResetInjury: seasonStartDate (YYYY-MM-DD) is required");
  }

  const into = injuryDatesIntoSeason({ injuredUntil: until, seasonStartDate });

  if (mode === "clear") return { ...CLEARED };

  if (mode === "light") {
    return into <= positiveInt(lightMaxDates, SEASON_INJURY_RESET_DEFAULTS.lightMaxDates) ? { ...CLEARED } : null;
  }

  // "cap": afkort til loftet. En skade der allerede er kortere, røres ikke.
  const cap = positiveInt(capDates, SEASON_INJURY_RESET_DEFAULTS.capDates);
  if (into <= cap) return null;
  return {
    injured_until: addDays(seasonStartDate, cap - 1),
    injury_cause: condition.injury_cause ?? null,
    // Den gamle sæsons løbsdags-koordinat kan ikke bære den afkortede skade; datoen
    // er gaten (injuryRaceDays.js), og motoren genopfrisker resten ved første tick.
    injury_end_game_day: null,
    injury_season_id: null,
    injury_race_days_left: null,
  };
}

/** Den nye sæsons første løbsdato. Fallback: skiftets egen dato. */
async function resolveSeasonStartDate(supabase, toSeasonId, today) {
  if (!toSeasonId) return today;
  const { data, error } = await supabase
    .from("seasons").select("start_date").eq("id", toSeasonId).maybeSingle();
  if (error) throw new Error(`season injury reset: season lookup: ${error.message}`);
  const start = data?.start_date ? String(data.start_date).slice(0, 10) : null;
  return start && DATE_RE.test(start) && start >= today ? start : today;
}

/**
 * Anvend sæsonskiftets skade-regel på alle aktive skader.
 *
 * @returns {Promise<{ran:boolean, reason?:string, mode?:string, dryRun?:boolean,
 *   seasonStartDate?:string, injured?:number, cleared?:number, shortened?:number, changed?:number}>}
 */
export async function applySeasonInjuryReset({
  supabase,
  now = new Date(),
  toSeasonId = null,
  dryRun = false,
  readConfig = readSeasonInjuryResetConfig,
} = {}) {
  const cfg = await readConfig(supabase);
  if (!cfg || cfg.mode === "off" || !VALID_MODES.has(cfg.mode)) return { ran: false, reason: "flag_off" };
  if (!supabase?.from) throw new Error("Supabase client required");

  const today = copenhagenDateString(now);
  const seasonStartDate = await resolveSeasonStartDate(supabase, toSeasonId, today);

  const { data: rows, error } = await fetchAllPaged(() =>
    supabase.from("rider_condition")
      .select("rider_id, injured_until, injury_cause, injury_end_game_day, injury_season_id, injury_race_days_left")
      .gte("injured_until", today)
      .order("rider_id")
  );
  if (error) throw new Error(`season injury reset: rider_condition load: ${error.message}`);

  const nowIso = now instanceof Date ? now.toISOString() : String(now);
  const upserts = [];
  let cleared = 0;
  let shortened = 0;
  for (const c of rows ?? []) {
    const next = seasonResetInjury({
      condition: c, mode: cfg.mode, seasonStartDate, today,
      capDates: cfg.capDates, lightMaxDates: cfg.lightMaxDates,
    });
    if (!next) continue;
    if (next.injured_until === null) cleared++;
    else shortened++;
    upserts.push({ rider_id: c.rider_id, ...next, updated_at: nowIso });
  }

  const summary = {
    ran: true,
    dryRun,
    mode: cfg.mode,
    seasonStartDate,
    ...(cfg.mode === "cap" ? { capDates: cfg.capDates } : {}),
    ...(cfg.mode === "light" ? { lightMaxDates: cfg.lightMaxDates } : {}),
    injured: rows?.length ?? 0,
    cleared,
    shortened,
    changed: upserts.length,
  };
  if (dryRun || upserts.length === 0) return summary;

  for (let i = 0; i < upserts.length; i += SEASON_INJURY_RESET_DEFAULTS.upsertChunk) {
    const chunk = upserts.slice(i, i + SEASON_INJURY_RESET_DEFAULTS.upsertChunk);
    const { error: upErr } = await supabase.from("rider_condition").upsert(chunk, { onConflict: "rider_id" });
    if (upErr) throw new Error(`season injury reset upsert: ${upErr.message}`);
  }
  return summary;
}
