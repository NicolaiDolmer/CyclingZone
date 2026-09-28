// backend/lib/academyBoardGift.ts
// #5844 — "A thank-you from the board" / "Tak fra bestyrelsen" (ejer-design 28/9).
//
// Ét ENGANGS-kuld på 10 akademi-TILBUD til hvert aktivt menneskehold: 5 i U23-
// alder, 5 i junior-alder. Genbruger den eksisterende tilbuds-mekanik HELT:
// seedAcademyCohortForTeam skriver ryttere + academy_intake-rækker med status
// 'offered', og manageren signer/afviser via de normale ruter
// (signAcademyCandidate / rejectAcademyCandidate). Det eneste nye er mærket
// academy_intake.source = 'board_gift', som bærer tre særregler:
//
//   • signing-fee = 0            (academyIntake.signAcademyCandidate)
//   • 14 dages frist, ikke 7     (academyIntakeExpirySweep + /api/academy/me)
//   • eget mærke i akademiet     (AcademyPage)
//
// Trupgrænserne (U23 12 / junior 10) håndhæves ved SIGNING som i dag
// (finalize_academy_acquisition); tilbud må gerne overstige ledige pladser.
//
// ADSKILT fra det ugentlige optag: den ugentlige hentning/drip claimer
// academy_intake_ticks, og dette modul rører aldrig den tabel. Idempotens bor i
// sin egen claim-tabel academy_gift_claims (team_id, batch), claim-først.

import {
  fetchActiveSeason,
  fetchExistingFoldedRiderNames,
  hashStringToSeed,
  referenceYearForSeason,
  seedAcademyCohortForTeam,
} from "./academyIntake.js";
import { generateAcademyCandidates, POTENTIALE_TIERS } from "./academyGenerator.js";
import { makeRng } from "./fictionalRiderGenerator.js";
import { REAL_CYCLING_NATION_WEIGHTS } from "./cyclingNationWeights.js";
import { fetchAllRows } from "./supabasePagination.js";
import { deriveForRiderIds } from "./backfillCores.js";
import { notifyTeamOwner } from "./notificationService.js";
import { ageForReferenceYear } from "./riderSeasonAge.js";
import { effectiveSquad, SQUAD_CAPS } from "./squads.js";
import { BOARD_GIFT_SOURCE, isMissingSchemaError } from "./academyIntakeSource.ts";

export {
  BOARD_GIFT_SOURCE,
  BOARD_GIFT_EXPIRY_DAYS,
  NORMAL_INTAKE_EXPIRY_DAYS,
  isBoardGiftSource,
  intakeOfferExpiryDaysFor,
  isMissingSchemaError,
} from "./academyIntakeSource.ts";
export const BOARD_GIFT_BATCH = "board_thanks_5844";
export const BOARD_GIFT_SEED = 5844;

// 5 + 5 (ejer 28/9). Aldrene er SÆSONALDER (riderSeasonAge.js / squads.js):
// junior ≤ 18, U23 19-22. U23-båndet stopper ved 21 (akademi-generatorens
// MAX_AGE), så ingen gave-rytter er vokset ud af U23 allerede næste sæson.
export const BOARD_GIFT_COHORTS = Object.freeze([
  Object.freeze({ squad: "u23", count: 5, ageBand: Object.freeze({ min: 19, max: 21 }) }),
  Object.freeze({ squad: "junior", count: 5, ageBand: Object.freeze({ min: 16, max: 18 }) }),
]);
export const BOARD_GIFT_TOTAL = BOARD_GIFT_COHORTS.reduce((s, c) => s + c.count, 0);

// "Mindst ét talent i den øverste del af fordelingen": potentiale ≥ 3.0 er den
// øverste ~9 % af den geometriske intake-fordeling (drawPotentiale, decay 0,55).
// Kan overstyres fra scriptet (--top-min) efter ejer-valg.
export const BOARD_GIFT_TOP_TALENT_MIN = 3;

