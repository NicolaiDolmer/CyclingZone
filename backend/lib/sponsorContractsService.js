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
import { generateOffers, FULL_CALENDAR_DAYS, guaranteedFractionForLength } from "./sponsorOffers.js";

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

// #2589 forward-guard: genberegn per_race_day_rate ved AKTIVERING (pending→active)
// ud fra den NYE sæsons faktiske kalenderlængde. Pick-tidspunktet kan aldrig kende
// den kommende kalender (pick sker midt i den INDEVÆRENDE sæson), og et forsøg på
// at matche den pending-række mod et FRISK regenereret tilbud (PR #2606, afvist
// 17/7) er ustabilt: guaranteed_base blev fastfrosset fra renownTargetValue på
// pick-tidspunktet, og renownTargetValue afhænger af season_standings — som
// opdateres LIVE gennem sæsonen (recompute_season_standings efter hvert løb). Et
// forsøg på at genberegne renownTargetValue i dag ville derfor ikke matche den
// værdi der faktisk lå til grund for guaranteed_base (~36% mismatch målt i prod
// 17/7, se issue #2589-kommentar).
//
// I stedet baglæns-udleder vi den ORIGINALE renownTargetValue direkte fra den
// lagrede guaranteed_base: guaranteedFraction er kendt fra length_seasons (stabilt,
// sat ved pick og ændres aldrig siden) → originalRenownTarget = guaranteed_base /
// guaranteedFraction. Det retter KUN divisor-fejlen (60 vs. den reelle kalender),
// uafhængigt af om renownTargetValue har driftet siden pick.
//
// #2589 adversarielt review (23/7): renownTargetValue var ALTID et heltal ved
// generering (renownEngine/generateOffers), så guaranteedBase = Math.round(target
// × fraction). Division i IEEE-754 (fraction som 0.55/0.73/0.88 er ikke eksakt
// repræsentérbare) kan derfor give fx 440999.99999999994 i stedet for 441000 —
// og hvis den falske rest lander lige på en .5-grænse i næste division, vipper
// Math.round den forkerte vej (verificeret: guaranteed_base=242550, fraction=0.55
// → 7087 i stedet for korrekte 7088). Math.round HER genopretter det tabte
// heltal FØR videre regning, så float-støjen aldrig når frem til slut-rundingen.
export function recomputeActivationRate(pending, calendarDays) {
  const fraction = guaranteedFractionForLength(pending?.length_seasons);
  const guaranteedBase = Number(pending?.guaranteed_base);
  if (!fraction || !Number.isFinite(guaranteedBase)) {
    // Ukendt/legacy variant-længde (length_seasons matcher ingen VARIANT) → kan
    // ikke baglæns-udlede sikkert. Behold den lagrede rate frem for at gætte
    // forkert; ingen kendte prod-rækker rammer denne gren (alle 70 pending har
    // length_seasons ∈ {1,2,3}, verificeret 23/7).
    return pending?.per_race_day_rate ?? 0;
  }
  const originalRenownTarget = Math.round(guaranteedBase / fraction);
  const divisor = Number(calendarDays) > 0 ? Number(calendarDays) : FULL_CALENDAR_DAYS;
  return Math.round((originalRenownTarget - guaranteedBase) / divisor);
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
      // Aktivér managerens valg: pending -> active, MED genberegnet
      // per_race_day_rate ud fra den NYE sæsons faktiske kalenderlængde (#2589).
      const calendarDays = await loadCalendarDays({ supabase });
      const perRaceDayRate = recomputeActivationRate(pending, calendarDays);
      const { error } = await supabase
        .from("sponsor_contracts")
        .update({ status: "active", per_race_day_rate: perRaceDayRate })
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
