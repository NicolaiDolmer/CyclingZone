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
import { copenhagenDateString } from "./copenhagenTime.js";

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

// uq_race_entries_captain/_sprint_captain/_hunter (database/2026-06-12-race-entries-roles.sql):
// maks ÉN af hver af disse roller pr. (race_id, team_id) — på tværs af manuelle OG auto-rækker.
const SPECIAL_ROLES = new Set(["captain", "sprint_captain", "hunter"]);

// #2436 (Sentry CYCLINGZONE-32): manageren kan gemme sin udtagelse (replace_race_selection,
// raceSelection.js) i VINDUET mellem vores manual-scan (trin 6 nedenfor) og selve skrivningen
// af denne enhed — manualSpecialByRaceTeam er da forældet, guarden i skrivelaget ser ingen
// manuel special-rolle, og vores auto-insert/rolle-opdatering kolliderer med
// uq_race_entries_captain/_sprint_captain/_hunter (Postgres 23505). Matcher KUN disse tre
// constraint-navne — ingen generel 23505-slugning.
function isUqRaceEntriesViolation(err) {
  return !!err && /uq_race_entries_(captain|sprint_captain|hunter)/.test(String(err.message || ""));
}
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
  const raceById = new Map(races.map((r) => [r.id, r])); // #2436: retry rebygger sizeRule pr. race_class
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
    supabase, table: "race_entries", columns: "race_id, team_id, rider_id, race_role",
    inColumn: "race_id", ids: raceIds, orderBy: ["race_id", "rider_id"], // PK → stabil paginering (#2375)
    extra: (q) => q.eq("is_auto_filled", false),
  });
  if (entryErr) throw new Error(`race_entries (manual scan): ${entryErr.message}`);
  const manualByRaceTeam = new Set();
  const manualRidersByRaceTeam = new Map(); // "race|team" → [rider_id]
  // #2375 hotfix 2 (CYCLINGZONE-2D): manager-satte special-roller (captain/sprint_captain/
  // hunter) ejer uq_race_entries_*-slottet for (race, hold). Skrivelaget må ALDRIG give en
  // auto-række samme special-rolle — manager-valget vinder altid, og manuelle rækker røres
  // aldrig. topUp-neutraliseringen (staging) dækker normalstien; dette er den hårde garanti.
  const manualSpecialByRaceTeam = new Map(); // "race|team" → Set(special-roller taget af manager)
  for (const e of manualRows || []) {
    const key = `${e.race_id}|${e.team_id}`;
    manualByRaceTeam.add(key);
    if (!manualRidersByRaceTeam.has(key)) manualRidersByRaceTeam.set(key, []);
    manualRidersByRaceTeam.get(key).push(e.rider_id);
    if (SPECIAL_ROLES.has(e.race_role)) {
      if (!manualSpecialByRaceTeam.has(key)) manualSpecialByRaceTeam.set(key, new Set());
      manualSpecialByRaceTeam.get(key).add(e.race_role);
    }
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

  // 7b. #2599: eksplicitte "ryd"-markeringer (race_entry_clears). Spilleren har trykket
  // "Ryd dag"/"Ryd alt" og bekræftet — generatoren må ALDRIG fylde den (race,team)-enhed
  // ud igen, mirror afmeldings-mønsteret ovenfor, men pr. (race,team) i stedet for globalt
  // pr. race (holdet deltager stadig, kun auto-udtagelsen er sat på pause). En efterfølgende
  // manuel udtagelse ELLER et spiller-initieret auto-fill sletter markeringen igen
  // (raceSelection.js / /races/distribution/regenerate) — først da må vi fylde ud igen.
  // Rod-årsag for #2599's "manuelt ryddede trupper kommer tilbage": FØR denne markering
  // fandtes var et tomt race_entries-sæt umuligt at skelne fra "aldrig rørt".
  const { data: clearRows, error: clearErr } = await selectInChunks({
    supabase, table: "race_entry_clears", columns: "race_id, team_id",
    inColumn: "race_id", ids: raceIds, orderBy: ["race_id", "team_id"], // PK → stabil paginering
  });
  if (clearErr) throw new Error(`race_entry_clears: ${clearErr.message}`);
  const clearedRaceTeamKeys = new Set((clearRows || []).map((c) => `${c.race_id}|${c.team_id}`));

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

    // #2637 (Discord-bug, opfølgning på #2599): skadede ryttere (injured_until >= i dag)
    // må ALDRIG auto-udtages — hverken af den proaktive sweep her eller af manuel
    // "auto-fill" (regenerate-endpointet, api.js). Spec 6.5 (#1306) lukkede allerede dette
    // hul for raceRunner.fillMissingTeamEntries (race-tids-autofyld); denne sweep manglede
    // den samme guard, så en rytter kunne blive skadet EFTER at være auto-udtaget til en
    // etapeløbs-trup, og ingen efterfølgende sweep-kørsel fjernede ham igen. Nu udelukkes
    // skadede ryttere fra kandidat-poolen HVER kørsel — er han allerede en auto-række,
    // forsvinder han fra `desired` og bliver diff'et ud (toDelete) af applyUnitDiff.
    let injuredIds = new Set();
    if (riderIds.length) {
      const { data: injured, error: injErr } = await selectInChunks({
        supabase, table: "rider_condition", columns: "rider_id, injured_until",
        inColumn: "rider_id", ids: riderIds, orderBy: ["rider_id"],
        extra: (q) => q.gte("injured_until", copenhagenDateString()),
      });
      if (injErr) throw new Error(`rider_condition (injured): ${injErr.message}`);
      injuredIds = new Set((injured || []).map((r) => r.rider_id));
    }

    for (const r of riders || []) {
      const abRow = abilityByRider.get(r.id);
      if (!abRow) continue; // rytter uden abilities kan ikke scores → spring over (mirror raceRunner).
      if (injuredIds.has(r.id)) continue; // #2637: skadet → aldrig kandidat til auto-udtagelse.
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
        // #2599: spilleren har eksplicit ryddet (og bekræftet) denne (race,team)-enhed —
        // gælder KUN så længe der ikke er manuelle rækker igen (en efterfølgende manuel
        // udtagelse sletter markeringen, se raceSelection.js, men hasManual vinder alligevel
        // defensivt hvis sletningen skulle fejle/forsinkes).
        const isCleared = !hasManual && clearedRaceTeamKeys.has(key);
        // Afmeldt, igangværende, ryddet, eller FULD manuel trup → spring over (lås rytter-tid).
        if (isWithdrawn || fullManual || isStarted || isCleared) {
          skipped += 1;
          // Manuelt ELLER igangværende løb låser sine ryttere i sit vindue (afmeldte/ryddede gør ikke).
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
  //   1) vacate: eksisterende auto-rækker der mister en special-rolle → helper (frigør
  //      uq_race_entries_*-slottet FØR den nye holder skrives — CYCLINGZONE-2D),
  //   2) upsert KUN manglende ryttere (ignoreDuplicates → PK-kollision kan aldrig vælte),
  //   3) slet KUN forældede ryttere, 4) promotér KUN rolle-ændrede — insert FØR delete,
  //   så en fejl aldrig efterlader løbet tommere end før. Per-enhed try/catch: én enheds
  //   fejl aborterer ikke resten (heal-sweep-mønsteret). Manuelle (is_auto_filled=false)
  //   er aldrig i delete-/update-filtrene, ignoreDuplicates opdaterer aldrig en
  //   eksisterende række, og manager-satte special-roller demoterer auto-ønsket til
  //   helper — manuelle entries kan strukturelt ikke røres, manager-valget vinder altid.
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

  // Anvend diff'et (vacate → insert → delete → promote) for ÉN (race,team)-enhed mod
  // det givne desired/existing-rollekort. Ekstraheret (#2436) så retry'en efter en
  // uq_race_entries_*-kollision kan kalde PRÆCIS samme skrivelogik igen med et frisk
  // billede, uden kodeduplikering.
  async function applyUnitDiff({ raceId, teamId, desired, existing }) {
    const toInsert = [...desired]
      .filter(([riderId]) => !existing.has(riderId))
      .map(([riderId, role]) => ({
        race_id: raceId, rider_id: riderId, team_id: teamId, race_role: role, is_auto_filled: true,
      }));
    const toDelete = [...existing.keys()].filter((riderId) => !desired.has(riderId));
    const toDeleteSet = new Set(toDelete);

    // Vacate FØR insert (CYCLINGZONE-2D): en eksisterende auto-række der HOLDER en
    // special-rolle men mister den (rolle-skift ELLER stale) sættes til helper først,
    // så uq-slottet er frit når den nye holder indsættes/promoveres. Insert af en ny
    // captain FØR demote af den gamle var præcis prod-kollisionen (31 enheder, Team
    // UKYO). Vacate er en UPDATE (ikke destruktiv) → aldrig-tommere-garantien holder.
    const toVacate = [...existing]
      .filter(([riderId, role]) =>
        SPECIAL_ROLES.has(role) && (toDeleteSet.has(riderId) || desired.get(riderId) !== role))
      .map(([riderId]) => riderId);
    const vacatedSet = new Set(toVacate);
    // Promotions: blivende rækker hvis ønskede rolle afviger fra deres EFFEKTIVE rolle
    // (efter vacate = helper for de vacatede). En vacated rytter hvis mål ER helper,
    // behøver ingen anden update — vacaten var hans rolle-ændring.
    const promotions = [...desired].filter(([riderId, role]) => {
      if (!existing.has(riderId)) return false;
      const effective = vacatedSet.has(riderId) ? "helper" : existing.get(riderId);
      return effective !== role;
    });

    let unitInserted = 0;
    let unitRemoved = 0;
    let unitRoleUpdated = 0;

    if (toVacate.length) {
      const { error: vacErr } = await supabase
        .from("race_entries").update({ race_role: "helper" })
        .eq("race_id", raceId).eq("team_id", teamId).eq("is_auto_filled", true)
        .in("rider_id", toVacate);
      if (vacErr) throw new Error(`race_entries role vacate: ${vacErr.message}`);
      // Net-rolle-ændringer for blivende ryttere hvis endelige rolle ER helper
      // (promotions dækker resten; stale rækker tælles som removed, ikke role_updated).
      unitRoleUpdated += toVacate.filter(
        (riderId) => !toDeleteSet.has(riderId) && desired.get(riderId) === "helper"
      ).length;
    }

    // Insert før delete (aldrig-tommere-garantien): fejler noget herefter, står løbet
    // aldrig med færre entries end før enheden startede. ignoreDuplicates: en
    // residual (race,rytter)-række under et andet hold (ghost) springes stille over
    // i stedet for at vælte kørslen — næste tick samler den op, når det andet holds
    // stale-delete har fjernet den.
    if (toInsert.length) {
      const { error: insErr } = await supabase
        .from("race_entries")
        .upsert(toInsert, { onConflict: "race_id,rider_id", ignoreDuplicates: true });
      if (insErr) throw new Error(`race_entries upsert: ${insErr.message}`);
      unitInserted += toInsert.length;
    }
    if (toDelete.length) {
      const { error: delErr } = await supabase
        .from("race_entries").delete()
        .eq("race_id", raceId).eq("team_id", teamId).eq("is_auto_filled", true)
        .in("rider_id", toDelete);
      if (delErr) throw new Error(`race_entries delete: ${delErr.message}`);
      unitRemoved += toDelete.length;
    }
    if (promotions.length) {
      // Grupperet pr. mål-rolle → maks få updates pr. enhed. Kører SIDST: alle gamle
      // special-holdere er vacatet og stale rækker slettet, så slottene er frie.
      const byRole = new Map();
      for (const [riderId, role] of promotions) {
        if (!byRole.has(role)) byRole.set(role, []);
        byRole.get(role).push(riderId);
      }
      for (const [role, riderIds] of byRole) {
        const { error: updErr } = await supabase
          .from("race_entries").update({ race_role: role })
          .eq("race_id", raceId).eq("team_id", teamId).eq("is_auto_filled", true)
          .in("rider_id", riderIds);
        if (updErr) throw new Error(`race_entries role update: ${updErr.message}`);
        unitRoleUpdated += riderIds.length;
      }
    }
    return { inserted: unitInserted, removed: unitRemoved, roleUpdated: unitRoleUpdated };
  }

  // #2436 (CYCLINGZONE-32): genlæs ENHEDENS manuelle + eksisterende auto-rækker friskt
  // fra DB (den oprindelige manual-scan i trin 6 var team/sæson-bred og kan være
  // forældet af en manager-gem der landede undervejs) og kør enheden om — samme kerne
  // (assignTeamAcrossRaces) som originalkørslen, PRÆCIS ÉN gang. Kaldes KUN når skriv-
  // forsøget ovenfor rammer uq_race_entries_captain/_sprint_captain/_hunter.
  async function regenerateUnitAfterConcurrentManualSave({ raceId, teamId }) {
    const race = raceById.get(raceId);
    const window = windowByRace.get(raceId);
    const { data: freshManualRows, error: fmErr } = await supabase
      .from("race_entries").select("rider_id, race_role")
      .eq("race_id", raceId).eq("team_id", teamId).eq("is_auto_filled", false);
    if (fmErr) throw new Error(`race_entries (manual re-scan): ${fmErr.message}`);
    const manualRiders = (freshManualRows || []).map((e) => e.rider_id);
    const manualSpecial = new Set(
      (freshManualRows || []).filter((e) => SPECIAL_ROLES.has(e.race_role)).map((e) => e.race_role)
    );
    const sizeRule = selectionSizeForRace(race);

    const { data: freshExistingRows, error: feErr } = await supabase
      .from("race_entries").select("rider_id, race_role")
      .eq("race_id", raceId).eq("team_id", teamId).eq("is_auto_filled", true);
    if (feErr) throw new Error(`race_entries (auto re-scan): ${feErr.message}`);
    const existing = new Map((freshExistingRows || []).map((e) => [e.rider_id, e.race_role]));

    // Manageren fyldte truppen HELT undervejs (mirror hovedløbets fullManual-gren):
    // ingen auto-picks tilbage — eksisterende auto-rækker efterlades urørt (samme
    // adfærd som når fullManual opdages i step 9, hvor enheden aldrig når `staged`).
    if (manualRiders.length >= sizeRule.max) return { inserted: 0, removed: 0, roleUpdated: 0 };

    const adjSizeRule = { min: Math.max(0, sizeRule.min - manualRiders.length), max: sizeRule.max - manualRiders.length };
    const lockedWindows = manualRiders.length ? [{ window, riderIds: manualRiders }] : [];
    const teamRaces = [{ race_id: raceId, window, stages: stagesByRace.get(raceId) || [], sizeRule: adjSizeRule }];
    const assignment = assignTeamAcrossRaces({
      riders: ridersByTeam.get(teamId) || [], races: teamRaces, lockedWindows,
      strategy: strategyByTeam.get(teamId) ?? null,
    });
    let picks = assignment[raceId] || [];
    // Top-up (delvis manuel trup): den manuelle trup ejer special-rollerne → auto-picks
    // neutraliseres til helper (mirror topUpKeys-logikken i step 9).
    if (manualRiders.length) picks = picks.map((p) => ({ ...p, race_role: "helper" }));

    const desired = new Map();
    for (const p of picks) if (!desired.has(p.rider_id)) desired.set(p.rider_id, p.race_role);
    if (manualSpecial.size) {
      for (const [riderId, role] of desired) {
        if (SPECIAL_ROLES.has(role) && manualSpecial.has(role)) desired.set(riderId, "helper");
      }
    }
    return applyUnitDiff({ raceId, teamId, desired, existing });
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

    const unitKey = `${race_id}|${team_id}`;
    const existing = existingByUnit.get(unitKey) || new Map();

    // Rolle-bevidst supplement (#2375 hotfix 2, CYCLINGZONE-2D): har MANAGEREN allerede
    // sat en special-rolle blandt sine (bevarede, manuelle) entries, må ingen auto-række
    // få samme rolle — uq_race_entries_* er pr. (race, hold) på tværs af manuel/auto.
    // Manager-valget vinder ALTID; den nye rytter bliver helper i stedet. Manuelle
    // rækkers roller røres aldrig (alle updates herunder filtrerer is_auto_filled=true).
    const manualSpecial = manualSpecialByRaceTeam.get(unitKey) || new Set();
    if (manualSpecial.size) {
      for (const [riderId, role] of desired) {
        if (SPECIAL_ROLES.has(role) && manualSpecial.has(role)) desired.set(riderId, "helper");
      }
    }

    try {
      const result = await applyUnitDiff({ raceId: race_id, teamId: team_id, desired, existing });
      inserted += result.inserted;
      removed += result.removed;
      roleUpdated += result.roleUpdated;
    } catch (err) {
      // best-effort: fejl her aggregeres i failedUnits/errors og captures samlet
      // opstrøms i cron.js (én Sentry-capture pr. tick, #2375-hotfix) — ikke tavst.
      // #2436: manual-scannet (trin 6) blev forældet af en manager-gem der landede
      // i vinduet inden denne skrivning — genlæs enhedens manuelle rækker friskt og
      // kør enheden om PRÆCIS ÉN gang. Lykkes retry'en (var en samtidig manager-gem):
      // ingen capture. Fejler den igen: en ægte bug — signalet skal bevares.
      if (isUqRaceEntriesViolation(err)) {
        try {
          const retryResult = await regenerateUnitAfterConcurrentManualSave({ raceId: race_id, teamId: team_id });
          inserted += retryResult.inserted;
          removed += retryResult.removed;
          roleUpdated += retryResult.roleUpdated;
          continue;
        } catch (retryErr) {
          // best-effort: samme opstrøms-capture som ydre catch — retry-fejl tæller
          // som failed unit og rammer cron.js-Sentry-capturen (signalet bevares).
          failedUnits += 1;
          if (errors.length < 5) errors.push(`${race_id}/${team_id}: ${retryErr.message}`);
          continue;
        }
      }
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