// Nationsprofil: de TOP_NATIONS største nationer på holdets nuværende ryttere
// får TEAM_SHARE af vægten (fordelt efter deres andel); resten fordeles efter
// den realistiske cykelnations-fordeling (REAL_CYCLING_NATION_WEIGHTS). Under MIN_PROFILE_RIDERS ryttere med nation →
// fallback til normal fordeling.
export const NATION_PROFILE_TOP_NATIONS = 3;
export const NATION_PROFILE_TEAM_SHARE = 0.7;
export const NATION_PROFILE_MIN_RIDERS = 5;

// Startholdets auto-fyld (#1563-allokatoren) fødes med generation_tag 'fill_tail'
// og har overvejende generatorens GARANTI-nationer (CN/CO/DZ/ER/JP/KR; målt 28/9:
// 87 % af 392 fill_tail-ryttere på modtager-holdene). En profil af dem afspejler
// generatoren, ikke managerens valg. Profil-tilstanden er et ejer-valg:
//   "all"               — alle nuværende ryttere
//   "exclude-fill-tail" — uden fill_tail-rytterne (ejer-valgt 28/9, default)
export const NATION_PROFILE_MODES = Object.freeze(["all", "exclude-fill-tail"]);
export const FILL_TAIL_TAG = "fill_tail";
// Ejer-valg 28/9 (PR #5874): B = uden fill_tail. Profilens top-3 blandes med den
// REALISTISKE cykelnations-fordeling (cyclingNationWeights.js), og hold uden nok
// profil får den realistiske fordeling alene.
export const DEFAULT_NATION_PROFILE_MODE = "exclude-fill-tail";

// ── Typer ────────────────────────────────────────────────────────────────────
// Supabase-klienten er utypet i kernen (samme som resten af akademi-modulerne);
// den holdes som `any` ved grænsen, mens modulets egne data er typede.
type Db = any;
export type NationProfileMode = "all" | "exclude-fill-tail";
export type NationWeight = { value: string; weight: number };
export type TopNation = { code: string; count: number };
export type TeamRow = {
  id: string;
  is_ai?: boolean;
  is_bank?: boolean;
  is_frozen?: boolean;
  is_test_account?: boolean;
  retired_at?: string | null;
  parked_at?: string | null;
  league_division_id?: number | null;
};
export type TeamProfile = { nations: (string | null)[]; nationsExclFillTail?: (string | null)[]; junior: number; u23: number };
export type OfferSummary = { squad?: string; nationality?: string; potentiale?: number; is_serious?: boolean; riderId?: string };
export type TeamStatus = "planned" | "applied" | "skipped_already_claimed" | "failed_released" | "failed_partial";
export type TeamEntry = {
  teamId: string;
  alreadyClaimed: boolean;
  nationProfile: TopNation[] | null;
  squadCounts: { u23: number; junior: number };
  freeSlots: { u23: number; junior: number };
  offers: OfferSummary[];
  status: TeamStatus | null;
  error?: string;
};
export type GiftPart = {
  squad: string;
  countOverride: number;
  generatorOptions: {
    ageBand: { min: number; max: number };
    nationalityWeights: NationWeight[] | null;
    topTalentIndex: number | null;
    topTalentMin: number;
  };
};
export type GiftRun = {
  dryRun: boolean;
  batch: string;
  seed: number;
  topTalentMin: number;
  nationProfileMode: NationProfileMode;
  seasonNumber: number;
  referenceYear: number;
  recipients: number;
  teams: TeamEntry[];
  schemaMissing?: boolean;
};
type Season = { id: string; number: number; start_date?: string };
type Rng = () => number;

/**
 * Modtager-prædikatet (ejer 28/9): menneskehold i en S4-pulje, ikke parkeret,
 * ikke frosset, ikke retired, ikke testkonto. Ingen aktivitetsfilter.
 */
export function isBoardGiftRecipient(team: TeamRow | null | undefined): boolean {
  if (!team) return false;
  return team.is_ai === false
    && team.is_bank === false
    && team.is_frozen === false
    && team.is_test_account === false
    && team.retired_at == null
    && team.parked_at == null
    && team.league_division_id != null;
}

