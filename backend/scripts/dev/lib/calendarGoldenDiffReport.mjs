// #4123 — den gyldne kalender-DIFF: rene funktioner der (a) grupperer afvigelserne pr.
// division / dag / løbstype og (b) dømmer de HÅRDE invarianter på en snapshot alene.
//
// HVORFOR EN FIL TIL, når lib/calendarGoldenSnapshotBuilder.mjs allerede har
// `diffCalendarGoldenSnapshots`? Fordi de to svarer på forskellige spørgsmål:
//
//   diffCalendarGoldenSnapshots  → "hvilke linjer ændrede sig" (CI-testens fejlbesked)
//   denne fil                    → "hvad BETYDER ændringen, og er den overhovedet lovlig"
//
// Den første er en tekst-diff. Den anden er det menneskelige trin FØR S4 genereres
// (docs/CALENDAR_RULES.md §2d): et tal pr. division, et tal pr. løbstype, og en HÅRD dom
// på de invarianter der aldrig må brydes uanset hvad kalibreringen beslutter. Den
// arbejdsgang fandtes ikke, og det var netop dét der lod #3546's bytte-mekanisme bryde
// GT-separationen uopdaget: diffen kunne ikke læses, så ingen læste den.
//
// HVAD DER KAN AFGØRES UD FRA EN SNAPSHOT ALENE. Snapshottet bærer kun
// { løb, etapenummer, game_day } pr. dato pr. tier — ikke race_type, ikke race_class.
// Et løbs ETAPEANTAL er derfor udledt som antallet af distinkte etapenumre løbet har i
// tieren, og løbstypen af det tal:
//
//   1 etape                     → endagsløb
//   2..GRAND_TOUR_MIN_STAGES-1  → etapeløb
//   >= GRAND_TOUR_MIN_STAGES    → Grand Tour   (samme tærskel som grandTourRestDays.js)
//
// Det er en UDLEDNING, ikke en aflæsning af kataloget, og den står her eksplicit fordi
// den er den ene antagelse rapporten hviler på. Den holder så længe et løbs etaper alle
// ligger i samme tier — hvilket §2's ene-kalender-pr-tier-regel garanterer. De invarianter
// der KRÆVER katalog-data (monument-distancer, klasse↔etapebånd, terræn-andele) hører
// hjemme i lib/calendarInvariantsCiGate4123.test.js, som har kataloget, og gentages
// bevidst IKKE her.
//
// Ren: ingen DB, intet ur, ingen fil-I/O. Refs #4123 #4121 #4571 #4270 #3546

import { MAX_GT_STAGES_PER_DAY, MAX_GT_SPAN_DAYS } from "../../../lib/raceCalendarLanePacker.js";
import { GRAND_TOUR_MIN_STAGES } from "../../../lib/grandTourRestDays.js";

/** Løbstyperne rapporten grupperer efter. Rækkefølgen er rapportens rækkefølge. */
export const RACE_TYPES = Object.freeze(["endagsløb", "etapeløb", "grand tour"]);

/**
 * Etapeantal pr. løb i én tier-blok, udledt af snapshottet selv (se filens header).
 *
 * @param {{dage?: Array<{etaper?: Array<{løb: string, etapenummer: number}>}>}} tierBlok
 * @returns {Map<string, number>} løbsnavn → antal distinkte etapenumre
 */
export function stageCountsByRace(tierBlok) {
  const numre = new Map();
  for (const dag of tierBlok?.dage ?? []) {
    for (const e of dag.etaper ?? []) {
      if (!numre.has(e.løb)) numre.set(e.løb, new Set());
      numre.get(e.løb).add(e.etapenummer);
    }
  }
  return new Map([...numre].map(([navn, set]) => [navn, set.size]));
}

/**
 * Løbstype af et etapeantal. Se filens header for hvorfor tærsklerne er dem de er.
 *
 * @param {number} stages
 * @returns {"endagsløb"|"etapeløb"|"grand tour"}
 */
