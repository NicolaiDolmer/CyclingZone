// railway-deploy-status.test.mjs — enhedstest af den rene klassifikations-
// funktion (#5489) + orkestreringen med injiceret fetch (samme moenster som
// checkHashedAssetWithRetry i check-cdn-cache-headers.test.mjs: ingen rigtigt
// netvaerkskald, ingen mocking-bibliotek, bare en fake fetchImpl).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyDeploymentStatus,
  buildAuthHeaders,
  getRailwayDeployStatus,
  RAILWAY_API_URL,
} from "./railway-deploy-status.mjs";

const sha = "abc123def456abc123def456abc123def456abc";

// ── classifyDeploymentStatus (ren funktion) ─────────────────────────────────

test("success: matchet SHA med status SUCCESS", () => {
  const deployments = [{ status: "SUCCESS", meta: { commitHash: sha } }];
  assert.equal(classifyDeploymentStatus(deployments, sha), "success");
});

test("failed: matchet SHA med status FAILED", () => {
  const deployments = [{ status: "FAILED", meta: { commitHash: sha } }];
  assert.equal(classifyDeploymentStatus(deployments, sha), "failed");
});

test("failed: matchet SHA med status CRASHED", () => {
  const deployments = [{ status: "CRASHED", meta: { commitHash: sha } }];
  assert.equal(classifyDeploymentStatus(deployments, sha), "failed");
});

test("failed: matchet SHA med status REMOVED", () => {
  const deployments = [{ status: "REMOVED", meta: { commitHash: sha } }];
  assert.equal(classifyDeploymentStatus(deployments, sha), "failed");
});

test("pending: matchet SHA stadig under bygning (BUILDING/DEPLOYING/QUEUED)", () => {
  for (const status of ["BUILDING", "DEPLOYING", "QUEUED", "WAITING", "SLEEPING", "SKIPPED"]) {
    const deployments = [{ status, meta: { commitHash: sha } }];
    assert.equal(classifyDeploymentStatus(deployments, sha), "pending", `status ${status}`);
  }
});

test("pending: SHA ikke fundet blandt deployments", () => {
  const deployments = [{ status: "SUCCESS", meta: { commitHash: "ffffffffffffffffffffffffffffffffffffff" } }];
  assert.equal(classifyDeploymentStatus(deployments, sha), "pending");
});

test("pending: tom deployment-liste", () => {
  assert.equal(classifyDeploymentStatus([], sha), "pending");
});

test("pending: ingen SHA givet", () => {
  assert.equal(classifyDeploymentStatus([{ status: "SUCCESS", meta: { commitHash: sha } }], ""), "pending");
});

test("SHA-match er case-insensitivt (Railway/GitHub kan variere i store/smaa bogstaver)", () => {
  const deployments = [{ status: "SUCCESS", meta: { commitHash: sha.toUpperCase() } }];
  assert.equal(classifyDeploymentStatus(deployments, sha), "success");
});

test("vaelger korrekt deployment naar flere findes i listen", () => {
  const deployments = [
    { status: "FAILED", meta: { commitHash: "0000000000000000000000000000000000000" } },
    { status: "SUCCESS", meta: { commitHash: sha } },
  ];
  assert.equal(classifyDeploymentStatus(deployments, sha), "success");
});

// ── buildAuthHeaders (ren funktion) ─────────────────────────────────────────

test("buildAuthHeaders default (project) bruger Project-Access-Token-headeren", () => {
  assert.deepEqual(buildAuthHeaders("tok"), { "Project-Access-Token": "tok" });
});

test("buildAuthHeaders bearer-stil bruger Authorization: Bearer", () => {
  assert.deepEqual(buildAuthHeaders("tok", "bearer"), { Authorization: "Bearer tok" });
});

