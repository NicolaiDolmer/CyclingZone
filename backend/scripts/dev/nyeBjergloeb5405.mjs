#!/usr/bin/env node
// backend/scripts/dev/nyeBjergloeb5405.mjs
//
// #5405 — READ-ONLY undersoegelse, fortsaettelsen af bjergdageBytte5405.mjs.
//
// Spoergsmaalet dér var: kan hoej-bjergs-andelen i Division 2 og 3 loeftes ved at BYTTE
// loeb rundt mellem divisionerne? Svaret var nej — det er en FORSYNINGSGRAENSE, ikke en
// fordelingsfejl (se docs/audits/2026-09-19-5405-bjergdage-bytte.md).
//
// Spoergsmaalet HER er ejerens opfoelgning: "kan vi lave en permanent og langsigtet
// forbedring?" — dvs. hjaelper det at laegge NYE bjergrige etapeloeb i kataloget, og hvad
// er det MINDSTE saet der bringer baade D2 og D3 i maal?
//
// Scriptet SKRIVER ALDRIG. Kandidaterne laegges i en KOPI af kataloget i hukommelsen via
// materializeTierCalendars({ extraCatalogRows }) — #3295's eksisterende dry-run-sti, som
// selv afviser at blive brugt uden dryRun.
//
// To ting varieres: hvilke kandidat-loeb der ligger i katalog-kopien, og
// `archetypeReservations`. Runde 1 (N*) varierer KUN kataloget, med produktionens
// uaendrede reservations-tabel - og viser at kataloget alene ikke flytter noget.
// Runde 2 og 3 (R*/S*) varierer begge dele. Den frosne produktions-tabel muteres
// aldrig; den klones (reservationsWith).
//
// Brug:
//   infisical run --env=prod -- node scripts/dev/nyeBjergloeb5405.mjs --season 4 --first-day 2026-09-28
//
// Output er JSON paa stdout (kort opsummering paa stderr), saa rapport- og
// billedgeneratoren kan laese det uden at parse fri tekst.

import { createClient } from "@supabase/supabase-js";
import { materializeTierCalendars } from "../../lib/tierCalendarMaterializer.js";
import { resolveCalendarFrom, resolveSeasonWindow, SEASON_RACE_DAYS_DEFAULT } from "../../lib/calendarStartDate.js";
import { quotasForRaceDays, seasonUuid } from "../buildSeasonCalendar.js";
import { scoreCalendarPlan, alleBrud, scorecardGateGroups } from "../../lib/calendarScorecardReport.js";
import { TIER_ARCHETYPE_RESERVATIONS } from "../../lib/tierCalendarGuarantees.js";
// #5405: external_id SKAL udledes praecis som den rigtige seed-import goer
// (racePoolImport.buildExternalId = sha256(normaliseret navn|date_text), 16 tegn).
// external_id er parcours-seedens identitet (seedIdentityFor), saa en anden udledning
// ville give kandidaterne ET ANDET PARCOURS i toerkoerslen end de faar naar de rent
// faktisk importeres - og hele maalingen ville vaere uden daekning. Fanget af
// CodeRabbit 19/9.
import { buildExternalId } from "../../lib/racePoolImport.js";

// Dyb klon + override af reservations-tabellen. Ingen mutation af den frosne original.
function reservationsWith(overrides = {}) {
  const out = {};
  for (const [tier, cfg] of Object.entries(TIER_ARCHETYPE_RESERVATIONS)) out[tier] = { ...cfg };
  for (const [tier, cfg] of Object.entries(overrides)) out[tier] = { ...(out[tier] ?? {}), ...cfg };
  return out;
}

const argv = process.argv.slice(2);
const argOf = (flag, fallback = null) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const seasonNumber = Number(argOf("--season", "4"));
const firstDay = argOf("--first-day", "2026-09-28");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (koer via infisical run --env=prod)");
  process.exit(2);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const from = resolveCalendarFrom({ firstRaceDate: firstDay });
const firstRaceDay = new Date(from.getTime() + 86_400_000).toISOString().slice(0, 10);
const window = resolveSeasonWindow({ firstRaceDay, raceDays: SEASON_RACE_DAYS_DEFAULT[seasonNumber] ?? null });
const realDays = window.raceDays;
const quotas = quotasForRaceDays(realDays);

