// backend/lib/sponsorContractsService.js
// DB-laget for sponsor-kontrakter (#1663, Økonomi Fase 2). Tilbud genereres
// deterministisk on-demand (ingen offers-tabel) via sponsorOffers.generateOffers
// ud fra holdets renown (division + sidste-sæsons placering, renownEngine).
// At acceptere et tilbud skriver en kontrakt-række.
//
// supabase injiceres som service_role-klient (tests injicerer en mock).
//
// Schema-fakta (database/schema.sql):
//   sponsor_contracts.status CHECK ∈ {'active','expired','replaced','pending'}; to delvise
//     UNIQUE indekser → højst ÉN status='active' OG højst ÉN status='pending' pr. hold.
//     Flip altid den eksisterende aktive/pending væk FØR insert af en ny af samme status.
//   Flow: manager vælger et tilbud for KOMMENDE sæson under nuværende sæson → 'pending'
//     (start_season = kommende). Ved sæson-skifte aktiveres den pending (eller default
//     'long' oprettes hvis ingen). Sæson-start betaler så den nu-aktive guaranteed_base.
//   seasons.number er sæson-heltallet; season_standings keyer på season_id (UUID FK
//     til seasons.id), IKKE et nummer → resolv forrige sæsons id først.
import { renownTarget } from "./renownEngine.js";
import { generateOffers, FULL_CALENDAR_DAYS } from "./sponsorOffers.js";

const DEFAULT_RENEW_VARIANT = "long";

// Henter den reelle sæson-kalenderlængde (seasons.race_days_total) for den aktive
// sæson, så per-løbsdag-raten i tilbuddene afspejler den faktiske kalender frem for
// den hardcodede FULL_CALENDAR_DAYS-konstant. Falder tilbage til FULL_CALENDAR_DAYS
// hvis ingen aktiv sæson / kolonnen er null. Én ekstra letvægts-query.
async function loadCalendarDays({ supabase }) {
  const { data, error } = await supabase
    .from("seasons")
    .select("race_days_total")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  const days = Number(data?.race_days_total);
  return Number.isFinite(days) && days > 0 ? days : FULL_CALENDAR_DAYS;
}

