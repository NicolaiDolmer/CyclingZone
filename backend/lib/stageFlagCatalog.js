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
  // #1140: "Your first race"-kort for nye hold paa dashboardet. Seedet off.
  { key: "first_race_card", area: "onboarding", label: "Dit første løb — kort på dashboardet (nye hold)" },
  { key: "training_bulk_day", area: "training", label: "Træning — sæt dagen for flere ryttere" },
  // #6110 S26: "Dagens beslutning"-kortet oeverst paa Today-fanen. Seedet off.
  { key: "training_decision_card", area: "training", label: "Træning — Dagens beslutning (kort øverst)" },
  { key: "training_tick_per_race_day", area: "training", label: "Træning pr. løbsdag" },
  { key: "training_condition_per_date", area: "training", label: "Træningstilstand pr. dato" },
  // #4847: "Train now" uden bonus. Kraever training_condition_per_date.
  { key: "training_train_now", area: "training", label: "Træn nu (uden bonus)" },
  // #6461 B: klikket afregner rytterens hele kendte dato. Seedet off; flip er ejer-only.
  { key: "training_train_now_whole_day", area: "training", label: "Træn nu — hele dagen i ét klik (B)" },
  // #4629: programmer pr. løbsdag, seedet i beta 26/9. Flip til on er ejer-only.
  { key: "training_programs", area: "training", label: "Træningsprogrammer pr. løbsdag" },
  // #5932: de 35 felter for alle hold (ejer 29/9). Kataloget bliver bag training_programs.
  { key: "training_program_cells", area: "training", label: "Træningsfelter pr. løbsdag (35 felter)" },
  // #4854/#5620: spillerens egne regler (træthedsgrænse), seedet i beta. Flip til on er ejer-only.
  { key: "training_fatigue_rules", area: "training", label: "Træthedsgrænse (spillerens regler)" },
  // #6000: træningsgrupper, seedet i beta. Kræver training_program_cells. Flip til on er ejer-only.
  { key: "training_groups", area: "training", label: "Træningsgrupper" },
  { key: "peak_planner_enabled", area: "training", label: "Form-planlægger" },
  // #5435: kun visning. Flippes i samme deploy som værdiskiftet (#5443/#5497).
  { key: "rider_best_role_display", area: "squad", label: "Rating = bedste rolle nu (visning)" },
  // #5519: kun visning + ét laese-endpoint. Ejeren flipper efter visuelt go.
  { key: "youth_squad_pages", area: "squad", label: "U23 team- og Junior team-sider" },
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
  // #5124: kun visning (frontend). Beta foerst, ejer 1/10.
  { key: "season_matrix_mobile", area: "season", label: "Sæsonmatrix på mobil — ny visning" },
  // #6590: web push, seedet off. Kræver VAPID_* på backend. Flip er ejer-only.
  { key: "push_enabled", area: "notifications", label: "Push-notifikationer" },
  // #6570: etapeside 2.0, seedet off. Beta foerst (ejer 14/10).
  { key: "stage_page_v2", area: "race-day", label: "Etapeside 2.0" },
  // #6514: løbskort i kalenderen, status-prik og Løbshistorik. Seedet off (ejer 15/10).
  { key: "race_library_v2", area: "race-day", label: "Kalender-løbskort + Løbshistorik" },
  // #7003: etapeplan langs ruten (taktik), seedet off. Virker kun i løb på s5_profiles_v3.
  { key: "stage_plan_v1", area: "race-day", label: "Taktik — etapeplan langs ruten" },

  // ── Motorer og batch-jobs (spilleren ser resultatet, ikke kontakten) ──────
  { key: "race_engine_v2_enabled", area: "race-engine", label: "Løbsmotor v2" },
  { key: "race_engine_v3_scoring", area: "race-engine", label: "Løbsmotor v3 — scoring" },
  { key: "race_engine_v4", area: "race-engine", label: "Løbsmotor v4" },
  // #6156 (ejer 19/10): formtoppe/dyk i v4 under s5_profiles_v2. Seedet off; tændes ved sæsonskiftet.
  { key: "race_form_peaks", area: "race-engine", label: "Formtoppe i løbene" },
  { key: "race_day_engine_enabled", area: "race-engine", label: "Løbsdags-motor" },
  { key: "race_finalize_resumable_enabled", area: "race-engine", label: "Genoptagelig finalisering" },
  { key: "race_notify_outbox_enabled", area: "race-engine", label: "Notify-kø — asynkron udsendelse" },
  { key: "stage_scheduler_enabled", area: "race-engine", label: "Etape-skemalægger" },
  { key: "ranking_shadow_enabled", area: "ops", label: "Ranglister — skyggeaggregater" },
  { key: "auto_calendar_enabled", area: "season", label: "Auto-kalender" },
  { key: "auto_entry_generator_enabled", area: "season", label: "Auto-tilmelding af felter" },
  { key: "auto_prize_enabled", area: "economy", label: "Auto-præmier" },
  // #5741: kill-switch for akademi-drift specifikt ved S3→S4-skiftet 27/9.
  // Fail-safe MODSAT resten af tavlen: manglende/fejlet læsning = true
  // (drift opkræves som i dag), se academyDriftFlag.ts.
  { key: "academy_drift_enabled", area: "economy", label: "Ungdomsdrift ved sæsonskifte" },
  // #4385: upkeep pr. seniorløbsdag i stedet for fladt ved sæsonstart. Fail-safe
  // OFF; "beta" læses som off (upkeepPerRaceDayFlag.ts). Flippes FØR sæsonskiftet.
  { key: "upkeep_per_race_day", area: "economy", label: "Upkeep pr. løbsdag (rejse og personale)" },
  // #6936: fjerner upkeep/rejse og personale, akademi-drift og facilitets-upkeep.
  // Fail-safe OFF; "beta" læses som off (economyNoUpkeepFlag.ts). Flippes FØR sæsonskiftet.
  { key: "economy_no_upkeep_v1", area: "economy", label: "Ingen upkeep, akademi-drift eller facilitets-upkeep" },
  { key: "season_end_pool_reseed", area: "season", label: "Sæsonslut — genfyld rytterpulje" },
  { key: "season_end_skip_division_movement", area: "season", label: "Sæsonslut — spring op/nedrykning over" },
  { key: "season_fatigue_reset_enabled", area: "season", label: "Sæsonslut — nulstil træthed" },
  // #6499 + #6500: Udvikling 2.0 del 1 under ét flag: tilbagegang ved sæsonskiftet
  // (developmentV2Flag.js) og ingen daglig udvikling uden for managerhold
  // (dailyTrainingEngine.js). Fail-safe OFF; "beta" læses som off. Ejer-only flip.
  { key: "development_v2_aging_enabled", area: "season", label: "Udvikling 2.0 del 1 — tilbagegang + kun managerhold udvikler sig" },
  // #6210: maks +1 pr. evne pr. rytter pr. dato (dailyTrainingEngine.js). Fail-safe
  // OFF; tændes med Udvikling 2.0. Ejer-only flip.
  { key: "ability_cap_per_date_enabled", area: "training", label: "Udvikling 2.0 — maks +1 pr. evne pr. dato" },
  // #3564: kurve B (D-058, developmentCurveBFlag.ts). Fail-safe OFF; "beta" læses som off. Ejer-only flip.
  { key: "development_curve_b", area: "training", label: "Udvikling 2.0 — kurve B (niveau og potentiale styrer, ikke alder)" },
  // #6853/#5764 (spec 6110 §8): paraply-flaget for potentiale-visningen i
  // Udvikling 2.0. Første del: potentialet vises for rollen med højest potentiale
  // + typeboks (potentialDisplayBand.js). Fail-safe OFF; tændes samlet med 2.0.
  { key: "potential_single_number", area: "squad", label: "Udvikling 2.0 — potentiale: bedste rolle + typeboks (visning)" },
  // #6950 (Udvikling 2.0): Udviklingsscore B i motoren (developmentScoreWiring.js) og
  // catch-up via løb (raceCatchUpWiring.js). Fail-safe OFF; "beta" læses som off; tal i
  // serverens miljø; kræver ability_cap_per_date_enabled. Ejer-only flip.
  { key: "development_score_v2", area: "training", label: "Udvikling 2.0 — Udviklingsscore B styrer dagens udvikling" },
  { key: "race_day_catchup_enabled", area: "training", label: "Udvikling 2.0 — catch-up via løb (løbsdagens ekstra ens for alle hold)" },
  { key: "season_documentary_llm_enabled", area: "season", label: "Sæson-dokumentar (LLM)" },
  { key: "ai_team_retire_enabled", area: "ops", label: "AI-hold — pensionering" },
  { key: "ai_pool_retirement_v2_enabled", area: "ops", label: "AI-pulje — pensionering v2" },
  { key: "rider_values_bulk_write_enabled", area: "market", label: "Ryttereværdier — bulk-skrivning" },
  { key: "rider_primary_type_from_distribution", area: "squad", label: "Rytter-generator: primær type fra mål-fordelingen" },
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