export function raceTypeOf(stages) {
  if (stages >= GRAND_TOUR_MIN_STAGES) return "grand tour";
  if (stages <= 1) return "endagsløb";
  return "etapeløb";
}

/**
 * HÅRDE invarianter — dem der aldrig må brydes, uanset hvad §11's kalibrering beslutter.
 * Alle fire er allerede ejer-låste i docs/CALENDAR_RULES.md §3/§7 og håndhæves af
 * pakkeren; rapporten her er forward-guarden der fanger det hvis en ændring i pakkeren
 * bryder dem igen (#3546's fejlklasse).
 *
 * @param {object} snapshot en buildCalendarGoldenSnapshot()-formet struktur
 * @returns {string[]} én linje pr. brud, tom = grøn
 */
export function detectHardInvariantBreaches(snapshot) {
  const brud = [];

  for (const t of snapshot?.tiers ?? []) {
    const stages = stageCountsByRace(t);
    const erGt = (navn) => (stages.get(navn) ?? 0) >= GRAND_TOUR_MIN_STAGES;
    const dage = [...(t.dage ?? [])].sort((a, b) => String(a.dato).localeCompare(String(b.dato)));

    // (1) To Grand Tours deler ALDRIG en kalenderdag (§3, #3472/#3546).
    // (2) Ingen kalenderdag bærer mere end MAX_GT_STAGES_PER_DAY GT-etaper (§3).
    const gtDageByRace = new Map();
    for (const dag of dage) {
      const gtNavne = new Set();
      let gtEtaper = 0;
      for (const e of dag.etaper ?? []) {
        if (!erGt(e.løb)) continue;
        gtNavne.add(e.løb);
        gtEtaper += 1;
        if (!gtDageByRace.has(e.løb)) gtDageByRace.set(e.løb, new Set());
        gtDageByRace.get(e.løb).add(dag.dato);
      }
      if (gtNavne.size > 1) {
        brud.push(`D${t.tier} ${dag.dato}: ${gtNavne.size} Grand Tours deler dagen (${[...gtNavne].sort().join(" + ")})`);
      }
      if (gtEtaper > MAX_GT_STAGES_PER_DAY) {
        brud.push(`D${t.tier} ${dag.dato}: ${gtEtaper} GT-etaper, loftet er ${MAX_GT_STAGES_PER_DAY}`);
      }
    }

    // (3) Hver Grand Tour køres i højst MAX_GT_SPAN_DAYS kalenderdage (§3).
    for (const [navn, datoer] of [...gtDageByRace].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (datoer.size > MAX_GT_SPAN_DAYS) {
        brud.push(`D${t.tier} ${navn}: strækker sig over ${datoer.size} kalenderdage, loftet er ${MAX_GT_SPAN_DAYS}`);
      }
    }

    // (4) Hvert løbs etaper er kronologiske (§7): etape N må ikke ligge før etape N-1.
    const førsteDatoPrEtape = new Map(); // løb -> Map(etapenummer -> dato)
    for (const dag of dage) {
      for (const e of dag.etaper ?? []) {
        if (!førsteDatoPrEtape.has(e.løb)) førsteDatoPrEtape.set(e.løb, new Map());
        const m = førsteDatoPrEtape.get(e.løb);
        if (!m.has(e.etapenummer) || String(dag.dato) < m.get(e.etapenummer)) m.set(e.etapenummer, String(dag.dato));
      }
    }
    for (const [navn, m] of [...førsteDatoPrEtape].sort((a, b) => a[0].localeCompare(b[0]))) {
      const numre = [...m.keys()].sort((a, b) => a - b);
      for (let i = 1; i < numre.length; i++) {
        if (m.get(numre[i]) < m.get(numre[i - 1])) {
          brud.push(`D${t.tier} ${navn}: etape ${numre[i]} (${m.get(numre[i])}) ligger før etape ${numre[i - 1]} (${m.get(numre[i - 1])})`);
        }
      }
    }

    // (5) Ingen tom kalenderdag inde i tierens spænd (§2, ejer-direktiv 25/8 #4218).
    // Måles på snapshottets EGNE datoer: en dato uden en `dage`-post mellem første og
    // sidste er en dag uden løb i den division.
    const datoSæt = new Set(dage.map((d) => String(d.dato)));
    const første = snapshot?.genereret?.firstDay ?? dage[0]?.dato ?? null;
    const sidste = snapshot?.genereret?.lastDay ?? dage[dage.length - 1]?.dato ?? null;
    if (første && sidste) {
      for (let ms = Date.parse(`${første}T00:00:00Z`); ms <= Date.parse(`${sidste}T00:00:00Z`); ms += 86_400_000) {
        const dato = new Date(ms).toISOString().slice(0, 10);
        if (!datoSæt.has(dato)) brud.push(`D${t.tier} ${dato}: ingen løb (tom kalenderdag)`);
      }
    }
  }

  return brud;
}

