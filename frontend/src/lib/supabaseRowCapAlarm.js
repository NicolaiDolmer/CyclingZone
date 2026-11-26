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

/** @param {{table: string, shape: string, rows: number}} finding */
export function reportRowCapToSentry(finding) {
  Sentry.captureMessage(rowCapAlarmMessage(finding), {
    level: "warning",
    fingerprint: rowCapAlarmFingerprint(finding),
    tags: { supabase_table: finding.table },
    extra: { query_shape: finding.shape },
  });
}

/** fetch til createClient({ global: { fetch } }). */
export function createRowCapAlarmFetch(baseFetch = (input, init) => globalThis.fetch(input, init), report = reportRowCapToSentry) {
  return withRowCapAlarm(baseFetch, { report });
}
