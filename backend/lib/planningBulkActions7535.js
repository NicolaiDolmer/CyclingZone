// #7535 · Planlaegningssidens "Handlinger"-menu (variant B, ejer 14/11): assistenten og afmelding
// over mange loeb. Begge fandtes kun pr. loeb (POST /races/:id/selection/auto og
// POST /races/:id/withdrawal); her er de bygget som ét kald hver.
//
//   POST /api/races/selection/auto/propose  { race_ids, overrides? }
//     LAESER kun. Assistentens trup til hvert loeb, regnet med PRAECIS samme regler som
//     /selection/auto (samme kandidat-pulje, skader mod loebets startdato, Train now-laas,
//     binding og pickAutoSelection). Intet skrives: siden laegger forslaget i sin kladde, og
//     spilleren gemmer det selv med det eksisterende atomiske masse-gem (PUT /races/selection/bulk).
//     Spillerens egne valg bliver staaende; assistenten fylder kun de tomme pladser (samme
//     moenster som sen-redningen i fillMissingTeamEntries: egne ryttere og roller roeres aldrig).
//   POST /api/races/withdrawals/bulk        { race_ids, dry_run? }
//     Alt eller intet (PLANNING_CENTER_RULES §1): alle loeb kontrolleres foerst med samme guards
//     som enkelt-afmeldingen, og afmeldingerne skrives derefter i ÉN saetning (én transaktion).
//     dry_run kontrollerer uden at skrive, saa siden kan sikre sig foer et blandet gem.
//
// Begge har samme loft pr. kald som masse-gemmet. Al I/O ligger i `deps`, saa reglerne kan proeves
// med styrede svar uden database (planningBulkActions7535.test.js).
import { loadLockedRaceIds } from "./raceStartLock.js";
import { teamInRaceSquadPool, loadTeamBindingContext, raceBindingWindow } from "./raceBinding.js";
import { isTeamSquadTrainOnly } from "./youthRaceOptOut.ts";
import { raceSquadOf, applyRiderEligibilityFilter, loadRaceSeasonNumber, raceSelectionReferenceDateStr, isRiderInjured } from "./riderEligibility.js";
import { ROUTE_MATCH_STAGE_COLUMNS } from "./routeMatch.js";
import { loadRaceTrainNowLock } from "./trainNowLock.js";
import { ABILITY_KEYS as RACE_SIM_ABILITY_KEYS } from "./raceSimulator.js";
import { fatigueByRiderForRaces } from "./riderFatigueNow.js";
import { copenhagenDateString } from "./copenhagenTime.js";
import { loadTeamStrategy } from "./raceStrategy.js";
import { pickAutoSelection } from "./selectionAutoFill.js";
import { selectionSizeForRace } from "./raceAutopick.js";
import { isRaceEngineV2Enabled } from "./raceEngineFlag.js";
import { fetchAllRows } from "./supabasePagination.js";

/** Samme loft pr. kald som PUT /races/selection/bulk (SELECTION_BULK_MAX i routes/api.js). */
export const PLANNING_BULK_MAX = 60;

const RACE_COLUMNS = "id, name, race_type, race_class, stages, stages_completed, status, league_division_id, season_id, scheduled_for, squad";

function bad(status, error, extra = {}) {
  return { status, body: { error, ...extra } };
}

/** Listen af loeb i kaldet: 1..max unikke ids. Ellers den samme 400-kontrakt som masse-gemmet. */
export function parseRaceIds(value, max = PLANNING_BULK_MAX) {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, ...bad(400, "selection_invalid_body") };
  if (value.length > max) return { ok: false, ...bad(400, "selection_bulk_too_large", { max }) };
  if (value.some((id) => typeof id !== "string" || !id)) return { ok: false, ...bad(400, "selection_invalid_body") };
  if (new Set(value).size !== value.length) return { ok: false, ...bad(400, "selection_duplicate_race") };
  return { ok: true, ids: value };
}

