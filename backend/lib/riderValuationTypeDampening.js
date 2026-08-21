// #4000 — type-dæmpning i værdiformlen: n-vægtet regularisering af
// fit.offset[type] (V4-modellens karriere-NPV-koefficienter,
// riderValuationModelV4.json). SLÅET FRA (TYPE_DAMPENING_ENABLED = false) —
// ændrer INTET i live adfærd før et eksplicit, ejer-godkendt flip.
//
// Baggrund (issue #4000, ejer-godkendt 20/8): offset[type] er fittet på meget
// skæve stikprøvestørrelser (puncheur n=19 ⇒ 7,9x multiplikator, gc n=34 ⇒
// 1,6x, mod tt n=2.622). Målt scorecard (#4003-harnesset,
// docs/audits/2026-08-20-4000-type-daempning-scorecard.md): offset-
// regularisering ALENE med k=100 er ejerens anbefalede scenarie — fit.alpha
// forbliver 1,0, urørt (alpha alene gjorde puncheur/gc RELATIVT DYRERE efter
// normalisering — se scorecardets "overraskende fund").
//
// BINDENDE RÆKKEFØLGE (kommentar på #3353, ejer-godkendt 20/8):
// niveaukorrektionen (#3449-c) appliceres FØR denne dæmpning flippes. De to
// må ALDRIG køre samtidig eller omvendt.
//
// FLIP VED CUTOVER = sæt TYPE_DAMPENING_ENABLED til true herunder (ÉN linje).
// Ingen andre ændringer nødvendige — alle produktions-læsesteder for
// riderValuationModelV4.json (riderValueRefresh.js, starterSquadAllocator.js,
// riderProgressionEngine.js, backfillCores.js ×2, routes/api.js) router
// igennem applyTypeDampening() nedenfor.
//
// MÅ IKKE sættes til true uden ejerens eksplicitte go PÅ cutover-tidspunktet
// (dvs. SAMMEN med #3449-c, ikke før).
export const TYPE_DAMPENING_OFFSET_K = 100;
export const TYPE_DAMPENING_ENABLED = false;

// Sum-neutraliserings-faktoren. Doktrinen bag ejer-godkendelsen 20/8 er at
// dæmpningen flytter FORDELINGEN mellem typer, ikke NIVEAUET
// (typeDampeningScenarios4000.mjs's normalizationFactor) — niveauet ejes af
// #3449-niveaukorrektionen (c). Uden faktoren ville flippet trække niveauet
// markant UNDER det c netop har kalibreret mod markedet. V4 er log-additiv
// (predictProductionLn: a + b·O + c·O² + offset), så én global værdi-skalar =
// ln(faktoren) lagt til hvert offset.
//
// VÆRDIEN er målt 21/8 på KORREKTIONS-populationen (6.342 ejede+AI ryttere,
// ekskl. bank/test/frosset/retired/academy — samme population som
// marketValueLevelCorrectionApply): Σ i dag 300.670.817 / Σ rå-dæmpet
// 261.801.561 = 1,1485. Scorecardets ×1,230 (20/8) var målt på den FULDE
// 8.945-population inkl. bank/akademi og er derfor +7,1 % for høj på den
// population korrektionen faktisk gælder. Genmål med
// scripts/buildValueTransitionPreview.js --dry-run (Σ dæmpet skal ≈ Σ i dag)
// hvis flippet udskydes mere end få dage. Fundet + rettet 21/8
// (session-audit på #3750/#4000).
export const TYPE_DAMPENING_NORMALIZATION = 1.1485;

