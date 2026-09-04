// Vercel Skew Protection for Vite-SPA'en (#2423, andet forsøg efter #4745).
//
// PROBLEMET: en Vite-SPA serverer content-hashede chunks. Deployer vi mens en
// bruger har appen åben, forsvinder de gamle chunk-filnavne, og næste lazy
// `import()` rammer en 404 → hvid skærm / fejlskærm (#4595/#4545/#906).
//
// HVORFOR IKKE `?dpl=` PÅ ASSET-URL'er: første forsøg (PR #4745) brugte Vites
// `experimental.renderBuiltUrl` til at hænge `?dpl=<id>` på byggede asset-URL'er.
// Det knækkede HELE appen i prod: entry-HTML og dynamiske imports fik query-
// strengen, men Vites STATISKE chunk-imports (`from "./react-XXXX.js"`) gør ikke
// — samme fil blev derfor loadet under to URL'er, React og ConsentProvider blev
// instantieret to gange, og alt døde med React #418. Se
// `.claude/learnings/2026-09-04-skew-protection-dpl-query-brak-hele-appen.md`.
// Derfor: vi rører ALDRIG asset-URL'er. `scripts/check-skew-protection.mjs`
// håndhæver det på det byggede output.
//
// LØSNINGEN: Vercels anden dokumenterede mekanisme — cookien `__vdpl`
// (https://vercel.com/docs/skew-protection). Når Vercels edge ser
// `__vdpl=<deployment-id>` på en request, ruter den requesten til NETOP den
// deployment — både dokumentet og alle assets. Ingen URL ændrer sig, så Vite-
// bundlens interne modul-identitet er urørt.
//
// SIKKERHEDSVENTILEN (vigtig): en pin uden udløb er farlig. Vercel 404'er en
// request hvis den pinnede deployment er ældre end projektets "Maximum Age"
// (målt til 12 timer på vores projekt, 4/9) — en evigt fornyet cookie ville altså
// kunne mure en bruger ude uden nogen vej tilbage. Derfor er pinnen bundet til
// BUILD-TIDSPUNKTET, ikke til brugerens session: cookiens Max-Age er altid
// "resten af PIN_WINDOW_MS efter buildet". Den kan aldrig forlænges ved reload,
// den udløber præcis PIN_WINDOW_MS efter deploymentet blev bygget, og derefter
// falder brugeren automatisk tilbage på seneste deployment. Vinduet skal derfor
// være markant mindre end Vercels Maximum Age.

// SSOT for om Skew Protection reelt er slået til i koden (#2423).
//
// HOTFIX 4/9 kl. 11:55 (#2423, se main.jsx): cookie-pinnen pinner asset-requests
// men ikke browser-navigationer i Vercels edge — dokumentet kommer altid fra
// nyeste deployment, mens assets følger den gamle cookie → 404 på alle chunks
// efter hvert deploy. Se
// `.claude/learnings/2026-09-04-vercel-vdpl-cookie-pinner-assets-men-ikke-dokumentet.md`.
// `main.jsx` kalder KUN `installSkewProtection()` når dette flag er `true`.
// `scripts/check-skew-protection.mjs` læser flaget statisk fra denne fil for at
// afgøre om dets gate 2/2b (deployment-id bagt ind i en JS-chunk) skal køre —
// er flaget `false`, kaldes funktionen aldrig, så intet id bliver nogensinde
// bagt ind. Det er PRÆCIS den tilsigtede, slukkede tilstand, ikke en regression.
//
// GEN-TÆNDING ER EJER-ONLY (#2423). Sæt aldrig denne til `true` uden eksplicit
// ejer-go — læs begge #2423-postmortems FØRST (denne + #4745-varianten:
// `.claude/learnings/2026-09-04-skew-protection-dpl-query-brak-hele-appen.md`).
export const SKEW_PROTECTION_ENABLED = false;

export const VDPL_COOKIE = "__vdpl"; // gitleaks:allow — Vercel-cookienavn, ikke en hemmelighed