// ── Kandidaterne ─────────────────────────────────────────────────────────────
//
// Alle fire har et VIRKELIGT forbillede paa 2.1-niveau (UCI Class 1) med bjergfinaler.
// Hvorfor 2.1 og ikke 2.Pro: katalogets ProSeries-baand er allerede et 1:1-spejl af den
// virkelige 2.Pro-kalender (26 etapeloeb, alle med et virkeligt forbillede). Der ER ikke
// et ubrugt bjergrigt 2.Pro-loeb tilbage at tage udgangspunkt i. Class1-baandet har
// derimod kun 8 etapeloeb mod virkelighedens mange snesevis af 2.1-loeb, saa dér er der
// rigeligt virkeligt stof — og Class1 er praecis D3's og D4's vindue.
//
// Navnene foelger katalogets konvention (se scripts/race_pool_seed.csv + noten i
// proposeCatalogExpansion.js): geografisk plausible, FIKTIVE navne paa loebets eget sprog,
// afledt af regionen og ikke af arrangoerens varemaerke. Ingen virkelige loebsnavne i
// spillet (juridisk krav, se docs/archive/strategy/BUSINESS_MODEL.md).
//
// date_text foelger forbilledets plads i kalenderaaret (#3469 — kilden til seasonFraction).
export const KANDIDATER = Object.freeze([
  {
    key: "galega",
    name: "Volta Galega",
    forbillede: "O Gran Camiño (Spanien/Galicien, 2.1, april): 5 etaper, aabner med enkeltstart, dronningeetape i Ourense-bjergene og bjergfinale paa Monte de Santa Trega",
    country: "Spain", race_class: "Class1", race_type: "stage_race", stages: 5,
    terrain_archetype: "summit_tour", date_text: "14/4 - 18/4",
    hvorfor: "Det eneste forbillede der i virkeligheden har BAADE enkeltstart og to bjergfinaler i samme loeb. Class1 er D3's og D4's eksklusive vindue, saa D2 kan ikke snuppe det foerst.",
  },
  {
    key: "portuguesa",
    name: "Volta Portuguesa",
    forbillede: "Volta a Portugal (2.1, august): bjergfinaler paa Torre og Senhora da Graça plus en enkeltstart; virkeligheden har 10 etaper",
    country: "Portugal", race_class: "Class1", race_type: "stage_race", stages: 6,
    terrain_archetype: "summit_tour", date_text: "6/8 - 11/8",
    hvorfor: "Portugals store rundtur er et af de mest bjergrige loeb paa 2.1-niveau. Kortet til 6 etaper, fordi Class1-baandet er 3-6 (#3328); virkelighedens 10 etaper hoerer til en hoejere klasse.",
  },
  {
    key: "tauern",
    name: "Rundfahrt der Hohen Tauern",
    forbillede: "Österreich-Rundfahrt / Tour of Austria (2.1, juli): 5 etaper gennem alperne med bjergfinaler (Kühtai, Gaisberg)",
    country: "Austria", race_class: "Class1", race_type: "stage_race", stages: 5,
    terrain_archetype: "summit_tour", date_text: "9/7 - 13/7",
    hvorfor: "Katalogets alpine juli-vindue har i dag ingen Class1-rundtur. Oestrig er den aabenlyse virkelige kilde og ligger et andet sted i aaret end de spanske bjergloeb.",
  },
  {
    key: "andes",
    name: "Vuelta a los Andes",
    forbillede: "Tour Colombia (2.1, februar): hoejdeetaper og bjergfinaler i Andesbjergene, typisk med en enkeltstart",
    country: "Colombia", race_class: "Class1", race_type: "stage_race", stages: 5,
    terrain_archetype: "summit_tour", date_text: "4/2 - 8/2",
    hvorfor: "Flytter en bjergdag ud i den tidlige sesong, hvor kataloget naesten ingen bjerge har, og giver kalenderen en region uden for Europa.",
  },
  // ── Kontrol-kandidat: samme loeb, men i ProSeries-klassen ────────────────────
  // Her ER der ikke et ubrugt virkeligt 2.Pro-forbillede, saa den er markeret som
  // OPRYKKET: forbilledet er virkeligt, men klassen er haevet over sin virkelige.
  // Kun med for at maale om D2 overhovedet kan naas ad katalog-vejen.
  {
    key: "galega_pro",
    name: "Volta Galega",
    forbillede: "O Gran Camiño — OPRYKKET til ProSeries (virkelig klasse er 2.1)",
    country: "Spain", race_class: "ProSeries", race_type: "stage_race", stages: 5,
    terrain_archetype: "summit_tour", date_text: "14/4 - 18/4",
    hvorfor: "Kontrol: kan D2 loeftes ad katalog-vejen, og hvad koster det at oprykke et loeb over sin virkelige klasse?",
  },
  {
    key: "tauern_pro",
    name: "Rundfahrt der Hohen Tauern",
    forbillede: "Österreich-Rundfahrt — OPRYKKET til ProSeries (virkelig klasse er 2.1)",
    country: "Austria", race_class: "ProSeries", race_type: "stage_race", stages: 5,
    terrain_archetype: "summit_tour", date_text: "9/7 - 13/7",
    hvorfor: "Kontrol, samme spoergsmaal som ovenfor.",
  },
  {
    key: "portuguesa_pro",
    name: "Volta Portuguesa",
    forbillede: "Volta a Portugal — OPRYKKET til ProSeries (virkelig klasse er 2.1)",
    country: "Portugal", race_class: "ProSeries", race_type: "stage_race", stages: 5,
    terrain_archetype: "summit_tour", date_text: "6/8 - 10/8",
    hvorfor: "Tredje ProSeries-bjergloeb: foerst naar D2 og D3 ikke laengere skal dele de samme faa loeb, kan begge naa maalet.",
  },
  {
    key: "andes_pro",
    name: "Vuelta a los Andes",
    forbillede: "Tour Colombia — OPRYKKET til ProSeries (virkelig klasse er 2.1)",
    country: "Colombia", race_class: "ProSeries", race_type: "stage_race", stages: 5,
    terrain_archetype: "summit_tour", date_text: "4/2 - 8/2",
    hvorfor: "Fjerde ProSeries-bjergloeb, tidligt paa aaret.",
  },
]);