/**
 * Sidens kladde for loeb, den har aendret uden at gemme ({ raceId: [{ rider_id, race_role }] }).
 * Forslaget regner med kladden (et ryddet loeb binder ingen), men skriver den aldrig: gemmet
 * kontrollerer alt igen.
 */
export function parseOverrides(value, max = PLANNING_BULK_MAX) {
  const out = new Map();
  if (value == null) return { ok: true, overrides: out };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, ...bad(400, "selection_invalid_body") };
  const keys = Object.keys(value);
  if (keys.length > max) return { ok: false, ...bad(400, "selection_bulk_too_large", { max }) };
  for (const raceId of keys) {
    const rows = value[raceId];
    if (!Array.isArray(rows) || rows.length > 40) return { ok: false, ...bad(400, "selection_invalid_body") };
    const clean = [];
    for (const row of rows) {
      if (!row || typeof row.rider_id !== "string" || !row.rider_id) return { ok: false, ...bad(400, "selection_invalid_body") };
      clean.push({ rider_id: row.rider_id, race_role: typeof row.race_role === "string" ? row.race_role : null });
    }
    out.set(raceId, clean);
  }
  return { ok: true, overrides: out };
}

/**
 * Spillerens egne valg + assistentens valg til de tomme pladser. En tom trup faar assistentens trup
 * uaendret (som /selection/auto). Ellers bliver egne ryttere og roller staaende, og de nye ryttere
 * kommer ind i assistentens raekkefoelge som hjaelpere; kun hvis truppen ingen kaptajn har, faar
 * assistentens foerste nye rytter kaptajnsrollen (serveren kraever en kaptajn i en ikke-tom trup).
 */
export function fillOpenPlaces7535({ own = [], picks = [], sizeMax }) {
  const max = Math.max(0, Number(sizeMax) || 0);
  if (!own.length) return picks.slice(0, max).map((p) => ({ rider_id: p.rider_id, race_role: p.race_role ?? null }));
  const mine = new Set(own.map((o) => o.rider_id));
  const need = Math.max(0, max - own.length);
  const fills = picks.filter((p) => !mine.has(p.rider_id)).slice(0, need);
  const out = [...own.map((o) => ({ rider_id: o.rider_id, race_role: o.race_role ?? null })), ...fills.map((p) => ({ rider_id: p.rider_id, race_role: "helper" }))];
  if (fills.length && !out.some((e) => e.race_role === "captain")) {
    const first = out.find((e) => !mine.has(e.rider_id));
    if (first) first.race_role = "captain";
  }
  return out;
}

/**
 * Bindingen for ét loeb i kaldet: databasens andre loeb, men med kaldets egne loeb (allerede regnet
 * i denne omgang) og sidens kladde i stedet for det gemte. Saa kan to loeb paa samme loebsdage
 * i samme kald aldrig faa samme rytter.
 */
export function lockedWindowsFor({ raceId, dbOthers = [], chained = new Map() }) {
  const replaced = dbOthers.filter((o) => o.raceId !== raceId && !chained.has(o.raceId));
  const extra = [...chained]
    .filter(([id, c]) => id !== raceId && c.window && c.riderIds.length)
    .map(([id, c]) => ({ raceId: id, window: c.window, riderIds: c.riderIds }));
  return [...replaced, ...extra];
}

/** Kalenderens raekkefoelge (startdato), ellers kaldets: et tidligt loeb vaelger foerst. */
export function orderForAssistant(races) {
  return races
    .map((race, i) => ({ race, i }))
    .sort((a, b) => String(a.race.scheduled_for ?? "").localeCompare(String(b.race.scheduled_for ?? "")) || a.i - b.i)
    .map((x) => x.race);
}

// ── Assistenten over mange loeb (laeser kun) ────────────────────────────────

