// #2644 — Server-side synligheds-guard for spejder-rapporter (missions-shortlists +
// målrettede undersøgelser). En rapport må KUN indeholde ryttere der er synlige/
// søgbare NU — samme diskriminator som riders-RLS-policyen "Public read riders"
// bruger (is_offered_intake_rider, database/2026-06-22-hide-intake-riders-from-db.sql):
// et åbent ('offered') akademi-intake-tilbud på en fri (team_id NULL), ikke-akademi
// rytter gør ham globalt usøgbar indtil det tilbudte hold accepterer/afviser.
//
// #2644 beslutning 1 udvider diskriminatoren: en rytter med pending_team_id sat er
// IKKE "frit tilgængelig lige nu" (han er midt i et handelsflow, jf. #1995/#2579) —
// selvom han stadig ER søgbar i den almindelige rytter-DB (RidersPage), hører han
// ikke hjemme i en spejder-rapport der skal pege på noget spilleren faktisk kan
// handle på med det samme.
//
// #2623/#2627: rod-årsagen til de historiske "rytteren findes ikke"-rapporter var
// netop at en rytters synlighed kan ÆNDRE SIG mellem rapport-generering og visning.
// Guarden kører derfor ved SERVERING (view-time, hver gang GET /scouting/central
// hentes), ikke kun ved generering (scoutSweep.js filtrerer allerede kandidat-poolen
// FØR en shortlist overhovedet skabes — dette er det andet, uafhængige lag).
//
// #2644 beslutning 4: ryttere der IKKE er skjulte, men har fået et hold siden
// rapporten blev genereret, forbliver i rapporten — med holdnavnet som status.
//
// #2581 genåbnet 19/7: NY klasse fundet — ryttere ejet af AI-hold. RidersPage
// skjuler dem for spillere som default (useRiderFilters.js .eq('owner_is_ai',
// false) uden show_ai), men denne view-tidspunkt-guard kendte ikke diskriminatoren
// (kun generérings-tidspunkt-laget i scoutSweep.js gjorde). Mirror-fix: samme
// to-lags-mønster som offered-intake — udelukkes både ved generering OG servering.

// Rent predikat — testbart uden I/O.
export function isRiderHiddenFromReport({ teamId, pendingTeamId, isAcademy, hasOpenIntakeOffer, ownerIsAi }) {
  if (pendingTeamId != null) return true;
  if (ownerIsAi === true) return true; // #2581: AI-ejede ryttere er skjulte for spillere i RidersPage
  // Spejler is_offered_intake_rider(): åbent tilbud + endnu ikke hentet af noget hold.
  if (hasOpenIntakeOffer && teamId == null && isAcademy === false) return true;
  return false;
}

// Statuslabel til visning (#2644 beslutning 4) — { status: 'free_agent' } eller
// { status: 'team', teamName }.
export function riderReportStatus({ teamId, teamName }) {
  return teamId ? { status: "team", teamName: teamName ?? null } : { status: "free_agent" };
}

// Samler alle rider-id'er der reelt optræder i completed-assignments (mission-
// shortlists + target-rytter), henter deres NUVÆRENDE synlighed/status i ÉT slæt,
// og returnerer en NY completed-liste hvor skjulte ryttere er fjernet fra shortlist/
// top_rider_id (mission) eller rider_id (target) — plus en riderStatus-map pr.
// assignment til frontend-visning. Assignments uden kendte rider-id'er (fx tomme
// test-fixtures, mission uden match) passerer uændret igennem uden ekstra I/O.
export async function hydrateCompletedVisibility(supabaseClient, completed) {
  const riderIds = new Set();
  for (const a of completed) {
    if (a.kind === "target" && a.rider_id) riderIds.add(a.rider_id);
    if (a.kind === "mission" && Array.isArray(a.result?.shortlist)) {
      for (const id of a.result.shortlist) riderIds.add(id);
    }
  }
  if (riderIds.size === 0) return completed.map((a) => ({ ...a, riderStatus: {} }));

  const ids = [...riderIds];
  const [{ data: riders, error: riderErr }, { data: offered, error: intakeErr }] = await Promise.all([
    supabaseClient.from("riders").select("id, team_id, pending_team_id, is_academy, owner_is_ai, team:team_id(name)").in("id", ids),
    supabaseClient.from("academy_intake").select("rider_id").eq("status", "offered").in("rider_id", ids),
  ]);
  if (riderErr) throw new Error(`hydrateCompletedVisibility: riders load failed: ${riderErr.message}`);
  if (intakeErr) throw new Error(`hydrateCompletedVisibility: academy_intake load failed: ${intakeErr.message}`);

  const offeredIds = new Set((offered ?? []).map((r) => r.rider_id));
  const byId = new Map((riders ?? []).map((r) => [r.id, r]));

  const hiddenIds = new Set();
  const statusById = {};
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) { hiddenIds.add(id); continue; } // rytter ikke fundet (slettet) — skjul defensivt
    const hidden = isRiderHiddenFromReport({
      teamId: r.team_id,
      pendingTeamId: r.pending_team_id,
      isAcademy: r.is_academy,
      hasOpenIntakeOffer: offeredIds.has(id),
      ownerIsAi: r.owner_is_ai,
    });
    if (hidden) { hiddenIds.add(id); continue; }
    statusById[id] = riderReportStatus({ teamId: r.team_id, teamName: r.team?.name });
  }

  return completed.map((a) => {
    if (a.kind === "target") {
      if (a.rider_id && hiddenIds.has(a.rider_id)) {
        // Fjern selve rider_id-referencen — frontend kan så ikke slå et navn op
        // på en rytter der lige nu er usøgbar/utilgængelig.
        return { ...a, rider_id: null, riderStatus: {} };
      }
      const status = a.rider_id && statusById[a.rider_id];
      return { ...a, riderStatus: status ? { [a.rider_id]: status } : {} };
    }
    if (a.kind === "mission" && Array.isArray(a.result?.shortlist)) {
      const filteredShortlist = a.result.shortlist.filter((id) => !hiddenIds.has(id));
      const topRiderId = hiddenIds.has(a.result.top_rider_id) ? null : a.result.top_rider_id;
      const riderStatus = {};
      for (const id of filteredShortlist) if (statusById[id]) riderStatus[id] = statusById[id];
      return { ...a, result: { ...a.result, shortlist: filteredShortlist, top_rider_id: topRiderId }, riderStatus };
    }
    return { ...a, riderStatus: {} };
  });
}
