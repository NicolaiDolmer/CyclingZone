// backend/lib/sponsorContractsService.js
// DB-laget for sponsor-kontrakter (#1663, Økonomi Fase 2 · udvidet i #2948
// "Sponsorvalg 2.0"). Tilbud genereres deterministisk on-demand (ingen offers-
// tabel) via sponsorOffers.generateOffers ud fra holdets renown (division +
// sidste-sæsons placering, renownEngine). At acceptere et tilbud skriver en
// kontrakt-række med variant, frosne andele og bonusklausuler.
//
// supabase injiceres som service_role-klient (tests injicerer en mock).
//
// Schema-fakta (database/schema.sql + database/2026-07-25-sponsor-choice-2.sql):
//   sponsor_contracts.status CHECK ∈ {'active','expired','replaced','pending'}; to delvise
//     UNIQUE indekser → højst ÉN status='active' OG højst ÉN status='pending' pr. hold.
//     Flip altid den eksisterende aktive/pending væk FØR insert af en ny af samme status.
//   variant/guaranteed_fraction/race_day_share/bonus_clauses er kontraktens frosne
//     sandhed fra pick-tidspunktet; results_bonus_paid håndhæver results_cap.
//   Flow: manager vælger et tilbud for KOMMENDE sæson under nuværende sæson → 'pending'
//     (start_season = kommende). Ved sæson-skifte aktiveres den pending (eller default
//     'safe' oprettes hvis ingen — #2914: et ikke-valg binder 1 sæson, ikke 3).
//   seasons.number er sæson-heltallet; season_standings keyer på season_id (UUID FK
//     til seasons.id), IKKE et nummer → resolv forrige sæsons id først.
import { renownTarget } from "./renownEngine.js";
import { generateOffers, FULL_CALENDAR_DAYS, guaranteedFractionForLength } from "./sponsorOffers.js";
import { incrementBalanceWithAudit } from "./balanceRpc.js";
import {
  FINANCE_ACTOR_TYPE,
  FINANCE_REASON,
  FINANCE_RELATED_ENTITY,
} from "./economyConstants.js";

// #2914 (ejer-beslutning 25/7): default ved ikke-valg = 1-sæsons safe-aftale.
// 47 af 73 hold der valgte, valgte 1 sæson — defaulten skal matche flertallet,
// ikke binde passive hold i 3 sæsoner.
// Eksporteret i #2926 så sæson-transitionens PREVIEW bruger nøjagtig samme
// default som fornyelsen — ikke en kopi der kan drive fra hinanden.
export const DEFAULT_RENEW_VARIANT = "safe";

// Henter den reelle sæson-kalenderlængde (seasons.race_days_total) for den aktive
// sæson — bruges som DISPLAY-divisor i tilbud. Falder tilbage til FULL_CALENDAR_DAYS.
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

// #2913 (ejer-beslutning 25/7): enheden er PR. ETAPE, og divisoren er holdets
// FAKTISKE etapetal i den nye sæson — ikke 28/60 kalenderdage. Bygger et opslag
// { poolId → etapetal } + { tier → gennemsnitligt etapetal } for én sæson, så
// aktiveringen kan sætte raten mod det etapetal holdet reelt kan køre.
// Udbetalingen (sponsorRaceDayIncome) ganger med race.stages pr. løb — med denne
// divisor summer den variable del til race_day_share × target ved fuld deltagelse.
export async function loadSeasonStageCounts({ supabase, seasonNumber }) {
  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id, number, race_days_total")
    .eq("number", seasonNumber)
    .maybeSingle();
  if (seasonError) throw seasonError;
  const fallbackDays = Number(season?.race_days_total) > 0
    ? Number(season.race_days_total)
    : FULL_CALENDAR_DAYS;
  if (!season?.id) return { byPool: {}, byTier: {}, fallbackDays };

  const { data: races, error: racesError } = await supabase
    .from("races")
    .select("league_division_id, stages")
    .eq("season_id", season.id);
  if (racesError) throw racesError;

  const byPool = {};
  for (const r of races || []) {
    if (r.league_division_id == null) continue;
    byPool[r.league_division_id] =
      (byPool[r.league_division_id] || 0) + (Number(r.stages) || 1);
  }

  const { data: pools, error: poolsError } = await supabase
    .from("league_divisions")
    .select("id, tier");
  if (poolsError) throw poolsError;

  const tierTotals = {};
  for (const p of pools || []) {
    const stageCount = byPool[p.id];
    if (!stageCount) continue;
    if (!tierTotals[p.tier]) tierTotals[p.tier] = { sum: 0, pools: 0 };
    tierTotals[p.tier].sum += stageCount;
    tierTotals[p.tier].pools += 1;
  }
  const byTier = {};
  for (const [tier, t] of Object.entries(tierTotals)) {
    byTier[tier] = Math.round(t.sum / t.pools);
  }

  return { byPool, byTier, fallbackDays };
}

