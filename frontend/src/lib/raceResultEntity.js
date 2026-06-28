// #1485 — Resolver for visnings-entiteten bag en race_results-række.
//
// Holdklassement-rækker (result_type="team") bærer KUN team_id — intet rider_id,
// intet rider_name, og team_name er null fra motoren (raceRunner.js:pushTeam).
// Frontend-queryen joiner holdet direkte (team:team_id(id,name)) så vi kan vise
// holdnavnet. Denne rene resolver afgør om en række er et HOLD eller en RYTTER og
// returnerer det rette navn + link-id, så ResultTable slipper for at gætte i JSX.
//
// Returnerer { kind: "team"|"rider", name|null, linkId|null, nationality|null }.
// Aldrig kast — en uventet/tom række degraderer til en navnløs rytter-celle ("—").

export function isTeamResult(row) {
  if (!row) return false;
  if (row.result_type === "team") return true;
  // Defensivt: en række uden rytter men med hold = holdklassement.
  return row.rider_id == null && row.team_id != null;
}

function riderDisplayName(row) {
  const r = row?.rider;
  if (r && (r.firstname || r.lastname)) {
    return `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim();
  }
  return row?.rider_name || null;
}

export function resultEntity(row) {
  if (isTeamResult(row)) {
    return {
      kind: "team",
      name: row?.team?.name ?? row?.team_name ?? null,
      linkId: row?.team?.id ?? row?.team_id ?? null,
      nationality: null,
    };
  }
  return {
    kind: "rider",
    name: riderDisplayName(row),
    linkId: row?.rider?.id ?? null,
    nationality: row?.rider?.nationality_code ?? null,
  };
}
