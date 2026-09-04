// #drift-3-9 — vagt: cron-scheduleren (startCron() i cron.js) må ALDRIG tikke
// mod prod fra en lokal proces ved et uheld.
//
// HÆNDELSE (Supabase-logs 3/9): 191 x "permission denied for table riders"
// (401) fra ejerens hjemme-IP i København over ~12t (2/9 23:42-3/9 11:56 UTC),
// PRÆCIS defaultLoadCandidates()-forespørgslen i scoutMissionMaturation.js
// (select ...potentiale... fra riders — potentiale er service_role-only,
// #1162). SAMME IP sendte samtidig ~190 x 200 OK på SAMME forespørgsel — dvs.
// TO forskellige lokale processer kørte cron-scheduleren i samme vindue, én
// med en gyldig service_role-nøgle, én uden (formentlig en anon/forkert nøgle
// i en anden lokal .env/worktree — CyclingZone kører routinemæssigt mange
// parallelle Claude Code-worktrees, hver med sin egen backend/.env).
//
// ROD-ÅRSAG: server.js kalder startCron() UBETINGET i app.listen()-callbacken
// (ingen NODE_ENV/RAILWAY-tjek nogen steder i cron.js før denne fil) — enhver
// lokal `node server.js` / `npm run dev` i backend/, ELLER en helt almindelig
// dev-session der bare starter serveren for at teste noget andet, begynder
// derfor STRAKS at sende cron-ticks (auktioner hvert minut, scout-sweep hvert
// 5. min, osv.) mod hvad end SUPABASE_URL peger på i den lokale .env — og intet
// i repoet forhindrede at den peger på PROD.
//
// FIX: startCron() spørger evaluateCronRuntimeGuard() FØRST. Cron starter kun
// når BÅDE (a) SUPABASE_SERVICE_KEY rent faktisk dekoder til role=service_role
// OG (b) processen kører på Railways production-miljø (RAILWAY_ENVIRONMENT_NAME
// injiceres automatisk af Railway ved enhver deployment — er ALDRIG sat lokalt
// medmindre en udvikler bevidst eksporterer den). Mangler ét af de to, logges
// en tydelig fejl og INGEN setInterval sættes op. CRON_FORCE_LOCAL=1 er den
// eksplicitte undtagelse for legitim lokal cron-test (fx `node cron.js` mod et
// lokalt/dev Supabase-projekt) — sætter man den, logges en lige så tydelig
// advarsel, så ingen tror sig "usynligt" beskyttet.
//
// Se cron.js's startCron() for hvor denne kaldes, og
// cronRuntimeGuard.test.js for dækningen.

/**
 * Dekoder en Supabase API-nøgles rolle UDEN at verificere signaturen — formålet
 * er at afsløre en forkert NØGLE-TYPE lokalt (fx anon i stedet for service_role),
 * ikke at autentificere. Understøtter begge Supabase-nøgleformater:
 *   - klassisk JWT (header.payload.signatur, base64url) — role ligger i payload
 *   - nyt ikke-JWT-format (sb_secret_.../sb_publishable_...) — rollen følger
 *     entydigt af præfikset, der findes intet "anon secret"-format
 * Returnerer null hvis nøglen mangler, er tom, eller ikke kan tolkes.
 */
export function decodeSupabaseKeyRole(key) {
  if (!key || typeof key !== "string") return null;
  const trimmed = key.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("sb_secret_")) return "service_role";
  if (trimmed.startsWith("sb_publishable_")) return "anon";

  const parts = trimmed.split(".");
  if (parts.length !== 3) return null;
  try {
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson);
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    // best-effort: en ikke-JWT/korrupt streng skal give "rollen kunne ikke
    // afgøres" (→ evaluateCronRuntimeGuard blokerer), ikke vælte cron-boot.
    return null;
  }
}

/**
 * Afgør om cron-scheduleren må starte i DENNE proces.
 *
 * @param {object} opts
 * @param {string|undefined} opts.serviceKey - process.env.SUPABASE_SERVICE_KEY
 * @param {string|undefined} opts.railwayEnvironmentName - process.env.RAILWAY_ENVIRONMENT_NAME
 *   (Railway injicerer denne automatisk ved enhver deployment; er ALDRIG sat
 *   lokalt medmindre nogen bevidst eksporterer den — det gør den til et
 *   robust "kører jeg på Railway?"-signal uafhængigt af NODE_ENV, som intet
 *   sted i repoet i dag sættes til "production" af Railway selv).
 * @param {string|undefined} opts.forceLocal - process.env.CRON_FORCE_LOCAL
 * @returns {{ allowed: boolean, forced: boolean, role: string|null, isProduction: boolean, reason: string }}
 */
export function evaluateCronRuntimeGuard({ serviceKey, railwayEnvironmentName, forceLocal } = {}) {
  const role = decodeSupabaseKeyRole(serviceKey);
  const isServiceRole = role === "service_role";
  const isProduction = railwayEnvironmentName === "production";
  const forced = forceLocal === "1" || forceLocal === "true";

  if (isServiceRole && isProduction) {
    return { allowed: true, forced: false, role, isProduction, reason: "service_role-nøgle + Railway production" };
  }

  const problems = [];
  if (!isServiceRole) {
    problems.push(
      role
        ? `SUPABASE_SERVICE_KEY dekoder til rolle "${role}", ikke "service_role"`
        : "SUPABASE_SERVICE_KEY mangler eller kunne ikke dekodes til en rolle"
    );
  }
  if (!isProduction) {
    problems.push(
      railwayEnvironmentName
        ? `RAILWAY_ENVIRONMENT_NAME="${railwayEnvironmentName}" (ikke "production")`
        : "RAILWAY_ENVIRONMENT_NAME er ikke sat (processen kører ikke på Railway)"
    );
  }
  const reason = problems.join(" og ");

  if (forced) {
    return { allowed: true, forced: true, role, isProduction, reason };
  }
  return { allowed: false, forced: false, role, isProduction, reason };
}
