// Løn-decoupling slice A (#2428) — ren kalibrerings- + gate-logik, DB-fri og
// deterministisk (node --test). Runneren (scripts/salaryDecouplingScorecard.js)
// leverer rækkerne fra ægte prod-data. INGEN live-økonomi rørt (shadow).
//
// Række-form: { current_production_value:number, current_salary:number|null,
//               division:number, value_v4?:number }

// Sats der bevarer den GLOBALE lønbyrde: Σ nuværende_løn / Σ current_production_value
// (kun rækker med både positiv cpv og positiv løn). Så total-lønbyrden er uændret
// ved konstruktion; det interessante er fordelingen (G1 pr. division, G2 talent).
export function calibrateSalaryRate(rows) {
  let sumSalary = 0, sumCpv = 0;
  for (const r of rows) {
    const cpv = Number(r.current_production_value);
    const sal = Number(r.current_salary);
    if (Number.isFinite(cpv) && cpv > 0 && Number.isFinite(sal) && sal > 0) {
      sumSalary += sal;
      sumCpv += cpv;
    }
  }
  return sumCpv > 0 ? sumSalary / sumCpv : null;
}

// Frossen-løn-formel med den nye base (spejler computeFrozenSalary's max(1,round)).
export function projectedSalary(currentProductionValue, rate) {
  const base = Number(currentProductionValue) > 0 ? Number(currentProductionValue) : 0;
  return Math.max(1, Math.round(base * Number(rate)));
}

export function wageBillsByDivision(rows, rate) {
  const byDiv = {};
  for (const r of rows) {
    const div = r.division ?? "ukendt";
    (byDiv[div] ??= { current: 0, projected: 0, count: 0 });
    byDiv[div].current += Number(r.current_salary) || 0;
    byDiv[div].projected += projectedSalary(r.current_production_value, rate);
    byDiv[div].count += 1;
  }
  return byDiv;
}

// G1 (hård): hver divisions projicerede lønbyrde inden for ±tolerance af nuværende.
export function wageBillContinuityGate(bills, tolerance) {
  const rows = [];
  let pass = true;
  for (const [div, b] of Object.entries(bills)) {
    const drift = b.current > 0 ? (b.projected - b.current) / b.current : (b.projected > 0 ? 1 : 0);
    const ok = Math.abs(drift) <= tolerance;
    if (!ok) pass = false;
    rows.push({ division: div, ...b, drift, ok });
  }
  return { pass, tolerance, rows };
}

// G2 (hård): repræsentative talenter → projiceret løn < sponsor, OG løn/værdi-forhold
// lavere end den gamle market_value-kobling (oldRate).
export function talentFixGate(talents, rate, { sponsor, oldRate }) {
  const rows = talents.map((t) => {
    const newSalary = projectedSalary(t.current_production_value, rate);
    const oldSalary = Math.max(1, Math.round(Number(t.value_v4) * oldRate));
    const belowSponsor = newSalary < sponsor;
    const lowerThanOld = newSalary < oldSalary;
    return { ...t, newSalary, oldSalary, belowSponsor, lowerThanOld, ok: belowSponsor && lowerThanOld };
  });
  return { pass: rows.every((r) => r.ok), sponsor, rows };
}

// G4 (hård): ingen projiceret løn over loft (fx maks sponsor).
export function runawayGate(rows, rate, ceiling) {
  let maxSalary = 0;
  for (const r of rows) maxSalary = Math.max(maxSalary, projectedSalary(r.current_production_value, rate));
  return { pass: maxSalary <= ceiling, maxSalary, ceiling };
}
