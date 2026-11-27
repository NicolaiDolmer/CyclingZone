// #4629 · /api/training/programs — traeningsprogrammer pr. loebsdag (BETA 26/9).
//
// EGEN route-fil (samme fabrik-moenster som api/featureFlagsApi.js): api.js er
// stor og deles af mange laner, og testen kan give routeren en fake Supabase
// uden at starte hele api.js. Monteres i api.js FOER `/training/:riderId`, saa
// "programs" aldrig matches som et rytter-id.
//
// Gate: stadie-flaget `training_programs` (trainingProgramsFlag.js) evalueret
// mod VIEWERENS beta-status server-side. Flag off/ikke-beta → GET svarer
// { enabled: false }, og skrivestierne svarer 404 (funktionen findes ikke for
// spilleren).
//
// Ejer-valg 1 (26/9): KOPI ved tildeling. Tildeling skriver en selvstaendig
// 7-dages kopi ind i rytterens egen raekke i training_week_plans (lag 1 i
// stigen, TRAINING_RULES §4), med `program_key` som ren proveniens. "Hele
// truppen" = en kopi pr. rytter, ikke holdets raekke: holdets raekke er lag 3
// og taber til rytterens egen eksplicitte plan (#2438), saa et klik paa "hele
// truppen" ville ellers ikke ramme de fleste ryttere.
//
// #5932 (ejer 29/9): FELTERNE har sit eget flag, `training_program_cells`
// (trainingWeekPlanCellsFlag.js). Kataloget og "Brug program" bliver bag
// `training_programs`; at rette et felt (PUT /cell) og prognosen (GET /forecast,
// #5933) foelger felt-flaget. En rytter uden felter faar sin uge saaet ved
// foerste rettelse (trainingWeekPlanCells.js), og GET leverer de saaede uger,
// saa gitteret viser praecis det serveren vil skrive.

import express from "express";
import { WEEKDAY_KEYS } from "../lib/training.js";
import {
  PROGRAM_SLOTS, findTrainingProgram, programWeekDaysFor, setProgramCell, isValidProgramWeekDays,
  trainingProgramCatalog, isProgramSession,
} from "../lib/trainingPrograms.js";
import { isTrainingProgramsEnabled } from "../lib/trainingProgramsFlag.js";
import { isTrainingCellsEnabled } from "../lib/trainingWeekPlanCellsFlag.js";
import { isV3OnlySession, isTrainingCatalogV3EnabledForViewer, v3SmartDefaultFocus } from "../lib/trainingCatalogV3.js"; // #5319
import { seedProgramWeekDays, planRunsOffStandard } from "../lib/trainingWeekPlanCells.js";
import { effortForWrite, isTrainingEffortLevelsEnabled } from "../lib/trainingEffortLevels.js"; // #7947
import { loadTeamFatigueForecast } from "../lib/trainingWeekPlanForecast.js";
import { isTrainingWeekForecastEnabled, loadTeamWeekForecast } from "../lib/trainingWeekForecast.js"; // #8580
import { markRidersOwnPlan, syncGroupsToSquadProgram, isMissingGroupsTable } from "../lib/trainingGroups.ts"; // #6000
import { isTrainingRotationEnabled } from "../lib/trainingRotationFlag.js"; // #8548
import { rotationWriteInput, rotationView } from "../lib/trainingRotationInput.js"; // #8548
import { applyRotationWrite, rotationRevFloor } from "../lib/trainingRotation.js"; // #8548
import { isWeekPriorityEditorEnabled, loadWeekPrioritySettled, setWeekBlockDay, weekBlockDayWrite } from "../lib/trainingWeekEditor.js";
import { attachDayOverrides, createDayOverrideRouter, fatigueRuleMarksAhead, isDayOverrideEnabledForRequest, loadWeekDateOverrides } from "../lib/trainingDayOverride8592.js"; // #8592
import { loadTeamFatigueRules } from "../lib/trainingFatigueRules.ts"; // #8819 DO-10
import { copenhagenDateString } from "../lib/copenhagenTime.js";

