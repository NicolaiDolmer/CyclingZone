// Seed-data + SQL-generator for countries-tabellen (#844 Slice 1).
//
// Rent, deterministisk modul (ingen DB, ingen I/O) så det kan unit-testes og
// genbruges af backend/scripts/generateCountriesSeed.mjs til at producere den
// seed-blok der indlejres i migrationen database/2026-05-31-countries-table.sql.
//
// Designprincipper:
//   • iso2 er kanonisk nøgle (uppercase) — matcher riders.nationality_code.
//   • Tre akser (ejer-beslutning #844): birth_weight · talent_ceiling ·
//     reputation/reputation_seed. Alle tre seedes konsistent fra én redaktionel
//     PRESTIGE-tier, men er separate kolonner der kan tunes uafhængigt bagefter.
//   • name_en/name_da via Intl.DisplayNames (ICU) — ingen håndskrevne navnelister.
//   • ioc_code: cyklings IOC-koder (UCI bruger dem); udvider frontend
//     countryCodes.js (ISO2_TO_IOC) med de nationer den ikke dækkede.
//   • "No silent caps": ISO2_SOURCE er de faktiske nationer i prod-riders
//     (2026-05-31). buildCountryRows() flagger enhver kode uden continent/ioc.

// ── Kildeliste: distinct riders.nationality_code i prod (2026-05-31, 136 nationer)
export const ISO2_SOURCE = [
  "FR","IT","BE","ES","NL","CO","CN","GB","US","DE","DK","AU","JP","NO","PT","PL",
  "AR","CZ","KR","NZ","CA","TR","CH","AT","RU","PH","MX","SE","VE","EC","SI","DZ",
  "IR","ID","TH","KZ","BR","GT","CL","MY","CR","IE","ZA","HU","RO","MA","SK","ER",
  "EE","GR","BG","RW","UA","HK","AE","TW","VN","SA","IL","MK","UZ","DO","LT","LU",
  "OM","LV","EG","MN","UY","PA","FI","PE","BO","KG","AO","AZ","IN","BY","BJ","ET",
  "BF","CM","MU","ML","RS","GH","IQ","AL","SN","NA","CI","SG","BZ","NG","CY","PY",
  "LK","XK","KE","HR","CU","HN","ME","GE","TN","JM","CD","PR","ZW","KH","SY","IS",
  "PK","UG","MT","GU","TT","QA","BH","GY","KW","GA","LI","GD","LA","MD","CW","BA",
  "AD","LS","BM","AM","BS","PS","SM","BN","TL","MC",
];

// ── IOC 3-bogstavskoder (cykling/UCI). Basis = frontend countryCodes.js,
//    udvidet med nationer den ikke dækkede. Uppercase ISO2 → IOC.
export const ISO2_TO_IOC = {
  // Europa
  AD:"AND", AL:"ALB", AM:"ARM", AT:"AUT", AZ:"AZE", BA:"BIH", BE:"BEL",
  BG:"BUL", BY:"BLR", CH:"SUI", CY:"CYP", CZ:"CZE", DE:"GER", DK:"DEN",
  EE:"EST", ES:"ESP", FI:"FIN", FR:"FRA", GB:"GBR", GE:"GEO", GR:"GRE",
  HR:"CRO", HU:"HUN", IE:"IRL", IS:"ISL", IT:"ITA", LI:"LIE", LT:"LTU",
  LU:"LUX", LV:"LAT", MC:"MON", MD:"MDA", ME:"MNE", MK:"MKD", MT:"MLT",
  NL:"NED", NO:"NOR", PL:"POL", PT:"POR", RO:"ROU", RS:"SRB", RU:"RUS",
  SE:"SWE", SI:"SLO", SK:"SVK", SM:"SMR", TR:"TUR", UA:"UKR", XK:"KOS",
  // Amerika
  AR:"ARG", BO:"BOL", BR:"BRA", CA:"CAN", CL:"CHI", CO:"COL", CR:"CRC",
  CU:"CUB", DO:"DOM", EC:"ECU", GT:"GUA", HN:"HON", MX:"MEX", PA:"PAN",
  PE:"PER", PR:"PUR", PY:"PAR", US:"USA", UY:"URU", VE:"VEN",
  BZ:"BIZ", JM:"JAM", TT:"TTO", GY:"GUY", GD:"GRN", BS:"BAH", BM:"BER", CW:"CUW",
  // Afrika
  AO:"ANG", BF:"BUR", BJ:"BEN", CI:"CIV", CM:"CMR", DZ:"ALG", EG:"EGY",
  ER:"ERI", ET:"ETH", GH:"GHA", KE:"KEN", MA:"MAR", MU:"MRI", NA:"NAM",
  NG:"NGR", RW:"RWA", SN:"SEN", TN:"TUN", ZA:"RSA", ZW:"ZIM",
  ML:"MLI", CD:"COD", UG:"UGA", GA:"GAB", LS:"LES",
  // Asien & Mellemøsten
  AE:"UAE", BH:"BRN", CN:"CHN", HK:"HKG", ID:"INA", IL:"ISR", IN:"IND",
  IR:"IRI", JP:"JPN", KR:"KOR", KZ:"KAZ", MY:"MAS", PH:"PHI", QA:"QAT",
  SA:"KSA", SG:"SGP", TH:"THA", TW:"TPE", UZ:"UZB", VN:"VIE",
  KG:"KGZ", MN:"MGL", IQ:"IRQ", OM:"OMA", SY:"SYR", PK:"PAK", KH:"CAM",
  LA:"LAO", BN:"BRU", TL:"TLS", LK:"SRI", KW:"KUW", PS:"PLE",
  // Oceanien
  AU:"AUS", NZ:"NZL", GU:"GUM",
};

