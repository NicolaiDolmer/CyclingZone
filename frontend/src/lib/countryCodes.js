// ISO 3166-1 alpha-2 (lowercase, som rider.nationality_code bruger) → IOC 3-bogstavskode.
// UCI/cykling bruger IOC-koder (fx Schweiz = SUI, Holland = NED, Tyskland = GER), som
// afviger fra ISO 3166-1 alpha-3 nogle steder. Tabellen dækker pro-cykling-nationer bredt;
// ukendte koder falder tilbage til 2-bogstav uppercase via getCountryCode3() i countryUtils.
export const ISO2_TO_IOC = {
  // Europa
  ad: "AND", al: "ALB", am: "ARM", at: "AUT", az: "AZE", ba: "BIH", be: "BEL",
  bg: "BUL", by: "BLR", ch: "SUI", cy: "CYP", cz: "CZE", de: "GER", dk: "DEN",
  ee: "EST", es: "ESP", fi: "FIN", fr: "FRA", gb: "GBR", ge: "GEO", gr: "GRE",
  hr: "CRO", hu: "HUN", ie: "IRL", is: "ISL", it: "ITA", li: "LIE", lt: "LTU",
  lu: "LUX", lv: "LAT", mc: "MON", md: "MDA", me: "MNE", mk: "MKD", mt: "MLT",
  nl: "NED", no: "NOR", pl: "POL", pt: "POR", ro: "ROU", rs: "SRB", ru: "RUS",
  se: "SWE", si: "SLO", sk: "SVK", sm: "SMR", tr: "TUR", ua: "UKR", xk: "KOS",
  // Amerika
  ar: "ARG", bo: "BOL", br: "BRA", ca: "CAN", cl: "CHI", co: "COL", cr: "CRC",
  cu: "CUB", do: "DOM", ec: "ECU", gt: "GUA", hn: "HON", mx: "MEX", ni: "NCA",
  pa: "PAN", pe: "PER", pr: "PUR", py: "PAR", sv: "ESA", us: "USA", uy: "URU",
  ve: "VEN",
  // Afrika
  ao: "ANG", bf: "BUR", bj: "BEN", ci: "CIV", cm: "CMR", dz: "ALG", eg: "EGY",
  er: "ERI", et: "ETH", gh: "GHA", ke: "KEN", ma: "MAR", mu: "MRI", na: "NAM",
  ng: "NGR", rw: "RWA", sn: "SEN", tn: "TUN", za: "RSA", zw: "ZIM",
  // Asien & Mellemøsten
  ae: "UAE", bh: "BRN", cn: "CHN", hk: "HKG", id: "INA", il: "ISR", in: "IND",
  ir: "IRI", jp: "JPN", kr: "KOR", kz: "KAZ", lb: "LBN", my: "MAS", ph: "PHI",
  qa: "QAT", sa: "KSA", sg: "SGP", th: "THA", tw: "TPE", uz: "UZB", vn: "VIE",
  // Oceanien
  au: "AUS", nz: "NZL",
};