const PASS = (_req, _res, next) => next();

// 42703 = ukendt kolonne: backend kan deploye foer auto-migrate.yml har tilfoejet
// `program_key` (#2642, ~3 min). Saa skrives/laeses uden proveniens i stedet
// for at fejle.
const isMissingColumn = (error) => error?.code === "42703";

export async function loadProgramRows(supabase, teamId) {
  // schema-columns-ok: program_key tilfoejes af database/2026-09-26-4629-training-programs.sql, applied post-merge.
  const withKey = await supabase.from("training_week_plans")
    .select("id, rider_id, days, program_key")
    .eq("team_id", teamId);
  if (!isMissingColumn(withKey.error)) return withKey;
  return supabase.from("training_week_plans").select("id, rider_id, days").eq("team_id", teamId);
}

async function updateRow(supabase, id, patch) {
  const first = await supabase.from("training_week_plans").update(patch).eq("id", id);
  if (!isMissingColumn(first.error)) return first;
  const { program_key: _drop, ...rest } = patch;
  return supabase.from("training_week_plans").update(rest).eq("id", id);
}

async function insertRows(supabase, rows) {
  if (rows.length === 0) return { error: null };
  const first = await supabase.from("training_week_plans").insert(rows);
  if (!isMissingColumn(first.error)) return first;
  return supabase.from("training_week_plans").insert(rows.map(({ program_key: _drop, ...rest }) => rest));
}

