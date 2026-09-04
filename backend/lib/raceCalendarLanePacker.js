// backend/lib/raceCalendarLanePacker.js
// Kalender-kronologi-rebuild (2026-06-28): adskil IN-GAME-dagen (game_day) fra IRL-dagen (real_day).
// Spec: docs/superpowers/specs/2026-06-28-race-calendar-chronology-rebuild-design.md.
//
// HVER etape får sin EGEN game-dag (et 21-etapers løb spænder 21 game-dage = fuldt commitment).
// Binding (raceBinding.js) nøgler på game_day → uændret kode. To layout-strategier, valgt automatisk:
//
//   BANDED (foretrukket — Div 2/3/4): B "baseline"-spor dækker hele tidslinjen + en overlay på R af
//     hver IRL-dags K game-dage. Hver IRL-dag = K HELE game-dage → går præcist op i density UDEN
//     straddle, og giver en bevidst BLANDING (fx Div 3: skiftevis 1 og 2 samtidige løb). Kræver nok
//     endagsløb og ingen binding-fri monumenter (de hører i Div 1).
//   STREAM (fallback — Div 1): least-loaded på `cap` spor + game-dag-ordnet komprimering. Håndterer
//     Grand Tour-rygrad + binding-fri monumenter; kan have lidt straddle. Bruges når BANDED ikke kan
//     realiseres (for få endagsløb / monumenter til stede).
//
// REN + deterministisk (ingen DB/Date/random).
//
// #3469 (2026-08-06): race-objekter kan nu bære en valgfri numerisk `seasonFraction` (0..1,
// jf. seasonPhaseProfiles.js) — tierCalendarMaterializer.js beriger sel.stageRaces/
// sel.oneDayRaces med den FØR de fodres hertil, ud fra race_pool.date_text. Når ALLE items i
// en given liste har fraction, sortéres/ankres de efter fase i stedet for jævn spredning;
// mangler ÉT ELLER FLERE items fraction, falder pakkeren tilbage til den gamle, fraction-frie
// algoritme — BIT-IDENTISK med før #3469 (alle eksisterende fixtures uden date_text rammer
// derfor denne sti uændret). SELECTIONEN (hvilke løb) rører #3469 aldrig, kun rækkefølgen.
//
// #3470 (2026-08-06): GT-race-objekter kan desuden bære en valgfri numerisk `restDays`
// (0..3, jf. grandTourRestDays.js) — tierCalendarMaterializer.js beriger dem ud fra
// race_pool.date_text (samme kilde som seasonFraction). KUN i STREAM's fase-ankrede GT-gren
// (gtsByPhase, dvs. når ALLE GT'er har en seasonFraction — perGap-fallback-grenen og BANDED
// rører #3470 ALDRIG) splittes GT'ens etaper i segmenter adskilt af ét endagsløb pr. hviledag
// (fra `rest`-puljen) på selve hviledags-game_day'et — Option A: HUL i game_day, TÆT
// stage_number (1..N uafbrudt). restDays udeladt/0 ⇒ ét segment ⇒ bit-identisk med #3469.

import { grandTourRestDayPositions, GRAND_TOUR_REST_DAYS } from "./grandTourRestDays.js";
import { MONUMENT_MIN_CALENDAR_GAP_DAYS, MONUMENT_MIN_CALENDAR_SPREAD_DAYS } from "./calendarTierCaps.js";

// B2 (#4075, spec §3.4, ejer-låst 21/8): monumenter har en NORMAL game_day i deres eget
// tidsslot — 100000-sentinelen (MONUMENT_GAMEDAY_BASE) er fjernet. Løbsdagen er EKSKLUSIV
// (ingen modløb på samme game_day, så alle ryttere kan stille op); andre løb må ligge i
// datoens øvrige slots. Se slot-konsumeringsloopet i layoutStream for konstruktionen.

const lenOf = (r) => Math.max(1, Number(r.stages) || 1);
const isMonument = (r) => r?.race_class === "Monuments";
const byBigThenId = (a, b) => lenOf(b) - lenOf(a) || String(a.id).localeCompare(String(b.id));
const hasFraction = (r) => typeof r.seasonFraction === "number" && Number.isFinite(r.seasonFraction);
const byPhaseThenBigThenId = (a, b) => a.seasonFraction - b.seasonFraction || lenOf(b) - lenOf(a) || String(a.id).localeCompare(String(b.id));

// #3469: fase-sortér `items` (stabilt: fraction asc → stages desc → id) når ALLE har en
// numerisk seasonFraction; ellers null — kalderen falder tilbage til sin nuværende
// (fraction-frie) sti, garanteret bit-identisk med før #3469.
function orderByPhase(items) {
  if (!items.every(hasFraction)) return null;
  return [...items].sort(byPhaseThenBigThenId);
}

// #3546 B (ejer-beslutning 17/8, rod-årsag verificeret): "rest"-etapeløbenes (others)
// EGEN date_text-fraction klumper (August-tungt i det ægte katalog), så GT-vinduerne ikke
// deler ikke-GT-tætheden ligeligt: Giro-vinduet (laveste GT-fraction) delte de 5 daglige
// slots med ~3 samtidige løb mod de senere GT'ers ~1-2. Fixet omfordeler KUN de ikke-GT
// ETAPELØB (den flerdags-belastning der reelt driver samtidighed) til en fraction JÆVNT
// spredt over de tre GT-CENTREREDE vinduer, i stedet for deres rå, klumpede date_text-
// fraction: endagsløb (classics) rører vi ikke: ejerens rod-årsag peger specifikt på
// etapeløbenes date_text, og et endagsløb bidrager kun 1 dag til samtidighed uanset hvor
// det lander. REN funktion, deterministisk (vægtet round-robin: ingen rng).
//
// Vinduer: [0, mid(g0,g1)], [mid(g0,g1), mid(g1,g2)], [mid(g1,g2), 1]: samme "centreret
// om GT'en"-princip som SEASON_PHASES' First/Second GT Block (seasonPhaseProfiles.js).
// Fordelingen er RACE-COUNT-vægtet efter vinduets bredde (largest-remainder-metoden,
// stabil/deterministisk); de STØRSTE løb (mest disruptive for samtidighed) fordeles først,
// så et enkelt kæmpe-etapeløb ikke ender i det samme vindue som en klump af mindre.
export function balanceStageRaceFractionAcrossGtWindows(gtsByPhase, others) {
  if (!gtsByPhase?.length || !others?.length) return others;
  if (!others.every(hasFraction)) return others; // intet at balancere uden fraction: kalderen har allerede sin fallback

  const gtFractions = [...gtsByPhase].map((g) => g.seasonFraction).sort((a, b) => a - b);
  const bounds = [0, ...gtFractions.slice(0, -1).map((f, i) => (f + gtFractions[i + 1]) / 2), 1];
  const windowCount = bounds.length - 1;
  if (windowCount < 1) return others;
  const widths = Array.from({ length: windowCount }, (_, i) => bounds[i + 1] - bounds[i]);
  const totalWidth = widths.reduce((s, w) => s + w, 0) || 1;

  // Largest-remainder: heltals-kvoter der summer til others.length, proportionalt med bredde.
  const raw = widths.map((w) => (w / totalWidth) * others.length);
  const quotas = raw.map(Math.floor);
  let remaining = others.length - quotas.reduce((s, q) => s + q, 0);
  const remainders = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < remaining; k++) quotas[remainders[k % windowCount].i] += 1;

  // Størst-først (byBigThenId) → de mest disruptive løb får FØRSTE valg af vindue, spredt
  // round-robin over vinduer med resterende kvote (så to store løb ikke havner i samme
  // vindue, hvis andre vinduer stadig har plads).
  const sorted = [...others].sort(byBigThenId);
  const remainingQuota = quotas.slice();
  const assigned = Array.from({ length: windowCount }, () => []);
  let cursor = 0;
  for (const r of sorted) {
    let guard = 0;
    while (remainingQuota[cursor] <= 0 && guard++ < windowCount) cursor = (cursor + 1) % windowCount;
    if (remainingQuota[cursor] <= 0) cursor = quotas.findIndex((q, i) => assigned[i].length < q); // defensivt fallback
    if (cursor < 0) cursor = windowCount - 1;
    assigned[cursor].push(r);
    remainingQuota[cursor] -= 1;
    cursor = (cursor + 1) % windowCount;
  }

  const out = [];
  for (let w = 0; w < windowCount; w++) {
    const list = assigned[w];
    const [lo, hi] = [bounds[w], bounds[w + 1]];
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const fraction = n === 1 ? (lo + hi) / 2 : lo + ((i + 0.5) / n) * (hi - lo);
      out.push({ ...list[i], seasonFraction: fraction });
    }
  }
  return out;
}

