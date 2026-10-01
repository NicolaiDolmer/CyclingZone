// #6000 · preview-mock for /api/training/groups (beta). Kun i installPreviewMock.js
// (ikke mockHandlers.js), samme lagdeling som trainingProgramsMock.js: Playwright-
// fixtures deler mockHandlers, og en ny vaelger-sektion maa ikke flytte de
// eksisterende /training-snapshots.
//
// Funktionen er ON paa preview (override af den aegte beta-gate), saa ejeren kan
// klikke den igennem. ?groups=off giver Plan-fanen foer #6000 (foer/efter-par).
// Statefuld: et gruppe-felt skriver en kopi ind i seedTraining.riderWeekPlans for
// hver foelgende rytter, saa /api/training/me viser det samme som i prod.

type Days = Record<string, { session: string; intensity: string; slots?: Array<string | null> }>;
type Member = { riderId: string; followsGroup: boolean };
type Group = { id: string; name: string; days: Days | null; programKey: string | null; fatigue: { threshold: number | null; fallback: string } | null; members: Member[] };
type SeedTraining = { condition?: Record<string, unknown>; riderWeekPlans?: Record<string, Days> };
type Catalog = Array<{ key: string; days: Record<string, string> }>;

const SLOTS = 5;
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const INTENSITY: Record<string, string> = {
  rest: "rest", recovery: "recovery", technique: "easy", aero: "easy", loebslaere: "easy", endurance: "easy",
  tempo: "normal", vo2max: "hard", vo2max_climb: "hard", vo2max_punch: "hard", threshold: "hard", sprint: "hard",
  cobbled_sectors: "hard", echelon_drills: "hard", attack_repeats: "hard",
};

let groups: Group[] | null = null;
let seq = 0;

export function previewTrainingGroupsEnabled(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get("groups");
    if (param === "on") localStorage.setItem("cz_mock_groups", "1");
    if (param === "off") localStorage.setItem("cz_mock_groups", "0");
    return localStorage.getItem("cz_mock_groups") !== "0";
  } catch {
    return true;
  }
}

function seedWeek(): Days {
  return Object.fromEntries(WEEKDAYS.map((w) => {
    const session = w === "sun" ? "rest" : w === "thu" ? "tempo" : "endurance";
    return [w, { session, intensity: INTENSITY[session] }];
  }));
}

function clone(days: Days): Days {
  return JSON.parse(JSON.stringify(days)) as Days;
}

function view(group: Group, seed: SeedTraining) {
  const first = [...group.members].map((m) => m.riderId).sort()[0];
  const days = group.days ?? (first ? clone(seed.riderWeekPlans?.[first]?.mon?.session ? seed.riderWeekPlans[first] : seedWeek()) : null);
  return { ...group, days, isSeed: !group.days };
}

function writeCopies(group: Group, seed: SeedTraining, ids: string[]) {
  if (!group.days) return;
  seed.riderWeekPlans ??= {};
  for (const id of ids) seed.riderWeekPlans[id] = clone(group.days);
}

function respond(seed: SeedTraining) {
  return { status: 200, body: { ok: true, groups: (groups ?? []).map((g) => view(g, seed)) } };
}

