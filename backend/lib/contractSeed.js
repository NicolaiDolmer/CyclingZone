// Kontrakt-seed (#1309) — frossen løn + længde + udløbssæson på ejede ryttere.
// Pure helpers er deterministiske/seeded → dry-run == apply. DB-wrapper
// (runContractSeed, Task 3) læser ejede ryttere + founder-hold og skriver felterne.
//
// Beslutninger (ejer 13/6): kontrakter kun på ejede ryttere (free agents = NULL);
// founders 2 sæsoner; andre ejede blandet 1-3.

import { makeRng } from "./fictionalRiderGenerator.js";
import { fetchAllRows } from "./supabasePagination.js";
import {
  SALARY_RATE, salaryRateForDivision, SALARY_BASIS_MODE, SALARY_MARKET_MODEL,
} from "./economyConstants.js";
import { SALARY_BASIS, marketBasisSalary, resolveMarketBase } from "./salaryBasis.js";

export const CONTRACT = Object.freeze({
  FOUNDER_LENGTH: 2,          // founder-hold: stabil trup i 2 sæsoner
  DEFAULT_ACQUIRE_LENGTH: 2,  // auto-kontrakt ved erhvervelse (create-if-missing)
  MIN_LENGTH: 1,
  MAX_LENGTH: 3,
  SALARY_RATE,                // GAMMEL market_value-kobling (0.067) — kun reference/legacy
  BASE_VALUE_FALLBACK: 1000,  // spejler RIDER_BASE_VALUE_FALLBACK
  // #3143: hårdt loft på gentagne kontraktforlængelser — uden dette kan en
  // manager spamme /extend-contract og låse lav løn helt til sæson 11+.
  // Loftet er relativt til NUVÆRENDE sæson (ikke rytterens eksisterende
  // udløbssæson), så gentagne kald aldrig flytter horisonten længere ud.
  MAX_EXTENSION_SEASONS_AHEAD: 3,
});

// Frossen løn (#1309). HVAD lønnen ganges med styres af SALARY_BASIS_MODE
// (economyConstants.js) — begge grene er live-kode, så rollback er ét konstant-skift.
//
// "market" (#3360, ejer-besluttet 2026-08-05) — DEFAULT:
//   løn = konkav kurve på markedsværdien (salaryBasis.marketBasisSalary).
//   Du betaler for det du EJER. Grunden til skiftet: current_production_value er
//   nærmest fladt over alder (7-12k) mens markedsværdien falder fra ~180k til ~20k,
//   så et ungt talent til 180.000 CZ$ kostede 1.273/sæson og en 34-årig til 20.000
//   kostede 2.971 — spillets dyreste aktiver var de billigste at beholde.
//
// "production" (#2594-adfærd, rollback-sti):
//   GREATEST(1, ROUND(COALESCE(current_production_value, 1000) × SALARY_RATE_PROD[division])).
//   Division styrer satsen (ejer-valg 14/7); mangler division bruges den globale sats.
//
// ⚠️ Kaldesteder SKAL selecte market_value ELLER base_value når mode er "market".
// Et manglende felt giver ikke en fejl — det giver en tavs bundløn, præcis den
// fejlklasse der ramte lønbyrde-harnessen i #3389. resolveMarketBase().source
// afslører det; se salaryBasis.js.
export function computeFrozenSalary(rider = {}) {
  if (SALARY_BASIS_MODE === SALARY_BASIS.MARKET) {
    return marketBasisSalary(resolveMarketBase(rider).base, SALARY_MARKET_MODEL);
  }
  const base = Number(rider?.current_production_value) > 0
    ? Number(rider.current_production_value)
    : CONTRACT.BASE_VALUE_FALLBACK;
  return Math.max(1, Math.round(base * salaryRateForDivision(rider?.division)));
}

// ~1/3 hver af 1,2,3. rng = makeRng(seed) fra fictionalRiderGenerator.
export function pickContractLength(rng) {
  return CONTRACT.MIN_LENGTH + Math.floor(rng() * (CONTRACT.MAX_LENGTH - CONTRACT.MIN_LENGTH + 1));
}

