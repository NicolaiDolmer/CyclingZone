// backend/lib/transferQuarantine.js
// #2557 spor A — KARANTÆNE på nyerhvervede ryttere der er for stærke til deres
// nye pulje. Config-gated, DEFAULT OFF. Aktiverer INTET ved merge.
//
// BAGGRUND (docs/audits/2026-08-03-team-dominance-2557.md, afsnit 3b + 6):
// hold-dominansen i race v3 er ikke en motor-fejl. Tre Division 3-puljer sprang
// fra share4PlusSameTeamTop10 0,000 til 0,500+ i ÉT døgn (30/7), fordi flere
// nyindkøbte ryttere fik deres første start samme dag. Motoren har ingen
// stakke-bonus at skrue på (målt: hold-komponenten topper ved 0,00168 = 1,4 % af
// terræn-signalet og FALDER med truppens størrelse) — resultaterne er fortjente,
// men puljen skifter karakter fra én dag til den næste.
//
// Karantænen udjævner præcis det stød: en rytter der er markant stærkere end sin
// NYE pulje må ikke starte de første n løbsdage efter erhvervelsen.
//
// ── HVORFOR ABILITY-MARGIN OG IKKE "SÆLGERENS TIER" ────────────────────────────
// Issue-formuleringen kalder det "cross-tier-transfer". Diskriminatoren her er
// alligevel evne-relativ, ikke sælger-relativ, af tre grunde:
//   1. To af de seks dokumenterede erhvervelser 27-29/7 havde INGEN sælger (fri
//      agent) — heriblandt Lars Wouters (peak 66, 216.381 CZ$), som er den
//      ENKELTRYTTER der driver både share4Plus og maxRiderWinRate (6 sejre på 9
//      starter). Et sælger-tier-filter ville have ladet netop ham passere.
//   2. Skaden er "rytter langt over sin nye pulje", ikke "rytter kom fra en
//      højere division". Evne-marginen måler skaden direkte.
//   3. Sælgerens tier PÅ SALGSTIDSPUNKTET findes ikke i data (teams.league_-
//      division_id er nutidig og ændres ved op-/nedrykning), så et sælger-filter
//      ville hvile på en approksimation.
// Sælger-tier-dimensionen er stadig MÅLT i dry-run'et (scripts/dryRunTransfer-
// Quarantine.js) så ejeren kan se forskellen empirisk.
//
// ── BENCHMARK ─────────────────────────────────────────────────────────────────
// "For stærk til puljen" = rytterens peak overstiger puljens `rivalRank`.-bedste
// rytter uden for køberens eget hold med mindst `margin` point. Det er PRÆCIS den
// strukturelle prædiktor poolBalance.js allerede bruger (DOMINANCE_RIVAL_RANK =
// 10): empirisk 3/8 gav margin ≤7 ⇒ share4Plus 0,000, margin ≥11 ⇒ 0,357-0,571.
//
// ── CLOCK ─────────────────────────────────────────────────────────────────────
// Karantænen måles i LØBSDAGE I KØBERENS EGEN PULJE, ikke i kalenderdøgn og ikke
// i et globalt game_day-rum. #3185-forensikken viste at `game_day` er PULJE-
// RELATIVT: to puljer bruger de samme game_day-numre til forskellige tidspunkter,
// så en cross-pool-transfer kan lovligt give samme game_day igen. Alle beregninger
// her sker derfor inden for én pulje ad gangen, ordnet på `scheduled_at`.
//
// ── FAIL-SAFE ─────────────────────────────────────────────────────────────────
// Config-læsefejl ⇒ DISABLED (samme retning som transferPriceBand.js og
// newAccountGates.js): en forbigående DB-fejl må aldrig begynde at udelukke
// ryttere fra startfelter. Mekanikken er slået fra som default, så fail-open
// betyder "ingen adfærdsændring", aldrig et hul.
//
// INGEN funktion her muterer noget.

import {
  buildCetToGameDaySpan,
  deriveMonumentBindingWindow,
  isMonumentBandSchedule,
  raceBindingWindow,
} from "./raceBinding.js";

/** app_config-nøgler. Seed: database/2026-08-04-transfer-quarantine-config.sql */
export const TRANSFER_QUARANTINE_CONFIG_KEYS = Object.freeze({
  SCOPE: "transfer_quarantine_scope",
  RACE_DAYS: "transfer_quarantine_race_days",
  MARGIN: "transfer_quarantine_margin",
  MAX_DEBUTS_PER_RACE_DAY: "transfer_quarantine_max_debuts_per_race_day",
});

export const QUARANTINE_SCOPES = Object.freeze({
  /** Slået helt fra (default). */
  OFF: "off",
  /** Kun ryttere der er `margin` point over puljens rival-benchmark. */
  OVERQUALIFIED: "overqualified",
  /** Alle erhvervelser — ren indkøringsperiode, evne-blind. */
  ALL: "all",
});

