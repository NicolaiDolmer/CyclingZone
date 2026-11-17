// #8153: en rytter, hvis frigivelse er bestilt midt i et etapeloeb, koerer det loeb
// faerdigt og forlader holdet efter sidste etape (ejer 14/11 + 17/11). Han maa derfor
// ikke auto-udtages til et SENERE loeb: assistenten, generatoren og managerens egen
// "Auto-udfyld" skal se ham, som de ser en solgt rytter med parkeret holdskifte
// (applyRiderEligibilityFilter udelukker pending_team_id). En frigivelse har intet
// modtagerhold, saa markeringen bor i pending_rider_releases, ikke paa riders.
//
// Fable-dom 15/11, fund 2: udtagelsesspaerren daekkede kun den manuelle vej
// (raceSelection.js). Dette modul er den delte kilde for auto-vejene.
//
// Bag kontakten release_defer_8153: slukket = tomt saet uden opslag i tabellen, saa
// auto-vejene er uaendrede mod main. Igangvaerende etapeloeb er frosset i alle
// auto-veje (stages_completed > 0), saa "udeluk ham helt" rammer kun senere loeb.

import { isReleaseDeferEnabled, PENDING_RELEASES_TABLE, isMissingPendingReleasesTable, pendingReleaseErrorMessage } from "./riderReleaseDefer8153.js";

/**
 * Rytter-id'er med en aktiv bestilt frigivelse. Slukket kontakt: tomt saet uden
 * opslag. En laesefejl giver et tomt saet (logget): auto-udtagelsen maa ikke staa
 * stille for hele spillet, og vagten paa riders holder stadig ejerskabet fast.
 *
 * @param {any} supabase
 * @param {{ pageSize?: number }} [opts] pageSize kun til proever (Data API-loftet er 1000 raekker)
 * @returns {Promise<Set<string>>}
 */
export async function loadLeavingRiderIds8153(supabase, { pageSize = 1000 } = {}) {
  try {
    if (!(await isReleaseDeferEnabled(supabase, { fresh: false }))) return new Set();
    const ids = new Set();
    // Ordnet paginering paa den unikke noegle: hele spillets aktive bestillinger, uanset raekkeloftet.
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from(PENDING_RELEASES_TABLE)
        .select("rider_id")
        .eq("status", "pending")
        .order("rider_id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) {
        if (isMissingPendingReleasesTable(error)) return new Set();
        throw new Error(error.message);
      }
      for (const row of data || []) if (row.rider_id) ids.add(row.rider_id);
      if (!data || data.length < pageSize) break;
    }
    return ids;
  } catch (err) {
    // best-effort: fail-open med log; den manuelle udtagelse og vagten paa riders er de haarde graenser.
    console.error(`[pendingRelease8153] auto-udtagelsen kunne ikke laese bestilte frigivelser: ${pendingReleaseErrorMessage(err)}`);
    return new Set();
  }
}

/**
 * Fjern ryttere, der forlader holdet, fra en kandidatliste.
 * @template T
 * @param {T[]|null|undefined} rows
 * @param {Set<string>} leavingIds
 * @param {(row: T) => string} [idOf]
 * @returns {T[]}
 */
export function withoutLeavingRiders8153(rows, leavingIds, idOf = (row) => /** @type {any} */ (row)?.id) {
  const list = rows || [];
  if (!leavingIds?.size) return list;
  return list.filter((row) => !leavingIds.has(idOf(row)));
}