/**
 * Struktureret diff mellem to snapshots, grupperet som mennesket læser den før S4:
 * pr. division, pr. dag og pr. løbstype.
 *
 * @param {object} gylden den committede snapshot
 * @param {object} ny den netop genererede
 * @returns {{uændret: boolean, divisioner: Array<object>, dage: Array<object>,
 *   løbstyper: Array<object>, vindue: {gylden: object|null, ny: object|null, ændret: boolean}}}
 */
export function summarizeGoldenDiff(gylden, ny) {
  const gTiers = new Map((gylden?.tiers ?? []).map((t) => [t.tier, t]));
  const nTiers = new Map((ny?.tiers ?? []).map((t) => [t.tier, t]));
  const alleTiers = [...new Set([...gTiers.keys(), ...nTiers.keys()])].sort((a, b) => a - b);

  const divisioner = [];
  const dage = [];
  const typeDelta = new Map(RACE_TYPES.map((t) => [t, { type: t, løbFør: 0, løbEfter: 0, etaperFør: 0, etaperEfter: 0 }]));

  for (const tier of alleTiers) {
    const g = gTiers.get(tier) ?? null;
    const n = nTiers.get(tier) ?? null;

    const gStages = g ? stageCountsByRace(g) : new Map();
    const nStages = n ? stageCountsByRace(n) : new Map();
    for (const [, stages] of gStages) {
      const rad = typeDelta.get(raceTypeOf(stages));
      rad.løbFør += 1; rad.etaperFør += stages;
    }
    for (const [, stages] of nStages) {
      const rad = typeDelta.get(raceTypeOf(stages));
      rad.løbEfter += 1; rad.etaperEfter += stages;
    }

    const gDage = new Map((g?.dage ?? []).map((d) => [String(d.dato), d]));
    const nDage = new Map((n?.dage ?? []).map((d) => [String(d.dato), d]));
    const alleDatoer = [...new Set([...gDage.keys(), ...nDage.keys()])].sort();
    let ændredeDage = 0;

    for (const dato of alleDatoer) {
      const gd = gDage.get(dato) ?? null;
      const nd = nDage.get(dato) ?? null;
      const gEtaper = gd?.etaper ?? [];
      const nEtaper = nd?.etaper ?? [];
      if (JSON.stringify(gEtaper) === JSON.stringify(nEtaper)) continue;
      ændredeDage += 1;
      const nøgle = (e) => `${e.løb}#${e.etapenummer}`;
      const gSæt = new Set(gEtaper.map(nøgle));
      const nSæt = new Set(nEtaper.map(nøgle));
      dage.push({
        tier,
        dato,
        status: !gd ? "ny dag" : !nd ? "dagen forsvandt" : "ændret",
        tilføjet: nEtaper.filter((e) => !gSæt.has(nøgle(e))).map(nøgle).sort(),
        fjernet: gEtaper.filter((e) => !nSæt.has(nøgle(e))).map(nøgle).sort(),
        etaperFør: gEtaper.length,
        etaperEfter: nEtaper.length,
      });
    }

    divisioner.push({
      tier,
      løbFør: g?.løb ?? 0,
      løbEfter: n?.løb ?? 0,
      etaperFør: g?.etaper ?? 0,
      etaperEfter: n?.etaper ?? 0,
      dageFør: (g?.dage ?? []).length,
      dageEfter: (n?.dage ?? []).length,
      ændredeDage,
    });
  }

  const vindueÆndret = JSON.stringify(gylden?.genereret ?? null) !== JSON.stringify(ny?.genereret ?? null);
  const uændret = !vindueÆndret && dage.length === 0
    && divisioner.every((d) => d.løbFør === d.løbEfter && d.etaperFør === d.etaperEfter);

  return {
    uændret,
    divisioner,
    dage,
    løbstyper: RACE_TYPES.map((t) => typeDelta.get(t)),
    vindue: { gylden: gylden?.genereret ?? null, ny: ny?.genereret ?? null, ændret: vindueÆndret },
  };
}

