// backend/lib/raceEntryGenerator.js
// Race Hub Fase 0b: proaktiv entry-generator. Kerne = kronologisk binding-bevidst
// tildeling: ét holds ryttere fordeles over puljens løb, så ingen rytter er i to
// tidsoverlappende løb. Deterministisk (autopick er deterministisk; løb sorteres
// stabilt på vindue-start, så race_id). Pure — ingen DB.

import { autopickTeamSelection, selectionSizeForRace } from "./raceAutopick.js";
import {
  windowsOverlap, raceBindingWindow,
  isRiderDayInvariantViolation, isConstraintNotDeferrable,
} from "./raceBinding.js";
import {
  ASSISTANT_MODES, DEFAULT_ASSISTANT_MODE, DEFAULT_LATE_FILL_HOURS,
  normalizeAssistantMode, normalizeLateFillHours,
} from "./assistantSelectionMode.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { raceTerrainBucket } from "./raceTerrain.js";
import { loadStrategiesForTeams } from "./raceStrategy.js";
import { applyRiderEligibilityFilter, applyInjuredFilter } from "./riderEligibility.js";
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

// #3482 (Sentry CYCLINGZONE-32): samme TOCTOU-klasse, anden constraint. Bliver et holds
// ryttere slettet (AI-trim/removeAiTeams) i vinduet mellem trup-læsningen og skrivningen,
// peger insert-batchen på rider_id'er der ikke findes længere → FK-brud (Postgres 23503)
// på HELE enhedens upsert. Prod 15/7 + 5/8: 28 enheder = ét slettet hold × 28 løb.
// Matcher KUN denne ene FK — ingen generel 23503-slugning.
function isRiderFkViolation(err) {
  return !!err && /race_entries_rider_id_fkey/.test(String(err.message || ""));
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
 * #4201: `mode` afgoer om MANAGER-hold overhovedet er med. Default (proactive) er
 * bit-for-bit dagens adfaerd — kun hold uden bruger. Se assistantSelectionMode.js
 * og docs/ASSISTANT_RULES.md §1b. `now` injiceres af tests (hard rule 16).
 *
 * @param {{ supabase: object, seasonId: string, dryRun?: boolean, mode?: string,
 *           lateFillHours?: number, now?: number|Date }} args
 * @returns {Promise<{dryRun:boolean, races:number, teams:number, generated:number,
 *   skipped:number, inserted:number, removed:number, role_updated:number,
 *   failed_units:number, errors:Array<string>, mode:string}>}
 */
export async function runRaceEntryGenerator({
  supabase, seasonId, dryRun = true,
  mode: rawMode = DEFAULT_ASSISTANT_MODE,
  lateFillHours: rawLateFillHours = DEFAULT_LATE_FILL_HOURS,
  now = Date.now(),
}) {
  let mode = normalizeAssistantMode(rawMode);
  const lateFillHours = normalizeLateFillHours(rawLateFillHours);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  // 1. Sæsonens løb.
  const { data: races, error: raceErr } = await supabase
    .from("races").select("id, race_class, league_division_id, stages_completed").eq("season_id", seasonId);
  if (raceErr) throw new Error(`races: ${raceErr.message}`);
  if (!races || !races.length) return { dryRun, races: 0, teams: 0, generated: 0, skipped: 0, mode };
  const raceIds = races.map((r) => r.id);
  const raceById = new Map(races.map((r) => [r.id, r])); // #2436: retry rebygger sizeRule pr. race_class
  // Frys (#1825): et igangværende etapeløb (stages_completed>0) må ALDRIG regenereres —
  // dets trup er låst midt i afviklingen. Vi springer det over for ALLE hold og låser
  // dets ryttere, så et overlappende ikke-startet løb ikke dobbeltbooker dem.
  const startedRaceIds = new Set((races || []).filter((r) => (r.stages_completed ?? 0) > 0).map((r) => r.id));

  // 2. Tidsvinduer pr. løb (fra race_stage_schedule). Løb uden vindue kan ikke binde.
  // #3119: game_day SKAL med i selecten, så raceBindingWindow binder i in-game-dag-
  // rummet — SAMME nøgle-rum som save-guarden i PUT /selection, regenerate-endpointet
  // og raceRunner-autofyldet. Uden game_day faldt sweep'en altid tilbage til CET-
  // kalenderdage; i en komprimeret sæson deler flere in-game-dage samme danske dato,
  // så sweep'en så 156 falske konflikter (målt i prod 28/7) og efterlod trupper
  // underfyldte eller tomme.
  const { data: schedRows, error: schedErr } = await selectInChunks({
    supabase, table: "race_stage_schedule", columns: "race_id, scheduled_at, game_day",
    inColumn: "race_id", ids: raceIds, orderBy: ["race_id", "stage_number"], // PK → stabil paginering (#2375)
  });
  if (schedErr) throw new Error(`race_stage_schedule: ${schedErr.message}`);
  const schedByRace = new Map();
  for (const row of schedRows || []) {
    if (!schedByRace.has(row.race_id)) schedByRace.set(row.race_id, []);
    schedByRace.get(row.race_id).push(row);
  }
  // Binding-vindue (dag-granulært): én rytter pr. in-game løbsdag. Instant-vinduer
  // (raceTimeWindow) fik to samme-dag-løb til ikke at overlappe → dobbeltbooking (#1823).
  // B2 (#4075): monumenter har nu normal game_day og binder via raceBindingWindow som
  // alle andre løb — den afledte pulje-lokale monument-undtagelse (#3114) er fjernet.
  const windowByRace = new Map();
  for (const r of races) {
    windowByRace.set(r.id, raceBindingWindow(schedByRace.get(r.id)));
  }
  // #4201 (late_fill): foerste etapes faktiske starttid. Binding-vinduet ovenfor er
  // in-game-dag-granulaert (raceBindingWindow) og kan derfor IKKE bruges til "N timer
  // foer start" — det tal skal maales paa wall-clock (scheduled_at), som er den tid
  // spilleren selv ser i kalenderen.
  const firstStartByRace = new Map();
  for (const [raceId, rows] of schedByRace) {
    let earliest = null;
    for (const row of rows) {
      const t = row.scheduled_at ? Date.parse(row.scheduled_at) : NaN;
      if (!Number.isFinite(t)) continue;
      if (earliest === null || t < earliest) earliest = t;
    }
    if (earliest !== null) firstStartByRace.set(raceId, earliest);
  }

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

  // 5. Egnede hold: ikke test-konto, ikke frosset, INGEN ejer. Grupper pr. pulje.
  //
  // #4217 (ejer-direktiv 25/8): den proaktive sweep må ALDRIG udtage på en spillers vegne.
  // Tre spillere rapporterede 24/8 at deres ryddede trupper blev fyldt igen (#4200), og
  // arongreve/thelamba brugte over en time på planer sweepen overskrev. Ejeren 25/8:
  // "Vil du være sød at lade være med hele tiden at lave nye udtagelser på vegne af
  // spillerne? ... De vil hellere selv udtage." Clear-markeringen (#2599) var det forkerte
  // sted at løse det — den forudsætter at spilleren FØRST rydder og bekræfter, og en enkelt
  // tabt markering giver hele oplevelsen tilbage. Grænsen går ved ejerskab i stedet: har
  // holdet en bruger, rører sweepen det ikke.
  //
  // AI-hold (user_id is null) fyldes fortsat — uden dem starter deres løb tomme.
  // Spillerens EGEN auto-fill-knap er upåvirket: den går gennem selectionAutoFill.js, som
  // kalder assignTeamAcrossRaces direkte og aldrig denne funktion. Assistenten er dermed
  // pull, ikke push (#4201).
  //
  // #4201: `mode` aabner doeren for MANAGER-hold igen, men aldrig paa dagens
  // praemisser. late_fill lader dem med, og LOEBS-gaten nedenfor (trin 9) afgoer
  // resten: kun tomme trupper, kun inden for lateFillHours. opt_in lader kun de
  // hold med der selv har slaaet assistenten til. proactive = uaendret #4217.
  const { data: allTeams, error: teamErr } = await supabase
    .from("teams").select("id, is_test_account, is_frozen, league_division_id, user_id")
    .or("is_test_account.is.null,is_test_account.eq.false");
  if (teamErr) throw new Error(`teams: ${teamErr.message}`);

  // opt_in: laes spillerens eget valg. Kolonnen kommer med database/2026-09-03-4201-
  // assistant-mode.sql; er den ikke applied endnu, fejler selecten → fail-safe
  // tilbage til proactive i stedet for at gaette at alle har sagt ja.
  let optInTeamIds = null;
  if (mode === ASSISTANT_MODES.OPT_IN) {
    // schema-columns-ok: assistant_autopick_enabled tilfoejes af
    // database/2026-09-03-4201-assistant-mode.sql, som foerst koeres EFTER merge
    // under #2642-rammerne (idempotent + post-verify). schema-snapshot.json er et
    // spejl af prod og opdateres derfor foerst naar migrationen er applied - ikke
    // i denne PR, hvor kolonnen endnu ikke findes i prod.
    const { data: optInRows, error: optInErr } = await supabase
      .from("teams").select("id, assistant_autopick_enabled");
    if (optInErr) {
      mode = DEFAULT_ASSISTANT_MODE;
    } else {
      // Default TRUE: en NULL-raekke (foer backfill) betyder "ikke fravalgt".
      optInTeamIds = new Set((optInRows || [])
        .filter((t) => t.assistant_autopick_enabled !== false).map((t) => t.id));
    }
  }

  const managerTeamsIncluded = mode !== DEFAULT_ASSISTANT_MODE;
  const eligibleTeams = (allTeams || []).filter((t) => {
    if (t.is_frozen) return false;
    if (!t.user_id) return true; // AI-hold: uaendret i ALLE tilstande (#2622-bindingen).
    if (mode === ASSISTANT_MODES.LATE_FILL) return true;
    if (mode === ASSISTANT_MODES.OPT_IN) return optInTeamIds?.has(t.id) === true;
    return false; // proactive (#4217): sweepen udtager aldrig paa en spillers vegne.
  });
  const ownerTeamIds = new Set(
    (allTeams || []).filter((t) => t.user_id).map((t) => t.id)
  );
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

  // 7b. #2599: eksplicitte "ryd"-markeringer (race_entry_clears). Semantikken er skrevet
  // ét sted: backend/lib/raceEntryClears.js — læs den FØR du ændrer her. Løbs-tidens
  // autofyld (raceRunner.fillMissingTeamEntries) håndhæver den samme regel via
  // loadClearedTeamIds; de to stier skal blive ved med at være enige (#4200).
  // Spilleren har trykket
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

  // 7c. #4201 (kun late_fill): naere loeb + hvad der ALLEREDE staar i dem.
  //
  // "Naer" maales paa foerste etapes scheduled_at, ikke paa binding-vinduet (§1b i
  // docs/ASSISTANT_RULES.md). Kun for naere loeb — og for de loeb hvis binding-vindue
  // OVERLAPPER et naert loeb — skal vi kende holdets eksisterende raekker: de laases,
  // saa en tom trup i naboloebet ikke faar en rytter der allerede koerer et andet loeb
  // samme in-game-dag (samme fejlklasse som #1823/#3113).
  //
  // Manager-hold i late_fill roeres KUN naar enheden er HELT tom (hverken manuelle
  // eller auto-raekker). Spillerens egen "Auto-udfyld"-knap skriver ogsaa
  // is_auto_filled=true (selectionAutoFill.js), saa "tom" maa ikke defineres som
  // "ingen manuelle" — ellers ville sweepen diffe spillerens egne bestilte picks.
  const nearRaceIds = new Set();
  const entriesByRaceTeam = new Map(); // "race|team" → [rider_id]
  if (mode === ASSISTANT_MODES.LATE_FILL) {
    const horizonMs = lateFillHours * 60 * 60 * 1000;
    for (const r of races) {
      const start = firstStartByRace.get(r.id);
      if (start === undefined) continue; // uden starttid kan naerhed ikke afgoeres.
      if (start - nowMs <= horizonMs) nearRaceIds.add(r.id);
    }
    const bindingRelevantRaceIds = new Set(nearRaceIds);
    for (const r of races) {
      if (bindingRelevantRaceIds.has(r.id)) continue;
      const w = windowByRace.get(r.id);
      if (!w) continue;
      for (const nearId of nearRaceIds) {
        const nw = windowByRace.get(nearId);
        if (nw && windowsOverlap(w, nw)) { bindingRelevantRaceIds.add(r.id); break; }
      }
    }
    if (bindingRelevantRaceIds.size) {
      const { data: nearEntryRows, error: nearErr } = await selectInChunks({
        supabase, table: "race_entries", columns: "race_id, team_id, rider_id",
        inColumn: "race_id", ids: [...bindingRelevantRaceIds], orderBy: ["race_id", "rider_id"], // PK (#2375)
      });
      if (nearErr) throw new Error(`race_entries (late-fill scan): ${nearErr.message}`);
      for (const e of nearEntryRows || []) {
        const key = `${e.race_id}|${e.team_id}`;
        if (!entriesByRaceTeam.has(key)) entriesByRaceTeam.set(key, []);
        entriesByRaceTeam.get(key).push(e.rider_id);
      }
    }
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
        // #3896: kanonisk skades-filter (riderEligibility.applyInjuredFilter).
        extra: (q) => applyInjuredFilter(q, copenhagenDateString()),
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
        // #4201 (late_fill): et manager-hold er kun med naar loebet starter inden for
        // horisonten OG enheden er helt tom. "Ryd dag"/"Ryd alt" (isCleared ovenfor)
        // vinder fortsat ubetinget — ogsaa inden for horisonten; markeringen er
        // spillerens eksplicitte "nej" og har aldrig en udloebsdato (gate 3, §7).
        const existingUnitRiders = entriesByRaceTeam.get(key) || [];
        const lateFillBlocked = mode === ASSISTANT_MODES.LATE_FILL
          && ownerTeamIds.has(team.id)
          && (!nearRaceIds.has(race.id) || existingUnitRiders.length > 0);
        // Afmeldt, igangværende, ryddet, eller FULD manuel trup → spring over (lås rytter-tid).
        if (isWithdrawn || fullManual || isStarted || isCleared || lateFillBlocked) {
          skipped += 1;
          // #3119-opfølgning (CYCLINGZONE-44, prod 5/8): en FULD manuel trup skal stadig
          // PRUNES. Enheden genererer ingen picks, men dens forældede is_auto_filled=true-
          // rækker fra en tidligere kørsel overlevede før for evigt, fordi enheden aldrig
          // nåede `staged` — og de blev heller ikke låst nedenfor (kun `manualRiders` låses).
          // Dobbelt skade: (a) truppen står med max+N ryttere i et løb med hård
          // selection-cap, (b) den residuale rytter regnes som FRI af assignTeamAcrossRaces
          // og bliver udtaget til et tidsoverlappende søsterløb → binding-invariant-brud.
          // Prod 5/8: Team Fakta havde 6 manuelle + 1 residual auto (Marcos S. Ortega) i
          // O Gran Camiño Menor (Class2, max 6, game_day 10-13) og fik ham derfor OGSÅ som
          // kaptajn i Settimana di Coppi e Bartali Minore (game_day 11-14).
          // Samme klasse som #3113's "enhed med NUL picks skal stadig stages" — tredje variant.
          // Kun fullManual prunes: et AFMELDT løbs entries bevares bevidst (#1823, gen-
          // tilmelding giver samme trup), et IGANGVÆRENDE løbs felt er frosset (#1825), og
          // en RYDDET enhed (#2599) er uden for dette fixs scope.
          // #4201: en late_fill-blokeret enhed maa ALDRIG stages med tomme picks —
          // det ville diffe spillerens egne raekker vaek (hans auto-udfyld skriver
          // ogsaa is_auto_filled=true). Sweepen skriver kun ind i tomme enheder.
          if (fullManual && !isWithdrawn && !isStarted && !isCleared && !lateFillBlocked) {
            staged.push({ race_id: race.id, team_id: team.id, picks: [] });
          }
          // Manuelt ELLER igangværende løb låser sine ryttere i sit vindue (afmeldte/ryddede gør ikke).
          // #3113: de to tilfælde er IKKE gensidigt udelukkende — et igangværende løb kan sagtens
          // have en DELVIS manuel trup. Den gamle `else if` lod da hasManual-grenen vinde og låste
          // KUN de manuelle ryttere, så løbets auto-fyldte stod som "frie" og blev genudtaget til
          // et overlappende søsterløb i næste kørsel. Præcis prod-bruddet 27/7 (Team Brutaliste:
          // Hauts Plateaux var startet med 1 manuel + 4 auto → de 4 kørte OGSÅ Tour de Malaisie
          // på game_day 0-1). Lås derfor UNIONEN.
          // #3122 (Rod A, #1823): et AFMELDT løb låser ALDRIG — holdet stiller ikke op, så dets
          // udtagne ryttere er frie til det overlappende løb. Entries bevares kun så en gen-
          // tilmelding giver samme trup. Samme semantik som loadTeamBindingContext og
          // /races/distribution/regenerate; sweep'en var den ene kaldevej der stadig låste.
          if (!isWithdrawn) {
            const lockedRiderIds = new Set();
            if (hasManual) for (const rid of manualRiders) lockedRiderIds.add(rid);
            if (isStarted) for (const rid of startedRidersByRaceTeam.get(key) || []) lockedRiderIds.add(rid);
            // #4201: en sprunget late_fill-enhed laaser HELE sin trup (manuel OG auto) —
            // ellers regnes spillerens egne ryttere som frie og bliver udtaget til et
            // overlappende naboloeb → dobbeltbooking (samme klasse som #3113).
            if (lateFillBlocked) for (const rid of existingUnitRiders) lockedRiderIds.add(rid);
            if (lockedRiderIds.size) lockedWindows.push({ window, riderIds: [...lockedRiderIds] });
          }
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
        // #3113: en enhed med NUL picks skal STADIG stages. Tidligere sprang vi den over,
        // så enhedens forældede auto-rækker fra en tidligere kørsel aldrig blev diffet væk:
        // rytteren stod fortsat i løb A i databasen, mens denne kørsels tildeling regnede
        // ham som fri og gav ham det overlappende løb B (prod 27/7, Aquila–L3gatus: Tour du
        // Danube stod tilbage med præcis ÉN residual-entry). applyUnitDiff med tomt `desired`
        // sletter kun is_auto_filled=true-rækker — manuelle entries røres aldrig.
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
  // #4163: batch-RPC'en kan afvises fordi no_rider_double_booking ikke er deferrable
  // (skema-drift, ikke en dobbeltbooking). Det er en SYSTEMISK tilstand — hvert hold
  // rammer den, hver enhed falder tilbage i insert-før-delete-dødvandet — så den skal
  // rapporteres ÉN gang og som det FØRSTE i errors, ikke drukne bag fem generiske
  // enheds-fejl der peger på den forkerte diagnose.
  let constraintNotDeferrable = false;

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

  // #3934: REN diff-beregning for ÉN (race,team)-enhed — delt mellem batch-RPC-vejen
  // (payload-bygning nedenfor) og per-enheds-vejen (applyUnitDiff), så de to veje
  // strukturelt ikke kan divergere i HVAD der skal skrives, kun i HVORDAN.
  // Vacate-semantik (CYCLINGZONE-2D-klassen, se applyUnitDiff): en eksisterende
  // auto-række der HOLDER en special-rolle men mister den (rolle-skift ELLER stale)
  // demoteres til helper, så uq_race_entries_*-slottet er frit for den nye holder.
  // Promotions: blivende rækker hvis ønskede rolle afviger fra deres EFFEKTIVE rolle
  // (efter vacate = helper for de vacatede). vacateNetHelper: blivende vacatede hvis
  // ENDELIGE rolle ER helper — de tælles som rolle-opdateret uden yderligere update
  // (batch-RPC'en tæller kun promotions, så JS-laget lægger dette til selv).
  function computeUnitDiff({ desired, existing }) {
    const toInsert = [...desired]
      .filter(([riderId]) => !existing.has(riderId))
      .map(([riderId, role]) => ({ rider_id: riderId, race_role: role }));
    const toDelete = [...existing.keys()].filter((riderId) => !desired.has(riderId));
    const toDeleteSet = new Set(toDelete);
    const toVacate = [...existing]
      .filter(([riderId, role]) =>
        SPECIAL_ROLES.has(role) && (toDeleteSet.has(riderId) || desired.get(riderId) !== role))
      .map(([riderId]) => riderId);
    const vacatedSet = new Set(toVacate);
    const promotions = [...desired]
      .filter(([riderId, role]) => {
        if (!existing.has(riderId)) return false;
        const effective = vacatedSet.has(riderId) ? "helper" : existing.get(riderId);
        return effective !== role;
      })
      .map(([riderId, role]) => ({ rider_id: riderId, race_role: role }));
    const vacateNetHelper = toVacate.filter(
      (riderId) => !toDeleteSet.has(riderId) && desired.get(riderId) === "helper"
    ).length;
    return { toInsert, toDelete, toVacate, promotions, vacateNetHelper };
  }

  // Anvend diff'et (vacate → insert → delete → promote) for ÉN (race,team)-enhed mod
  // det givne desired/existing-rollekort. Ekstraheret (#2436) så retry'en efter en
  // uq_race_entries_*-kollision kan kalde PRÆCIS samme skrivelogik igen med et frisk
  // billede, uden kodeduplikering. Fra #3934 er dette FALLBACK-vejen (batch-RPC'en
  // nedenfor er primær) — men stadig eneste vej for retry-grenene #2436/#3482.
  async function applyUnitDiff({ raceId, teamId, desired, existing }) {
    const { toInsert: diffInsert, toDelete, toVacate, promotions } =
      computeUnitDiff({ desired, existing });
    const toDeleteSet = new Set(toDelete);
    const toInsert = diffInsert.map(({ rider_id, race_role }) => ({
      race_id: raceId, rider_id, team_id: teamId, race_role, is_auto_filled: true,
    }));

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
      if (insErr) {
        // #3420: DB-backstoppet (no_rider_double_booking) er den sidste linje hvis
        // sweepets egen kronologiske binding-tildeling (findManualOverlapConflicts/
        // windowsOverlap ovenfor) alligevel skulle overse en konflikt — det ville
        // afsløre en bug i SELVE sweepet, ikke bare en enkelt spillerhandling, så
        // fejlen skal være tydelig i loggen (ikke tavs) uden at maskeres som en
        // generisk Postgres-tekst.
        if (isRiderDayInvariantViolation(insErr)) {
          throw new Error(
            `race_entries upsert: rider-day invariant (#3420) rejected this unit's insert for race ${raceId}/team ${teamId} — ` +
            `the sweep's own binding assignment missed a double-booking (${insErr.message})`
          );
        }
        throw new Error(`race_entries upsert: ${insErr.message}`);
      }
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
      for (const { rider_id: riderId, race_role: role } of promotions) {
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

  // #3482 (CYCLINGZONE-32): en samtidig rytter-sletning gjorde insert-batchen ugyldig.
  // Kun de NYE rækker (desired \ existing) kan bryde rider-FK'en — rækker der allerede
  // STÅR i race_entries har pr. definition en levende rytter (FK'en er ON DELETE CASCADE,
  // så en slettet rytters entries forsvinder med ham). Derfor filtreres UDELUKKENDE
  // insert-siden: hver existing-rytter beholdes i `desired`, så `toDelete` strukturelt
  // ikke kan vokse ift. originalkørslen. Aldrig-tommere-garantien holder — et fejlramt
  // eller tomt eksistens-opslag kan ikke rive en trup ned, kun undlade at fylde den op.
  // Kaldes PRÆCIS ÉN gang pr. enhed, som #2436's retry.
  async function regenerateUnitAfterRiderDeletion({ raceId, teamId, desired, existing }) {
    const candidates = [...desired.keys()].filter((riderId) => !existing.has(riderId));
    if (!candidates.length) {
      // FK-brud uden nye rækker giver ingen mening — ægte bug, bevar signalet.
      throw new Error("race_entries_rider_id_fkey with no new rows to filter");
    }
    const { data: aliveRows, error: aliveErr } = await selectInChunks({
      supabase, table: "riders", columns: "id", inColumn: "id", ids: candidates, orderBy: ["id"],
    });
    if (aliveErr) throw new Error(`riders (existence re-scan): ${aliveErr.message}`);
    const alive = new Set((aliveRows || []).map((r) => r.id));
    const survivors = new Map(
      [...desired].filter(([riderId]) => existing.has(riderId) || alive.has(riderId))
    );
    // Alle ønskede ryttere findes stadig → FK-bruddet skyldtes IKKE en sletning.
    // Så er det en ægte bug (fx et rider_id fra en fremmed sæson) og må ikke slugges.
    if (survivors.size === desired.size) {
      throw new Error("race_entries_rider_id_fkey but every desired rider still exists");
    }
    return applyUnitDiff({ raceId, teamId, desired: survivors, existing });
  }

  // #3906 (CYCLINGZONE-2D, prod 18/8 — Koben Racing): regenerateUnitAfterConcurrentManualSave
  // (nedenfor) kalder assignTeamAcrossRaces med KUN dette ene løb i `races` — den har derfor
  // INGEN hukommelse om holdets ANDRE løb i samme pulje/batch. Rammer uq-kollisionen ét af to
  // tidsoverlappende løb for SAMME hold (fx to instanser af "Famenne-Ardenne" + "Vuelta a
  // Cantabria" i samme pulje, begge Koben-tilmeldt), kan retry'en derfor uvidende vælge en
  // rytter der allerede kører søsterløbet — nøjagtig den dobbeltbooking no_rider_double_booking
  // (#3420) findes for at forhindre, nu fanget som et SENERE insert-forsøg der selv fejler.
  // Byg derfor et komplet locked-windows-billede for enhedens søsterløb, filtreret til dem
  // hvis vindue RENT FAKTISK overlapper dette løbs: (a) holdets allerede COMMITTEDE entries i
  // andre løb (frisk DB-scan, mirror loadTeamBindingContext/raceBinding.js), og (b) holdets
  // andre STAGEDE (beregnet denne kørsel, men endnu ikke skrevet — staged processeres i
  // vindue-rækkefølge, så et senere søsterløb kan mangle fra (a) på retry-tidspunktet)
  // enheder for SAMME hold. Ryttere i disse vinduer EKSKLUDERES fra kandidatlisten, så
  // assignTeamAcrossRaces/autopick SPLITTER truppen over de overlappende løb i stedet for at
  // gense samme rytter; er roster for lille til at dække begge, giver autopick naturligt
  // færre picks (partiel fyldning, se autopickTeamSelection — aldrig en crash).
  async function siblingLockedWindows({ raceId, teamId, window }) {
    if (!window) return [];
    const locked = [];
    // pagination-safe: bounded by ÉT holds SAMLEDE sæson-entries (typisk et par
    // hundrede rækker — antal-løb × trupstørrelse), langt under PostgREST's 1000-cap.
    const { data: otherRows, error: oErr } = await supabase
      .from("race_entries").select("race_id, rider_id")
      .eq("team_id", teamId).neq("race_id", raceId);
    if (oErr) throw new Error(`race_entries (sibling binding re-scan): ${oErr.message}`);
    const otherRidersByRace = new Map();
    for (const e of otherRows || []) {
      if (!otherRidersByRace.has(e.race_id)) otherRidersByRace.set(e.race_id, []);
      otherRidersByRace.get(e.race_id).push(e.rider_id);
    }
    let committedLockedRiders = 0;
    for (const [otherRaceId, riderIds] of otherRidersByRace) {
      const otherWindow = windowByRace.get(otherRaceId);
      if (!otherWindow || !windowsOverlap(window, otherWindow)) continue;
      locked.push({ window: otherWindow, riderIds });
      committedLockedRiders += riderIds.length;
    }
    let stagedLockedRiders = 0;
    for (const unit of staged) {
      if (unit.team_id !== teamId || unit.race_id === raceId) continue;
      const otherWindow = windowByRace.get(unit.race_id);
      if (!otherWindow || !windowsOverlap(window, otherWindow)) continue;
      const riderIds = (unit.picks || []).map((p) => p.rider_id);
      if (!riderIds.length) continue;
      locked.push({ window: otherWindow, riderIds });
      stagedLockedRiders += riderIds.length;
    }
    if (committedLockedRiders || stagedLockedRiders) {
      console.warn(
        `⚠️  Entry-generator ${raceId}/${teamId}: søsterløb-binding fundet under retry — ` +
        `${committedLockedRiders} committede + ${stagedLockedRiders} stagede rytter(e) ekskluderet fra kandidatlisten (#3906)`
      );
    }
    return locked;
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
    // ingen auto-picks tilbage → PRUNE enhedens forældede auto-rækker med et tomt
    // `desired`, præcis som step 9 nu gør. Tidligere efterlod vi dem urørt, hvilket
    // over-fyldte truppen forbi selection-cap'en OG lod rytteren stå fri til et
    // tidsoverlappende søsterløb (CYCLINGZONE-44, prod 5/8 — se step 9's kommentar).
    // Manuelle rækker kan strukturelt ikke røres: applyUnitDiff filtrerer på is_auto_filled=true.
    if (manualRiders.length >= sizeRule.max) {
      return applyUnitDiff({ raceId, teamId, desired: new Map(), existing });
    }

    const adjSizeRule = { min: Math.max(0, sizeRule.min - manualRiders.length), max: sizeRule.max - manualRiders.length };
    const lockedWindows = manualRiders.length ? [{ window, riderIds: manualRiders }] : [];
    // #3906: ekskludér ryttere bundet i et overlappende søsterløb FØR autopick vælger,
    // så truppen splittes i stedet for at gense en allerede-bundet rytter.
    lockedWindows.push(...(await siblingLockedWindows({ raceId, teamId, window })));
    const teamRaces = [{ race_id: raceId, window, stages: stagesByRace.get(raceId) || [], sizeRule: adjSizeRule }];
    const assignment = assignTeamAcrossRaces({
      riders: ridersByTeam.get(teamId) || [], races: teamRaces, lockedWindows,
      strategy: strategyByTeam.get(teamId) ?? null,
    });
    let picks = assignment[raceId] || [];
    // Top-up (delvis manuel trup): den manuelle trup ejer special-rollerne → auto-picks
    // neutraliseres til helper (mirror topUpKeys-logikken i step 9).
    if (manualRiders.length) picks = picks.map((p) => ({ ...p, race_role: "helper" }));
    // #3906: partiel fyldning er en gyldig, forventet udfald (ikke en fejl) — log det
    // korrekte resultat i stedet for at lade enheden stå tavst underbemandet.
    if (picks.length < adjSizeRule.max) {
      console.warn(
        `⚠️  Entry-generator ${raceId}/${teamId}: partiel fyldning efter binding-splitting — ${picks.length}/${adjSizeRule.max} auto-pladser (#3906)`
      );
    }

    const desired = new Map();
    for (const p of picks) if (!desired.has(p.rider_id)) desired.set(p.rider_id, p.race_role);
    if (manualSpecial.size) {
      for (const [riderId, role] of desired) {
        if (SPECIAL_ROLES.has(role) && manualSpecial.has(role)) desired.set(riderId, "helper");
      }
    }
    return applyUnitDiff({ raceId, teamId, desired, existing });
  }

  // Per-enheds skrivning med recovery-grene (#2436/#3482) — før #3934 den ENESTE
  // skrivevej, nu FALLBACK når holdets batch-RPC afvises. Muterer tællerne/errors.
  async function applyUnitWithRecovery({ race_id, team_id, desired, existing }) {
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
          return;
        } catch (retryErr) {
          // best-effort: samme opstrøms-capture som ydre catch — retry-fejl tæller
          // som failed unit og rammer cron.js-Sentry-capturen (signalet bevares).
          failedUnits += 1;
          if (errors.length < 5) errors.push(`${race_id}/${team_id}: ${retryErr.message}`);
          return;
        }
      }
      // #3482: en samtidig rytter-sletning ramte insert-batchen. Filtrér de forsvundne
      // ryttere fra insert-siden og kør enheden om PRÆCIS ÉN gang. Lykkes det, var det en
      // forventet-og-håndteret race (holdet er væk — der er intet at udtage) og skal ikke
      // fyre en Sentry-alarm; men den logges, så oprydningen stadig kan ses i Railway.
      // Fejler retry'en: signalet bevares som en fejlet enhed, præcis som #2436.
      if (isRiderFkViolation(err)) {
        try {
          const retryResult = await regenerateUnitAfterRiderDeletion({
            raceId: race_id, teamId: team_id, desired, existing,
          });
          inserted += retryResult.inserted;
          removed += retryResult.removed;
          roleUpdated += retryResult.roleUpdated;
          console.warn(
            `⚠️  Entry-generator ${race_id}/${team_id}: rytter(e) slettet under kørslen — enheden kørt om uden dem`
          );
          return;
        } catch (retryErr) {
          // best-effort: samme opstrøms-capture som ydre catch — retry-fejl tæller
          // som failed unit og rammer cron.js-Sentry-capturen (signalet bevares).
          failedUnits += 1;
          if (errors.length < 5) errors.push(`${race_id}/${team_id}: ${retryErr.message}`);
          return;
        }
      }
      failedUnits += 1;
      if (errors.length < 5) errors.push(`${race_id}/${team_id}: ${err.message}`);
    }
  }

  // Trin 10a (#3934): forbered enhederne (dedup, frozen-guard, manuel-special-demote)
  // og gruppér pr. hold — skrivningen sker pr. hold nedenfor.
  const preparedByTeam = new Map(); // team_id → [{ race_id, team_id, desired, existing }]
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
    // (RPC'en håndhæver samme guard DB-side: sweep_race_lineup_frozen.)
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

    if (!preparedByTeam.has(team_id)) preparedByTeam.set(team_id, []);
    preparedByTeam.get(team_id).push({ race_id, team_id, desired, existing });
  }

  // Trin 10b (#3934): pr. hold — ÉN RPC-transaktion (apply_race_entry_unit_batch) for
  // alle enheder med ændringer. Inde i transaktionen er no_rider_double_booking
  // DEFERRED, så en rytter-swap mellem to overlappende løb (insert i det ene + delete
  // i det andet = TO enheder) er lovlig som helhed — præcis den klasse der under
  // insert-før-delete pr. enhed var et deterministisk dødvande (prod 18/8, ~350
  // enheder/tick, CYCLINGZONE-32/-2D). Atomicitet overtager aldrig-tommere-garantien
  // (crash = rollback). Afvises batchen (samtidig manager-gem, ÆGTE dobbeltbooking i
  // tildelingen, eller RPC'en findes endnu ikke fordi migrationen ikke er applied),
  // falder holdet tilbage til per-enheds-vejen med de eksisterende recovery-grene —
  // én enheds fejl koster så aldrig hele holdets tick.
  for (const [team_id, units] of preparedByTeam) {
    const changed = [];
    let batchVacateNetHelper = 0;
    for (const unit of units) {
      const diff = computeUnitDiff({ desired: unit.desired, existing: unit.existing });
      if (!diff.toInsert.length && !diff.toDelete.length && !diff.toVacate.length && !diff.promotions.length) continue;
      batchVacateNetHelper += diff.vacateNetHelper;
      changed.push({ unit, diff });
    }
    if (!changed.length) continue;

    let batchResult = null;
    let batchErr = null;
    try {
      const rpcRes = await supabase.rpc("apply_race_entry_unit_batch", {
        p_team_id: team_id,
        p_units: changed.map(({ unit, diff }) => ({
          race_id: unit.race_id,
          vacate: diff.toVacate,
          deletes: diff.toDelete,
          inserts: diff.toInsert,
          promotions: diff.promotions,
        })),
      });
      batchResult = rpcRes?.data ?? null;
      batchErr = rpcRes?.error ?? null;
    } catch (err) {
      // best-effort: klient uden .rpc (fx ældre mock/script) eller kastet transportfejl
      // må aldrig vælte hele ticket — fejlen bæres i batchErr, logges nedenfor og
      // fallback-vejen (per-enhed, med fuld fejlhåndtering) tager over.
      batchErr = err;
    }
    if (!batchErr) {
      inserted += batchResult?.inserted ?? 0;
      removed += batchResult?.removed ?? 0;
      roleUpdated += (batchResult?.role_updated ?? 0) + batchVacateNetHelper;
      continue;
    }
    if (isConstraintNotDeferrable(batchErr) && !constraintNotDeferrable) {
      constraintNotDeferrable = true;
      console.error(
        "🚨 Entry-generator: no_rider_double_booking er IKKE deferrable i DB — batch-RPC'en (#3934) " +
        "kan ikke køre, og ALLE rytter-swaps mellem overlappende løb falder tilbage i insert-før-delete-" +
        "dødvandet. Kør database/2026-08-24-4163-restore-deferrable-double-booking.sql (#4163)."
      );
    }
    console.warn(
      `⚠️  Entry-generator ${team_id}: batch-RPC afvist (${batchErr.message}) — falder tilbage til per-enheds-skrivning (#3934)`
    );
    for (const { unit } of changed) {
      await applyUnitWithRecovery(unit);
    }
  }

  // 11. Antal hold der reelt blev behandlet i mindst én pulje.
  const processedTeamIds = new Set();
  for (const [poolKey] of racesByPool) {
    for (const team of teamsByPool.get(poolKey) || []) processedTeamIds.add(team.id);
  }

  return {
    dryRun,
    mode, // #4201: den EFFEKTIVE tilstand (fail-safe kan have sat den til proactive).
    races: usableRaces.length,
    teams: processedTeamIds.size,
    generated,
    skipped,
    inserted,
    removed,
    role_updated: roleUpdated,
    failed_units: failedUnits,
    // #4163: den systemiske diagnose først — enheds-fejlene nedenfor er dens SYMPTOM.
    errors: constraintNotDeferrable
      ? [
          "no_rider_double_booking er ikke deferrable i DB (#4163) — batch-RPC'en #3934 er ude af drift " +
          "og hver rytter-swap mellem overlappende løb fejler i fallback-vejen",
          ...errors,
        ]
      : errors,
    constraint_not_deferrable: constraintNotDeferrable,
  };
}
