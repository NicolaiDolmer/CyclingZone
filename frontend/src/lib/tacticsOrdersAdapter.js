// Taktik-ordrer v1 (race engine v4, #4030) — mock fetch-lag bag en lille adapter.
//
// Orders-API'et (backend-endepunktet for TeamOrder, kontrakten fra
// docs/superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md) bygges
// PARALLELT i et andet spor og findes ikke endnu. Denne adapter isolerer
// TacticsCard fra den afhængighed: al I/O går igennem de to eksporterede
// funktioner herunder, så kortet kan bygges og screenshottes uafhængigt.
//
// Ved integration: erstat kroppen af fetchTacticsCard/saveTacticsCard med et
// rigtigt fetch mod det landede endpoint (forventet form: GET/PUT
// /api/races/:raceId/tactics?stage=N, body/response = TeamOrder). Kortets
// egen kode (TacticsCard.jsx) taler KUN med denne fils eksporterede funktioner
// og skal ikke ændres.
//
// Roster (ryttere + roller) hentes IKKE her — det er allerede live via
// RaceSelectionPanel/GET /api/races/:raceId/selection. Mock-rosteret nedenfor
// er kun et fallback så kortet kan renderes helt uden en indlogget session
// (screenshots/isoleret test); RaceDetailPage sender den ægte trup ind som
// `riders`-prop når den er tilgængelig (se callsite).

import { defaultTeamOrder, mergeOrderWithRoster } from "./tacticsPlan.js";

const MOCK_NAME_POOL = [
  ["Ada", "Pedersen"], ["Mikkel", "Hansen"], ["Théo", "Journal"], ["Lars", "Bisgaard"],
  ["Finn", "Aarsland"], ["Rasmus", "Kold"], ["Oskar", "Lindqvist"], ["Bram", "Verhoeven"],
];
const MOCK_ROLES = ["captain", "sprint_captain", "hunter", "helper", "helper", "helper", "helper", "helper"];

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Deterministisk fallback-roster (samme raceId+stage → samme navne/roller hver
// gang, så et gentaget screenshot ikke flimrer). KUN brugt når parent ikke selv
// sender riders (se filens hoved-kommentar).
export function mockRosterFor(raceId, stage) {
  const seed = hashSeed(`${raceId ?? "preview"}:${stage ?? 1}`);
  const size = 5 + (seed % 2); // 5-6 ryttere, matcher en typisk trup-størrelse
  return Array.from({ length: size }, (_, i) => {
    const [first, last] = MOCK_NAME_POOL[(seed + i) % MOCK_NAME_POOL.length];
    return { id: `mock-rider-${i}`, name: `${first} ${last}`, role: MOCK_ROLES[i] ?? "helper" };
  });
}

const orderStore = new Map(); // `${raceId}:${stage}` → TeamOrder (in-memory, session-only)

function storeKey(raceId, stage) {
  return `${raceId ?? "preview"}:${stage ?? 1}`;
}

// T2 (spec): lock ved etapestart (11-slottet). Mock-beregning her: næste dag kl.
// 11:00 lokal tid — wires til den ægte etape-starttid ved integration.
function mockLocksAt() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(11, 0, 0, 0);
  return d.toISOString();
}

// Simuleret netværks-latens, så loading-tilstanden er reel at teste — 0ms i
// node --test (ingen setTimeout-ventetid tæller mod testen).
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function fetchTacticsCard({ raceId, stage, riderIds }) {
  await tick();
  const k = storeKey(raceId, stage);
  const saved = orderStore.get(k);
  const order = mergeOrderWithRoster(saved || defaultTeamOrder(riderIds), riderIds);
  return { order, locksAt: mockLocksAt() };
}

export async function saveTacticsCard({ raceId, stage, order }) {
  await tick();
  orderStore.set(storeKey(raceId, stage), order);
  return { ok: true };
}
