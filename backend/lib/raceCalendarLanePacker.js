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

// B2 (#4075, spec §3.4, ejer-låst 21/8): monumenter har en NORMAL game_day i deres eget
// tidsslot — 100000-sentinelen (MONUMENT_GAMEDAY_BASE) er fjernet. Løbsdagen er EKSKLUSIV
// (ingen modløb på samme game_day, så alle ryttere kan stille op); andre løb må ligge i
// datoens øvrige slots. Se slot-konsumeringsloopet i layoutStream for konstruktionen.

const lenOf = (r) => Math.max(1, Number(r.stages) || 1);
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

// Fletter to lister jævnt (a typisk etapeløb, b klassikere) så b spredes ud mellem a.
function interleave(a, b) {
  const out = [];
  let ia = 0, ib = 0;
  for (let i = 0, n = a.length + b.length; i < n; i++) {
    const wantA = b.length === 0 || (a.length > 0 && ia / a.length <= ib / Math.max(1, b.length));
    if (wantA && ia < a.length) out.push(a[ia++]);
    else if (ib < b.length) out.push(b[ib++]);
    else if (ia < a.length) out.push(a[ia++]);
  }
  return out;
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
//
// Baandstoerrelsen er VARIABEL - en dato er faerdig naar den har D etaper. Fast K =
// ceil(D/cap) var for stift: en GT kunne da hoejst koere 2 etaper pr. dato, saa 18 etaper
// blev 9 datoer og tre GT'er kraevede 29 datoer ud af 28.
//
// Maalt mod prod-kataloget loeses alle fire divisioner med alle otte bindinger aktive
// (D1 paa 709 skridt / 3 ms). R8 er den stramme: den afskar 609 forsoeg i D1.
function solveContiguousStarts({ races, D, days, cap, spineMinStages, maxSteps = 20000000 }) {
  const items = races
    .map((race, i) => ({ i, race, fp: raceFootprint(race, spineMinStages), gt: spineMinStages != null && lenOf(race) >= spineMinStages }))
    .sort((a, b) => b.fp.length - a.fp.length || String(a.race.id).localeCompare(String(b.race.id)));

  if (items.reduce((n, it) => n + lenOf(it.race), 0) !== D * days) return null;

  const brugt = new Array(items.length).fill(false);
  const startAf = new Array(items.length).fill(-1);
  const bandSizes = [];
  let steps = 0;

  const dfs = (g, iBaand, dato, brugtIDato, gtIDato, aktive, restStages, gtStartDato, sidsteGtSlut) => {
    if (++steps > maxSteps) return false;
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
          // Loeb med identisk fodaftryk er ombyttelige i soegningen; identiteterne
          // paasaettes bagefter i fase-raekkefoelge. Springer dubletter over.
          if (k > 0 && !brugt[k - 1] && items[k].fp.length === items[k - 1].fp.length
              && items[k].gt === items[k - 1].gt && k - 1 >= fra) continue;
          if (items[k].gt) {
            if (gtAktiv || acc.some((x) => items[x].gt)) continue;                  // R6
            if (sidsteGtSlut != null && dato < sidsteGtSlut + 2) continue;          // R6
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

        let ok = false;
        if (datoFaerdig) {
          bandSizes.push(iBaand + 1);
          ok = dfs(g + 1, 0, dato + 1, 0, 0, efter, restStages - load, naesteGtStart, naesteGtSlut);
          if (!ok) bandSizes.pop();
        } else {
          ok = dfs(g + 1, iBaand + 1, dato, nyBrugt, gtNu, efter, restStages - load, naesteGtStart, naesteGtSlut);
        }
        if (ok) return true;
        for (const k of kombi) { brugt[k] = false; startAf[k] = -1; }
      }
    }
    return false;
  };

  if (!dfs(0, 0, 0, 0, 0, [], D * days, null, null)) return null;

  const dateOfGameDay = [];
  bandSizes.forEach((b, d) => { for (let i = 0; i < b; i++) dateOfGameDay.push(d); });
  return {
    dateOfGameDay,
    G: dateOfGameDay.length,
    placeringer: items.map((it, k) => ({ race: it.race, fp: it.fp, g0: startAf[k] })),
  };
}