const byKey = new Map(KANDIDATER.map((k) => [k.key, k]));

/** race_pool-raekke-form. id = deterministisk pseudo-uuid, KUN gyldig i dry-run. */
function toCatalogRow(c) {
  const ext = buildExternalId(c.name, c.date_text);
  return {
    id: `ffffffff-0000-4000-8000-${ext.slice(0, 12)}`,
    external_id: ext,
    name: c.name,
    race_class: c.race_class,
    race_type: c.race_type,
    stages: c.stages,
    terrain_archetype: c.terrain_archetype,
    date_text: c.date_text,
  };
}

// ── Kombinationerne ──────────────────────────────────────────────────────────
//
// RUNDE 1 (N1-N8) viste at kataloget ALENE ikke flytter D2 og D3 een eneste etape:
// nye Class1-loeb lander i D4, og et nyt ProSeries-loeb i D3 bytter bare plads med et
// lige saa bjergrigt loeb D3 allerede havde. Kvoten er eksakt, saa antallet af
// bjergloeb en division tager, er sat af RESERVATIONEN — ikke af hvor mange der findes.
//
// RUNDE 2 (R*) tester derfor den kombination der faktisk er paa spil: reservationen
// haeves (som i bjergdage-bytte-undersoegelsens K8/K11) OG kataloget udvides, saa
// divisionerne ikke laengere skal slaas om de samme faa loeb.
const R_K8 = { 3: { summit_tour: 4, balanced_week: 1 } };
const R_K11 = { 2: { summit_tour: 6 } };
const R_K12 = { 2: { summit_tour: 6 }, 3: { summit_tour: 4, balanced_week: 1 } };