// #3546 F (ejer-valgt 17/8 aften): brostens-løbenes (cobbled_classic) rå date_text-fraction
// falder MONOTONT hen over sæsonen i det ægte katalog (målt: 29→24→18→8 pr. uge), så D1's
// pakkede kalender kun får 3 brostens-etaper, alle tidlige. Ejer-valgt fix: to VINDUER
// (tidligt + sent i sæsonen) i stedet for det monotone fald. REN funktion, deterministisk
// (ingen rng): kalderen (tierCalendarMaterializer.js) afgør hvilke races der er "cobbles"
// via isCobbles-prædikatet, så denne fil forbliver katalog-uafhængig (samme princip som
// balanceStageRaceFractionAcrossGtWindows ovenfor).
export function reshapeCobblesFractionToTwoWindows(races, isCobbles, {
  earlyWindow = [0.02, 0.15], lateWindow = [0.75, 0.90],
} = {}) {
  if (!races?.length || typeof isCobbles !== "function") return races;
  const isEligible = (r) => isCobbles(r) && hasFraction(r);
  const cobbles = races.filter(isEligible);
  if (!cobbles.length) return races;
  const rest = races.filter((r) => !isEligible(r));

  // Deterministisk 50/50-split efter ORIGINAL fraction-rang (stabil id-tiebreak, ingen
  // rng): de tidligst daterede races i den rå fordeling forbliver i det TIDLIGE vindue,
  // resten rykker til det SENE. #3546-mønstret ("to vinduer i stedet for monotont fald")
  // opnås dermed uden at ændre HVILKE races der er cobbles (selectionen rører vi aldrig).
  const sorted = [...cobbles].sort((a, b) => a.seasonFraction - b.seasonFraction || String(a.id).localeCompare(String(b.id)));
  const splitAt = Math.ceil(sorted.length / 2);
  const early = sorted.slice(0, splitAt);
  const late = sorted.slice(splitAt);

  const spread = (list, [lo, hi]) => list.map((r, i) => ({
    ...r,
    seasonFraction: list.length === 1 ? (lo + hi) / 2 : lo + (i / (list.length - 1)) * (hi - lo),
  }));

  return [...rest, ...spread(early, earlyWindow), ...spread(late, lateWindow)];
}

// ---- BANDED: B baseline-spor + overlay; hele game-dage pr. IRL-dag (straddle-fri) ----
// Returnerer { placements, timelineLength } eller null hvis ikke realiserbart.
// #4236 - KONTIGUITETS-LAYOUT (ejer-regel 25/8 + #4236 i eet).
//
// De to invarianter det garanterer VED KONSTRUKTION:
//   1. Et loebs loebsdage ligger I TRAEK. "Hvis et loeb har fire etaper, skal loebsdagene
//      ligge i traek. Ligesom i virkeligheden. Loebsdag 4-5-6-7." (ejer 25/8)
//   2. En loebsdag hoerer til PRAECIS een kalenderdato (#4236). Dato d ejer loebsdagene
//      [d*K, (d+1)*K), saa bindingen aldrig kan laase et felt med et loeb der er koert
//      faerdigt paa en anden dato.
//
// Hvorfor et nyt layout og ikke en lap paa de to gamle:
//   - layoutStream udleder real_day af slot-positionen og baerer game_day fra eventet. De
//     to akser er uafhaengige, saa den kan hverken love 1 eller 2.
//   - layoutBanded lover begge, men kun med sin egen rigide kvote (B ens spor der loeber
//     hele tidslinjen + R endagsloebs-pladser). D1 skulle skifte 8 etaper ud med
//     endagsloeb, og andelen af endagsloeb ville gaa fra 61 % til ca. 68 % mod maalet paa
//     55 % (#3327, ejer 7/8). Kalenderens indhold skal afgoeres af spildesign, ikke af
//     hvad pakkeren tilfaeldigvis kan pakke.
//
// Modellen: vi vaelger kun EEN ting pr. loeb - dets START-loebsdag. Resten foelger, fordi
// etaperne ligger i traek. Bindingerne er
//   load(g) <= cap                             hoejst cap loeb paa samme loebsdag
//   sum(load) over datoens K loebsdage = D     praecis density etaper hver dag (#4218)
// og der er NUL slack: sum(etaper) = D*days. Hver loebsdag skal ramme sit tal praecist.
// Det er dét der goer graadig pakning haabloes - og samtidig soegetraeet smalt nok til at
// vaere udtoemmende. Maalt mod prod-kataloget loeses alle fire divisioner paa under 1 ms
// (29-153 skridt).
//
// Loeb med samme etapetal er ombyttelige i selve soegningen, saa der soeges paa ANTAL pr.
// laengde. Identiteterne paasaettes bagefter i fase-raekkefoelge (seasonFraction), saa et
// loeb lander samme sted i saesonen som i virkeligheden.
// Fodaftryk for et loeb paa loebsdags-aksen: 1 = etape, 0 = hviledag. Kun Grand Tours har
// hviledage, og ejer-beslutningen 25/8 gjorde antallet fast paa GRAND_TOUR_REST_DAYS (2).
// En hviledag ER en loebsdag loebet OPTAGER uden at koere paa - rytteren er bundet henover.
function raceFootprint(race, spineMinStages) {
  const L = lenOf(race);
  if (spineMinStages == null || L < spineMinStages) return new Array(L).fill(1);
  const efter = new Set(grandTourRestDayPositions({ stages: L, restDays: GRAND_TOUR_REST_DAYS }));
  const fp = [];
  for (let etape = 1; etape <= L; etape++) {
    fp.push(1);
    if (efter.has(etape) && etape < L) fp.push(0);
  }
  return fp;
}