// Hvor længe et deployment må pinne klienter til sig selv.
//
// HVORFOR KUN 30 MINUTTER (og ikke timer): `__vdpl` pinner OGSÅ dokument-
// navigationer. En spiller der har loadet et ødelagt build bliver derfor på det
// build ved reload OG i en ny fane, indtil cookien udløber — en revert eller et
// hotfix virker først for ham når pin-vinduet er udløbet. Vinduets længde er
// altså direkte lig med "hvor længe et dårligt deploy kan overleve sin egen
// rettelse". 30 minutter dækker det reelle stale-chunk-vindue (minutter efter et
// deploy, ikke timer) uden at gøre rollback virkningsløs i timevis. Rigtig lange
// sessioner er IKKE denne mekanismes opgave — de dækkes af selvhelings-fixet
// i #4595 (separat PR).
export const PIN_WINDOW_MS = 30 * 60 * 1000;

/**
 * Bygger den `document.cookie`-streng der skal skrives — eller null hvis der
 * ikke skal røres ved cookien overhovedet.
 *
 * @param {object} opts
 * @param {string} opts.deploymentId  VERCEL_DEPLOYMENT_ID bagt ind ved build ("" = Skew Protection var slået fra)
 * @param {number} opts.buildTimeMs   epoch-ms for buildet (0 = ukendt)
 * @param {number} opts.now           epoch-ms nu
 * @returns {string|null}
 */
export function buildVdplCookie({ deploymentId, buildTimeMs, now }) {
  if (typeof deploymentId !== "string" || deploymentId.length === 0) return null;
  if (!Number.isFinite(buildTimeMs) || buildTimeMs <= 0) return null;
  if (!Number.isFinite(now)) return null;

  // Negativ alder = klientens ur går bagud i forhold til build-containeren.
  // Vi kan så ikke beregne et pålideligt ABSOLUT udløb: sætter vi Max-Age til
  // det fulde vindue, udløber cookien PIN_WINDOW_MS efter klientens *forkerte*
  // nu, altså potentielt længe efter deploymentet er aldret ud af Vercels
  // Maximum Age → hård 404 uden selvheling. En bruger med skævt ur skal hellere
  // undvære pinnen end risikere at blive muret ude. Ingen pin, ingen ændring.
  const age = now - buildTimeMs;
  if (age < 0) return null;
  const remainingMs = PIN_WINDOW_MS - age;

  // Deploymentet er for gammelt til at pinne nogen. Ryd en evt. cookie fra et
  // tidligere boot, så brugeren falder tilbage på seneste deployment. Det er
  // selv-helingen: en gammel bundle kan aldrig holde nogen fast.
  if (remainingMs <= 1000) {
    return `${VDPL_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
  }

  const maxAgeSeconds = Math.floor(remainingMs / 1000);
  // SameSite=Lax (ikke Strict): cookien SKAL følge med top-level navigationer,
  // så dokumentet og dets assets kommer fra SAMME deployment. Med Strict ville
  // et klik ind fra fx Discord give dokumentet fra seneste deployment mens
  // sub-requests stadig bar pinnen → HTML fra B + chunks fra A → 404.
  return `${VDPL_COOKIE}=${deploymentId}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax; Secure`;
}

/**
 * Sætter (eller rydder) `__vdpl` på dokumentet. No-op når buildet ikke blev
 * lavet med Skew Protection slået til — så lokale builds og e2e er 100 % uændret.
 *
 * @param {object} [opts]
 * @param {string} [opts.deploymentId]
 * @param {number} [opts.buildTimeMs]
 * @param {number} [opts.now]
 * @param {{cookie: string}} [opts.doc]
 * @returns {string|null} den skrevne cookie-streng, eller null
 */
export function installSkewProtection(opts = {}) {
  const {
    // Bagt ind af `define` i vite.config.js. `typeof`-guarden gør modulet
    // kørbart i node --test og i en ubundtet dev-kontekst, hvor de ikke findes.
    deploymentId = typeof __CZ_SKEW_DEPLOYMENT_ID__ === "string" ? __CZ_SKEW_DEPLOYMENT_ID__ : "",
    buildTimeMs = typeof __CZ_SKEW_BUILD_TIME__ === "number" ? __CZ_SKEW_BUILD_TIME__ : 0,
    now = Date.now(),
    doc = typeof document !== "undefined" ? document : null,
  } = opts;

  if (!doc) return null;
  const cookie = buildVdplCookie({ deploymentId, buildTimeMs, now });
  if (!cookie) return null;
  try {
    doc.cookie = cookie;
  } catch {
    // Cookies blokeret (privat tilstand / tredjeparts-restriktioner). Uden pin
    // opfører appen sig præcis som før — chunk-recovery i chunkErrors.js fanger
    // stadig en stale chunk med ét kontrolleret reload.
    return null;
  }
  return cookie;
}