// #3037 fremadrettet regel (ejer-retning på issuet): START-truppens kontrakter
// (nye hold — signup ELLER relaunch/launch-populationen, som deler samme
// formel) må ALDRIG ende ved den sæson holdet allokeres i. computeContractEndSeason
// = startSeason + length - 1, så en almindelig pickContractLength()-udfald på 1
// giver contract_end_season == startSeason — og releaseExpiredContractRiders
// frigiver ryttere med contract_end_season <= den AFSLUTTEDE sæson, altså ved
// selve den FØRSTE sæsonovergang efter signup, uanset hvor sent i sæsonen holdet
// meldte sig (Easy Riders mistede 9/12 ryttere dagen efter signup 26/7 —
// make-good kørt, se issue-tråden; #3037 er kodefixet der forhindrer gentagelse).
// Løftet MIN til MIN_LENGTH+1 (2) garanterer holdet mindst én HEL sæson efter
// den de blev oprettet i, uanset signup-tidspunkt. Uniform over det resterende
// interval (2..MAX_LENGTH) — IKKE Math.max(2, pickContractLength(rng)), som ville
// skævvride 1'ere til 2'ere og gøre 2 dobbelt så hyppig som 3.
// KUN start-truppens formel — rører ALDRIG runContractSeed (founders/andre ejede
// hold) eller eksisterende kontrakter (ejer-beslutning, se issue-tråden).
export function pickStarterContractLength(rng) {
  const MIN = CONTRACT.MIN_LENGTH + 1;
  return MIN + Math.floor(rng() * (CONTRACT.MAX_LENGTH - MIN + 1));
}

// Sidste aktive sæson = startSeason + length - 1.
export function computeContractEndSeason(startSeasonNumber, length) {
  return startSeasonNumber + length - 1;
}

// #1309 kontrakt-on-acquire: returnér et patch der opretter en standard-kontrakt
// HVIS rytteren er kontraktløs; ellers {} (eksisterende KOMPLET kontrakt arves
// UÆNDRET — regenerér ALDRIG). Bruges af alle erhvervelses-paths (auktion,
// transfer, swap, lån-buyout) så "ejede ryttere har altid salary != null" holder.
// currentSeasonNumber = aktiv sæson-number (default-håndteres af kalderen).
// NB: undefined salary behandles som kontraktløs (== null loose) — det er det
// ønskede for free agents der aldrig har haft en kontrakt.
// #2594: `division` = det ERHVERVENDE holds division (styrer løn-satsen). Udeladt
// division → global sats (bevidst konservativt fallback, ikke en fejl).
//
// #2902 forward-guard (25/7): guarden kræver NU OGSÅ contract_end_season != null —
// før krævede den kun salary != null, hvilket "blindede" patchen for ryttere hvis
// salary blev backfillet (#2746) mens contract_length/contract_end_season forblev
// NULL (starterSquadAllocator satte dengang aldrig disse felter, #2894/#2902 root
// cause — 1.326 ryttere/138 hold, verificeret 25/7). Et fremtidigt erhvervelses-kald
// på sådan en rytter heler den nu i stedet for at arve det ufuldstændige NULL-par
// videre for evigt.
//
// #3620 forward-guard (14/8): guarden må ALDRIG forveksle "kolonnen blev ikke
// SELECT'et" med "kolonnen er NULL". Da #2902 tilføjede contract_end_season til
// guarden, blev den stille falsk for hver kalder hvis rider-SELECT ikke hentede
// kolonnen — `undefined != null` er false, så en rytter MED kontrakt faldt
// igennem og fik kontrakten regenereret (academyTransfer.js promote(): 20 ryttere
// i prod fik contract_length 3 → 2 og udløb rykket frem, se #3620). Derfor:
// er salary sat (rytteren SER kontraktbunden ud) men nøglen contract_end_season
// slet ikke til stede på objektet, kan vi ikke afgøre inherit vs. heal — det er
// en programmeringsfejl hos kalderen, og vi kaster i stedet for at gætte.
// (salary == null → rytteren er kontraktløs uanset udløbssæson, så dér er
// patchen korrekt selv uden kolonnen — fx ægte free agents.)
export function contractOnAcquirePatch(rider, currentSeasonNumber, { division } = {}) {
  if (rider && rider.salary != null && !("contract_end_season" in rider)) {
    throw new Error(
      "contractOnAcquirePatch: rider mangler feltet contract_end_season — " +
      "tilføj kolonnen til kalderens SELECT (ellers regenereres en eksisterende kontrakt, #3620)"
    );
  }
  if (rider && rider.salary != null && rider.contract_end_season != null) return {};
  const length = CONTRACT.DEFAULT_ACQUIRE_LENGTH;
  return {
    salary: computeFrozenSalary({ ...rider, division }),
    contract_length: length,
    contract_end_season: computeContractEndSeason(currentSeasonNumber, length),
  };
}

