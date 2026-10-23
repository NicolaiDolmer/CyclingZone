// #6967: "Contract expires by season X" / "No contract" i rytterdatabasen.
// contract_by: "" = ingen filtrering, "none" = ingen kontrakt (contract_end_season
// NULL), "<n>" = kontrakt udloeber senest saeson n (<=; ryttere uden kontrakt
// udelukkes). Rent modul saa node --test kan importere det (ingen JSX).

export const CONTRACT_NONE = "none";

// Returnerer { kind: "none" } | { kind: "by", season } | null (filteret er ikke aktivt).
export function parseContractFilter(contractBy) {
  if (contractBy === CONTRACT_NONE) return { kind: "none" };
  const season = parseInt(contractBy, 10);
  return Number.isFinite(season) ? { kind: "by", season } : null;
}

export function contractFilterMatches(contractEndSeason, contractBy) {
  const parsed = parseContractFilter(contractBy);
  if (!parsed) return true;
  if (parsed.kind === "none") return contractEndSeason == null;
  return contractEndSeason != null && parsed.season != null && Number(contractEndSeason) <= parsed.season;
}