export async function fetchBoardGiftRecipients(supabase: Db): Promise<TeamRow[]> {
  const rows: TeamRow[] = await fetchAllRows(() =>
    supabase
      .from("teams")
      .select("id, user_id, is_ai, is_bank, is_frozen, is_test_account, retired_at, parked_at, league_division_id")
      .eq("is_ai", false)
      .eq("is_bank", false)
      .eq("is_frozen", false)
      .eq("is_test_account", false)
      .is("retired_at", null)
      .is("parked_at", null)
      .not("league_division_id", "is", null)
      .order("id"));
  // Prædikatet køres også i JS, så filteret har én testbar sandhed.
  return rows.filter(isBoardGiftRecipient);
}

/**
 * Nations-vægte ud fra holdets nuværende ryttere. Returnerer null (= normal
 * fordeling) når holdet har for få ryttere med nation.
 *
 * @param {(string|null)[]} nationalityCodes
 * @returns {{weights: {value:string,weight:number}[], topNations: {code:string,count:number}[]} | null}
 */
export function buildTeamNationalityWeights(nationalityCodes: (string | null | undefined)[] | null | undefined, {
  topN = NATION_PROFILE_TOP_NATIONS,
  teamShare = NATION_PROFILE_TEAM_SHARE,
  minRiders = NATION_PROFILE_MIN_RIDERS,
  defaults = REAL_CYCLING_NATION_WEIGHTS as NationWeight[],
}: { topN?: number; teamShare?: number; minRiders?: number; defaults?: NationWeight[] } = {}): { weights: NationWeight[]; topNations: TopNation[] } | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const code of nationalityCodes ?? []) {
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
    total++;
  }
  if (total < minRiders) return null;
  const topNations: TopNation[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([code, count]) => ({ code, count }));
  const topSum = topNations.reduce((s, n) => s + n.count, 0);
  const defaultSum = defaults.reduce((s, d) => s + d.weight, 0);
  // Skala 1000, så vægtene er læsbare i rapporten; weightedPick normaliserer selv.
  const byCode = new Map<string, number>();
  for (const d of defaults) {
    byCode.set(d.value, (1 - teamShare) * 1000 * (d.weight / defaultSum));
  }
  for (const n of topNations) {
    byCode.set(n.code, (byCode.get(n.code) ?? 0) + teamShare * 1000 * (n.count / topSum));
  }
  const weights = [...byCode.entries()].map(([value, weight]) => ({ value, weight }));
  return { weights, topNations };
}

/**
 * Plan for ét holds kuld: generator-options pr. delkuld. Talent-garantien
 * placeres på ét tilfældigt (seedet) indeks i ét af de to delkuld.
 */
export function planTeamGift({ rng, nationalityWeights = null, topTalentMin = BOARD_GIFT_TOP_TALENT_MIN }: {
  rng: Rng;
  nationalityWeights?: NationWeight[] | null;
  topTalentMin?: number;
}): GiftPart[] {
  const slot = Math.floor(rng() * BOARD_GIFT_TOTAL);
  let offset = 0;
  return BOARD_GIFT_COHORTS.map((cohort): GiftPart => {
    const inThis = slot >= offset && slot < offset + cohort.count;
    const opts = {
      squad: cohort.squad,
      countOverride: cohort.count,
      generatorOptions: {
        ageBand: { ...cohort.ageBand },
        nationalityWeights,
        topTalentIndex: inThis ? slot - offset : null,
        topTalentMin,
      },
    };
    offset += cohort.count;
    return opts;
  });
}

/** Per-hold PRNG: reproducerbart kuld pr. (seed, hold, batch). */
export function teamGiftRng(seed: number, teamId: string, batch: string = BOARD_GIFT_BATCH): Rng {
  return makeRng((((seed >>> 0) ^ hashStringToSeed(`${teamId}:${batch}`)) >>> 0));
}