/**
 * Puljens `rivalRank`.-bedste rytter uden for køberens eget hold. Samme rang som
 * poolBalance.DOMINANCE_RIVAL_RANK — de to mål skal kunne sammenlignes 1:1.
 */
export const QUARANTINE_RIVAL_RANK = 10;

/**
 * Default-margin 10 ligger MELLEM de målte regimer 3/8 (margin ≤7 ⇒ share4Plus
 * 0,000; margin ≥11 ⇒ 0,357-0,571), præcis som poolBalance.DEFAULT_RESEED_-
 * THRESHOLD. Den er IKKE harness-verificeret — den bruges kun hvis ejeren
 * aktiverer scope, og bør kalibreres i samme runde.
 */
export const DEFAULT_QUARANTINE_MARGIN = 10;

/**
 * Sikkerhedsgulv: et hold beholder ALTID mindst så mange ikke-karantæneramte
 * ryttere som det største startfelt (SELECTION_SIZE.max = 8). Karantænen må
 * aldrig kunne tømme et startfelt — den udskyder en debut, den afmelder ikke et
 * hold. Overskrides gulvet, frigives de ÆLDST erhvervede karantæneramte ryttere
 * først (deterministisk).
 */
export const QUARANTINE_MIN_AVAILABLE = 8;

const DISABLED_CONFIG = Object.freeze({
  scope: QUARANTINE_SCOPES.OFF,
  raceDays: 0,
  margin: DEFAULT_QUARANTINE_MARGIN,
  maxDebutsPerRaceDay: 0,
});

/** Fryser en kopi af den slåede-fra config (kaldere må gerne mutere deres egen). */
export function disabledQuarantineConfig() {
  return { ...DISABLED_CONFIG };
}

function toNonNegativeInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback;
}

function toScope(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : null;
  return Object.values(QUARANTINE_SCOPES).includes(raw) ? raw : QUARANTINE_SCOPES.OFF;
}

/**
 * I/O: læs alle fire nøgler i ét kald. Fail-open — enhver fejl (manglende tabel i
 * en test-double, netværk, malformed rows) giver den slåede-fra config i stedet
 * for at kaste, så en config-udfald aldrig kan begynde at pille ryttere ud af
 * startfelter. Loggen er bevidst larmende (#2395: ingen tavse catch).
 */
export async function readTransferQuarantineConfig(supabase) {
  if (!supabase?.from) return disabledQuarantineConfig();
  try {
    const keys = Object.values(TRANSFER_QUARANTINE_CONFIG_KEYS);
    const { data, error } = await supabase.from("app_config").select("key, value").in("key", keys);
    if (error) {
      console.error("[transfer-quarantine] app_config read failed, quarantine disabled:", error.message);
      return disabledQuarantineConfig();
    }
    const byKey = new Map((data || []).map((row) => [row.key, row.value]));
    return {
      scope: toScope(byKey.get(TRANSFER_QUARANTINE_CONFIG_KEYS.SCOPE)),
      raceDays: toNonNegativeInt(byKey.get(TRANSFER_QUARANTINE_CONFIG_KEYS.RACE_DAYS), 0),
      margin: toNonNegativeInt(byKey.get(TRANSFER_QUARANTINE_CONFIG_KEYS.MARGIN), DEFAULT_QUARANTINE_MARGIN),
      maxDebutsPerRaceDay: toNonNegativeInt(byKey.get(TRANSFER_QUARANTINE_CONFIG_KEYS.MAX_DEBUTS_PER_RACE_DAY), 0),
    };
  } catch (err) {
    // best-effort: samme fail-open-kontrakt som `error`-grenen ovenfor, for det
    // sjældnere tilfælde hvor klienten KASTER (netværksfejl, malformed klient)
    // frem for at returnere { error }. Logget, ikke slugt (#2395) — og fail-open
    // er her "ingen adfærdsændring", ikke et hul: mekanikken er slået fra som
    // default, og gaten har aldrig været håndhævet før denne PR.
    console.error("[transfer-quarantine] app_config read threw, quarantine disabled:", err?.message ?? err);
    return disabledQuarantineConfig();
  }
}

/**
 * Gaten er kun aktiv når BEGGE dele er sat: en scope der ikke er "off", OG et
 * positivt antal løbsdage. Enten alene = slået fra (så en halvt udfyldt config
 * aldrig kan give en delvis, uforudsigelig effekt).
 */
export function isQuarantineEnabled(config) {
  return !!config
    && config.scope !== QUARANTINE_SCOPES.OFF
    && Object.values(QUARANTINE_SCOPES).includes(config.scope)
    && Number(config.raceDays) > 0;
}