// Vælg divisor for ét hold: egen pulje → tier-gennemsnit → race_days_total → 60.
export function resolveStageDivisor(stageCounts, team) {
  const byPool = stageCounts?.byPool || {};
  const byTier = stageCounts?.byTier || {};
  const poolCount = team?.league_division_id != null ? byPool[team.league_division_id] : null;
  if (Number(poolCount) > 0) return Number(poolCount);
  const tierCount = team?.division != null ? byTier[team.division] : null;
  if (Number(tierCount) > 0) return Number(tierCount);
  const fallback = Number(stageCounts?.fallbackDays);
  return fallback > 0 ? fallback : FULL_CALENDAR_DAYS;
}

// Genberegn per_race_day_rate ved AKTIVERING (pending→active) mod holdets reelle
// etape-divisor (#2589 + #2913). Nye rækker (#2948) bærer guaranteed_fraction +
// race_day_share eksplicit — baglæns-udled target fra guaranteed_base og sæt
// raten som race_day_share × target / divisor. Legacy-rækker (uden fraction)
// falder tilbage til length_seasons-opslaget, hvor den variable pulje pr.
// definition var resten (1 − fraction).
//
// Math.round på originalRenownTarget FØRST: fraction (fx 0.55) er ikke eksakt
// repræsentérbar i IEEE-754; uden genopretning af heltallet kan slut-rundingen
// vippe forkert (verificeret eksempel i #2589-kommentaren).
export function recomputeActivationRate(pending, divisor) {
  const guaranteedBase = Number(pending?.guaranteed_base);
  const div = Number(divisor) > 0 ? Number(divisor) : FULL_CALENDAR_DAYS;

  const storedFraction = Number(pending?.guaranteed_fraction);
  const storedShare = Number(pending?.race_day_share);
  if (storedFraction > 0 && Number.isFinite(guaranteedBase)) {
    const originalRenownTarget = Math.round(guaranteedBase / storedFraction);
    const share = Number.isFinite(storedShare) && storedShare >= 0
      ? storedShare
      : 1 - storedFraction;
    return Math.round((originalRenownTarget * share) / div);
  }

  const fraction = guaranteedFractionForLength(pending?.length_seasons);
  if (!fraction || !Number.isFinite(guaranteedBase)) {
    // Ukendt/legacy variant-længde → kan ikke baglæns-udlede sikkert. Behold den
    // lagrede rate frem for at gætte forkert.
    return pending?.per_race_day_rate ?? 0;
  }
  const originalRenownTarget = Math.round(guaranteedBase / fraction);
  return Math.round((originalRenownTarget - guaranteedBase) / div);
}

// ─── #2926 · Delte, rene kontrakt-regler (preview ⇄ udførelse) ────────────────
// Sæson-transitionens dry-run modellerede tidligere en KONTRAKTFRI tilstand
// (division-base + variabel pulje) selvom udbetalingen sker EFTER
// expireAndRenewContracts har gjort én kontrakt aktiv pr. hold. Reglerne herunder
// er den eneste kilde til "hvilken kontrakt bærer den garanterede base i sæson N",
// så previewet og fornyelsen ikke kan drive fra hinanden.

/** Dækker kontrakten stadig `seasonNumber`? (samme test som expireAndRenewContracts). */
export function contractCoversSeason(contract, seasonNumber) {
  return Boolean(contract) && Number(contract.expires_after_season) >= Number(seasonNumber);
}

/** Er den pending kontrakt valgt netop TIL `seasonNumber`? */
export function pendingAppliesToSeason(pending, seasonNumber) {
  return Boolean(pending) && Number(pending.start_season) === Number(seasonNumber);
}

