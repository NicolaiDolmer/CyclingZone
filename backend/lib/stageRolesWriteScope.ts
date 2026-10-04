// #6095 · Hvilke etaper et gem af taktik-intentionen maa skrive.
//
// Foer #6095 var PUT /stage-roles REPLACE for ALLE redigerbare etaper: et "Gem
// etape 2" fra en fane med en aeldre kladde (anden fane, mobilen fra i gaar)
// skrev alle 17 etapers intentioner om (Giro della Penisola 2/10, DM). Serveren
// beskyttede desuden kun KOERTE etaper, ikke etaper hvis start var passeret.
//
// Nu: klienten sender `stages` (de etaper den har aendret) og `base_versions`
// (hver etapes version som den blev indlaest). Kun de etaper erstattes, og kun
// hvis ingen andre har aendret dem siden. Klienten sender stadig HELE kladden i
// `overrides`, saa en ny frontend mod en gammel backend (deploy-vinduet) opfoerer
// sig som foer #6095 i stedet for at slette de etaper der ikke er med.
//
// Ren: ingen DB, ingen I/O.

import { createHash } from 'node:crypto';

export type StageRoleRow = { stage_number: number; rider_id: string; race_role: string; effort: string };

/** Version for en etape uden overrides. */
export const EMPTY_STAGE_VERSION = 'empty';

/** Stabil version pr. etape over holdets override-raekker (raekkefoelge-uafhaengig). */
export function stageVersions(rows: readonly StageRoleRow[]): Record<number, string> {
  const byStage = new Map<number, string[]>();
  for (const row of rows) {
    const list = byStage.get(row.stage_number) ?? [];
    list.push(`${row.rider_id}:${row.race_role}:${row.effort}`);
    byStage.set(row.stage_number, list);
  }
  const out: Record<number, string> = {};
  for (const [stage, list] of byStage) {
    out[stage] = createHash('sha256').update(list.sort().join('|')).digest('hex').slice(0, 16);
  }
  return out;
}

export function versionForStage(versions: Record<number, string>, stage: number): string {
  return versions[stage] ?? EMPTY_STAGE_VERSION;
}

type ScopeInput = {
  stages?: unknown;
  baseVersions?: unknown;
  overrides: readonly StageRoleRow[];
  stageCount: number;
  stagesCompleted: number;
  timeLockedStages: ReadonlySet<number>;
  currentVersions: Record<number, string>;
};

type ScopeResult =
  | { ok: true; stages: number[]; overrides: StageRoleRow[] }
  | { ok: false; error: 'stage_roles_invalid_body' | 'stage_roles_stage_locked' | 'stage_roles_conflict' };

export function resolveWriteScope(input: ScopeInput): ScopeResult {
  const { stageCount, stagesCompleted, timeLockedStages, currentVersions } = input;
  const writable = (sn: number) => sn > stagesCompleted && !timeLockedStages.has(sn);

  let stages: number[];
  if (input.stages === undefined) {
    // Klient fra foer #6095: alle skrivbare etaper, som foer, men aldrig en etape
    // hvis start er passeret. Kladdens kopi af en saadan etape ignoreres.
    stages = [];
    for (let sn = stagesCompleted + 1; sn <= stageCount; sn++) if (writable(sn)) stages.push(sn);
  } else {
    if (!Array.isArray(input.stages)) return { ok: false, error: 'stage_roles_invalid_body' };
    const raw = input.stages as unknown[];
    if (!raw.every((sn) => Number.isInteger(sn) && (sn as number) >= 1 && (sn as number) <= stageCount)
      || new Set(raw).size !== raw.length) {
      return { ok: false, error: 'stage_roles_invalid_body' };
    }
    stages = (raw as number[]).slice().sort((a, b) => a - b);
    if (stages.some((sn) => !writable(sn))) return { ok: false, error: 'stage_roles_stage_locked' };

    if (input.baseVersions !== undefined) {
      if (typeof input.baseVersions !== 'object' || input.baseVersions === null || Array.isArray(input.baseVersions)) {
        return { ok: false, error: 'stage_roles_invalid_body' };
      }
      const base = input.baseVersions as Record<string, unknown>;
      for (const sn of stages) {
        if (base[String(sn)] !== versionForStage(currentVersions, sn)) return { ok: false, error: 'stage_roles_conflict' };
      }
    }
  }

  const inScope = new Set(stages);
  return { ok: true, stages, overrides: input.overrides.filter((o) => inScope.has(o?.stage_number)) };
}