// #4236 - soegningen bag kontiguitets-layoutet.
//
// Vi vaelger kun EEN ting pr. loeb: dets START-loebsdag. Resten foelger af fodaftrykket.
// Otte bindinger holdes samtidig:
//   R1 loebsdagene ligger i traek (fodaftrykket er sammenhaengende)
//   R2 en loebsdag hoerer til praecis een kalenderdato (datoen ejer et baand)
//   R3 hoejst `cap` loeb med etape paa samme loebsdag
//   R4 hver kalenderdato har praecis `density` etaper
//   R5 ingen tom loebsdag
//   R6 to GT'er deler aldrig en kalenderdato, mindst een dags mellemrum (#3472)
//   R7 hoejst MAX_GT_STAGES_PER_DAY GT-etaper pr. kalenderdato (#4103)
//   R8 en GT's spaend er hoejst MAX_GT_SPAN_DAYS kalenderdatoer
//   R9  et monument ligger ALDRIG inde i et Grand Tours loebsdags-spaend (#4203)
//   R10 mindst MIN_GAP kalenderdage mellem to nabo-monumenter (§4)
//   R11 mindst MIN_SPREAD kalenderdage fra foerste til sidste monument (§4)
//
// R9-R11 er #4203's leverance og er AKTIVE naar `monumentRules` er sat. Foer dem var
// monumenternes placering et biprodukt: de er 1-etapes loeb som alle andre endagsloeb,
// og identiteterne blev paasat EFTER soegningen, i den raekkefoelge fase-sorteringen gav.
// Soegningen kunne derfor ikke se forskel paa et monument og en tilfaeldig klassiker,
// og S3 endte med 4 af 5 monumenter inde i et GT-vindue.
//
// HVORFOR DET IKKE KUNNE FIKSES EFTER SOEGNINGEN. Den oplagte lap - byt monumentets slot
// med en klassikers, siden begge er 1-etapes og dermed ombyttelige - er MAALT umulig for
// S4: paa den plan soegningen fandt uden R9-R11 laa kun 7 af D1's 19 endagsloebs-slots
// uden for et GT-vindue, fordelt paa to klumper (4 + 3 datoer i traek). Med kravet om 2
// kalenderdage mellem naboer kan der hoejst vaelges 2 fra hver klump = 4 slots til 5
// monumenter, og spredningen ville blive 12 dage mod kravet 14. Der FINDES flere frie
// datoer i sae­sonen (de tre efter sidste GT), men ingen af dem baerer et endagsloeb - og
// hvilke datoer der baerer et endagsloeb afgoeres netop af soegningen. Derfor er reglen
// noedt til at vaere en BINDING i soegningen, ikke en oprydning bagefter.
//
// Baandstoerrelsen er VARIABEL - en dato er faerdig naar den har D etaper. Fast K =
// ceil(D/cap) var for stift: en GT kunne da hoejst koere 2 etaper pr. dato, saa 18 etaper
// blev 9 datoer og tre GT'er kraevede 29 datoer ud af 28.
//
// Maalt mod prod-kataloget loeses alle fire divisioner med alle otte bindinger aktive
// (D1 paa 709 skridt / 3 ms). R8 er den stramme: den afskar 609 forsoeg i D1.
function solveContiguousStarts({ races, D, days, cap, spineMinStages, monumentRules = null, maxSteps = 20000000 }) {
  const items = races
    .map((race, i) => ({
      i, race, fp: raceFootprint(race, spineMinStages),
      gt: spineMinStages != null && lenOf(race) >= spineMinStages,
      // Monument-rollen findes KUN naar reglerne er aktive. Uden dem er et monument et
      // endagsloeb som alle andre - praecis som foer #4203 - og soegningen er dermed
      // bit-identisk med den gamle paa andet forsoeg (se layoutContiguous).
      mon: Boolean(monumentRules) && isMonument(race),
    }))
    // SORTERINGEN ER UROERT (fodaftryks-laengde faldende, saa id). Et foerste forsoeg lagde
    // `mon` ind som sorteringsnoegle, saa monumenterne laa samlet og dublet-springet i
    // vaelg() (der kigger paa k-1) ramte oftere. MAALT var det en klar regression: paa
    // tierCalendarMaterializer-testens syntetiske D1-katalog (tre 21-etapers GT'er) gik
    // soegningen fra 4,1 s til at loebe TOER for skridt - baade med og uden monument-
    // reglerne - og faldt ned i det afslappede layout med 17 uplacerede endagsloeb.
    // Soegeraekkefoelgen er en foelsom parameter i sig selv; #4203 aendrer BINDINGERNE,
    // ikke raekkefoelgen.
    .sort((a, b) => b.fp.length - a.fp.length || String(a.race.id).localeCompare(String(b.race.id)));

  if (items.reduce((n, it) => n + lenOf(it.race), 0) !== D * days) return null;

  const mr = monumentRules;
  const monAntal = items.filter((it) => it.mon).length;
  if (mr && monAntal === 0) return null; // kalderen skal ikke bede om monument-regler uden monumenter

  // Symmetri-kollaps: to loeb med samme fodaftryk OG samme rolle (GT / monument / almindeligt)
  // er ombyttelige i soegningen - identiteterne paasaettes bagefter i fase-raekkefoelge - saa
  // kun det FOERSTE ubrugte af dem behoever proeves. Foer #4203 blev det afgjort ved at kigge
  // paa naboen k-1, hvilket kun virkede fordi sorteringen lagde ombyttelige loeb ved siden af
  // hinanden. Da monumenter blev en egen rolle, braekkede den antagelse: id-sorteringen giver
  // c1-od-* / mon-* / owa-od-*, saa endagsloebene efter monumenterne ikke laengere havde en
  // ombyttelig NABO og derfor blev proevet forfra som selvstaendige grene. MAALT paa
  // tierCalendarMaterializer-testens syntetiske D1-katalog: soegningen loeb toer for skridt
  // (55 s, 17 uplacerede endagsloeb) mod 4,1 s foer. Klassen slaas derfor op direkte i stedet
  // for at blive udledt af naboskab.
  const klasseAf = items.map((it) => `${it.fp.join("")}|${it.gt ? "G" : ""}${it.mon ? "M" : ""}`);
  const forrigeAfKlasse = new Array(items.length).fill(-1);
  const sidsteIKlasse = new Map();
  for (let k = 0; k < items.length; k++) {
    if (sidsteIKlasse.has(klasseAf[k])) forrigeAfKlasse[k] = sidsteIKlasse.get(klasseAf[k]);
    sidsteIKlasse.set(klasseAf[k], k);
  }

  const brugt = new Array(items.length).fill(false);
  const startAf = new Array(items.length).fill(-1);
  const bandSizes = [];
  let steps = 0;

  const dfs = (g, iBaand, dato, brugtIDato, gtIDato, aktive, restStages, gtStartDato, sidsteGtSlut,
    monFoerste, monSidste, monRest) => {
    if (++steps > maxSteps) return false;

    // R10/R11 som FREMADRETTEDE snit, ikke som en dom til sidst. Uden dem ville soegningen
    // bygge en hel kalender faerdig og foerst dér opdage at det sidste monument ikke kan
    // ligge langt nok fra det forrige - og saa gaa hele vejen tilbage.
    if (mr) {
      if (monRest > 0) {
        const tidligst = monSidste == null ? dato : Math.max(dato, monSidste + mr.minGapDays);
        if (tidligst + (monRest - 1) * mr.minGapDays > days - 1) return false;         // R10
        if (monAntal >= 2 && monFoerste != null
            && (days - 1) - monFoerste < mr.minSpreadDays) return false;               // R11
      } else if (monAntal >= 2 && monFoerste != null
          && monSidste - monFoerste < mr.minSpreadDays) {
        return false;                                                                  // R11
      }
    }

    if (dato === days) return aktive.length === 0 && brugt.every(Boolean);
    if (restStages !== (days - dato) * D - brugtIDato) return false;

    const carriedStages = aktive.filter((a) => items[a.i].fp[a.off] === 1).length;
    const carriedGt = aktive.filter((a) => items[a.i].gt && items[a.i].fp[a.off] === 1).length;
    if (gtIDato + carriedGt > MAX_GT_STAGES_PER_DAY) return false;

    const plads = D - brugtIDato;
    const lo = Math.max(1, carriedStages);
    const hi = Math.min(cap, plads);
    if (lo > hi) return false;

    const gtAktiv = aktive.some((a) => items[a.i].gt);

    // TAETTEST FOERST. Soegningen tager den foerste loesning den finder, saa retningen her
    // afgoer kalenderens karakter: nedad fylder hver loebsdag til cap'en og holder
    // overlappet - selve bindingsspillet, hvor manageren skal vaelge mellem samtidige loeb.
    // Opad gav 1 loeb pr. loebsdag i D2/D3/D4, altsaa nul valg (#3327: "specialister uden
    // noget at koere" er den samme skade set fra en anden vinkel).
    for (let load = hi; load >= lo; load--) {
      const nye = load - carriedStages;
      if (nye < 0) continue;

      const kandidater = [];
      const vaelg = (fra, rest, acc) => {
        if (kandidater.length > 300) return;
        if (rest === 0) { kandidater.push([...acc]); return; }
        for (let k = fra; k < items.length; k++) {
          if (brugt[k]) continue;
          // Springer et ombytteligt loeb over hvis et tidligere, ubrugt loeb af SAMME
          // klasse allerede er i spil i dette scan (se klasseAf/forrigeAfKlasse ovenfor).
          const forrige = forrigeAfKlasse[k];
          if (forrige >= fra && !brugt[forrige]) continue;
          if (items[k].gt) {
            if (gtAktiv || acc.some((x) => items[x].gt)) continue;                  // R6
            if (sidsteGtSlut != null && dato < sidsteGtSlut + 2) continue;          // R6
            if (mr && acc.some((x) => items[x].mon)) continue;                      // R9
          }
          if (mr && items[k].mon) {
            // R9: `gtAktiv` er praecis "en GT's loebsdags-spaend daekker denne loebsdag" -
            // en GT paa hviledag bliver liggende i `aktive` med fodaftryk 0, og gaten
            // detectMonumentsInsideGrandTours maaler paa samme spaend (first..last).
            if (gtAktiv || acc.some((x) => items[x].gt)) continue;                  // R9
            if (acc.some((x) => items[x].mon)) continue;                            // R10 (samme dato)
            if (monSidste != null && dato - monSidste < mr.minGapDays) continue;    // R10
          }
          acc.push(k); brugt[k] = true;
          vaelg(k + 1, rest - 1, acc);
          brugt[k] = false; acc.pop();
        }
      };
      vaelg(0, nye, []);

      for (const kombi of kandidater) {
        for (const k of kombi) { brugt[k] = true; startAf[k] = g; }
        const nuAktive = [...aktive, ...kombi.map((k) => ({ i: k, off: 0 }))];
        const gtStarterNu = kombi.some((k) => items[k].gt);
        const nyGtStart = gtStarterNu ? dato : gtStartDato;

        const gtNu = gtIDato + nuAktive.filter((a) => items[a.i].gt && items[a.i].fp[a.off] === 1).length;
        const efter = nuAktive.map((a) => ({ i: a.i, off: a.off + 1 })).filter((a) => a.off < items[a.i].fp.length);
        const nyBrugt = brugtIDato + load;
        const datoFaerdig = nyBrugt === D;

        // R8 paa loebsdags-niveau: en GT slutter typisk INDE i en dato. Detekteres det
        // foerst naar datoen er faerdig, naas slutningen aldrig, og spaendet maales bagefter
        // fra et foraeldet startpunkt - saa et 7-dages GT slap igennem et loft paa 6.
        const gtVarAktiv = nuAktive.some((a) => items[a.i].gt);
        const gtSlutter = gtVarAktiv && !efter.some((a) => items[a.i].gt);
        const spanNu = nyGtStart == null ? 0 : dato - nyGtStart + 1;
        if (nyGtStart != null && spanNu > MAX_GT_SPAN_DAYS) {                        // R8
          for (const k of kombi) { brugt[k] = false; startAf[k] = -1; }
          continue;
        }
        const naesteGtStart = gtSlutter ? null : nyGtStart;
        const naesteGtSlut = gtSlutter ? dato : sidsteGtSlut;

        // vaelg() tillader hoejst EET monument pr. dato (R10), saa tallet her er 0 eller 1.
        const monNu = kombi.reduce((n, k) => n + (items[k].mon ? 1 : 0), 0);
        const nyMonFoerste = monNu && monFoerste == null ? dato : monFoerste;
        const nyMonSidste = monNu ? dato : monSidste;
        const nyMonRest = monRest - monNu;

        let ok = false;
        if (datoFaerdig) {
          bandSizes.push(iBaand + 1);
          ok = dfs(g + 1, 0, dato + 1, 0, 0, efter, restStages - load, naesteGtStart, naesteGtSlut,
            nyMonFoerste, nyMonSidste, nyMonRest);
          if (!ok) bandSizes.pop();
        } else {
          ok = dfs(g + 1, iBaand + 1, dato, nyBrugt, gtNu, efter, restStages - load, naesteGtStart, naesteGtSlut,
            nyMonFoerste, nyMonSidste, nyMonRest);
        }
        if (ok) return true;
        for (const k of kombi) { brugt[k] = false; startAf[k] = -1; }
      }
    }
    return false;
  };

  if (!dfs(0, 0, 0, 0, 0, [], D * days, null, null, null, null, monAntal)) return null;

  const dateOfGameDay = [];
  bandSizes.forEach((b, d) => { for (let i = 0; i < b; i++) dateOfGameDay.push(d); });
  return {
    dateOfGameDay,
    G: dateOfGameDay.length,
    placeringer: items.map((it, k) => ({ race: it.race, fp: it.fp, mon: it.mon, g0: startAf[k] })),
    steps,
  };
}

