// #8386 · Taktik på telefonen, udgave B: de rene regler bag listen (ingen React, ingen I/O).
//
// Ejerens beslutninger 17/11 (#8298):
// - Sorteringsknap over listen: rolle, rutematch, rating, form, træthed. Standard er rolle
//   med de højeste roller i spillets eksisterende hierarki øverst (kaptajnen først), hver
//   gang siden åbnes. Et andet valg gælder kun den visning.
// - En tynd bjælke siger, når en ANDEN etape end den åbne har ugemte ændringer.
import { roleRank } from "../../../lib/stageRoleVocabulary.ts";

export type PhoneSortKey = "role" | "routeMatch" | "rating" | "form" | "fatigue";
export const PHONE_SORT_KEYS: readonly PhoneSortKey[] = ["role", "routeMatch", "rating", "form", "fatigue"];
export const DEFAULT_PHONE_SORT: PhoneSortKey = "role";

export interface PhoneSortable {
  id: string;
  name: string | null;
  role: string | null;
  routeMatch: number | null;
  rating: number | null;
  form: number | null;
  fatigue: number | null;
}

const num = (v: number | null | undefined, missing: number) => (typeof v === "number" && Number.isFinite(v) ? v : missing);

/**
 * Listen i den valgte rækkefølge. Rolle: spillets rollehierarki (roleRank). Rutematch, rating og
 * form: højeste først. Træthed: den friskeste først. Lige stillede står efter rolle og så navn,
 * så rækkefølgen aldrig hopper mellem to ens visninger. Manglende tal står sidst.
 */
export function sortPhoneRiders<R extends PhoneSortable>(riders: readonly R[], key: PhoneSortKey): R[] {
  const byRoleThenName = (a: R, b: R) => roleRank(a.role) - roleRank(b.role) || String(a.name ?? "").localeCompare(String(b.name ?? ""));
  const value = (r: R): number => {
    switch (key) {
      case "routeMatch": return -num(r.routeMatch, -Infinity);
      case "rating": return -num(r.rating, -Infinity);
      case "form": return -num(r.form, -Infinity);
      case "fatigue": return num(r.fatigue, Infinity);
      default: return 0;
    }
  };
  return [...riders].sort((a, b) => (value(a) - value(b)) || byRoleThenName(a, b));
}

/** Arkets bladring: forrige/næste i listens rækkefølge, null i enderne. */
export function neighbours(ids: readonly string[], id: string): { index: number; prev: string | null; next: string | null } {
  const index = ids.indexOf(id);
  if (index < 0) return { index: -1, prev: null, next: null };
  return { index, prev: index > 0 ? ids[index - 1] : null, next: index < ids.length - 1 ? ids[index + 1] : null };
}

type MatrixCell = { race_role?: string | null; effort?: string | null } | undefined;
type Matrix = Record<string, Record<string, MatrixCell>> | null | undefined;

/**
 * De etaper (ikke den åbne) der har ugemte ændringer: ordrerne afviger fra det indlæste, en
 * kladde fra "kopiér til etaperne" venter, eller en rytters indsats er ændret på etapen.
 * Et rolleskift alene tæller ikke: rollen gælder resten af løbet og gemmes med den åbne etape.
 */
export function otherUnsavedStages({ activeStage, draftMatrix, initialMatrix, ordersByStage, initialOrdersByStage, includeOrders, bulkStages }: {
  activeStage: number | null;
  draftMatrix: Matrix;
  initialMatrix: Matrix;
  ordersByStage: Record<string, unknown> | null | undefined;
  initialOrdersByStage: Record<string, unknown> | null | undefined;
  includeOrders: boolean;
  bulkStages: readonly (number | string)[];
}): number[] {
  const out = new Set<number>();
  const add = (sn: number | string) => { const n = Number(sn); if (Number.isFinite(n) && n !== activeStage) out.add(n); };
  bulkStages.forEach(add);
  if (includeOrders) {
    const a = ordersByStage ?? {};
    const b = initialOrdersByStage ?? {};
    for (const sn of Object.keys(a)) if (JSON.stringify(a[sn]) !== JSON.stringify(b[sn])) add(sn);
  }
  const da = draftMatrix ?? {};
  const db = initialMatrix ?? {};
  for (const sn of Object.keys(da)) {
    const cells = da[sn] ?? {};
    const before = db[sn] ?? {};
    if (Object.keys(cells).some((rid) => (cells[rid]?.effort ?? null) !== (before[rid]?.effort ?? null))) add(sn);
  }
  return [...out].sort((x, y) => x - y);
}
