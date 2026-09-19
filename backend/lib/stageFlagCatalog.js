// #5259 · Kanonisk liste over de app_config-noegler der er STADIE-flag, dvs.
// dem der evalueres med evaluateFlagStage(off | beta | on).
//
// ── HVORFOR EN LISTE OG IKKE "alt i app_config" ─────────────────────────────
// app_config er en blandet noegle/vaerdi-tabel: tre-stadie-flag, tal
// (market_value_weekly_cap), tidsstempler (season_transition_planned_at) og
// EGNE tre-tilstande med et andet ordforraad — email_loop_* er off|dry_run|on
// og rider_reputation_enabled er off|shadow|on. Et admin-panel der satte
// "beta" paa en af dem, ville skrive en vaerdi ingen kode forstaar, og
// fail-safe'en i de moduler ville laese den som "off". Derfor: kun de noegler
// der faktisk gaar gennem evaluateFlagStage staar her.
//
// ── HVORFOR DEN IKKE KAN DRIVE FRA KODEN ────────────────────────────────────
// stageFlagCatalog.test.js scanner backend-kilden for moenstret
// `evaluateFlagStage(await readFlagStage(<klient>, <noegle>))` og fejler hvis
// en scannet noegle mangler her. En ny stage-flag-modul kan altsaa ikke smutte
// ind uden ogsaa at blive styrbar fra admin-fladen (samme forward-guard-idé
// som notificationTypes.test.js, #3016).

export const FLAG_STAGES = Object.freeze(["off", "beta", "on"]);

export function isValidFlagStage(stage) {
  return FLAG_STAGES.includes(stage);
}

/**
 * Hver post: { key, area, label }.
 *  - `area` grupperer tavlen (samme vokabular som docs/FEATURE_REGISTRY.yml).
 *  - `label` er ADMIN-tekst (dansk) — fladen er ejerens, ikke spillerens, og
 *    oversaettes derfor ikke (samme valg som resten af /admin).
 */
export const STAGE_FLAGS = Object.freeze([
  // ── Spiller-vendte funktioner ─────────────────────────────────────────────
  { key: "academy_enabled", area: "academy", label: "Akademi" },
  { key: "academy_intake_pull_enabled", area: "academy", label: "Akademi — træk af nye talenter" },
  { key: "intake_offer_expiry_enabled", area: "academy", label: "Akademi — udløb på tilbud" },
  { key: "season_academy_intake_enabled", area: "academy", label: "Akademi — sæsonoptag" },
  { key: "board_mandate_model_enabled", area: "board", label: "Bestyrelse — mandat-modellen" },
  { key: "daily_training_enabled", area: "training", label: "Daglig træning" },
  { key: "training_score_visible", area: "training", label: "Træningsscore 1-99 (visning)" },
  { key: "training_mobile_table", area: "training", label: "Træningssiden på mobil — ny tabel" },
  { key: "training_tick_per_race_day", area: "training", label: "Træning pr. løbsdag" },
  { key: "peak_planner_enabled", area: "training", label: "Form-planlægger" },
  { key: "facilities_enabled", area: "club", label: "Faciliteter" },
  // Kill-switch for job-modellen (#2244). Semantisk binaer (on/off), men den
  // GAAR gennem evaluateFlagStage, og saa hoerer den hjemme her: bliver den
  // sat til `beta`, ser beta-testere job-modellen mens spillerne ser slots —
  // hvilket er praecis den udrulning A4b-moenstret beskriver med admin-preview.
  { key: "scout_system_enabled", area: "scouting", label: "Scouting — job-modellen" },
  { key: "season_signup_enabled", area: "season", label: "Tilmelding til næste sæson" },
  { key: "race_day_intention_enabled", area: "race-day", label: "Løbsdags-intention" },
  { key: "race_stage_timeline", area: "race-day", label: "Etape-tidslinje" },
  { key: "race_day_development_enabled", area: "race-day", label: "Udvikling på løbsdage" },

  // ── Motorer og batch-jobs (spilleren ser resultatet, ikke kontakten) ──────
  { key: "race_engine_v2_enabled", area: "race-engine", label: "Løbsmotor v2" },
  { key: "race_engine_v3_scoring", area: "race-engine", label: "Løbsmotor v3 — scoring" },
  { key: "race_engine_v4", area: "race-engine", label: "Løbsmotor v4" },
  { key: "race_day_engine_enabled", area: "race-engine", label: "Løbsdags-motor" },
  { key: "race_finalize_resumable_enabled", area: "race-engine", label: "Genoptagelig finalisering" },
  { key: "stage_scheduler_enabled", area: "race-engine", label: "Etape-skemalægger" },
  { key: "auto_calendar_enabled", area: "season", label: "Auto-kalender" },
  { key: "auto_entry_generator_enabled", area: "season", label: "Auto-tilmelding af felter" },
  { key: "auto_prize_enabled", area: "economy", label: "Auto-præmier" },
  { key: "season_end_pool_reseed", area: "season", label: "Sæsonslut — genfyld rytterpulje" },
  { key: "season_end_skip_division_movement", area: "season", label: "Sæsonslut — spring op/nedrykning over" },
  { key: "season_fatigue_reset_enabled", area: "season", label: "Sæsonslut — nulstil træthed" },
  { key: "season_documentary_llm_enabled", area: "season", label: "Sæson-dokumentar (LLM)" },
  { key: "ai_team_retire_enabled", area: "ops", label: "AI-hold — pensionering" },
  { key: "ai_pool_retirement_v2_enabled", area: "ops", label: "AI-pulje — pensionering v2" },
  { key: "market_value_sweep_enabled", area: "market", label: "Markedsværdi-sweep" },
  { key: "rider_values_bulk_write_enabled", area: "market", label: "Ryttereværdier — bulk-skrivning" },
  { key: "alunta_reconcile_enabled", area: "billing", label: "Alunta-afstemning" },
]);

const STAGE_FLAG_KEY_SET = new Set(STAGE_FLAGS.map((f) => f.key));

export function isStageFlagKey(key) {
  return STAGE_FLAG_KEY_SET.has(key);
}

export function findStageFlag(key) {
  return STAGE_FLAGS.find((f) => f.key === key) ?? null;
}

/**
 * Normalisér en raa app_config-vaerdi til det stadie tavlen skal VISE.
 * Bagudkompatibel praecis som evaluateFlagStage: boolean true/false fra det
 * gamle skema er on/off. Ukendt/manglende vaerdi vises som "off" — samme
 * fail-safe som motoren bruger, saa tavlen aldrig viser noget andet end det
 * spilleren faktisk faar.
 */
export function normalizeStageValue(value) {
  if (value === true || value === "on") return "on";
  if (value === "beta") return "beta";
  return "off";
}

/**
 * True hvis den raa vaerdi IKKE er en af de fire former stadie-modellen kender
 * (true/false/"on"/"beta"/"off"). Tavlen maerker saadan en raekke i stedet for
 * at lade som om den er "off" — den er en drift, ikke et valg.
 */
export function isUnknownStageValue(value) {
  if (value === null || value === undefined) return false; // "raekken findes ikke" = off, ikke drift
  if (typeof value === "boolean") return false;
  return !FLAG_STAGES.includes(value);
}
