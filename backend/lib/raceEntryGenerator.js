// backend/lib/raceEntryGenerator.js
// Race Hub Fase 0b: proaktiv entry-generator. Kerne = kronologisk binding-bevidst
// tildeling: ét holds ryttere fordeles over puljens løb, så ingen rytter er i to
// tidsoverlappende løb. Deterministisk (autopick er deterministisk; løb sorteres
// stabilt på vindue-start, så race_id). Pure — ingen DB.

import { autopickTeamSelection, selectionSizeForRace } from "./raceAutopick.js";
import { windowsOverlap, raceBindingWindow } from "./raceBinding.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { raceTerrainBucket } from "./raceTerrain.js";
import { loadStrategiesForTeams } from "./raceStrategy.js";
import { applyRiderEligibilityFilter } from "./riderEligibility.js";

/**
 * @param {{ riders: Array<{rider_id, abilities, fatigue?}>,
 *           races: Array<{race_id, window:{start,end}, stages, sizeRule}>,
 *           lockedWindows?: Array<{window:{start,end}, riderIds:Array<string>}> }} args
 * @returns {Record<string, Array<{rider_id, race_role}>>} entries pr. race_id
 *
 * `lockedWindows` (valgfri, additiv): tidsvinduer hvor bestemte ryttere allerede er
 * bundet UDEN at vi genererer for dem — fx manager-udtagne (manuelle) løb. De
 * forbruger rytterens tid, så et overlappende auto-løb ikke dobbeltbooker rytteren,
 * men der skrives ingen picks for selve det låste løb. Tom default → uændret adfærd
 * for eksisterende kald.
 */
export function assignTeamAcrossRaces({ riders = [], races = [], lockedWindows = [], strategy = null }) {
  // Kronologisk, stabil rækkefølge: tidligste vindue først, så race_id.
  const ordered = [...races].sort(
    (a, b) => (a.window?.start ?? 0) - (b.window?.start ?? 0) || String(a.race_id).localeCompare(String(b.race_id))
  );
  // Optaget-liste pr. rytter: array af vinduer rytteren allerede er bundet i.
  const busy = new Map(); // rider_id → [{start,end}]
  // Seed med låste vinduer (manuelle entries): rytteren er optaget i det vindue.
  for (const lock of lockedWindows) {
    if (!lock?.window) continue;
    for (const rid of lock.riderIds || []) {
      if (!busy.has(rid)) busy.set(rid, []);
      busy.get(rid).push(lock.window);
    }
  }
  const out = {};

  for (const race of ordered) {
    const available = riders.filter((r) => {
      const windows = busy.get(r.rider_id) || [];
      return !windows.some((w) => windowsOverlap(w, race.window));
    });
    // S3: udled per-race preference fra team-niveau strategi. null → uændret autopick
    // (idempotens: strategy=null ≡ bit-for-bit gammel adfærd).
    const preference = strategy
      ? {
          aChain: strategy.aChain || [],
          captains: strategy.captainPriorities?.[raceTerrainBucket(race.stages)] || [],
          roleRules: strategy.roleRules || {},
          isTargetRace: !!strategy.targetRaceIds?.has(race.race_id),
        }
      : null;
    const picks = autopickTeamSelection({ riders: available, stages: race.stages, sizeRule: race.sizeRule, preference });
    out[race.race_id] = picks;
    for (const p of picks) {
      if (!busy.has(p.rider_id)) busy.set(p.rider_id, []);
      busy.get(p.rider_id).push(race.window);
    }
  }
  return out;
}

