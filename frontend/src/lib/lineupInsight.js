// frontend/src/lib/lineupInsight.js
// Race Hub S4: rene helpers til opstilling-rute-match. Ingen React.

// #3898: de 15 evne-nøgler til attribut-sortering i holdudtagelsens
// evne-visning (#3809) — samme registry-kilde som Rider Database/rosterets
// evne-kolonner (TeamPage's abilityColumns), ikke en ny liste opfundet her.
import { ABILITY_KEYS } from "./abilities.js";
const ABILITY_KEY_SET = new Set(ABILITY_KEYS);

// Effektivt fit for en rytter på en valgt etape: per-etape når tilgængelig,
// ellers løb-snit. null når intet fit findes (graceful degrade).
export function effectiveStageFit(rider, stageIndex) {
  if (stageIndex != null && Array.isArray(rider?.stageSuitability)) {
    const v = rider.stageSuitability[stageIndex];
    if (Number.isFinite(v)) return v;
  }
  return Number.isFinite(rider?.suitability) ? rider.suitability : null;
}

// id på den valgte rytter med højest effektivt fit (best-fit-nudge). Tiebreak id asc.
export function bestFitRiderId(riders, selectedIds, stageIndex) {
  let best = null, bestScore = -Infinity;
  for (const r of riders) {
    if (!selectedIds.includes(r.id)) continue;
    const f = effectiveStageFit(r, stageIndex);
    if (f == null) continue;
    if (f > bestScore || (f === bestScore && best != null && String(r.id) < String(best))) {
      best = r.id; bestScore = f;
    }
  }
  return best;
}

// #1951: sorterbare nøgler for holdudtagelses-panelet (RaceSelectionPanel).
// Tekst-nøgler matcher de kanoniske rytter-sort-konventioner (firstname/
// primary_type sorterer asc-først, numerisk desc-først — jf. riderSort.js).
export const SELECTION_SORT_KEYS = Object.freeze(["name", "primaryType", "routeMatch", "form", "fatigue"]);

// #3898: sort-nøgler for evne-visningen ("abilities" viewMode) — routeMatch/
// form/fatigue findes ikke som kolonner der, de 15 evner gør. name/primaryType
// forbliver sorterbare i begge tilstande.
export const SELECTION_ABILITY_SORT_KEYS = Object.freeze(["name", "primaryType", ...ABILITY_KEYS]);

// Tekst-nøgler der starter stigende (A→Å). Resten er numeriske og starter
// faldende, så "bedst/højest øverst" er default-klik — samme regel som
// defaultSortDir i riderSort.js.
const ASC_FIRST_SELECTION_KEYS = new Set(["name", "primaryType"]);

// Standard-retning ved FØRSTE klik på en sort-nøgle i udtagelses-panelet.
export function selectionDefaultSortDir(key) {
  return ASC_FIRST_SELECTION_KEYS.has(key) ? "asc" : "desc";
}

// Ekstraher den rå sammenlignings-værdi for en rytter på en given sort-nøgle.
function selectionSortValue(rider, key, stageIndex) {
  switch (key) {
    case "name": return rider?.name ?? "";
    case "primaryType": return rider?.primaryType ?? "";
    case "routeMatch": return effectiveStageFit(rider, stageIndex);
    case "form": return Number.isFinite(rider?.form) ? rider.form : null;
    case "fatigue": return Number.isFinite(rider?.fatigue) ? rider.fatigue : null;
    default:
      // #3898: de 15 evne-nøgler (attribut-sortering i evne-visningen). Læses fra
      // rider.abilities — samme felt RaceSelectionPanel allerede renderer evne-
      // gitteret/-kolonnerne fra (flattenAbilities sker ikke her, panelet sender
      // rå API-data der allerede har abilities-objektet).
      if (ABILITY_KEY_SET.has(key)) {
        const v = rider?.abilities?.[key];
        return Number.isFinite(v) ? v : null;
      }
      return null;
  }
}

// Ren comparator-factory for holdudtagelses-panelet. Tekst sammenlignes med
// localeCompare(..., 'en') (samme som resten af appen), numerisk via subtraktion.
// null/manglende numeriske værdier sorteres altid sidst uanset retning.
// Stabil tiebreak på rytter-id (asc) så lige værdier ikke "hopper".
export function selectionComparator(key, dir, stageIndex) {
  const mul = dir === "asc" ? 1 : -1;
  const numeric = key !== "name" && key !== "primaryType";
  return (a, b) => {
    const av = selectionSortValue(a, key, stageIndex);
    const bv = selectionSortValue(b, key, stageIndex);
    let cmp;
    if (numeric) {
      const an = av == null, bn = bv == null;
      if (an && bn) cmp = 0;
      else if (an) return 1;   // manglende altid sidst
      else if (bn) return -1;  // manglende altid sidst
      else cmp = (av - bv) * mul;
    } else {
      cmp = String(av).localeCompare(String(bv), "en", { sensitivity: "base" }) * mul;
    }
    if (cmp !== 0) return cmp;
    return String(a?.id).localeCompare(String(b?.id), "en"); // stabil tiebreak
  };
}
