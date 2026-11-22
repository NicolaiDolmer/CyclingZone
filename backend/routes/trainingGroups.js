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
//   PUT    /:id/cell         { weekday, slotIndex, session, effort? }  et felt for hele gruppen
//                            (#7947: effort gemmes kun med training_effort_levels on)
//   POST   /:id/program      { programKey }             "Put on" et program paa gruppen
//   POST   /:id/follow       { riderIds }               rytterne foelger gruppen igen
//   PUT    /:id/fatigue      { mode, threshold?, fallback? }  traethedsundtagelse for hele gruppen
//   PUT    /:id/rotation     { planKind?, passes?, keepPlace?, startIndex? }  gruppens rotation (#8548,
//                            bag training_rotation; off = 409 feature_disabled)
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
import { isV3OnlySession, isTrainingCatalogV3EnabledForViewer, v3SmartDefaultFocus } from "../lib/trainingCatalogV3.js"; // #5319
import { seedProgramWeekDays, planRunsOffStandard } from "../lib/trainingWeekPlanCells.js";
import { effortForWrite, isTrainingEffortLevelsEnabled } from "../lib/trainingEffortLevels.js"; // #7947
import {
  GROUPS_TABLE, MEMBERS_TABLE, isTrainingGroupsEnabled, loadTeamGroups, normalizeGroupName, sanitizeRiderIds,
  followerIds, groupSeedDays, groupFatiguePatch, copyWeekDays, groupRotationCopyPatch,
} from "../lib/trainingGroups.ts";
import { isTrainingRotationEnabled } from "../lib/trainingRotationFlag.js"; // #8548
import { rotationWriteInput, rotationView } from "../lib/trainingRotationInput.js"; // #8548
import { applyRotationWrite } from "../lib/trainingRotation.js"; // #8548

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
  // Codex P1 paa #8532 (AGENTS: tests laeser aldrig vaegurets tid): tidsstempler fra en injicerbar klokke.
  clock = () => new Date(),
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
      .from("riders").select("id, primary_type, secondary_type").eq("team_id", teamId).eq("is_retired", false);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  // #8548: med training_rotation on laeses ogsaa rotation og plan_kind (kolonnerne findes foerst
  // efter migrationen, og flag-raekken oprettes af samme migration).
  async function weekRows(teamId, { rotation = false } = {}) {
    const { data, error } = await supabase.from("training_week_plans")
      // schema-columns-ok: rotation + plan_kind tilfoejes af database/2026-11-22-8548-training-rotation.sql (post-merge); kun laest med flaget on.
      .select(rotation ? "id, rider_id, days, rotation, plan_kind" : "id, rider_id, days").eq("team_id", teamId);
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
  async function context(teamId, req) {
    const rotationOn = await isTrainingRotationEnabled(supabase, { isBetaTester: await isViewerBetaTester(req) }); // #8548
    const [riders, rows, { groups, members }, plans] = await Promise.all([
      ownRiders(teamId), weekRows(teamId, { rotation: rotationOn }), loadTeamGroups(supabase, teamId, { rotation: rotationOn }), plansByRider(teamId),
    ]);
    // #5319: v3-saaningen foelger viewerens katalog; flaget slaas kun op naar det kan flytte nogen.
    const v3Affected = riders.some((r) => !(plans.get(r.id)?.focus && plans.get(r.id)?.intensity) && v3SmartDefaultFocus("threshold", r, { v3: true }) !== "threshold");
    const catalogV3 = v3Affected ? await isTrainingCatalogV3EnabledForViewer(supabase, () => isViewerBetaTester(req)) : false;
    // #7947: kontakten slaas kun op, naar en plan staar paa et andet niveau end sessionens standard.
    const effortLevels = riders.some((r) => planRunsOffStandard(plans.get(r.id))) ? await isTrainingEffortLevelsEnabled(supabase) : false;
    const ownIds = riders.map((r) => r.id);
    const teamDays = rows.find((r) => r.rider_id == null)?.days ?? null;
    const ownDaysByRider = new Map(rows.filter((r) => r.rider_id != null).map((r) => [r.rider_id, r.days]));
    const seeds = {};
    for (const rider of riders) {
      const riderDays = ownDaysByRider.get(rider.id) ?? null;
      if (isValidProgramWeekDays(riderDays)) continue;
      seeds[rider.id] = seedProgramWeekDays({
        riderDays, teamDays, plan: plans.get(rider.id) ?? null, primaryType: rider.primary_type ?? null,
        secondaryType: rider.secondary_type ?? null, catalogV3, effortLevels,
      });
    }
    return { riders, ownIds, rows, groups, members, ownDaysByRider, seeds, rotationOn };
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
      // #8548: kun med kontakten on (off = svaret er praecis som foer).
      ...(ctx.rotationOn ? rotationView(group) : {}),
    };
  }

  // Skriver gruppens uge som KOPI ind i hver rytters egen raekke.
  // #8548: `rotationGroup` (kun med kontakten on) = gruppen, hvis rotation og markoer
  // ogsaa kopieres (groupRotationCopyPatch); null = noeglerne skrives slet ikke, som foer.
  async function writeCopies(teamId, rows, riderIds, days, programKey, rotationGroup = null) {
    const byRider = new Map(rows.filter((r) => r.rider_id != null).map((r) => [r.rider_id, r]));
    const now = clock().toISOString();
    const inserts = [];
    for (const riderId of riderIds) {
      const row = byRider.get(riderId);
      const patch = {
        days: copyWeekDays(days), program_key: programKey ?? null, updated_at: now,
        ...(rotationGroup ? groupRotationCopyPatch(rotationGroup, row) : {}),
      };
      const id = row?.id;
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

  // #8548: kun gruppens rotation og markoer som kopi (rytternes felter roeres ikke). Bruges af
  // PUT /:id/rotation og, naar gruppen ingen felter har endnu, af nye medlemmer og "Follow
  // group" (Codex-fund: ellers fik de ikke gruppens rotation). En rytter uden raekke faar
  // gruppens felter (eller sin saaede uge), saa motoren altid har gyldige felter.
  async function writeRotationCopies(teamId, ctx, riderIds, group, copyOpts = {}) {
    const byRider = new Map(ctx.rows.filter((r) => r.rider_id != null).map((r) => [r.rider_id, r]));
    const now = clock().toISOString();
    const inserts = [];
    for (const riderId of riderIds) {
      const row = byRider.get(riderId);
      const patch = groupRotationCopyPatch(group, row, copyOpts);
      if (Object.keys(patch).length === 0) continue;
      if (row) {
        const { error } = await supabase.from("training_week_plans").update({ ...patch, updated_at: now }).eq("id", row.id);
        if (error) throw new Error(error.message);
      } else {
        const days = isValidProgramWeekDays(group.days) ? copyWeekDays(group.days) : ctx.seeds[riderId];
        inserts.push({ team_id: teamId, rider_id: riderId, days, program_key: group.program_key ?? null, ...patch, updated_at: now });
      }
    }
    if (inserts.length) {
      const { error } = await supabase.from("training_week_plans").insert(inserts);
      if (error) throw new Error(error.message);
    }
  }

  // Gruppen har en markoer (Rotation eller Week blocks), men ingen felter: kun markoeren kopieres. Codex P2 #8577: ogsaa "week", saa en foelger ikke beholder en gammel rotation.
  const rotationOnlyGroup = (ctx, group) => ctx.rotationOn && group.plan_kind != null && !isValidProgramWeekDays(group.days);

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
    return context(req.team.id, req);
  }

  async function respond(req, res) {
    const ctx = await context(req.team.id, req);
    res.json({ ok: true, groups: ctx.groups.map((g) => groupView(g, ctx)) });
  }

  router.get("/", requireAuth, readLimiter, async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    try {
      if (!(await groupsOn(req))) return res.json({ enabled: false, groups: [] });
      const ctx = await context(req.team.id, req);
      res.json({ enabled: true, groups: ctx.groups.map((g) => groupView(g, ctx)) });
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
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
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
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
      const rotationOnly = rotationOnlyGroup(ctx, group); // #8548
      // Nye medlemmer faar gruppens uge med det samme; det roerer dagens felt.
      if (riderIds && (hasDays || rotationOnly) && !(await passes(planLock("programApply"), req, res))) return;
      if (name) {
        const { error } = await supabase.from(GROUPS_TABLE)
          .update({ name, updated_at: clock().toISOString() }).eq("id", group.id).eq("team_id", req.team.id);
        if (error) throw new Error(error.message);
      }
      if (riderIds) {
        const added = await setMembers(req.team.id, group.id, riderIds, ctx.members);
        if (hasDays && added.length) await writeCopies(req.team.id, ctx.rows, added, group.days, group.program_key, ctx.rotationOn ? group : null);
        else if (rotationOnly && added.length) await writeRotationCopies(req.team.id, ctx, added, group);
      }
      await respond(req, res);
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
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
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
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
      // #7947: indsatsen gemmes kun med kontakten on; ikke sendt = intet opslag, som i dag.
      const effortWrite = await effortForWrite(supabase, req.body?.effort);
      if (!effortWrite.ok) return res.status(400).json({ error: effortWrite.reason });
      // #5319: en v3-session kan kun vaelges naar training_catalog_v3 er aaben for viewer.
      if (isV3OnlySession(session) && !(await isTrainingCatalogV3EnabledForViewer(supabase, () => isViewerBetaTester(req)))) {
        return res.status(400).json({ error: "invalid_session" });
      }
      const group = await findGroup(req, res, ctx);
      if (!group) return;
      const view = groupView(group, ctx);
      if (!view.days) return res.status(409).json({ error: "group_empty" });
      const days = setProgramCell(view.days, { weekday, slotIndex, session, effort: effortWrite.effort });
      if (!days) return res.status(400).json({ error: "invalid_cell" });
      const { error } = await supabase.from(GROUPS_TABLE)
        .update({ days, updated_at: clock().toISOString() }).eq("id", group.id).eq("team_id", req.team.id);
      if (error) throw new Error(error.message);
      // Regel A: rytterne med en etape i feltet beholder etapen (motoren springer
      // passet over paa en loebsdag han koerer), saa kopien skrives til alle.
      await writeCopies(req.team.id, ctx.rows, followerIds(ctx.members, group.id, ctx.ownIds), days, group.program_key, ctx.rotationOn ? group : null);
      await respond(req, res);
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
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
        .update({ days, program_key: program.key, updated_at: clock().toISOString() })
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
      await writeCopies(req.team.id, ctx.rows, memberIds, days, program.key, ctx.rotationOn ? group : null);
      res.json({ ok: true, applied: memberIds.length, programKey: program.key });
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
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
        if (isValidProgramWeekDays(group.days)) await writeCopies(req.team.id, ctx.rows, riderIds, group.days, group.program_key, ctx.rotationOn ? group : null);
        else if (rotationOnlyGroup(ctx, group)) await writeRotationCopies(req.team.id, ctx, riderIds, group); // #8548
      }
      await respond(req, res);
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
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
        .update({ ...patch, updated_at: clock().toISOString() }).eq("id", group.id).eq("team_id", req.team.id);
      if (error) throw new Error(error.message);
      await respond(req, res);
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
    }
  });

  // #8548: gruppens rotation og markoer (Week blocks | Rotation). Kopieres ind i hver
  // foelgende rytters raekke; pladsen er pr. rytter, saa hver kopi bygges oven paa
  // rytterens egen rotation (lib/trainingGroups.ts groupRotationCopyPatch). Kontakten
  // off = 409 feature_disabled og intet skrives.
  router.put("/:id/rotation", requireAuth, writeLimiter, planLock("programApply"), async (req, res) => {
    try {
      const ctx = await writeContext(req, res);
      if (!ctx) return;
      if (!ctx.rotationOn) return res.status(409).json({ error: "feature_disabled" });
      const input = await rotationWriteInput(supabase, req.body, { viewerIsBeta: () => isViewerBetaTester(req) });
      if (!input.ok) return res.status(400).json({ error: input.reason });
      const group = await findGroup(req, res, ctx);
      if (!group) return;
      const next = applyRotationWrite({ prev: group.rotation ?? null, prevKind: group.plan_kind ?? null, write: input.write, passes: input.passes });
      if (!next.ok) return res.status(400).json({ error: next.reason });
      const now = clock().toISOString();
      const { error } = await supabase.from(GROUPS_TABLE)
        .update({ rotation: next.rotation, plan_kind: next.planKind, updated_at: now })
        .eq("id", group.id).eq("team_id", req.team.id);
      if (error) throw new Error(error.message);
      await writeRotationCopies(req.team.id, ctx, followerIds(ctx.members, group.id, ctx.ownIds),
        { ...group, rotation: next.rotation, plan_kind: next.planKind },
        { keepPlace: input.write.keepPlace, startIndex: input.write.startIndex });
      await respond(req, res);
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