/**
 * Rytterens "peak" = max over de discipliner der afgør en etapesejr. SAMME
 * definition som docs/audits/2026-08-03-team-dominance-2557.md og
 * scripts/auditPoolBalance.js, så tallene kan sammenlignes 1:1. (Bevidst
 * duplikeret frem for importeret: auditPoolBalance.js er et script der loader
 * dotenv ved import — en lib må ikke trække det ind.)
 */
export function riderPeak(abilities = {}) {
  if (!abilities) return 0;
  return Math.max(
    abilities.flat ?? 0,
    abilities.climbing ?? 0,
    abilities.sprint ?? 0,
    abilities.time_trial ?? 0,
    abilities.punch ?? 0,
    abilities.cobblestone ?? 0,
  );
}

/**
 * Puljens rival-benchmark for ÉT hold: den `rivalRank`.-bedste rytter-peak blandt
 * puljens ØVRIGE hold. Returnerer null hvis puljen er for lille til at måle
 * meningsfuldt (< rivalRank rivaler) — da kan intet være "over-kvalificeret", og
 * kaldere skal behandle det som "ingen karantæne".
 *
 * @param {Array<{teamId:string, peak:number}>} poolRiders alle puljens ryttere
 * @param {string} teamId køberens hold (udelades fra benchmark)
 * @param {{rivalRank?:number}} [opts]
 * @returns {number|null}
 */
export function poolRivalPeak(poolRiders = [], teamId = null, { rivalRank = QUARANTINE_RIVAL_RANK } = {}) {
  const rivals = poolRiders
    .filter((r) => r && r.teamId !== teamId)
    .map((r) => Number(r.peak) || 0)
    .sort((a, b) => b - a);
  if (rivals.length < rivalRank) return null;
  return rivals[rivalRank - 1];
}

/**
 * Ren: er erhvervelsen et INDKØB i det aktuelle transfervindue?
 *
 * Uden dette filter ville en hvilken som helst rytter der blot HAR et
 * acquired_at (6.812 af 6.823 ejede ryttere i prod 3/8) blive karantæneramt de
 * første `raceDays` af hver ny sæson — planen anker jo på "første løbsdag efter
 * erhvervelsen", og en erhvervelse fra sidste sæson ligger før sæsonens dag 0.
 * Karantænen skal ramme et INDKØB, ikke et ejerskab.
 *
 * Grænsen er FORRIGE SÆSONS SIDSTE LØBSDAG, ikke denne sæsons start_date.
 * Målt i prod: sæson 1's sidste etape kørte 26/7 19:00 CET, sæson 2 startede
 * 27/7. Dawid Zupan (Div 2 — A → Div 3 — C, 30.000 CZ$) blev købt 26/7 22:41 —
 * altså EFTER sidste løb, men FØR sæsonens start_date. Han er en af de seks
 * erhvervelser audit'en dokumenterer, så en start_date-grænse ville have tabt
 * ham. "Siden dit sidste løb i forrige sæson" er også den grænse spilleren selv
 * oplever som transfervinduet.
 */
export function isAcquisitionInTransferWindow({ acquiredAt, windowStartsAt } = {}) {
  if (acquiredAt === null || acquiredAt === undefined) return false;
  const acq = typeof acquiredAt === "number" ? acquiredAt : new Date(acquiredAt).getTime();
  if (!Number.isFinite(acq)) return false;
  if (windowStartsAt === null || windowStartsAt === undefined) return true; // ukendt grænse ⇒ filtrér ikke
  const start = typeof windowStartsAt === "number" ? windowStartsAt : new Date(windowStartsAt).getTime();
  if (!Number.isFinite(start)) return true;
  return acq > start;
}

/**
 * Ren: udløser denne erhvervelse karantæne?
 *
 * @returns {{triggered:boolean, reason:string|null, margin:number|null}}
 *   reason: "all" | "overqualified" | null
 */
export function evaluateQuarantineTrigger({ scope, margin = DEFAULT_QUARANTINE_MARGIN, peak = null, rivalPeak = null } = {}) {
  if (scope === QUARANTINE_SCOPES.ALL) {
    return { triggered: true, reason: "all", margin: null };
  }
  if (scope !== QUARANTINE_SCOPES.OVERQUALIFIED) {
    return { triggered: false, reason: null, margin: null };
  }
  const p = Number(peak);
  const rival = Number(rivalPeak);
  // rivalPeak null/ukendt (for lille pulje) ⇒ intet at måle imod ⇒ ingen karantæne.
  if (!Number.isFinite(p) || rivalPeak === null || rivalPeak === undefined || !Number.isFinite(rival)) {
    return { triggered: false, reason: null, margin: null };
  }
  const actual = p - rival;
  if (actual >= Number(margin)) return { triggered: true, reason: "overqualified", margin: actual };
  return { triggered: false, reason: null, margin: actual };
}