// ── Kontinent per nation (best-effort, UCI-sport-konvention: TR/GE/AM/AZ/IL = Europa-tour-region)
export const ISO2_TO_CONTINENT = {
  // Europe
  FR:"Europe", IT:"Europe", BE:"Europe", ES:"Europe", NL:"Europe", GB:"Europe",
  DE:"Europe", DK:"Europe", NO:"Europe", PT:"Europe", PL:"Europe", CZ:"Europe",
  CH:"Europe", AT:"Europe", RU:"Europe", SE:"Europe", SI:"Europe", EE:"Europe",
  GR:"Europe", BG:"Europe", UA:"Europe", LT:"Europe", LU:"Europe", LV:"Europe",
  FI:"Europe", IE:"Europe", HU:"Europe", RO:"Europe", SK:"Europe", MK:"Europe",
  HR:"Europe", ME:"Europe", GE:"Europe", IS:"Europe", MT:"Europe", CY:"Europe",
  XK:"Europe", BA:"Europe", AD:"Europe", SM:"Europe", MC:"Europe", LI:"Europe",
  BY:"Europe", MD:"Europe", AL:"Europe", RS:"Europe", AM:"Europe", AZ:"Europe",
  TR:"Europe",
  // Asia
  CN:"Asia", JP:"Asia", KR:"Asia", PH:"Asia", ID:"Asia", TH:"Asia", KZ:"Asia",
  MY:"Asia", IR:"Asia", HK:"Asia", TW:"Asia", VN:"Asia", SA:"Asia", IL:"Asia",
  UZ:"Asia", OM:"Asia", MN:"Asia", KG:"Asia", IN:"Asia", AE:"Asia", QA:"Asia",
  BH:"Asia", SY:"Asia", PK:"Asia", KH:"Asia", LA:"Asia", BN:"Asia", TL:"Asia",
  IQ:"Asia", KW:"Asia", LK:"Asia", SG:"Asia", PS:"Asia",
  // Americas
  CO:"Americas", US:"Americas", AR:"Americas", CA:"Americas", MX:"Americas",
  VE:"Americas", EC:"Americas", BR:"Americas", GT:"Americas", CL:"Americas",
  CR:"Americas", DO:"Americas", UY:"Americas", PA:"Americas", PE:"Americas",
  BO:"Americas", BZ:"Americas", PY:"Americas", CU:"Americas", HN:"Americas",
  JM:"Americas", PR:"Americas", TT:"Americas", GY:"Americas", GD:"Americas",
  BS:"Americas", BM:"Americas", CW:"Americas",
  // Africa
  DZ:"Africa", MA:"Africa", ER:"Africa", RW:"Africa", AO:"Africa", BJ:"Africa",
  ET:"Africa", BF:"Africa", CM:"Africa", MU:"Africa", ML:"Africa", GH:"Africa",
  SN:"Africa", NA:"Africa", CI:"Africa", NG:"Africa", KE:"Africa", CD:"Africa",
  ZW:"Africa", UG:"Africa", GA:"Africa", LS:"Africa", TN:"Africa", EG:"Africa",
  ZA:"Africa",
  // Oceania
  AU:"Oceania", NZ:"Oceania", GU:"Oceania",
};

// ── Redaktionelle prestige-tiers (cykelsport-realisme, IKKE befolkning).
//    JUSTÉR HER + kør generateCountriesSeed.mjs igen. Hver tier sætter alle tre
//    akser; reputation starter = reputation_seed.
export const PRESTIGE_TIER_VALUES = {
  S: { birth_weight: 100, talent_ceiling: 1.45, reputation_seed: 90 }, // cykel-supermagter
  A: { birth_weight: 62,  talent_ceiling: 1.25, reputation_seed: 76 }, // stærke nationer
  B: { birth_weight: 32,  talent_ceiling: 1.10, reputation_seed: 62 }, // etablerede WT-bidragydere
  C: { birth_weight: 14,  talent_ceiling: 0.98, reputation_seed: 50 }, // fremvoksende
  D: { birth_weight: 5,   talent_ceiling: 0.82, reputation_seed: 40 }, // lang hale (default)
};

