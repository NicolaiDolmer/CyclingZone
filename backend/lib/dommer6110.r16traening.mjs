// DOMMER #6110 R16 paa traeningsdage: datoens XP regnet GENNEM MOTOREN (Fable-dom 15/11, fund 1).
//
// Ejerens regel R16 (12/11): en evne stiger normalt hoejst 1 point pr. dato, sjaeldent 2,
// aldrig 3 eller mere. Den foerste udgave af dommerens proeve regnede datoens XP som
// xpPerDate * traener * Traen nu * god dag, altsaa med sessionens vaegt 1. Motoren ganger
// sessionens vaegt paa (developmentXp.ts, xpSessionShare via programAbilityWeight), og
// vaegten er op til 2 i dagens katalog (training.js FOCUS_ABILITY_WEIGHT) og 1,5 i v3
// (trainingCatalogV3.js V3_WEIGHT_DELTA). Derfor regnes datoen her med motorens egen
// developmentXpAbilityDelta over ALLE traeningspas i BEGGE kataloger, alle evner (ogsaa
// dem uden for fokus) og alle rytter-typer. Traen nu og den gode dag ganges paa, som
// applyDailyTick goer (dailyTraining.js, XP-grenen).
//
// Filen er ikke en test (ingen .test.-endelse) og koerer ikke af sig selv. Den bruges af
// dommer6110.private-parametre.test.js og af den offentlige dommer6110.r16-regnemaade.test.js.

import { kraev, koebMedPrisliste, EVNER } from "./dommer6110.fixtures.mjs";

/** Alle traeningspas, en rytter kan faa paa en dato, i begge kataloger (i dag og v3). */
export async function traeningsPas() {
  const { sessionIntensityFor, RECOVERY_FOCUS, RECOVERY_INTENSITY } = await kraev(
    "./trainingDayTypes.js", "sessionIntensityFor", "RECOVERY_FOCUS", "RECOVERY_INTENSITY",
  );
  const { applyTrainingCatalog } = await kraev("./trainingCatalogV3.js", "applyTrainingCatalog");
  const pas = [];
  for (const catalogV3 of [false, true]) {
    const tabel = sessionIntensityFor({ catalogV3 });
    for (const [focus, intensity] of [...Object.entries(tabel), [RECOVERY_FOCUS, RECOVERY_INTENSITY]]) {
      // applyTrainingCatalog laegger v3-sessionens evner og vaegte paa programmet, som motoren.
      const program = applyTrainingCatalog({ focus, intensity }, { v3: catalogV3 });
      pas.push({ katalog: catalogV3 ? "v3" : "i dag", program });
    }
  }
  return pas;
}

/**
 * Datoens stoerste XP i én evne for en rytter (alder, potentiale, niveau, traener),
 * regnet af motoren over alle pas, evner og typer. `dagMult` er Traen nu gange god dag.
 *
 * Motorens XP er rytterens XP (xpPerDate: potentiale gange alder, kun afhaengig af om
 * evnen er mental) gange pas, type og traener. Derfor findes det stoerste pas en gang
 * pr. (niveau, traener, mental) paa en referencerytter, og for hver rytter kaldes
 * motoren igen paa netop det pas, saa det rapporterede tal altid er motorens eget.
 */
