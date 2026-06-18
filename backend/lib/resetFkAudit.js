// Pure FK-audit-logik for beta-reset forward-guarden (#1471 · #1464).
//
// Holdt fri for DB-/env-/IO-afhængigheder så den kan unit-testes i `backend-tests`
// (node --test) uden et live skema. backend/scripts/audit-reset-fk-coverage.js wrapper
// den med RPC-kald (audit_foreign_keys) + rapportering + CI-exit-koder.
//
// Bug-klassen: en FK med ON DELETE NO ACTION/RESTRICT der peger på en tabel beta-reset
// SLETTER rækker fra, blokerer reset-deleten medmindre child-referencen nulles/slettes
// først. Auditen sammenligner det live prod-skema mod en checked-in baseline af bevidst
// håndterede FK'er og fejler hvis en NY uhåndteret blocking-FK dukker op.

// Postgres confdeltype 'a' = NO ACTION, 'r' = RESTRICT. Begge blokerer en parent-delete
// hvis en child-row stadig refererer (NO ACTION tjekkes ved statement-slut, men i en enkelt
// DELETE uden forudgående child-håndtering blokerer begge ens for vores formål).
export const BLOCKING_DELETE_ACTIONS = new Set(["NO ACTION", "RESTRICT"]);

// Retningsbestemt, stabil nøgle for en FK: child.column -> parent.
export function fkKey(child, column, parent) {
  return `${child}.${column} -> ${parent}`;
}

function rowKey(row) {
  return fkKey(row.child_table, row.child_column, row.parent_table);
}

function baselineKey(entry) {
  return fkKey(entry.child, entry.column, entry.parent);
}

// classifyResetFkFindings — ren funktion.
//   fkRows:        [{ constraint_name, child_table, child_column, parent_table, delete_action }]
//                  (rå output fra RPC audit_foreign_keys(); delete_action er menneske-tekst)
//   deleteTargets: tabelnavne beta-reset sletter rækker fra (RESET_DELETE_TARGETS)
//   baseline:      [{ child, column, parent, strategy?, handled_by?, unhandled? }]
//
// Returnerer { blocking, critical, stale }:
//   blocking — alle live FK'er der KAN blokere en reset-delete (NO ACTION/RESTRICT → target)
//   critical — blocking FK'er der mangler i baseline ELLER er markeret unhandled (FEJLER CI)
//   stale    — baseline-entries uden tilsvarende live blocking-FK (prune-kandidater, ikke fatal)
export function classifyResetFkFindings({ fkRows = [], deleteTargets = [], baseline = [] } = {}) {
  const targets = new Set(deleteTargets);
  const baselineByKey = new Map(baseline.map((entry) => [baselineKey(entry), entry]));

  const blocking = fkRows.filter(
    (row) => targets.has(row.parent_table) && BLOCKING_DELETE_ACTIONS.has(row.delete_action)
  );

  const critical = [];
  const liveKeys = new Set();
  for (const row of blocking) {
    const key = rowKey(row);
    liveKeys.add(key);
    const entry = baselineByKey.get(key);
    if (!entry) {
      critical.push({
        ...row,
        key,
        reason: `Ny blocking-FK (${row.delete_action}) mod reset-target "${row.parent_table}" mangler i baseline — `
          + `håndtér child-referencen før parent-delete i betaResetService.js og tilføj entry til BLOCKING_FK_BASELINE.`,
      });
    } else if (entry.unhandled) {
      critical.push({
        ...row,
        key,
        reason: `Blocking-FK mod "${row.parent_table}" er markeret unhandled:true i baseline (kendt gap, ikke neutraliseret).`,
      });
    }
  }

  const stale = baseline.filter((entry) => !liveKeys.has(baselineKey(entry)));

  return { blocking, critical, stale };
}