// Eksplicitte tier-tildelinger; alt ikke nævnt = "D".
export const PRESTIGE_TIER_OF = {
  // S
  BE:"S", FR:"S", IT:"S", ES:"S", NL:"S", SI:"S",
  // A
  DK:"A", GB:"A", DE:"A", NO:"A", AU:"A", CO:"A", CH:"A", US:"A", PT:"A", AT:"A", SK:"A", ER:"A",
  // B
  PL:"B", CZ:"B", IE:"B", KZ:"B", CA:"B", NZ:"B", RU:"B", LU:"B", EE:"B", SE:"B",
  LV:"B", LT:"B", RW:"B", UA:"B", FI:"B", BY:"B",
  // C
  AR:"C", BR:"C", MX:"C", VE:"C", EC:"C", CL:"C", CR:"C", GT:"C", JP:"C", CN:"C",
  KR:"C", ZA:"C", MA:"C", DZ:"C", TR:"C", GR:"C", HU:"C", RO:"C", BG:"C", HR:"C",
  RS:"C", IL:"C", UY:"C", PE:"C", BO:"C", CU:"C", CY:"C", IS:"C", MK:"C", GE:"C",
  AL:"C", ME:"C", MD:"C", AM:"C", AZ:"C", IR:"C",
};

const NAME_OVERRIDE_EN = { XK: "Kosovo" };
const NAME_OVERRIDE_DA = { XK: "Kosovo" };

const enNames = new Intl.DisplayNames(["en"], { type: "region" });
const daNames = new Intl.DisplayNames(["da"], { type: "region" });

function regionName(displayNames, code, override) {
  if (override[code]) return override[code];
  const name = displayNames.of(code);
  // Intl falder tilbage til selve koden for ukendte regioner → behandl som mangel.
  return name && name !== code ? name : null;
}

/**
 * Byg de fulde country-rækker (rene objekter, ingen DB).
 * @param {object} [opts]
 * @param {string[]} [opts.codes]  ISO2-liste (default: ISO2_SOURCE)
 * @returns {{ rows: object[], warnings: string[] }}
 */
export function buildCountryRows({ codes = ISO2_SOURCE } = {}) {
  const warnings = [];
  const seen = new Set();
  const rows = [];

  for (const raw of codes) {
    const iso2 = String(raw).trim().toUpperCase();
    if (seen.has(iso2)) {
      warnings.push(`duplikat ISO2 i kildeliste: ${iso2}`);
      continue;
    }
    seen.add(iso2);

    const tier = PRESTIGE_TIER_OF[iso2] || "D";
    const t = PRESTIGE_TIER_VALUES[tier];
    const name_en = regionName(enNames, iso2, NAME_OVERRIDE_EN);
    const name_da = regionName(daNames, iso2, NAME_OVERRIDE_DA);
    const ioc_code = ISO2_TO_IOC[iso2] || null;
    const continent = ISO2_TO_CONTINENT[iso2] || null;

    if (!name_en) warnings.push(`mangler name_en (Intl ukendt): ${iso2}`);
    if (!ioc_code) warnings.push(`mangler ioc_code: ${iso2}`);
    if (!continent) warnings.push(`mangler continent: ${iso2}`);

    rows.push({
      iso2,
      name_en: name_en || iso2, // sidste fallback: koden selv (NOT NULL-garanti)
      name_da: name_da || null,
      ioc_code,
      continent,
      birth_weight: t.birth_weight,
      talent_ceiling: t.talent_ceiling,
      reputation: t.reputation_seed,
      reputation_seed: t.reputation_seed,
      _tier: tier, // kun til inspektion/test; ikke en kolonne
    });
  }

  rows.sort((a, b) => a.iso2.localeCompare(b.iso2));
  return { rows, warnings };
}

function sqlStr(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Renderer rækker til et idempotent INSERT (ON CONFLICT DO NOTHING).
 * @param {object[]} rows
 * @returns {string}
 */
export function rowsToInsertSql(rows) {
  const values = rows
    .map((r) => {
      const cells = [
        sqlStr(r.iso2),
        sqlStr(r.name_en),
        sqlStr(r.name_da),
        sqlStr(r.ioc_code),
        sqlStr(r.continent),
        r.birth_weight,
        r.talent_ceiling,
        r.reputation,
        r.reputation_seed,
      ];
      return `  (${cells.join(", ")})`;
    })
    .join(",\n");

  return (
    "INSERT INTO public.countries\n" +
    "  (iso2, name_en, name_da, ioc_code, continent, birth_weight, talent_ceiling, reputation, reputation_seed)\n" +
    "VALUES\n" +
    values +
    "\nON CONFLICT (iso2) DO NOTHING;"
  );
}