/**
 * Hvilken kontrakt bærer holdets garanterede base i `newSeasonNumber`?
 * Spejler expireAndRenewContracts' tre grene 1:1:
 *   1. "locked"  — den aktive kontrakt dækker stadig sæsonen (beholdes urørt)
 *   2. "pending" — managerens valg for netop denne sæson aktiveres
 *   3. "default" — intet valg → 'safe'-aftalen tildeles automatisk (#2914)
 *
 * Ren funktion: ingen I/O. `renownTargetValue` skal være beregnet med
 * renownEngine.renownTarget mod holdets NUVÆRENDE division + forrige sæsons
 * standings — nøjagtig samme input som loadRenownTargetValue henter i drift.
 * `calendarDays` rører kun DISPLAY-raten; den garanterede base er uafhængig.
 *
 * @returns {{ source: "locked"|"pending"|"default", contract: object }}
 */
export function resolveContractForNewSeason({
  teamId,
  newSeasonNumber,
  activeContract = null,
  pendingContract = null,
  renownTargetValue = 0,
  calendarDays = FULL_CALENDAR_DAYS,
} = {}) {
  if (contractCoversSeason(activeContract, newSeasonNumber)) {
    return { source: "locked", contract: activeContract };
  }
  if (pendingAppliesToSeason(pendingContract, newSeasonNumber)) {
    return { source: "pending", contract: pendingContract };
  }
  const offers = generateOffers({
    teamId,
    seasonNumber: newSeasonNumber,
    renownTargetValue,
    calendarDays,
  });
  const chosen = offers.find((o) => o.variant === DEFAULT_RENEW_VARIANT);
  if (!chosen) throw new Error(`Ukendt variant: ${DEFAULT_RENEW_VARIANT}`);
  return {
    source: "default",
    contract: {
      team_id: teamId,
      sponsor_name: chosen.sponsorName,
      guaranteed_base: chosen.guaranteedBase,
      per_race_day_rate: chosen.perRaceDayRate,
      length_seasons: chosen.lengthSeasons,
      start_season: newSeasonNumber,
      expires_after_season: newSeasonNumber + chosen.lengthSeasons - 1,
      status: "active",
      variant: chosen.variant,
      guaranteed_fraction: chosen.guaranteedFraction,
      race_day_share: chosen.raceDayShare,
      bonus_clauses: chosen.clauses,
      // Markør: rækken findes ikke i DB endnu — den OPRETTES af
      // expireAndRenewContracts ved skiftet. Kun til preview/rapportering.
      simulated: true,
    },
  };
}

/**
 * Den variable puljes STØRRELSE for en kontrakt (race_day_share × target) —
 * altså hvad holdet kan tjene over hele sæsonen ved fuld deltagelse, IKKE noget
 * der udbetales ved sæsonskiftet. Baglæns-udledt fra guaranteed_base præcis som
 * recomputeActivationRate, så legacy-rækker uden race_day_share også rammer rigtigt.
 */
export function contractRaceDayPool(contract) {
  const guaranteedBase = Number(contract?.guaranteed_base);
  if (!Number.isFinite(guaranteedBase)) return 0;

  const storedFraction = Number(contract?.guaranteed_fraction);
  const storedShare = Number(contract?.race_day_share);
  if (storedFraction > 0) {
    const target = Math.round(guaranteedBase / storedFraction);
    const share = Number.isFinite(storedShare) && storedShare >= 0
      ? storedShare
      : 1 - storedFraction;
    return Math.max(0, Math.round(target * share));
  }

  const fraction = guaranteedFractionForLength(contract?.length_seasons);
  if (!fraction) return 0;
  const target = Math.round(guaranteedBase / fraction);
  return Math.max(0, target - guaranteedBase);
}

