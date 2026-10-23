// #6967: "Contract expires by season X" / "No contract" i rytterdatabasen.
// contract_by: "" = ingen filtrering, "none" = ingen kontrakt (contract_end_season
// NULL), "<n>" = kontrakt udloeber senest saeson n (<=; ryttere uden kontrakt
// udelukkes). Rent modul saa node --test kan importere det (ingen JSX).

export const CONTRACT_NONE = "none";

export type ContractFilter = { kind: "none" } | { kind: "by"; season: number };

/** Returnerer det aktive filter, eller null naar filteret ikke er aktivt. */
export function parseContractFilter(contractBy: string | null | undefined): ContractFilter | null {
  if (contractBy === CONTRACT_NONE) return { kind: "none" };
  const season = parseInt(String(contractBy ?? ""), 10);
  return Number.isFinite(season) ? { kind: "by", season } : null;
}

export function contractFilterMatches(
  contractEndSeason: number | string | null | undefined,
  contractBy: string | null | undefined,
): boolean {
  const parsed = parseContractFilter(contractBy);
  if (!parsed) return true;
  if (parsed.kind === "none") return contractEndSeason == null;
  return contractEndSeason != null && Number(contractEndSeason) <= parsed.season;
}