/**
 * Fold rå race_stage_schedule-rækker til én sorteret løbsdags-liste PR. PULJE.
 *
 * Monument-båndet (game_day >= MONUMENT_GAME_DAY_FLOOR) udelades: Monuments har
 * syntetiske game_day-numre i 100000-båndet og hører ikke til puljens normale
 * dags-kadence (#3114). De ville ellers ligge sidst i rækkefølgen og forskyde
 * hele karantæne-tællingen.
 *
 * @param {Array<{race_id:string, scheduled_at:string, game_day:number}>} scheduleRows
 * @param {Map<string, {league_division_id:number|null}>} raceById
 * @returns {Map<number|null, Array<{gameDay:number, startsAt:number}>>} sorteret på startsAt
 */
export const MONUMENT_GAME_DAY_FLOOR = 100000;

export function buildPoolRaceDays(scheduleRows = [], raceById = new Map()) {
  const byPoolDay = new Map(); // poolId → Map(gameDay → earliest startsAt)
  for (const row of scheduleRows) {
    if (!row) continue;
    const gameDay = Number(row.game_day);
    if (!Number.isFinite(gameDay) || gameDay >= MONUMENT_GAME_DAY_FLOOR) continue;
    const startsAt = new Date(row.scheduled_at).getTime();
    if (!Number.isFinite(startsAt)) continue;
    const race = raceById.get(row.race_id);
    const poolId = race?.league_division_id ?? null;
    if (!byPoolDay.has(poolId)) byPoolDay.set(poolId, new Map());
    const days = byPoolDay.get(poolId);
    const prev = days.get(gameDay);
    if (prev === undefined || startsAt < prev) days.set(gameDay, startsAt);
  }

  const out = new Map();
  for (const [poolId, days] of byPoolDay) {
    out.set(
      poolId,
      [...days.entries()]
        .map(([gameDay, startsAt]) => ({ gameDay, startsAt }))
        .sort((a, b) => a.startsAt - b.startsAt || a.gameDay - b.gameDay),
    );
  }
  return out;
}

/**
 * Ren kerne: læg karantæne-planen for ÉT holds udløste erhvervelser i ÉN pulje.
 *
 * Grundreglen: rytteren sidder over de første `raceDays` af puljens løbsdage der
 * STARTER efter erhvervelsen. Er der færre dage tilbage i sæsonen, blokeres de
 * dage der er (ærligt: sæsonen slutter, ikke karantænen).
 *
 * Trappen (`maxDebutsPerRaceDay` > 0): må højst så mange karantæneramte ryttere
 * fra SAMME hold debutere på samme løbsdag. Overskydende skubbes én dag ad
 * gangen. Det er præcis det observerede skadesmønster: 30/7 debuterede flere
 * nyindkøbte ryttere samtidig, og tre puljer skiftede karakter samme døgn.
 * Rækkefølgen er deterministisk: ældste erhvervelse først, riderId som tiebreak.
 *
 * @param {object} args
 * @param {Array<{riderId:string, acquiredAt:string|number|Date}>} args.acquisitions kun UDLØSTE
 * @param {Array<{gameDay:number, startsAt:number}>} args.poolRaceDays sorteret på startsAt
 * @param {number} args.raceDays
 * @param {number} [args.maxDebutsPerRaceDay] 0 = ingen trappe
 * @returns {Map<string, {blockedGameDays:number[], releaseGameDay:number|null,
 *   releaseAt:number|null, staggeredBy:number}>}
 */
export function planTeamQuarantine({
  acquisitions = [],
  poolRaceDays = [],
  raceDays = 0,
  maxDebutsPerRaceDay = 0,
} = {}) {
  const plan = new Map();
  if (!(raceDays > 0) || !poolRaceDays.length) return plan;

  const ordered = [...acquisitions]
    // NB: `new Date(null).getTime()` er 0 (= epoch), ikke NaN — en manglende
    // acquired_at ville derfor smugle en aldrig-erhvervet rytter ind i planen
    // som "købt 1970". Afvis null/undefined eksplicit før konverteringen.
    .map((a) => ({
      riderId: a?.riderId,
      acquiredAtMs: a?.acquiredAt === null || a?.acquiredAt === undefined ? NaN : new Date(a.acquiredAt).getTime(),
    }))
    .filter((a) => a.riderId && Number.isFinite(a.acquiredAtMs))
    .sort((a, b) => a.acquiredAtMs - b.acquiredAtMs || String(a.riderId).localeCompare(String(b.riderId), "en"));

  const debutsByIndex = new Map(); // index i poolRaceDays → antal debuter dér
  const cap = Number(maxDebutsPerRaceDay) > 0 ? Math.trunc(maxDebutsPerRaceDay) : 0;

  for (const { riderId, acquiredAtMs } of ordered) {
    const firstIdx = poolRaceDays.findIndex((d) => d.startsAt > acquiredAtMs);
    if (firstIdx === -1) {
      // Erhvervet efter sæsonens sidste løbsdag — der er intet at sidde over.
      plan.set(riderId, { blockedGameDays: [], releaseGameDay: null, releaseAt: null, staggeredBy: 0 });
      continue;
    }
    let releaseIdx = firstIdx + Math.trunc(raceDays);
    let staggeredBy = 0;
    if (cap > 0) {
      // Skub til første dag med ledig debut-kvote. Løber vi tør for dage, står
      // releaseIdx over listens længde og rytteren er blokeret sæsonen ud.
      while (releaseIdx < poolRaceDays.length && (debutsByIndex.get(releaseIdx) || 0) >= cap) {
        releaseIdx += 1;
        staggeredBy += 1;
      }
      debutsByIndex.set(releaseIdx, (debutsByIndex.get(releaseIdx) || 0) + 1);
    }
    const blocked = poolRaceDays.slice(firstIdx, releaseIdx).map((d) => d.gameDay);
    const releaseDay = poolRaceDays[releaseIdx] ?? null;
    plan.set(riderId, {
      blockedGameDays: blocked,
      releaseGameDay: releaseDay ? releaseDay.gameDay : null,
      releaseAt: releaseDay ? releaseDay.startsAt : null,
      staggeredBy,
    });
  }
  return plan;
}