// #4236 - AFSLAPPET kontiguitets-layout for de tilfaelde hvor kvoten IKKE gaar op.
//
// Den udtoemmende soegning kraever sum(etaper) === density x days, fordi den bygger paa at
// hver dato rammer sit tal praecist. Det gaelder i produktion for alle fire divisioner, men
// ikke overalt: forceTiers giver en tier-4-pulje uden managers en kalender af 1 loeb,
// rest-af-saeson-overrides saetter egne kvoter, og en raekke fixtures er bevidst tynde.
//
// Her er der slaek, saa graadigt er nok. De to invarianter holdes stadig ved konstruktion:
// et loebs loebsdage ligger i traek, og en loebsdag hoerer til den dato den blev skabt paa.
// Til gengaeld kan en dato faa faerre end density etaper - det rapporteres som emptyDays,
// praecis som foer.
function layoutContiguousRelaxed({ races, D, days, cap, spineMinStages }) {
  const items = races.map((race) => ({ race, fp: raceFootprint(race, spineMinStages) }));
  const iOrden = orderByPhase(items.map((it) => it.race)) ?? items.map((it) => it.race).sort(byBigThenId);
  const fpAf = new Map(items.map((it) => [it.race.id, it.fp]));
  const pulje = iOrden.map((race) => ({ race, fp: fpAf.get(race.id) }));

  const placementsById = new Map();
  const dateOfGameDay = [];
  let g = 0;
  let aktive = []; // { race, fp, off }

  for (let d = 0; d < days; d++) {
    let iDato = 0;
    while (iDato < D) {
      const baerer = aktive.filter((a) => a.off < a.fp.length);
      const baererEtaper = baerer.filter((a) => a.fp[a.off] === 1).length;
      // Loeb der allerede koerer SKAL have deres loebsdag (kontiguitet). Kan datoen ikke
      // baere dem, lukkes den og de fortsaetter paa naeste dato.
      if (baererEtaper > D - iDato) break;

      const plads = Math.min(cap - baerer.length, D - iDato - baererEtaper);
      const nye = [];
      while (nye.length < plads && pulje.length) nye.push(pulje.shift());
      if (!baerer.length && !nye.length) break; // intet at lave paa denne dato

      aktive = [...baerer, ...nye.map((n) => ({ ...n, off: 0 }))];
      dateOfGameDay[g] = d;

      let etaperHer = 0;
      for (const a of aktive) {
        if (a.fp[a.off] !== 1) continue; // hviledag: loebsdagen optages, men ingen etape
        etaperHer += 1;
        if (!placementsById.has(a.race.id)) {
          placementsById.set(a.race.id, {
            id: a.race.id, type: lenOf(a.race) > 1 ? "stage_race" : "single",
            race_class: a.race.race_class ?? null, stages: lenOf(a.race),
            startRealDay: d, stagesPlaced: [],
          });
        }
        const p = placementsById.get(a.race.id);
        p.stagesPlaced.push({ stage_number: p.stagesPlaced.length + 1, real_day: d, game_day: g, lane: 0 });
        p.startRealDay = Math.min(p.startRealDay, d);
      }
      iDato += etaperHer;
      g += 1;
      aktive = aktive.map((a) => ({ ...a, off: a.off + 1 })).filter((a) => a.off < a.fp.length);
    }
  }

  const placements = [...placementsById.values()];
  const perDate = new Map();
  for (const p of placements) {
    for (const st of p.stagesPlaced) {
      if (!perDate.has(st.real_day)) perDate.set(st.real_day, []);
      perDate.get(st.real_day).push(st);
    }
  }
  for (const sts of perDate.values()) {
    sts.sort((a, b) => a.game_day - b.game_day);
    sts.forEach((st, i) => { st.lane = i; });
  }
  return { placements, timelineLength: g };
}