// #1719 fyrings-/opsigelses-gebyr (ejer-besluttet): manageren betaler en halv
// sæson-løn pr. resterende kontrakt-sæson for at fyre en rytter før tid.
//   gebyr = round(salary * max(1, contract_end_season - currentSeason + 1) * 0.5)
// max(1, ...) sikrer mindst én sæson, så en netop-udløbet/samme-sæson-kontrakt
// stadig koster et halvt års løn (manageren slipper aldrig gratis for en
// lønnet rytter). NULL/0-løn → 0 gebyr (gratis-kontrakt). NULL end-sæson
// behandles som "1 resterende" (gulvet).
export const RELEASE_BUYOUT_RATE = 0.5;

export function computeReleaseBuyoutFee({ salary, contractEndSeason, currentSeason } = {}) {
  const wage = Number(salary);
  if (!Number.isFinite(wage) || wage <= 0) return 0;
  const end = Number(contractEndSeason);
  const current = Number(currentSeason) || 1;
  const remaining = Number.isFinite(end) ? end - current + 1 : 1;
  const seasons = Math.max(1, remaining);
  return Math.round(wage * seasons * RELEASE_BUYOUT_RATE);
}

// #1720 kontraktforlængelse: forlæng kontrakten 1 sæson og genforhandl lønnen med
// SAMME formel som signering (computeFrozenSalary → SALARY_BASIS_MODE). #3360: med
// "market"-grundlaget re-prises lønnen altså mod rytterens AKTUELLE markedsværdi, så
// en rytter der er blevet mere værd også bliver dyrere at beholde. Returnerer et
// patch {salary, contract_length, contract_end_season}.
//
// Den nye udløbssæson forankres i max(eksisterende end, currentSeason) + 1, så
// en udløbet eller kontraktløs (NULL end) rytter altid forlænges til en sæson i
// fremtiden — ikke til en fortidens sæson. contract_length +1 (eller 1 hvis NULL).
export function computeContractExtension({
  current_production_value,
  market_value,
  base_value,
  division,
  contract_end_season,
  contract_length,
  currentSeason = 1,
} = {}) {
  const salary = computeFrozenSalary({ current_production_value, market_value, base_value, division });

  const current = Number(currentSeason) || 1;
  const end = Number(contract_end_season);
  const anchor = Number.isFinite(end) ? Math.max(end, current) : current;
  const newEnd = anchor + 1;

  // #2424 clamp: riders_contract_length_check tillader kun 1..MAX_LENGTH.
  // En rytter der allerede er på MAX_LENGTH må forlænges (ny løn + ny
  // udløbssæson) uden at kontraktlængden crasher DB-constraintet — den
  // clampes i stedet til loftet i stedet for at vokse ubegrænset.
  const len = Number(contract_length);
  const rawLength = (Number.isFinite(len) && len > 0) ? len + 1 : 1;
  const newLength = Math.min(rawLength, CONTRACT.MAX_LENGTH);

  return {
    salary,
    contract_length: newLength,
    contract_end_season: newEnd,
  };
}

// #3143: den seneste sæson en forlængelse må lande på, relativt til den
// AKTUELLE sæson (ikke rytterens eksisterende contract_end_season — ellers
// ville hver forlængelse flytte loftet med sig, og loftet ville aldrig binde).
// Kaldes fra både GET /extend-quote (preview) og POST /extend-contract
// (håndhævelse), så de aldrig kan komme ud af sync.
export function maxAllowedContractEndSeason(currentSeason) {
  return (Number(currentSeason) || 1) + CONTRACT.MAX_EXTENSION_SEASONS_AHEAD;
}

