// #6607 (Sentry 10 -> 11): v11 fjernede `sendDefaultPii` og gjorde den nye
// `dataCollection` MERE tilladende som default (bruger-IP, cookies, request-/
// response-bodies). Vi satte aldrig `sendDefaultPii`, saa v10-adfaerden var den
// restriktive. Sentrys migrationsguide siger eksplicit: lad IKKE
// `dataCollection` staa tom hvis v10-adfaerden skal bevares. Baseline'en er
// ordret fra guiden (samme som backend/lib/sentry.js).
//
// `attachStacktrace: false` bevarer v10-grupperingen: v11 saetter som default en
// syntetisk stack paa captureMessage (fx "chunk-selfheal reloaded" i main.jsx),
// hvilket splitter eksisterende issue-grupper og taeller beskeden som en
// "errored" session.
//
// Ren .js-fil uden @sentry/react-import, saa den kan unit-testes direkte.
const PII_DENY = ["forwarded", "-ip", "remote-", "via", "-user"];

export const SENTRY_V10_COMPAT_OPTIONS = Object.freeze({
  attachStacktrace: false,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: { deny: PII_DENY }, response: { deny: PII_DENY } },
    httpBodies: [],
    urlQueryParams: { deny: PII_DENY },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    graphQL: { document: false, variables: false },
  },
});