/**
 * Nuværende ryttere pr. modtager-hold: nationer (profil) + ungdomstrup-tællinger
 * (til rapportens "ledige pladser"). Én paged læsning.
 */
export async function fetchTeamRiderProfiles(supabase: Db, teamIds: string[], { referenceYear }: { referenceYear: number }): Promise<Map<string, TeamProfile>> {
  const wanted = new Set(teamIds);
  const profiles = new Map<string, TeamProfile & { nationsExclFillTail: (string | null)[] }>(
    teamIds.map((id) => [id, { nations: [], nationsExclFillTail: [], junior: 0, u23: 0 }]),
  );
  const ids = [...wanted];
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const rows: any[] = await fetchAllRows(() =>
      supabase
        .from("riders")
        .select("id, team_id, nationality_code, birthdate, squad, is_academy, is_retired, generation_tag")
        .in("team_id", chunk)
        .order("id"));
    for (const r of rows) {
      if (r.is_retired === true) continue;
      const p = profiles.get(r.team_id);
      if (!p) continue;
      p.nations.push(r.nationality_code ?? null);
      if (r.generation_tag !== FILL_TAIL_TAG) p.nationsExclFillTail.push(r.nationality_code ?? null);
      const sq = effectiveSquad(r, ageForReferenceYear(r.birthdate, referenceYear));
      if (sq === "junior") p.junior++;
      else if (sq === "u23") p.u23++;
    }
  }
  return profiles;
}

async function fetchExistingClaims(supabase: Db, batch: string): Promise<{ claimed: Set<string>; schemaMissing: boolean }> {
  const { data, error } = await supabase
    .from("academy_gift_claims")
    .select("team_id")
    .eq("batch", batch);
  if (error) {
    if (isMissingSchemaError(error)) return { claimed: new Set<string>(), schemaMissing: true };
    throw new Error(`board-gift claims lookup: ${error.message}`);
  }
  return { claimed: new Set<string>((data ?? []).map((r: { team_id: string }) => r.team_id)), schemaMissing: false };
}

async function claimTeam(supabase: Db, teamId: string, batch: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("academy_gift_claims")
    .upsert({ team_id: teamId, batch }, { onConflict: "team_id,batch", ignoreDuplicates: true })
    .select("team_id");
  if (error) throw new Error(`board-gift claim ${teamId}: ${error.message}`);
  return Boolean(data?.length);
}

async function countGiftRows(supabase: Db, teamId: string): Promise<number> {
  const { count, error } = await supabase
    .from("academy_intake")
    .select("id", { count: "exact", head: true })
    .eq("team_id", teamId)
    .eq("source", BOARD_GIFT_SOURCE);
  if (error) throw new Error(`board-gift row count ${teamId}: ${error.message}`);
  return count ?? 0;
}

export const BOARD_GIFT_NOTIFICATION = Object.freeze({
  type: "academy_intake_ready",
  // EN-first fallback; locale-aware rendering via backendMessages-koderne.
  title: "A thank-you from the board",
  message: "Thank you for racing with me. I've put 10 youth prospects in your academy: 5 at U23 age and 5 at junior age. Signing them is free, and normal youth wages apply. Pick the ones you want within 14 days. The rest leave quietly.",
  metadata: Object.freeze({
    titleCode: "notif.academyBoardGift.title",
    messageCode: "notif.academyBoardGift.message",
  }),
});

function summarizeCandidate(c: { is_serious: boolean; rider: object }, squad: string): OfferSummary {
  const rider = c.rider as { nationality_code?: string; potentiale?: number };
  return {
    squad,
    nationality: rider.nationality_code,
    potentiale: rider.potentiale,
    is_serious: c.is_serious,
  };
}

function assertNationProfileMode(mode: string): asserts mode is NationProfileMode {
  if (!(NATION_PROFILE_MODES as readonly string[]).includes(mode)) throw new Error(`unknown nationProfileMode: ${mode}`);
}