export async function getActiveContract({ supabase, teamId }) {
  const { data, error } = await supabase
    .from("sponsor_contracts")
    .select("*")
    .eq("team_id", teamId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function getPendingContract({ supabase, teamId }) {
  const { data, error } = await supabase
    .from("sponsor_contracts")
    .select("*")
    .eq("team_id", teamId)
    .eq("status", "pending")
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Beregner holdets renownTarget for en kommende sæson ud fra forrige sæsons
// placering. Frisk hold (ingen forrige sæson / ingen placering) → renownTarget
// falder tilbage til division-base × 1,0.
async function loadRenownTargetValue({ supabase, teamId, seasonNumber }) {
  const { data: team, error: teamError } = await supabase
    .from("teams")
    .select("id, division")
    .eq("id", teamId)
    .single();
  if (teamError) throw teamError;
  const division = team?.division ?? null;

  // Forrige sæsons id (number = seasonNumber - 1).
  const prevNumber = seasonNumber - 1;
  let prevSeasonId = null;
  if (prevNumber >= 1) {
    const { data: prevSeason, error: seasonError } = await supabase
      .from("seasons")
      .select("id, number")
      .eq("number", prevNumber)
      .maybeSingle();
    if (seasonError) throw seasonError;
    prevSeasonId = prevSeason?.id ?? null;
  }

  // Forrige sæsons placeringer (alle hold i samme division som målholdet) for at
  // beregne division-median + rank-faktor. Tom liste hvis ingen forrige sæson.
  let divisionStandings = [];
  if (prevSeasonId) {
    const { data: rows, error: standingsError } = await supabase
      .from("season_standings")
      .select("season_id, team_id, division, rank_in_division, total_points")
      .eq("season_id", prevSeasonId);
    if (standingsError) throw standingsError;
    const all = rows || [];
    // Filtrér til holdets division (renown-sammenligning er pr. division).
    divisionStandings =
      division == null ? all : all.filter((s) => s.division === division);
  }

  const lastSeasonStanding =
    divisionStandings.find((s) => s.team_id === teamId) || null;

  return renownTarget({ division, lastSeasonStanding, divisionStandings });
}

export async function getOffers({ supabase, teamId, seasonNumber }) {
  const renownTargetValue = await loadRenownTargetValue({
    supabase,
    teamId,
    seasonNumber,
  });
  const calendarDays = await loadCalendarDays({ supabase });
  return generateOffers({ teamId, seasonNumber, renownTargetValue, calendarDays });
}

// Forhandlings-tilstand for nuværende sæson. Et hold kan forhandle for den KOMMENDE
// sæson (currentSeasonNumber + 1) hvis dets aktive kontrakt udløber ved slutningen af
// nuværende sæson (expires_after_season <= currentSeasonNumber) ELLER der ingen aktiv
// kontrakt er. Returnerer de regenererede tilbud + den allerede valgte variant (hvis en
// pending række for kommende sæson findes), så UI kan markere managerens valg.
export async function getNegotiationState({ supabase, teamId, currentSeasonNumber }) {
  const upcomingSeasonNumber = currentSeasonNumber + 1;
  const active = await getActiveContract({ supabase, teamId });
  const negotiable =
    !active || active.expires_after_season <= currentSeasonNumber;

  const offers = negotiable
    ? await getOffers({ supabase, teamId, seasonNumber: upcomingSeasonNumber })
    : [];

  // Aflæs hvilken variant en evt. pending række svarer til ved at matche dens
  // length_seasons + guaranteed_base mod de regenererede tilbud (varianten
  // persisteres ikke på rækken). Kun pending der starter i kommende sæson tæller.
  let pendingVariant = null;
  const pending = await getPendingContract({ supabase, teamId });
  if (pending && pending.start_season === upcomingSeasonNumber) {
    const match = offers.find(
      (o) =>
        o.lengthSeasons === pending.length_seasons &&
        o.guaranteedBase === pending.guaranteed_base,
    );
    pendingVariant = match ? match.variant : null;
  }

  return { negotiable, upcomingSeasonNumber, offers, pendingVariant };
}

// Manager vælger et tilbud for den KOMMENDE sæson. Skriver en 'pending' række
// (start_season = upcomingSeasonNumber); den aktiveres ved sæson-skiftet via
// expireAndRenewContracts. Erstatter en evt. eksisterende pending (delvist UNIQUE
// index tillader kun én pending pr. hold). API'et gater på negotiable.
export async function acceptOffer({ supabase, teamId, upcomingSeasonNumber, variant }) {
  const offers = await getOffers({
    supabase,
    teamId,
    seasonNumber: upcomingSeasonNumber,
  });
  const chosen = offers.find((o) => o.variant === variant);
  if (!chosen) throw new Error(`Ukendt variant: ${variant}`);

  // Flip en evt. eksisterende pending til 'replaced' FØR insert (delvist UNIQUE
  // index tillader kun én pending pr. hold).
  const { error: updateError } = await supabase
    .from("sponsor_contracts")
    .update({ status: "replaced" })
    .eq("team_id", teamId)
    .eq("status", "pending");
  if (updateError) throw updateError;

  const row = {
    team_id: teamId,
    sponsor_name: chosen.sponsorName,
    guaranteed_base: chosen.guaranteedBase,
    per_race_day_rate: chosen.perRaceDayRate,
    length_seasons: chosen.lengthSeasons,
    start_season: upcomingSeasonNumber,
    expires_after_season: upcomingSeasonNumber + chosen.lengthSeasons - 1,
    status: "pending",
  };
  const { data, error } = await supabase
    .from("sponsor_contracts")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data || row;
}

// Sæson-skifte: for hvert hold — behold en stadig-låst kontrakt; ellers udløb den gamle
// ('expired') og AKTIVÉR holdets pending valg (flip pending->active). Hvis ingen matchende
// pending findes: opret default 'long' aktiv-kontrakt for den nye sæson.
export async function expireAndRenewContracts({ supabase, newSeasonNumber, teamIds }) {
  for (const teamId of teamIds) {
    const active = await getActiveContract({ supabase, teamId });
    // Kontrakten dækker stadig den nye sæson → behold (låst).
    if (active && active.expires_after_season >= newSeasonNumber) continue;

    // Udløb den gamle aktive FØR vi aktiverer pending (kun én aktiv pr. hold).
    if (active) {
      const { error } = await supabase
        .from("sponsor_contracts")
        .update({ status: "expired" })
        .eq("id", active.id);
      if (error) throw error;
    }

    const pending = await getPendingContract({ supabase, teamId });
    if (pending && pending.start_season === newSeasonNumber) {
      // Aktivér managerens valg: pending -> active. Forward-guard (#2589): raten
      // blev frosset ved PICK-tidspunktet ud fra dengang gældende calendarDays,
      // som ikke kan kende den kommende sæsons faktiske kalenderlængde. Genberegn
      // per_race_day_rate her ud fra den NYE sæsons kalender (seasons er allerede
      // 'active' på dette tidspunkt i sæsonskiftet, jf. seasonTransition.js).
      // guaranteedBase afhænger IKKE af calendarDays (kun perRaceDayRate gør), så
      // vi kan sikkert genkende hvilken variant pending-rækken svarer til ved at
      // matche length_seasons + guaranteed_base mod friskt genererede tilbud —
      // samme teknik som getNegotiationState bruger til pendingVariant-aflæsning.
      const refreshedOffers = await getOffers({
        supabase,
        teamId,
        seasonNumber: newSeasonNumber,
      });
      const matched = refreshedOffers.find(
        (o) =>
          o.lengthSeasons === pending.length_seasons &&
          o.guaranteedBase === pending.guaranteed_base,
      );
      const updatePayload = { status: "active" };
      if (matched && matched.perRaceDayRate !== pending.per_race_day_rate) {
        updatePayload.per_race_day_rate = matched.perRaceDayRate;
      }
      const { error } = await supabase
        .from("sponsor_contracts")
        .update(updatePayload)
        .eq("id", pending.id);
      if (error) throw error;
      continue;
    }

    // Ingen matchende pending → default-forny med 'long' for den nye sæson.
    const offers = await getOffers({
      supabase,
      teamId,
      seasonNumber: newSeasonNumber,
    });
    const chosen = offers.find((o) => o.variant === DEFAULT_RENEW_VARIANT);
    if (!chosen) throw new Error(`Ukendt variant: ${DEFAULT_RENEW_VARIANT}`);

    const row = {
      team_id: teamId,
      sponsor_name: chosen.sponsorName,
      guaranteed_base: chosen.guaranteedBase,
      per_race_day_rate: chosen.perRaceDayRate,
      length_seasons: chosen.lengthSeasons,
      start_season: newSeasonNumber,
      expires_after_season: newSeasonNumber + chosen.lengthSeasons - 1,
      status: "active",
    };
    const { error } = await supabase
      .from("sponsor_contracts")
      .insert(row)
      .select()
      .single();
    if (error) throw error;
  }
}
