// #8797 — rækkeloft-alarmen i browseren. Selve vurderingen deles med backend
// (backend/lib/supabaseRowCapAlarm.js), så reglen kun står ét sted; her sidder kun
// rapporteringen til frontend-Sentry. Sentry er en no-op når den ikke er initialiseret
// (dev, tests), så wrapperen er altid sikker at sætte på klienten.
//
// supabaseRowCapAlarmLazy.ts indlæser modulet dovent, så det ikke ligger i første
// indlæsning.
import * as Sentry from "@sentry/react";
import {
  createRowCapObserver,
  rowCapAlarmMessage,
  rowCapAlarmFingerprint,
} from "../../../backend/lib/supabaseRowCapAlarm.js";

export type RowCapFinding = { table: string; shape: string; rows: number };
export type RowCapObserver = (input: RequestInfo | URL, init: RequestInit | undefined, response: Response) => void;

export function reportRowCapToSentry(finding: RowCapFinding): void {
  Sentry.captureMessage(rowCapAlarmMessage(finding), {
    level: "warning",
    fingerprint: rowCapAlarmFingerprint(finding),
    tags: { supabase_table: finding.table },
    extra: { query_shape: finding.shape },
  });
}

/** Vurdér et allerede modtaget svar (bruges af den dovne fetch i supabaseRowCapAlarmLazy.ts). */
export function createBrowserRowCapObserver(
  report: (finding: RowCapFinding) => void = reportRowCapToSentry,
  now: () => number = () => Date.now(),
): RowCapObserver {
  return createRowCapObserver({ report, now });
}