function layoutContiguous({ stageRaces, classics, monuments, density: D, days, cap, spineMinStages }) {
  if (D < 1 || days < 1 || cap < 1) return null;
  const alle = [...stageRaces, ...classics, ...monuments];
  if (!alle.length) return null;

  const loest = solveContiguousStarts({ races: alle, D, days, cap, spineMinStages });
  if (!loest) return null;
  const { dateOfGameDay, G, placeringer } = loest;

  // Identiteterne paasaettes i fase-raekkefoelge inden for hver fodaftryks-klasse, saa et
  // loeb lander samme sted i saesonen som i virkeligheden (#3469). Uden seasonFraction
  // falder vi tilbage til byBigThenId - stadig deterministisk, ogsaa ved omvendt input.
  const grupper = new Map();
  for (const pl of placeringer) {
    const noegle = `${pl.fp.length}|${pl.fp.join("")}`;
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

  return { placements: [...placementsById.values()], timelineLength: G };
}

function layoutBanded({ stageRaces, classics, density: D, days, cap }) {
  if (D < 1 || days < 1) return null;
  const K = Math.ceil(D / cap);          // game-dage pr. IRL-dag
  const B = Math.floor(D / K);           // baseline-niveau (spor der dækker hele tidslinjen)
  const R = D - B * K;                    // ekstra overlay-events pr. IRL-dag (på R af de K game-dage)
  const T = K * days;                     // tidslinje-længde i game-dage
  if (B < 1) return null;
  const stageEvents = stageRaces.reduce((s, r) => s + lenOf(r), 0);
  if (stageEvents > B * T) return null;            // for mange etape-game-dage til baseline
  if (stageRaces.some((r) => lenOf(r) > T)) return null;
  const overlayCount = R * days;
  const baselineClassics = B * T - stageEvents;
  if (baselineClassics < 0) return null;
  if (classics.length !== baselineClassics + overlayCount) return null; // skal gå præcist op (kvote)

  // Bin-pack etapeloeb i B spor (kapacitet T).
  //
  // #4236: pakningen er nu EXACT med backtracking, ikke graadig mindst-brugte. Naar D1's
  // etaper fylder praecis B*T (120 af 120 - nul slack), skal partitionen ramme hvert spor
  // paa klingen; graadig fejler paa den slags og fik banded til at returnere null. Saa faldt
  // hele tieren tilbage til stream, som hverken giver kontiguitet eller een dato pr. loebsdag.
  // Med faa nok loeb pr. tier (12-17) er udtoemmende soegning med afskaering billig.
  //
  // Deterministisk: samme input -> samme partition (loeb sorteres byBigThenId foerst, og
  // sporene proeves i raekkefoelge med dublet-afskaering paa identisk `used`).
  const sorterede = [...stageRaces].sort(byBigThenId);
  const chains = Array.from({ length: B }, () => ({ items: [], used: 0 }));
  const pak = (i) => {
    if (i === sorterede.length) return true;
    const r = sorterede[i], L = lenOf(r);
    const proevet = new Set();
    for (let c = 0; c < B; c++) {
      if (chains[c].used + L > T) continue;
      if (proevet.has(chains[c].used)) continue; // spor med samme fyldning er ombyttelige
      proevet.add(chains[c].used);
      chains[c].items.push(r); chains[c].used += L;
      if (pak(i + 1)) return true;
      chains[c].items.pop(); chains[c].used -= L;
    }
    return false;
  };
  if (!pak(0)) return null;
  // Fyld hvert spor til T med baseline-klassikere. Rækkefølgen inden for sporet fase-sortéres
  // (se chain.seq nedenfor) når hele sporets etapeløb+klassikere har en date_text-fraction.
  // #3469-determinisme: `pool` kildes fra `classics` i RÅ input-rækkefølge (som før #3469) når
  // fraction mangler — bit-identisk fallback. Har ALLE klassikere fraction, sortéres poolen
  // kanonisk FØR splice-tildelingen pr. spor, så selve tildelingen (hvilket løb i hvilket
  // spor) bliver uafhængig af input-rækkefølgen (krav: samme resultat uanset input-rækkefølge
  // når fractions findes) i stedet for at hænge på hvilken rækkefølge oneDayRaces kom i.
  const pool = orderByPhase(classics) ?? [...classics];
  for (const chain of chains) {
    const fill = pool.splice(0, T - chain.used);
    chain.seq = orderByPhase([...chain.items, ...fill]) ?? interleave(chain.items, fill); // rækkefølge af race-objekter
  }
  const overlay = orderByPhase(pool) ?? pool; // resterende = overlayCount, fase-sorteret (#3469)

  // chainAt[c][g] = { race, stage_number } for game-dag g i spor c.
  const chainAt = chains.map((chain) => {
    const arr = new Array(T).fill(null);
    let g = 0;
    for (const race of chain.seq) {
      const L = lenOf(race);
      for (let k = 0; k < L; k++) { arr[g] = { race, stage_number: k + 1 }; g++; }
    }
    return arr;
  });

  // Komprimering: IRL-dag d = game-dage [d*K, d*K+K). Overlay på de første R game-dage i hver IRL-dag.
  const placementsById = new Map();
  const ensure = (race) => {
    if (!placementsById.has(race.id)) placementsById.set(race.id, { id: race.id, type: lenOf(race) > 1 ? "stage_race" : "single", race_class: race.race_class ?? null, stages: lenOf(race), startRealDay: Infinity, stagesPlaced: [] });
    return placementsById.get(race.id);
  };
  let oi = 0;
  for (let d = 0; d < days; d++) {
    let lane = 0;
    for (let k = 0; k < K; k++) {
      const g = d * K + k;
      for (let c = 0; c < B; c++) {
        const cell = chainAt[c][g];
        // Defensiv — bør aldrig ske (chains fyldes til nøjagtig T ved konstruktion), men en
        // fejl her skal fejle beskrivende, ikke som en rå TypeError (forberedelse til #3470).
        if (!cell) throw new Error(`raceCalendarLanePacker: banded chainAt[${c}][${g}] er tom (hul i spor) — packing-invariant brudt`);
        const p = ensure(cell.race);
        p.stagesPlaced.push({ stage_number: cell.stage_number, real_day: d, game_day: g, lane: lane++ });
        p.startRealDay = Math.min(p.startRealDay, d);
      }
      if (k < R && oi < overlay.length) {
        const race = overlay[oi++];
        const p = ensure(race);
        p.stagesPlaced.push({ stage_number: 1, real_day: d, game_day: g, lane: lane++ });
        p.startRealDay = Math.min(p.startRealDay, d);
      }
    }
  }
  const placements = [...placementsById.values()];
  for (const p of placements) p.stagesPlaced.sort((a, b) => a.stage_number - b.stage_number);
  return { placements, timelineLength: T };
}

// #3470 (supply-fix, ejer-krav 6/8 — samme fejlklasse som reservations-fasen i
// tierRaceSelection.js, jf. .claude/learnings/2026-08-06-garanti-uden-forsyning-blokerede-
// s3-kalenderen.md): reservér fillere FØR padding-loopet (target/ceiling-vandringen +
// slut-flush'en) forbruger rest-køen grådigt. Uden dette "vandt" den almindelige gap-
// fill/least-loaded-fordeling ofte ALLE endagsløb før GT'erne fik deres tur, så
// hviledagene degraderede selv når kataloget havde rigeligt med endagsløb (6/7 degraderet
// i dry-run mod prod-kataloget 6/8, kun 1/7 fyldt).
//
// Runde-baseret (round-robin i fase-rækkefølge over `gtsByPhase`): runde r reserverer
// GT'ens r'te hviledag (0-indekseret) FØR nogen GT får sin (r+1)'te — alle GT'er får
// dermed mindst én hviledag reserveret før nogen får to, når puljen er knap. Inden for
// én GT/runde vælges det endagsløb i `pool` hvis seasonFraction ligger TÆTTEST på GT'ens
// EGEN seasonFraction (proxy for hvor i sæsonen denne hviledag falder — GT'en har kun ÉT
// fase-anker, ikke ét pr. hviledag) — deterministisk tiebreak |Δfraction| → id.localeCompare.
// `pool` MUTERES (splice) — reserverede løb er dermed væk fra puljen kaldestedet iterer
// videre over. Returnerer Map<gt.id, race[]> (races i den rækkefølge GT'en skal bruge dem).
function reserveGrandTourFillers(gtsByPhase, pool) {
  const neededByGt = new Map(gtsByPhase.map((gt) => [
    gt.id,
    grandTourRestDayPositions({ stages: lenOf(gt), restDays: Number(gt.restDays) || 0 }).length,
  ]));
  const reservedByGt = new Map(gtsByPhase.map((gt) => [gt.id, []]));
  const maxNeeded = Math.max(0, ...neededByGt.values());

  for (let round = 0; round < maxNeeded; round++) {
    for (const gt of gtsByPhase) {
      if (round >= (neededByGt.get(gt.id) ?? 0)) continue;
      if (!pool.length) continue; // puljen tom — resten degraderer (rapporteret i placeGrandTourSegments)
      const target = Number.isFinite(gt.seasonFraction) ? gt.seasonFraction : 0.5;
      let bestIdx = 0;
      for (let j = 1; j < pool.length; j++) {
        const dj = Math.abs((Number.isFinite(pool[j].seasonFraction) ? pool[j].seasonFraction : 0.5) - target);
        const db = Math.abs((Number.isFinite(pool[bestIdx].seasonFraction) ? pool[bestIdx].seasonFraction : 0.5) - target);
        if (dj < db || (dj === db && String(pool[j].id).localeCompare(String(pool[bestIdx].id)) < 0)) bestIdx = j;
      }
      reservedByGt.get(gt.id).push(pool.splice(bestIdx, 1)[0]);
    }
  }
  return reservedByGt;
}

// #3470: placér ét GT's etaper i segmenter adskilt af hviledage — Option A (verificeret
// arkitektur-grundlag #3470): HUL i game_day, TÆT stage_number (1..N uafbrudt, ingen
// binding-lag rører etape-nummerering). `positions` er 1-indekserede etape-numre EFTER
// hvilke en hviledag indsættes (grandTourRestDayPositions). Hver hviledag fyldes med ét
// endagsløb fra `reserved` (RESERVERET til netop denne GT af reserveGrandTourFillers, FØR
// padding-loopet kørte — se dens docstring). Er `reserved` for kort (puljen slap op),
// DEGRADERES den manglende hviledag ærligt væk (GT'ens næste etape lægges umiddelbart
// efter i stedet — ingen tabte events), rapporteret i `restDayReport` (dry-run-
// diagnostik, #3470 punkt 3). restDays/positions tom ⇒ ét segment ⇒ bit-identisk med
// placeStream(0, gt) (før #3470).
function placeGrandTourSegments({ gt, positions, reserved, manualEvents, streamCursor, restDayReport }) {
  const total = lenOf(gt);
  const boundaries = [...positions, total];
  let stageNum = 1;
  let segStart = 0;
  let reservedIdx = 0;
  const fillerIds = [];
  const degradedAfterStage = [];
  for (const boundary of boundaries) {
    const segLen = boundary - segStart;
    const start = streamCursor[0];
    for (let k = 0; k < segLen; k++) {
      manualEvents.push({ race: gt, type: "stage_race", stage_number: stageNum, game_day: start + k, stream: 0 });
      stageNum++;
    }
    streamCursor[0] = start + segLen;
    segStart = boundary;
    if (boundary === total) break; // sidste segment — ingen hviledag efter sidste etape
    const filler = reservedIdx < reserved.length ? reserved[reservedIdx++] : null;
    if (filler) {
      const fStart = streamCursor[0];
      manualEvents.push({ race: filler, type: "single", stage_number: 1, game_day: fStart, stream: 0 });
      streamCursor[0] = fStart + 1;
      fillerIds.push(filler.id);
    } else {
      degradedAfterStage.push(boundary);
    }
  }
  restDayReport.push({
    id: gt.id, name: gt.name ?? null, stages: total,
    restDaysPlanned: positions.length, restDaysFilled: fillerIds.length,
    fillerIds, degradedAfterStage,
  });
}

// #3546 C: "mindst 1 afgørelse pr. D1-kalenderdag": en afgørelse er et endagsløb/monument
// ELLER en etapeløbs SLUTETAPE (stage_number === løbets samlede etapeantal).
const isDecisionEvent = (ev) => ev.type === "single" || ev.stage_number === lenOf(ev.race);

// Simulerer den PRÆCIS samme slot→dag-forbrugsrækkefølge som den endelige slot-
// konsumeringsloop i layoutStream (monSlot optager faste slots, events fylder resten
// sekventielt): UDEN at bygge placeringer. `chunkByDay[d]` = de `events`-array-INDEKSER
// (ikke race-id'er) der lander på kalenderdag d, i den rækkefølge de konsumeres.
function buildDayChunks(events, monSlot, days, D) {
  const dayOfIdx = new Array(events.length);
  const chunkByDay = Array.from({ length: days }, () => []);
  const monumentDay = new Array(days).fill(false);
  const totalSlots = days * D;
  let ei = 0;
  for (let slot = 0; slot < totalSlots; slot++) {
    const real_day = Math.floor(slot / D);
    if (monSlot.has(slot)) { monumentDay[real_day] = true; continue; }
    if (ei < events.length) { dayOfIdx[ei] = real_day; chunkByDay[real_day].push(ei); ei++; }
  }
  return { dayOfIdx, chunkByDay, monumentDay };
}

// Pr.-løb, stage_number-sorteret liste af { idx, stage_number }: bruges til at verificere
// at et bytte ALDRIG bryder et løbs interne etape-rækkefølge (nabo-etapernes dage skal
// forblive ikke-faldende omkring den flyttede etape).
function buildRacePositions(events) {
  const byRace = new Map();
  events.forEach((ev, idx) => {
    if (!byRace.has(ev.race.id)) byRace.set(ev.race.id, []);
    byRace.get(ev.race.id).push({ idx, stage_number: ev.stage_number });
  });
  for (const list of byRace.values()) list.sort((a, b) => a.stage_number - b.stage_number);
  return byRace;
}

// Kan positionen `idx`s event flyttes til array-POSITIONEN `newPos` uden at bryde dens EGET
// løbs interne etape-rækkefølge? STRENGT positions-baseret (ikke dag-baseret): array-
// positionen er selve kilden til BÅDE real_day OG lane (buildDayChunks konsumerer `events`
// i strengt stigende positions-orden), så en positions-check er den PRÆCISE, nødvendige OG
// tilstrækkelige betingelse: en dag-niveau-check (tidligere variant) tillod fejlagtigt to
// etaper af samme løb at lande på SAMME dag i forkert lane-rækkefølge (fundet i test:
// "et løbs etaper er real_day-monotone"). Naboerne skal forblive STRENGT omkring newPos  - 
// aldrig lig med (positioner er unikke pr. event).
function canMoveTo(idx, newPos, events, racePositions) {
  const ev = events[idx];
  const list = racePositions.get(ev.race.id);
  const pos = list.findIndex((e) => e.idx === idx);
  const prevPos = pos > 0 ? list[pos - 1].idx : -Infinity;
  const nextPos = pos < list.length - 1 ? list[pos + 1].idx : Infinity;
  return newPos > prevPos && newPos < nextPos;
}

// #3546 H (ejer-valgt 17/8 sen aften: spillerfeedback fandt samme strækningspatologi på
// ikke-GT-etapeløb som B fiksede for GT'erne): mål et løbs FULDE kalender-spænd (maks-min
// real_day over ALLE dets stagesPlaced-positioner), givet en HYPOTETISK positions-ændring
// for netop ÉN idx (til newPos): bruges til at afvise et C-bytte FØR det committes, hvis
// det ville strække løbet ud over det hårde loft. Rod-årsag verificeret ved instrumenteret
// dry-run: C's bytte-mekanisme (enforceDailyDecisions) flytter typisk et løbs FØRSTE etape
// (ingen "forrige"-nabo-begrænsning) eller SIDSTE etape (decision-donor-kandidat) langt væk
// for at dække en dag uden afgørelse et andet sted i kalenderen: sekventielt SIKKERT
// (canMoveTo tillader det), men skaber netop den strækningspatologi H retter (fx Tour du
// Massif Central målt 6 etaper over 14 dage FØR denne guard, 5 dage EFTER).
function raceSpanAfterMove(raceId, racePositions, dayOfIdx, movedIdx, newPos) {
  const list = racePositions.get(raceId);
  if (!list || list.length < 2) return 0; // endagsløb har intet "spænd"-koncept
  let lo = Infinity, hi = -Infinity;
  for (const e of list) {
    const day = e.idx === movedIdx ? dayOfIdx[newPos] : dayOfIdx[e.idx];
    if (day < lo) lo = day;
    if (day > hi) hi = day;
  }
  return hi - lo + 1;
}

// Hård grænse (#3546 H, ejer-beslutning 17/8 sen aften): stages + 3 dage. Målet (stages + 2)
// håndhæves IKKE hårdt her (ville afvise for mange ellers gyldige C-bytter og genskabe #3546
// C's egen "0 er umuligt uden katalog-ændring"-begrænsning): den HÅRDE grænse er hvad H
// eksplicit specificerede som constraint; stages+2 er target/rapporterings-niveau (scorecard
// måling 9), ikke en hård afvisnings-tærskel i selve bytte-logikken.
const NON_GT_STAGE_RACE_SPAN_HARD_SLACK = 3;

// Er et bytte af idx (tilhørende race) til newPos sikkert for #3546 H's spænd-grænse? Kun
// relevant for IKKE-GT etapeløb (2 <= stages < spineMinStages): endagsløb har intet spænd,
// GT'er er eksplicit undtaget ("ingen ændring for endagsløb/GT'er", H's egen specifikation).
function spanMoveOk(idx, newPos, events, racePositions, dayOfIdx, spineMinStages) {
  const race = events[idx].race;
  const stages = lenOf(race);
  if (stages < 2 || (spineMinStages != null && stages >= spineMinStages)) return true; // undtaget
  const span = raceSpanAfterMove(race.id, racePositions, dayOfIdx, idx, newPos);
  return span <= stages + NON_GT_STAGE_RACE_SPAN_HARD_SLACK;
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

// Flyt events[q] til position p (p < q) og skub p..q-1 een position frem.
// ROTATION, ikke bytte: alle loeb med etaper INDEN FOR [p, q-1] forskydes ENSARTET
// med +1, saa deres interne raekkefoelge bevares automatisk. Det er praecis det et
// parvist bytte IKKE kan - en GT's etaper optager et sammenhaengende positions-loeb,
// og en enkelt etape kan derfor hverken flyttes frem forbi sin efterfoelger eller
// tilbage forbi sin forgaenger. Rotationen skyder i stedet et ikke-GT-event IND i
// loebet, hvilket spreder GT'en over flere kalenderdage uden at nogen etape overhaler
// nogen anden.
function rotateInto(events, q, p) {
  const ev = events[q];
  for (let k = q; k > p; k--) events[k] = events[k - 1];
  events[p] = ev;
}
function rotateBack(events, p, q) {
  const ev = events[p];
  for (let k = p; k < q; k++) events[k] = events[k + 1];
  events[q] = ev;
}

// Fuld efterprOEvning af de invarianter en rotation kan true. Koeres EFTER hver
// kandidat-rotation; fejler den, rulles rotationen tilbage. Billigere at skrive
// eksplicit end at bevise for hvert enkelt tilfaelde - og det er netop den slags
// stille invariant-brud #3546's leverance C blev bidt af (GT'er der delte kalenderdag
// uden at nogen opdagede det).
function calendarInvariantsOk(events, monSlot, days, D, spineMinStages) {
  const { dayOfIdx, chunkByDay } = buildDayChunks(events, monSlot, days, D);

  // 1. #3472 v3: to GT'er deler ALDRIG en kalenderdag.
  for (const idxs of chunkByDay) {
    let gtId = null;
    for (const i of idxs) {
      const ev = events[i];
      if (lenOf(ev.race) < spineMinStages) continue;
      if (gtId === null) gtId = ev.race.id;
      else if (gtId !== ev.race.id) return false;
    }
  }

  // 2. Hvert loebs etaper er real_day-monotone, og ikke-GT-etapeloeb overskrider
  //    ikke #3546 H's haarde spaend-loft.
  for (const [, list] of buildRacePositions(events)) {
    let prev = -1;
    let lo = Infinity, hi = -Infinity;
    for (const e of list) {
      const d = dayOfIdx[e.idx];
      if (d == null) return false;
      if (d < prev) return false;
      prev = d;
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    const race = events[list[0].idx].race;
    const stages = lenOf(race);
    if (stages >= 2 && stages < spineMinStages && hi - lo + 1 > stages + NON_GT_STAGE_RACE_SPAN_HARD_SLACK) return false;
  }
  return true;
}

function enforceGrandTourDayCap(events, monSlot, days, D, spineMinStages, maxPerDay = MAX_GT_STAGES_PER_DAY) {
  if (!events.length || days < 1 || maxPerDay < 1 || spineMinStages == null) return;
  const isGt = (ev) => lenOf(ev.race) >= spineMinStages;
  if (!events.some(isGt)) return;

  // Soegevindue for rotations-donoren: hold indgrebet lokalt. Et event der rejser
  // langt ville flytte sin egen fase-placering markant uden gevinst.
  const WINDOW = 4 * D;

  // Hoejst een rotation pr. gennemloeb: hele dag-/positions-modellen genberegnes
  // derefter, saa canMoveTo aldrig ser forgaeldede positioner.
  for (let pass = 0; pass < events.length; pass++) {
    const { chunkByDay } = buildDayChunks(events, monSlot, days, D);
    const racePositions = buildRacePositions(events);

    const gtCountOn = (d) => chunkByDay[d].reduce((n, i) => n + (isGt(events[i]) ? 1 : 0), 0);
    let overfull = -1;
    for (let d = 0; d < days; d++) if (gtCountOn(d) > maxPerDay) { overfull = d; break; }
    if (overfull === -1) return; // maalet naaet

    // Den FOERSTE overskydende GT-etape paa dagen. Skydes et ikke-GT-event ind FOER
    // den, rykker den (og resten af GT'ens loeb) een slot frem - altsaa til naeste dag.
    const gtIdxs = chunkByDay[overfull].filter((i) => isGt(events[i]));
    const p = gtIdxs[maxPerDay];
    if (p == null) return;

    let rotated = false;
    for (let q = p + 1; q < Math.min(events.length, p + 1 + WINDOW); q++) {
      if (isGt(events[q])) continue;                       // donoren skal vaere et ikke-GT-event
      if (!canMoveTo(q, p, events, racePositions)) continue; // donorens egen etape-orden
      rotateInto(events, q, p);
      if (calendarInvariantsOk(events, monSlot, days, D, spineMinStages)) { rotated = true; break; }
      rotateBack(events, p, q);                            // uacceptabel: rul tilbage
    }
    // Ingen lovlig rotation: den resterende overfyldte dag rapporteres af diagnose()
    // i stedet for at blive tvunget igennem paa bekostning af en haard invariant.
    if (!rotated) return;
  }
}

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

function compactGrandTourSpans(events, monSlot, days, D, spineMinStages, maxSpan = MAX_GT_SPAN_DAYS, maxPerDay = MAX_GT_STAGES_PER_DAY) {
  if (!events.length || days < 1 || spineMinStages == null) return;
  const isGt = (ev) => lenOf(ev.race) >= spineMinStages;
  if (!events.some(isGt)) return;

  for (let pass = 0; pass < events.length; pass++) {
    const { dayOfIdx } = buildDayChunks(events, monSlot, days, D);
    const racePositions = buildRacePositions(events);

    // Find den bredeste GT der overskrider loftet.
    let vaerst = null;
    for (const [, list] of racePositions) {
      if (!isGt(events[list[0].idx])) continue;
      const dage = list.map((e) => dayOfIdx[e.idx]);
      const spaend = Math.max(...dage) - Math.min(...dage) + 1;
      if (spaend > maxSpan && (!vaerst || spaend > vaerst.spaend)) {
        vaerst = { spaend, first: list[0].idx, last: list[list.length - 1].idx };
      }
    }
    if (!vaerst) return; // alle GT-vinduer inden for loftet

    // Traek det FOERSTE ikke-GT-event inde i loebet ud og laeg det efter loebet.
    let komprimeret = false;
    for (let q = vaerst.first + 1; q < vaerst.last; q++) {
      if (isGt(events[q])) continue;
      for (let r = vaerst.last; r > q; r--) {
        if (!canMoveTo(q, r, events, racePositions)) continue;
        rotateBack(events, q, r);
        if (calendarInvariantsOk(events, monSlot, days, D, spineMinStages)
            && !anyDayOverGtCap(events, monSlot, days, D, spineMinStages, maxPerDay)) {
          komprimeret = true;
          break;
        }
        rotateInto(events, r, q); // rul tilbage
      }
      if (komprimeret) break;
    }
    if (!komprimeret) return; // ingen lovlig komprimering tilbage
  }
}

// Hjaelper: overskrider nogen kalenderdag GT-loftet? Bruges af fase 2 saa en
// komprimering aldrig genindfoerer den fejl fase 1 netop har fjernet.
function anyDayOverGtCap(events, monSlot, days, D, spineMinStages, maxPerDay) {
  const { chunkByDay } = buildDayChunks(events, monSlot, days, D);
  for (const idxs of chunkByDay) {
    let n = 0;
    for (const i of idxs) if (lenOf(events[i].race) >= spineMinStages) n++;
    if (n > maxPerDay) return true;
  }
  return false;
}


// #3546 C: placerings-prioritet: bytter array-POSITIONEN af to `events`-entries (ALDRIG
// deres game_day/stage_number/race-identitet) så en afgørelse lander på en dag der ellers
// ikke ville have nogen. Positionel, fordi dag-tildelingen (buildDayChunks) er en REN
// funktion af array-rækkefølgen: bytter man to positioner, bytter man hvilken dag de to
// events's OBJEKTER lander på, uden at røre game_day (bruges andetsteds: raceBinding.js  - 
// og skal forblive den oprindelige stream-cursor-position).
//
// Hvert kandidat-bytte verificeres FØR det committes: begge involverede løbs
// stagesPlaced-dage skal forblive ikke-faldende i stage_number (canMoveTo). Det gør
// byttet 100% sikkert for etapeløbs-sekventialitet, men betyder også at der IKKE findes en
// generel garanti: en dag hvis events UDELUKKENDE er mellemliggende (ikke-sidste) etaper
// af igangværende etapeløb, uden noget donor-bytte der består begge canMoveTo-tjek, kan
// forblive uden afgørelse. Det er BEVIDST (aldrig en tavs/urealistisk tvang) og rapporteres
// ærligt af diagnose()'s daysWithoutDecision i stedet for at blive gemt væk.
//
// Muterer `events` in-place (byttet er det eneste sted output ændres); ingen returværdi.
function enforceDailyDecisions(events, monSlot, days, D, spineMinStages) {
  if (!events.length || days < 1) return;
  const { dayOfIdx, chunkByDay, monumentDay } = buildDayChunks(events, monSlot, days, D);
  const racePositions = buildRacePositions(events);
  const decisionCountOf = (day) => chunkByDay[day].reduce((n, idx) => n + (isDecisionEvent(events[idx]) ? 1 : 0), 0);

  // #3546 C v2 (arkitekt-retur 17/8 aften: invarianten skal ramme 0, ikke kun forbedres):
  // FLERE PASSES over dagene, ikke kun én. Et bytte der lykkes for dag X kan ÅBNE en ny
  // sikker donor-mulighed for en dag Y der fejlede i et TIDLIGERE pass (fx X's nye donor-
  // status, eller en kæde af to bytter der hver isoleret var usikre). Bundet til `days`
  // gennemløb (langt mere end nogensinde nødvendigt: hvert gennemløb fjerner mindst ét
  // problem eller stopper, så det kan aldrig løkke uendeligt: se `anyFixedThisPass`-vagten).
  for (let pass = 0; pass < days; pass++) {
    let anyFixedThisPass = false;
    for (let d = 0; d < days; d++) {
      if (monumentDay[d] || decisionCountOf(d) > 0) continue; // allerede tilfredsstillet

      // Donor-dage sorteret efter nærhed (tættest først, lige afstand → lavest dagindeks)  -
      // minimerer hvor langt en afgørelse "rejser" væk fra sin oprindelige fase-placering.
      const donors = [];
      for (let d2 = 0; d2 < days; d2++) if (d2 !== d && decisionCountOf(d2) >= 2) donors.push(d2);
      donors.sort((a, b) => Math.abs(a - d) - Math.abs(b - d) || a - b);

      let fixed = false;
      for (const d2 of donors) {
        const decisionIdxs = chunkByDay[d2].filter((idx) => isDecisionEvent(events[idx]));
        for (const i of decisionIdxs) {
          for (const j of chunkByDay[d]) {
            // Samme løb på begge sider: udelukkes defensivt (positions-checket nedenfor
            // afviser det allerede korrekt i praksis, men eksplicit er billigere at læse).
            if (events[i].race.id === events[j].race.id) continue;
            // #3546 H-fund (regression opdaget under implementeringen, IKKE en del af H's
            // egen ask): et GT-løb er ALDRIG en bytte-kandidat, hverken som donor (i) eller
            // offer (j). canMoveTo alene sikrer kun GT'ens EGEN interne etape-rækkefølge  - 
            // den ved intet om #3472 v3's SEPARATE "ingen delt kalenderdag mellem to GT'er"-
            // garanti, som et bytte af en GT-etape kan bryde (verificeret: uden denne
            // udelukkelse delte 2 GT'er en kalenderdag, både i en test-fixture og mod det
            // ægte katalog). GT'er er allerede eksplicit undtaget spænd-tjekket (H's egen
            // "ingen ændring for GT'er"): denne udelukkelse er den samme undtagelse ført
            // konsekvent igennem til HELE swap-kandidaturen, ikke kun spænd-målingen.
            if (spineMinStages != null && (lenOf(events[i].race) >= spineMinStages || lenOf(events[j].race) >= spineMinStages)) continue;
            if (!canMoveTo(i, j, events, racePositions)) continue;
            if (!canMoveTo(j, i, events, racePositions)) continue;
            // #3546 H: afvis bytter der ville strække et ikke-GT-etapeløb ud over dets
            // hårde spænd-loft (stages+3): se spanMoveOk/raceSpanAfterMove ovenfor.
            if (!spanMoveOk(i, j, events, racePositions, dayOfIdx, spineMinStages)) continue;
            if (!spanMoveOk(j, i, events, racePositions, dayOfIdx, spineMinStages)) continue;
            // Commit: byt array-POSITIONERNE i/j. dayOfIdx pr. POSITION er uændret (i hører
            // stadig til dag d2, j til dag d): det er netop det der flytter events[i]s
            // OBJEKT til dag d og events[j]s OBJEKT til dag d2.
            const movedToD = events[i], movedToD2 = events[j];
            events[j] = movedToD;
            events[i] = movedToD2;
            const listA = racePositions.get(movedToD.race.id);
            const eA = listA.find((e) => e.idx === i);
            if (eA) eA.idx = j;
            const listB = racePositions.get(movedToD2.race.id);
            const eB = listB.find((e) => e.idx === j);
            if (eB) eB.idx = i;
            fixed = true;
            break;
          }
          if (fixed) break;
        }
        if (fixed) break;
      }
      if (fixed) anyFixedThisPass = true;
      // Intet sikkert bytte fundet: dagen forbliver uden afgørelse (se docstring ovenfor) -
      // MEDMINDRE et SENERE pass åbner en ny mulighed (derfor gentages hele scanningen).
    }
    if (!anyFixedThisPass) break; // fixpunkt nået: yderligere gennemløb ville ikke ændre noget
  }
}

// #3546 B v2 (arkitekt-retur 17/8 aften: B's GT-spredning skulle skalere med spine-
// længden, ikke kun med rå fraction): mindst-belastede stream, MEN med tie-break VÆK fra
// stream 0. Rod-årsag (fundet ved instrumenteret dry-run mod det ægte katalog): cursorerne
// starter [0,0,0,...], og en almindelig "første strengt mindre vinder"-tie-break
// favoriserer LAVESTE indeks: så "rest"-fyldet FØR hver GT's egen placering blev
// systematisk dumpet på stream 0, PRÆCIS den stream GT'en selv ligger på. Det skubbede
// GT'ens eget fodaftryk længere frem i dens EGEN game_day-rækkefølge OG sultede de ANDRE
// streams for indhold der reelt overlappede TIDSMÆSSIGT med GT'ens vindue: mindre
// samtidighed under GT'en, større kalender-spænd. Effekten var størst for den FØRSTE GT
// (ingen tidligere fyld til at bryde tien), hvilket matchede det målte mønster (Giro
// konsekvent længst spændt, uanset GT-etapeantal). Ren funktion: samme sikre invarianter
// som før (ceiling/cap er stadig kaldestedets ansvar); ændrer KUN hvilken stream der
// vælges ved præcis lige cursor-værdier, aldrig HVOR MEGET der fyldes.
export function pickLeastLoadedStreamAwayFromZero(streamCursor, cap) {
  let s = -1;
  for (let t = cap - 1; t >= 0; t--) {
    if (s === -1 || streamCursor[t] < streamCursor[s]) s = t;
  }
  return s;
}

// ---- STREAM: least-loaded på `cap` spor + game-dag-ordnet komprimering (håndterer GT + monumenter) ----
function layoutStream({ stageRaces, classics, monuments, density: D, days, cap, spineMinStages }) {
  const gts = stageRaces.filter((r) => lenOf(r) >= spineMinStages).sort(byBigThenId);
  let others = stageRaces.filter((r) => lenOf(r) < spineMinStages).sort(byBigThenId);
  const streamCursor = new Array(cap).fill(0);
  const raceSpan = new Map();
  const placeStream = (s, race) => { const start = streamCursor[s]; streamCursor[s] = start + lenOf(race); raceSpan.set(race.id, { start, len: lenOf(race), stream: s, race }); };
  const totalSlots = D * days; // #3469: flyttet op — GT-fase-ankeret skal kende totalSlots FØR placeringen.
  // #3470: GT-segmenters (etape- + filler-)events bygges MANUELT (bypasser raceSpan, som kun
  // understøtter ÉT sammenhængende span pr. race-id) og merges ind i `events` nedenfor.
  const manualEvents = [];
  const gtRestDayReport = [];

  // #3469: fase-sortér GT'erne TIDLIGT (før `rest` bygges): #3546 B's rebalancering af
  // `others` skal ske FØR interleave/merge med classics, men skal kun køre i den samme
  // fase-ankrede gren som resten af #3469/#3470-logikken nedenfor (gtsByPhase-check
  // genbruges 1:1, orderByPhase er ren/deterministisk → samme resultat begge steder).
  const gtsByPhaseEarly = gts.length ? orderByPhase(gts) : null;
  if (gtsByPhaseEarly) others = balanceStageRaceFractionAcrossGtWindows(gtsByPhaseEarly, others);

  // #3469: fase-sortér rest-løbene (fylder ikke-GT-strømmen) når alle har en date_text-
  // fraction; ellers uændret jævn fletning (bit-identisk med før #3469).
  const rest = orderByPhase([...others, ...classics]) ?? interleave(others, classics);

  if (gts.length) {
    // #3469: GT'er fase-ankres til et target-startslot på stream 0 i stedet for jævnt
    // perGap-fyld — MEN kun når ALLE GT'er har en numerisk fraction; ellers uændret gammel
    // perGap-algoritme (bit-identisk fallback). Non-overlap er STRUKTUREL i begge grene
    // (samme cursor, stream 0, sekventiel placering). #3470: hviledage placeres KUN i denne
    // (fase-ankrede) gren — perGap-fallback-grenen nedenfor er UÆNDRET/bit-identisk, for uden
    // date_text kan hviledags-antallet alligevel ikke udledes.
    const gtsByPhase = gtsByPhaseEarly; // #3546 B: allerede beregnet ovenfor (samme rene funktion → samme resultat)
    if (gtsByPhase) {
      // #3470 (supply-fix, ejer-krav 6/8 — samme fejlklasse som reservations-fasen i
      // tierRaceSelection.js): reservér fillere FØR padding-loopet nedenfor forbruger
      // rest-køen grådigt — se reserveGrandTourFillers' docstring. Reservationen opererer
      // på en KOPI af de endagsløb i `rest` (single-day, lenOf===1); de FAKTISK reserverede
      // fjernes derefter fra `rest` selv, så padding-loopet (og slut-flush'en) aldrig kan
      // genbruge dem. Rækkefølgen/mængden af events er UÆNDRET — kun HVILKE konkrete løb
      // der lander i hullerne, flyttes tidligere.
      const singleDayPool = rest.filter((r) => lenOf(r) === 1);
      const reservedByGt = reserveGrandTourFillers(gtsByPhase, singleDayPool);
      const reservedIds = new Set([...reservedByGt.values()].flat().map((r) => r.id));
      if (reservedIds.size) {
        for (let j = rest.length - 1; j >= 0; j--) if (reservedIds.has(rest[j].id)) rest.splice(j, 1);
      }

      // #3472 (ejer-feedback på PR #3472, 6/8): v1 fyldte KUN stream 0 mod hvert GT-target,
      // hvilket gjorde stream 0 meget lang mens stream 1-2 forblev korte og "løb tør" tidligt
      // i game_day-rummet — sene dele af sæsonen blev derfor næsten enkelt-sporede (D1
      // overlapDays faldt 21→16, målt med diagnose()). Fix (ejer-anvist formel): rest-fyldet
      // fordeles LEAST-LOADED over ALLE streams (også stream 0) under hele fremdriften mod
      // targetSlot — streams skrider dermed jævnt frem sammen, og GT-perioderne forbliver
      // overlap-tunge som resten af sæsonen. `placedCount` (summen af events på ALLE streams,
      // inkl. tidligere GT'er) er progress-proxyen mod targetSlot — IKKE streamCursor[0]
      // alene (ejer: "det samlede event-antal er den rigtige proxy for GT'ens slot-position
      // når streams skrider jævnt frem"). Målt (dry-run --plan 3, rigtigt katalog): D1
      // overlapDays 16→22 (≥21-kravet), maxOverlap forbliver ≤ cap. GT-positionerne rammer
      // stadig korrekt rækkefølge og er i samme størrelsesorden som v1 (se PR-body/baseline-
      // filen for de fulde tal — en afprøvet alternativ variant med streamCursor[0] som
      // stop-betingelse gav VÆRRE præcision OG lavere overlap, så den blev forkastet).
      // #3472 v3 (ejer-fund 6/8, anden runde): game_day-non-overlap på stream 0 garanterer
      // IKKE at GT'erne også får disjunkte KALENDERDAGE (real_day) — flere spor interleaves
      // ind i samme real_day ved slot-komprimeringen (real_day = floor(slot/D)). ROD-ÅRSAG
      // (fundet ved afprøvning mod det rigtige katalog): least-loaded-fyldet vælger PR.
      // DEFINITION den mindst belastede stream — lige efter en GT ligger stream 0 ALTID
      // FORAN 1-2, så alt "gulv"-fyld (uanset hvor højt targettet sættes) lander på 1-2 og
      // BACKFILLER deres LAVERE game_day-værdier — det rykker ALDRIG stream 0's egen cursor
      // og skaber derfor INGEN game_day-afstand til den næste GT (som starter PRÆCIS ved
      // stream 0's cursor). To forsøg der byggede videre på targettet alene (placedCount- og
      // "leveling"-baserede gulve) ændrede derfor reelt IKKE noget — GT'erne forblev ryg-mod-
      // ryg i game_day (fx Giro 13-33, Tour 34-54, ZERO game_day-mellemrum) og delte dermed
      // kalenderdag uanset gulvets størrelse.
      //
      // Fix: et LILLE, EKSPLICIT stream-0-KUN buffer (GT_SEPARATION_BUFFER_DAYS×D events)
      // placeres FØRST, ligeglad med least-loaded, umiddelbart efter forrige GT — dette er
      // den ENESTE måde at reelt rykke stream 0's cursor (og dermed GT'ens game_day-position)
      // fremad. Resten af fremdriften mod fase-targettet forbliver least-loaded over ALLE
      // streams som før (bevarer #3472-overlap-fixet). Bufferet er sat til det HÅRDE minimum
      // (1×D — garanterer netop "aldrig delt dag", ikke nødvendigvis en tom bufferdag) fordi
      // afprøvning viste at et større buffer (2×D, "1 tom dags luft") kostede uforholdsmæssigt
      // meget overlap på tier 1's konkrete (sparsomme) restløbs-udvalg — se måletal i
      // PR-body/baseline-filen. Separations-bufferet har PRIORITET over fase-præcision (ejer:
      // "ingen delt dag > præcist anker") — men taber til ceiling-garantien (ingen tabte
      // events/overskredet totalSlots er stadig hårdt): når rest-køen løber tør eller ceiling
      // ikke levner plads, placeres GT'en så tæt på som muligt, og en ÆGTE efter-hånden-
      // verifikation i diagnose()'s gtRealDaySeparationViolations rapporterer det i stedet
      // for at fejle stille.
      // #3470: GT'ens fodaftryk på stream 0 er nu lenOf(gt) + restDays (etaper + hviledage
      // fyldt af fillere), IKKE bare lenOf(gt) — target/ceiling-aritmetikken (og placedCount-
      // fremdriften) bruger footprintOf overalt hvor gt's EGEN plads regnes, så clampen
      // stadig garanterer stream 0 aldrig overskrider totalSlots (SÆRLIGT vigtigt her: uden
      // footprintOf ville separations-bufferet + fase-targettet reservere for LIDT plads til
      // en GT med hviledage, og stream0Ceiling-clampen kunne skære fillere væk unødigt).
      const GT_SEPARATION_BUFFER_DAYS = 1; // 1×D ⇒ hårdt minimum (aldrig delt dag); se overlap-afvejning i kommentar ovenfor
      const footprintOf = (g) => lenOf(g) + (Number(g.restDays) || 0);
      let remainingGtLen = gtsByPhase.reduce((s, g) => s + footprintOf(g), 0); // inkl. DENNE gt, dekrementeres i slutningen af hver iteration
      let ri = 0;
      let placedCount = 0;
      let requiredStream0Buffer = 0; // intet buffer-krav før den FØRSTE gt (ingen forrige at holde afstand til)
      for (const gt of gtsByPhase) {
        const ceiling = totalSlots - remainingGtLen;
        // stream0Ceiling = samme loft, men som en HARD clamp på stream 0's EGEN cursor (den
        // eneste stream der bærer GT'er sekventielt) — bevarer #3469's oprindelige
        // clamp-garanti selvom fyldet nu spredes over alle streams.
        const stream0Ceiling = ceiling;

        // Trin 1: eksplicit stream-0-KUN buffer (separations-krav fra FORRIGE gt, om nogen).
        // Vælger det MINDST OVERSKYDENDE tilgængelige løb (helst præcis passende) frem for
        // blot næste i fase-rækkefølgen — et vilkårligt stort flerdags-løb her ville overskyde
        // bufferet unødigt og koste ekstra overlap-dage til ingen nytte (målt: reducerer
        // overskridelsen mærkbart uden at ændre overlap-invarianten). Løbet fjernes fra `rest`
        // (splice) uanset position ≥ ri — resten bevarer sin fase-rækkefølge til trin 2.
        let stream0Buffered = 0;
        while (stream0Buffered < requiredStream0Buffer) {
          let bestIdx = -1, bestLen = Infinity;
          for (let i = ri; i < rest.length; i++) {
            const l = lenOf(rest[i]);
            if (streamCursor[0] + l > stream0Ceiling) continue; // ceiling-garantien er hård
            const need = requiredStream0Buffer - stream0Buffered;
            if (l <= need && l < bestLen) { bestLen = l; bestIdx = i; if (l === need) break; }
          }
          if (bestIdx === -1) {
            // intet passer uden at overskyde bufferet (eller ceiling) — tag det mindste
            // tilgængelige for at minimere overskridelsen, i stedet for at give helt op.
            for (let i = ri; i < rest.length; i++) {
              const l = lenOf(rest[i]);
              if (streamCursor[0] + l > stream0Ceiling) continue;
              if (l < bestLen) { bestLen = l; bestIdx = i; }
            }
          }
          if (bestIdx === -1) break; // intet kan placeres uden at overskride ceiling
          const [item] = rest.splice(bestIdx, 1);
          placeStream(0, item);
          stream0Buffered += lenOf(item);
          placedCount += lenOf(item);
        }

        // Trin 2: fase-target ≈ fraction × (totalSlots − resterende GT-fodaftryk INKL. denne)
        // — fyldes LEAST-LOADED over alle streams (bevarer overlap, jf. #3472 runde 1).
        // #3546 H-forsøg (ejer-mål samme aften, "Giroen ≤9, helst ≤8 dage"): et forsøg på at
        // skalere den FØRSTE GT's target opad (empirisk sweep, faktor 2,3-3,0 gav Giro-spænd
        // 10→7) blev AFPRØVET og FORKASTET: det brød #3472 v3's GT-real-day-separations-
        // invariant (2 GT'er delte kalenderdag, verificeret BÅDE i test-fixturen og mod det
        // ægte katalog: "gt-1 slutter dag 19, gt-2 starter dag 19"). Denne invariant er en
        // HÅRD, ikke-forhandlingsbar garanti (#3472 v3, "ingen delt dag > præcist anker").
        // IKKE forsøgt yderligere her: se scorecardets "Fund og begrænsninger" for det
        // fulde forsøgs-referat + tal. target-formlen er derfor UÆNDRET fra B v2.
        const target = Math.min(ceiling, Math.max(placedCount, Math.round(gt.seasonFraction * (totalSlots - remainingGtLen))));
        while (ri < rest.length && placedCount < target) {
          let s = pickLeastLoadedStreamAwayFromZero(streamCursor, cap);
          if (s === 0 && streamCursor[0] + lenOf(rest[ri]) > stream0Ceiling) {
            let alt = -1;
            for (let t = 1; t < cap; t++) if (alt === -1 || streamCursor[t] < streamCursor[alt]) alt = t;
            if (alt === -1) break; // cap===1 (ingen alternativ stream) — usædvanligt, men undgå uendelig løkke.
            s = alt;
          }
          placeStream(s, rest[ri]);
          placedCount += lenOf(rest[ri]);
          ri++;
        }
        // #3470: GT'en placeres nu i segmenter adskilt af RESERVEREDE hviledags-fillere
        // (placeGrandTourSegments) i stedet for placeStream(0, gt) direkte — men bidrager
        // stadig KUN til stream 0 (samme sekventielle GT-rygrad-invariant som før #3470, og
        // samme stream separations-bufferet holder afstand til).
        // placedCount opdateres med den FAKTISKE fremdrift på stream 0 (etaper + evt.
        // fyldte hviledage — degraderede hviledage lægger IKKE beslag på en slot), læst
        // som streamCursor[0]-deltaet, så en degraderet hviledag ikke overvurderer
        // fremdriften mod senere GT'ers target-beregning.
        const positions = grandTourRestDayPositions({ stages: lenOf(gt), restDays: Number(gt.restDays) || 0 });
        const gtStreamStart = streamCursor[0];
        placeGrandTourSegments({ gt, positions, reserved: reservedByGt.get(gt.id) ?? [], manualEvents, streamCursor, restDayReport: gtRestDayReport });
        placedCount += streamCursor[0] - gtStreamStart;
        remainingGtLen -= footprintOf(gt); // klar til NÆSTE gt's target-beregning (nu ekskl. denne)
        requiredStream0Buffer = GT_SEPARATION_BUFFER_DAYS * D; // gælder NÆSTE gt (0 hvis der ikke er flere)
      }
      for (; ri < rest.length; ri++) { placeStream(pickLeastLoadedStreamAwayFromZero(streamCursor, cap), rest[ri]); }
    } else {
      const perGap = Math.floor(Math.floor(rest.length / 2) / gts.length);
      let ri = 0;
      gts.forEach((gt) => { placeStream(0, gt); for (let k = 0; k < perGap && ri < rest.length; k++) placeStream(0, rest[ri++]); });
      for (; ri < rest.length; ri++) { let s = 0; for (let t = 1; t < cap; t++) if (streamCursor[t] < streamCursor[s]) s = t; placeStream(s, rest[ri]); }
    }
  } else {
    for (const race of rest) { let s = 0; for (let t = 1; t < cap; t++) if (streamCursor[t] < streamCursor[s]) s = t; placeStream(s, race); }
  }
  const timelineLength = Math.max(0, ...streamCursor);

  // Events ordnet efter game-dag, så spor (stabil). #3470: manualEvents (GT-segmenter +
  // fillere) merges ind FØR sort — sorteringen (game_day → stream → race.id → stage_number)
  // gør endeligt rækkefølge uafhængig af hvornår hvert event blev pushet.
  const events = [];
  for (const { start, len, stream, race } of raceSpan.values()) {
    const type = len > 1 ? "stage_race" : "single";
    for (let k = 0; k < len; k++) events.push({ race, type, stage_number: k + 1, game_day: start + k, stream });
  }
  events.push(...manualEvents);
  events.sort((a, b) => a.game_day - b.game_day || a.stream - b.stream || String(a.race.id).localeCompare(String(b.race.id)) || a.stage_number - b.stage_number);

  // #3469: monumenter fase-ankres (slot ≈ fraction × (totalSlots-1)) + den eksisterende
  // kollisionsvandring, KUN når ALLE monumenter har en numerisk fraction; ellers uændret
  // jævn stepF-spredning (bit-identisk med før #3469). Map slot→løb (i stedet for det gamle
  // Set + ordinal-opslag i `monuments`) gør slot-tildelingen eksplicit i begge grene.
  const monSlot = new Map();
  if (monuments.length) {
    const monByPhase = orderByPhase(monuments);
    if (monByPhase) {
      for (const m of monByPhase) {
        let slot = Math.min(totalSlots - 1, Math.max(0, Math.round(m.seasonFraction * (totalSlots - 1))));
        while (monSlot.has(slot)) slot = (slot + 1) % totalSlots;
        monSlot.set(slot, m);
      }
    } else {
      const stepF = totalSlots / monuments.length;
      for (let i = 0; i < monuments.length; i++) {
        let slot = Math.min(totalSlots - 1, Math.floor(i * stepF + stepF / 2));
        while (monSlot.has(slot)) slot = (slot + 1) % totalSlots;
        monSlot.set(slot, monuments[i]);
      }
    }
  }

  // #3546 C: mindst 1 AFGØRELSE (endagsløb/monument ELLER etapeløbs-SLUTETAPE) pr.
  // kalenderdag: se enforceDailyDecisions' docstring. Kører EFTER events er sorteret og
  // monSlot kendt (monument-dage tæller automatisk som en afgørelse), FØR slot-
  // konsumeringsloopet nedenfor fordeler dem til real_day.
  // #4103: GT-dagsformen foerst (ren GT<->ikke-GT-bytning), derefter afgoerelses-
  // daekningen. Raekkefoelgen er bevidst: enforceDailyDecisions udelukker GT'er fra HELE
  // sit bytte-kandidatur (#3546 C-fixet), saa den kan hverken flytte en GT-etape tilbage
  // eller aendre GT-antallet pr. dag - men den KAN reparere en afgoerelses-daekning som
  // GT-omfordelingen maatte have forstyrret. Omvendt raekkefoelge ville ikke kunne det.
  enforceGrandTourDayCap(events, monSlot, days, D, spineMinStages);
  compactGrandTourSpans(events, monSlot, days, D, spineMinStages);
  enforceDailyDecisions(events, monSlot, days, D, spineMinStages);

  const placementsById = new Map();
  const ensure = (race, type, stages) => { if (!placementsById.has(race.id)) placementsById.set(race.id, { id: race.id, type, race_class: race.race_class ?? null, stages, startRealDay: Infinity, stagesPlaced: [] }); return placementsById.get(race.id); };

  // #4236 (ejer-beslutning 25/8): monumentet DELER loebsdag i stedet for at faa sin egen.
  //
  // B2 (#4075, 21/8) gav monumentet en EKSKLUSIV game_day skudt ind i sekvensen, saa ingen
  // rytter var bundet andetsteds og alle kunne stille op. Indskuddet forskoed alle senere
  // events, og ramte taerskelen midt i et igangvaerende etapeloeb, rev det hul i loebets
  // loebsdage: Tour du Hedjaz fik 9,10,11,13,14. To monumenter ramte fem D1-etapeloeb.
  //
  // Ejer-reglen 25/8: "hvis et loeb har fire etaper, skal loebsdagene ligge i traek.
  // Ligesom i virkeligheden." Den slaar eksklusiviteten, og det koster ingenting, fordi
  // eksklusiviteten holdt op med at virke da #4217 gjorde bindingen spaend-baseret 24 timer
  // foer: rytteren er bundet HELE etapeloebets spaend, ogsaa henover monumentets loebsdag.
  // Maalt mod prod: 0 delte ryttere i alle 9 monument/etapeloeb-kombinationer. Gevinsten var
  // vaek, hullerne blev betalt alligevel.
  //
  // Monumentet beholder sit SLOT (og dermed sin kalenderdato og sin spredning over saesonen);
  // kun den eksklusive loebsdag falder bort. Det faar en EKSISTERENDE loebsdag paa sin egen
  // kalenderdato, saa der hverken indskydes et nyt tal (ingen huller) eller spaendes over to
  // datoer (#4236). Blandt dagens loebsdage vaelges den mindst belastede, og kun en med plads
  // under overlap-cap'en - saa monumentet aldrig selv braender cap'en.
  const slotAssignments = [];
  let ei = 0;
  for (let slot = 0; slot < totalSlots; slot++) {
    if (monSlot.has(slot)) { slotAssignments.push({ monument: monSlot.get(slot), slot }); continue; }
    if (ei < events.length) slotAssignments.push({ event: events[ei++], slot });
  }

  // Pas 1: de almindelige events. game_day baeres uaendret med - ingen forskydning.
  for (const a of slotAssignments) {
    if (a.monument) continue;
    const real_day = Math.floor(a.slot / D), lane = a.slot % D;
    const p = ensure(a.event.race, a.event.type, lenOf(a.event.race));
    p.stagesPlaced.push({ stage_number: a.event.stage_number, real_day, game_day: a.event.game_day, lane });
    p.startRealDay = Math.min(p.startRealDay, real_day);
  }

  // To opslag, og forskellen er vigtig: kandidaterne skal ligge paa monumentets EGEN
  // kalenderdato (ellers spaender loebsdagen over to datoer), men cap'en taeller loeb pr.
  // LOEBSDAG paa tvaers af hele puljen. Talte man kun pr. dato, ville en loebsdag der i
  // forvejen straekker sig over flere datoer se ledig ud og cap'en braende.
  const gameDaysOnDate = new Map(); // real_day -> Set(game_day)
  const raceCountByGameDay = new Map(); // game_day -> Set(race_id)
  for (const p of placementsById.values()) {
    for (const st of p.stagesPlaced) {
      if (!gameDaysOnDate.has(st.real_day)) gameDaysOnDate.set(st.real_day, new Set());
      gameDaysOnDate.get(st.real_day).add(st.game_day);
      if (!raceCountByGameDay.has(st.game_day)) raceCountByGameDay.set(st.game_day, new Set());
      raceCountByGameDay.get(st.game_day).add(p.id);
    }
  }

  // Pas 2: monumenterne. Mindst belastede loebsdag paa dagen, med plads under cap'en.
  //
  // Raekkefoelgen er MEST BEGRAENSEDE FOERST (faerrest ledige loebsdage paa sin dato), ikke
  // slot-orden. Slot-orden koerte sig fast: et tidligt monument tog den sidste ledige plads
  // paa en dato et senere monument var noedt til at bruge, og fallbacken maatte saa indskyde
  // en ny loebsdag - hvilket river hul praecis som B2 gjorde. Med mest-begraenset-foerst
  // rammer fallbacken ikke i den nuvaerende kalender.
  const monumentSlots = slotAssignments.filter((a) => a.monument).sort((a, b) => {
    const ledige = (x) => [...(gameDaysOnDate.get(Math.floor(x.slot / D)) ?? [])]
      .filter((g) => (raceCountByGameDay.get(g)?.size ?? 0) < cap).length;
    return ledige(a) - ledige(b) || a.slot - b.slot;
  });
  for (const a of monumentSlots) {
    const real_day = Math.floor(a.slot / D), lane = a.slot % D;
    const kandidater = [...(gameDaysOnDate.get(real_day) ?? [])]
      .sort((x, y) => (raceCountByGameDay.get(x)?.size ?? 0) - (raceCountByGameDay.get(y)?.size ?? 0) || x - y);
    let valgt = kandidater.find((g) => (raceCountByGameDay.get(g)?.size ?? 0) < cap) ?? null;

    // Ingen loebsdag paa dagen med plads under cap'en: giv monumentet sin egen, indskudt
    // EFTER dagens hoejeste. Et indskud i enden forskyder ingen og river derfor ikke hul
    // i et igangvaerende etapeloeb - i modsaetning til B2's indskud midt i sekvensen.
    if (valgt == null) valgt = kandidater.length ? Math.max(...kandidater) + 0.5 : 0;

    const p = ensure(a.monument, "single", 1);
    p.stagesPlaced.push({ stage_number: 1, real_day, game_day: valgt, lane });
    p.startRealDay = Math.min(p.startRealDay, real_day);
    if (!gameDaysOnDate.has(real_day)) gameDaysOnDate.set(real_day, new Set());
    gameDaysOnDate.get(real_day).add(valgt);
    if (!raceCountByGameDay.has(valgt)) raceCountByGameDay.set(valgt, new Set());
    raceCountByGameDay.get(valgt).add(p.id);
  }

  const placements = [...placementsById.values()];

  // De halve loebsdage fra fallback-grenen ovenfor normaliseres til heltal. Rangordenen
  // bevares, saa kronologien er uroert; kun nummereringen bliver hel igen.
  const alle = [...new Set(placements.flatMap((p) => p.stagesPlaced.map((s) => s.game_day)))].sort((x, y) => x - y);
  if (alle.some((g) => !Number.isInteger(g))) {
    const remap = new Map(alle.map((g, i) => [g, i]));
    for (const p of placements) for (const st of p.stagesPlaced) st.game_day = remap.get(st.game_day);
  }

  for (const p of placements) p.stagesPlaced.sort((a, b) => a.stage_number - b.stage_number);
  const distinkte = new Set(placements.flatMap((p) => p.stagesPlaced.map((s) => s.game_day))).size;
  return { placements, timelineLength: Math.max(timelineLength, distinkte), gtRestDayReport };
}

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

  return {
    load, racesPerDay: racesOnDay.map((s) => s.size), days, density: D, overlapCap: cap, layoutMode, timelineLength,
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
  // #4236: kontiguitets-layoutet foerst - det eneste der garanterer BEGGE invarianter med
  // den komposition spillet faktisk oensker. Banded og stream bevares som fallback, saa en
  // tier hvor soegningen ikke konvergerer stadig faar en kalender.
  let layoutMode = "contiguous";
  let res = layoutContiguous({ stageRaces, classics, monuments, density: D, days, cap, spineMinStages });
  if (!res) { layoutMode = "banded"; res = layoutBanded({ stageRaces, classics: [...classics, ...monuments], density: D, days, cap }); }
  if (!res) { layoutMode = "stream"; res = layoutStream({ stageRaces, classics, monuments, density: D, days, cap, spineMinStages }); }

  const placements = res.placements;
  const diag = diagnose(placements, days, D, cap, res.timelineLength, layoutMode, spineMinStages);

  const placedIds = new Set(placements.map((p) => p.id));
  return {
    placements,
    ...diag,
    unplaced: stageRaces.filter((r) => !placedIds.has(r.id)).map((r) => r.id),
    leftoverSingles: oneDayRaces.filter((r) => !placedIds.has(r.id)).map((r) => r.id),
    grandTourRestDays: res.gtRestDayReport ?? [], // #3470: dry-run-diagnostik (tom uden GT-hviledage)
  };
}