/**
 * Rapporten som læsbar tekst — dét der skal stå i terminalen FØR S4 genereres.
 *
 * @param {ReturnType<typeof summarizeGoldenDiff>} diff
 * @param {string[]} hårdeBrud fra detectHardInvariantBreaches
 * @param {{maxDage?: number}} [opts]
 * @returns {string}
 */
export function formatGoldenDiffReport(diff, hårdeBrud = [], { maxDage = 40 } = {}) {
  const ud = [];
  ud.push("GYLDEN KALENDER-DIFF (#4123)");
  ud.push("=".repeat(60));

  if (diff.vindue.ændret) {
    ud.push(`⚠ vinduet ændrede sig: ${JSON.stringify(diff.vindue.gylden)} → ${JSON.stringify(diff.vindue.ny)}`);
  } else if (diff.vindue.ny) {
    ud.push(`vindue: ${diff.vindue.ny.firstDay} → ${diff.vindue.ny.lastDay} (${diff.vindue.ny.realDays} kalenderdage)`);
  }

  ud.push("");
  ud.push("── pr. division ──");
  for (const d of diff.divisioner) {
    const ændring = d.løbFør === d.løbEfter && d.etaperFør === d.etaperEfter && d.ændredeDage === 0
      ? "uændret"
      : `løb ${d.løbFør}→${d.løbEfter} · etaper ${d.etaperFør}→${d.etaperEfter} · ${d.ændredeDage} ændret(e) dag(e)`;
    ud.push(`  D${d.tier}: ${ændring}`);
  }

  ud.push("");
  ud.push("── pr. løbstype (udledt af etapeantal, se modulets header) ──");
  for (const t of diff.løbstyper) {
    const ændret = t.løbFør !== t.løbEfter || t.etaperFør !== t.etaperEfter;
    ud.push(`  ${t.type}: løb ${t.løbFør}→${t.løbEfter} · etaper ${t.etaperFør}→${t.etaperEfter}${ændret ? "  ← ændret" : ""}`);
  }

  ud.push("");
  ud.push(`── pr. dag (${diff.dage.length} ændret(e)) ──`);
  if (diff.dage.length === 0) {
    ud.push("  ingen");
  } else {
    for (const d of diff.dage.slice(0, maxDage)) {
      const dele = [];
      if (d.fjernet.length) dele.push(`− ${d.fjernet.join(", ")}`);
      if (d.tilføjet.length) dele.push(`+ ${d.tilføjet.join(", ")}`);
      ud.push(`  D${d.tier} ${d.dato} (${d.status}, ${d.etaperFør}→${d.etaperEfter}): ${dele.join("  ") || "rækkefølge ændret"}`);
    }
    if (diff.dage.length > maxDage) ud.push(`  ... og ${diff.dage.length - maxDage} flere`);
  }

  ud.push("");
  ud.push("── hårde invarianter ──");
  if (hårdeBrud.length === 0) {
    ud.push("  ✅ ingen brud");
  } else {
    for (const b of hårdeBrud) ud.push(`  ❌ ${b}`);
  }

  return ud.join("\n");
}
