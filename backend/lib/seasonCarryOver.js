/**
 * #2916 — Carry-over-kontrakt for managerens egen opsætning ved sæsonskifte
 * =========================================================================
 *
 * PROBLEMET (målt i prod 2026-07-25): fem ting som manageren selv har
 * konfigureret forsvinder eller bliver ugyldige ved skiftet, og der fandtes
 * INGEN fælles mekanik — hver ting skulle huskes i drejebogen, og fire af de
 * fem stod der slet ikke.
 *
 * Værst er `training_plans`: tabellen er sæson-scoped (UNIQUE på
 * team_id+rider_id+season_id), så en plan lagt i sæson N findes ikke i sæson
 * N+1. Træningsmotoren STOPPER ikke når planen mangler — `resolveProgram(null,
 * primary_type)` i dailyTraining.js vælger tavst et auto-program ud fra
 * ryttertypen. Managerens bevidste valg bliver altså ikke sat på pause, det
 * bliver overskrevet, hver dag, uden en eneste besked.
 *
 * KONTRAKTEN
 * ----------
 * `MANAGER_SETUP_REGISTRY` er den eksplicitte, checkede liste over hvad der sker
 * med hver manager-opsætnings-flade ved et skifte. Hver flade har præcis én
 * disposition:
 *
 *   COPY              — rækkerne kopieres til den nye sæson (idempotent).
 *   REVALIDATE        — rækkerne findes allerede i den nye sæson, men kan pege
 *                       på noget der ikke længere er gyldigt (fx et løb i en
 *                       pulje holdet ikke længere ligger i). Vi TÆLLER og
 *                       rapporterer; vi sletter aldrig managerens data.
 *   PERSISTS          — tabellen er ikke sæson-scoped; den overlever af sig selv.
 *   RESET_BY_DESIGN   — nulstilling er den ønskede spilmekanik (ejer-design).
 *   NOT_MANAGER_SETUP — motor-output/ledger; manageren har ikke konfigureret det.
 *
 * FORWARD-GUARD (så listen ikke skal huskes næste gang)
 * ----------------------------------------------------
 * 1. Test-tid (hård): `seasonCarryOverRegistry.test.js` scanner ALLE
 *    `database/*.sql`-migrationer for `CREATE TABLE`-kroppe der har både
 *    `season_id` og `team_id`/`rider_id`. Enhver sådan tabel SKAL stå i
 *    registret med en eksplicit disposition, ellers fejler testen (og dermed
 *    CI). En ny manager-opsætnings-tabel kan altså ikke lande uden at nogen
 *    aktivt tager stilling til hvad der sker med den ved sæsonskifte.
 * 2. Kørsels-tid (blød): fasen tjekker at hver COPY/REVALIDATE-flade har en
 *    implementeret handler og omvendt, og alarmerer (log + Sentry) hvis en
 *    COPY-flade havde kilde-rækker men hverken kopierede eller genkendte
 *    eksisterende. Runtime-alarmen KASTER ikke — en carry-over-fejl må aldrig
 *    vælte selve sæsonskiftet (samme additiv-isolerede disciplin som
 *    contract_expiry_release/global_rank_decay i seasonTransition.js).
 *
 * Bevidst IKKE her: sletning, reparation eller omskrivning af managerens data.
 * Fasen er ren tilføjelse (COPY) eller ren optælling (REVALIDATE).
 *
 * OPFØLGNING (2026-08-05, bredere audit af #2916 før S2→S3-skiftet 23/8):
 * `team_race_strategy` blev ikke fanget af forward-guard-scanneren dengang —
 * tabellen har ingen `season_id`-kolonne, så den matcher ikke scannerens
 * "sæson-scoped ejer-tabel"-mønster. Men `target_race_ids`-feltet INDEHOLDER
 * sæson-scopede værdier (race_id'er), og disse går lige så lydløst i stykker
 * som `rider_peak_plans.target_race_id`. Scanneren finder stadig kun tabeller
 * hvor season_id er en KOLONNE — en tabel med sæson-scopede JSONB-referencer
 * er fortsat et manuelt audit-punkt, ikke noget CI fanger automatisk.
 */