function newTeamEntry(team: TeamRow, profile: TeamProfile, claimed: Set<string>, nationProfileMode: NationProfileMode = DEFAULT_NATION_PROFILE_MODE): { entry: TeamEntry; nationalityWeights: NationWeight[] | null } {
  const nat = buildTeamNationalityWeights(
    nationProfileMode === "exclude-fill-tail" ? (profile.nationsExclFillTail ?? []) : profile.nations,
  );
  return {
    entry: {
      teamId: team.id,
      alreadyClaimed: claimed.has(team.id),
      nationProfile: nat ? nat.topNations : null,
      squadCounts: { u23: profile.u23, junior: profile.junior },
      freeSlots: {
        u23: Math.max(0, SQUAD_CAPS.u23 - profile.u23),
        junior: Math.max(0, SQUAD_CAPS.junior - profile.junior),
      },
      offers: [],
      status: null,
    },
    // Uden profil: den realistiske cykelnations-fordeling, ALDRIG generatorens
    // default (som vægter garanti-nationerne CN/CO/DZ/ER/JP/KR op).
    nationalityWeights: nat ? nat.weights : [...REAL_CYCLING_NATION_WEIGHTS],
  };
}

/**
 * REN dry-run-kerne (ingen I/O): generér hvert holds kuld i hukommelsen med
 * præcis samme seed/plan som apply-stien. Bruges af runBoardThankYouGift og af
 * scriptets --snapshot-tilstand (read-only prod-udtræk).
 *
 * @param {object} data
 * @param {{number:number}} data.season
 * @param {number} data.referenceYear
 * @param {{id:string}[]} data.recipients
 * @param {Map<string,{nations:(string|null)[],junior:number,u23:number}>} data.profiles
 * @param {Set<string>} data.claimed
 * @param {Set<string>} data.existingNames   (muteres)
 */
export function planBoardGift(data: {
  season: { number: number };
  referenceYear: number;
  recipients: TeamRow[];
  profiles: Map<string, TeamProfile>;
  claimed: Set<string>;
  existingNames: Set<string>;
}, {
  batch = BOARD_GIFT_BATCH,
  seed = BOARD_GIFT_SEED,
  topTalentMin = BOARD_GIFT_TOP_TALENT_MIN,
  nationProfileMode = DEFAULT_NATION_PROFILE_MODE,
}: { batch?: string; seed?: number; topTalentMin?: number; nationProfileMode?: string } = {}): GiftRun {
  assertNationProfileMode(nationProfileMode);
  const teams: TeamEntry[] = [];
  for (const team of data.recipients) {
    const profile = data.profiles.get(team.id) ?? { nations: [], junior: 0, u23: 0 };
    const { entry, nationalityWeights } = newTeamEntry(team, profile, data.claimed, nationProfileMode);
    teams.push(entry);
    if (entry.alreadyClaimed) {
      entry.status = "skipped_already_claimed";
      continue;
    }
    const rng = teamGiftRng(seed, team.id, batch);
    const plan = planTeamGift({ rng, nationalityWeights, topTalentMin });
    for (const part of plan) {
      const candidates = generateAcademyCandidates({
        rng,
        referenceYear: data.referenceYear,
        existingNames: data.existingNames,
        countOverride: part.countOverride,
        ...part.generatorOptions,
      });
      for (const c of candidates) entry.offers.push(summarizeCandidate(c, part.squad));
    }
    entry.status = "planned";
  }
  return {
    dryRun: true,
    batch,
    seed,
    topTalentMin,
    nationProfileMode,
    seasonNumber: data.season.number,
    referenceYear: data.referenceYear,
    recipients: data.recipients.length,
    teams,
  };
}

/**
 * Kør bestyrelsens gave. dryRun (default) skriver INTET: den genererer kuldene
 * i hukommelsen med samme seed og returnerer en plan pr. hold.
 *
 * @returns {Promise<object>} rapport-data (ingen holdnavne)
 */
