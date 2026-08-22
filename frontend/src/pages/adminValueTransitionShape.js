// #3750/#4000 — ren logik for admin-siden "Værdi-overgangen": afledte rækker,
// filtrering, sortering og opsummering. Udtrukket af AdminValueTransitionPage.jsx
// så den kan testes med node --test uden DOM/JSX (repo-konvention, jf.
// balanceDriftShape.js).

export const C_PRESETS = Object.freeze({
  fresh: 0.894, // seneste 30-dages forhandlings-median (målt 21/8, anbefalet)
  median90: 0.666, // 90-dages-medianen (den oprindelige gate-definition)
});

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

export function deltaPct(before, after) {
  const b = num(before);
  const a = num(after);
  if (b == null || b <= 0 || a == null) return null;
  return ((a - b) / b) * 100;
}

// Værdi-fanen: efter = dæmpet værdi × c (niveauet er en ren multiplikator).
export function buildValueRows(rows, c) {
  const cc = num(c);
  return (rows || []).map((r) => {
    const after = r.valueDamped == null || cc == null ? null : Math.round(r.valueDamped * cc);
    return { ...r, valueAfter: after, valueDeltaPct: deltaPct(r.valueNow, after) };
  });
}

// Løn-fanen: forventet S3-løn er c-uafhængig (løn = CPV × global sats; c rører
// kun værdien). Med/uden dæmpning viser begge udfald af flip-beslutningen.
export function buildSalaryRows(rows) {
  return (rows || []).map((r) => ({
    ...r,
    salaryDeltaPct: deltaPct(r.salaryNow, r.salaryExpected),
    salaryDeltaNoDampPct: deltaPct(r.salaryNow, r.salaryExpectedNoDamp),
  }));
}

// includeAcademy: løn-fanen tæller akademiryttere med (søndagens genberegning
// omfatter dem, ejer-krav 22/8); værdi-fanen holder dem ude (symbolsk værdi, #4001).
export function filterRows(rows, { q = "", type = "all", humanOnly = true, includeAcademy = true } = {}) {
  const needle = q.trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (humanOnly && r.teamIsAi) return false;
    if (!includeAcademy && r.isAcademy) return false;
    if (type !== "all" && r.valuationType !== type) return false;
    if (needle) {
      const hay = `${r.name ?? ""} ${r.teamName ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

// null sorteres altid sidst, uanset retning.
export function sortRows(rows, sortKey, dir = "desc") {
  const sign = dir === "asc" ? 1 : -1;
  return [...(rows || [])].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string" || typeof bv === "string") {
      return sign * String(av).localeCompare(String(bv), "da");
    }
    return sign * (Number(av) - Number(bv));
  });
}

export function summarize(rows, { beforeKey, afterKey }) {
  let before = 0;
  let after = 0;
  let n = 0;
  for (const r of rows || []) {
    const b = num(r[beforeKey]);
    const a = num(r[afterKey]);
    if (b != null) before += b;
    if (a != null) after += a;
    n += 1;
  }
  return { n, before, after, deltaPct: deltaPct(before, after) };
}

export function typeOptions(rows) {
  const seen = new Set();
  for (const r of rows || []) {
    if (r.valuationType) seen.add(r.valuationType);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, "da"));
}
