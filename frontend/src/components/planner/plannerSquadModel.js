// Season Planner — Squad-fanens rene model (#3086 / kontrakten i #2905).
//
// Etape 2 vender interaktionsmodellen: brættet bliver visning, LISTEN bliver
// input. Alt beslutnings-indhold i den liste udledes her, som rene funktioner,
// så det kan testes uden at rendere React — og så copy'en i komponenten kun
// formaterer tal den har fået, aldrig opfinder dem.
//
// Konsekvens-tallene selv (formpoint-spændet + payback) kommer FÆRDIGE fra
// boardet (backend/lib/plannerBoard.js, #3083). De er afledt af motorens
// tuning-konstanter, og må derfor aldrig genberegnes her: to formler for samme
// tal er præcis den fejlklasse #3071/#3081 kostede to bugs på.
import { dateToOrdinal } from "./plannerShared.js";

/**
 * Rytterens peak-pladser: de faktiske ÆGTE peaks fulgt af tomme pladser op til
 * sæsonens loft. Ét fast antal rækker pr. rytter, så listen har samme højde
 * uanset hvor langt manageren er nået — en tom plads er en INVITATION (stiplet
 * "No peak"), ikke et hul.
 *
 * #4212 (retning B, ejer-beslutning 28/8): et assistent-forslag (isSuggestion)
 * optager IKKE en plads her — en plads er kontrakten manageren selv har
 * indgået. Forslag hentes i stedet via `riderPendingSuggestions` og vises
 * ADSKILT (stiplet/ghost), aldrig som en af de {maxPerRider} pladser — ellers
 * ser en rytter med 1 ægte peak + 1 uaccepteret forslag ud som om han allerede
 * har 2 peaks, præcis den fejlklasse #4212 handler om.
 *
 * @param {{peaks?:Array<object>}} rider
 * @param {number} maxPerRider
 * @returns {Array<{key:string, peak:object|null, index:number}>}
 */
export function squadSlots(rider, maxPerRider) {
  const peaks = (rider?.peaks || []).filter((p) => !p?.isSuggestion).slice().sort((a, b) => {
    const ao = dateToOrdinal(a?.windowStart) ?? 0;
    const bo = dateToOrdinal(b?.windowStart) ?? 0;
    return ao - bo;
  });
  const max = Number.isFinite(maxPerRider) && maxPerRider > 0 ? maxPerRider : peaks.length;
  const slots = [];
  for (let i = 0; i < Math.max(max, peaks.length); i += 1) {
    const peak = peaks[i] ?? null;
    slots.push({ key: peak ? String(peak.id) : `empty:${rider?.id}:${i}`, peak, index: i });
  }
  return slots;
}

/**
 * Rytterens uaccepterede assistent-forslag MED et mål-løb, kronologisk — det
 * ghost-spor Squad-fanen viser ved siden af (aldrig inde i) de faste pladser
 * fra `squadSlots`. En "intet peak"-anbefaling (#3088, `isNoPeakSuggestion`,
 * intet `targetRaceId`) hører hjemme i skuffen, ikke her (samme filter som
 * `pendingSuggestionPairs`).
 *
 * @param {{peaks?:Array<object>}} rider
 * @returns {Array<object>}
 */
export function riderPendingSuggestions(rider) {
  return (rider?.peaks || [])
    .filter((p) => p?.isSuggestion && p.targetRaceId)
    .slice()
    .sort((a, b) => (dateToOrdinal(a.windowStart) ?? 0) - (dateToOrdinal(b.windowStart) ?? 0));
}

/**
 * Løbene en given plads kan pege på: fremtidige løb i holdets kalender, minus de
 * løb rytteren ALLEREDE topper mod i en ANDEN plads (serveren afviser duplikat-
 * mål), plus pladsens eget nuværende mål — ellers ville en `select` ikke kunne
 * vise sin egen valgte værdi.
 *
 * `currentTargetId` beholdes selv om løbet ligger i fortiden: en plan man ikke
 * længere kan gen-vælge skal stadig kunne LÆSES i kontrollen.
 *
 * @param {object} args
 * @param {object} args.rider
 * @param {Array<object>} args.races           board'ets racesOut
 * @param {number|null} args.todayOrd
 * @param {string|null} args.currentTargetId
 * @returns {Array<object>}  kronologisk (ejer-valg 27/7)
 */
export function targetableRacesFor({ rider, races, todayOrd, currentTargetId = null }) {
  const takenByOtherSlots = new Set(
    (rider?.peaks || [])
      .map((p) => p.targetRaceId)
      .filter((id) => id && id !== currentTargetId),
  );
  return (races || [])
    .filter((r) => r.isMine && r.date)
    .map((r) => ({ ...r, ord: dateToOrdinal(r.date) }))
    .filter((r) => r.ord != null)
    .filter((r) => r.id === currentTargetId || (!takenByOtherSlots.has(r.id) && (todayOrd == null || r.ord >= todayOrd)))
    .sort((a, b) => a.ord - b.ord);
}