export async function runBoardThankYouGift(supabase: Db, {
  dryRun = true,
  batch = BOARD_GIFT_BATCH,
  seed = BOARD_GIFT_SEED,
  topTalentMin = BOARD_GIFT_TOP_TALENT_MIN,
  nationProfileMode = DEFAULT_NATION_PROFILE_MODE,
  onlyTeamIds = null,
  deriveRiders = deriveForRiderIds,
  notify = notifyTeamOwner,
  seedCohortFn = seedAcademyCohortForTeam,
  log = () => {},
}: {
  dryRun?: boolean;
  batch?: string;
  seed?: number;
  topTalentMin?: number;
  nationProfileMode?: string;
  onlyTeamIds?: string[] | null;
  deriveRiders?: (sb: Db, ids: string[], opts: { dryRun: boolean }) => Promise<unknown>;
  notify?: (args: any) => Promise<unknown>;
  seedCohortFn?: (sb: Db, args: any) => Promise<string[]>;
  log?: (msg: string) => void;
} = {}): Promise<GiftRun> {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!POTENTIALE_TIERS.includes(topTalentMin)) throw new Error(`topTalentMin ${topTalentMin} is not a potential tier`);
  assertNationProfileMode(nationProfileMode);

  const season: Season | null = await fetchActiveSeason(supabase);
  if (!season) throw new Error("board-gift: no active season");
  const referenceYear = referenceYearForSeason(season);

  let recipients = await fetchBoardGiftRecipients(supabase);
  if (Array.isArray(onlyTeamIds) && onlyTeamIds.length > 0) {
    const only = new Set(onlyTeamIds);
    recipients = recipients.filter((t) => only.has(t.id));
  }
  const { claimed, schemaMissing } = await fetchExistingClaims(supabase, batch);
  if (!dryRun && schemaMissing) {
    throw new Error("board-gift: migration 2026-09-28-5844-academy-board-gift.sql has not been applied");
  }

  const profiles = await fetchTeamRiderProfiles(supabase, recipients.map((t) => t.id), { referenceYear });
  const existingNames = await fetchExistingFoldedRiderNames(supabase);

  if (dryRun) {
    return {
      ...planBoardGift({ season, referenceYear, recipients, profiles, claimed, existingNames }, { batch, seed, topTalentMin, nationProfileMode }),
      schemaMissing,
    };
  }

  const teams: TeamEntry[] = [];
  for (const team of recipients) {
    const profile = profiles.get(team.id) ?? { nations: [], junior: 0, u23: 0 };
    const { entry, nationalityWeights } = newTeamEntry(team, profile, claimed, nationProfileMode);
    teams.push(entry);
    if (entry.alreadyClaimed) {
      entry.status = "skipped_already_claimed";
      continue;
    }
    const rng = teamGiftRng(seed, team.id, batch);
    const plan = planTeamGift({ rng, nationalityWeights, topTalentMin });

    // ── Claim-først: PK-kollision = holdet har allerede fået kuldet ──────────
    const won = await claimTeam(supabase, team.id, batch);
    if (!won) {
      entry.status = "skipped_already_claimed";
      continue;
    }
    const newIds: string[] = [];
    try {
      for (const part of plan) {
        const ids = await seedCohortFn(supabase, {
          teamId: team.id,
          season,
          referenceYear,
          existingNames,
          rng,
          countOverride: part.countOverride,
          generatorOptions: part.generatorOptions,
          source: BOARD_GIFT_SOURCE,
        });
        for (const id of ids) newIds.push(id);
      }
    } catch (err) {
      // Ingen gave-rækker skrevet → frigiv claim'et, så en genkørsel kan prøve
      // igen. Delvist skrevet → behold claim'et (aldrig dobbelt-kuld) og rapportér.
      // best-effort: kan tællingen ikke læses, behandles holdet som delvist
      // skrevet (null ≠ 0) og claim'et bevares. Det sikre valg: aldrig dobbelt-kuld.
      const written = await countGiftRows(supabase, team.id).catch(() => null);
      if (written === 0) {
        const { error: releaseErr } = await supabase
          .from("academy_gift_claims").delete().eq("team_id", team.id).eq("batch", batch);
        entry.status = releaseErr ? "failed_partial" : "failed_released";
        if (releaseErr) log(`board-gift ${team.id}: could not release claim: ${releaseErr.message}`);
      } else {
        entry.status = "failed_partial";
      }
      const message = err instanceof Error ? err.message : String(err);
      entry.error = message;
      log(`board-gift ${team.id}: ${message}`);
      continue;
    }
    if (newIds.length > 0) await deriveRiders(supabase, newIds, { dryRun: false });
    entry.offers = newIds.map((id) => ({ riderId: id }));
    await notify({
      supabase,
      teamId: team.id,
      type: BOARD_GIFT_NOTIFICATION.type,
      title: BOARD_GIFT_NOTIFICATION.title,
      message: BOARD_GIFT_NOTIFICATION.message,
      metadata: { ...BOARD_GIFT_NOTIFICATION.metadata },
    });
    entry.status = "applied";
    log(`board-gift ${team.id}: ${newIds.length} offers`);
  }

  return {
    dryRun: false,
    batch,
    seed,
    topTalentMin,
    nationProfileMode,
    seasonNumber: season.number,
    referenceYear,
    schemaMissing,
    recipients: recipients.length,
    teams,
  };
}

