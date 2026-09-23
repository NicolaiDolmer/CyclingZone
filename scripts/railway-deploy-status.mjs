#!/usr/bin/env node
/**
 * Cycling Zone — Railway deploy-status via GraphQL API (#5489)
 * ==============================================================
 * Baggrund: `.github/workflows/deploy-verify.yml` laeste hidtil KUN GitHubs
 * deployment-status for at afgoere om Railway-deployet var live. Den status
 * opdateres af Railways GitHub-integration og kan slaebe bagefter Railway
 * selv — set to gange: 22/9 (manuel genkoersel, GH-deployment stod
 * in_progress i 10 min mens `railway deployment list` viste SUCCESS) og 23/9
 * (PR #5542, GH-deployment 6612081944 stod in_progress fra 10:47Z og blev
 * ALDRIG opdateret, mens Railway selv meldte SUCCESS kl. 12:47 CEST og
 * `/health` svarede ok). Begge gange stoppede merge-koeen paa et FALSKT roedt
 * signal. Se issue #5489.
 *
 * Dette script spoerger Railways egen GraphQL-API direkte (samme kilde CLI'en
 * bruger) og er tiltaenkt som PRIMAER kilde i deploy-verify.yml naar
 * RAILWAY_TOKEN er sat — GitHub-deployment-status forbliver fallback for
 * miljoeer uden token og for de fund dette script selv klassificerer som
 * "pending" (se getRailwayDeployStatus).
 *
 * READ-ONLY — kalder kun `project`- og `deployments`-queries. Ingen
 * mutationer. Tokenets VAERDI printes ALDRIG, hverken til stdout eller
 * stderr — kun de tre statusord og diagnostik uden hemmeligheder.
 *
 * Output (stdout, PRAECIS ÉN linje): `success` | `failed` | `pending`.
 * Alt andet (fremdrift, fejlbeskeder) skrives til stderr, saa
 * `$(node scripts/railway-deploy-status.mjs)` i workflowet kun fanger
 * statusordet.
 *
 * Klassifikation:
 *   - Ingen deployment i vinduet har `meta.commitHash === SHA` → "pending"
 *     (deployet er sandsynligvis ikke startet endnu — IKKE det samme som fejl).
 *   - Matchet deployment har status FAILED, CRASHED eller REMOVED → "failed".
 *   - Matchet deployment har status SUCCESS → "success".
 *   - Matchet deployment har enhver anden status (BUILDING, DEPLOYING,
 *     QUEUED, WAITING, SLEEPING, SKIPPED, eller en fremtidig ukendt vaerdi)
 *     → "pending".
 *   - ENHVER API-/netvaerks-/parse-fejl → "pending" (aldrig "failed" — en
 *     API-hikke maa aldrig faa merge-koeen til at rapportere et falsk rødt
 *     Railway-deploy; det var praecis den fejlklasse #5489 handler om, blot
 *     paa den anden led).
 *
 * Auth: Railways dokumenterede kontrakt (docs.railway.com/integrations/api,
 * verificeret 23/9-2026) er at PROJECT-tokens bruger headeren
 * `Project-Access-Token`, IKKE `Authorization: Bearer` (den er forbeholdt
 * account-/workspace-/OAuth-tokens). PR-instruktionen beder ejeren oprette et
 * project-token, saa "project"-stilen er default. Bruges i stedet et
 * account-/workspace-token, saet RAILWAY_TOKEN_HEADER=bearer.
 *
 * Endpoint: https://backboard.railway.com/graphql/v2 — BEMAERK: dette er
 * `.com`, ikke `.app`. Verificeret mod docs.railway.com 23/9-2026 (flere
 * aeldre community-referencer bruger fejlagtigt `.app`).
 *
 * Env:
 *   RAILWAY_TOKEN            (paakraevet) — project-token med laeseadgang.
 *                             ALDRIG printet.
 *   RAILWAY_TOKEN_HEADER     (valgfri) — "project" (default) eller "bearer".
 *   RAILWAY_PROJECT_ID       (valgfri) — default samme projekt-id som
 *                             scripts/ops/railway-log-watch.mjs allerede
 *                             bruger (#4453) — IKKE en hemmelighed, staar i
 *                             enhver Railway-dashboard-URL for projektet.
 *   RAILWAY_SERVICE_ID       (valgfri) — kendes den, springes navne-opslag
 *                             (project-query'et) helt over.
 *   RAILWAY_SERVICE_NAME     (valgfri) — default "CyclingZone", bruges til at
 *                             slaa service-id'et op naar RAILWAY_SERVICE_ID
 *                             ikke er sat.
 *   RAILWAY_ENVIRONMENT_ID   (valgfri) — samme princip som service-id.
 *   RAILWAY_ENVIRONMENT_NAME (valgfri) — default "production".
 *   SHA / GITHUB_SHA         — commit-SHA'en der skal matches mod
 *                             `meta.commitHash`. `--sha <sha>` override til
 *                             manuel koersel.
 *
 * Usage:
 *   RAILWAY_TOKEN=... SHA=<sha> node scripts/railway-deploy-status.mjs
 *   node scripts/railway-deploy-status.mjs --sha <sha>   # lokal test
 *
 * Exit: altid 0 — kaldstedet laeser stdout-linjen, ikke exit-koden (samme
 * kontrakt som scripts/check-cdn-cache-headers.mjs' output-baserede API'er,
 * blot her via stdout i stedet for GITHUB_OUTPUT, fordi dette script kaldes
 * inde fra et allerede-koerende bash-trin der selv saetter outputtet).
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { DEFAULT_PROJECT_ID } from "./ops/railway-log-watch.mjs";

export { DEFAULT_PROJECT_ID };

export const RAILWAY_API_URL = "https://backboard.railway.com/graphql/v2";
export const DEFAULT_SERVICE_NAME = "CyclingZone";
export const DEFAULT_ENVIRONMENT_NAME = "production";
export const DEFAULT_HEADER_STYLE = "project";

function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try { return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? ""); }
  catch { return false; }
}

// ── Ren logik (ingen netvaerk) ───────────────────────────────────────────────

/**
 * @param {string} token
 * @param {"project"|"bearer"} [style]
 * @returns {Record<string,string>}
 */
