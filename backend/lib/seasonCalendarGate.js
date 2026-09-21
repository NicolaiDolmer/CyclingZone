// backend/lib/seasonCalendarGate.js
// #3469 (leverance 5): gatePlan EKSTRAHERET fra scripts/buildSeasonCalendar.js til lib/,
// så BEGGE veje der kan materialisere en sæson-kalender (den manuelle CLI OG
// seasonTransition.js's `auto_calendar_enabled`-forever-sti, fase 17) kører PRÆCIS
// samme gate — ren funktion, ingen DB. Før denne udtrækning kørte kun CLI'en gaten;
// forever-stien kaldte materializeTierCalendars direkte og sprang etaperækkefølge,
// komposition, kvote-hul og udtømt realisme-re-draw over (se seasonTransition.js's
// season_calendar-fase-docstring for hvordan resultatet bruges).
//
// scripts/buildSeasonCalendar.js re-eksporterer denne funktion uændret — CLI'ens egen
// import-sti (`./buildSeasonCalendar.js`) er derfor stadig gyldig for eksisterende
// kaldere/tests.

import {
  aggregateCompositionStats, detectCompositionViolations, ACTIVE_TARGET,
  TIER_COMPOSITION_TOLERANCE_PP, COMPOSITION_TOLERANCE_PP,
} from "./calendarCompositionTargets.js";
import { detectStageOrderViolations } from "./stageOrderMetrics.js";
import { scoreSeason, TIER_TARGETS } from "./raceRouteRealismMetrics.js";
import { resolveSeasonDraw } from "./raceRouteRealismDraw.js";

/**
 * Kør alle gates på en dry-run-plan (materializeTierCalendars-summary med dryRun:true).
 * Ren funktion af summary'en, så beslutningen kan testes uden DB.
 *
 * @param {object} summary materializeTierCalendars({ ..., dryRun: true })'s returværdi
 * @param {{allowTierCompositionDrift?:boolean}} [opts] #3469 (leverance 4): pr.-tier
 *   kompositions-brud (detectCompositionViolations({applyMinRaceDayTolerance:true}) pr.
 *   tier, IKKE kun sæson-aggregatet) er en NY kategori, adskilt fra `compositionDrift`
 *   (sæson-niveau, #3295). Default (false) gater HÅRDT — samme som de øvrige nye #3469-
 *   gates. `allowTierCompositionDrift:true` lemper PRÆCIS denne ene kategori (CLI-flaget
 *   `--allow-tier-composition-drift`), analogt med `--allow-composition-drift` for
 *   sæson-aggregatet. seasonTransition.js's forever-sti lader denne stå på default
 *   (false) — en automatisk transition skal ALDRIG selv acceptere en afvigelse, kun en
 *   menneske-kørt CLI-session med et eksplicit flag må det.
 * @returns {{blocking:string[], compositionDrift:string[], tierCompositionDrift:string[], severity:number, report:object}}
 *   blocking              brud der ALDRIG må overrides
 *   compositionDrift      K-B-afvigelser PÅ SÆSON-AGGREGATET (kan lempes med --allow-composition-drift)
 *   tierCompositionDrift  K-B-afvigelser PR. TIER (#3469) — lempes separat med
 *                         --allow-tier-composition-drift; ELLERS rykket ind i `blocking`
 *   severity               samlet numerisk afstand til båndene (0 = alt grønt) — lader en
 *                     søgning se delvis fremgang, hvor antal-brud ser nul
 */