// #4948 · ALLOWLIST for det spiller-synlige flag-endpoint (GET /api/feature-flags,
// backend/api/featureFlagsApi.js). Kun noegler her kan nogensinde laeses og
// returneres derfra; resten af app_config (tal, tidsstempler, andre
// tre-tilstande, ops-flag) forlader aldrig serveren ad den vej. Hver noegle
// SKAL ogsaa staa i STAGE_FLAGS ovenfor, fordi endpointet evaluerer dem med
// evaluateFlagStage. Tilfoej kun et flag her naar en spillerflade skal kunne
// spoerge om det uden en mere specifik route at spoerge.
export const PLAYER_VISIBLE_FLAG_KEYS = Object.freeze([
  "race_engine_v4",
  "board_mandate_model_enabled",
  "training_tick_per_race_day",
  // #5274: HelpPage gater traeningsscore-blokken paa dette flag, saa spillere
  // ikke laeser om Score-kolonnen foer den er taendt for dem.
  "training_score_visible",
  // #5519: HelpPage gater den nye youthSquads-sektion paa dette flag, saa
  // U23/junior-hjaelpeteksterne foerst vises naar siderne faktisk er live.
  "youth_squad_pages",
  // #6666: HelpPage gater optag 2.0-blokkene (profil, prognose) paa dette flag.
  "academy_intake_pull_enabled",
  // #4854: HelpPage gater traethedsgraense-blokken paa dette flag.
  "training_fatigue_rules",
  // #5124: SeasonMatrix vaelger mobilvisningen paa dette flag.
  "season_matrix_mobile",
  // #6000: HelpPage gater traeningsgruppe-blokken paa dette flag.
  "training_groups",
  // #6154: patch notes-siden laeser beta-noternes kontakt herfra, saa
  // maerket skifter til "Now for everyone" naar kontakten er on for alle.
  "rider_best_role_display",
  "training_programs",
  // #3564: HelpPage viser kurve B-tvillingerne (HELP_BLOCK_FLAGS/HELP_FAQ_FLAGS) paa dette flag.
  // Binaert (se PLAYER_VISIBLE_BINARY_FLAG_KEYS): "beta" er off, ogsaa for beta-gruppen.
  "development_curve_b",
  // 7.361: beta-noterne for etapeside 2.0 og bulk-dag skifter til
  // "Now for everyone", naar kontakterne er on for alle.
  "stage_page_v2",
  "training_bulk_day",
  // #6110 Udvikling 2.0 del 1: HelpPage gater de nye blokke paa disse flag, saa
  // Hjaelp foerst beskriver aldring, potentiale, maks +1 og Dagens beslutning
  // naar de er taendt for spilleren.
  "development_v2_aging_enabled",
  "potential_single_number",
  "ability_cap_per_date_enabled",
  "training_decision_card",
]);

// #3564: spiller-synlige flag som serveren selv laeser binaert (kun "on" taender,
// "beta" = off). Endpointet svarer derfor false for ALLE viewers paa "beta", saa
// en flade aldrig beskriver en model motoren ikke koerer for beta-gruppen.
export const PLAYER_VISIBLE_BINARY_FLAG_KEYS = Object.freeze(["development_curve_b"]);
