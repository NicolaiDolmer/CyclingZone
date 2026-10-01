// #6000 · /api/training/groups — traeningsgrupper (BETA, ejer-godkendt mockup 1/10).
//
// Samme fabrik-moenster som routes/trainingPrograms.js: egen fil, fake Supabase i
// testen, monteret i api.js FOER `/training/:riderId`.
//
// Gate: stadie-flaget `training_groups` mod VIEWERENS beta-status, OG felterne
// (`training_program_cells`), fordi en gruppe-plan ER 35 felter. Off → GET svarer
// { enabled: false }, skrivestierne 404.
//
//   GET    /                 grupper, medlemmer, gruppens felter (eller startpunkt)
//   POST   /                 { name, riderIds }         opret (flytter ryttere fra en anden gruppe)
//   PATCH  /:id              { name?, riderIds? }       omdoeb / saet medlemmer
//   DELETE /:id                                         slet (rytterne beholder deres plan)
//   PUT    /:id/cell         { weekday, slotIndex, session }  et felt for hele gruppen
//   POST   /:id/program      { programKey }             "Put on" et program paa gruppen
//   POST   /:id/follow       { riderIds }               rytterne foelger gruppen igen
//   PUT    /:id/fatigue      { mode, threshold?, fallback? }  traethedsundtagelse for hele gruppen
//
// Planen skrives som KOPI ind i hver foelgende rytters egen raekke i
// training_week_plans (lib/trainingGroups.ts). "Train now"-laasen (#4847) gaelder
// som for rytterens egne felter.

import express from "express";
import { WEEKDAY_KEYS } from "../lib/training.js";
import {
  PROGRAM_SLOTS, findTrainingProgram, programWeekDaysFor, setProgramCell, isValidProgramWeekDays, isProgramSession,
} from "../lib/trainingPrograms.js";
import { isTrainingCellsEnabled } from "../lib/trainingWeekPlanCellsFlag.js";
import { seedProgramWeekDays } from "../lib/trainingWeekPlanCells.js";
import {
  GROUPS_TABLE, MEMBERS_TABLE, isTrainingGroupsEnabled, loadTeamGroups, normalizeGroupName, sanitizeRiderIds,
  followerIds, groupSeedDays, groupFatiguePatch, copyWeekDays,
} from "../lib/trainingGroups.ts";

const PASS = (_req, _res, next) => next();

// Koerer en laase-middleware inde i en handler. true = videre; false = svaret er sendt.
async function passes(middleware, req, res) {
  let passed = false;
  await middleware(req, res, () => { passed = true; });
  return passed;
}