const SCENARIER = [
  { id: "baseline", label: "Udgangspunkt: kataloget som det er i dag", keys: [], overrides: {} },
  { id: "N1", label: "N1: ET nyt Class1-bjergloeb (Volta Galega)", keys: ["galega"], overrides: {} },
  { id: "N2", label: "N2: TO nye Class1-bjergloeb (Galega + Portuguesa)", keys: ["galega", "portuguesa"], overrides: {} },
  { id: "N3", label: "N3: TRE nye Class1-bjergloeb", keys: ["galega", "portuguesa", "tauern"], overrides: {} },
  { id: "N4", label: "N4: FIRE nye Class1-bjergloeb", keys: ["galega", "portuguesa", "tauern", "andes"], overrides: {} },
  { id: "N7", label: "N7: kun OPRYKKEDE ProSeries", keys: ["galega_pro", "tauern_pro"], overrides: {} },

  { id: "R1", label: "R1: K8-reservation alene (kendt resultat, kontrol)", keys: [], overrides: R_K8 },
  { id: "R2", label: "R2: K8 + to nye Class1-bjergloeb", keys: ["galega", "portuguesa"], overrides: R_K8 },
  { id: "R3", label: "R3: K8 + to OPRYKKEDE ProSeries", keys: ["galega_pro", "tauern_pro"], overrides: R_K8 },
  { id: "R4", label: "R4: K12 (D2+D3) alene (kendt resultat, kontrol)", keys: [], overrides: R_K12 },
  { id: "R5", label: "R5: K12 + to OPRYKKEDE ProSeries", keys: ["galega_pro", "tauern_pro"], overrides: R_K12 },
  { id: "R6", label: "R6: K12 + to OPRYKKEDE ProSeries + to Class1", keys: ["galega_pro", "tauern_pro", "portuguesa", "andes"], overrides: R_K12 },
  { id: "R7", label: "R7: K11 (kun D2) + to OPRYKKEDE ProSeries", keys: ["galega_pro", "tauern_pro"], overrides: R_K11 },
  { id: "R8", label: "R8: D3 summit_tour 5 + balanced_week 1 + to OPRYKKEDE ProSeries", keys: ["galega_pro", "tauern_pro"], overrides: { 3: { summit_tour: 5, balanced_week: 1 } } },
  { id: "R9", label: "R9: D2 summit 6 + D3 summit 5/balanced 1 + to OPRYKKEDE ProSeries", keys: ["galega_pro", "tauern_pro"], overrides: { 2: { summit_tour: 6 }, 3: { summit_tour: 5, balanced_week: 1 } } },

  // RUNDE 3: R8 bragte D3 i maal uden at koste en enkeltstart, men D2 stod stille.
  // Her testes om et TREDJE og FJERDE ProSeries-bjergloeb giver D2 sit eget stof at
  // tage, saa de to divisioner ikke laengere konkurrerer om de samme faa loeb.
  { id: "S1", label: "S1: R8 + D2 summit 5", keys: ["galega_pro", "tauern_pro"], overrides: { 2: { summit_tour: 5 }, 3: { summit_tour: 5, balanced_week: 1 } } },
  { id: "S2", label: "S2: R8 + tredje ProSeries-bjergloeb, D2 uaendret", keys: ["galega_pro", "tauern_pro", "portuguesa_pro"], overrides: { 3: { summit_tour: 5, balanced_week: 1 } } },
  { id: "S3", label: "S3: tre ProSeries + D2 summit 5 + D3 summit 5/balanced 1", keys: ["galega_pro", "tauern_pro", "portuguesa_pro"], overrides: { 2: { summit_tour: 5 }, 3: { summit_tour: 5, balanced_week: 1 } } },
  { id: "S4", label: "S4: tre ProSeries + D2 summit 6 + D3 summit 5/balanced 1", keys: ["galega_pro", "tauern_pro", "portuguesa_pro"], overrides: { 2: { summit_tour: 6 }, 3: { summit_tour: 5, balanced_week: 1 } } },
  { id: "S5", label: "S5: fire ProSeries + D2 summit 6 + D3 summit 5/balanced 1", keys: ["galega_pro", "tauern_pro", "portuguesa_pro", "andes_pro"], overrides: { 2: { summit_tour: 6 }, 3: { summit_tour: 5, balanced_week: 1 } } },
  // S6 havde foerst baade `tauern_pro` og `tauern` med. De deler NAVN, og
  // materializeTierCalendars dedupperer paa navn paa tvaers af divisioner, saa de to
  // raekker kunne aldrig blive to selvstaendige tilfoejelser. Rettet: kun entydigt
  // navngivne loeb i samme scenarie. Fanget af CodeRabbit 19/9.
  { id: "S6", label: "S6: tre ProSeries + et Class1 + D2 summit 5 + D3 summit 5/balanced 1", keys: ["galega_pro", "tauern_pro", "portuguesa_pro", "andes"], overrides: { 2: { summit_tour: 5 }, 3: { summit_tour: 5, balanced_week: 1 } } },
];

function raceBreakdown(tierPlan, profiles, archetypeByPoolRace, nyeNavne) {
  const pool = (tierPlan.pools ?? [])[0] ?? { raceRows: [] };
  return (pool.raceRows ?? []).map((r) => {
    const stages = profiles.get(r.pool_race_id) ?? [];
    const counts = {};
    for (const st of stages) {
      const pt = st?.profile_type ?? st?.stage_type ?? "?";
      counts[pt] = (counts[pt] ?? 0) + 1;
    }
    return {
      name: r.name,
      race_type: r.race_type,
      archetype: archetypeByPoolRace.get(r.pool_race_id) ?? null,
      stages: stages.length,
      high_mountain: counts.high_mountain ?? 0,
      mountain: counts.mountain ?? 0,
      itt: (counts.itt ?? 0) + (counts.itt_hilly ?? 0),
      ny: nyeNavne.has(r.name),
    };
  });
}

