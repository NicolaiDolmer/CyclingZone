// Sæsonskifte-restitution (#2910) — NYT MODUL, rører ikke seasonTransition-kernen.
//
// PROBLEMET (målt i prod 25/7): træthed nulstilles ingen steder i sæsonskiftet.
// Sidste S1-etape er søndag 19:00, første S2-etape mandag 11:00 — 16 timer. Feltet
// starter derfor S2 med den træthed det sluttede S1 med, og spredningen (p10 28 →
// p90 100 på menneskehold) er ren udtagelses-tilfældighed, ikke holdbygning.
//
// Modulet leverer ÉN ren funktion (seasonResetFatigue) + én apply-funktion, begge
// bag app_config-flaget season_fatigue_reset_enabled. FAIL-SAFE: flag fraværende
// eller fejl → false → NUVÆRENDE ADFÆRD (ingen reset). Samme flag-disciplin som
// autoCalendarFlag.js/academyFlag.js.
//
// BEVIDST UDEN FOR SCOPE: form røres ikke. Modellen i riderCondition.nextForm
// kobler form til træthed, så en reset der også skrev form ville flytte to
// balance-håndtag på én gang. Ét håndtag pr. beslutning.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { nextFatigue } from "./riderCondition.js";
import { fetchAllPaged, selectInChunks } from "./dbChunk.js";

export const SEASON_FATIGUE_RESET_FLAG_KEY = "season_fatigue_reset_enabled";

// Modes:
//   "off"        → identitet (bruges kun af harness/tests til at måle nul-linjen)
//   "full"       → alle på 0 (off-season-nulstilling) ← EJER-VALGT 26/7, se nedenfor
//   "rest_days"  → N simulerede hviledage gennem DEN ÆGTE daglige model
//                  (riderCondition.nextFatigue, intensity "rest"), så recovery-evnen
//                  stadig betyder noget og trætte ryttere ikke bliver gratis friske.
//
// EJER-BESLUTNING 2026-07-26: "full". Harnessen anbefalede "rest_days"/3, fordi en
// fuld nulstilling giver AI-holdene +3,9 procentpoint af top-10-pladserne (40,5 →
// 44,4 %). Ejeren fik det trade-off præsenteret og valgte alligevel fuld nulstilling:
// princippet "alle starter sæsonen lige" vejer tungere end den engangs-skævhed.
// AI-løftet findes i øvrigt KUN fordi AI-ryttere aldrig restituerer (trainingSweep
// filtrerer på is_ai = false) — retter vi den bug, forsvinder skævheden af sig selv.
//
// IDEMPOTENS: "full" er en idempotent afbildning (f → 0, og 0 → 0), så en gen-kørsel
// af sæsonskiftet er et rent no-op på trætheds-siden. Derfor har denne side bevidst
// INGEN claim-tabel — modsat akademi-optagelsen (#2911), hvor en gen-kørsel ville
// udstede nye tilbud. Egenskaben er låst af tests i seasonFatigueReset.test.js
// ("shipped mode er idempotent"), så et skifte tilbage til rest_days — som IKKE er
// idempotent, den konvergerer mod 0 dag for dag — fejler testen i stedet for at
// smutte igennem.
export const SEASON_FATIGUE_RESET = Object.freeze({
  MODE: "full",
  REST_DAYS: 3,
  DEFAULT_RECOVERY: 50, // rytter uden abilities-række → neutral recovery
  UPSERT_CHUNK: 500,
});

const VALID_MODES = new Set(["off", "full", "rest_days"]);

export async function isSeasonFatigueResetEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, SEASON_FATIGUE_RESET_FLAG_KEY), opts);
}

/**
 * REN KERNE — trætheden en rytter går ind til den nye sæson med.
 * Deterministisk, ingen tilfældighed, ingen DB, ingen Date.
 *
 * @param {{fatigue:number|null, recoveryAbility?:number|null, mode?:string, restDays?:number}} args
 * @returns {number} heltal 0-100
 */
export function seasonResetFatigue({
  fatigue,
  recoveryAbility = SEASON_FATIGUE_RESET.DEFAULT_RECOVERY,
  mode = SEASON_FATIGUE_RESET.MODE,
  restDays = SEASON_FATIGUE_RESET.REST_DAYS,
} = {}) {
  if (!VALID_MODES.has(mode)) throw new Error(`seasonResetFatigue: ukendt mode '${mode}'`);

  const raw = Number(fatigue);
  const start = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 0;

  if (mode === "off") return start;
  if (mode === "full") return 0;

  const days = Math.max(0, Math.floor(Number(restDays) || 0));
  const rec = Number.isFinite(Number(recoveryAbility))
    ? Number(recoveryAbility)
    : SEASON_FATIGUE_RESET.DEFAULT_RECOVERY;

  let f = start;
  for (let i = 0; i < days; i++) {
    f = nextFatigue({ fatigue: f, intensity: "rest", recoveryAbility: rec });
  }
  return f;
}