export function createTrainingGroupsRouter({
  supabase, requireAuth, isViewerBetaTester, writeLimiter = PASS, readLimiter = PASS, captureExceptionFn = () => {},
  planLock = () => PASS,
}) {
  const router = express.Router();

  async function groupsOn(req) {
    const isBetaTester = await isViewerBetaTester(req);
    const [groups, cells] = await Promise.all([
      isTrainingGroupsEnabled(supabase, { isBetaTester }),
      isTrainingCellsEnabled(supabase, { isBetaTester }),
    ]);
    return groups && cells;
  }

  async function ownRiders(teamId) {
    const { data, error } = await supabase
      // pagination-safe: one team roster (senior + academy), far below the 1000-row cap.
      .from("riders").select("id, primary_type").eq("team_id", teamId).eq("is_retired", false);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function weekRows(teamId) {
    const { data, error } = await supabase.from("training_week_plans").select("id, rider_id, days").eq("team_id", teamId);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function plansByRider(teamId) {
    const { data: season, error: seasonError } = await supabase.from("seasons").select("id").eq("status", "active").maybeSingle();
    if (seasonError) throw new Error(seasonError.message);
    if (!season?.id) return new Map();
    const { data, error } = await supabase
      // pagination-safe: one row per rider on one team roster.
      .from("training_plans").select("rider_id, focus, intensity").eq("team_id", teamId).eq("season_id", season.id);
    if (error) throw new Error(error.message);
    return new Map((data ?? []).map((row) => [row.rider_id, row]));
  }

  // Alt en gruppe-beregning skal bruge, i eet hug.
  async function context(teamId) {
    const [riders, rows, { groups, members }, plans] = await Promise.all([
      ownRiders(teamId), weekRows(teamId), loadTeamGroups(supabase, teamId), plansByRider(teamId),
    ]);
    const ownIds = riders.map((r) => r.id);
    const teamDays = rows.find((r) => r.rider_id == null)?.days ?? null;
    const ownDaysByRider = new Map(rows.filter((r) => r.rider_id != null).map((r) => [r.rider_id, r.days]));
    const seeds = {};
    for (const rider of riders) {
      const riderDays = ownDaysByRider.get(rider.id) ?? null;
      if (isValidProgramWeekDays(riderDays)) continue;
      seeds[rider.id] = seedProgramWeekDays({
        riderDays, teamDays, plan: plans.get(rider.id) ?? null, primaryType: rider.primary_type ?? null,
      });
    }
    return { riders, ownIds, rows, groups, members, ownDaysByRider, seeds };
  }

  function groupView(group, ctx) {
    const own = new Set(ctx.ownIds);
    const memberRows = ctx.members.filter((m) => m.group_id === group.id && own.has(m.rider_id));
    const memberIds = memberRows.map((m) => m.rider_id);
    const { days, isSeed } = groupSeedDays({
      group, memberIds, ownDaysByRider: ctx.ownDaysByRider, seedsByRider: ctx.seeds,
    });
    return {
      id: group.id,
      name: group.name,
      days,
      isSeed,
      programKey: group.program_key ?? null,
      fatigue: group.fallback ? { threshold: group.fatigue_threshold ?? null, fallback: group.fallback } : null,
      members: memberRows.map((m) => ({ riderId: m.rider_id, followsGroup: m.follows_group !== false })),
    };
  }

  // Skriver gruppens uge som KOPI ind i hver rytters egen raekke.
  async function writeCopies(teamId, rows, riderIds, days, programKey) {
    const byRider = new Map(rows.filter((r) => r.rider_id != null).map((r) => [r.rider_id, r.id]));
    const now = new Date().toISOString();
    const inserts = [];
    for (const riderId of riderIds) {
      const patch = { days: copyWeekDays(days), program_key: programKey ?? null, updated_at: now };
      const id = byRider.get(riderId);
      if (id) {
        const { error } = await supabase.from("training_week_plans").update(patch).eq("id", id);
        if (error) throw new Error(error.message);
      } else {
        inserts.push({ team_id: teamId, rider_id: riderId, ...patch });
      }
    }
    if (inserts.length) {
      const { error } = await supabase.from("training_week_plans").insert(inserts);
      if (error) throw new Error(error.message);
    }
  }

  // Flytter ryttere ind i gruppen (en rytter er i hoejst een gruppe: rider_id er
  // PRIMARY KEY) og fjerner dem der ikke laengere er med.
  async function setMembers(teamId, groupId, riderIds, currentMembers) {
    const keep = new Set(riderIds);
    const removed = currentMembers.filter((m) => m.group_id === groupId && !keep.has(m.rider_id)).map((m) => m.rider_id);
    if (removed.length) {
      const { error } = await supabase.from(MEMBERS_TABLE).delete().eq("team_id", teamId).in("rider_id", removed);
      if (error) throw new Error(error.message);
    }
    const already = new Set(currentMembers.filter((m) => m.group_id === groupId).map((m) => m.rider_id));
    const added = riderIds.filter((id) => !already.has(id));
    if (added.length) {
      const { error: delError } = await supabase.from(MEMBERS_TABLE).delete().in("rider_id", added);
      if (delError) throw new Error(delError.message);
      const { error } = await supabase.from(MEMBERS_TABLE)
        .insert(added.map((riderId) => ({ rider_id: riderId, group_id: groupId, team_id: teamId, follows_group: true })));
      if (error) throw new Error(error.message);
    }
    return added;
  }

  async function findGroup(req, res, ctx) {
    const group = ctx.groups.find((g) => g.id === req.params.id);
    if (!group) {
      res.status(404).json({ error: "group_not_found" });
      return null;
    }
    return group;
  }

  // Faelles indgang for skrivestierne: hold, flag, kontekst.
  async function writeContext(req, res) {
    if (!req.team) { res.status(400).json({ error: "No team found" }); return null; }
    if (!(await groupsOn(req))) { res.status(404).json({ error: "not_found" }); return null; }
    return context(req.team.id);
  }

  async function respond(req, res) {
    const ctx = await context(req.team.id);
    res.json({ ok: true, groups: ctx.groups.map((g) => groupView(g, ctx)) });
  }

  function fail(res, err) {
    captureExceptionFn(err);
    res.status(500).json({ error: err.message });
  }

  router.get("/", requireAuth, readLimiter, async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    try {
      if (!(await groupsOn(req))) return res.json({ enabled: false, groups: [] });
      const ctx = await context(req.team.id);
      res.json({ enabled: true, groups: ctx.groups.map((g) => groupView(g, ctx)) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/", requireAuth, writeLimiter, async (req, res) => {
    const name = normalizeGroupName(req.body?.name);
    if (!name) return res.status(400).json({ error: "invalid_name" });
    try {
      const ctx = await writeContext(req, res);
      if (!ctx) return;
      const riderIds = sanitizeRiderIds(req.body?.riderIds ?? [], ctx.ownIds);
      if (!riderIds) return res.status(400).json({ error: "invalid_riders" });
      const { data, error } = await supabase.from(GROUPS_TABLE)
        .insert({ team_id: req.team.id, name }).select("id").single();
      if (error) throw new Error(error.message);
      // En ny gruppe har ingen felter endnu: medlemmerne beholder deres plan,
      // indtil spilleren retter gruppens foerste felt.
      await setMembers(req.team.id, data.id, riderIds, ctx.members);
      await respond(req, res);
    } catch (err) {
      fail(res, err);
    }
  });

  router.patch("/:id", requireAuth, writeLimiter, async (req, res) => {
    const { name: rawName, riderIds: rawIds } = req.body ?? {};
    const name = rawName === undefined ? undefined : normalizeGroupName(rawName);
    if (name === null) return res.status(400).json({ error: "invalid_name" });
    try {
      const ctx = await writeContext(req, res);
      if (!ctx) return;
      const group = await findGroup(req, res, ctx);
      if (!group) return;
      const riderIds = rawIds === undefined ? undefined : sanitizeRiderIds(rawIds, ctx.ownIds);
      if (riderIds === null) return res.status(400).json({ error: "invalid_riders" });
      const hasDays = isValidProgramWeekDays(group.days);
      // Nye medlemmer faar gruppens uge med det samme; det roerer dagens felt.
      if (riderIds && hasDays && !(await passes(planLock("programApply"), req, res))) return;
      if (name) {
        const { error } = await supabase.from(GROUPS_TABLE)
          .update({ name, updated_at: new Date().toISOString() }).eq("id", group.id).eq("team_id", req.team.id);
        if (error) throw new Error(error.message);
      }
      if (riderIds) {
        const added = await setMembers(req.team.id, group.id, riderIds, ctx.members);
        if (hasDays && added.length) await writeCopies(req.team.id, ctx.rows, added, group.days, group.program_key);
      }
      await respond(req, res);
    } catch (err) {
      fail(res, err);
    }
  });

  router.delete("/:id", requireAuth, writeLimiter, async (req, res) => {
    try {
      const ctx = await writeContext(req, res);
      if (!ctx) return;
      const group = await findGroup(req, res, ctx);
      if (!group) return;
      // Medlemskaberne slettes af FK-cascade; rytternes raekker (kopierne) bliver.
      const { error } = await supabase.from(GROUPS_TABLE).delete().eq("id", group.id).eq("team_id", req.team.id);
      if (error) throw new Error(error.message);
      await respond(req, res);
    } catch (err) {
      fail(res, err);
    }
  });

  router.put("/:id/cell", requireAuth, writeLimiter, planLock("programCell"), async (req, res) => {
    const { weekday, slotIndex = null, session } = req.body ?? {};
    if (!WEEKDAY_KEYS.includes(weekday)) return res.status(400).json({ error: "invalid_weekday" });
    if (!isProgramSession(session)) return res.status(400).json({ error: "invalid_session" });
    if (slotIndex != null && !(Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < PROGRAM_SLOTS)) {
      return res.status(400).json({ error: "invalid_slot" });
    }
    try {
      const ctx = await writeContext(req, res);
      if (!ctx) return;
      const group = await findGroup(req, res, ctx);
      if (!group) return;
      const view = groupView(group, ctx);
      if (!view.days) return res.status(409).json({ error: "group_empty" });
      const days = setProgramCell(view.days, { weekday, slotIndex, session });
      if (!days) return res.status(400).json({ error: "invalid_cell" });
      const { error } = await supabase.from(GROUPS_TABLE)
        .update({ days, updated_at: new Date().toISOString() }).eq("id", group.id).eq("team_id", req.team.id);
      if (error) throw new Error(error.message);
      // Regel A: rytterne med en etape i feltet beholder etapen (motoren springer
      // passet over paa en loebsdag han koerer), saa kopien skrives til alle.
      await writeCopies(req.team.id, ctx.rows, followerIds(ctx.members, group.id, ctx.ownIds), days, group.program_key);
      await respond(req, res);
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/:id/program", requireAuth, writeLimiter, planLock("programApply"), async (req, res) => {
    const program = findTrainingProgram(req.body?.programKey);
    if (!program) return res.status(400).json({ error: "invalid_program" });
    try {
      const ctx = await writeContext(req, res);
      if (!ctx) return;
      const group = await findGroup(req, res, ctx);
      if (!group) return;
      const days = programWeekDaysFor(program.key);
      const { error } = await supabase.from(GROUPS_TABLE)
        .update({ days, program_key: program.key, updated_at: new Date().toISOString() })
        .eq("id", group.id).eq("team_id", req.team.id);
      if (error) throw new Error(error.message);
      // "Put on" en gruppe er spillerens eksplicitte valg for HELE gruppen: alle
      // medlemmer foelger igen og faar programmet.
      const memberIds = ctx.members.filter((m) => m.group_id === group.id && ctx.ownIds.includes(m.rider_id)).map((m) => m.rider_id);
      if (memberIds.length) {
        const { error: followError } = await supabase.from(MEMBERS_TABLE).update({ follows_group: true })
          .eq("group_id", group.id).in("rider_id", memberIds);
        if (followError) throw new Error(followError.message);
      }
      await writeCopies(req.team.id, ctx.rows, memberIds, days, program.key);
      res.json({ ok: true, applied: memberIds.length, programKey: program.key });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/:id/follow", requireAuth, writeLimiter, planLock("programApply"), async (req, res) => {
    try {
      const ctx = await writeContext(req, res);
      if (!ctx) return;
      const group = await findGroup(req, res, ctx);
      if (!group) return;
      const memberIds = new Set(ctx.members.filter((m) => m.group_id === group.id).map((m) => m.rider_id));
      const riderIds = sanitizeRiderIds(req.body?.riderIds ?? [], ctx.ownIds)?.filter((id) => memberIds.has(id));
      if (!riderIds) return res.status(400).json({ error: "invalid_riders" });
      if (riderIds.length) {
        const { error } = await supabase.from(MEMBERS_TABLE).update({ follows_group: true })
          .eq("group_id", group.id).in("rider_id", riderIds);
        if (error) throw new Error(error.message);
        if (isValidProgramWeekDays(group.days)) await writeCopies(req.team.id, ctx.rows, riderIds, group.days, group.program_key);
      }
      await respond(req, res);
    } catch (err) {
      fail(res, err);
    }
  });

  router.put("/:id/fatigue", requireAuth, writeLimiter, async (req, res) => {
    const patch = groupFatiguePatch(req.body);
    if (!patch) return res.status(400).json({ error: "invalid_rule" });
    try {
      const ctx = await writeContext(req, res);
      if (!ctx) return;
      const group = await findGroup(req, res, ctx);
      if (!group) return;
      const { error } = await supabase.from(GROUPS_TABLE)
        .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", group.id).eq("team_id", req.team.id);
      if (error) throw new Error(error.message);
      await respond(req, res);
    } catch (err) {
      fail(res, err);
    }
  });

  return router;
}