import { applyHumanTeamFilter } from "./humanTeamFilter.js";
import { fetchAllRows } from "./supabasePagination.js";
import { captureException } from "./sentry.js";

export const CARRY_OVER_DISPOSITION = Object.freeze({
  COPY: "copy",
  REVALIDATE: "revalidate",
  PERSISTS: "persists",
  RESET_BY_DESIGN: "reset_by_design",
  NOT_MANAGER_SETUP: "not_manager_setup",
});

/**
 * Den eksplicitte carry-over-kontrakt. `table` er tabelnavnet i public-skemaet.
 * `why` er den begrundelse en fremtidig læser (eller en agent midt om natten)
 * skal kunne stole på uden at grave i git-historikken.
 */
export const MANAGER_SETUP_REGISTRY = Object.freeze([
  // ── Manager-opsætning der skal bæres over ────────────────────────────────
  {
    table: "training_plans",
    disposition: CARRY_OVER_DISPOSITION.COPY,
    why: "Sæson-scoped manager-valg (fokus + intensitet pr. rytter). Uden kopi vælger dailyTraining.resolveProgram tavst et auto-program pr. ryttertype — planen sættes ikke på pause, den overskrives.",
  },
  {
    table: "training_week_plans",
    disposition: CARRY_OVER_DISPOSITION.PERSISTS,
    why: "Ugerytmen er team/rider-scoped UDEN season_id (unique på team_id [+ rider_id]) og overlever skiftet af sig selv. Med i registret så nogen ikke 'fikser' den ved at tilføje season_id uden at tilføje en COPY-handler.",
  },
  {
    table: "rider_peak_plans",
    disposition: CARRY_OVER_DISPOSITION.REVALIDATE,
    why: "Managere lægger peak-planer på den KOMMENDE sæsons løb, så rækkerne findes allerede. Risikoen er at op-/nedrykning flytter holdet til en anden pulje, hvorefter mål-løbet ikke er i holdets kalender — og motoren fejler lydløst. Vi tæller dem; sletning er ejer-gated.",
  },
  {
    table: "race_entries",
    disposition: CARRY_OVER_DISPOSITION.REVALIDATE,
    why: "Manuelle udtagelser (is_auto_filled=false) på den kommende sæsons løb bliver ugyldige hvis holdet flytter pulje. Ikke sæson-scoped i skemaet (kun via races.season_id), derfor eksplicit her.",
  },
  {
    table: "sponsor_contracts",
    disposition: CARRY_OVER_DISPOSITION.RESET_BY_DESIGN,
    why: "Sponsorvalget er et bevidst valg pr. sæson. Motoren har allerede en eksplicit fase (expireAndRenewContracts): matchende pending-kontrakt aktiveres, ellers default-fornyes med 'safe' (#2914). Ingen carry-over her — ændring af default-varianten er en økonomi-beslutning, ikke en carry-over-bug.",
  },
  {
    table: "board_profiles",
    disposition: CARRY_OVER_DISPOSITION.RESET_BY_DESIGN,
    why: "Bestyrelsesplanen forhandles på ny hver sæson (negotiation_status → pending). Det ER spilmekanikken, ikke et tab af opsætning.",
  },
  {
    table: "board_mandates",
    disposition: CARRY_OVER_DISPOSITION.RESET_BY_DESIGN,
    why: "#3514 'Mandatet': mandatet ER 1-årigt og forhandles forfra på årsmødet ved hvert sæsonskifte. En kopi til den nye sæson ville netop fjerne det årsmøde spillet er bygget om for at få. Selve relationen (board_relations.confidence) og visionen (board_vision_milestones) er IKKE sæson-scopede og overlever af sig selv, så manageren mister ingen historik. Tabellen er tom og ulæst indtil kill-switchen board_mandate_model_enabled flippes.",
  },
  {
    table: "team_race_strategy",
    disposition: CARRY_OVER_DISPOSITION.REVALIDATE,
    why: "Ikke sæson-scoped i skemaet (PK=team_id), så a_chain/captain_priorities overlever skiftet af sig selv og roster-filtreres allerede ved læsning (raceStrategy.normalizeStrategy filtrerer mod rosterIds). Men target_race_ids peger på konkrete race_id'er, som ER sæson-scoped — raceEntryGenerator's isTargetRace-tjek matcher aldrig et race_id fra en afsluttet sæson, så holdets 'prioritér dette løb'-valg forsvinder lydløst uden fejl (samme mønster som rider_peak_plans, blot i en tabel scanneren ikke fanger fordi den mangler season_id). Verificeret i prod 2026-08-05: 44 af 115 target_race_ids-referencer peger allerede på S1-løb efter S1→S2-skiftet 27/7. Vi tæller; sletning er ejer-gated.",
  },
  {
    table: "team_rider_role_rules",
    disposition: CARRY_OVER_DISPOSITION.PERSISTS,
    why: "Faste rytter-rolle-regler (always_captain m.fl.) er team+rider-scoped UDEN season_id og overlever skiftet af sig selv. Konsumeres kun via raceStrategy.normalizeStrategy, som allerede filtrerer mod rosterIds — en afgået rytters regel forsvinder automatisk ved læsning, uafhængigt af sæsonskiftet. Med i registret så nogen ikke fejlagtigt tilføjer season_id uden en COPY-handler.",
  },

  // ── Motor-output / ledgere (ingen manager-opsætning) ──────────────────────
  {
    table: "academy_graduation",
    disposition: CARRY_OVER_DISPOSITION.NOT_MANAGER_SETUP,
    why: "Motor-output fra akademiet — hvem der dimitterede en given sæson. Manageren konfigurerer intet her.",
  },
  {
    table: "academy_intake",
    disposition: CARRY_OVER_DISPOSITION.NOT_MANAGER_SETUP,
    why: "Motor-genereret optag pr. sæson. Nyt optag hører til den nye sæson; en kopi af det gamle ville være forkert data.",
  },
  {
    table: "academy_season_intake_runs",
    disposition: CARRY_OVER_DISPOSITION.NOT_MANAGER_SETUP,
    why: "Idempotens-claim for sæson-optagelsen (#2911): én række pr. (hold, sæson) der beviser at optagelsen allerede er kørt. Manageren konfigurerer intet her, og en carry-over ville være direkte skadelig — en kopieret claim ville få den nye sæsons optagelse til at springe holdet over.",
  },
  {
    table: "board_plan_snapshots",
    disposition: CARRY_OVER_DISPOSITION.NOT_MANAGER_SETUP,
    why: "Historik-snapshot af en afsluttet bestyrelsesplan. Skrivebeskyttet efterslæb, ikke en indstilling.",
  },
  {
    table: "board_request_log",
    disposition: CARRY_OVER_DISPOSITION.NOT_MANAGER_SETUP,
    why: "Append-only log over bestyrelses-forespørgsler. Historik, ikke en indstilling der kan bæres over.",
  },
  {
    table: "board_satisfaction_events",
    disposition: CARRY_OVER_DISPOSITION.NOT_MANAGER_SETUP,
    why: "Append-only event-log for bestyrelsens tilfredshed. Historik, ikke en indstilling.",
  },
  {
    table: "finance_transactions",
    disposition: CARRY_OVER_DISPOSITION.NOT_MANAGER_SETUP,
    why: "Økonomi-ledger. Append-only regnskab pr. sæson — må aldrig kopieres mellem sæsoner.",
  },
  {
    table: "global_rank_season_start_snapshot",
    disposition: CARRY_OVER_DISPOSITION.NOT_MANAGER_SETUP,
    why: "Motor-snapshot til global rank-rollover, skrevet af apply_global_rank_season_rollover. Ikke manager-input.",
  },
  {
    table: "rider_development_log",
    disposition: CARRY_OVER_DISPOSITION.NOT_MANAGER_SETUP,
    why: "Append-only udviklings-log pr. rytter. Historik over hvad motoren gjorde, ikke en indstilling.",
  },
  {
    table: "scout_actions",
    disposition: CARRY_OVER_DISPOSITION.NOT_MANAGER_SETUP,
    why: "Rapport-ledger for allerede udførte spejder-handlinger. Forbrugte handlinger, ikke en opsætning der kan gentages i den nye sæson.",
  },
  {
    table: "scout_assignments",
    disposition: CARRY_OVER_DISPOSITION.NOT_MANAGER_SETUP,
    why: "Spejder-JOBS er igangværende opgaver med started_on/ready_on-datoer, ikke en sæson-opsætning der skal genskabes. Aktive jobs løber videre på tværs af skiftet (ingen season-gate i sweep'en).",
  },
  {
    table: "season_standings",
    disposition: CARRY_OVER_DISPOSITION.NOT_MANAGER_SETUP,
    why: "Motor-beregnet stilling pr. sæson. Nulstilles korrekt af sig selv fordi den nye sæson starter uden resultater.",
  },
  {
    table: "season_documentaries",
    disposition: CARRY_OVER_DISPOSITION.NOT_MANAGER_SETUP,
    why: "#3402: genereret narrativ-cache pr. (season_id, team_id), skrevet ÉN gang af backend/lib/seasonDocumentarySweep.js efter sæsonslut. Samme skema som academy_season_intake_runs — manageren konfigurerer intet her, og en carry-over ville være direkte skadelig: en kopieret dokumentar ville fortælle den GAMLE sæsons historie under den NYE sæsons overskrift. Den nye sæson starter korrekt tom (ingen række) og sweepen fylder den op efter NÆSTE sæsonslut.",
  },
]);