export function buildAuthHeaders(token, style = DEFAULT_HEADER_STYLE) {
  if (style === "bearer") return { Authorization: `Bearer ${token}` };
  return { "Project-Access-Token": token };
}

const FAILED_STATUSES = new Set(["FAILED", "CRASHED", "REMOVED"]);
const SUCCESS_STATUSES = new Set(["SUCCESS"]);

/**
 * Klassificerer et allerede-hentet sæt deployment-noder mod en maal-SHA. Ren
 * funktion — ingen netvaerk, ingen sideeffekter — saa den kan enhedstestes
 * uafhaengigt af API-kaldet (node --test scripts/railway-deploy-status.test.mjs).
 * @param {{status?:string, meta?:{commitHash?:string}}[]} deployments
 * @param {string} sha
 * @returns {"success"|"failed"|"pending"}
 */
export function classifyDeploymentStatus(deployments, sha) {
  if (!sha) return "pending";
  const target = String(sha).trim().toLowerCase();
  const match = (deployments ?? []).find((d) => {
    const hash = d?.meta?.commitHash;
    return typeof hash === "string" && hash.trim().toLowerCase() === target;
  });
  if (!match) return "pending"; // SHA ikke fundet (endnu) — se docstring foroven
  const status = String(match.status ?? "").toUpperCase();
  if (FAILED_STATUSES.has(status)) return "failed";
  if (SUCCESS_STATUSES.has(status)) return "success";
  return "pending"; // BUILDING/DEPLOYING/QUEUED/WAITING/SLEEPING/SKIPPED/ukendt
}

// ── Netvaerk ─────────────────────────────────────────────────────────────────

const PROJECT_QUERY = `
  query project($id: String!) {
    project(id: $id) {
      services { edges { node { id name } } }
      environments { edges { node { id name } } }
    }
  }
`;

const DEPLOYMENTS_QUERY = `
  query deployments($input: DeploymentListInput!, $first: Int) {
    deployments(input: $input, first: $first) {
      edges {
        node {
          id
          status
          createdAt
          meta
        }
      }
    }
  }
`;

/**
 * Loft paa hvor laenge ÉT GraphQL-kald maa haenge (ms). CodeRabbit-fund
 * (#5489): Undicis default kan vente op til 300s paa headers/body, og et
 * haengende kald ville forsinke deploy-verify.yml's 600s-deadline-tjek og
 * udsaette fallbacket til GitHub-deployment-status. Enhver timeout rammer
 * det eksisterende catch-led i getRailwayDeployStatus og klassificeres som
 * "pending", præcis som enhver anden API-fejl.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

async function graphqlRequest(url, token, headerStyle, query, variables, fetchImpl) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildAuthHeaders(token, headerStyle) },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Railway API: kunne ikke parse JSON-svar (HTTP ${res.status})`);
  }
  if (!res.ok) {
    const detail = body?.errors ? ` — ${JSON.stringify(body.errors).slice(0, 200)}` : "";
    throw new Error(`Railway API: HTTP ${res.status}${detail}`);
  }
  if (body?.errors?.length) {
    throw new Error(`Railway API: GraphQL-fejl — ${JSON.stringify(body.errors).slice(0, 300)}`);
  }
  return body.data;
}

/**
 * Slaar service-/environment-id op via navn, med mindre begge id'er allerede
 * er givet direkte (saa springes API-kaldet helt over — hurtigere og undgaar
 * en afhaengighed af at project-tokenet maa laese hele projektets struktur).
 */