/**
 * Payback-risiko PR. LØB i dropdownen, FØR valget (hul 2 fra #3093-auditten).
 * Returnerer sættet af kandidat-løb-id'er hvor et peak-valg ville kollidere med
 * rytterens program — i en af to retninger:
 *
 *  A) Formhullet EFTER en peak mod kandidaten (paybackDays dage efter vinduets
 *     slut) dækker et løb rytteren allerede kører (registrerede entries, auto
 *     som manuelle — hul 1 — plus øvrige peak-mål).
 *  B) Kandidaten ligger selv i formhullet efter en af rytterens ANDRE peaks —
 *     man ville toppe mod et løb man kører med reduceret form.
 *
 * Vinduet kommer FÆRDIGT fra boardet (`race.peakWindow`, snappet server-side med
 * præcis samme snapPeakWindow som skrive-stien) — her laves KUN interval-tjekket.
 * En egen vindue-formel her ville være #3071-fejlklassen (to formler, ét tal).
 *
 * `currentTargetId` (pladsens nuværende mål) ekskluderes som peak — en retarget
 * ERSTATTER den — men rytterens registrerede entries står urørt: entry'en til det
 * gamle mål-løb forsvinder ikke fordi peaken flytter.
 *
 * @param {object} args
 * @param {object} args.rider              board-rytter (registeredRaceIds + peaks)
 * @param {Array<object>} args.races       board'ets racesOut (peakWindow + date)
 * @param {number} args.paybackDays
 * @param {string|null} [args.currentTargetId]
 * @returns {Set<string>}  kandidat-løb-id'er med payback-kollision
 */
export function paybackRiskRaceIds({ rider, races, paybackDays, currentTargetId = null }) {
  const risky = new Set();
  const days = Number(paybackDays);
  if (!Number.isFinite(days) || days <= 0) return risky;

  const raceById = new Map((races || []).map((r) => [r.id, r]));
  const otherPeaks = (rider?.peaks || []).filter(
    (p) => p.targetRaceId && p.targetRaceId !== currentTargetId,
  );

  // Rytterens program: registrerede løb + øvrige peak-mål (dem kører man per definition).
  const programIds = new Set(rider?.registeredRaceIds || []);
  for (const p of otherPeaks) programIds.add(p.targetRaceId);
  const programOrds = [];
  for (const id of programIds) {
    const ord = dateToOrdinal(raceById.get(id)?.date);
    if (ord != null) programOrds.push({ id, ord });
  }

  const otherPaybackEnds = otherPeaks
    .map((p) => dateToOrdinal(p.windowEnd))
    .filter((o) => o != null);
  const inPayback = (ord, endOrd) => ord - endOrd >= 1 && ord - endOrd <= days;

  for (const race of races || []) {
    const endOrd = dateToOrdinal(race.peakWindow?.window_end);
    if (endOrd != null && programOrds.some(({ id, ord }) => id !== race.id && inPayback(ord, endOrd))) {
      risky.add(race.id);
      continue;
    }
    const raceOrd = dateToOrdinal(race.date);
    if (raceOrd != null && otherPaybackEnds.some((e) => inPayback(raceOrd, e))) {
      risky.add(race.id);
    }
  }
  return risky;
}

/**
 * Løb hvor et peak-VALG ville låse med det samme (#3094 — "straks-plaster" 1a).
 * Peak-vinduet snappes om mål-løbet server-side (samme `snapPeakWindow` som
 * skrive-stien, leveret færdigt som `race.peakWindow`); en peak låses ved
 * læse-tid når `nu >= window_start` (peaket er "startet", backend/lib/
 * riderPeakPlans.js#isPlanLocked). Vælger manageren et mål hvis vindue allerede
 * er begyndt, er planen ALTSÅ låst i samme svar der opretter/flytter den — det
 * er stadig den mest overraskende variant af #3094-fælden, selv efter
 * lås-tærsklen er flyttet fra "3 dage før vinduet" til "vinduet er begyndt".
 * Dropdownen markerer disse løb FØR valget, ligesom payback-risikoen.
 *
 * @param {object} args
 * @param {Array<object>} args.races     board'ets racesOut (peakWindow pr. løb)
 * @param {number|null} args.todayOrd
 * @returns {Set<string>}  løb-id'er der ville give en øjeblikkeligt låst peak
 */
export function locksImmediatelyRaceIds({ races, todayOrd }) {
  const risky = new Set();
  if (todayOrd == null) return risky;
  for (const race of races || []) {
    const startOrd = dateToOrdinal(race?.peakWindow?.window_start);
    if (startOrd != null && startOrd <= todayOrd) risky.add(race.id);
  }
  return risky;
}

/**
 * Sæson-belastning pr. rytter (#2772): hvor mange løb og løbsdage er rytteren
 * tilmeldt henover sæsonen, auto-fyldte entries inklusive, for rytteren stiller
 * til start uanset hvem der satte ham på listen. Registrerede løb uden for
 * boardets kalender (fx en anden divisions løb efter op-/nedrykning) tælles ikke.
 * Vi viser kun hvad payloaden kan stå inde for.
 *
 * #4245: LØBSDAGE er `race.raceDays` fra payloaden (distinkte game_day, regnet
 * serverside af raceDaysByRace), IKKE etape-antallet. To etaper på samme løbsdag
 * er én løbsdag for rytteren (docs/CALENDAR_RULES.md §0 + §2b). `stages` er kun
 * fallback for et board-svar fra før feltet fandtes.
 *
 * @param {object} args
 * @param {object} args.rider              board-rytter (registeredRaceIds)
 * @param {Array<object>} args.races       board'ets racesOut (raceDays, stages)
 * @returns {{races:number, raceDays:number}}
 */