async function runScenario(scen) {
  const kandidater = scen.keys.map((k) => byKey.get(k));
  const extra = kandidater.map(toCatalogRow);
  const nyeNavne = new Set(kandidater.map((c) => c.name));

  const plan = await materializeTierCalendars({
    supabase, seasonId: seasonUuid(seasonNumber), seasonStartDate: firstRaceDay, from,
    dryRun: true, log: () => {}, realDays, quotas,
    useUniformTierTilt: false,
    archetypeReservations: reservationsWith(scen.overrides ?? {}),
    extraCatalogRows: extra,
  });
  const planTiers = plan.planTiers ?? [];
  const profilesByTier = new Map(planTiers.map((t) => [t.tier, t.profilesByPoolRaceId ?? new Map()]));
  const rapport = scoreCalendarPlan({
    tierPlans: planTiers, profilesByTier,
    archetypeByPoolRace: plan.archetypeByPoolRace ?? new Map(),
    firstRaceDay, realDays,
  });
  const gates = scorecardGateGroups(rapport);
  const brud = alleBrud(rapport);

  const tiers = {};
  for (const t of rapport.tiers ?? []) {
    tiers[t.tier] = {
      loeb: t.løb, etaper: t.etaper, quota: t.quota, totalGameDays: t.totalGameDays, quotaHit: t.quotaHit,
      uniform: t.uniform ?? null,
      uniformViol: t.uniformViol ?? [],
      compositionViol: t.compositionViol ?? [],
      compositionStrictViol: t.compositionStrictViol ?? [],
      coverageViol: t.coverageViol ?? [],
      terrainBandViol: t.terrainBandViol ?? [],
      orderViol: t.orderViol ?? [],
      finaleViol: t.finaleViol ?? [],
      planViolations: t.planViolations ?? [],
      quotaViol: t.quotaViol ?? [],
      monumentGtViol: t.monumentGtViol ?? [],
      minOverlapViol: t.minOverlapViol ?? [],
      gameDayOverlap: t.gameDayOverlap ?? null,
      coverage: t.coverage ?? null,
      composition: t.composition ?? null,
    };
  }

  const races = {};
  const nyeHvor = {};
  for (const tp of planTiers) {
    const rows = raceBreakdown(tp, profilesByTier.get(tp.tier) ?? new Map(), plan.archetypeByPoolRace ?? new Map(), nyeNavne);
    races[tp.tier] = rows;
    for (const r of rows) if (r.ny) (nyeHvor[r.name] ??= []).push({ tier: tp.tier, stages: r.stages, high_mountain: r.high_mountain, itt: r.itt });
  }

  return {
    id: scen.id, label: scen.label, keys: scen.keys,
    kandidater: kandidater.map((c) => ({ ...c })),
    tiers, races, nyeHvor,
    saesonFinale: rapport.sæsonFinale ?? null,
    saesonFinaleViol: rapport.sæsonFinaleViol ?? [],
    gates: {
      blocking: gates.blocking ?? [], applyBlocking: gates.applyBlocking ?? [],
      finaleDrift: gates.finaleDrift ?? [], uniformDrift: gates.uniformDrift ?? [],
    },
    brudAntal: Array.isArray(brud) ? brud.length : null,
    brud: Array.isArray(brud) ? brud : [],
  };
}

const resultater = [];
for (const scen of SCENARIER) {
  process.stderr.write(`[${scen.id}] ${scen.label} ...\n`);
  try {
    const res = await runScenario(scen);
    resultater.push(res);
    const linje = [1, 2, 3, 4].map((t) => {
      const u = res.tiers[t]?.uniform;
      const hm = u?.pct?.high_mountain;
      const itt = u?.pct?.itt;
      return hm == null ? `D${t} -` : `D${t} bjerg ${hm.toFixed(1)}% / itt ${(itt ?? 0).toFixed(1)}%`;
    }).join(" · ");
    process.stderr.write(`   ${linje}\n`);
    process.stderr.write(`   roede ${res.brudAntal} · blokerende ${res.gates.blocking.length} · apply-blokerende ${res.gates.applyBlocking.length}\n`);
    for (const [navn, hvor] of Object.entries(res.nyeHvor)) {
      process.stderr.write(`   NY: ${navn} -> ${hvor.map((h) => `D${h.tier} (${h.stages} et, ${h.high_mountain} hb, ${h.itt} itt)`).join(", ")}\n`);
    }
  } catch (err) {
    process.stderr.write(`   FEJL: ${err.message}\n`);
    resultater.push({ id: scen.id, label: scen.label, keys: scen.keys, fejl: String(err.message) });
  }
}

console.log(JSON.stringify({ seasonNumber, firstRaceDay, realDays, quotas, kandidater: KANDIDATER, resultater }, null, 2));
