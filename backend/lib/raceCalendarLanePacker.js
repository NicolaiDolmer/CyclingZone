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

import { grandTourRestDayPositions } from "./grandTourRestDays.js";

export const MONUMENT_GAMEDAY_BASE = 100000;

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

  // Bin-pack etapeløb i B spor (FFD, kapacitet T).
  const chains = Array.from({ length: B }, () => ({ items: [], used: 0 }));
  for (const r of [...stageRaces].sort(byBigThenId)) {
    let best = -1;
    for (let c = 0; c < B; c++) if (chains[c].used + lenOf(r) <= T && (best === -1 || chains[c].used < chains[best].used)) best = c;
    if (best === -1) return null;
    chains[best].items.push(r);
    chains[best].used += lenOf(r);
  }
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
  enforceDailyDecisions(events, monSlot, days, D, spineMinStages);

  const placementsById = new Map();
  const ensure = (race, type, stages) => { if (!placementsById.has(race.id)) placementsById.set(race.id, { id: race.id, type, race_class: race.race_class ?? null, stages, startRealDay: Infinity, stagesPlaced: [] }); return placementsById.get(race.id); };
  let ei = 0, monGameDay = MONUMENT_GAMEDAY_BASE;
  for (let slot = 0; slot < totalSlots; slot++) {
    const real_day = Math.floor(slot / D), lane = slot % D;
    if (monSlot.has(slot)) {
      const m = monSlot.get(slot);
      const p = ensure(m, "single", 1);
      p.stagesPlaced.push({ stage_number: 1, real_day, game_day: monGameDay++, lane }); p.startRealDay = Math.min(p.startRealDay, real_day);
      continue;
    }
    if (ei < events.length) {
      const ev = events[ei++];
      const p = ensure(ev.race, ev.type, lenOf(ev.race));
      p.stagesPlaced.push({ stage_number: ev.stage_number, real_day, game_day: ev.game_day, lane }); p.startRealDay = Math.min(p.startRealDay, real_day);
    }
  }
  const placements = [...placementsById.values()];
  for (const p of placements) p.stagesPlaced.sort((a, b) => a.stage_number - b.stage_number);
  return { placements, timelineLength, gtRestDayReport };
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
  const gameDaysByPlacement = placements
    .filter((p) => p.stagesPlaced.every((s) => s.game_day < MONUMENT_GAMEDAY_BASE))
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
    if (st.game_day >= MONUMENT_GAMEDAY_BASE) continue;
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
  // havende en afgørelse hvis MINDST ét stagesPlaced-element den dag enten er et
  // monument/endagsløb (game_day ≥ MONUMENT_GAMEDAY_BASE) eller løbets sidste etape
  // (stage_number === p.stages).
  const decisionDaySet = new Set();
  for (const p of placements) {
    for (const st of p.stagesPlaced) {
      const isDecision = st.game_day >= MONUMENT_GAMEDAY_BASE || st.stage_number === (p.stages ?? 1);
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

  // Foretræk BANDED (straddle-fri blanding) når ingen monumenter; ellers STREAM.
  let layoutMode = "banded";
  let res = monuments.length === 0 ? layoutBanded({ stageRaces, classics, density: D, days, cap }) : null;
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
