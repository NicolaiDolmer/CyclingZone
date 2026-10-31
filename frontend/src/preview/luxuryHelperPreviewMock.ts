// #5982: preview-override for luksushjaelperen (KUN preview-mocken, aldrig prod).
//
// Rollen findes kun i loeb paa s5_profiles_v3, som er slukket, saa ingen kan se den i
// prod. Ejeren skal kunne se og klikke den paa preview foer et flip: aabn en loebsside
// med `?luxuryHelper=1`, saa svarer mocken som om loebet kendte rollen:
//   - udtagelsen (GET /selection): sprint_leader_allowed og en luksushjaelper i truppen.
//   - etape-rollerne (GET /stage-roles): "rider-96" er luksushjaelper (med `?stagePlan=1`
//     ses hans standardplan i etapeplanen).
// Uden parameteren er alt uaendret, saa Playwright-snapshots ikke flytter sig.
// Opdigtede preview-data (seedData.js' ryttere), ingen spillerdata.

const STORAGE_KEY = "cz-preview-luxury-helper";

export function luxuryHelperPreviewActive(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (new URLSearchParams(window.location.search).get("luxuryHelper") === "1") {
      window.sessionStorage.setItem(STORAGE_KEY, "1");
      return true;
    }
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false; // storage kan vaere blokeret; preview uden override
  }
}

type Selection = { rider_ids?: string[]; captain_id?: string | null; sprint_captain_id?: string | null; hunter_id?: string | null } & Record<string, unknown>;

/** Udtagelsessvaret i et loeb der kender rollen, med en luksushjaelper i truppen. */
export function withLuxuryHelperSelection<T extends { selection?: Selection | null }>(body: T): T & { sprint_leader_allowed: true } {
  const sel = body?.selection;
  const taken = new Set([sel?.captain_id, sel?.sprint_captain_id, sel?.hunter_id].filter(Boolean));
  const luxury = (sel?.rider_ids ?? []).find((id) => !taken.has(id)) ?? null;
  return {
    ...body,
    sprint_leader_allowed: true,
    ...(sel ? { selection: { ...sel, ...(luxury ? { luxury_helper_id: luxury } : {}) } } : {}),
  };
}

type SeasonBody = { races?: Array<Record<string, unknown>>; entries?: Array<{ raceId: string; riderId: string; raceRole: string }> } & Record<string, unknown>;

/** #7239: saesonmatrixen med loeb der kender rollerne (rolesAllowed) og en delt kaptajn + luksushjaelper i det foerste loeb med en kaptajn. */
export function withSeasonRoles<T extends SeasonBody>(body: T): T {
  if (!Array.isArray(body?.races)) return body;
  const races = body.races.map((r) => ({ ...r, rolesAllowed: true }));
  const entries = Array.isArray(body.entries) ? body.entries : [];
  const raceId = entries.find((e) => e.raceRole === "captain")?.raceId;
  const helpers = entries.filter((e) => e.raceId === raceId && e.raceRole === "helper");
  const next = entries.map((e) => (helpers[0] && e === helpers[0] ? { ...e, raceRole: "co_captain" } : e));
  // Luksushjaelperen er en rytter der ikke allerede sidder i loebet (preview-seedens "smx-r3").
  if (raceId && !entries.some((e) => e.raceId === raceId && e.riderId === "smx-r3")) next.push({ raceId, riderId: "smx-r3", raceRole: "luxury_helper" });
  return { ...body, races, entries: next };
}

type StageRolesBody = { riders?: Array<{ rider_id: string; race_role?: string } & Record<string, unknown>> } & Record<string, unknown>;

/** Etape-rollerne med "rider-96" som luksushjaelper. */
export function withLuxuryHelperStageRoles<T extends StageRolesBody>(body: T): T {
  if (!Array.isArray(body?.riders)) return body;
  return { ...body, riders: body.riders.map((r) => (r.rider_id === "rider-96" ? { ...r, race_role: "luxury_helper" } : r)) };
}