export function createTrainingProgramsRouter({
  supabase, requireAuth, isViewerBetaTester, writeLimiter = PASS, readLimiter = PASS, captureExceptionFn = () => {},
  // #4847: "Train now" laaser dagens felter (backend/lib/trainNow.js). Default = ingen laas.
  planLock = () => PASS,
  // Codex P1 paa #8532 (AGENTS: tests laeser aldrig vaegurets tid): tidsstempler fra en injicerbar klokke.
  clock = () => new Date(),
}) {
  const router = express.Router();

  async function programsOn(req) {
    const isBetaTester = await isViewerBetaTester(req);
    return isTrainingProgramsEnabled(supabase, { isBetaTester });
  }

  // #5932: felterne (rette et felt, prognosen) foelger felt-flaget.
  async function cellsOn(req) {
    const isBetaTester = await isViewerBetaTester(req);
    return isTrainingCellsEnabled(supabase, { isBetaTester });
  }

  // #8592: "Kun denne dag" (/day-overrides) og datoens valg i prognoserne, bag sin egen kontakt.
  // #8819 DO-10: graensens markering for i morgen, som dagsvaelgeren viser den (dagens prognose, samme gate).
  async function fatigueRuleMarksFor(req, now, today) {
    if (!today?.available) return new Map();
    return fatigueRuleMarksAhead({ today, rules: await loadTeamFatigueRules(supabase, req.team.id) });
  }
  async function fatigueRuleAhead(req) {
    const now = clock();
    const todayStr = copenhagenDateString(now);
    if (!(await cellsOn(req))) return new Map();
    const seasonId = await activeSeasonId();
    const dateOverrideByRider = (await dayOverridesFor(req, now))?.get(todayStr) ?? null;
    return fatigueRuleMarksFor(req, now, await loadTeamFatigueForecast({ supabase, team: req.team, seasonId, now, dateOverrideByRider }));
  }
  router.use("/day-overrides", createDayOverrideRouter({ supabase, requireAuth, isViewerBetaTester, writeLimiter, readLimiter, captureExceptionFn, clock, fatigueRuleAhead }));
  async function dayOverridesFor(req, now) {
    if (!(await isDayOverrideEnabledForRequest(supabase, req, isViewerBetaTester))) return null; // #8834 Fable 4: ejer som motoren
    return loadWeekDateOverrides({ supabase, teamId: req.team.id, today: copenhagenDateString(now) });
  }

  // #8548: rotationen foelger sin egen kontakt (training_rotation) mod viewerens beta-status.
  async function rotationOn(req) {
    const isBetaTester = await isViewerBetaTester(req);
    return isTrainingRotationEnabled(supabase, { isBetaTester });
  }

  // #8548: kolonnerne findes foerst efter migrationen, og flag-raekken oprettes af samme
  // migration; derfor laeses de kun med kontakten on.
  async function rotationRows(teamId) {
    const { data, error } = await supabase.from("training_week_plans")
      // schema-columns-ok: rotation + plan_kind tilfoejes af database/2026-11-22-8548-training-rotation.sql (post-merge); kun laest med flaget on.
      .select("id, rider_id, days, rotation, plan_kind")
      .eq("team_id", teamId);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  // GET-svarets rotation-del. Kontakten off = ingen noegler (svaret er praecis som foer).
  async function rotationPayload(req) {
    if (!(await rotationOn(req))) return {};
    const rotations = {};
    for (const row of await rotationRows(req.team.id)) {
      if (row.rider_id == null) continue;
      const view = rotationView(row);
      if (view.planKind || view.rotation) rotations[row.rider_id] = view;
    }
    return { rotationEnabled: true, rotations };
  }

  async function ownRiders(teamId) {
    const { data, error } = await supabase
      // pagination-safe: one team roster (senior + academy), far below the 1000-row cap.
      .from("riders").select("id, primary_type, secondary_type").eq("team_id", teamId).eq("is_retired", false);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function ownRiderIds(teamId) {
    return (await ownRiders(teamId)).map((r) => r.id);
  }

  async function activeSeasonId() {
    const { data, error } = await supabase.from("seasons").select("id").eq("status", "active").maybeSingle();
    if (error) throw new Error(error.message);
    return data?.id ?? null;
  }

  // training_plans for den aktive saeson (samme filter som motoren).
  async function teamPlans(teamId) {
    const seasonId = await activeSeasonId();
    if (!seasonId) return new Map();
    const { data, error } = await supabase
      // pagination-safe: one row per rider on one team roster.
      .from("training_plans").select("rider_id, focus, intensity").eq("team_id", teamId).eq("season_id", seasonId);
    if (error) throw new Error(error.message);
    return new Map((data ?? []).map((row) => [row.rider_id, row]));
  }

  // De saaede uger for ryttere uden felter (#5932): det gitteret viser, og det
  // PUT /cell skriver ved foerste rettelse. Ryttere MED felter er ikke med.
  // #5319: v3-saaningen (tt/gc uden plan paa itt_long) foelger viewerens katalog.
  // Flaget slaas kun op, naar mindst een rytter uden plan ville blive flyttet.
  async function seedCatalogV3(req, riders, plansByRider) {
    const affected = riders.some((r) => !(plansByRider.get(r.id)?.focus && plansByRider.get(r.id)?.intensity) && v3SmartDefaultFocus("threshold", r, { v3: true }) !== "threshold");
    return affected ? isTrainingCatalogV3EnabledForViewer(supabase, () => isViewerBetaTester(req)) : false;
  }

  // #7947: kontakten slaas kun op, naar en rytter der skal saaes har en plan paa et andet
  // niveau end sessionens standard (kun muligt med kontakten on). Ellers intet opslag.
  async function seedEffortLevels(riders, plansByRider) {
    return riders.some((r) => planRunsOffStandard(plansByRider.get(r.id))) ? isTrainingEffortLevelsEnabled(supabase) : false;
  }

  function seedsFor(riders, rows, plansByRider, catalogV3 = false, effortLevels = false) {
    const teamDays = (rows ?? []).find((r) => r.rider_id == null)?.days ?? null;
    const seeds = {};
    for (const rider of riders) {
      const riderDays = (rows ?? []).find((r) => r.rider_id === rider.id)?.days ?? null;
      if (isValidProgramWeekDays(riderDays)) continue;
      seeds[rider.id] = seedProgramWeekDays({
        riderDays, teamDays, plan: plansByRider.get(rider.id) ?? null, primaryType: rider.primary_type ?? null,
        secondaryType: rider.secondary_type ?? null, catalogV3, effortLevels,
      });
    }
    return seeds;
  }

  // GET /api/training/programs — kataloget + hvilke ryttere der staar paa hvilket
  // program (proveniens). Selve cellerne leveres af /api/training/me
  // (riderWeekPlans), saa der kun er een kilde til planen. #5932: `cellsEnabled`
  // + `seeds` naar felterne er aabne (ogsaa uden kataloget).
  router.get("/", requireAuth, readLimiter, async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    try {
      const [catalogOn, cellsEnabled] = await Promise.all([programsOn(req), cellsOn(req)]);
      if (!catalogOn && !cellsEnabled) return res.json({ enabled: false, cellsEnabled: false });
      const { data: rows, error } = await loadProgramRows(supabase, req.team.id);
      if (error) throw new Error(error.message);
      const assigned = {};
      for (const row of rows ?? []) {
        if (row.rider_id != null && row.program_key && isValidProgramWeekDays(row.days)) {
          assigned[row.rider_id] = row.program_key;
        }
      }
      let seeds = {};
      if (cellsEnabled) {
        const [riders, plansByRider] = await Promise.all([ownRiders(req.team.id), teamPlans(req.team.id)]);
        seeds = seedsFor(riders, rows, plansByRider, await seedCatalogV3(req, riders, plansByRider), await seedEffortLevels(riders, plansByRider));
      }
      const weekPriorityEnabled = cellsEnabled && await isWeekPriorityEditorEnabled(supabase, await isViewerBetaTester(req));
      let priorityPayload = {};
      if (weekPriorityEnabled) {
        // pagination-safe: one team roster and its default week row.
        const { data, error } = await supabase.from("training_week_plans").select("rider_id")
          .eq("team_id", req.team.id).eq("plan_kind", "week");
        if (error) throw new Error(error.message);
        priorityPayload = { weekPriorityEnabled, weekPriorityPlans: (data ?? []).map((row) => row.rider_id).filter(Boolean) };
      }
      res.json({
        enabled: catalogOn,
        cellsEnabled,
        slots: PROGRAM_SLOTS,
        catalog: catalogOn ? trainingProgramCatalog() : [],
        assigned,
        seeds,
        ...(await rotationPayload(req)),
        ...priorityPayload,
      });
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
    }
  });

  // #4522: ryttere der foelger en traeningsgruppe (#6000). Manglende tabel = ingen.
  async function groupFollowerIds(teamId) {
    const { data, error } = await supabase
      // pagination-safe: one team's group memberships, far below the 1000-row cap.
      .from("training_group_members").select("rider_id, follows_group").eq("team_id", teamId);
    if (error) {
      if (isMissingGroupsTable(error)) return new Set();
      throw new Error(error.message);
    }
    return new Set((data ?? []).filter((m) => m.follows_group !== false).map((m) => m.rider_id));
  }

  // Assistentens program til en valgt gruppe (keepOwn): kopierer kun ind til
  // ryttere UDEN egen ugeplan-raekke og som ikke foelger en gruppe. De andre
  // springes over og rapporteres i `skipped` — en egen plan vinder altid.
  async function applyToPickedRiders(res, { program, teamId, ownIds, pickedIds }) {
    const own = new Set(ownIds);
    let picked = [...new Set(pickedIds)];
    // Pensionerede ryttere paa holdet staar stadig i traeningssidens roster, men faar
    // intet program: de tael som sprunget over i stedet for at fejle hele kaldet (403).
    let retiredPicked = 0;
    if (!picked.every((id) => own.has(id))) {
      const { data: retired, error: retiredError } = await supabase
        // pagination-safe: one team roster, far below the 1000-row cap.
        .from("riders").select("id").eq("team_id", teamId).eq("is_retired", true);
      if (retiredError) throw new Error(retiredError.message);
      const retiredIds = new Set((retired ?? []).map((r) => r.id));
      const foreign = picked.filter((id) => !own.has(id) && !retiredIds.has(id));
      if (foreign.length > 0) return res.status(403).json({ error: "not_own_rider" });
      retiredPicked = picked.filter((id) => retiredIds.has(id)).length;
      picked = picked.filter((id) => own.has(id));
    }
    const [{ data: rows, error: loadError }, followers] = await Promise.all([
      loadProgramRows(supabase, teamId), groupFollowerIds(teamId),
    ]);
    if (loadError) throw new Error(loadError.message);
    const hasOwnRow = new Set((rows ?? []).filter((r) => r.rider_id != null).map((r) => r.rider_id));
    const targets = picked.filter((id) => !hasOwnRow.has(id) && !followers.has(id));
    const skipped = picked.length - targets.length + retiredPicked;
    if (targets.length === 0) return res.json({ ok: true, applied: 0, skipped, programKey: program.key });
    const now = clock().toISOString();
    const { error } = await insertRows(supabase, targets.map((riderId) => ({
      // En NY kopi pr. rytter — ingen delte objekter mellem raekkerne.
      team_id: teamId, rider_id: riderId, days: programWeekDaysFor(program.key), program_key: program.key, updated_at: now,
    })));
    if (error) {
      captureExceptionFn(new Error(`training programs apply picked failed (0/${targets.length}): ${error.message}`));
      return res.status(500).json({ error: "partial_apply", applied: 0, total: targets.length });
    }
    return res.json({ ok: true, applied: targets.length, skipped, programKey: program.key });
  }

  // POST /api/training/programs/apply — body { programKey, target: "squad" | <riderId> }
  // eller (#4522) { programKey, riderIds: [...], keepOwn: true }.
  // Kopierer programmet ind i hver maal-rytters egen raekke.
  router.post("/apply", requireAuth, writeLimiter, planLock("programApply"), async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    const { programKey, target, riderIds: pickedIds, keepOwn } = req.body ?? {};
    const program = findTrainingProgram(programKey);
    if (!program) return res.status(400).json({ error: "invalid_program" });
    // #4522: assistentens programforslag pr. rytter-gruppe. Egen sti: en liste af
    // ryttere, og `keepOwn:true` er pligt (intet her overskriver en egen plan).
    const pickMode = pickedIds !== undefined;
    if (pickMode) {
      const validPick = Array.isArray(pickedIds) && pickedIds.length > 0 && pickedIds.every((id) => typeof id === "string" && id);
      if (!validPick || keepOwn !== true) return res.status(400).json({ error: "invalid_target" });
    } else if (typeof target !== "string" || !target) return res.status(400).json({ error: "invalid_target" });
    try {
      if (!(await programsOn(req))) return res.status(404).json({ error: "not_found" });
      const teamId = req.team.id;
      const riderIds = await ownRiderIds(teamId);
      if (pickMode) return await applyToPickedRiders(res, { program, teamId, ownIds: riderIds, pickedIds });
      let targets;
      if (target === "squad") targets = riderIds;
      else if (riderIds.includes(target)) targets = [target];
      else return res.status(403).json({ error: "not_own_rider" });
      if (targets.length === 0) return res.json({ ok: true, applied: 0 });
      // #8776 (ejer 26/11): ugeprioritet er opt-in. At saette et program paa roerer aldrig
      // plan_kind; kun en Week blocks-skrivning (PUT /cell med weekBlock) eller et eksplicit
      // skift i Plantype (PUT /rotation { planKind }) saetter markoeren. Et `planKind` i
      // body'en (ogsaa fra en gammel klient) ignoreres her.
      // #6000: en rytter-tildeling er rytterens egen plan (vinder over gruppen). Foer skrivningen.
      if (target !== "squad") await markRidersOwnPlan(supabase, teamId, targets);

      const { data: rows, error: loadError } = await loadProgramRows(supabase, teamId);
      if (loadError) throw new Error(loadError.message);
      const existingByRider = new Map(
        (rows ?? []).filter((r) => r.rider_id != null).map((r) => [r.rider_id, r.id]),
      );
      const now = clock().toISOString();
      const inserts = [];
      const updates = [];
      for (const riderId of targets) {
        // En NY kopi pr. rytter — ingen delte objekter mellem raekkerne.
        const days = programWeekDaysFor(program.key);
        const existingId = existingByRider.get(riderId);
        const patch = { days, program_key: program.key, updated_at: now };
        if (existingId) updates.push({ id: existingId, patch });
        else inserts.push({ team_id: teamId, rider_id: riderId, ...patch });
      }
      // Ikke atomisk (PostgREST kan ikke upserte paa det partielle unikke index,
      // se PUT /training/week-plan/:riderId i api.js). Hver skrivning er
      // idempotent, saa et nyt klik goer arbejdet faerdigt; svaret siger derfor
      // praecis hvor mange ryttere der fik programmet (CodeRabbit-fund).
      let applied = 0;
      let firstError = null;
      for (const { id, patch } of updates) {
        const { error } = await updateRow(supabase, id, patch);
        if (error) { firstError ??= error; continue; }
        applied += 1;
      }
      const { error: insError } = await insertRows(supabase, inserts);
      if (insError) firstError ??= insError;
      else applied += inserts.length;
      if (firstError) {
        captureExceptionFn(new Error(`training programs apply partial (${applied}/${targets.length}): ${firstError.message}`));
        return res.status(500).json({ error: "partial_apply", applied, total: targets.length });
      }
      // #6000: "hele truppen" saetter ogsaa gruppernes plan, saa de ikke siger noget andet.
      if (target === "squad") await syncGroupsToSquadProgram(supabase, teamId, program.key, programWeekDaysFor(program.key), captureExceptionFn);
      res.json({ ok: true, applied, programKey: program.key });
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/training/programs/cell — body { riderId, weekday, slotIndex (null = hele
  // ugedagen, 0-4 = een loebsdag), session, effort? }. Spillerens klik paa EEN celle.
  // #7947: `effort` (easy/normal/hard, null = foelg) gemmes kun med training_effort_levels on.
  // Proveniensen bevares (UI'et viser "Sprinter · 2 aendret").
  router.put("/cell", requireAuth, writeLimiter, planLock("programCell"), async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    const { riderId, weekday, slotIndex = null, session } = req.body ?? {};
    if (!WEEKDAY_KEYS.includes(weekday)) return res.status(400).json({ error: "invalid_weekday" });
    if (!isProgramSession(session)) return res.status(400).json({ error: "invalid_session" });
    if (slotIndex != null && !(Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < PROGRAM_SLOTS)) {
      return res.status(400).json({ error: "invalid_slot" });
    }
    try {
      if (!(await cellsOn(req))) return res.status(404).json({ error: "not_found" });
      const weekEnabled = req.body?.weekBlock !== undefined
        ? await isWeekPriorityEditorEnabled(supabase, await isViewerBetaTester(req))
        : false;
      const blockWrite = await weekBlockDayWrite(supabase, req.body ?? {}, {
        enabled: weekEnabled, v3Only: isV3OnlySession,
        allowsV3: () => isTrainingCatalogV3EnabledForViewer(supabase, () => isViewerBetaTester(req)),
      });
      if (!blockWrite.ok) return res.status(blockWrite.status).json({ error: blockWrite.reason });
      // #7947: indsatsen gemmes kun med kontakten on; ikke sendt = intet opslag, som i dag.
      const effortWrite = await effortForWrite(supabase, req.body?.effort);
      if (!effortWrite.ok) return res.status(400).json({ error: effortWrite.reason });
      // #5319: en v3-session kan kun vaelges naar training_catalog_v3 er aaben for viewer.
      if (isV3OnlySession(session) && !(await isTrainingCatalogV3EnabledForViewer(supabase, () => isViewerBetaTester(req)))) {
        return res.status(400).json({ error: "invalid_session" });
      }
      const teamId = req.team.id;
      const riders = await ownRiders(teamId);
      const rider = riders.find((r) => r.id === riderId);
      if (!rider) return res.status(403).json({ error: "not_own_rider" });
      const { data: rows, error: loadError } = await loadProgramRows(supabase, teamId);
      if (loadError) throw new Error(loadError.message);
      const row = (rows ?? []).find((r) => r.rider_id === riderId) ?? null;
      // #5932: en rytter uden felter faar sin uge saaet foerst (samme saaning som
      // GET viser), og saa rettes feltet.
      const current = row && isValidProgramWeekDays(row.days)
        ? row.days
        : await (async () => {
          const plans = await teamPlans(teamId);
          return seedsFor([rider], rows, plans, await seedCatalogV3(req, [rider], plans), await seedEffortLevels([rider], plans))[riderId];
        })();
      const days = blockWrite.block
        ? setWeekBlockDay(current, weekday, blockWrite.block)
        : setProgramCell(current, { weekday, slotIndex, session, effort: effortWrite.effort });
      if (!days) return res.status(400).json({ error: "invalid_cell" });
      await markRidersOwnPlan(supabase, teamId, [riderId]); // #6000: egen plan vinder over gruppen. Foer skrivningen.
      const now = clock().toISOString();
      // #8776: kun en Week blocks-skrivning (prioritet/laas) er managerens valg af ugeprioritet;
      // et almindeligt felt lader plan_kind vaere, som det var.
      const patch = { days, updated_at: now, ...(blockWrite.block ? { plan_kind: "week" } : {}) };
      const { error } = row
        ? await updateRow(supabase, row.id, patch)
        : await insertRows(supabase, [{ team_id: teamId, rider_id: riderId, ...patch }]);
      if (error) throw new Error(error.message);
      res.json({ ok: true, riderId, days });
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/training/programs/rotation — body { riderId, planKind?, passes?, keepPlace?, startIndex? }
  // (#8548). Rytterens egen rotation og markoeren plan_kind ('week' | 'rotation').
  // Kontakten off = 409 feature_disabled og intet skrives. Pladsen gemmes ikke her:
  // den stemples paa kvitteringen af motoren (PR 2), og rev + anker afgoer hvor
  // rotationen fortsaetter (lib/trainingRotation.js). En rettelse er rytterens egen
  // plan og vinder over gruppen (#6000), som et felt.
  router.put("/rotation", requireAuth, writeLimiter, planLock("programApply"), async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    try {
      if (!(await rotationOn(req))) return res.status(409).json({ error: "feature_disabled" });
      const riderId = req.body?.riderId;
      if (typeof riderId !== "string" || !riderId) return res.status(400).json({ error: "invalid_rider" });
      const input = await rotationWriteInput(supabase, req.body, { viewerIsBeta: () => isViewerBetaTester(req) });
      if (!input.ok) return res.status(400).json({ error: input.reason });
      const teamId = req.team.id;
      const riders = await ownRiders(teamId);
      const rider = riders.find((r) => r.id === riderId);
      if (!rider) return res.status(403).json({ error: "not_own_rider" });
      const rows = await rotationRows(teamId);
      const row = rows.find((r) => r.rider_id === riderId) ?? null;
      const at = clock();
      const next = applyRotationWrite({ prev: row?.rotation ?? null, prevKind: row?.plan_kind ?? null, write: input.write, passes: input.passes, revFloor: rotationRevFloor(at) });
      if (!next.ok) return res.status(400).json({ error: next.reason });
      await markRidersOwnPlan(supabase, teamId, [riderId]); // #6000: egen plan vinder over gruppen. Foer skrivningen.
      const now = at.toISOString();
      const patch = { ...(next.rotationChanged ? { rotation: next.rotation } : {}), plan_kind: next.planKind, updated_at: now };
      let error;
      if (row) {
        ({ error } = await supabase.from("training_week_plans").update(patch).eq("id", row.id));
      } else {
        // En rytter uden raekke faar sin uge saaet (som PUT /cell), saa Week blocks og
        // motoren altid har gyldige felter at falde tilbage paa.
        const plans = await teamPlans(teamId);
        const days = seedsFor([rider], rows, plans, await seedCatalogV3(req, [rider], plans), await seedEffortLevels([rider], plans))[riderId];
        ({ error } = await supabase.from("training_week_plans").insert([{ team_id: teamId, rider_id: riderId, days, ...patch }]));
      }
      if (error) throw new Error(error.message);
      res.json({ ok: true, riderId, ...rotationView({ rotation: next.rotation, plan_kind: next.planKind }) });
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/training/programs/forecast — "Traethed i aften: ca. X" pr. rytter
  // (#5933). Beregnet af aftenopgoerelsens egne funktioner
  // (trainingWeekPlanForecast.js, invariant I5). Kun tallet og et farvebaand
  // forlader serveren; ingen formel.
  router.get("/forecast", requireAuth, readLimiter, async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    try {
      if (!(await cellsOn(req))) return res.json({ available: false, reason: "disabled", riders: {} });
      const seasonId = await activeSeasonId();
      const now = clock();
      const dateOverrideByRider = (await dayOverridesFor(req, now))?.get(copenhagenDateString(now)) ?? null; // #8592
      const forecast = await loadTeamFatigueForecast({ supabase, team: req.team, seasonId, now, dateOverrideByRider });
      if (forecast.available && await isWeekPriorityEditorEnabled(supabase, await isViewerBetaTester(req))) {
        forecast.weekPrioritySettled = await loadWeekPrioritySettled({ supabase, teamId: req.team.id, seasonId, tickDate: forecast.tickDate });
      }
      res.json(forecast);
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/training/programs/forecast/week — #8580 / #8550 del 3: den rullende uge (i dag + 7, 8 datoer; Program bruger de første 7).
  // Bag training_week_forecast (off/beta/on, seedet off). Dag 0 er GET /forecast's svar
  // uændret, med samme gate; de andre dage har kun løbs- og hvilefelter (ingen træthed, K-7).
  router.get("/forecast/week", requireAuth, readLimiter, async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    try {
      const isBetaTester = await isViewerBetaTester(req);
      if (!(await isTrainingWeekForecastEnabled(supabase, { isBetaTester }))) {
        return res.json({ available: false, reason: "disabled", days: [] });
      }
      const seasonId = await activeSeasonId();
      const now = clock();
      const dayOverrides = await dayOverridesFor(req, now); // #8592
      const week = await loadTeamWeekForecast({
        supabase, team: req.team, seasonId, now, dayOverrides,
        loadToday: async () => ((await cellsOn(req))
          ? loadTeamFatigueForecast({ supabase, team: req.team, seasonId, now, dateOverrideByRider: dayOverrides?.get(copenhagenDateString(now)) ?? null })
          : { available: false, reason: "disabled", riders: {} }),
      });
      // #8819 DO-10: kun med kontakten (dayOverrides != null) faar i morgen graensens markering.
      const ruleMarks = dayOverrides ? await fatigueRuleMarksFor(req, now, week.days?.[0]?.today) : null;
      res.json(attachDayOverrides(week, dayOverrides, { ruleMarks }));
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