function layoutContiguous({ stageRaces, classics, monuments, density: D, days, cap, spineMinStages }) {
  if (D < 1 || days < 1 || cap < 1) return null;

  // #3546 B (ejer 17/8): de ikke-GT etapeloebs egen date_text-fraction klumper - i det
  // aegte katalog er den August-tung - saa Giro-vinduet delte de daglige slots med ~3
  // samtidige loeb mod de senere GT'ers ~1-2. Omfordelingen spreder dem jaevnt over de tre
  // GT-centrerede vinduer. Den laa foer inde i layoutStream og ville vaere faldet stiltiende
  // bort med den; her koeres den FOER identiteterne saettes paa, saa reglen overlever.
  const erGt = (r) => spineMinStages != null && lenOf(r) >= spineMinStages;
  const gts = stageRaces.filter(erGt);
  let others = stageRaces.filter((r) => !erGt(r));
  const gtsByPhase = gts.length ? orderByPhase(gts) : null;
  if (gtsByPhase) others = balanceStageRaceFractionAcrossGtWindows(gtsByPhase, others);

  const alle = [...gts, ...others, ...classics, ...monuments];
  if (!alle.length) return null;

  // #4203: monument-reglerne (R9-R11) er en BINDING i soegningen, ikke en oprydning
  // bagefter - se solveContiguousStarts' doc-blok for maalingen bag det valg.
  //
  // TO FORSOEG, og det er bevidst. Findes der ingen lovlig pakning MED monument-reglerne,
  // faldt vi foer #4203 ned i layoutContiguousRelaxed, som slaekker paa den EKSAKTE kvote
  // (§1b) og kan efterlade underfyldte kalenderdage. Det ville betale for en placerings-
  // regel med en kvote-regel - en daarlig byttehandel, og en tavs een. Andet forsoeg
  // koerer derfor uden monument-reglerne og giver den kalender vi ville have faaet i
  // forvejen. Den er ikke stille: `detectMonumentsInsideGrandTours` er en HAARD gate uden
  // override i baade scorecardet og buildSeasonCalendar --apply, saa udfaldet bliver
  // rapporteret hoejlydt i stedet for at forsvinde i en fallback.
  const monumentRules = monuments.length
    ? { minGapDays: MONUMENT_MIN_CALENDAR_GAP_DAYS, minSpreadDays: MONUMENT_MIN_CALENDAR_SPREAD_DAYS }
    : null;
  const forsoeg = [];
  let loest = monumentRules
    ? solveContiguousStarts({
      races: alle, D, days, cap, spineMinStages, monumentRules,
      maxSteps: MONUMENT_SOLVE_MAX_STEPS,
    })
    : null;
  if (monumentRules) forsoeg.push({ rules: true, ok: Boolean(loest), steps: loest?.steps ?? null });
  const monumentRulesHeld = Boolean(loest);
  if (!loest) {
    loest = solveContiguousStarts({ races: alle, D, days, cap, spineMinStages });
    forsoeg.push({ rules: false, ok: Boolean(loest), steps: loest?.steps ?? null });
  }
  if (!loest) return layoutContiguousRelaxed({ races: alle, D, days, cap, spineMinStages });
  const { dateOfGameDay, G, placeringer } = loest;

  // Identiteterne paasaettes i fase-raekkefoelge inden for hver fodaftryks-klasse, saa et
  // loeb lander samme sted i saesonen som i virkeligheden (#3469). Uden seasonFraction
  // falder vi tilbage til byBigThenId - stadig deterministisk, ogsaa ved omvendt input.
  //
  // #4203: monumenter faar deres EGEN gruppe. Uden det ville de 1-etapes slots blive delt
  // ud over alle endagsloeb i samlet fase-raekkefoelge, og et monument kunne lande i en
  // klassikers slot - altsaa praecis inde i et GT-vindue igen, EFTER at soegningen havde
  // holdt R9-R11. Med en egen gruppe faar monumenterne netop de slots soegningen
  // reserverede til dem, i deres indbyrdes fase-raekkefoelge (Sanremo -> Ronde -> Roubaix
  // -> Liege -> Lombardia).
  const grupper = new Map();
  for (const pl of placeringer) {
    const noegle = `${pl.fp.length}|${pl.fp.join("")}|${pl.mon ? "M" : ""}`;
    if (!grupper.has(noegle)) grupper.set(noegle, []);
    grupper.get(noegle).push(pl);
  }

  const placementsById = new Map();
  for (const gruppe of grupper.values()) {
    const slots = gruppe.map((pl) => pl.g0).sort((a, b) => a - b);
    const iOrden = orderByPhase(gruppe.map((pl) => pl.race)) ?? gruppe.map((pl) => pl.race).sort(byBigThenId);
    iOrden.forEach((race, idx) => {
      const g0 = slots[idx];
      const fp = gruppe[0].fp;
      const p = {
        id: race.id,
        type: lenOf(race) > 1 ? "stage_race" : "single",
        race_class: race.race_class ?? null,
        stages: lenOf(race),
        startRealDay: dateOfGameDay[g0],
        stagesPlaced: [],
      };
      let etape = 0;
      fp.forEach((erEtape, k) => {
        if (!erEtape) return; // hviledag: loebsdagen er optaget, men der koeres ikke
        etape += 1;
        p.stagesPlaced.push({ stage_number: etape, real_day: dateOfGameDay[g0 + k], game_day: g0 + k, lane: 0 });
      });
      placementsById.set(race.id, p);
    });
  }

  const perDate = new Map();
  for (const p of placementsById.values()) {
    for (const st of p.stagesPlaced) {
      if (!perDate.has(st.real_day)) perDate.set(st.real_day, []);
      perDate.get(st.real_day).push(st);
    }
  }
  for (const sts of perDate.values()) {
    sts.sort((a, b) => a.game_day - b.game_day);
    sts.forEach((st, i) => { st.lane = i; });
  }

  return { placements: [...placementsById.values()], timelineLength: G, monumentRulesHeld, solveAttempts: forsoeg };
}

