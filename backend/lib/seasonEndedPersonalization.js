// #2924 · Personlig sæsonslut-besked.
// =====================================
// Sæsonslut-notifikationen (`season_ended`, #2745) var identisk for alle ~150
// managere: "Season 1 has ended. The season is over...". Det er den ENESTE
// besked i spillet der rammer alle på én gang, og den sagde intet om
// modtageren. Denne modul beriger den med data der allerede findes:
// slutplacering i puljen, sæsonpoint, samlet præmiesum, holdets bedste rytter
// og (når det er SANDT på afsendelsestidspunktet) næste sæsons division.
//
// ── Hård fail-safe (kontrakt) ────────────────────────────────────────────────
// Personaliseringen er ren pynt oven på en besked der SKAL ud. Derfor:
//   · loadSeasonEndedPersonalization kaster ALDRIG — fejler et opslag,
//     returneres et tomt map, og alle hold får den generiske besked.
//   · buildPersonalSeasonEndedMessage returnerer null (ikke exception) hvis
//     bare ét påkrævet felt mangler → dét hold får den generiske besked.
// En personaliseringsfejl må aldrig kaste ind i sæson-afslutningen eller
// stoppe udsendelsen til de øvrige managere.
//
// ── Datakilder (alle læses read-only, ingen nye tabeller) ────────────────────
//   · season_standings         — rank_in_division, total_points, division, pulje
//   · team_standings_ext_mv    — prize_earned pr. hold pr. sæson (#2175-matview)
//   · rider_rankings_mv        — points pr. rytter pr. sæson (#2175-matview)
//   · riders                   — navn + team_id (nuværende ejer)
// Matviewsene refreshes efter hver løbs-finalisering (raceRunner) og af cron,
// og "Afslut sæson" er spærret indtil ALLE løb er afviklet (#2805) — så de er
// friske på afsendelsestidspunktet. Alternativet (rå aggregering over
// race_results) er 487k rækker for én sæson og hører ikke hjemme i en
// notifikations-sti.

import { fetchAllRows } from "./supabasePagination.js";

const ID_CHUNK_SIZE = 200;