export function trainingGroupsMockRoute(
  method: string, pathname: string, body: Record<string, unknown> | null, seed: SeedTraining, catalog: Catalog,
): { status: number; body: unknown } | null {
  if (!/^\/api\/training\/groups(\/|$)/.test(pathname)) return null;
  if (!previewTrainingGroupsEnabled()) {
    return method === "GET" ? { status: 200, body: { enabled: false, groups: [] } } : { status: 404, body: { error: "not_found" } };
  }
  const riderIds = Object.keys(seed.condition ?? {});
  groups ??= riderIds.length ? [{
    id: "g-1", name: "Climbers", days: null, programKey: null, fatigue: { threshold: 70, fallback: "light" },
    members: riderIds.slice(0, 1).map((riderId) => ({ riderId, followsGroup: true })),
  }] : [];
  const match = pathname.match(/^\/api\/training\/groups\/?([^/]*)\/?([^/]*)$/);
  const id = match?.[1] || null;
  const action = match?.[2] || null;
  const group = id ? groups.find((g) => g.id === id) ?? null : null;
  const ids = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && riderIds.includes(v)) : []);
  const setMembers = (target: Group, next: string[]) => {
    for (const g of groups ?? []) if (g !== target) g.members = g.members.filter((m) => !next.includes(m.riderId));
    const before = target.members.map((m) => m.riderId);
    target.members = next.map((riderId) => target.members.find((m) => m.riderId === riderId) ?? { riderId, followsGroup: true });
    writeCopies(target, seed, next.filter((riderId) => !before.includes(riderId)));
  };

  if (method === "GET" && !id) return { status: 200, body: { enabled: true, groups: groups.map((g) => view(g, seed)) } };
  if (method === "POST" && !id) {
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 40) return { status: 400, body: { error: "invalid_name" } };
    const created: Group = { id: `g-new-${seq += 1}`, name, days: null, programKey: null, fatigue: null, members: [] };
    groups.push(created);
    setMembers(created, ids(body?.riderIds));
    return respond(seed);
  }
  if (!group) return { status: 404, body: { error: "group_not_found" } };
  if (method === "PATCH" && !action) {
    if (typeof body?.name === "string" && body.name.trim()) group.name = body.name.trim();
    if (body?.riderIds !== undefined) setMembers(group, ids(body.riderIds));
    return respond(seed);
  }
  if (method === "DELETE" && !action) {
    groups = groups.filter((g) => g !== group);
    return respond(seed);
  }
  if (method === "PUT" && action === "cell") {
    const current = view(group, seed).days;
    const weekday = String(body?.weekday ?? "");
    const session = String(body?.session ?? "");
    if (!current || !current[weekday] || !INTENSITY[session]) return { status: 400, body: { error: "invalid_cell" } };
    const entry = { ...current[weekday] };
    if (body?.slotIndex == null) {
      entry.session = session;
      entry.intensity = INTENSITY[session];
    } else {
      const slots = Array.from({ length: SLOTS }, (_, i) => entry.slots?.[i] ?? null);
      slots[Number(body.slotIndex)] = session;
      entry.slots = slots.map((s) => (s === entry.session ? null : s));
      if (entry.slots.every((s) => s == null)) delete entry.slots;
    }
    group.days = { ...current, [weekday]: entry };
    writeCopies(group, seed, group.members.filter((m) => m.followsGroup).map((m) => m.riderId));
    return respond(seed);
  }
  if (method === "POST" && action === "program") {
    const program = catalog.find((p) => p.key === body?.programKey);
    if (!program) return { status: 400, body: { error: "invalid_program" } };
    group.days = Object.fromEntries(WEEKDAYS.map((w) => [w, { session: program.days[w], intensity: INTENSITY[program.days[w]] }]));
    group.programKey = program.key;
    for (const m of group.members) m.followsGroup = true;
    writeCopies(group, seed, group.members.map((m) => m.riderId));
    return { status: 200, body: { ok: true, applied: group.members.length, programKey: program.key } };
  }
  if (method === "POST" && action === "follow") {
    const follow = ids(body?.riderIds);
    for (const m of group.members) if (follow.includes(m.riderId)) m.followsGroup = true;
    writeCopies(group, seed, follow);
    return respond(seed);
  }
  if (method === "PUT" && action === "fatigue") {
    const mode = body?.mode;
    if (mode === "team") group.fatigue = null;
    else if (mode === "off") group.fatigue = { threshold: null, fallback: "off" };
    else if (mode === "own" && Number.isInteger(body?.threshold) && typeof body?.fallback === "string") {
      group.fatigue = { threshold: Number(body.threshold), fallback: body.fallback };
    } else return { status: 400, body: { error: "invalid_rule" } };
    return respond(seed);
  }
  return null;
}
