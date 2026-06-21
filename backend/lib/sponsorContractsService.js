// backend/lib/sponsorContractsService.js
// DB-laget for sponsor-kontrakter (#1663, Økonomi Fase 2). Tilbud genereres
// deterministisk on-demand (ingen offers-tabel) via sponsorOffers.generateOffers
// ud fra holdets renown (division + sidste-sæsons placering, renownEngine).
// At acceptere et tilbud skriver en kontrakt-række.
//
// supabase injiceres som service_role-klient (tests injicerer en mock).
//
// Schema-fakta (database/schema.sql):
//   sponsor_contracts.status CHECK ∈ {'active','expired','replaced'}; partial UNIQUE
//     index → højst ÉN status='active' pr. hold. Flip altid den eksisterende aktive
//     væk FØR insert af en ny aktiv.
//   seasons.number er sæson-heltallet; season_standings keyer på season_id (UUID FK
//     til seasons.id), IKKE et nummer → resolv forrige sæsons id først.
import { renownTarget } from "./renownEngine.js";
import { generateOffers } from "./sponsorOffers.js";

const DEFAULT_RENEW_VARIANT = "long";

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
  return generateOffers({ teamId, seasonNumber, renownTargetValue });
}

export async function acceptOffer({ supabase, teamId, seasonNumber, variant }) {
  const offers = await getOffers({ supabase, teamId, seasonNumber });
  const chosen = offers.find((o) => o.variant === variant);
  if (!chosen) throw new Error(`Ukendt variant: ${variant}`);

  // Flip den eksisterende aktive kontrakt til 'replaced' FØR insert (partial
  // UNIQUE index tillader kun én aktiv pr. hold).
  const { error: updateError } = await supabase
    .from("sponsor_contracts")
    .update({ status: "replaced" })
    .eq("team_id", teamId)
    .eq("status", "active");
  if (updateError) throw updateError;

  const row = {
    team_id: teamId,
    sponsor_name: chosen.sponsorName,
    guaranteed_base: chosen.guaranteedBase,
    per_race_day_rate: chosen.perRaceDayRate,
    length_seasons: chosen.lengthSeasons,
    start_season: seasonNumber,
    expires_after_season: seasonNumber + chosen.lengthSeasons - 1,
    status: "active",
  };
  const { data, error } = await supabase
    .from("sponsor_contracts")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data || row;
}

// Sæson-skifte: for hvert hold — behold en stadig-låst kontrakt; ellers udløb den
// gamle ('expired') og forny med default-varianten for den nye sæson.
export async function expireAndRenewContracts({ supabase, newSeasonNumber, teamIds }) {
  for (const teamId of teamIds) {
    const active = await getActiveContract({ supabase, teamId });
    if (active && active.expires_after_season >= newSeasonNumber) continue;
    if (active) {
      const { error } = await supabase
        .from("sponsor_contracts")
        .update({ status: "expired" })
        .eq("id", active.id);
      if (error) throw error;
    }
    await acceptOffer({
      supabase,
      teamId,
      seasonNumber: newSeasonNumber,
      variant: DEFAULT_RENEW_VARIANT,
    });
  }
}