export async function proposeAssistantSquads7535({ team, body, now, deps }) {
  const parsed = parseRaceIds(body?.race_ids);
  if (!parsed.ok) return parsed;
  const ov = parseOverrides(body?.overrides);
  if (!ov.ok) return ov;
  const { ids } = parsed;
  const { overrides } = ov;

  const raceById = await deps.loadRaces([...new Set([...ids, ...overrides.keys()])]);
  for (const id of ids) if (!raceById.has(id)) return bad(404, "race_not_found", { race_id: id });

  const [withdrawn, lockedNow, entriesByRace] = await Promise.all([
    deps.loadWithdrawnIds(ids),
    deps.loadLockedIds(ids, now),
    deps.loadTeamEntries(ids),
  ]);

  // Kladdens loeb binder med kladdens ryttere (et ryddet loeb binder ingen), ogsaa kaldets egne loeb,
  // til de er regnet i denne omgang.
  const chained = new Map();
  const extraIds = [...overrides.keys()].filter((id) => raceById.has(id));
  const windows = extraIds.length ? await deps.loadWindows(extraIds) : new Map();
  for (const id of extraIds) chained.set(id, { window: windows.get(id) ?? null, riderIds: overrides.get(id).map((r) => r.rider_id), seasonId: raceById.get(id).season_id });

  const proposals = [];
  const skipped = [];
  for (const race of orderForAssistant(ids.map((id) => raceById.get(id)))) {
    const own = overrides.get(race.id) ?? entriesByRace.get(race.id) ?? [];
    const skip = (reason) => skipped.push({ race_id: race.id, reason });
    // Samme afvisninger som /selection/auto, men som "springes over" i stedet for en fejl for hele kaldet.
    if (race.status !== "scheduled") { skip("selection_race_not_open"); continue; }
    if (lockedNow.has(race.id)) { skip("selection_race_started"); continue; }
    if (!teamInRaceSquadPool({ team, race })) { skip("selection_wrong_pool"); continue; }
    // Et afmeldt loeb faar aldrig en trup af assistenten (et bevidst fravalg er ikke "mangler udtagelse").
    if (withdrawn.has(race.id)) { skip("selection_withdrawn"); continue; }
    if (await deps.isTrainOnly(race)) { skip("selection_train_only"); continue; }
    const sizeMax = selectionSizeForRace(race).max;
    const ctx = await deps.loadAssistantContext({ race, ownIds: own.map((o) => o.rider_id) });
    const peers = new Map([...chained].filter(([, c]) => c.seasonId === race.season_id));
    if (own.length >= sizeMax) {
      skip("selection_full");
      chained.set(race.id, { window: ctx.thisWindow, riderIds: own.map((o) => o.rider_id), seasonId: race.season_id });
      continue;
    }
    const mine = new Set(own.map((o) => o.rider_id));
    const picks = ctx.candidateRiders.length
      ? deps.pick({
          candidateRiders: ctx.candidateRiders.filter((r) => !mine.has(r.rider_id)),
          race,
          stages: ctx.stages,
          thisWindow: ctx.thisWindow,
          lockedWindows: lockedWindowsFor({ raceId: race.id, dbOthers: ctx.dbOthers, chained: peers }),
          strategy: ctx.strategy,
        })
      : [];
    const entries = fillOpenPlaces7535({ own, picks, sizeMax });
    const added = entries.length - own.length;
    chained.set(race.id, { window: ctx.thisWindow, riderIds: entries.map((e) => e.rider_id), seasonId: race.season_id });
    if (added <= 0) { skip("selection_no_eligible_riders"); continue; }
    proposals.push({ race_id: race.id, entries, added });
  }
  return { status: 200, body: { ok: true, proposals, skipped } };
}

// ── Afmeld over mange loeb (alt eller intet) ────────────────────────────────