// PostgREST .in() encoder id-listen i URL'en — ved relaunch-skala (600-800 UUID'er)
// rammer det 414/proxy-grænser. Batch derfor alle id-opslag i bidder. (kopieret fra
// raceRunner.js, hvor den er modul-privat — #1307-review.)
const IN_CHUNK_SIZE = 200;
const PAGE_SIZE = 1000;
async function selectInChunks({ supabase, table, columns, inColumn, ids, extra = null, orderBy = null }) {
  const out = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
    // Range-paginer hver chunk: PostgREST's default 1000-rækkers cap trunkerer ellers
    // TAVST (fx race_entries: 168 hold × 6-8 ryttere ≫ 1000 rækker pr. løb-chunk) →
    // manglende manuelle entries blev overskrevet (captain-constraint-brud). Bidt 25/6.
    for (let from = 0; ; from += PAGE_SIZE) {
      let q = supabase.from(table).select(columns).in(inColumn, chunk);
      // #2375 (12/7): .range() UDEN ORDER BY er ustabil på tværs af side-queries —
      // Postgres garanterer ingen rækkefølge, så samme række kan dubleres/springes
      // over mellem sider. En dubleret rytter-række → autopick vælger ham to gange →
      // dublet (race_id, rider_id) i insert-batchen → race_entries_pkey-crash i prod.
      // Callers angiver en UNIK nøgle via orderBy; fallback = inColumn (grupperende —
      // bedre end ingen, men kun en unik nøgle giver hård stabilitets-garanti).
      for (const col of orderBy || [inColumn]) q = q.order(col);
      q = q.range(from, from + PAGE_SIZE - 1);
      if (extra) q = extra(q);
      const { data, error } = await q;
      if (error) return { data: null, error };
      out.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
    }
  }
  return { data: out, error: null };
}

/**
 * DB-orkestrator: for én sæson, fyld puljernes løb proaktivt med assistent-udtagne
 * hold. Idempotent + diff-baseret (#2375): indsætter kun manglende, sletter kun
 * forældede og rolle-opdaterer kun ændrede is_auto_filled=true-rækker; manuelle
 * entries (is_auto_filled=false) røres ALDRIG. Binding-bevidst (én rytter pr.
 * tidsvindue) via den rene kerne assignTeamAcrossRaces. Afmeldte hold
 * (race_withdrawals) springes over. Én (race,team)-enheds fejl aborterer ikke
 * resten — se failed_units/errors i resultatet.
 *
 * @param {{ supabase: object, seasonId: string, dryRun?: boolean }} args
 * @returns {Promise<{dryRun:boolean, races:number, teams:number, generated:number,
 *   skipped:number, inserted:number, removed:number, role_updated:number,
 *   failed_units:number, errors:Array<string>}>}
 */
