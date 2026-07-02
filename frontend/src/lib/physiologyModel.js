// Fysiologi-model til Fysiologi-fanen (#2000) — ren JS (node --test).
//
// Afleder de størrelser fanen viser, men som ikke er lagret direkte, fra de felter
// der ER på rider_physiology_profiles (FTP, watt-punkter 5s/15s/1m/5m, W′, vægt):
//   • Critical Power (CP) + W′ — 2-parameter-modellen.
//   • Power-duration-kurve inkl. 10min/20min (afledt af CP-modellen, ikke lagret).
//   • Coggan effekt-zoner Z1–Z7 fra FTP.
// Samme model bruges på rytteren OG på divisions-snittet, så kurverne er
// sammenlignelige. Manglende felter → null (kalderen guard'er; må aldrig crashe).

const num = (v) => {
  if (v == null) return null; // null/undefined = manglende, ikke 0 (Number(null)===0)
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Critical Power: CP forankres så modellen rammer FTP ved 60 min (3600 s):
//   P(t) = CP + W′/t  ⇒  CP = ftp_watts − W′_joule/3600.
// W′ = high_intensity_energy_kj (lagret, kanonisk). Returnerer null hvis FTP/W′ mangler.
export function criticalPower(phys) {
  const ftpWatts = num(phys?.ftp_watts);
  const wPrimeKj = num(phys?.high_intensity_energy_kj);
  if (ftpWatts == null || wPrimeKj == null) return null;
  const cpWatts = Math.round(ftpWatts - (wPrimeKj * 1000) / 3600);
  return { cpWatts, wPrimeKj };
}

// Kurve-punkter i rækkefølge. Korte varigheder = MÅLTE watt-punkter (W/kg × vægt);
// 10/20 min = afledt af CP-modellen; FTP = lagret ftp_watts.
export const CURVE_POINTS = Object.freeze([
  { key: "5s", seconds: 5, field: "power_5s_wkg" },
  { key: "15s", seconds: 15, field: "power_15s_wkg" },
  { key: "1m", seconds: 60, field: "power_1m_wkg" },
  { key: "5m", seconds: 300, field: "power_5m_wkg" },
  { key: "10m", seconds: 600, model: true },
  { key: "20m", seconds: 1200, model: true },
  { key: "ftp", seconds: 3600, ftp: true },
]);

// Watt-profil-barerne (delmængde af kurven, jf. handoff).
export const WATT_PROFILE_KEYS = Object.freeze(["5s", "1m", "5m", "10m", "20m", "ftp"]);

// Power-duration-kurve: [{ key, seconds, watts, wkg }]. Monoton ikke-stigende
// håndhæves (de afledte 10/20min klampes ind i [ftp, forrige målte] så plottet
// aldrig knækker opad). Returnerer null hvis vægt eller FTP mangler.
export function powerDurationCurve(phys) {
  const weight = num(phys?.weight_kg);
  const ftpWatts = num(phys?.ftp_watts);
  const cp = criticalPower(phys);
  if (weight == null || weight <= 0 || ftpWatts == null || !cp) return null;
  const wPrimeJ = cp.wPrimeKj * 1000;

  const out = [];
  let prevWatts = Infinity;
  for (const p of CURVE_POINTS) {
    let watts;
    if (p.ftp) {
      watts = ftpWatts;
    } else if (p.model) {
      watts = cp.cpWatts + wPrimeJ / p.seconds;
    } else {
      const wkg = num(phys?.[p.field]);
      if (wkg == null) return null;
      watts = wkg * weight;
    }
    // Gulv = FTP (ingen viste varigheder ≤60 min ligger under 60-min-FTP), loft =
    // forrige (kortere) varighed → monoton ikke-stigende, og FTP-ankeret bevares
    // selv hvis et målt punkt mod forventning skulle ligge under FTP (anomali-data).
    watts = Math.min(Math.max(watts, ftpWatts), prevWatts);
    prevWatts = watts;
    out.push({ key: p.key, seconds: p.seconds, watts, wkg: watts / weight });
  }
  return out;
}

// Coggan-effekt-zoner som fraktioner af FTP (samme grænser som race-engine-referencen).
const ZONE_DEFS = Object.freeze([
  { z: "Z1", loFrac: 0, hiFrac: 0.55 },
  { z: "Z2", loFrac: 0.56, hiFrac: 0.75 },
  { z: "Z3", loFrac: 0.76, hiFrac: 0.90 },
  { z: "Z4", loFrac: 0.91, hiFrac: 1.05 },
  { z: "Z5", loFrac: 1.06, hiFrac: 1.20 },
  { z: "Z6", loFrac: 1.21, hiFrac: 1.50 },
  { z: "Z7", loFrac: 1.51, hiFrac: 2.0 },
]);

// Z1–Z7 med watt-grænser afledt af FTP. Returnerer [] hvis FTP mangler/ugyldig.
export function cogganZones(ftpWatts) {
  const ftp = num(ftpWatts);
  if (ftp == null || ftp <= 0) return [];
  return ZONE_DEFS.map((d) => ({
    z: d.z,
    loFrac: d.loFrac,
    hiFrac: d.hiFrac,
    loWatts: Math.round(ftp * d.loFrac),
    hiWatts: Math.round(ftp * d.hiFrac),
  }));
}
