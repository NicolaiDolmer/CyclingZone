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
 * Rytterens peak-pladser: de faktiske peaks (ægte + assistent-forslag) fulgt af
 * tomme pladser op til sæsonens loft. Ét fast antal rækker pr. rytter, så listen
 * har samme højde uanset hvor langt manageren er nået — en tom plads er en
 * INVITATION (stiplet "No peak"), ikke et hul.
 *
 * @param {{peaks?:Array<object>}} rider
 * @param {number} maxPerRider
 * @returns {Array<{key:string, peak:object|null, index:number}>}
 */
export function squadSlots(rider, maxPerRider) {
  const peaks = (rider?.peaks || []).slice().sort((a, b) => {
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
 * Antal ryttere der har mindst ét uaccepteret forslag — handlingskortets
 * "N peaks for M ryttere".
 *
 * @param {Array<object>} riders
 * @returns {number}
 */
export function ridersWithSuggestions(riders) {
  return (riders || []).filter((r) => (r?.peaks || []).some((p) => p.isSuggestion)).length;
}
