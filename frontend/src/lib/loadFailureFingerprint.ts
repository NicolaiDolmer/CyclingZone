// #7917: 502-504 betyder, at backenden er utilgængelig, uanset hvilken flade der
// spurgte. De samles derfor i ét Sentry-issue pr. nedbrud. 500 er ikke med: det er
// en fejl i en bestemt rute og skal blive ved med at gruppere for sig selv.
//
// Eget modul uden Sentry- og Supabase-importer, så node --test kan importere det
// direkte (actionTelemetry.js kan ikke indlæses der, se actionTelemetry.test.js).
export function loadFailureFingerprint(status?: number): string[] | undefined {
  return status !== undefined && status >= 502 && status <= 504 ? ["frontend-backend-unavailable"] : undefined;
}