/** Signing-bonussen på en kontrakt (0 hvis klausulen ikke findes). */
export function contractSigningBonus(contract) {
  const clause = (contract?.bonus_clauses || []).find((c) => c?.type === "signing");
  const amount = Number(clause?.amount);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
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

  // Forrige sæsons ALLE placeringer, ufiltreret. #2909: et hold der er rykket
  // op/ned mellem sæsoner findes IKKE i sin NYE division sidste sæson — filtrér
  // derfor aldrig FØR opslag på team_id. Præcis samme mønster som udbetalings-
  // stien (economyEngine.js processSeasonStart / seasonTransition.js preview).
  let allStandings = [];
  if (prevSeasonId) {
    const { data: rows, error: standingsError } = await supabase
      .from("season_standings")
      .select("season_id, team_id, division, rank_in_division, total_points")
      .eq("season_id", prevSeasonId);
    if (standingsError) throw standingsError;
    allStandings = rows || [];
  }

  const lastSeasonStanding =
    allStandings.find((s) => s.team_id === teamId) || null;

  // Sammenligningskonteksten (median/rank-faktor) er divisionen holdet FAKTISK
  // konkurrerede i sidste sæson — standingens EGEN division, ikke holdets nye.
  const divisionStandings = lastSeasonStanding
    ? allStandings.filter((s) => s.division === lastSeasonStanding.division)
    : [];

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

// #2948: varianten persisteres nu på rækken → stabil markering af managerens
// valg. Legacy pending-rækker (variant IS NULL trods backfill burde ikke
// findes) falder tilbage til det gamle length+base-match.
function derivePendingVariant(pending, targetSeasonNumber, offers) {
  if (!pending || pending.start_season !== targetSeasonNumber) return null;
  if (pending.variant) return pending.variant;
  const match = offers.find(
    (o) =>
      o.lengthSeasons === pending.length_seasons &&
      o.guaranteedBase === pending.guaranteed_base,
  );
  return match ? match.variant : null;
}

// Forhandlings-tilstand for nuværende sæson.
//
// #3316 (ejer-beslutning 4/8): et hold der INGEN aktiv kontrakt har overhovedet
// — et nyoprettet hold midt i sæsonen, eller en af de kontraktløse D4-hold
// audit'en fandt (16 uden nogen sponsor_contracts-række) — skal IKKE vente til
// næste sæsonskifte. De forhandler for INDEVÆRENDE sæson (immediate: true), og
// accept aktiverer straks (se acceptOfferImmediately) i stedet for at skrive en
// 'pending' der først aktiveres ved sæsonskiftet. Ingen separat backfill-sti
// nødvendig: tilbuddene genereres deterministisk on-demand her, så de 16 hold
// rammer denne gren automatisk næste gang de henter /sponsor/offers (fx ved
// Board-side-mount) — se PR-body for begrundelsen.
//
// Et hold MED en aktiv kontrakt kan forhandle for den KOMMENDE sæson
// (currentSeasonNumber + 1) hvis kontrakten udløber ved slutningen af
// nuværende sæson (expires_after_season <= currentSeasonNumber) — uændret
// pending-semantik, fornyelser venter stadig til sæsonskiftet.
export async function getNegotiationState({ supabase, teamId, currentSeasonNumber }) {
  const active = await getActiveContract({ supabase, teamId });

  if (!active) {
    const offers = await getOffers({ supabase, teamId, seasonNumber: currentSeasonNumber });
    const pending = await getPendingContract({ supabase, teamId });
    // Rører IKKE en pending for en SENERE sæson (fx et af de 5 D4-hold der
    // allerede har valgt et tilbud for næste sæson under den gamle semantik —
    // den forbliver urørt og aktiveres normalt ved det sæsonskifte, #3316
    // PR-scope). Kun en pending der (usædvanligt) allerede peger på
    // INDEVÆRENDE sæson vises som "valgt" her.
    const pendingVariant = derivePendingVariant(pending, currentSeasonNumber, offers);
    return {
      negotiable: true,
      upcomingSeasonNumber: currentSeasonNumber,
      offers,
      pendingVariant,
      immediate: true,
    };
  }

  const upcomingSeasonNumber = currentSeasonNumber + 1;
  const negotiable = active.expires_after_season <= currentSeasonNumber;

  const offers = negotiable
    ? await getOffers({ supabase, teamId, seasonNumber: upcomingSeasonNumber })
    : [];

  const pending = await getPendingContract({ supabase, teamId });
  const pendingVariant = derivePendingVariant(pending, upcomingSeasonNumber, offers);

  return { negotiable, upcomingSeasonNumber, offers, pendingVariant, immediate: false };
}

// Manager vælger et tilbud for den KOMMENDE sæson. Skriver en 'pending' række
// (start_season = upcomingSeasonNumber) med variant + frosne andele + klausuler;
// den aktiveres ved sæson-skiftet via expireAndRenewContracts.
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
    variant: chosen.variant,
    guaranteed_fraction: chosen.guaranteedFraction,
    race_day_share: chosen.raceDayShare,
    bonus_clauses: chosen.clauses,
  };
  const { data, error } = await supabase
    .from("sponsor_contracts")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data || row;
}