/** Tabeller registret kender, som et Set. */
export function registryTables() {
  return new Set(MANAGER_SETUP_REGISTRY.map((entry) => entry.table));
}

/**
 * Forward-guard-kernen: hvilke af `candidateTables` mangler en eksplicit
 * disposition? Bruges af `seasonCarryOverRegistry.test.js` (hård CI-fejl).
 *
 * @param {Iterable<string>} candidateTables
 * @returns {string[]} sorterede tabelnavne uden klassifikation
 */
export function unclassifiedTables(candidateTables) {
  const known = registryTables();
  return [...new Set(candidateTables)].filter((t) => !known.has(t)).sort();
}

// ─── Interne loaders ──────────────────────────────────────────────────────────

// Antal team-id'er pr. `.in()`-kald. PostgREST sender filteret i URL'en, så en
// uafkortet liste på 90+ UUID'er (≈3,5 kB) er unødigt tæt på grænsen. 40 giver
// ≈1,5 kB pr. kald og 3 kald ved dagens 93 hold.
const TEAM_ID_CHUNK = 40;

// Rækker pr. insert. Holder request-body under et par hundrede kB ved 1.700+
// rækker og giver delvis fremdrift hvis ét chunk fejler.
const INSERT_CHUNK = 500;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function loadHumanTeams(supabase) {
  return fetchAllRows(() =>
    applyHumanTeamFilter(
      supabase.from("teams").select("id, league_division_id")
    ).order("id", { ascending: true })
  );
}