/**
 * Ren: er rytteren blokeret for ET konkret løb? Et etapeløb har ÉT startfelt for
 * hele afviklingen, så vi gater på løbets FØRSTE løbsdag: rammer starten inden
 * for karantænen, er hele løbet lukket for rytteren (man kan ikke tilføje en
 * rytter midt i et etapeløb alligevel, #1825).
 */
export function isRaceBlockedForRider({ blockedGameDays, raceGameDayStart } = {}) {
  if (!blockedGameDays || !blockedGameDays.length) return false;
  const day = Number(raceGameDayStart);
  if (!Number.isFinite(day)) return false;
  return blockedGameDays.includes(day);
}

/**
 * Ren: anvend karantænen på ét holds kandidat-pulje MED sikkerhedsgulv.
 *
 * Karantænen udskyder en debut — den må aldrig gøre et hold ude af stand til at
 * stille op. Ville filtreringen efterlade færre end `minAvailable` kandidater,
 * frigives karantæneramte ryttere igen i rækkefølge ÆLDSTE erhvervelse først,
 * indtil gulvet er nået. Har holdet i forvejen færre end gulvet, røres intet.
 *
 * @param {object} args
 * @param {Array<{rider_id?:string, id?:string}>} args.candidates
 * @param {Set<string>|Map<string, any>} args.quarantinedIds
 * @param {Map<string, number>} [args.acquiredAtByRider] ms — styrer frigivelses-rækkefølgen
 * @param {number} [args.minAvailable]
 * @returns {{kept:Array, blockedRiderIds:string[], releasedForFloor:string[]}}
 */
export function applyQuarantineToCandidates({
  candidates = [],
  quarantinedIds = new Set(),
  acquiredAtByRider = new Map(),
  minAvailable = QUARANTINE_MIN_AVAILABLE,
} = {}) {
  const idOf = (c) => c?.rider_id ?? c?.id ?? null;
  const has = (id) => (quarantinedIds instanceof Map ? quarantinedIds.has(id) : quarantinedIds.has?.(id));
  const blocked = candidates.filter((c) => has(idOf(c)));
  if (!blocked.length) return { kept: candidates, blockedRiderIds: [], releasedForFloor: [] };

  const free = candidates.filter((c) => !has(idOf(c)));
  const deficit = Math.max(0, minAvailable - free.length);
  if (deficit === 0) {
    return { kept: free, blockedRiderIds: blocked.map(idOf), releasedForFloor: [] };
  }

  // Frigiv ældst erhvervede først (ukendt acquired_at ⇒ behandles som ældst:
  // en rytter uden erhvervelses-tidsstempel er ikke et nyt indkøb).
  const releaseOrder = [...blocked].sort((a, b) => {
    const av = acquiredAtByRider.get(idOf(a)) ?? -Infinity;
    const bv = acquiredAtByRider.get(idOf(b)) ?? -Infinity;
    return av - bv || String(idOf(a)).localeCompare(String(idOf(b)), "en");
  });
  const released = releaseOrder.slice(0, deficit);
  const releasedIds = new Set(released.map(idOf));

  return {
    kept: candidates.filter((c) => !has(idOf(c)) || releasedIds.has(idOf(c))),
    blockedRiderIds: blocked.filter((c) => !releasedIds.has(idOf(c))).map(idOf),
    releasedForFloor: [...releasedIds],
  };
}