// #3316 (ejer-beslutning 4/8, løsning A): manager vælger et tilbud for
// INDEVÆRENDE sæson — holdet har ingen aktiv kontrakt (nyoprettet midt i
// sæsonen, eller en af de kontraktløse D4-hold audit'en fandt). Aktiverer
// straks (status='active', activated_at=now) i stedet for at skrive 'pending'.
//
// Rammer (ejer-mandat):
//   - race-day-rate + bonusklausuler (signing her) gælder fra activated_at —
//     sponsorRaceDayIncome filtrerer løb completet FØR dette tidspunkt, så
//     der aldrig sker bagudbetaling for løb holdet allerede kørte uden
//     kontrakt.
//   - INGEN guaranteed_base-udbetaling her. Basen krediteres udelukkende af
//     economyEngine.processSeasonStart ved den næste RIGTIGE sæson-start —
//     den kører ikke om igen for dette hold nu, så feltet skrives som
//     kontraktens frosne sandhed (bruges korrekt af næste sæsons ceiling/
//     payout-beregning) uden at nogen kreditering sker i denne funktion.
//   - per_race_day_rate genberegnes mod holdets EGEN etape-divisor for
//     INDEVÆRENDE sæson (samme #2913-mønster som expireAndRenewContracts'
//     default-fornyelse) — ikke pick-tidens FULL_CALENDAR_DAYS-fallback.
export async function acceptOfferImmediately({ supabase, teamId, seasonNumber, variant }) {
  const offers = await getOffers({ supabase, teamId, seasonNumber });
  const chosen = offers.find((o) => o.variant === variant);
  if (!chosen) throw new Error(`Ukendt variant: ${variant}`);

  // Flip KUN en eksisterende pending der peger på DENNE sæson (defensiv
  // oprydning af en usædvanlig dangling række). Rør ALDRIG en pending for en
  // SENERE sæson — det er præcis de 5 D4-holds allerede-valgte tilbud for
  // næste sæson, som denne PR bevidst IKKE må røre (se PR-body).
  const existingPending = await getPendingContract({ supabase, teamId });
  if (existingPending && existingPending.start_season === seasonNumber) {
    const { error: updateError } = await supabase
      .from("sponsor_contracts")
      .update({ status: "replaced" })
      .eq("id", existingPending.id);
    if (updateError) throw updateError;
  }

  // Samme #2913-mønster som expireAndRenewContracts: bulk .in()-opslag (ikke
  // .single()) så league_division_id er pålideligt med — resolveStageDivisor
  // skal kunne ramme holdets EGEN pulje, ikke kun tier-gennemsnittet.
  const stageCounts = await loadSeasonStageCounts({ supabase, seasonNumber });
  const { data: teamRows, error: teamError } = await supabase
    .from("teams")
    .select("id, division, league_division_id")
    .in("id", [teamId]);
  if (teamError) throw teamError;
  const teamRow = (teamRows || []).find((t) => t.id === teamId) || null;
  const divisor = resolveStageDivisor(stageCounts, teamRow);

  const target = Math.round(chosen.guaranteedBase / chosen.guaranteedFraction);
  const perRaceDayRate = Math.round((target * chosen.raceDayShare) / divisor);

  const row = {
    team_id: teamId,
    sponsor_name: chosen.sponsorName,
    guaranteed_base: chosen.guaranteedBase,
    per_race_day_rate: perRaceDayRate,
    length_seasons: chosen.lengthSeasons,
    start_season: seasonNumber,
    expires_after_season: seasonNumber + chosen.lengthSeasons - 1,
    status: "active",
    variant: chosen.variant,
    guaranteed_fraction: chosen.guaranteedFraction,
    race_day_share: chosen.raceDayShare,
    bonus_clauses: chosen.clauses,
    activated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("sponsor_contracts")
    .insert(row)
    .select()
    .single();
  if (error) throw error;

  const contract = data || row;
  await creditSigningBonus({ supabase, contract });
  return contract;
}

// Signing bonus (#2948): krediteres én gang ved aktivering. Idempotent pr.
// kontrakt via idempotency_key — gentagne transition-kørsler er harmløse.
async function creditSigningBonus({ supabase, contract }) {
  const clause = (contract.bonus_clauses || []).find((c) => c.type === "signing");
  const amount = Number(clause?.amount) || 0;
  if (amount <= 0) return;
  await incrementBalanceWithAudit(
    supabase,
    {
      teamId: contract.team_id,
      delta: amount,
      payload: {
        type: "sponsor_signing_bonus",
        amount,
        description: `Sponsor — signing bonus (${contract.sponsor_name})`,
        // #3198-fund-7b: metadata.code lader FinancePage vise en oversat tekst
        // i stedet for den rå engelske description ovenfor (kun brugt som
        // fallback for legacy-rækker uden metadata).
        metadata: {
          code: "tx.sponsor.signingBonus",
          params: { sponsorName: contract.sponsor_name },
        },
        actor_type: FINANCE_ACTOR_TYPE.SYSTEM,
        actor_id: null,
        source_path: "sponsorContractsService.creditSigningBonus",
        reason_code: FINANCE_REASON.SPONSOR_SIGNING_BONUS,
        related_entity_type: FINANCE_RELATED_ENTITY.SEASON,
        related_entity_id: null,
        idempotency_key: `sponsor_signing:${contract.id}`,
      },
    },
    { allowDuplicate: true }
  );
}

// Sæsonmåls-klausul-typer (#2948 "top_half", #3192 "top_40pct" — se
// docs/audits/2026-08-03-sponsor-archetype-ev-3192.md). NYE ambition-tilbud
// genereres kun med "top_40pct" (sponsorOffers.ARCHETYPES), men allerede-tegnede
// kontrakter med "top_half" skal blive ved med at evaluere korrekt for deres
// fulde løbetid — frosne klausuler må ALDRIG ændres retroaktivt.
const OBJECTIVE_THRESHOLD_FRACTION = { top_half: 0.5, top_40pct: 0.4 };

// Sæsonmåls-klausul (#2948): "slut i top-X af din division" → engangs-
// beløb ved sæsonafslutning. Evalueres for ALLE aktive kontrakter med klausulen
// (flersæsons-aftaler tjener den hver sæson), FØR expireAndRenewContracts flipper
// status. Idempotent pr. (kontrakt, sæson). Additiv-isoleret: kaldes i try/catch
// fra seasonTransition — en fejl her må ikke vælte skiftet.
export async function evaluateSeasonObjectives({ supabase, finishedSeasonNumber }) {
  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id")
    .eq("number", finishedSeasonNumber)
    .maybeSingle();
  if (seasonError) throw seasonError;
  if (!season?.id) return { evaluated: 0, paid: 0 };

  const { data: contracts, error: contractsError } = await supabase
    .from("sponsor_contracts")
    .select("id, team_id, sponsor_name, bonus_clauses")
    .eq("status", "active");
  if (contractsError) throw contractsError;

  const withObjective = (contracts || []).filter((c) =>
    (c.bonus_clauses || []).some((cl) => cl.type === "season_objective")
  );
  if (!withObjective.length) return { evaluated: 0, paid: 0 };

  const { data: standings, error: standingsError } = await supabase
    .from("season_standings")
    .select("team_id, league_division_id, rank_in_division")
    .eq("season_id", season.id);
  if (standingsError) throw standingsError;

  const poolSizes = {};
  for (const s of standings || []) {
    if (s.league_division_id == null) continue;
    poolSizes[s.league_division_id] = (poolSizes[s.league_division_id] || 0) + 1;
  }
  const standingByTeam = new Map((standings || []).map((s) => [s.team_id, s]));

  let paid = 0;
  for (const contract of withObjective) {
    const clause = contract.bonus_clauses.find((cl) => cl.type === "season_objective");
    const amount = Number(clause?.amount) || 0;
    if (amount <= 0) continue;

    const standing = standingByTeam.get(contract.team_id);
    const poolSize = standing ? poolSizes[standing.league_division_id] : null;
    const rank = Number(standing?.rank_in_division);
    const thresholdFraction = OBJECTIVE_THRESHOLD_FRACTION[clause.objective];
    const achieved =
      thresholdFraction != null &&
      Number.isFinite(rank) &&
      Number(poolSize) > 0 &&
      rank <= Math.ceil(poolSize * thresholdFraction);
    if (!achieved) continue;

    const { skipped } = await incrementBalanceWithAudit(
      supabase,
      {
        teamId: contract.team_id,
        delta: amount,
        payload: {
          type: "sponsor_objective_bonus",
          amount,
          description: `Sponsor — season objective met (${contract.sponsor_name})`,
          // #3198-fund-7b: se creditSigningBonus ovenfor.
          metadata: {
            code: "tx.sponsor.objectiveBonus",
            params: { sponsorName: contract.sponsor_name },
          },
          actor_type: FINANCE_ACTOR_TYPE.SYSTEM,
          actor_id: null,
          source_path: "sponsorContractsService.evaluateSeasonObjectives",
          reason_code: FINANCE_REASON.SPONSOR_OBJECTIVE_BONUS,
          related_entity_type: FINANCE_RELATED_ENTITY.SEASON,
          related_entity_id: season.id,
          idempotency_key: `sponsor_objective:${contract.id}:${finishedSeasonNumber}`,
        },
      },
      { allowDuplicate: true }
    );
    if (!skipped) paid += 1;
  }

  return { evaluated: withObjective.length, paid };
}

// Sæson-skifte: for hvert hold — behold en stadig-låst kontrakt; ellers udløb den
// gamle ('expired') og AKTIVÉR holdets pending valg (flip pending->active) med
// per-etape-rate mod holdets reelle etape-divisor (#2913) + signing bonus. Hvis
// ingen matchende pending findes: opret default 'safe'-kontrakt (#2914).
export async function expireAndRenewContracts({ supabase, newSeasonNumber, teamIds }) {
  // Ét opslag for divisorer + holdenes nye pulje/tier (komprimeringen har kørt
  // FØR transitionen, jf. drejebogen — teams bærer S2-værdierne her).
  const stageCounts = await loadSeasonStageCounts({ supabase, seasonNumber: newSeasonNumber });
  const { data: teamRows, error: teamRowsError } = await supabase
    .from("teams")
    .select("id, division, league_division_id")
    .in("id", teamIds);
  if (teamRowsError) throw teamRowsError;
  const teamById = new Map((teamRows || []).map((t) => [t.id, t]));

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

    const divisor = resolveStageDivisor(stageCounts, teamById.get(teamId));

    const pending = await getPendingContract({ supabase, teamId });
    if (pending && pending.start_season === newSeasonNumber) {
      // Aktivér managerens valg: pending -> active, MED genberegnet
      // per_race_day_rate mod holdets etape-divisor (#2589 + #2913).
      const perRaceDayRate = recomputeActivationRate(pending, divisor);
      const { error } = await supabase
        .from("sponsor_contracts")
        .update({ status: "active", per_race_day_rate: perRaceDayRate })
        .eq("id", pending.id);
      if (error) throw error;
      await creditSigningBonus({
        supabase,
        contract: { ...pending, per_race_day_rate: perRaceDayRate },
      });
      continue;
    }

    // Ingen matchende pending → default-forny med 'safe' for den nye sæson (#2914).
    const offers = await getOffers({
      supabase,
      teamId,
      seasonNumber: newSeasonNumber,
    });
    const chosen = offers.find((o) => o.variant === DEFAULT_RENEW_VARIANT);
    if (!chosen) throw new Error(`Ukendt variant: ${DEFAULT_RENEW_VARIANT}`);

    const target = Math.round(chosen.guaranteedBase / chosen.guaranteedFraction);
    const row = {
      team_id: teamId,
      sponsor_name: chosen.sponsorName,
      guaranteed_base: chosen.guaranteedBase,
      per_race_day_rate: Math.round((target * chosen.raceDayShare) / divisor),
      length_seasons: chosen.lengthSeasons,
      start_season: newSeasonNumber,
      expires_after_season: newSeasonNumber + chosen.lengthSeasons - 1,
      status: "active",
      variant: chosen.variant,
      guaranteed_fraction: chosen.guaranteedFraction,
      race_day_share: chosen.raceDayShare,
      bonus_clauses: chosen.clauses,
    };
    const { error } = await supabase
      .from("sponsor_contracts")
      .insert(row)
      .select()
      .single();
    if (error) throw error;
  }
}