async function loadRidersForTeams(supabase, teamIds) {
  const rows = [];
  for (const ids of chunk(teamIds, TEAM_ID_CHUNK)) {
    const page = await fetchAllRows(() =>
      supabase
        .from("riders")
        .select("id, team_id, is_retired")
        .in("team_id", ids)
        .order("id", { ascending: true })
    );
    rows.push(...page);
  }
  return rows;
}

// ─── Flade 1: training_plans (COPY) ───────────────────────────────────────────

/**
 * Kopiér sidste sæsons træningsplaner til den nye sæson for de ryttere der
 * FAKTISK stadig er på holdet. Idempotent på tre niveauer: vi springer rækker
 * over der allerede findes i mål-sæsonen, upsert'er med ignoreDuplicates mod
 * UNIQUE(team_id, rider_id, season_id), og skriver aldrig til andet end
 * mål-sæsonen.
 *
 * @returns {Promise<object>} stats
 */
export async function carryTrainingPlans({
  supabase,
  fromSeasonId,
  toSeasonId,
  dryRun = false,
  humanTeams = null,
  ridersByTeam = null,
}) {
  const teams = humanTeams ?? (await loadHumanTeams(supabase));
  const humanTeamIds = new Set(teams.map((t) => t.id));

  const source = await fetchAllRows(() =>
    supabase
      .from("training_plans")
      .select("team_id, rider_id, focus, intensity")
      .eq("season_id", fromSeasonId)
      .order("id", { ascending: true })
  );

  const existing = await fetchAllRows(() =>
    supabase
      .from("training_plans")
      .select("team_id, rider_id")
      .eq("season_id", toSeasonId)
      .order("id", { ascending: true })
  );
  const existingKeys = new Set(existing.map((r) => `${r.team_id}|${r.rider_id}`));

  const riders =
    ridersByTeam ?? (await loadRidersForTeams(supabase, [...humanTeamIds]));
  const riderById = new Map(riders.map((r) => [r.id, r]));

  const stats = {
    source_rows: source.length,
    skipped_non_human_team: 0,
    skipped_rider_left_team: 0,
    skipped_rider_retired: 0,
    skipped_already_present: 0,
    eligible: 0,
    carried: 0,
    teams: 0,
  };

  const rows = [];
  const teamsWithCarry = new Set();
  for (const plan of source) {
    if (!humanTeamIds.has(plan.team_id)) {
      stats.skipped_non_human_team += 1;
      continue;
    }
    const rider = riderById.get(plan.rider_id);
    if (!rider || rider.team_id !== plan.team_id) {
      // Rytteren er solgt, frigivet ved kontraktudløb eller aldrig på holdet.
      stats.skipped_rider_left_team += 1;
      continue;
    }
    if (rider.is_retired === true) {
      stats.skipped_rider_retired += 1;
      continue;
    }
    if (existingKeys.has(`${plan.team_id}|${plan.rider_id}`)) {
      stats.skipped_already_present += 1;
      continue;
    }
    stats.eligible += 1;
    teamsWithCarry.add(plan.team_id);
    rows.push({
      team_id: plan.team_id,
      rider_id: plan.rider_id,
      season_id: toSeasonId,
      focus: plan.focus,
      intensity: plan.intensity,
    });
  }
  stats.teams = teamsWithCarry.size;

  if (dryRun || rows.length === 0) {
    return { ...stats, dry_run: dryRun };
  }

  for (const part of chunk(rows, INSERT_CHUNK)) {
    // Idempotensen har to lag:
    //   1. Pre-filtret ovenfor (existingKeys) fjerner rækker der allerede findes
    //      i mål-sæsonen — det er laget der gør en SEKVENTIEL gentagelse gratis.
    //   2. onConflict + ignoreDuplicates → PostgREST sender
    //      `Prefer: resolution=ignore-duplicates` = ON CONFLICT DO NOTHING mod
    //      UNIQUE(team_id, rider_id, season_id) (training_plans_team_rider_season_uniq).
    //      Det er laget der gør en SAMTIDIG gentagelse sikker — vinduet mellem
    //      læsningen af existingKeys og dette kald er dækket af databasen, ikke
    //      af os.
    // `.select("rider_id")` returnerer KUN de rækker der faktisk blev indsat, så
    // `carried` ikke over-rapporterer i race-tilfældet (2. lag). Det tal er det
    // ejeren aflæser som bevis for at fasen virkede — det skal være sandt.
    const { data, error } = await supabase
      .from("training_plans")
      .upsert(part, {
        onConflict: "team_id,rider_id,season_id",
        ignoreDuplicates: true,
      })
      .select("rider_id");
    if (error) {
      // Delvis fremdrift bevares og rapporteres — samme partial-stats-disciplin
      // som releaseExpiredContractRiders (#2744-B).
      const err = new Error(`training_plans carry-over failed: ${error.message}`);
      err.partialStats = { ...stats };
      throw err;
    }
    stats.carried += (data || []).length;
  }

  return { ...stats, dry_run: false };
}