export function gatePlan(summary, { allowTierCompositionDrift = false } = {}) {
  const blocking = [];
  if (summary.finaleDraw?.exhausted) blocking.push('calendar finale draw exhausted; original failing plan retained for diagnostics');
  const compositionDrift = [];
  const tierCompositionDrift = [];

  const tierEntries = [];
  for (const t of summary.tiers) {
    for (const v of t.calendarViolations ?? []) blocking.push(`kalender-invariant — ${v}`);

    if (!t.compositionStats || t.compositionStats.raceDays === 0) {
      blocking.push(`tier ${t.tier}: 0 løbsdage i planen — kalenderen ville være tom`);
      continue;
    }
    if (t.quotaHit === false && t.shortfall > 3) {
      // Små huller (1-3 dage) er katalog-knaphed og accepteret; et stort hul betyder at
      // selection fejlede og kalenderen ville have tomme perioder.
      blocking.push(`tier ${t.tier}: kvoten mangler ${t.shortfall} game-days — for stort hul til at materialisere`);
    }
    for (const v of detectStageOrderViolations({ stats: t.stageOrderStats, label: `tier ${t.tier}` })) {
      blocking.push(`etaperækkefølge (#3326) — ${v}`);
    }

    // #3469 (leverance 4): pr.-tier K-B-komposition. FØR denne ændring gatede
    // buildSeasonCalendar.js kun SÆSON-AGGREGATET (compositionDrift nedenfor) — en tier
    // kunne afvige markant fra K-B og forsvinde i sæson-gennemsnittet, hvis en anden tier
    // afveg den modsatte vej.
    //
    // Tolerancen kommer fra TIER_COMPOSITION_TOLERANCE_PP (DATA, calendarCompositionTargets.js
    // — MÅLT pr.-tier-afvigelse på den nuværende plan + 1 pp buffer, se den tabels
    // docstring for hvorfor), IKKE fra en generisk størrelses-formel: hver tier trækker
    // fra et ANDET klasse-vindue af kataloget (tierRaceSelection.js), så tier-skævheden
    // er katalogets loft, ikke bare en lille-stikprøve-effekt. applyMinRaceDayTolerance:true
    // bevares som et sikkerhedsnet UNDER tabellen (aldrig strammere end den generiske
    // skalering) for tiers uden en eksplicit tabel-værdi.
    const { violations: tierDrift } = detectCompositionViolations({
      stats: t.compositionStats, target: ACTIVE_TARGET, label: `tier ${t.tier}`, applyMinRaceDayTolerance: true,
      tolerancePp: TIER_COMPOSITION_TOLERANCE_PP[t.tier] ?? COMPOSITION_TOLERANCE_PP,
    });
    if (tierDrift.length) {
      if (allowTierCompositionDrift) tierCompositionDrift.push(...tierDrift);
      else for (const v of tierDrift) blocking.push(`pr.-tier komposition (#3469) — ${v}`);
    }

    if (Array.isArray(t.seedRaces) && t.seedRaces.length) tierEntries.push({ tier: t.tier, seedRaces: t.seedRaces });
  }

  // Realisme-båndene scores på det RESOLVEREDE træk — samme tal skrive-stien persisterer.
  // `severity` er den samlede NUMERISKE afstand til båndene, ikke bare antal brud. Antal
  // alene er en for grov ledetråd for en søgning: tier 3's summit-bånd lukkes først af
  // FLERE nye løb, så ingen enkelt kandidat fjerner bruddet, og en søgning der kun tæller
  // brud ser dem alle som værdiløse. Afstanden (summit 5 → 6 → 7 → 8) viser fremgangen.
  let severity = 0;
  if (tierEntries.length) {
    const selectedEntries = new Map(summary.tiers.filter(t => t.realismDraw?.entry).map(t => [t.tier, t.realismDraw.entry]));
    const fallbackDraws = resolveSeasonDraw({ tierSeedRaces: tierEntries.filter(t => !selectedEntries.has(t.tier)) });
    const draws = [...fallbackDraws, ...[...selectedEntries.values()].map(entry => ({ entry }))];
    const realism = scoreSeason(draws.map((d) => d.entry));
    for (const missing of realism.unassessed) blocking.push(`realisme kunne ikke vurderes: ${missing}`);
    for (const f of realism.failures) blocking.push(`realisme-bånd — ${f}`);
    for (const t of realism.tiers) {
      const s = t.score, tgt = TIER_TARGETS[t.tier] ?? {};
      if (tgt.summit_min != null) severity += Math.max(0, tgt.summit_min - s.summit_finishes);
      if (tgt.mdown_max_pct != null) severity += Math.max(0, s.mdown_pct - tgt.mdown_max_pct) / 5;
      if (tgt.itt_min != null) severity += Math.max(0, tgt.itt_min - s.standalone_itt) * 3;
      if (tgt.cobbles_min != null) severity += Math.max(0, tgt.cobbles_min - s.cobbles_in_stagerace) * 3;
      // #3469 finale-gulve — samme afstands-princip som ovenstående.
      if (tgt.bunch_sprint_min != null) severity += Math.max(0, tgt.bunch_sprint_min - s.bunch_sprint_stage_days);
      if (tgt.descent_finale_min != null) severity += Math.max(0, tgt.descent_finale_min - s.descent_finale_stage_days);
      if (tgt.solo_tt_final_min != null) severity += Math.max(0, tgt.solo_tt_final_min - s.solo_tt_final_races) * 3;
    }
  } else {
    blocking.push("ingen tier leverede et løbssæt at score realisme på");
    severity += 100;
  }
  severity += blocking.filter((b) => !b.startsWith("realisme-bånd")).length * 10;

  const season = aggregateCompositionStats(
    summary.tiers.map((t) => t.compositionStats).filter((s) => s && s.raceDays > 0)
  );
  const { rows, violations } = detectCompositionViolations({ stats: season, target: ACTIVE_TARGET, label: "sæson" });
  compositionDrift.push(...violations);

  return { blocking, compositionDrift, tierCompositionDrift, severity, report: { season, rows } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// #5405 — HVORNÅR MÅ EN SÆSONS KALENDER SKRIVES? (ejer-beslutning 19/9)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Den gamle regel (CALENDAR_RULES.md §2c, ejer 30/8: "To regenereringer er forbudt")
// gav ÉN regenerering pr. sæson og var ikke håndhævet nogen steder — §2c's egen advarsel
// sagde det ligeud. Ejeren erstattede den 19/9, ordret:
//
//   "Ja den må gerne laves inden og den må gerne laves om, hvis den ikke er korrekt.
//    Vi skal lave en ordentlig kalender, ikke blot en kalender."
//
// Den nye regel er en TILSTANDS-regel i stedet for en tæller, og det er netop dét der gør
// den håndhævbar uden et nyt felt: en sæsons kalender må skrives og omskrives frit så længe
// sæsonen er `upcoming`, og er låst fra det øjeblik den bliver `active`. Der er derfor
// hverken en `calendar_generation_count`-kolonne eller en migration i #5405 — sandheden
// står allerede i `seasons.status`, og en tæller ville kunne komme i utakt med den.
//
// FAIL-CLOSED er bevidst: alt der ikke er PRÆCIS `upcoming` nægtes, også en ukendt/tom
// status og en sæson der slet ikke findes. En gate der gætter "det er nok en ny sæson" er
// præcis 27/6-blitzens fejlklasse.
//
// Begge funktioner nedenfor er RENE — ingen DB, ingen tid, ingen proces. Kalderen
// (scripts/buildSeasonCalendar.js) laver I/O'et og forbliver den eneste der skriver.
//
// SKRIVE-GATEN RETURNERER EN KODE, IKKE EN SÆTNING. Den operatør-vendte danske tekst bor
// i CLI'ens `describeSeasonCalendarWriteGate` (scripts/buildSeasonCalendar.js). To grunde:
// `backend/lib/**` er dækket af i18n-ratchet'en (#1068) og må ikke bære rå dansk prosa i
// felter som `reason`, OG en kode er dét kalderen skal forgrene på — en sætning er ikke en
// kontrakt. Erstatnings-gatens `blocking`-linjer er derimod dansk i denne fil, præcis som
// `gatePlan`s ovenfor: de er én sammenhængende liste operatøren læser rå.

/** Den ENESTE sæson-status hvor en kalender må skrives eller omskrives (§2c, ejer 19/9). */
export const CALENDAR_WRITABLE_SEASON_STATUS = "upcoming";

/** Statusser hvor kalenderen er LÅST. Alt uden for listen nægtes også — se fail-closed. */
export const CALENDAR_LOCKED_SEASON_STATUSES = Object.freeze(["active", "completed"]);

/**
 * Må der skrives en kalender til denne sæson? Ren funktion af sæson-rækken.
 *
 * @param {{seasonRow?: {status?: unknown}|null}} args
 *   `seasonRow` er `seasons`-rækken som den står i DB (null/udeladt = findes ikke).
 * @returns {{allowed: boolean, code: string, status: string|null}}
 *   code: "upcoming" | "season_active" | "season_completed" | "status_unknown" | "season_missing"
 *   Teksten til et menneske: `describeSeasonCalendarWriteGate` i CLI'en.
 */
export function evaluateSeasonCalendarWriteGate({ seasonRow = null } = {}) {
  if (seasonRow == null) return { allowed: false, code: "season_missing", status: null };

  // Normalisér defensivt: en status kan komme som null, som tal fra en fremtidig ændring,
  // eller med whitespace fra en manuel SQL-rettelse. Alt der ikke normaliserer til en
  // kendt værdi er "ukendt" og nægtes — ikke "sandsynligvis ok".
  const raw = seasonRow.status;
  const status = typeof raw === "string" ? raw.trim().toLowerCase() : null;

  if (status === CALENDAR_WRITABLE_SEASON_STATUS) return { allowed: true, code: "upcoming", status };
  if (status === "active") return { allowed: false, code: "season_active", status };
  if (status === "completed") return { allowed: false, code: "season_completed", status };
  return { allowed: false, code: "status_unknown", status };
}

/**
 * FK-afhængigheder af `races.id`, grupperet efter hvad en ren erstatning må gøre ved dem.
 *
 * Katalogen er afledt af `database/schema-snapshot.json`s `foreignKeys`-sektion — den
 * gættes ikke. `seasonCalendarGate.test.js` kryds-tjekker at HVER FK→races i snapshotten
 * står her, så en ny tabel ikke kan opstå uden for porten (forward-guard). Rækkefølgen er
 * også slette-rækkefølgen: børn først, mest følsomme sidst.
 *
 * Grupper:
 *   "calendar" — ER kalenderen. Slettes sammen med løbene ved en erstatning.
 *   "gameplay" — spillerdata. Én ikke-nul række STOPPER erstatningen. En `upcoming` sæson
 *                bør have 0 i alle: motorerne slår sæsonen op som `status='active'` og ser
 *                den slet ikke (docs/audits/2026-09-19-5405-s4-kalender-synlig.md §3).
 *                Ser vi alligevel rækker her, er en antagelse brudt — og så er sletning
 *                ikke en oprydning, den er et datatab.
 *   "ui"       — ren seen-state uden spilbetydning. Nulles, gater ikke.
 *
 * `race_notify_outbox` (#3624, 18/9) er NYERE end snapshotten og står derfor eksplicit her:
 * dens FK er `ON DELETE CASCADE`, så en sletning ville fjerne ventende udgående beskeder
 * TAVST. Netop derfor er den en gate-tabel, ikke en cascade vi stoler på.
 */
export const RACE_DEPENDENCY_TABLES = Object.freeze([
  // ── Kalender-form: dét erstatningen er sat i verden for at udskifte ──
  { table: "race_stage_schedule", column: "race_id", group: "calendar" },
  { table: "race_stage_profiles", column: "race_id", group: "calendar" },

  // ── Gameplay-port: ikke-nul ⇒ erstatningen nægtes ──
  { table: "race_stage_claims", column: "race_id", group: "gameplay" },
  { table: "race_stage_roles", column: "race_id", group: "gameplay" },
  { table: "race_stage_passages", column: "race_id", group: "gameplay" },
  { table: "race_stage_moments", column: "race_id", group: "gameplay" },
  { table: "race_stage_timelines", column: "race_id", group: "gameplay" },
  { table: "race_simulation_runs", column: "race_id", group: "gameplay" },
  { table: "race_incidents", column: "race_id", group: "gameplay" },
  { table: "race_withdrawals", column: "race_id", group: "gameplay" },
  { table: "race_entry_clears", column: "race_id", group: "gameplay" },
  { table: "race_entries", column: "race_id", group: "gameplay" },
  { table: "race_team_orders", column: "race_id", group: "gameplay" },
  { table: "pending_race_results", column: "race_id", group: "gameplay" },
  { table: "race_results", column: "race_id", group: "gameplay" },
  { table: "race_notify_outbox", column: "race_id", group: "gameplay" },
  { table: "board_satisfaction_events", column: "race_id", group: "gameplay" },
  { table: "rider_career_events", column: "race_id", group: "gameplay" },
  { table: "rider_reputation_events", column: "race_id", group: "gameplay" },
  { table: "rider_peak_plans", column: "target_race_id", group: "gameplay" },
  { table: "finance_transactions", column: "race_id", group: "gameplay" },

  // ── Ren UI-seen-state: nulles, gater ikke ──
  { table: "teams", column: "my_result_seen_race_id", group: "ui" },
]);

/** Nøglen en tælling slås op på. Tabel+kolonne, fordi rider_peak_plans bruger target_race_id. */
export function dependencyKey({ table, column }) {
  return `${table}.${column}`;
}

/**
 * Må sæsonens EKSISTERENDE løb erstattes rent? Ren funktion af de målte tællinger.
 *
 * Kald den FØRST når `evaluateSeasonCalendarWriteGate` har sagt ja — den her tager ikke
 * stilling til sæsonens status, kun til om en erstatning ville miste data.
 *
 * @param {{existingRaceCount?: number, dependentCounts?: Record<string, number>}} args
 *   `dependentCounts` slås op med `dependencyKey` ("race_entries.race_id", ...).
 * @returns {{mode: "fresh"|"replace"|"denied", blocking: string[], rows: Array<{table,column,group,count}>}}
 *   "fresh"   ingen eksisterende løb — der er intet at erstatte, materialisér direkte
 *   "replace" erstatning er sikker: 0 gameplay-rækker
 *   "denied"  der findes rækker der ville gå tabt eller blive forældreløse
 */
export function evaluateCalendarReplacementGate({ existingRaceCount = 0, dependentCounts = {} } = {}) {
  const rows = RACE_DEPENDENCY_TABLES.map((d) => ({
    ...d, count: dependentCounts[dependencyKey(d)],
  }));

  if (!Number.isFinite(existingRaceCount) || existingRaceCount < 0) {
    return {
      mode: "denied", rows,
      blocking: ["antallet af eksisterende løb kunne ikke måles — erstatningen nægtes fail-closed"],
    };
  }
  if (existingRaceCount === 0) return { mode: "fresh", blocking: [], rows };

  const blocking = [];
  for (const r of rows) {
    if (r.group !== "gameplay") continue;
    // En tælling der mangler er IKKE det samme som nul. Et navnefejl i katalogen, en
    // afvist RLS-læsning eller en tabel der er blevet omdøbt ville ellers kunne se ud
    // som "ingen data at miste" — det er den dyreste form for stilhed.
    if (!Number.isFinite(r.count)) {
      blocking.push(`${dependencyKey(r)}: kunne ikke måles (${String(r.count)}) — erstatningen nægtes fail-closed`);
      continue;
    }
    if (r.count > 0) {
      blocking.push(`${dependencyKey(r)}: ${r.count} række(r) peger på sæsonens løb og ville gå tabt eller blive forældreløse`);
    }
  }

  if (blocking.length) return { mode: "denied", blocking, rows };
  return { mode: "replace", blocking: [], rows };
}