export const SEASON_ENDED_MESSAGE_CODES = Object.freeze({
  full: "notif.seasonEnded.messagePersonal",
  noNextDivision: "notif.seasonEnded.messagePersonalNoNextDivision",
  noRider: "notif.seasonEnded.messagePersonalNoRider",
  minimal: "notif.seasonEnded.messagePersonalMinimal",
});

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function toFiniteNumber(value) {
  // PostgREST leverer bigint/numeric som string — Number() normaliserer, og
  // Number.isFinite afviser null/undefined/"" /NaN i ét greb.
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function riderDisplayName(rider) {
  const name = [rider?.firstname, rider?.lastname].filter(Boolean).join(" ").trim();
  return name || null;
}

/**
 * Saml per-hold-fakta til den personlige sæsonslut-besked.
 *
 * @param {object}  args
 * @param {object}  args.supabase             — service-role client
 * @param {string}  args.seasonId             — sæsonen der netop er afsluttet
 * @param {Array}   args.teams                — [{ id, user_id, division }]
 * @param {boolean} args.includeNextDivision  — må vi love en division for næste
 *                                              sæson? (se emitSeasonEnded-
 *                                              Notifications: kun sandt når
 *                                              op/nedrykningen FAKTISK er kørt)
 * @returns {Promise<Map<string, object>>}    — team_id → facts (tomt map ved fejl)
 */
export async function loadSeasonEndedPersonalization({
  supabase,
  seasonId,
  teams = [],
  includeNextDivision = false,
}) {
  const facts = new Map();
  try {
    const teamIds = (teams || []).map((t) => t?.id).filter(Boolean);
    if (!seasonId || teamIds.length === 0) return facts;

    // 1) Slutstilling. Vi henter HELE sæsonens standings (også AI-hold) fordi
    //    puljestørrelsen ("nr. 4 ud af 24") kun kan tælles på det fulde felt.
    const standings = await fetchAllRows(() =>
      supabase
        .from("season_standings")
        .select("team_id, rank_in_division, total_points, division, league_division_id")
        .eq("season_id", seasonId)
        .order("team_id"),
    );

    const poolSizes = new Map();
    for (const row of standings) {
      // Puljen er league_division_id når den findes; ellers falder vi tilbage
      // til divisions-nummeret (ældre sæsoner uden pulje-opdeling).
      const poolKey = row.league_division_id ?? `div:${row.division}`;
      poolSizes.set(poolKey, (poolSizes.get(poolKey) || 0) + 1);
    }

    const standingByTeam = new Map(standings.map((row) => [row.team_id, row]));

    // 2) Præmiesum pr. hold (matview — én række pr. hold pr. sæson).
    const prizeRows = await fetchAllRows(() =>
      supabase
        .from("team_standings_ext_mv")
        .select("team_id, prize_earned")
        .eq("season_id", seasonId)
        .order("team_id"),
    );
    const prizeByTeam = new Map(
      prizeRows.map((row) => [row.team_id, toFiniteNumber(row.prize_earned) ?? 0]),
    );

    // 3) Rytterne på de relevante hold + deres sæsonpoint. team_id på riders er
    //    den NUVÆRENDE ejer: beskeden sendes før transitionens frigivelses- og
    //    pensionsfaser, så truppen er stadig sæsonens trup.
    const riders = [];
    for (const ids of chunk(teamIds, ID_CHUNK_SIZE)) {
      const page = await fetchAllRows(() =>
        supabase
          .from("riders")
          .select("id, firstname, lastname, team_id")
          .in("team_id", ids)
          .order("id"),
      );
      riders.push(...page);
    }

    const pointsByRider = new Map();
    const riderIds = riders.map((r) => r.id).filter(Boolean);
    for (const ids of chunk(riderIds, ID_CHUNK_SIZE)) {
      const page = await fetchAllRows(() =>
        supabase
          .from("rider_rankings_mv")
          .select("rider_id, points")
          .eq("season_id", seasonId)
          .in("rider_id", ids)
          .order("rider_id"),
      );
      for (const row of page) pointsByRider.set(row.rider_id, toFiniteNumber(row.points) ?? 0);
    }

    const bestRiderByTeam = new Map();
    for (const rider of riders) {
      const points = pointsByRider.get(rider.id);
      if (!Number.isFinite(points) || points <= 0) continue; // 0-point-ryttere er ikke en "bedste rytter"
      const current = bestRiderByTeam.get(rider.team_id);
      // Deterministisk tiebreak (point → id) så en re-run giver SAMME besked og
      // notifyUser's dedup dermed stadig virker.
      if (!current || points > current.points || (points === current.points && rider.id < current.id)) {
        bestRiderByTeam.set(rider.team_id, { id: rider.id, points, name: riderDisplayName(rider) });
      }
    }

    // 4) Saml.
    for (const team of teams) {
      const standing = standingByTeam.get(team.id);
      if (!standing) continue;
      const poolKey = standing.league_division_id ?? `div:${standing.division}`;
      const best = bestRiderByTeam.get(team.id);
      facts.set(team.id, {
        rank: toFiniteNumber(standing.rank_in_division),
        poolSize: poolSizes.get(poolKey) ?? null,
        division: toFiniteNumber(standing.division),
        points: toFiniteNumber(standing.total_points) ?? 0,
        prize: prizeByTeam.get(team.id) ?? 0,
        riderName: best?.name ?? null,
        riderPoints: best?.points ?? null,
        nextDivision: includeNextDivision ? toFiniteNumber(team.division) : null,
      });
    }
  } catch (err) {
    // best-effort: personalisering er pynt — en fejl her må aldrig forhindre at
    // sæsonslut-beskeden overhovedet bliver sendt. Tomt map → generisk besked
    // til alle, præcis som før #2924.
    console.error("season_ended personalisering kunne ikke hentes (falder tilbage til generisk besked):", err?.message || err);
    return new Map();
  }
  return facts;
}

function formatNumber(value) {
  // EN-first fallback-strengen der gemmes i notifications.message. Den
  // lokaliserede rendering sker i frontenden via messageCode + messageParams.
  return Number(value).toLocaleString("en-US");
}

/**
 * Engelsk ordenstal: 1st, 2nd, 3rd, 4th ... (ejer-beslutning 25/7).
 *
 * Teens er undtagelsen: 11th/12th/13th følger IKKE 1st/2nd/3rd-mønstret, mens
 * 21st/22nd/23rd gør. Derfor tjekkes de sidste TO cifre først.
 *
 * Bruges KUN til engelsk. Dansk beholder det rå tal ("plads 4 ud af 24"), og
 * derfor sendes både `rank` (tal) og `rankOrdinal` (streng) som i18n-parametre
 * — ellers ville den danske skabelon rendere "plads 4th ud af 24".
 */
export function formatEnglishOrdinal(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  const whole = Math.trunc(num);
  const lastTwo = Math.abs(whole) % 100;
  const lastOne = Math.abs(whole) % 10;
  let suffix = "th";
  if (lastTwo < 11 || lastTwo > 13) {
    if (lastOne === 1) suffix = "st";
    else if (lastOne === 2) suffix = "nd";
    else if (lastOne === 3) suffix = "rd";
  }
  return `${whole}${suffix}`;
}

/**
 * Byg den personlige besked. Returnerer null hvis grundlaget ikke er komplet —
 * kalderen sender da den generiske besked.
 *
 * @returns {{ message: string, messageCode: string, messageParams: object } | null}
 */
export function buildPersonalSeasonEndedMessage({ facts, nextSeasonNumber } = {}) {
  if (!facts) return null;

  const { rank, poolSize, division, points, prize, riderName, riderPoints, nextDivision } = facts;

  // Påkrævet minimum: placering, puljestørrelse, division, point og præmiesum.
  // Mangler ét af dem, er beskeden ikke sand nok til at sende.
  if (![rank, poolSize, division, points, prize].every((v) => Number.isFinite(v))) return null;
  if (rank <= 0 || poolSize <= 0) return null;

  const hasRider = typeof riderName === "string" && riderName.length > 0 && Number.isFinite(riderPoints);
  const hasNextDivision = Number.isFinite(nextDivision) && Number.isFinite(nextSeasonNumber);

  const rankOrdinal = formatEnglishOrdinal(rank);
  const base = `You finished ${rankOrdinal} of ${formatNumber(poolSize)} in Division ${division} with ${formatNumber(points)} points and CZ$ ${formatNumber(prize)} in prize money.`;
  const riderSentence = hasRider
    ? ` Your best rider was ${riderName} with ${formatNumber(riderPoints)} points.`
    : "";
  const nextSentence = hasNextDivision
    ? ` You start Season ${formatNumber(nextSeasonNumber)} in Division ${nextDivision}.`
    : "";

  let messageCode;
  if (hasRider && hasNextDivision) messageCode = SEASON_ENDED_MESSAGE_CODES.full;
  else if (hasRider) messageCode = SEASON_ENDED_MESSAGE_CODES.noNextDivision;
  else if (hasNextDivision) messageCode = SEASON_ENDED_MESSAGE_CODES.noRider;
  else messageCode = SEASON_ENDED_MESSAGE_CODES.minimal;

  // rank = rå tal (dansk: "plads 4"), rankOrdinal = engelsk ordenstal ("4th").
  // Begge sendes altid, så hver locale-skabelon kan vælge sin egen form.
  const messageParams = { rank, rankOrdinal, poolSize, division, points, prize };
  if (hasRider) {
    messageParams.rider = riderName;
    messageParams.riderPoints = riderPoints;
  }
  if (hasNextDivision) {
    messageParams.nextSeason = nextSeasonNumber;
    messageParams.nextDivision = nextDivision;
  }

  return {
    message: `${base}${riderSentence}${nextSentence}`,
    messageCode,
    messageParams,
  };
}