// ─── Flade 2: rider_peak_plans (REVALIDATE) ───────────────────────────────────

/**
 * Tæl peak-planer i den NYE sæson hvis mål-løb ikke længere kan nås af holdet.
 * Rører intet — sletning/flytning af managerens plan er ejer-gated.
 */
export async function revalidatePeakPlans({
  supabase,
  toSeasonId,
  humanTeams = null,
  ridersByTeam = null,
}) {
  const teams = humanTeams ?? (await loadHumanTeams(supabase));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const plans = await fetchAllRows(() =>
    supabase
      .from("rider_peak_plans")
      .select("id, rider_id, target_race_id")
      .eq("season_id", toSeasonId)
      .order("id", { ascending: true })
  );
  if (plans.length === 0) {
    return { checked: 0, missing_target: 0, wrong_pool: 0, teams_affected: 0 };
  }

  const races = await fetchAllRows(() =>
    supabase
      .from("races")
      .select("id, league_division_id")
      .eq("season_id", toSeasonId)
      .order("id", { ascending: true })
  );
  const raceById = new Map(races.map((r) => [r.id, r]));

  const riders =
    ridersByTeam ?? (await loadRidersForTeams(supabase, [...teamById.keys()]));
  const riderById = new Map(riders.map((r) => [r.id, r]));

  const stats = { checked: 0, missing_target: 0, wrong_pool: 0, teams_affected: 0 };
  const affected = new Set();
  for (const plan of plans) {
    const rider = riderById.get(plan.rider_id);
    const team = rider ? teamById.get(rider.team_id) : null;
    if (!team) continue; // rytteren er ikke længere på et menneskehold
    stats.checked += 1;
    const race = plan.target_race_id ? raceById.get(plan.target_race_id) : null;
    if (!race) {
      stats.missing_target += 1;
      affected.add(team.id);
      continue;
    }
    if (
      race.league_division_id != null &&
      team.league_division_id != null &&
      race.league_division_id !== team.league_division_id
    ) {
      stats.wrong_pool += 1;
      affected.add(team.id);
    }
  }
  stats.teams_affected = affected.size;
  return stats;
}