export async function lavTraeningsdato({ params, staff = null, facilityTier = null, dagMult = 1 }) {
  const { developmentXpAbilityDelta } = await kraev("./developmentXp.ts", "developmentXpAbilityDelta");
  const { XP_RACE_FIT_HOME_STAGES } = await kraev("./developmentXpRaceFit.ts", "XP_RACE_FIT_HOME_STAGES");
  const { abilityMeta } = await kraev("./abilityRegistry.js", "abilityMeta");
  const { TRAINING_CONFIG, programAbilityWeight } = await kraev("./training.js", "TRAINING_CONFIG", "programAbilityWeight");
  const pas = await traeningsPas();
  const typer = [...Object.keys(XP_RACE_FIT_HOME_STAGES), null];
  const mental = (evne) => abilityMeta(evne)?.category === "mental";

  const delta = ({ evne, program, primaryType, alder, potentiale, riderLevel }) => developmentXpAbilityDelta({
    ability: evne, age: alder, potentiale, program, primaryType, secondaryType: null,
    staff, facilityTier, riderLevel, academyRateMult: 1, trainingCfg: TRAINING_CONFIG,
  }, params) * dagMult;

  const REF = { alder: 20, potentiale: params.potentialXp.at(-1).at };
  const stoerst = new Map();
  for (const riderLevel of ["u23", "senior"]) {
    for (const erMental of [false, true]) {
      let bedst = null;
      for (const { katalog, program } of pas) {
        for (const evne of EVNER) {
          if (mental(evne) !== erMental) continue;
          for (const primaryType of typer) {
            const xp = delta({ evne, program, primaryType, riderLevel, ...REF });
            if (!bedst || xp > bedst.xp) bedst = { xp, katalog, program, evne, primaryType };
          }
        }
      }
      stoerst.set(`${riderLevel}:${erMental}`, bedst);
    }
  }

  /** Datoens stoerste XP for rytteren, med hvor den kommer fra. */
  return ({ alder, potentiale, riderLevel }) => [false, true].map((erMental) => {
    const b = stoerst.get(`${riderLevel}:${erMental}`);
    const xp = b ? delta({ evne: b.evne, program: b.program, primaryType: b.primaryType, alder, potentiale, riderLevel }) : 0;
    const vaegt = b ? programAbilityWeight(b.program, b.evne) : null;
    return {
      xp, mental: erMental, evne: b?.evne, vaegt, katalog: b?.katalog, pas: b?.program.focus, type: b?.primaryType,
      hvor: b ? `${b.katalog} ${b.program.focus} (vaegt ${vaegt}) ${b.evne} ${b.primaryType ?? "uden type"}` : "intet pas",
    };
  });
}

/**
 * Brud paa R16 paa traeningsdatoer. `graense(alder, potentiale, niveau)` er det hoejeste
 * tilladte antal point paa datoen. `bar` er bjaelken foer datoen (0,999 = naesten fuld).
 */
export async function traeningsdatoBrud({
  params, pris, staff = null, facilityTier = null, dagMult = 1, bar = 0,
  aldre, potentialer, niveauer = { fra: 1, til: 96 }, graense,
}) {
  const datoXp = await lavTraeningsdato({ params, staff, facilityTier, dagMult });
  const brud = [];
  for (const riderLevel of ["u23", "senior"]) {
    for (const alder of aldre) {
      for (const potentiale of potentialer) {
        for (const d of datoXp({ alder, potentiale, riderLevel })) {
          if (!(d.xp > 0)) continue;
          for (let niveau = niveauer.fra; niveau <= niveauer.til; niveau++) {
            const { point } = koebMedPrisliste({ level: niveau, bar, xp: d.xp }, pris);
            if (point > graense(alder, potentiale, niveau)) {
              brud.push({ point, alder, potentiale, niveau, riderLevel, ...d,
                tekst: `${d.mental ? "mental" : "fysisk"} ${riderLevel} alder ${alder} potentiale ${potentiale} evne ${niveau} via ${d.hvor}: +${point}` });
            }
          }
        }
      }
    }
  }
  return brud;
}

/**
 * "Top og midte roeres ikke" (ejervalg A 14/11, Fable-dom 15/11 fund 2): prisbunden goer
 * KUN lave evner dyrere. Svarer med de fejl, der er i params' prisbund, mod en oevre
 * graense for "lave evner" (`lavGraense`, et ejertal). Tom liste = holder.
 *   1) bunden er sat (R16 loeses med bunden, ejervalg A),
 *   2) bundens graense ligger i det lave omraade (hoejst `lavGraense`),
 *   3) fra graensen og op er prisen formlens egen: base * (1 - niveau/100)^-eksponent.
 */
export function bundUdenforLavtOmraade(params, lavGraense, { xpPriceForNextPoint }) {
  const floor = params?.price?.floor;
  if (!floor) return ["IKKE SAT: talfilen har ingen prisbund (ejervalg A 14/11)"];
  const fejl = [];
  if (!(floor.belowLevel <= lavGraense)) {
    fejl.push(`bundens graense ${floor.belowLevel} ligger over de lave evner (hoejst ${lavGraense})`);
  }
  const { base, exponent } = params.price;
  for (let niveau = Math.ceil(floor.belowLevel); niveau <= 99; niveau++) {
    const formel = base * Math.pow(1 - niveau / 100, -exponent);
    const pris = xpPriceForNextPoint(niveau, params);
    if (Math.abs(pris - formel) > 1e-9 * formel) { fejl.push(`evne ${niveau}: prisen er ikke formlens egen`); break; }
  }
  return fejl;
}

/** Hele aldre/potentialer, som dommerens oevrige R16-proever bruger. */
export const ALDRE = Object.freeze(Array.from({ length: 21 }, (_, i) => 16 + i));
export const POTENTIALER = Object.freeze(Array.from({ length: 11 }, (_, i) => 1 + i * 0.5));