async function resolveIds({ projectId, serviceId, serviceName, environmentId, environmentName, token, headerStyle, fetchImpl, url }) {
  if (serviceId && environmentId) return { serviceId, environmentId };

  const data = await graphqlRequest(url, token, headerStyle, PROJECT_QUERY, { id: projectId }, fetchImpl);
  const services = data?.project?.services?.edges?.map((e) => e.node) ?? [];
  const environments = data?.project?.environments?.edges?.map((e) => e.node) ?? [];

  const resolvedServiceId = serviceId || services.find((s) => s.name === serviceName)?.id;
  const resolvedEnvironmentId = environmentId || environments.find((e) => e.name === environmentName)?.id;

  if (!resolvedServiceId) {
    throw new Error(`Railway API: fandt ingen service med navnet "${serviceName}" i projekt ${projectId}`);
  }
  if (!resolvedEnvironmentId) {
    throw new Error(`Railway API: fandt intet environment med navnet "${environmentName}" i projekt ${projectId}`);
  }
  return { serviceId: resolvedServiceId, environmentId: resolvedEnvironmentId };
}

/**
 * Orkestrerer opslag + klassifikation. Fanger ALLE fejl (netvaerk, HTTP,
 * GraphQL-fejl, manglende felter) og returnerer "pending" i stedet for at
 * kaste — se docstring foroven for hvorfor en API-hikke aldrig maa blive til
 * et falsk "failed".
 * @param {object} opts
 * @param {string} opts.sha
 * @param {string} opts.token
 * @param {string} [opts.projectId]
 * @param {string} [opts.serviceId]
 * @param {string} [opts.serviceName]
 * @param {string} [opts.environmentId]
 * @param {string} [opts.environmentName]
 * @param {"project"|"bearer"} [opts.headerStyle]
 * @param {string} [opts.url]
 * @param {number} [opts.first]
 * @param {typeof fetch} [opts.fetchImpl] — injicerbar til test, default global fetch.
 * @returns {Promise<"success"|"failed"|"pending">}
 */
export async function getRailwayDeployStatus(opts) {
  const {
    sha,
    token,
    projectId = DEFAULT_PROJECT_ID,
    serviceId,
    serviceName = DEFAULT_SERVICE_NAME,
    environmentId,
    environmentName = DEFAULT_ENVIRONMENT_NAME,
    headerStyle = DEFAULT_HEADER_STYLE,
    url = RAILWAY_API_URL,
    first = 20,
    fetchImpl = fetch,
  } = opts ?? {};

  if (!token) {
    console.error("[railway-deploy-status] RAILWAY_TOKEN mangler — kan ikke spoerge Railway API'et.");
    return "pending";
  }
  if (!sha) {
    console.error("[railway-deploy-status] SHA mangler — kan ikke matche en deployment.");
    return "pending";
  }

  try {
    const { serviceId: svcId, environmentId: envId } = await resolveIds({
      projectId, serviceId, serviceName, environmentId, environmentName, token, headerStyle, fetchImpl, url,
    });
    const data = await graphqlRequest(
      url, token, headerStyle, DEPLOYMENTS_QUERY,
      { input: { projectId, serviceId: svcId, environmentId: envId }, first },
      fetchImpl,
    );
    const nodes = data?.deployments?.edges?.map((e) => e.node) ?? [];
    const result = classifyDeploymentStatus(nodes, sha);
    console.error(`[railway-deploy-status] ${nodes.length} deployment(s) hentet, SHA ${String(sha).slice(0, 7)} -> ${result}`);
    return result;
  } catch (err) {
    console.error(`[railway-deploy-status] API-fejl (klassificeret som pending): ${err.message}`);
    return "pending";
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const argValue = (flag) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };

  const status = await getRailwayDeployStatus({
    sha: argValue("--sha") || process.env.SHA || process.env.GITHUB_SHA,
    token: process.env.RAILWAY_TOKEN,
    projectId: process.env.RAILWAY_PROJECT_ID || DEFAULT_PROJECT_ID,
    serviceId: process.env.RAILWAY_SERVICE_ID,
    serviceName: process.env.RAILWAY_SERVICE_NAME || DEFAULT_SERVICE_NAME,
    environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
    environmentName: process.env.RAILWAY_ENVIRONMENT_NAME || DEFAULT_ENVIRONMENT_NAME,
    headerStyle: process.env.RAILWAY_TOKEN_HEADER || DEFAULT_HEADER_STYLE,
  });
  console.log(status);
}

if (isMain()) {
  main().catch((err) => {
    console.error(`[railway-deploy-status] uventet fejl: ${err.message}`);
    console.log("pending");
    process.exit(0);
  });
}