// ─── Flade 3: race_entries (REVALIDATE) ───────────────────────────────────────

/**
 * Tæl manuelle udtagelser på den nye sæsons løb der ligger i en anden pulje end
 * holdets. Rører intet.
 */
export async function revalidateManualRaceEntries({
  supabase,
  toSeasonId,
  humanTeams = null,
}) {
  const teams = humanTeams ?? (await loadHumanTeams(supabase));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const entries = await fetchAllRows(() =>
    supabase
      .from("race_entries")
      .select("race_id, rider_id, team_id, race:race_id!inner(season_id, league_division_id)")
      .eq("is_auto_filled", false)
      .eq("race.season_id", toSeasonId)
      // race_entries har ingen id-kolonne; (race_id, rider_id) er den stabile
      // nøgle paginering kan sortere på (supabasePagination.js kræver en stabil
      // .order(), ellers kan sider overlappe eller springe rækker over).
      .order("race_id", { ascending: true })
      .order("rider_id", { ascending: true })
  );

  const stats = { checked: 0, wrong_pool: 0, teams_affected: 0 };
  const affected = new Set();
  for (const entry of entries) {
    const team = teamById.get(entry.team_id);
    if (!team) continue;
    stats.checked += 1;
    const poolId = entry.race?.league_division_id ?? null;
    if (
      poolId != null &&
      team.league_division_id != null &&
      poolId !== team.league_division_id
    ) {
      stats.wrong_pool += 1;
      affected.add(team.id);
    }
  }
  stats.teams_affected = affected.size;
  return stats;
}