export function riderSeasonLoad({ rider, races }) {
  const raceById = new Map((races || []).map((r) => [r.id, r]));
  let raceCount = 0;
  let raceDays = 0;
  for (const id of rider?.registeredRaceIds || []) {
    const race = raceById.get(id);
    if (!race) continue;
    raceCount += 1;
    const days = Number.isFinite(race.raceDays) && race.raceDays > 0
      ? race.raceDays
      : (Number.isFinite(race.stages) && race.stages > 0 ? race.stages : 1);
    raceDays += days;
  }
  return { races: raceCount, raceDays };
}

/**
 * Kræver denne peak en handling? To ting kan gå galt efter man har sat den:
 * optakten bliver ikke redet (`at_risk`), eller payback-hullet rammer et løb
 * rytteren også skal køre. Begge er ting manageren kan nå at gøre noget ved,
 * og begge tælles i status-linjen over fanerne.
 *
 * @param {object} peak
 * @returns {boolean}
 */
export function peakNeedsAction(peak) {
  if (!peak) return false;
  if (peak.status === "at_risk") return true;
  return (peak.paybackCollisions || []).length > 0;
}

/**
 * Status-linjen over fanerne (#3086): hvor mange peaks er planlagt, hvor mange
 * kræver handling, og hvor mange dage til den næste optakt begynder.
 *
 * Linjen ligger OVER fanerne, ikke inde i en af dem — det var ejer-grebet der
 * skulle sikre at "2 kræver handling" ikke kan gemme sig i bunden af en scroll
 * eller bag en lukket fane.
 *
 * Kun ÆGTE peaks tæller som "planlagt", og kun ægte peaks har en optakt der
 * reelt begynder: et uaccepteret forslag skriver ingen træning. Forslag kan
 * derimod godt kræve handling (et forslag med en payback-kollision er en
 * beslutning), så "Accept all" ikke kan skjule sammenstødet.
 *
 * @param {object} args
 * @param {Array<object>} args.riders
 * @param {string|null} args.today       "YYYY-MM-DD"
 * @param {number} args.leadupDays
 * @returns {{peaksPlanned:number, needsAction:number, daysToNextLeadup:number|null}}
 */
export function plannerStatusSummary({ riders, today, leadupDays }) {
  const todayOrd = dateToOrdinal(today);
  let peaksPlanned = 0;
  let needsAction = 0;
  let daysToNextLeadup = null;

  for (const rider of riders || []) {
    for (const peak of rider?.peaks || []) {
      if (!peak.isSuggestion) peaksPlanned += 1;
      if (peakNeedsAction(peak)) needsAction += 1;
      if (peak.isSuggestion || todayOrd == null || !Number.isFinite(leadupDays)) continue;
      const startOrd = dateToOrdinal(peak.windowStart);
      if (startOrd == null) continue;
      const days = startOrd - leadupDays - todayOrd;
      if (days < 0) continue; // optakten er allerede i gang eller forbi
      if (daysToNextLeadup == null || days < daysToNextLeadup) daysToNextLeadup = days;
    }
  }
  return { peaksPlanned, needsAction, daysToNextLeadup };
}

/**
 * Alle endnu-uaccepterede assistent-forslag som (rytter, mål-løb)-par — det
 * "Accept all" sender til bulk-endpointet. Rækkefølgen er deterministisk
 * (rytter-rækkefølgen i boardet, derefter vindue-dato), så to kald med samme
 * bræt sender præcis den samme liste.
 *
 * @param {Array<object>} riders
 * @returns {Array<{riderId:string, raceId:string}>}
 */
export function pendingSuggestionPairs(riders) {
  const pairs = [];
  for (const rider of riders || []) {
    const suggestions = (rider?.peaks || [])
      .filter((p) => p.isSuggestion && p.targetRaceId)
      .sort((a, b) => (dateToOrdinal(a.windowStart) ?? 0) - (dateToOrdinal(b.windowStart) ?? 0));
    for (const s of suggestions) pairs.push({ riderId: rider.id, raceId: s.targetRaceId });
  }
  return pairs;
}

/**
 * Antal ryttere der har mindst ét uaccepteret forslag MED et mål-løb —
 * handlingskortets "N peaks for M ryttere". En "intet peak"-anbefaling
 * (#3088, intet `targetRaceId`) er ikke noget "Accept all" kan udkaste, så
 * den tæller ikke med her (samme filter som `pendingSuggestionPairs`).
 *
 * @param {Array<object>} riders
 * @returns {number}
 */
export function ridersWithSuggestions(riders) {
  return (riders || []).filter((r) => (r?.peaks || []).some((p) => p.isSuggestion && p.targetRaceId)).length;
}