// #4103 (ejer-direktiv 21/8 + ejer-aftale med spillerne i #feedback-and-ideas 22/8 20:27):
// en Grand Tour maa ALDRIG fylde en hel kalenderdag, og den skal koeres i et KORT vindue.
// Ejer ordret i traaden: "6 sounds like a decent max, yea" + "Agree on no days with 5 gt
// stages". @thelamba havde maalt begge fejl paa den LEVENDE S3-kalender: Giro della
// Penisola 18 etaper spredt over 11 kalenderdage (1-2/dag), mens Tour de l'Hexagone og
// Vuelta Iberica havde dage med PRAECIS 5 GT-etaper - dvs. hele D1's dagskvote (density 5)
// brugt paa eet loeb, saa ingen anden afgoerelse kunne naas den dag.
//
// HVORFOR ET SEPARAT PASS OG IKKE EN AENDRING AF TARGET-FORMLEN: #3546's leverance B
// forsoegte praecis det (empirisk sweep af foerste GT's target-formel, faktor 2,3-3,0,
// Giro-spaend 10 -> 7) og det BLEV FORKASTET, fordi det broed #3472 v3's haarde invariant
// "to GT'er deler aldrig en kalenderdag" - verificeret baade i fixture og mod aegte
// katalog. Se docs/audits/2026-08-17-s3-kalender-pakke-scorecard.md, afsnit B.
//
// Dette pass roerer IKKE stream-layoutet, target-formlen eller separations-bufferet. Det
// opererer paa den ALLEREDE game_day-tildelte event-raekkefoelge, hvor real_day
// udelukkende er en funktion af array-POSITION (buildDayChunks spejler slot-
// konsumeringsloopet 1:1). Et bytte aendrer derfor KUN hvilken IRL-dag en etape koeres
// paa - aldrig dens game_day, og dermed aldrig binding, overlap-cap eller GT-separationen
// i game_day-rummet.
//
// MATEMATIKKEN: ved maxPerDay = 4 giver 18 etaper ceil(18/4) = 5 dage og 17 etaper
// ceil(17/4) = 5 dage. Begge ejer-krav rammes med det SAMME tal: ingen dag med 5, og
// vinduer paa 5 dage (under loftet paa 6). maxPerDay = 3 ville kraeve 6 dage pr. GT og
// dermed FLYTTE vinduerne - praecis den klasse af indgreb #3546 viste er farlig.
//
// SIKKERHED (tre lag):
//   1. Den ENESTE dag der kan faa en GT-etape den ikke havde foer, er modtagerdagen i et
//      bytte. Guarden afviser byttet hvis modtagerdagen allerede baerer en ANDEN GT.
//      Invarianten kan derfor ikke brydes, uanset antal passes.
//   2. Oensket dag maales fra GT'ens EGEN foerste dag, saa komprimeringen trakker etaper
//      TIDLIGERE, vaek fra den naeste GT. Afstanden mellem GT'er kan kun vokse.
//   3. Der byttes ALTID kun med en ikke-GT-event, og hoejst eet bytte pr. pass: hele
//      dag-/positions-modellen genberegnes derefter, saa canMoveTo/spanMoveOk aldrig
//      arbejder paa forgaeldede positioner (den fejlklasse #3546's leverance C blev bidt af).
export const MAX_GT_STAGES_PER_DAY = 4;

// FASE 2 (#4103, ejer-loft 22/8: "6 sounds like a decent max"): komprimer en GT hvis
// vinduet er bredere end maxSpan. Samme rotations-primitiv, modsat retning: et
// ikke-GT-event traekkes UD af GT'ens positions-loeb og placeres efter det, hvorved
// GT-etaperne rykker een slot TIDLIGERE og vinduet skrumper.
//
// Retningen er bevidst: komprimeringen traekker GT'en mod dens EGEN start, altsaa VAEK
// fra den naeste GT. Afstanden mellem to GT'er kan derfor kun vokse. Det er praecis
// modsat #3546 B's forkastede forsoeg, som flyttede GT'ens ANKER og dermed pressede
// GT'erne mod hinanden indtil to af dem delte en kalenderdag.
export const MAX_GT_SPAN_DAYS = 6;