/**
 * Aggregér en kørsel til rapport-tal (ingen holdnavne, ingen id'er).
 */
export function summarizeBoardGiftRun(run: GiftRun) {
  const planned = run.teams.filter((t) => t.status === "planned" || t.status === "applied");
  const offers = planned.flatMap((t) => t.offers);
  const nations = new Map<string, number>();
  const potentials = new Map<number, number>();
  let serious = 0;
  for (const o of offers) {
    if (o.nationality) nations.set(o.nationality, (nations.get(o.nationality) ?? 0) + 1);
    if (o.potentiale != null) potentials.set(o.potentiale, (potentials.get(o.potentiale) ?? 0) + 1);
    if (o.is_serious) serious++;
  }
  const teamsWithTopTalent = planned.filter((t) => t.offers.some((o) => (o.potentiale ?? 0) >= run.topTalentMin)).length;
  const nationMatchShare = planned.length === 0 ? 0 : planned.reduce((s, t) => {
    if (!t.nationProfile) return s;
    const top = new Set(t.nationProfile.map((n) => n.code));
    return s + t.offers.filter((o) => o.nationality != null && top.has(o.nationality)).length / Math.max(1, t.offers.length);
  }, 0) / Math.max(1, planned.filter((t) => t.nationProfile).length);
  return {
    recipients: run.recipients,
    planned: planned.length,
    alreadyClaimed: run.teams.filter((t) => t.status === "skipped_already_claimed").length,
    offers: offers.length,
    offersPerTeam: [...new Set(planned.map((t) => t.offers.length))],
    bySquad: {
      u23: offers.filter((o) => o.squad === "u23").length,
      junior: offers.filter((o) => o.squad === "junior").length,
    },
    nations: [...nations.entries()].sort((a, b) => b[1] - a[1]),
    potentials: [...potentials.entries()].sort((a, b) => a[0] - b[0]),
    serious,
    teamsWithTopTalent,
    nationProfileFallback: planned.filter((t) => !t.nationProfile).length,
    avgShareFromTeamTopNations: nationMatchShare,
    teamsNoU23Slot: run.teams.filter((t) => t.freeSlots.u23 === 0).length,
    teamsNoJuniorSlot: run.teams.filter((t) => t.freeSlots.junior === 0).length,
    teamsNoSlotAtAll: run.teams.filter((t) => t.freeSlots.u23 === 0 && t.freeSlots.junior === 0).length,
    teamsFewerThan10Slots: run.teams.filter((t) => t.freeSlots.u23 + t.freeSlots.junior < BOARD_GIFT_TOTAL).length,
  };
}