export async function runRaceEntryGenerator({ supabase, seasonId, dryRun = true }) {
  // 1. Sæsonens løb.
  const { data: races, error: raceErr } = await supabase
    .from("races").select("id, race_class, league_division_id, stages_completed").eq("season_id", seasonId);
  if (raceErr) throw new Error(`races: ${raceErr.message}`);
  if (!races || !races.length) return { dryRun, races: 0, teams: 0, generated: 0, skipped: 0 };
  const raceIds = races.map((r) => r.id);
  // Frys (#1825): et igangværende etapeløb (stages_completed>0) må ALDRIG regenereres —
  // dets trup er låst midt i afviklingen. Vi springer det over for ALLE hold og låser
  // dets ryttere, så et overlappende ikke-startet løb ikke dobbeltbooker dem.
  const startedRaceIds = new Set((races || []).filter((r) => (r.stages_completed ?? 0) > 0).map((r) => r.id));

  // 2. Tidsvinduer pr. løb (fra race_stage_schedule). Løb uden vindue kan ikke binde.
  const { data: schedRows, error: schedErr } = await selectInChunks({
    supabase, table: "race_stage_schedule", columns: "race_id, scheduled_at",
    inColumn: "race_id", ids: raceIds, orderBy: ["race_id", "stage_number"], // PK → stabil paginering (#2375)
  });
  if (schedErr) throw new Error(`race_stage_schedule: ${schedErr.message}`);
  const schedByRace = new Map();
  for (const row of schedRows || []) {
    if (!schedByRace.has(row.race_id)) schedByRace.set(row.race_id, []);
    schedByRace.get(row.race_id).push(row);
  }
  // Binding-vindue (dag-granulært): én rytter pr. CET-dag. Instant-vinduer (raceTimeWindow)
  // fik to samme-dag-løb til ikke at overlappe → dobbeltbooking (#1823).
  const windowByRace = new Map();
  for (const id of raceIds) windowByRace.set(id, raceBindingWindow(schedByRace.get(id)));

  // 3. Etapeprofiler pr. løb (autopick scorer på dem), sorteret på stage_number.
  const { data: profileRows, error: profileErr } = await selectInChunks({
    supabase, table: "race_stage_profiles",
    columns: "race_id, stage_number, profile_type, finale_type, demand_vector",
    inColumn: "race_id", ids: raceIds, orderBy: ["race_id", "stage_number"], // unik nøgle → stabil paginering (#2375)
  });
  if (profileErr) throw new Error(`race_stage_profiles: ${profileErr.message}`);
  const stagesByRace = new Map();
  for (const row of profileRows || []) {
    if (!stagesByRace.has(row.race_id)) stagesByRace.set(row.race_id, []);
    stagesByRace.get(row.race_id).push(row);
  }
  for (const stages of stagesByRace.values()) stages.sort((a, b) => (a.stage_number || 0) - (b.stage_number || 0));

  // 4. Grupper løb pr. pulje (league_division_id; null = egen standalone-gruppe).
  // Kun løb med brugbart vindue indgår — løb uden vindue kan ikke binde.
  const usableRaces = races.filter((r) => windowByRace.get(r.id));
  const racesByPool = new Map();
  for (const r of usableRaces) {
    const key = r.league_division_id ?? null;
    if (!racesByPool.has(key)) racesByPool.set(key, []);
    racesByPool.get(key).push(r);
  }

  // 5. Egnede hold: ikke test-konto, ikke frosset. Grupper pr. pulje.
  const { data: allTeams, error: teamErr } = await supabase
    .from("teams").select("id, is_test_account, is_frozen, league_division_id")
    .or("is_test_account.is.null,is_test_account.eq.false");
  if (teamErr) throw new Error(`teams: ${teamErr.message}`);
  const eligibleTeams = (allTeams || []).filter((t) => !t.is_frozen);
  const teamsByPool = new Map();
  for (const t of eligibleTeams) {
    const key = t.league_division_id ?? null;
    if (!teamsByPool.has(key)) teamsByPool.set(key, []);
    teamsByPool.get(key).push(t);
  }

  // 6. Manuelle entries: (race,team) hvor manageren selv har udtaget — generér ALDRIG der.
  // Vi gemmer også rytter-id'erne, så manuelle løb forbruger rytterens tid og et
  // overlappende auto-løb ikke dobbeltbooker samme rytter (binding-bevidsthed).
  // Kun MANUELLE entries (is_auto_filled=false) — langt færre rækker end alle entries,
  // så vi undgår at hente ~200k auto-rækker bare for at finde de manuelle.
  const { data: manualRows, error: entryErr } = await selectInChunks({
    supabase, table: "race_entries", columns: "race_id, team_id, rider_id",
    inColumn: "race_id", ids: raceIds, orderBy: ["race_id", "rider_id"], // PK → stabil paginering (#2375)
    extra: (q) => q.eq("is_auto_filled", false),
  });
  if (entryErr) throw new Error(`race_entries (manual scan): ${entryErr.message}`);
  const manualByRaceTeam = new Set();
  const manualRidersByRaceTeam = new Map(); // "race|team" → [rider_id]
  for (const e of manualRows || []) {
    const key = `${e.race_id}|${e.team_id}`;
    manualByRaceTeam.add(key);
    if (!manualRidersByRaceTeam.has(key)) manualRidersByRaceTeam.set(key, []);
    manualRidersByRaceTeam.get(key).push(e.rider_id);
  }
  // Igangværende løbs entries (alle roller) → binding-lås. Kun de få startede løb.
  const startedRidersByRaceTeam = new Map(); // "race|team" → [rider_id]
  if (startedRaceIds.size) {
    const { data: startedRows, error: sErr } = await selectInChunks({
      supabase, table: "race_entries", columns: "race_id, team_id, rider_id",
      inColumn: "race_id", ids: [...startedRaceIds], orderBy: ["race_id", "rider_id"], // PK (#2375)
    });
    if (sErr) throw new Error(`race_entries (started lock): ${sErr.message}`);
    for (const e of startedRows || []) {
      const key = `${e.race_id}|${e.team_id}`;
      if (!startedRidersByRaceTeam.has(key)) startedRidersByRaceTeam.set(key, []);
      startedRidersByRaceTeam.get(key).push(e.rider_id);
    }
  }

  // 7. Afmeldinger pr. løb (race_withdrawals) — batched.
  const { data: wRows, error: wErr } = await selectInChunks({
    supabase, table: "race_withdrawals", columns: "race_id, team_id",
    inColumn: "race_id", ids: raceIds, orderBy: ["race_id", "team_id"], // PK → stabil paginering (#2375)
  });
  if (wErr) throw new Error(`race_withdrawals: ${wErr.message}`);
  const withdrawnByRace = new Map();
  for (const w of wRows || []) {
    if (!withdrawnByRace.has(w.race_id)) withdrawnByRace.set(w.race_id, new Set());
    withdrawnByRace.get(w.race_id).add(w.team_id);
  }

  // 8. Ryttere + abilities + fatigue for alle egnede hold (på tværs af puljer).
  const eligibleTeamIds = eligibleTeams.map((t) => t.id);
  const ridersByTeam = new Map();
  if (eligibleTeamIds.length) {
    const { data: riders, error: riderErr } = await selectInChunks({
      supabase, table: "riders", columns: "id, team_id", inColumn: "team_id",
      // Rod B: ét delt eligibility-filter (ikke-akademi + ikke-pensioneret). Tidligere
      // manglede is_academy her → akademiryttere blev auto-valgt (#1742/#1800).
      // orderBy id (PK): DENNE fetch var #2375-synderen — en 200-holds-chunk er langt
      // over 1000 rytter-rækker (flere sider), og uden ORDER BY kunne samme rytter
      // dubleres mellem sider → autopick valgte ham to gange → PK-crash i prod 12/7.
      ids: eligibleTeamIds, orderBy: ["id"], extra: (q) => applyRiderEligibilityFilter(q),
    });
    if (riderErr) throw new Error(`riders: ${riderErr.message}`);
    const riderIds = (riders || []).map((r) => r.id);

    const abilityByRider = new Map();
    if (riderIds.length) {
      const { data: abilities, error: aErr } = await selectInChunks({
        supabase, table: "rider_derived_abilities",
        columns: ["rider_id", ...ABILITY_KEYS].join(", "), inColumn: "rider_id", ids: riderIds,
        orderBy: ["rider_id"], // PK → stabil paginering (#2375)
      });
      if (aErr) throw new Error(`rider_derived_abilities: ${aErr.message}`);
      for (const a of abilities || []) abilityByRider.set(a.rider_id, a);
    }

    // Fatigue: degradér til tom map ved fejl (mirror raceRunner).
    let fatigueByRider = new Map();
    if (riderIds.length) {
      const { data: conditions, error: condErr } = await selectInChunks({
        supabase, table: "rider_condition", columns: "rider_id, fatigue",
        inColumn: "rider_id", ids: riderIds, orderBy: ["rider_id"], // PK → stabil paginering (#2375)
      });
      if (!condErr) fatigueByRider = new Map((conditions || []).map((c) => [c.rider_id, c.fatigue]));
    }

    for (const r of riders || []) {
      const abRow = abilityByRider.get(r.id);
      if (!abRow) continue; // rytter uden abilities kan ikke scores → spring over (mirror raceRunner).
      if (!ridersByTeam.has(r.team_id)) ridersByTeam.set(r.team_id, []);
      ridersByTeam.get(r.team_id).push({ rider_id: r.id, abilities: abRow, fatigue: fatigueByRider.get(r.id) });
    }
  }

  // 8b. S3: load holdstrategier for egnede hold. rosterByTeam = holdets ryttere (til
  // stale-filter). Hold uden strategi-row/regler → null → uændret generator-adfærd.
  const rosterByTeam = new Map();
  for (const [teamId, list] of ridersByTeam) rosterByTeam.set(teamId, new Set(list.map((r) => r.rider_id)));
  const strategyByTeam = await loadStrategiesForTeams({
    supabase, teamIds: eligibleTeamIds, rosterByTeam, selectInChunks,
  });

  // 9. Pr. pulje, pr. hold: byg holdets løb-liste (vindue + ikke-afmeldt + ikke-manuel),
  // kald kernen, og stage de idempotente skrivninger.
  const staged = []; // { race_id, team_id, picks }
  // Top-up-løb (delvis manuel trup): den manuelle trup ejer ALLEREDE special-rollerne
  // (validering kræver en kaptajn ved ≥1 rytter). Auto-fyldet må derfor IKKE udpege en
  // anden kaptajn/sprint-kaptajn → ellers dobbelt special-rolle pr. (race,team). De
  // top-fyldte ryttere skrives som "helper".
  const topUpKeys = new Set(); // "race|team"
  let skipped = 0;
  for (const [poolKey, poolRaces] of racesByPool) {
    const poolTeams = teamsByPool.get(poolKey) || [];
    for (const team of poolTeams) {
      const teamRaces = [];
      const lockedWindows = []; // manuelle løb: forbruger rytter-tid uden at vi genererer.
      for (const race of poolRaces) {
        const window = windowByRace.get(race.id);
        if (!window) continue; // dækket af usableRaces, men defensivt.
        const key = `${race.id}|${team.id}`;
        const isWithdrawn = withdrawnByRace.get(race.id)?.has(team.id);
        const hasManual = manualByRaceTeam.has(key);
        const isStarted = startedRaceIds.has(race.id);
        const sizeRule = selectionSizeForRace(race);
        const manualRiders = manualRidersByRaceTeam.get(key) || [];
        const fullManual = hasManual && manualRiders.length >= sizeRule.max;
        // Afmeldt, igangværende, eller FULD manuel trup → spring over (lås rytter-tid).
        if (isWithdrawn || fullManual || isStarted) {
          skipped += 1;
          // Manuelt ELLER igangværende løb låser sine ryttere i sit vindue (afmeldte gør ikke).
          if (hasManual) lockedWindows.push({ window, riderIds: manualRiders });
          else if (isStarted) lockedWindows.push({ window, riderIds: startedRidersByRaceTeam.get(key) || [] });
          continue;
        }
        // Delvis manuel trup (ejer 28/6): TOP-FYLD gabet — lås de manuelle rytteres tid (så de
        // ikke genbruges i et overlappende løb) og generér KUN de resterende pladser. De manuelle
        // entries (is_auto_filled=false) bevares; top-up er is_auto_filled=true.
        if (hasManual) { lockedWindows.push({ window, riderIds: manualRiders }); topUpKeys.add(key); }
        teamRaces.push({
          race_id: race.id, window,
          stages: stagesByRace.get(race.id) || [],
          sizeRule: { min: Math.max(0, sizeRule.min - manualRiders.length), max: sizeRule.max - manualRiders.length },
        });
      }
      const assignment = assignTeamAcrossRaces({
        riders: ridersByTeam.get(team.id) || [], races: teamRaces, lockedWindows,
        strategy: strategyByTeam.get(team.id) ?? null,
      });
      for (const [race_id, picks] of Object.entries(assignment)) {
        if (!picks.length) continue;
        // Top-up: neutralisér roller til "helper" (manuel trup ejer kaptajn/sprint-kaptajn).
        const finalPicks = topUpKeys.has(`${race_id}|${team.id}`)
          ? picks.map((p) => ({ ...p, race_role: "helper" }))
          : picks;
        staged.push({ race_id, team_id: team.id, picks: finalPicks });
      }
    }
  }

  // 10. Idempotente, DIFF-baserede skrivninger (kun hvis !dryRun) — #2375-hotfix 12/7.
  // PK er (race_id, rider_id) UDEN team_id. Den gamle wholesale delete(team-scoped)+insert
  // kunne (a) crashe på race_entries_pkey når batchen indeholdt en dublet-rytter eller en
  // residual (race,rytter)-række under et ANDET hold (ghost) overlevede den team-scopede
  // delete, og (b) efterlade et løb TØMT for holdets entries når insert fejlede EFTER
  // delete (prod: Grand Prix du Saint-Laurent, hold 34ea9bcb). Nu pr. (race,team)-enhed:
  //   1) upsert KUN manglende ryttere (ignoreDuplicates → PK-kollision kan aldrig vælte),
  //   2) slet KUN forældede ryttere, 3) opdatér KUN rolle-ændrede — insert FØR delete,
  //   så en fejl aldrig efterlader løbet tommere end før. Per-enhed try/catch: én enheds
  //   fejl aborterer ikke resten (heal-sweep-mønsteret). Manuelle (is_auto_filled=false)
  //   er aldrig i delete-/update-filtrene, og ignoreDuplicates opdaterer aldrig en
  //   eksisterende række — manuelle entries kan strukturelt ikke røres.
  let generated = 0;
  let inserted = 0;
  let removed = 0;
  let roleUpdated = 0;
  let failedUnits = 0;
  const errors = [];

  // Eksisterende auto-rækker for de berørte løb (kun live-kørsel) → diff-grundlag.
  const existingByUnit = new Map(); // "race|team" → Map(rider_id → race_role)
  if (!dryRun && staged.length) {
    const stagedRaceIds = [...new Set(staged.map((s) => s.race_id))];
    const { data: autoRows, error: autoErr } = await selectInChunks({
      supabase, table: "race_entries", columns: "race_id, team_id, rider_id, race_role",
      inColumn: "race_id", ids: stagedRaceIds, orderBy: ["race_id", "rider_id"], // PK (#2375)
      extra: (q) => q.eq("is_auto_filled", true),
    });
    if (autoErr) throw new Error(`race_entries (auto scan): ${autoErr.message}`);
    for (const e of autoRows || []) {
      const key = `${e.race_id}|${e.team_id}`;
      if (!existingByUnit.has(key)) existingByUnit.set(key, new Map());
      existingByUnit.get(key).set(e.rider_id, e.race_role);
    }
  }

  for (const { race_id, team_id, picks } of staged) {
    // Intra-batch-dedup på rider_id (defense-in-depth, #2375): skulle en rytter trods
    // stabil paginering optræde to gange i picks, må batchen ALDRIG indeholde dubletten.
    // Første forekomst vinder (autopick-rækkefølgen bestemmer rollen).
    const desired = new Map(); // rider_id → race_role
    for (const p of picks) if (!desired.has(p.rider_id)) desired.set(p.rider_id, p.race_role);
    generated += desired.size;
    if (dryRun) continue;

    // Forward-guard (#2074): et igangværende løb (frosset felt) må ALDRIG røres. staged
    // indeholder aldrig startede løb (skip-grenen ovenfor), men invarianten holdes lokal
    // til skrivningen så en fremtidig refaktor ikke kan nulstille et aktivt startfelt.
    if (startedRaceIds.has(race_id)) {
      failedUnits += 1;
      if (errors.length < 5) errors.push(`${race_id}/${team_id}: race_lineup_frozen (refused to touch in-flight race)`);
      continue;
    }

    try {
      const existing = existingByUnit.get(`${race_id}|${team_id}`) || new Map();
      const toInsert = [...desired]
        .filter(([riderId]) => !existing.has(riderId))
        .map(([riderId, role]) => ({
          race_id, rider_id: riderId, team_id, race_role: role, is_auto_filled: true,
        }));
      const toDelete = [...existing.keys()].filter((riderId) => !desired.has(riderId));
      const roleChanges = [...desired].filter(
        ([riderId, role]) => existing.has(riderId) && existing.get(riderId) !== role
      );

      // Insert FØRST (aldrig-tommere-garantien): fejler noget herefter, står løbet
      // aldrig med færre entries end før enheden startede. ignoreDuplicates: en
      // residual (race,rytter)-række under et andet hold (ghost) springes stille over
      // i stedet for at vælte kørslen — næste tick samler den op, når det andet holds
      // stale-delete har fjernet den.
      if (toInsert.length) {
        const { error: insErr } = await supabase
          .from("race_entries")
          .upsert(toInsert, { onConflict: "race_id,rider_id", ignoreDuplicates: true });
        if (insErr) throw new Error(`race_entries upsert: ${insErr.message}`);
        inserted += toInsert.length;
      }
      if (toDelete.length) {
        const { error: delErr } = await supabase
          .from("race_entries").delete()
          .eq("race_id", race_id).eq("team_id", team_id).eq("is_auto_filled", true)
          .in("rider_id", toDelete);
        if (delErr) throw new Error(`race_entries delete: ${delErr.message}`);
        removed += toDelete.length;
      }
      if (roleChanges.length) {
        // Grupperet pr. mål-rolle → maks 3 updates pr. enhed (captain/sprint_captain/helper).
        const byRole = new Map();
        for (const [riderId, role] of roleChanges) {
          if (!byRole.has(role)) byRole.set(role, []);
          byRole.get(role).push(riderId);
        }
        for (const [role, riderIds] of byRole) {
          const { error: updErr } = await supabase
            .from("race_entries").update({ race_role: role })
            .eq("race_id", race_id).eq("team_id", team_id).eq("is_auto_filled", true)
            .in("rider_id", riderIds);
          if (updErr) throw new Error(`race_entries role update: ${updErr.message}`);
          roleUpdated += riderIds.length;
        }
      }
    } catch (err) {
      failedUnits += 1;
      if (errors.length < 5) errors.push(`${race_id}/${team_id}: ${err.message}`);
    }
  }

  // 11. Antal hold der reelt blev behandlet i mindst én pulje.
  const processedTeamIds = new Set();
  for (const [poolKey] of racesByPool) {
    for (const team of teamsByPool.get(poolKey) || []) processedTeamIds.add(team.id);
  }

  return {
    dryRun,
    races: usableRaces.length,
    teams: processedTeamIds.size,
    generated,
    skipped,
    inserted,
    removed,
    role_updated: roleUpdated,
    failed_units: failedUnits,
    errors,
  };
}
