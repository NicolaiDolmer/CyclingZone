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

import express from "express";
import { WEEKDAY_KEYS } from "../lib/training.js";
import {
  PROGRAM_SLOTS, findTrainingProgram, programWeekDaysFor, setProgramCell, isValidProgramWeekDays,
  trainingProgramCatalog, isProgramSession,
} from "../lib/trainingPrograms.js";
import { isTrainingProgramsEnabled } from "../lib/trainingProgramsFlag.js";

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
  supabase, requireAuth, isViewerBetaTester, writeLimiter = PASS, captureExceptionFn = () => {},
}) {
  const router = express.Router();

  async function programsOn(req) {
    const isBetaTester = await isViewerBetaTester(req);
    return isTrainingProgramsEnabled(supabase, { isBetaTester });
  }

  async function ownRiderIds(teamId) {
    const { data, error } = await supabase
      // pagination-safe: one team roster (senior + academy), far below the 1000-row cap.
      .from("riders").select("id").eq("team_id", teamId).eq("is_retired", false);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.id);
  }

  // GET /api/training/programs — kataloget + hvilke ryttere der staar paa hvilket
  // program (proveniens). Selve cellerne leveres af /api/training/me
  // (riderWeekPlans), saa der kun er een kilde til planen.
  router.get("/", requireAuth, async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    try {
      if (!(await programsOn(req))) return res.json({ enabled: false });
      const { data: rows, error } = await loadProgramRows(supabase, req.team.id);
      if (error) throw new Error(error.message);
      const assigned = {};
      for (const row of rows ?? []) {
        if (row.rider_id != null && row.program_key && isValidProgramWeekDays(row.days)) {
          assigned[row.rider_id] = row.program_key;
        }
      }
      res.json({ enabled: true, slots: PROGRAM_SLOTS, catalog: trainingProgramCatalog(), assigned });
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/training/programs/apply — body { programKey, target: "squad" | <riderId> }.
  // Kopierer programmet ind i hver maal-rytters egen raekke.
  router.post("/apply", requireAuth, writeLimiter, async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    const { programKey, target } = req.body ?? {};
    const program = findTrainingProgram(programKey);
    if (!program) return res.status(400).json({ error: "invalid_program" });
    if (typeof target !== "string" || !target) return res.status(400).json({ error: "invalid_target" });
    try {
      if (!(await programsOn(req))) return res.status(404).json({ error: "not_found" });
      const teamId = req.team.id;
      const riderIds = await ownRiderIds(teamId);
      let targets;
      if (target === "squad") targets = riderIds;
      else if (riderIds.includes(target)) targets = [target];
      else return res.status(403).json({ error: "not_own_rider" });
      if (targets.length === 0) return res.json({ ok: true, applied: 0 });

      const { data: rows, error: loadError } = await loadProgramRows(supabase, teamId);
      if (loadError) throw new Error(loadError.message);
      const existingByRider = new Map(
        (rows ?? []).filter((r) => r.rider_id != null).map((r) => [r.rider_id, r.id]),
      );
      const now = new Date().toISOString();
      const inserts = [];
      const updates = [];
      for (const riderId of targets) {
        // En NY kopi pr. rytter — ingen delte objekter mellem raekkerne.
        const days = programWeekDaysFor(program.key);
        const existingId = existingByRider.get(riderId);
        if (existingId) updates.push({ id: existingId, patch: { days, program_key: program.key, updated_at: now } });
        else inserts.push({ team_id: teamId, rider_id: riderId, days, program_key: program.key, updated_at: now });
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
      res.json({ ok: true, applied, programKey: program.key });
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/training/programs/cell — body { riderId, weekday, slotIndex (null = hele
  // ugedagen, 0-4 = een loebsdag), session }. Spillerens klik paa EEN celle.
  // Proveniensen bevares (UI'et viser "Sprinter · 2 aendret").
  router.put("/cell", requireAuth, writeLimiter, async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    const { riderId, weekday, slotIndex = null, session } = req.body ?? {};
    if (!WEEKDAY_KEYS.includes(weekday)) return res.status(400).json({ error: "invalid_weekday" });
    if (!isProgramSession(session)) return res.status(400).json({ error: "invalid_session" });
    if (slotIndex != null && !(Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < PROGRAM_SLOTS)) {
      return res.status(400).json({ error: "invalid_slot" });
    }
    try {
      if (!(await programsOn(req))) return res.status(404).json({ error: "not_found" });
      const teamId = req.team.id;
      const riderIds = await ownRiderIds(teamId);
      if (!riderIds.includes(riderId)) return res.status(403).json({ error: "not_own_rider" });
      const { data: rows, error: loadError } = await loadProgramRows(supabase, teamId);
      if (loadError) throw new Error(loadError.message);
      const row = (rows ?? []).find((r) => r.rider_id === riderId);
      if (!row || !isValidProgramWeekDays(row.days)) return res.status(409).json({ error: "no_program" });
      const days = setProgramCell(row.days, { weekday, slotIndex, session });
      if (!days) return res.status(400).json({ error: "invalid_cell" });
      const { error } = await updateRow(supabase, row.id, { days, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      res.json({ ok: true, riderId, days });
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