/**
 * I/O-orkestrator: hvilke ryttere er lige nu i karantæne, pr. hold?
 *
 * Returnerer ALTID en brugbar struktur. Er gaten slået fra, laves der NUL
 * database-kald — den slukkede tilstand koster ingenting.
 *
 * Kontrakt for kaldere: `blockedByRider` er nøglen til at gate ET løb
 * (isRaceBlockedForRider); `quarantinedIdsByTeam` er "lige nu, uanset løb" og
 * bruges kun til visning/rapportering.
 *
 * @param {object} args
 * @param {object} args.supabase service-role klient
 * @param {object} args.config resultat af readTransferQuarantineConfig
 * @param {string} args.seasonId
 * @param {number[]} [args.poolIds] begræns til disse puljer (default: alle i sæsonen)
 * @param {string|number} [args.seasonStartsAt] transfervinduets start; undlades →
 *   udledes som forrige sæsons sidste etape (fallback: seasons.start_date)
 * @returns {Promise<{enabled:boolean, byRider:Map<string, object>,
 *   quarantinedIdsByTeam:Map<string, Set<string>>, acquiredAtByRider:Map<string, number>}>}
 */
export async function loadQuarantineState({ supabase, config, seasonId, poolIds = null, seasonStartsAt = undefined } = {}) {
  const empty = {
    enabled: false,
    byRider: new Map(),
    quarantinedIdsByTeam: new Map(),
    acquiredAtByRider: new Map(),
    raceGameDayStartById: new Map(),
  };
  if (!isQuarantineEnabled(config) || !supabase?.from || !seasonId) return empty;

  // 1. Sæsonens løb (+ pulje) og deres dags-kalender.
  let raceQuery = supabase.from("races").select("id, league_division_id").eq("season_id", seasonId);
  if (Array.isArray(poolIds) && poolIds.length) raceQuery = raceQuery.in("league_division_id", poolIds);
  const { data: races, error: raceErr } = await raceQuery;
  if (raceErr) throw new Error(`races: ${raceErr.message}`);
  if (!races?.length) return empty;
  const raceById = new Map(races.map((r) => [r.id, r]));

  const scheduleRows = await selectAllInChunks({
    supabase, table: "race_stage_schedule", columns: "race_id, scheduled_at, game_day",
    inColumn: "race_id", ids: races.map((r) => r.id), orderBy: ["race_id", "stage_number"],
  });
  const poolRaceDaysByPool = buildPoolRaceDays(scheduleRows, raceById);
  if (!poolRaceDaysByPool.size) return empty;

  // Løbets FØRSTE løbsdag i binding-rummet, pr. løb. Samme kald-sekvens som
  // raceEntryGenerator's windowByRace (raceBindingWindow + Monument-afledning
  // #3114), så gaten i ruterne og gaten i sweep'en aldrig kan divergere.
  const raceGameDayStartById = buildRaceGameDayStarts(scheduleRows, races);

  // 1b. Transfervinduets start = forrige sæsons SIDSTE løbsdag (se
  //     isAcquisitionInTransferWindow). Uden den ville hvert ejerskab fra sidste
  //     sæson tælle som et nyt indkøb; med sæsonens start_date i stedet ville
  //     handler i selve vinduet (26/7 22:41 i prod) falde uden for.
  let windowStartMs = null;
  if (seasonStartsAt !== undefined && seasonStartsAt !== null) {
    const ms = typeof seasonStartsAt === "number" ? seasonStartsAt : new Date(seasonStartsAt).getTime();
    windowStartMs = Number.isFinite(ms) ? ms : null;
  } else {
    let firstStageMs = Infinity;
    for (const days of poolRaceDaysByPool.values()) {
      if (days.length && days[0].startsAt < firstStageMs) firstStageMs = days[0].startsAt;
    }
    if (Number.isFinite(firstStageMs)) {
      const { data: prev, error: prevErr } = await supabase
        .from("race_stage_schedule").select("scheduled_at")
        .lt("scheduled_at", new Date(firstStageMs).toISOString())
        .order("scheduled_at", { ascending: false }).limit(1).maybeSingle();
      if (prevErr) throw new Error(`race_stage_schedule (previous season): ${prevErr.message}`);
      const ms = prev?.scheduled_at ? new Date(prev.scheduled_at).getTime() : NaN;
      windowStartMs = Number.isFinite(ms) ? ms : null;
    }
    if (windowStartMs === null) {
      // Første sæson nogensinde (ingen tidligere etaper): fald tilbage på
      // sæsonens start_date, så filteret stadig er defineret.
      const { data: season, error: seasonErr } = await supabase
        .from("seasons").select("start_date").eq("id", seasonId).maybeSingle();
      if (seasonErr) throw new Error(`seasons: ${seasonErr.message}`);
      const ms = season?.start_date ? new Date(season.start_date).getTime() : NaN;
      windowStartMs = Number.isFinite(ms) ? ms : null;
    }
  }

  // 2. Hold i de relevante puljer.
  const relevantPools = [...poolRaceDaysByPool.keys()].filter((p) => p !== null);
  if (!relevantPools.length) return empty;
  const { data: teams, error: teamErr } = await supabase
    .from("teams").select("id, league_division_id").in("league_division_id", relevantPools);
  if (teamErr) throw new Error(`teams: ${teamErr.message}`);
  if (!teams?.length) return empty;
  const poolByTeam = new Map(teams.map((t) => [t.id, t.league_division_id]));

  // 3. Ryttere. Kun ikke-pensionerede, ikke-akademi seniorer på disse hold.
  const riders = await selectAllInChunks({
    supabase, table: "riders", columns: "id, team_id, acquired_at",
    inColumn: "team_id", ids: teams.map((t) => t.id), orderBy: ["id"],
    extra: (q) => q.eq("is_academy", false).or("is_retired.is.null,is_retired.eq.false"),
  });
  if (!riders.length) return empty;

  const acquiredAtByRider = new Map();
  for (const r of riders) {
    const ms = r.acquired_at ? new Date(r.acquired_at).getTime() : NaN;
    if (Number.isFinite(ms)) acquiredAtByRider.set(r.id, ms);
  }

  // 4. Evner — kun de seks peak-discipliner (smallere payload end ABILITY_KEYS).
  const abilities = await selectAllInChunks({
    supabase, table: "rider_derived_abilities",
    columns: "rider_id, flat, climbing, sprint, time_trial, punch, cobblestone",
    inColumn: "rider_id", ids: riders.map((r) => r.id), orderBy: ["rider_id"],
  });
  const peakByRider = new Map(abilities.map((a) => [a.rider_id, riderPeak(a)]));

  // 5. Puljens rytter-population (til rival-benchmark).
  const poolRiders = new Map(); // poolId → [{teamId, peak}]
  for (const r of riders) {
    const poolId = poolByTeam.get(r.team_id);
    if (poolId == null) continue;
    if (!poolRiders.has(poolId)) poolRiders.set(poolId, []);
    poolRiders.get(poolId).push({ teamId: r.team_id, peak: peakByRider.get(r.id) ?? 0 });
  }

  // 6. Udløste erhvervelser pr. hold, derefter planen pr. pulje.
  const triggeredByTeam = new Map();
  const triggerByRider = new Map();
  for (const r of riders) {
    const acquiredAtMs = acquiredAtByRider.get(r.id);
    if (!Number.isFinite(acquiredAtMs)) continue; // aldrig erhvervet (seed/fri agent) ⇒ ingen karantæne
    // Ejerskab fra en tidligere sæson er ikke et indkøb — ellers ville hver
    // sæsonstart karantæneramme hele feltet.
    if (!isAcquisitionInTransferWindow({ acquiredAt: acquiredAtMs, windowStartsAt: windowStartMs })) continue;
    const poolId = poolByTeam.get(r.team_id);
    if (poolId == null) continue;
    const trigger = evaluateQuarantineTrigger({
      scope: config.scope,
      margin: config.margin,
      peak: peakByRider.get(r.id) ?? null,
      rivalPeak: poolRivalPeak(poolRiders.get(poolId) || [], r.team_id),
    });
    if (!trigger.triggered) continue;
    if (!triggeredByTeam.has(r.team_id)) triggeredByTeam.set(r.team_id, []);
    triggeredByTeam.get(r.team_id).push({ riderId: r.id, acquiredAt: acquiredAtMs });
    triggerByRider.set(r.id, trigger);
  }

  const byRider = new Map();
  const quarantinedIdsByTeam = new Map();
  for (const [teamId, acquisitions] of triggeredByTeam) {
    const poolId = poolByTeam.get(teamId);
    const poolDays = poolRaceDaysByPool.get(poolId) || [];
    const plan = planTeamQuarantine({
      acquisitions,
      poolRaceDays: poolDays,
      raceDays: config.raceDays,
      maxDebutsPerRaceDay: config.maxDebutsPerRaceDay,
    });
    for (const [riderId, entry] of plan) {
      if (!entry.blockedGameDays.length) continue;
      byRider.set(riderId, {
        ...entry,
        teamId,
        poolId,
        reason: triggerByRider.get(riderId)?.reason ?? null,
        margin: triggerByRider.get(riderId)?.margin ?? null,
      });
      if (!quarantinedIdsByTeam.has(teamId)) quarantinedIdsByTeam.set(teamId, new Set());
      quarantinedIdsByTeam.get(teamId).add(riderId);
    }
  }

  return { enabled: true, byRider, quarantinedIdsByTeam, acquiredAtByRider, raceGameDayStartById };
}