/**
 * Anvend sæsonskifte-restitutionen på HELE rider_condition-tabellen.
 *
 * - Flag-gated (fail-safe off). Kaldes fra seasonStartHooks.js, aldrig direkte
 *   fra transitionen.
 * - IDEMPOTENT i den mode der shippes ("full"): funktionen er en ren afbildning
 *   af den aktuelle træthed, og f → 0 er idempotent (anden kørsel finder alle på
 *   0, skriver nul rækker og rapporterer changed: 0). En operatør der kører
 *   sæsonskiftet igen "for en sikkerheds skyld" kan derfor ikke gøre skade på
 *   trætheds-siden — derfor ingen claim-tabel her. ("rest_days" er IKKE
 *   idempotent: hver kørsel trækker N hviledage mere fra.)
 * - Rører KUN kolonnen fatigue (+ updated_at). form/injured_until er urørt
 *   (supabase-js upsert opdaterer kun de angivne kolonner på UPDATE-stien —
 *   samme kontrakt som raceFatigue.applyRaceFatigue).
 *
 * @returns {Promise<{ran:boolean, reason?:string, mode?:string, restDays?:number,
 *   riders?:number, changed?:number, avgBefore?:number, avgAfter?:number, dryRun?:boolean}>}
 */
export async function applySeasonFatigueReset({
  supabase,
  dryRun = false,
  now = new Date(),
  mode = SEASON_FATIGUE_RESET.MODE,
  restDays = SEASON_FATIGUE_RESET.REST_DAYS,
  isEnabled = isSeasonFatigueResetEnabled,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!(await isEnabled(supabase))) return { ran: false, reason: "flag_off" };

  const { data: conditions, error } = await fetchAllPaged(() =>
    supabase.from("rider_condition").select("rider_id, fatigue").order("rider_id")
  );
  if (error) throw new Error(`season fatigue reset: rider_condition load: ${error.message}`);
  if (!conditions?.length) return { ran: true, mode, restDays, riders: 0, changed: 0, dryRun };

  // Recovery-evnen bruges kun i "rest_days"-mode; hent den kun dér.
  const recoveryByRider = new Map();
  if (mode === "rest_days") {
    const { data: abilities, error: abErr } = await selectInChunks({
      supabase,
      table: "rider_derived_abilities",
      columns: "rider_id, recovery",
      inColumn: "rider_id",
      ids: conditions.map((c) => c.rider_id),
    });
    if (abErr) throw new Error(`season fatigue reset: abilities load: ${abErr.message}`);
    for (const a of abilities || []) recoveryByRider.set(a.rider_id, a.recovery);
  }

  const nowIso = now instanceof Date ? now.toISOString() : String(now);
  const rows = [];
  let sumBefore = 0;
  let sumAfter = 0;
  let changed = 0;

  for (const c of conditions) {
    const before = Math.max(0, Math.min(100, Math.round(Number(c.fatigue) || 0)));
    const after = seasonResetFatigue({
      fatigue: before,
      recoveryAbility: recoveryByRider.has(c.rider_id)
        ? recoveryByRider.get(c.rider_id)
        : SEASON_FATIGUE_RESET.DEFAULT_RECOVERY,
      mode,
      restDays,
    });
    sumBefore += before;
    sumAfter += after;
    if (after !== before) {
      changed++;
      rows.push({ rider_id: c.rider_id, fatigue: after, updated_at: nowIso });
    }
  }

  const summary = {
    ran: true,
    dryRun,
    mode,
    restDays,
    riders: conditions.length,
    changed,
    avgBefore: Math.round((sumBefore / conditions.length) * 10) / 10,
    avgAfter: Math.round((sumAfter / conditions.length) * 10) / 10,
  };

  if (dryRun || rows.length === 0) return summary;

  for (let i = 0; i < rows.length; i += SEASON_FATIGUE_RESET.UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + SEASON_FATIGUE_RESET.UPSERT_CHUNK);
    const { error: upErr } = await supabase
      .from("rider_condition")
      .upsert(chunk, { onConflict: "rider_id" });
    if (upErr) throw new Error(`season fatigue reset upsert: ${upErr.message}`);
  }

  return summary;
}