export async function withdrawRacesBulk7535({ team, body, now, deps }) {
  const parsed = parseRaceIds(body?.race_ids);
  if (!parsed.ok) return parsed;
  const { ids } = parsed;
  const raceById = await deps.loadRaces(ids);
  for (const id of ids) if (!raceById.has(id)) return bad(404, "race_not_found", { race_id: id });
  // Samme guards som POST /races/:id/withdrawal, for hvert loeb, FOER noget skrives.
  for (const id of ids) {
    const race = raceById.get(id);
    if (race.status !== "scheduled") return bad(409, "selection_race_not_open", { race_id: id });
    if (!teamInRaceSquadPool({ team, race })) return bad(409, "selection_wrong_pool", { race_id: id });
  }
  const locked = await deps.loadLockedIds(ids, now);
  const first = ids.find((id) => locked.has(id));
  if (first) return bad(409, "selection_race_started", { race_id: first });
  if (body?.dry_run === true) return { status: 200, body: { ok: true, checked: ids.length } };
  // #6959-moenstret: frisk laas-tjek lige foer skrivningen.
  const lockedAtWrite = await deps.loadLockedIds(ids, deps.clock());
  const late = ids.find((id) => lockedAtWrite.has(id));
  if (late) return bad(409, "selection_race_started", { race_id: late });
  await deps.upsertWithdrawals(ids.map((raceId) => ({ race_id: raceId, team_id: team.id })));
  return { status: 200, body: { ok: true, withdrawn: ids.length }, invalidate: true };
}

// ── Databasen (standard-deps) ───────────────────────────────────────────────