// ─── Flade 4: team_race_strategy.target_race_ids (REVALIDATE) ─────────────────

/**
 * Tæl target_race_ids i team_race_strategy der peger på et race_id uden for
 * den nye sæson (stale_refs — dækker både "løb fra en afsluttet sæson" og
 * "løb slettet") eller i en anden pulje end holdet (wrong_pool_refs). Styrer
 * raceEntryGenerator.buildAutopickPreferences' isTargetRace-flag. Rører intet
 * — a_chain/captain_priorities/role_rules har intet behov for dette, de er
 * allerede roster-filtreret ved læsning (raceStrategy.normalizeStrategy).
 */
export async function revalidateTargetRaceIds({
  supabase,
  toSeasonId,
  humanTeams = null,
}) {
  const teams = humanTeams ?? (await loadHumanTeams(supabase));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const rows = await fetchAllRows(() =>
    supabase
      .from("team_race_strategy")
      .select("team_id, target_race_ids")
      .order("team_id", { ascending: true })
  );

  const races = await fetchAllRows(() =>
    supabase
      .from("races")
      .select("id, league_division_id")
      .eq("season_id", toSeasonId)
      .order("id", { ascending: true })
  );
  const raceById = new Map(races.map((r) => [r.id, r]));

  const stats = {
    checked_teams: 0,
    checked_refs: 0,
    stale_refs: 0,
    wrong_pool_refs: 0,
    teams_affected: 0,
  };
  const affected = new Set();
  for (const row of rows) {
    const team = teamById.get(row.team_id);
    if (!team) continue; // ikke et menneskehold
    const targetIds = Array.isArray(row.target_race_ids) ? row.target_race_ids : [];
    if (targetIds.length === 0) continue;
    stats.checked_teams += 1;
    for (const raceId of targetIds) {
      stats.checked_refs += 1;
      const race = raceById.get(raceId);
      if (!race) {
        stats.stale_refs += 1;
        affected.add(team.id);
        continue;
      }
      if (
        race.league_division_id != null &&
        team.league_division_id != null &&
        race.league_division_id !== team.league_division_id
      ) {
        stats.wrong_pool_refs += 1;
        affected.add(team.id);
      }
    }
  }
  stats.teams_affected = affected.size;
  return stats;
}

// ─── Orkestrering ─────────────────────────────────────────────────────────────

/** Hvilke registry-tabeller har en implementeret handler i denne fil? */
const IMPLEMENTED_HANDLERS = Object.freeze([
  "training_plans",
  "rider_peak_plans",
  "race_entries",
  "team_race_strategy",
]);

/**
 * Kørsels-tids-guard: hver COPY/REVALIDATE-flade SKAL have en handler, og hver
 * handler SKAL stå i registret. Returnerer en liste af afvigelser (tom = ok).
 */
export function findHandlerDrift() {
  const drift = [];
  const needsHandler = MANAGER_SETUP_REGISTRY.filter(
    (e) =>
      e.disposition === CARRY_OVER_DISPOSITION.COPY ||
      e.disposition === CARRY_OVER_DISPOSITION.REVALIDATE
  ).map((e) => e.table);

  for (const table of needsHandler) {
    if (!IMPLEMENTED_HANDLERS.includes(table)) {
      drift.push(`${table}: disposition kræver en handler, men ingen er implementeret`);
    }
  }
  const known = registryTables();
  for (const table of IMPLEMENTED_HANDLERS) {
    if (!known.has(table)) {
      drift.push(`${table}: handler implementeret, men tabellen står ikke i registret`);
    }
  }
  return drift;
}

