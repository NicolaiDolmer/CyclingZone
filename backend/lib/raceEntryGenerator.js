// backend/lib/raceEntryGenerator.js
// Race Hub Fase 0b: proaktiv entry-generator. Kerne = kronologisk binding-bevidst
// tildeling: ét holds ryttere fordeles over puljens løb, så ingen rytter er i to
// tidsoverlappende løb. Deterministisk (autopick er deterministisk; løb sorteres
// stabilt på vindue-start, så race_id). Pure — ingen DB.

import { autopickTeamSelection, selectionSizeForRace } from "./raceAutopick.js";
import { windowsOverlap, raceTimeWindow } from "./raceBinding.js";
import { ABILITY_KEYS } from "./raceSimulator.js";

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
export function assignTeamAcrossRaces({ riders = [], races = [], lockedWindows = [] }) {
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
    const picks = autopickTeamSelection({ riders: available, stages: race.stages, sizeRule: race.sizeRule });
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
async function selectInChunks({ supabase, table, columns, inColumn, ids, extra = null }) {
  const out = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    let q = supabase.from(table).select(columns).in(inColumn, ids.slice(i, i + IN_CHUNK_SIZE));
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) return { data: null, error };
    out.push(...(data || []));
  }
  return { data: out, error: null };
}

/**
 * DB-orkestrator: for én sæson, fyld puljernes løb proaktivt med assistent-udtagne
 * hold. Idempotent — sletter kun is_auto_filled=true og genskaber; manuelle entries
 * (is_auto_filled=false) røres ALDRIG. Binding-bevidst (én rytter pr. tidsvindue) via
 * den rene kerne assignTeamAcrossRaces. Afmeldte hold (race_withdrawals) springes over.
 *
 * @param {{ supabase: object, seasonId: string, dryRun?: boolean }} args
 * @returns {Promise<{dryRun:boolean, races:number, teams:number, generated:number, skipped:number}>}
 */
export async function runRaceEntryGenerator({ supabase, seasonId, dryRun = true }) {
  // 1. Sæsonens løb.
  const { data: races, error: raceErr } = await supabase
    .from("races").select("id, race_class, league_division_id").eq("season_id", seasonId);
  if (raceErr) throw new Error(`races: ${raceErr.message}`);
  if (!races || !races.length) return { dryRun, races: 0, teams: 0, generated: 0, skipped: 0 };
  const raceIds = races.map((r) => r.id);

  // 2. Tidsvinduer pr. løb (fra race_stage_schedule). Løb uden vindue kan ikke binde.
  const { data: schedRows, error: schedErr } = await selectInChunks({
    supabase, table: "race_stage_schedule", columns: "race_id, scheduled_at",
    inColumn: "race_id", ids: raceIds,
  });
  if (schedErr) throw new Error(`race_stage_schedule: ${schedErr.message}`);
  const schedByRace = new Map();
  for (const row of schedRows || []) {
    if (!schedByRace.has(row.race_id)) schedByRace.set(row.race_id, []);
    schedByRace.get(row.race_id).push(row);
  }
  const windowByRace = new Map();
  for (const id of raceIds) windowByRace.set(id, raceTimeWindow(schedByRace.get(id)));

  // 3. Etapeprofiler pr. løb (autopick scorer på dem), sorteret på stage_number.
  const { data: profileRows, error: profileErr } = await selectInChunks({
    supabase, table: "race_stage_profiles",
    columns: "race_id, stage_number, profile_type, finale_type, demand_vector",
    inColumn: "race_id", ids: raceIds,
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
  const { data: entryRows, error: entryErr } = await selectInChunks({
    supabase, table: "race_entries", columns: "race_id, team_id, rider_id, is_auto_filled",
    inColumn: "race_id", ids: raceIds,
  });
  if (entryErr) throw new Error(`race_entries (manual scan): ${entryErr.message}`);
  const manualByRaceTeam = new Set();
  const manualRidersByRaceTeam = new Map(); // "race|team" → [rider_id]
  for (const e of entryRows || []) {
    if (e.is_auto_filled === false) {
      const key = `${e.race_id}|${e.team_id}`;
      manualByRaceTeam.add(key);
      if (!manualRidersByRaceTeam.has(key)) manualRidersByRaceTeam.set(key, []);
      manualRidersByRaceTeam.get(key).push(e.rider_id);
    }
  }

  // 7. Afmeldinger pr. løb (race_withdrawals) — batched.
  const { data: wRows, error: wErr } = await selectInChunks({
    supabase, table: "race_withdrawals", columns: "race_id, team_id",
    inColumn: "race_id", ids: raceIds,
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
      ids: eligibleTeamIds, extra: (q) => q.or("is_retired.is.null,is_retired.eq.false"),
    });
    if (riderErr) throw new Error(`riders: ${riderErr.message}`);
    const riderIds = (riders || []).map((r) => r.id);

    const abilityByRider = new Map();
    if (riderIds.length) {
      const { data: abilities, error: aErr } = await selectInChunks({
        supabase, table: "rider_derived_abilities",
        columns: ["rider_id", ...ABILITY_KEYS].join(", "), inColumn: "rider_id", ids: riderIds,
      });
      if (aErr) throw new Error(`rider_derived_abilities: ${aErr.message}`);
      for (const a of abilities || []) abilityByRider.set(a.rider_id, a);
    }

    // Fatigue: degradér til tom map ved fejl (mirror raceRunner).
    let fatigueByRider = new Map();
    if (riderIds.length) {
      const { data: conditions, error: condErr } = await selectInChunks({
        supabase, table: "rider_condition", columns: "rider_id, fatigue",
        inColumn: "rider_id", ids: riderIds,
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

  // 9. Pr. pulje, pr. hold: byg holdets løb-liste (vindue + ikke-afmeldt + ikke-manuel),
  // kald kernen, og stage de idempotente skrivninger.
  const staged = []; // { race_id, team_id, picks }
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
        if (isWithdrawn || hasManual) {
          skipped += 1;
          // Et manuelt løb låser stadig sine ryttere i sit tidsvindue (afmeldte gør ikke).
          if (hasManual) lockedWindows.push({ window, riderIds: manualRidersByRaceTeam.get(key) || [] });
          continue;
        }
        teamRaces.push({
          race_id: race.id, window,
          stages: stagesByRace.get(race.id) || [],
          sizeRule: selectionSizeForRace(race),
        });
      }
      const assignment = assignTeamAcrossRaces({ riders: ridersByTeam.get(team.id) || [], races: teamRaces, lockedWindows });
      for (const [race_id, picks] of Object.entries(assignment)) {
        if (picks.length) staged.push({ race_id, team_id: team.id, picks });
      }
    }
  }

  // 10. Idempotent skrivning (kun hvis !dryRun): slet is_auto_filled=true for (race,team),
  // indsæt nye. Manuelle (is_auto_filled=false) er aldrig i delete-filteret.
  let generated = 0;
  for (const { race_id, team_id, picks } of staged) {
    const rows = picks.map((p) => ({
      race_id, rider_id: p.rider_id, team_id, race_role: p.race_role, is_auto_filled: true,
    }));
    if (!dryRun) {
      const { error: delErr } = await supabase
        .from("race_entries").delete()
        .eq("race_id", race_id).eq("team_id", team_id).eq("is_auto_filled", true);
      if (delErr) throw new Error(`race_entries delete (${race_id}/${team_id}): ${delErr.message}`);
      const { error: insErr } = await supabase.from("race_entries").insert(rows);
      if (insErr) throw new Error(`race_entries insert (${race_id}/${team_id}): ${insErr.message}`);
    }
    generated += rows.length;
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
  };
}