/** Den rigtige I/O bag reglerne ovenfor. Kald for kald de samme opslag som /selection/auto. */
export function planningBulkDeps7535({ supabase, team }) {
  const teamId = team.id;
  return {
    clock: () => new Date(),
    async loadRaces(ids) {
      if (!ids.length) return new Map();
      const { data, error } = await supabase.from("races").select(RACE_COLUMNS).in("id", ids);
      if (error) throw new Error(`races (planning bulk): ${error.message}`);
      return new Map((data || []).map((r) => [r.id, r]));
    },
    async loadWithdrawnIds(ids) {
      const { data, error } = await supabase.from("race_withdrawals").select("race_id").eq("team_id", teamId).in("race_id", ids);
      if (error) throw new Error(`race_withdrawals (planning bulk): ${error.message}`);
      return new Set((data || []).map((r) => r.race_id));
    },
    loadLockedIds: (ids, at) => loadLockedRaceIds({ supabase, raceIds: ids, now: at }),
    async loadTeamEntries(ids) {
      // pagination-safe: ét holds trupper i hoejst PLANNING_BULK_MAX loeb (én trup pr. loeb), langt under 1000
      const { data, error } = await supabase.from("race_entries").select("race_id, rider_id, race_role").eq("team_id", teamId).in("race_id", ids);
      if (error) throw new Error(`race_entries (planning bulk): ${error.message}`);
      const out = new Map();
      for (const e of data || []) {
        if (!out.has(e.race_id)) out.set(e.race_id, []);
        out.get(e.race_id).push({ rider_id: e.rider_id, race_role: e.race_role ?? null });
      }
      return out;
    },
    async loadWindows(ids) {
      // Mange etapeloeb x etaper kan naa 1000-raekkers loftet: hentes i sider med stabil orden.
      const data = await fetchAllRows(() => supabase.from("race_stage_schedule").select("race_id, scheduled_at, game_day").in("race_id", ids).order("race_id").order("stage_number"));
      const rowsByRace = new Map();
      for (const s of data || []) {
        if (!rowsByRace.has(s.race_id)) rowsByRace.set(s.race_id, []);
        rowsByRace.get(s.race_id).push(s);
      }
      return new Map(ids.map((id) => [id, raceBindingWindow(rowsByRace.get(id))]));
    },
    isTrainOnly: (race) => isTeamSquadTrainOnly(supabase, { teamId, squad: raceSquadOf(race) }),
    // Kandidat-puljen til ét loeb: PRAECIS de opslag og filtre /selection/auto bruger (api.js).
    async loadAssistantContext({ race, ownIds }) {
      const [{ data: teamRiders, error: ridersErr }, { data: stageProfiles, error: profErr }] = await Promise.all([
        // pagination-safe: ét holds ryttere (samme opslag som /selection/auto), langt under 1000
        applyRiderEligibilityFilter(supabase.from("riders").select("id").eq("team_id", teamId), { squad: raceSquadOf(race), seasonNumber: await loadRaceSeasonNumber({ supabase, race }) }),
        // pagination-safe: ét loebs etaper
        supabase.from("race_stage_profiles").select(ROUTE_MATCH_STAGE_COLUMNS).eq("race_id", race.id).order("stage_number", { ascending: true }),
      ]);
      if (ridersErr) throw new Error(`riders (planning bulk): ${ridersErr.message}`);
      if (profErr) throw new Error(`race_stage_profiles (planning bulk): ${profErr.message}`);
      const stages = stageProfiles || [];
      const binding = await loadTeamBindingContext({ supabase, race, teamId });
      const lock = await loadRaceTrainNowLock({ supabase, raceId: race.id, riderIds: [...(teamRiders || []).map((r) => r.id), ...ownIds] });
      const teamRiderIds = (teamRiders || []).map((r) => r.id).filter((id) => !lock.riderIds.has(id));
      const base = { stages, thisWindow: binding.thisWindow, dbOthers: binding.otherRaces, strategy: null, candidateRiders: [] };
      if (!teamRiderIds.length) return base;
      const abilityCols = ["rider_id", ...RACE_SIM_ABILITY_KEYS].join(", ");
      const [{ data: abilities, error: abErr }, { data: conditions, error: condErr }] = await Promise.all([
        supabase.from("rider_derived_abilities").select(abilityCols).in("rider_id", teamRiderIds),
        supabase.from("rider_condition").select("rider_id, fatigue, injured_until").in("rider_id", teamRiderIds),
      ]);
      if (abErr) throw new Error(`rider_derived_abilities (planning bulk): ${abErr.message}`);
      if (condErr) throw new Error(`rider_condition (planning bulk): ${condErr.message}`);
      const abById = new Map((abilities || []).map((a) => [a.rider_id, a]));
      const fatNow = await fatigueByRiderForRaces({ supabase, conditions, abilityByRider: abById, teamId, races: [{ id: race.id, stages }] });
      const fatById = fatNow.byRace?.get(race.id) ?? fatNow.fatById;
      const todayStr = raceSelectionReferenceDateStr(race, copenhagenDateString());
      const injuredIds = new Set((conditions || []).filter((c) => isRiderInjured(c.injured_until, todayStr)).map((c) => c.rider_id));
      const candidateRiders = teamRiderIds
        .map((id) => ({ rider_id: id, abilities: abById.get(id), fatigue: fatById.get(id) ?? 0 }))
        .filter((r) => r.abilities && !injuredIds.has(r.rider_id));
      const strategy = await loadTeamStrategy({ supabase, teamId, rosterIds: new Set(teamRiderIds) });
      return { ...base, candidateRiders, strategy };
    },
    pick: pickAutoSelection,
    async upsertWithdrawals(rows) {
      // Én saetning = én transaktion: enten afmeldes alle loeb, eller ingen.
      const { error } = await supabase.from("race_withdrawals").upsert(rows, { onConflict: "race_id,team_id" });
      if (error) throw new Error(`race_withdrawals upsert (planning bulk): ${error.message}`);
    },
  };
}

/**
 * Express-handleren for begge kald (routes/api.js registrerer kun stien). Samme indgang som
 * enkelt-kaldene: hold kraeves, og motorens kontakt skal vaere taendt for seeren.
 */
export function planningBulkRoute7535(action, { supabase, isViewerBetaTester, captureException, invalidateNamespace, makeDeps = planningBulkDeps7535, engineEnabled = isRaceEngineV2Enabled }) {
  return async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    try {
      const isBetaTester = await isViewerBetaTester(req);
      if (!(await engineEnabled(supabase, { isBetaTester }))) return res.status(409).json({ error: "selection_flag_disabled" });
      const out = await action({ team: req.team, body: req.body || {}, now: new Date(), deps: makeDeps({ supabase, team: req.team }) });
      if (out.invalidate) {
        invalidateNamespace("races");
        invalidateNamespace("calendar"); // #6514: kalenderkortet baerer holdets afmeldt-status
      }
      return res.status(out.status).json(out.body);
    } catch (err) {
      captureException(err);
      return res.status(500).json({ error: err.message });
    }
  };
}