/**
 * Kør hele carry-over-kontrakten for ét sæsonskifte.
 *
 * Fasen er ADDITIV og ISOLERET: den kopierer kun rækker ind i den nye sæson og
 * tæller resten. Den sletter, opdaterer eller flytter aldrig managerens data.
 * Kalderen (seasonTransition.js) fanger fejl, så et carry-over-problem ikke kan
 * vælte selve sæsonskiftet.
 *
 * @param {object}  args
 * @param {object}  args.supabase
 * @param {string}  args.fromSeasonId  sæsonen der lukkes
 * @param {string}  args.toSeasonId    sæsonen der åbnes
 * @param {boolean} [args.dryRun]      true = ingen writes, kun tal
 * @returns {Promise<object>}
 */
export async function carryOverManagerSetup({
  supabase,
  fromSeasonId,
  toSeasonId,
  dryRun = false,
}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!fromSeasonId) throw new Error("fromSeasonId required");
  if (!toSeasonId) throw new Error("toSeasonId required");

  const handlerDrift = findHandlerDrift();
  if (handlerDrift.length > 0) {
    // Højlydt, men ikke fatal: en manglende handler betyder at en flade lydløst
    // ville blive sprunget over — præcis fejlen #2916 handler om.
    console.error("❌ carry-over-registret er ude af sync med implementationen:", handlerDrift);
    captureException(new Error(`Carry-over handler drift: ${handlerDrift.join("; ")}`), {
      tags: { phase: "manager_setup_carry_over" },
      extra: { handlerDrift },
    });
  }

  // Ét fælles hold-load deles af alle fire flader (i stedet for fire
  // separate scans af de samme ~1.500 rækker).
  const humanTeams = await loadHumanTeams(supabase);
  const ridersByTeam = await loadRidersForTeams(
    supabase,
    humanTeams.map((t) => t.id)
  );

  const surfaces = {};

  surfaces.training_plans = await carryTrainingPlans({
    supabase,
    fromSeasonId,
    toSeasonId,
    dryRun,
    humanTeams,
    ridersByTeam,
  });

  surfaces.rider_peak_plans = await revalidatePeakPlans({
    supabase,
    toSeasonId,
    humanTeams,
    ridersByTeam,
  });

  surfaces.race_entries = await revalidateManualRaceEntries({
    supabase,
    toSeasonId,
    humanTeams,
  });

  surfaces.team_race_strategy = await revalidateTargetRaceIds({
    supabase,
    toSeasonId,
    humanTeams,
  });

  // Runtime-alarm: kilde-rækker fandtes, men INTET blev hverken kopieret eller
  // genkendt som allerede-til-stede → carry-over'en virkede ikke, og managerne
  // ville få auto-programmer uden at nogen opdagede det.
  const tp = surfaces.training_plans;
  const silentlyLost =
    tp.source_rows > 0 &&
    tp.carried === 0 &&
    tp.skipped_already_present === 0 &&
    tp.eligible > 0 &&
    !dryRun;
  if (silentlyLost) {
    console.error(
      `❌ carry-over: ${tp.eligible} træningsplaner var berettigede, men 0 blev kopieret`
    );
    captureException(new Error("Carry-over copied 0 eligible training plans"), {
      tags: { phase: "manager_setup_carry_over" },
      extra: { fromSeasonId, toSeasonId, stats: tp },
    });
  }

  return {
    dry_run: dryRun,
    human_teams: humanTeams.length,
    handler_drift: handlerDrift,
    surfaces,
    carried_total: tp.carried,
  };
}