/**
 * Løbets første løbsdag i binding-rummet, pr. race_id. Spejler
 * raceEntryGenerator's windowByRace: normale løb via raceBindingWindow, Monuments
 * (game_day i 100000-båndet) via den PULJE-LOKALE CET→game_day-afledning (#3114 —
 * divisionernes kalendere er forskudt i real-tid, så samme game_day falder på
 * forskellige datoer i forskellige puljer).
 *
 * @param {Array<{race_id:string, scheduled_at:string, game_day:number, stage_number?:number}>} scheduleRows
 * @param {Array<{id:string, league_division_id:number|null}>} races
 * @returns {Map<string, number|null>}
 */
export function buildRaceGameDayStarts(scheduleRows = [], races = []) {
  const rowsByRace = new Map();
  for (const row of scheduleRows) {
    if (!row?.race_id) continue;
    if (!rowsByRace.has(row.race_id)) rowsByRace.set(row.race_id, []);
    rowsByRace.get(row.race_id).push(row);
  }

  const cetSpanByPool = new Map();
  for (const r of races) {
    const rows = rowsByRace.get(r.id);
    if (!rows || isMonumentBandSchedule(rows)) continue;
    const key = r.league_division_id ?? null;
    if (!cetSpanByPool.has(key)) cetSpanByPool.set(key, []);
    cetSpanByPool.get(key).push(...rows);
  }
  for (const [key, rows] of cetSpanByPool) cetSpanByPool.set(key, buildCetToGameDaySpan(rows));

  const out = new Map();
  for (const r of races) {
    const rows = rowsByRace.get(r.id);
    const window = isMonumentBandSchedule(rows)
      ? deriveMonumentBindingWindow(rows, cetSpanByPool.get(r.league_division_id ?? null))
      : raceBindingWindow(rows);
    out.set(r.id, window?.start ?? null);
  }
  return out;
}

