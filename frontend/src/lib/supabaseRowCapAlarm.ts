// #8797 — rækkeloft-alarmen i browseren. Selve vurderingen deles med backend
// (backend/lib/supabaseRowCapAlarm.js), så reglen kun står ét sted; her sidder kun
// rapporteringen til frontend-Sentry. Sentry er en no-op når den ikke er initialiseret
// (dev, tests), så wrapperen er altid sikker at sætte på klienten.
import * as Sentry from "@sentry/react";
import {
  withRowCapAlarm,
  rowCapAlarmMessage,
  rowCapAlarmFingerprint,
} from "../../../backend/lib/supabaseRowCapAlarm.js";

export type RowCapFinding = { table: string; shape: string; rows: number };
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function reportRowCapToSentry(finding: RowCapFinding): void {
  Sentry.captureMessage(rowCapAlarmMessage(finding), {
    level: "warning",
    fingerprint: rowCapAlarmFingerprint(finding),
    tags: { supabase_table: finding.table },
    extra: { query_shape: finding.shape },
  });
}

/** fetch til createClient({ global: { fetch } }). */
export function createRowCapAlarmFetch(
  baseFetch: FetchLike = (input, init) => globalThis.fetch(input, init),
  report: (finding: RowCapFinding) => void = reportRowCapToSentry,
): FetchLike {
  return withRowCapAlarm(baseFetch, { report }) as FetchLike;
}