// ── getRailwayDeployStatus (injiceret fetch, ingen rigtigt netvaerk) ────────

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function makeFetch({ projectData, deploymentsData }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const body = JSON.parse(init.body);
    if (body.query.includes("project(")) return jsonResponse(200, { data: projectData });
    if (body.query.includes("deployments(")) return jsonResponse(200, { data: deploymentsData });
    throw new Error(`uventet query i test-mock: ${body.query.slice(0, 40)}`);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test("getRailwayDeployStatus: happy path, resolver service+environment via navn, finder SUCCESS", async () => {
  const fetchImpl = makeFetch({
    projectData: {
      project: {
        services: { edges: [{ node: { id: "svc-1", name: "CyclingZone" } }] },
        environments: { edges: [{ node: { id: "env-1", name: "production" } }] },
      },
    },
    deploymentsData: {
      deployments: { edges: [{ node: { id: "dep-1", status: "SUCCESS", createdAt: "2026-09-23T10:00:00Z", meta: { commitHash: sha } } }] },
    },
  });

  const result = await getRailwayDeployStatus({ sha, token: "tok", fetchImpl });
  assert.equal(result, "success");
  assert.equal(fetchImpl.calls.length, 2); // resolve + deployments
  assert.equal(fetchImpl.calls[0].url, RAILWAY_API_URL);
});

test("getRailwayDeployStatus: serviceId+environmentId givet direkte springer resolve-kaldet over", async () => {
  const fetchImpl = makeFetch({
    projectData: null, // ville fejle hvis brugt — bekraefter at den IKKE kaldes
    deploymentsData: {
      deployments: { edges: [{ node: { status: "FAILED", meta: { commitHash: sha } } }] },
    },
  });

  const result = await getRailwayDeployStatus({
    sha, token: "tok", serviceId: "svc-1", environmentId: "env-1", fetchImpl,
  });
  assert.equal(result, "failed");
  assert.equal(fetchImpl.calls.length, 1); // kun deployments-kaldet
});

test("getRailwayDeployStatus: manglende RAILWAY_TOKEN giver pending uden noget fetch-kald", async () => {
  const fetchImpl = async () => { throw new Error("fetch skulle IKKE vaere kaldt"); };
  const result = await getRailwayDeployStatus({ sha, token: "", fetchImpl });
  assert.equal(result, "pending");
});

test("getRailwayDeployStatus: netvaerksfejl klassificeres som pending, ikke failed", async () => {
  const fetchImpl = async () => { throw new Error("ECONNRESET"); };
  const result = await getRailwayDeployStatus({ sha, token: "tok", serviceId: "svc-1", environmentId: "env-1", fetchImpl });
  assert.equal(result, "pending");
});

test("getRailwayDeployStatus: HTTP 500 klassificeres som pending", async () => {
  const fetchImpl = async () => jsonResponse(500, { errors: [{ message: "internal error" }] });
  const result = await getRailwayDeployStatus({ sha, token: "tok", serviceId: "svc-1", environmentId: "env-1", fetchImpl });
  assert.equal(result, "pending");
});

test("getRailwayDeployStatus: GraphQL-fejl i et 200-svar klassificeres som pending", async () => {
  const fetchImpl = async () => jsonResponse(200, { errors: [{ message: "field not found" }], data: null });
  const result = await getRailwayDeployStatus({ sha, token: "tok", serviceId: "svc-1", environmentId: "env-1", fetchImpl });
  assert.equal(result, "pending");
});

test("getRailwayDeployStatus: service ikke fundet ved navne-opslag klassificeres som pending", async () => {
  const fetchImpl = makeFetch({
    projectData: {
      project: {
        services: { edges: [{ node: { id: "svc-x", name: "AndenService" } }] },
        environments: { edges: [{ node: { id: "env-1", name: "production" } }] },
      },
    },
    deploymentsData: {},
  });
  const result = await getRailwayDeployStatus({ sha, token: "tok", serviceName: "CyclingZone", fetchImpl });
  assert.equal(result, "pending");
});