// Skridt-loft for det MONUMENT-BUNDNE soegeforsoeg (#4203). Det almindelige forsoeg beholder
// solveContiguousStarts' eget loft paa 20 mio.
//
// HVORFOR ET EGET, LAVERE LOFT. Monument-reglerne kan vaere uopfyldelige for et givet
// katalog - fx tre 21-etapers Grand Tours i en 28-dages saeson, som
// tierCalendarMaterializer.test.js's syntetiske D1-katalog har: GT'erne fylder da saa mange
// datoer at fem monumenter ikke kan faa hver sin, med to kalenderdages mellemrum, uden for
// dem alle. Uden et loft brugte forsoeget hele 20-mio.-budgettet (ca. 50 s) foer det gav op,
// og det ANDET forsoeg - det der leverer kalenderen - blev udskudt lige saa laenge.
//
// 2 mio. er maalt, ikke gaettet: prods S4-plan loeser D1 MED reglerne paa 110.519 skridt
// (dry-run 3/9), altsaa med en faktor 18 i luft. Rammer et fremtidigt katalog loftet, staar
// det i `solveAttempts` i dry-runnet, og gaten detectMonumentsInsideGrandTours stopper
// --apply - loftet kan da haeves med en maaling i haanden i stedet for paa fornemmelse.
export const MONUMENT_SOLVE_MAX_STEPS = 2000000;


// Diagnostik fra placements (ÆGTE binding-overlap fra FAKTISK afviklede etaper pr. game-dag,
// uafhængigt af layout — #3470 ejer-beslutning 7/8: stage-baseret, ikke span-baseret; se
// kommentaren ved maxOverlap/overlapHistogram nedenfor).
function diagnose(placements, days, D, cap, timelineLength, layoutMode, spineMinStages) {
  const load = new Array(days).fill(0);
  const racesOnDay = Array.from({ length: days }, () => new Set());
  for (const p of placements) for (const st of p.stagesPlaced) { load[st.real_day] += 1; racesOnDay[st.real_day].add(p.id); }

  // #3470 (ejer-beslutning 7/8, afløser den midlertidige cap+1-tolerance): overlappet her
  // tæller KUN løb der FAKTISK har en etape på den pågældende game_day — ikke span-baseret
  // (min..max). En GT på hviledag (game_day-hul, #3470) tæller derfor IKKE med i den dags
  // overlap; dens ryttere er stadig bundet, men BINDINGSLAGENE (raceBinding.js m.fl.) er
  // SEPARATE, span-baserede systemer og RØRES IKKE her — kun denne diagnostiske optælling
  // ændres. For løb UDEN huller er stage- og span-baseret optælling matematisk identisk
  // (gameDays-sættet ER hele [min,max]-intervallet), så alle andre tal er uændrede.
  // B2 (#4075): monumenter tæller med som normale løb — deres game_day er nu ægte og
  // EKSKLUSIV pr. design, så de bidrager korrekt som 1-løbs-game_days i histogrammet.
  const gameDaysByPlacement = placements
    .map((p) => new Set(p.stagesPlaced.map((s) => s.game_day)));
  const hi = gameDaysByPlacement.length
    ? Math.max(...gameDaysByPlacement.map((gds) => Math.max(...gds)))
    : -1;
  const overlapHistogram = {};
  let maxOverlap = 0;
  for (let g = 0; g <= hi; g++) {
    const n = gameDaysByPlacement.filter((gds) => gds.has(g)).length;
    overlapHistogram[n] = (overlapHistogram[n] || 0) + 1;
    if (n > maxOverlap) maxOverlap = n;
  }

  const irlByGameDay = new Map();
  for (const p of placements) for (const st of p.stagesPlaced) {
    if (!irlByGameDay.has(st.game_day)) irlByGameDay.set(st.game_day, new Set());
    irlByGameDay.get(st.game_day).add(st.real_day);
  }
  let straddleGameDays = 0;
  for (const set of irlByGameDay.values()) if (set.size > 1) straddleGameDays += 1;

  // #3472 v3 (ejer-fund 6/8, anden runde): ÆGTE efter-hånden-verifikation af GT-real-day-
  // adskillelse — uafhængig af hvordan layoutStream KONSTRUEREDE separationen (dens
  // placedCount-baserede gulv er en approksimation), så et konstruktionstidspunkt-estimat der
  // viser sig forkert (fx rest-køen løb tør) rapporteres her i stedet for at fejle stille.
  // GT'er identificeres via `stages >= spineMinStages` (samme tærskel pakkeren selv brugte
  // til at udskille rygraden) — banded-layouts har aldrig GT'er (kun stream), så listen er
  // tom der og tjekket er et no-op.
  const gtSpans = spineMinStages == null ? [] : placements
    .filter((p) => (p.stages ?? 1) >= spineMinStages)
    .map((p) => ({ id: p.id, startRealDay: Math.min(...p.stagesPlaced.map((s) => s.real_day)), endRealDay: Math.max(...p.stagesPlaced.map((s) => s.real_day)) }))
    .sort((a, b) => a.startRealDay - b.startRealDay);
  const gtRealDaySeparationViolations = [];
  for (let i = 1; i < gtSpans.length; i++) {
    const gap = gtSpans[i].startRealDay - gtSpans[i - 1].endRealDay;
    if (gap < 1) {
      gtRealDaySeparationViolations.push(
        `${gtSpans[i - 1].id} (slutter kalenderdag ${gtSpans[i - 1].endRealDay}) og ${gtSpans[i].id} ` +
        `(starter kalenderdag ${gtSpans[i].startRealDay}) deler eller overlapper kalenderdag`
      );
    }
  }

  // #3546 C: dage UDEN afgørelse (endagsløb/monument eller etapeløbs-slutetape)  - 
  // rapporteres for BEGGE layouts (banded har ingen aktiv enforceDailyDecisions, men
  // metrikken måles alligevel, jf. issue-kravet om at kunne MÅLE det). En dag tælles som
  // havende en afgørelse hvis MINDST ét stagesPlaced-element den dag er løbets sidste
  // etape (stage_number === p.stages) — endagsløb og monumenter opfylder det trivielt
  // (etape 1 af 1; B2/#4075: monumenter har nu normal game_day som alle andre).
  const decisionDaySet = new Set();
  for (const p of placements) {
    for (const st of p.stagesPlaced) {
      const isDecision = st.stage_number === (p.stages ?? 1);
      if (isDecision) decisionDaySet.add(st.real_day);
    }
  }
  const daysWithoutDecision = [];
  for (let d = 0; d < days; d++) if (!decisionDaySet.has(d)) daysWithoutDecision.push(d);

  // #4203-diagnostik: hvor monumenterne endte, maalt paa BEGGE akser. Rent rapporterings-
  // data (dry-run + tests); dommen selv ligger i calendarPlacementGates.js.
  // insideGrandTour maales paa LOEBSDAGS-aksen (game_day), gap/spredning paa
  // KALENDER-aksen (real_day) - de to regler bruger med vilje hver sin akse (§0/§4).
  const gtGameDaySpans = spineMinStages == null ? [] : placements
    .filter((p) => (p.stages ?? 1) >= spineMinStages)
    .map((p) => ({
      first: Math.min(...p.stagesPlaced.map((s) => s.game_day)),
      last: Math.max(...p.stagesPlaced.map((s) => s.game_day)),
    }));
  const monPlacements = placements
    .filter((p) => p.race_class === "Monuments")
    .map((p) => ({
      id: p.id,
      gameDay: Math.min(...p.stagesPlaced.map((s) => s.game_day)),
      realDay: Math.min(...p.stagesPlaced.map((s) => s.real_day)),
    }))
    .sort((a, b) => a.realDay - b.realDay || a.gameDay - b.gameDay);
  const monGaps = monPlacements.slice(1).map((m, i) => m.realDay - monPlacements[i].realDay);
  const monuments = {
    count: monPlacements.length,
    gameDays: monPlacements.map((m) => m.gameDay),
    realDays: monPlacements.map((m) => m.realDay),
    minGapDays: monGaps.length ? Math.min(...monGaps) : null,
    spreadDays: monPlacements.length >= 2
      ? monPlacements[monPlacements.length - 1].realDay - monPlacements[0].realDay
      : 0,
    insideGrandTour: monPlacements.filter(
      (m) => gtGameDaySpans.some((g) => m.gameDay >= g.first && m.gameDay <= g.last),
    ).length,
  };

  return {
    load, racesPerDay: racesOnDay.map((s) => s.size), days, density: D, overlapCap: cap, layoutMode, timelineLength,
    monuments,
    emptyDays: load.filter((x) => x === 0).length,
    underfilledDays: load.filter((x) => x < D).length,
    overlapDays: racesOnDay.map((s) => s.size).filter((n) => n >= 2).length,
    maxOverlap, overlapHistogram, straddleGameDays,
    gtRealDaySeparationViolations,
    daysWithoutDecision, daysWithoutDecisionCount: daysWithoutDecision.length,
  };
}