/**
 * n-vægtet regularisering af ÉN offset-værdi mod 0 (midten).
 * n/(n+k) → 1 for store n (offset stort set urørt), → 0 for små n (offset → 0).
 *
 * Matematisk identisk med regularizeOffset i
 * backend/scripts/dev/lib/typeDampeningScenarios4000.mjs (#4003-harnesset,
 * som producerede det scorecard ejeren godkendte k=100 ud fra). Bevidst
 * duplikeret her i stedet for importeret — denne fil er PRODUKTIONSKODE
 * (skibbes), scripts/dev/ er dev-only måle-tooling og skal ikke være en
 * runtime-dependency for backend-serveren. Delt parity-test
 * (riderValuationTypeDampening.test.js) verificerer at de to
 * implementeringer forbliver byte-identiske — hold dem i sync.
 *
 * @param {number} offset  fittet offset[type]
 * @param {number} n       antal fit-observationer for typen (model.type_stats[type].n)
 * @param {number} k       regulariserings-styrke (større k = mere dæmpning)
 * @returns {number}
 */
export function regularizeOffset(offset, n, k) {
  const o = Number(offset);
  const nn = Number(n);
  const kk = Number(k);
  if (!Number.isFinite(o)) return o;
  if (!Number.isFinite(nn) || nn < 0 || !Number.isFinite(kk) || kk < 0) return o;
  const weight = nn / (nn + kk);
  return o * weight;
}

/**
 * Regulariserer en HEL offset-tabel mod 0, n-vægtet pr. type.
 * @param {Record<string, number>} offsetTable  model.fit.offset
 * @param {Record<string, {n: number}>} typeStats  model.type_stats
 * @param {number} k
 * @returns {Record<string, number>}
 */
export function regularizeOffsetTable(offsetTable, typeStats, k) {
  const out = {};
  for (const [type, offset] of Object.entries(offsetTable || {})) {
    const n = typeStats?.[type]?.n;
    out[type] = Number.isFinite(Number(n)) ? regularizeOffset(offset, n, k) : offset;
  }
  return out;
}

/**
 * Anvender type-dæmpning på et V4-model-objekt HVIS TYPE_DAMPENING_ENABLED er
 * true, ellers returnerer den model UÆNDRET (samme reference — ingen kopi,
 * intet overhead når slået fra). fit.alpha røres ALDRIG (ejer-anbefaling
 * #4000: offset-regularisering ALENE, k=100).
 *
 * Alle produktions-callere skal route deres indlæste riderValuationModelV4.json
 * gennem denne funktion (se filens header for listen) — det er DET der gør
 * cutover-flippet til én linje i stedet for et scatter af ændringer.
 *
 * @param {object|null} model  riderValuationModelV4.json-objektet (eller null)
 * @returns {object|null} model, evt. med regulariseret fit.offset
 */
/**
 * Ren transformation: regularisér offset-tabellen (n-vægtet mod 0) og læg
 * derefter ln(normalization) til HVERT offset. V4 er log-additiv
 * (predictProductionLn: a + b·O + c·O² + offset), så log-forskydningen
 * multiplicerer enhver prediktion med normaliserings-faktoren —
 * offsetFloor-fallbacken i predictProductionLn følger automatisk med, da den
 * er Math.min over den transformerede tabel.
 *
 * @param {Record<string, number>} offsetTable  model.fit.offset
 * @param {Record<string, {n: number}>} typeStats  model.type_stats
 * @param {number} k
 * @param {number} normalization  global værdi-skalar (1 = ingen)
 * @returns {Record<string, number>}
 */
export function buildDampenedOffsetTable(offsetTable, typeStats, k, normalization) {
  const regularized = regularizeOffsetTable(offsetTable, typeStats, k);
  const norm = Number(normalization);
  const logShift = Number.isFinite(norm) && norm > 0 ? Math.log(norm) : 0;
  const out = {};
  for (const [type, value] of Object.entries(regularized)) {
    out[type] = Number.isFinite(Number(value)) ? Number(value) + logShift : value;
  }
  return out;
}

export function applyTypeDampening(model) {
  if (!TYPE_DAMPENING_ENABLED) return model;
  if (!model?.fit?.offset || !model?.type_stats) return model;
  return {
    ...model,
    fit: {
      ...model.fit,
      offset: buildDampenedOffsetTable(
        model.fit.offset,
        model.type_stats,
        TYPE_DAMPENING_OFFSET_K,
        TYPE_DAMPENING_NORMALIZATION
      ),
    },
  };
}
