// trainingRoster — klient-side gruppering/sortering af trænings-rosteren (#1480).
//
// Ren visning: tager det allerede-hentede riders-array (med primary_type) og
// grupperer det efter ryttertype, så træningssiden kan vise gruppe-headers og
// gøre det overskueligt hvad hver rytter skal trænes efter. Ingen ny query.
// Frontend beregner IKKE typer — den læser de persisterede riders.primary_type-
// kolonner (beregnet server-side af backfillRiderTypes.js).

import { RIDER_TYPE_KEYS } from "./riderTypeKeys.js";

// Stabil gruppe-orden = samme tie-break-prioritet som RIDER_TYPE_KEYS, med
// ryttere uden type til sidst under en "untyped"-nøgle.
export const UNTYPED_KEY = "untyped";

const TYPE_ORDER = new Map(RIDER_TYPE_KEYS.map((k, i) => [k, i]));

function typeRank(type) {
  return TYPE_ORDER.has(type) ? TYPE_ORDER.get(type) : RIDER_TYPE_KEYS.length;
}

// Grupper ryttere efter primary_type. Returnerer en ordnet liste af grupper:
//   [{ type: "sprinter", riders: [...] }, ..., { type: "untyped", riders: [...] }]
// Inden for hver gruppe bevares den indkommende rækkefølge (rosteren er allerede
// sorteret på lastname fra querien). Tomme grupper udelades.
export function groupRidersByType(riders) {
  const list = Array.isArray(riders) ? riders : [];
  const buckets = new Map();
  for (const rider of list) {
    const type =
      rider.primary_type && TYPE_ORDER.has(rider.primary_type)
        ? rider.primary_type
        : UNTYPED_KEY;
    if (!buckets.has(type)) buckets.set(type, []);
    buckets.get(type).push(rider);
  }
  return [...buckets.entries()]
    .map(([type, groupRiders]) => ({ type, riders: groupRiders }))
    .sort((a, b) => {
      const ra = a.type === UNTYPED_KEY ? Number.MAX_SAFE_INTEGER : typeRank(a.type);
      const rb = b.type === UNTYPED_KEY ? Number.MAX_SAFE_INTEGER : typeRank(b.type);
      return ra - rb;
    });
}