/**
 * @param {{ stageRaces?, oneDayRaces?, density?, days?, overlapCap?, spineMinStages?, seed? }} args
 *   Race-objekter i stageRaces/oneDayRaces kan bære en valgfri numerisk `seasonFraction`
 *   (0..1, jf. seasonPhaseProfiles.js/#3469) — bruges til fase-baseret placering. Mangler ÉT
 *   eller flere løb i en given liste den, falder pakkeren tilbage til den fraction-frie
 *   algoritme for netop den liste (bit-identisk med før #3469).
 *   GT-race-objekter (stages >= spineMinStages) kan desuden bære en valgfri numerisk
 *   `restDays` (0..3, jf. grandTourRestDays.js/#3470) — bruges KUN i STREAM's fase-ankrede
 *   GT-gren til at splitte GT'ens etaper i segmenter adskilt af hviledage fyldt med
 *   endagsløb. Udeladt/0 ⇒ bit-identisk med før #3470.
 * @returns {object} placements + diagnostik + `grandTourRestDays` — pr. GT-løb i STREAM's
 *   fase-ankrede gren: { id, name, stages, restDaysPlanned, restDaysFilled, fillerIds,
 *   degradedAfterStage }. Tom liste når ingen GT'er fik hviledage (BANDED, perGap-fallback,
 *   eller ingen GT'er med restDays>0).
 */
export function packLaneCalendar({
  stageRaces = [], oneDayRaces = [], density = 1, days = 28,
  overlapCap = 2, spineMinStages = 15,
} = {}) {
  const D = Math.max(1, density);
  const cap = Math.max(1, overlapCap);
  const monuments = oneDayRaces.filter((r) => r.race_class === "Monuments");
  const classics = oneDayRaces.filter((r) => r.race_class !== "Monuments");

  // Foretraek BANDED. Den opfylder begge kalender-invarianter VED KONSTRUKTION: hvert spor
  // laegger et loebs etaper paa loebsdage i traek (ejer-reglen 25/8), og loebsdag g = d*K + k
  // tilhoerer praecis een kalenderdato (#4236). Stream goer ingen af delene.
  //
  // #4236: monumenter blokerede tidligere banded, fordi B2/#4075 kraevede en EKSKLUSIV
  // loebsdag som banded ikke kan give. Den eksklusivitet er ophaevet (den leverede intet
  // efter #4217's spaend-binding og var eneste aarsag til hullerne), saa et monument er nu
  // en klassiker som alle andre - og D1 kan bruge banded.
  // #4236: EEN pakke-metode. layoutStream og layoutBanded er fjernet.
  //
  // De laa som fallback, men det var farligere end det saa ud: stream er praecis den der
  // SKABTE #4236 (real_day fra slot-positionen, game_day baaret fra eventet, intet band
  // imellem). Faldt vi tilbage til den, ville kalenderen stiltiende bryde baade
  // kronologi-reglen og een-dato-pr-loebsdag igen - uden at nogen opdagede det, fordi en
  // fallback ikke fejler.
  //
  // Kan pakningen ikke loeses, er det rigtige svar at sige det hoejt. En kalender der ikke
  // overholder reglerne er vaerre end ingen kalender: den opdages foerst tre uger inde i en
  // saeson, i resultater der ikke kan koeres om.
  const layoutMode = "contiguous";
  // Tomt input er ikke en fejl: ingen loeb -> ingen placeringer. Uden dette ville den
  // hoejlydte fejl nedenfor ramme den trivielle sti (fx en pulje uden katalog endnu).
  const res = (stageRaces.length + oneDayRaces.length) === 0
    ? { placements: [], timelineLength: 0 }
    : layoutContiguous({ stageRaces, classics, monuments, density: D, days, cap, spineMinStages });
  if (!res) {
    throw new Error(
      `raceCalendarLanePacker: ingen lovlig pakning for density=${D}, days=${days}, cap=${cap}, ` +
      `${stageRaces.length} etapeloeb + ${oneDayRaces.length} endagsloeb (${stageRaces.reduce((n, r) => n + lenOf(r), 0) + oneDayRaces.length} etaper mod ${D * days} pladser). ` +
      `Kalenderen er IKKE skrevet. Tjek kvoten: sum(etaper) skal vaere praecis density x days.`
    );
  }

  const placements = res.placements;
  const diag = diagnose(placements, days, D, cap, res.timelineLength, layoutMode, spineMinStages);

  const placedIds = new Set(placements.map((p) => p.id));
  return {
    placements,
    ...diag,
    unplaced: stageRaces.filter((r) => !placedIds.has(r.id)).map((r) => r.id),
    leftoverSingles: oneDayRaces.filter((r) => !placedIds.has(r.id)).map((r) => r.id),
    // #4203: true naar pakningen blev fundet MED monument-reglerne (R9-R11) aktive.
    // false betyder enten "ingen monumenter i denne division" eller "der fandtes ingen
    // lovlig pakning med reglerne, saa den kalender du ser her er anden-forsoeget".
    monumentRulesHeld: Boolean(res.monumentRulesHeld),
    // Skridt-forbrug pr. soegeforsoeg. Rent diagnostik: soegningen er den dyreste del af
    // pakningen, og et forsoeg der loeber toer ser ud som "ingen lovlig pakning".
    solveAttempts: res.solveAttempts ?? [],
    grandTourRestDays: res.gtRestDayReport ?? [], // #3470: dry-run-diagnostik (tom uden GT-hviledage)
  };
}