// #3186: loftet var usynligt indtil spilleren blev afvist (Sentry CYCLINGZONE-45,
// 8 spillere/3 dage) — spillerne skal kunne se en tæller ("Extensions used: 2/3")
// FØR de handler, ikke kun en forklaring EFTER et afvist forsøg. Udleder "brugte"
// forlængelser af afstanden fra rytterens NUVÆRENDE contract_end_season til loftet
// (samme forankring som maxAllowedContractEndSeason: currentSeason, ikke rytterens
// egen end-sæson) — så tallet er stabilt uanset om afstanden stammer fra tidligere
// /extend-contract-kald eller fra en kontrakt der blev signeret med flere sæsoner
// på én gang. Ren funktion, delt af GET /extend-quote (begge grene: tilladt/afvist).
export function contractExtensionCapInfo(contractEndSeason, currentSeason) {
  const maxSeason = maxAllowedContractEndSeason(currentSeason);
  const current = Number(currentSeason) || 1;
  const end = Number(contractEndSeason);
  const anchoredEnd = Number.isFinite(end) ? Math.max(end, current) : current;
  const remainingExtensions = Math.max(0, maxSeason - anchoredEnd);
  const usedExtensions = Math.max(
    0,
    Math.min(CONTRACT.MAX_EXTENSION_SEASONS_AHEAD, CONTRACT.MAX_EXTENSION_SEASONS_AHEAD - remainingExtensions)
  );
  return {
    maxSeason,
    maxExtensions: CONTRACT.MAX_EXTENSION_SEASONS_AHEAD,
    usedExtensions,
    remainingExtensions,
  };
}

const WRITE_CONCURRENCY = 25;

// DB-wrapper: sæt kontrakt på alle ejede ryttere. Founders → 2 sæsoner; andre
// ejede → blandet 1-3 (seeded). Free agents (team_id NULL) røres ALDRIG.
// Kører i orchestratoren EFTER allocation + sæson-transition (kender sæson-number).
export async function runContractSeed(supabase, {
  dryRun = true,
  seed = 2026,
  getManagerTeams,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  let founderTeams;
  if (getManagerTeams) {
    founderTeams = await getManagerTeams(supabase);
  } else {
    const { getBetaManagerTeams } = await import("./betaResetService.js");
    founderTeams = await getBetaManagerTeams(supabase);
  }
  const founderIds = new Set(founderTeams.map((t) => t.id).filter(Boolean));

  const seasonRes = await supabase.from("seasons").select("number").eq("status", "active").maybeSingle();
  if (seasonRes?.error) throw new Error(`runContractSeed season lookup: ${seasonRes.error.message}`);
  const startSeason = seasonRes?.data?.number ?? 1;

  // #3360: market_value + base_value SKAL med — de er løn-basen når
  // SALARY_BASIS_MODE er "market". Uden dem falder hver rytter tavst til bundlønnen.
  const owned = await fetchAllRows(() =>
    supabase.from("riders")
      .select("id, team_id, current_production_value, market_value, base_value")
      .not("team_id", "is", null)
      .order("id"));

  // #2594: løn-satsen er per-division — slå ejerholdets division op.
  const teams = await fetchAllRows(() => supabase.from("teams").select("id, division").order("id"));
  const divisionByTeam = new Map(teams.map((t) => [t.id, t.division]));

  const rng = makeRng(seed);
  const patches = owned.map((r) => {
    const length = founderIds.has(r.team_id) ? CONTRACT.FOUNDER_LENGTH : pickContractLength(rng);
    return {
      id: r.id,
      patch: {
        salary: computeFrozenSalary({ ...r, division: divisionByTeam.get(r.team_id) }),
        contract_length: length,
        contract_end_season: computeContractEndSeason(startSeason, length),
      },
    };
  });

  if (dryRun) {
    return { dryRun: true, toSeed: patches.length, founders: founderIds.size, startSeason };
  }

  let seeded = 0;
  for (let i = 0; i < patches.length; i += WRITE_CONCURRENCY) {
    const batch = patches.slice(i, i + WRITE_CONCURRENCY);
    await Promise.all(batch.map(({ id, patch }) =>
      supabase.from("riders").update(patch).eq("id", id).then(({ error }) => {
        if (error) throw new Error(`contract seed ${id}: ${error.message}`);
      })));
    seeded += batch.length;
  }
  return { dryRun: false, seeded, founders: founderIds.size, startSeason };
}