/**
 * Rute-facade: hvilke af HOLDETS ryttere er lukket ude af DETTE løb?
 *
 * Slået fra (default) ⇒ tom Set og NUL database-kald. Scopet til løbets egen
 * pulje, så en enkelt request aldrig læser hele sæsonens rytterpopulation.
 * Fejler noget undervejs, kaster funktionen — kalderen skal beslutte om en
 * karantæne-fejl må vælte en udtagelse (i api.js: ja, det er en 500, ligesom
 * binding-guarden — vi gætter ikke).
 *
 * @returns {Promise<{blocked:Set<string>, state:object|null}>}
 */
export async function loadRaceQuarantineBlocklist({ supabase, race, seasonId, config = null } = {}) {
  const cfg = config ?? await readTransferQuarantineConfig(supabase);
  if (!isQuarantineEnabled(cfg)) return { blocked: new Set(), state: null };
  const poolId = race?.league_division_id ?? null;
  if (poolId == null) return { blocked: new Set(), state: null };

  const state = await loadQuarantineState({ supabase, config: cfg, seasonId, poolIds: [poolId] });
  if (!state.enabled || !state.byRider.size) return { blocked: new Set(), state };

  const raceGameDayStart = state.raceGameDayStartById?.get(race.id) ?? null;
  const blocked = new Set();
  for (const [riderId, entry] of state.byRider) {
    if (isRaceBlockedForRider({ blockedGameDays: entry.blockedGameDays, raceGameDayStart })) blocked.add(riderId);
  }
  return { blocked, state };
}

/**
 * Ren: reducér karantæne-tilstanden til "hvilke rytter-id'er er lukket ude af
 * DETTE løb". Kaldes af hvert håndhævelsespunkt.
 *
 * @param {{byRider:Map<string, {blockedGameDays:number[]}>}} state
 * @param {{game_day_start?:number}} race
 * @returns {Set<string>}
 */
export function blockedRiderIdsForRace(state, race) {
  const out = new Set();
  if (!state?.byRider?.size) return out;
  const raceGameDayStart = race?.game_day_start;
  for (const [riderId, entry] of state.byRider) {
    if (isRaceBlockedForRider({ blockedGameDays: entry.blockedGameDays, raceGameDayStart })) out.add(riderId);
  }
  return out;
}

// ── intern I/O-hjælper ────────────────────────────────────────────────────────
// Samme chunk+range-mønster som raceEntryGenerator.selectInChunks: PostgREST's
// .in() sprænger URL'en ved mange UUID'er, og .range() UDEN order by er ustabil
// mellem sider (#2375). Duplikeret bevidst — den ligger modul-privat begge steder.
const IN_CHUNK_SIZE = 200;
const PAGE_SIZE = 1000;

async function selectAllInChunks({ supabase, table, columns, inColumn, ids, orderBy = null, extra = null }) {
  const out = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
    for (let from = 0; ; from += PAGE_SIZE) {
      let q = supabase.from(table).select(columns).in(inColumn, chunk);
      for (const col of orderBy || [inColumn]) q = q.order(col);
      q = q.range(from, from + PAGE_SIZE - 1);
      if (extra) q = extra(q);
      const { data, error } = await q;
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
    }
  }
  return out;
}
