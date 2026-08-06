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

// #3470: tag det NÆSTE endagsløb (lenOf===1) fra `rest`, søgt FRA index `ri` (elementer
// FØR ri regnes som allerede-konsumeret af den almindelige gap-fill-gang og røres aldrig).
// Fundet element FJERNES via splice — kun index >= ri kan ramme, så `ri` selv forbliver et
// gyldigt "næste ukonsumerede element"-pointer for kalderens fortsatte vandring bagefter
// (elementer før ri er urørte; elementer fra ri og frem rykker blot ét ned når ét fjernes).
// Intet endagsløb tilbage → null (kalderen degraderer hviledagen væk, se placeGrandTourSegments).
function takeNextOneDayFiller(rest, ri) {
  for (let j = ri; j < rest.length; j++) {
    if (lenOf(rest[j]) === 1) return rest.splice(j, 1)[0];
  }
  return null;
}

// #3470: placér ét GT's etaper i segmenter adskilt af hviledage — Option A (verificeret
// arkitektur-grundlag #3470): HUL i game_day, TÆT stage_number (1..N uafbrudt, ingen
// binding-lag rører etape-nummerering). `positions` er 1-indekserede etape-numre EFTER
// hvilke en hviledag indsættes (grandTourRestDayPositions). Hver hviledag fyldes med ét
// endagsløb fra `rest` (splejset ud af puljen, så det ikke genbruges/tælles dobbelt —
// #3469-kvoteregnskabet i selection er uændret, fillere var allerede en del af puljen).
// Findes intet endagsløb tilbage til en given hviledag, DEGRADERES den ærligt væk (GT'ens
// næste etape lægges umiddelbart efter i stedet — ingen tabte events), rapporteret i
// `restDayReport` (dry-run-diagnostik, #3470 punkt 3). restDays/positions tom ⇒ ét
// segment ⇒ bit-identisk med placeStream(0, gt) (før #3470).
function placeGrandTourSegments({ gt, positions, rest, ri, manualEvents, streamCursor, restDayReport }) {
  const total = lenOf(gt);
  const boundaries = [...positions, total];
  let stageNum = 1;
  let segStart = 0;
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
    const filler = takeNextOneDayFiller(rest, ri);
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

// ---- STREAM: least-loaded på `cap` spor + game-dag-ordnet komprimering (håndterer GT + monumenter) ----
function layoutStream({ stageRaces, classics, monuments, density: D, days, cap, spineMinStages }) {
  const gts = stageRaces.filter((r) => lenOf(r) >= spineMinStages).sort(byBigThenId);
  const others = stageRaces.filter((r) => lenOf(r) < spineMinStages).sort(byBigThenId);
  const streamCursor = new Array(cap).fill(0);
  const raceSpan = new Map();
  const placeStream = (s, race) => { const start = streamCursor[s]; streamCursor[s] = start + lenOf(race); raceSpan.set(race.id, { start, len: lenOf(race), stream: s, race }); };
  const totalSlots = D * days; // #3469: flyttet op — GT-fase-ankeret skal kende totalSlots FØR placeringen.
  // #3470: GT-segmenters (etape- + filler-)events bygges MANUELT (bypasser raceSpan, som kun
  // understøtter ÉT sammenhængende span pr. race-id) og merges ind i `events` nedenfor.
  const manualEvents = [];
  const gtRestDayReport = [];

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
    const gtsByPhase = orderByPhase(gts);
    if (gtsByPhase) {
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
        const target = Math.min(ceiling, Math.max(placedCount, Math.round(gt.seasonFraction * (totalSlots - remainingGtLen))));
        while (ri < rest.length && placedCount < target) {
          let s = 0;
          for (let t = 1; t < cap; t++) if (streamCursor[t] < streamCursor[s]) s = t;
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
        // #3470: GT'en placeres nu i segmenter adskilt af hviledags-fillere
        // (placeGrandTourSegments) i stedet for placeStream(0, gt) direkte — men bidrager
        // stadig KUN til stream 0 (samme sekventielle GT-rygrad-invariant som før #3470, og
        // samme stream separations-bufferet holder afstand til).
        // placedCount opdateres med den FAKTISKE fremdrift på stream 0 (etaper + evt.
        // fyldte hviledage — degraderede hviledage lægger IKKE beslag på en slot), læst
        // som streamCursor[0]-deltaet, så en degraderet hviledag ikke overvurderer
        // fremdriften mod senere GT'ers target-beregning.
        const positions = grandTourRestDayPositions({ stages: lenOf(gt), restDays: Number(gt.restDays) || 0 });
        const gtStreamStart = streamCursor[0];
        placeGrandTourSegments({ gt, positions, rest, ri, manualEvents, streamCursor, restDayReport: gtRestDayReport });
        placedCount += streamCursor[0] - gtStreamStart;
        remainingGtLen -= footprintOf(gt); // klar til NÆSTE gt's target-beregning (nu ekskl. denne)
        requiredStream0Buffer = GT_SEPARATION_BUFFER_DAYS * D; // gælder NÆSTE gt (0 hvis der ikke er flere)
      }
      for (; ri < rest.length; ri++) { let s = 0; for (let t = 1; t < cap; t++) if (streamCursor[t] < streamCursor[s]) s = t; placeStream(s, rest[ri]); }
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

// Diagnostik fra placements (ÆGTE binding-overlap fra game-dag-spans, uafhængigt af layout).
function diagnose(placements, days, D, cap, timelineLength, layoutMode, spineMinStages) {
  const load = new Array(days).fill(0);
  const racesOnDay = Array.from({ length: days }, () => new Set());
  for (const p of placements) for (const st of p.stagesPlaced) { load[st.real_day] += 1; racesOnDay[st.real_day].add(p.id); }

  const spans = placements
    .filter((p) => p.stagesPlaced.every((s) => s.game_day < MONUMENT_GAMEDAY_BASE))
    .map((p) => [Math.min(...p.stagesPlaced.map((s) => s.game_day)), Math.max(...p.stagesPlaced.map((s) => s.game_day))]);
  const hi = spans.length ? Math.max(...spans.map((s) => s[1])) : -1;
  const overlapHistogram = {};
  let maxOverlap = 0;
  for (let g = 0; g <= hi; g++) {
    const n = spans.filter(([a, b]) => a <= g && b >= g).length;
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

  return {
    load, racesPerDay: racesOnDay.map((s) => s.size), days, density: D, overlapCap: cap, layoutMode, timelineLength,
    emptyDays: load.filter((x) => x === 0).length,
    underfilledDays: load.filter((x) => x < D).length,
    overlapDays: racesOnDay.map((s) => s.size).filter((n) => n >= 2).length,
    maxOverlap, overlapHistogram, straddleGameDays,
    gtRealDaySeparationViolations,
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
