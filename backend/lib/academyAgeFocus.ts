// #8081 / #6944 (ejervalg 16/11): akademiets ALDERSFOKUS og kontakten til akademisiden udgave A.
//
// Aldersfokus er ét valg (skitse B fra PR #8185): Blandet (standard) eller 16, 17, 18, 19.
// Valget er et fjerde felt i akademiets profil og følger samme ur som nationalitet og type:
// det gemmes som en ny række i academy_intake_profiles (kolonnen age_focus) og virker først
// efter PROFILE_DELAY_DAYS. Den aktive profilrække bærer derfor også det aktive aldersfokus,
// og en ventende ændring bærer det ventende. Ét ur for hele profilen (PR #8185, spørgsmål 2).
//
// Åbent fra FØRSTE profilniveau (ejer 16/11): kræver samme niveau som nationaliteten, intet mere.
//
// Ugens træk bruger det aktive valg med samme virkning pr. kandidat for alle profiler
// med adgang. Kalibreringen ligger i private_config. Blandet bruger grundtrækket.
//
// Kontakten: academy_page_v2_8081 (off | beta | on, ikke seedet = off). Slukket svarer begge
// ruter 409, og akademisiden er præcis som før.
import { Router } from "express";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { isAcademyEnabled } from "./academyFlag.js";
import { readPrivateConfig } from "./privateConfig.ts";
import { isAcademyIntakePullEnabled } from "./academyIntakePullFlag.ts";
import {
  PROFILE_DELAY_DAYS,
  loadAcademyFacilityTier,
  tierRules,
  validateProfileInput,
} from "./academyIntakeProfile.ts";
import type { AcademyProfile, ProfileInput } from "./academyIntakeProfile.ts";

// Supabase-klienten er utypet i kernen (samme som academyIntakeProfile.ts).
type Db = any;
type DateInput = Date | string | number;
type FlagOptions = NonNullable<Parameters<typeof evaluateFlagStage>[1]>;

export const ACADEMY_PAGE_V2_FLAG_KEY = "academy_page_v2_8081";

/** De aldre manageren kan lægge fokus på. Blandet = null i databasen. */
export const AGE_FOCUS_VALUES: readonly string[] = Object.freeze(["16", "17", "18", "19"]);
export const AGE_FOCUS_MIXED = "mixed";

const DAY_MS = 86_400_000;

export type AgeFocusError = "invalid_age_focus" | "profile_locked";
export type AgeFocusValue = { ageFocus: string | null; effectiveFrom: string };
export type AgeFocusRow = { age_focus?: unknown; effective_from?: string | null; created_at?: string | null };
export type AgeFocusState = {
  tier: number;
  unlocked: boolean;
  active: AgeFocusValue | null;
  pending: AgeFocusValue | null;
  options: string[];
  delayDays: number;
};
export type ProfileWithAgeFocusInput = (NonNullable<ProfileInput> & { ageFocus?: unknown }) | null | undefined;

/** Er akademisiden udgave A tændt for denne viewer? Fejl og manglende række = slukket. */
export async function isAcademyPageV2Enabled(supabase: Db, opts: FlagOptions = {}): Promise<boolean> {
  return evaluateFlagStage(await readFlagStage(supabase, ACADEMY_PAGE_V2_FLAG_KEY), opts);
}

/**
 * Normalisér et aldersfokus fra klienten. `null`, "", "mixed" og et manglende felt er Blandet
 * (null). "16".."19" (også som tal) er en alder. Alt andet er ugyldigt (undefined).
 */
export function normalizeAgeFocus(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "" || value === AGE_FOCUS_MIXED) return null;
  const text = typeof value === "number" && Number.isInteger(value) ? String(value) : value;
  return typeof text === "string" && AGE_FOCUS_VALUES.includes(text) ? text : undefined;
}

/**
 * Valider aldersfokus mod akademiets niveau. Blandet er altid gyldigt; en alder kræver
 * første profilniveau (samme lås som nationaliteten).
 */
export function validateAgeFocusInput(
  value: unknown,
  tier: unknown,
): { ok: true; ageFocus: string | null } | { ok: false; error: AgeFocusError } {
  const ageFocus = normalizeAgeFocus(value);
  if (ageFocus === undefined) return { ok: false, error: "invalid_age_focus" };
  if (ageFocus !== null && tierRules(tier).origins === 0) return { ok: false, error: "profile_locked" };
  return { ok: true, ageFocus };
}

/**
 * Del profilrækkerne i AKTIVT og VENTENDE aldersfokus. Samme regel som
 * academyIntakeProfile.resolveProfileRows: den nyeste række hvis effective_from er passeret
 * er aktiv; den senest planlagte fremtidige række er ventende.
 */
export function resolveAgeFocusRows(
  rows: AgeFocusRow[] | null | undefined,
  now: DateInput = new Date(),
): { active: AgeFocusValue | null; pending: AgeFocusValue | null } {
  const nowMs = new Date(now).getTime();
  const sorted = [...(rows ?? [])]
    .filter((r): r is AgeFocusRow & { effective_from: string } => Boolean(r && r.effective_from))
    .sort((a, b) => new Date(a.effective_from).getTime() - new Date(b.effective_from).getTime()
      || new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime());
  let active: (AgeFocusRow & { effective_from: string }) | null = null;
  let pending: (AgeFocusRow & { effective_from: string }) | null = null;
  for (const row of sorted) {
    if (new Date(row.effective_from).getTime() <= nowMs) active = row;
    else pending = row;
  }
  // En række med en ukendt værdi (aldrig skrevet af koden) læses som Blandet, ikke som en fejl.
  const shape = (row: (AgeFocusRow & { effective_from: string }) | null): AgeFocusValue | null => (row
    ? { ageFocus: normalizeAgeFocus(row.age_focus) ?? null, effectiveFrom: row.effective_from }
    : null);
  return { active: shape(active), pending: shape(pending) };
}

async function loadAgeFocusRows(supabase: Db, teamId: string): Promise<AgeFocusRow[]> {
  const { data, error } = await supabase
    .from("academy_intake_profiles")
    // schema-columns-ok: age_focus kommer med database/2026-11-16-8081-academy-v2.sql og læses kun bag academy_page_v2_8081
    .select("age_focus, effective_from, created_at")
    .eq("team_id", teamId)
    .order("effective_from", { ascending: false })
    .limit(10);
  if (error) throw new Error(`academy-age-focus lookup: ${error.message}`);
  return data ?? [];
}

function readAgeFocusParams(supabase: Db) {
  return readPrivateConfig<{ share: number }>(supabase, "academy_age_focus_params");
}

/** Resolve the same effective choice that the academy page displays. */
export async function loadWeeklyAgeFocus(
  supabase: Db,
  { teamId, tier, now, isBetaTester }: { teamId: string; tier: number; now: DateInput; isBetaTester: boolean },
): Promise<{ age: number; share: number } | null> {
  if (tierRules(tier).origins === 0 || !(await isAcademyPageV2Enabled(supabase, { isBetaTester }))) return null;
  const { active } = resolveAgeFocusRows(await loadAgeFocusRows(supabase, teamId), now);
  if (!active?.ageFocus) return null;
  const params = await readAgeFocusParams(supabase);
  if (!params) throw new Error("academy-age-focus configuration unavailable");
  return { age: Number(active.ageFocus), share: params.share };
}

/** Aldersfokus-tilstanden til GET /api/academy/v2/age-focus. */
export async function loadAgeFocusState(
  supabase: Db,
  { teamId, now = new Date() }: { teamId: string; now?: DateInput },
): Promise<AgeFocusState> {
  const [tier, rows] = await Promise.all([
    loadAcademyFacilityTier(supabase, teamId),
    loadAgeFocusRows(supabase, teamId),
  ]);
  const { active, pending } = resolveAgeFocusRows(rows, now);
  return {
    tier,
    unlocked: tierRules(tier).origins > 0,
    active,
    pending,
    options: [AGE_FOCUS_MIXED, ...AGE_FOCUS_VALUES],
    delayDays: PROFILE_DELAY_DAYS,
  };
}

/**
 * Gem hele profilen (nationalitet/region, type OG aldersfokus) som én ny ventende række.
 * Samme validering og samme ur som saveAcademyProfile; RPC'en er en søster til
 * save_academy_intake_profile med ét felt mere (database/2026-11-16-8081-academy-v2.sql),
 * så oprydning og indsættelse stadig sker i én transaktion bag holdets advisory-lås.
 */
export async function saveAcademyProfileWithAgeFocus(
  supabase: Db,
  { teamId, input, now = new Date() }: { teamId: string; input: ProfileWithAgeFocusInput; now?: DateInput },
): Promise<
  | { ok: false; error: string }
  | { ok: true; profile: AcademyProfile; ageFocus: string | null; effectiveFrom: string }
> {
  if (!teamId) throw new Error("teamId required");
  const tier = await loadAcademyFacilityTier(supabase, teamId);
  const checked = validateProfileInput(input, tier);
  if (!checked.ok) return checked;
  const age = validateAgeFocusInput(input?.ageFocus, tier);
  if (!age.ok) return age;
  const effectiveFrom = new Date(new Date(now).getTime() + PROFILE_DELAY_DAYS * DAY_MS).toISOString();
  const { data: insertedId, error } = await supabase.rpc("save_academy_intake_profile_8081", {
    p_team_id: teamId,
    p_origins: checked.profile.origins,
    p_rider_types: checked.profile.types,
    p_age_focus: age.ageFocus,
    p_effective_from: effectiveFrom,
    p_now: new Date(now).toISOString(),
  });
  if (error) throw new Error(`academy-age-focus save: ${error.message}`);
  if (insertedId == null) throw new Error("academy-age-focus save: rpc returned no id");
  return { ok: true, profile: checked.profile, ageFocus: age.ageFocus, effectiveFrom };
}

type TeamRequest = Request & { team?: { id: string } | null };
export type AcademyV2RouterDeps = {
  supabase: Db;
  requireAuth: RequestHandler;
  writeLimiter: RequestHandler;
  isViewerBetaTester: (req: Request) => Promise<boolean | null | undefined> | boolean | null | undefined;
  reportError?: (err: unknown, ctx?: Record<string, unknown>) => void;
  /** Uret (injiceres i tests, så 14-dages-grænsen kan prøves deterministisk). */
  now?: () => Date;
};

/**
 * Ruterne bag kontakten, monteret på /api/academy/v2:
 *   GET /age-focus  aktivt og ventende aldersfokus + niveau
 *   PUT /profile    { origins, types, ageFocus } -> ny ventende profilrække
 * Slukket kontakt = 409 academy_page_v2_disabled.
 */
export function createAcademyV2Router({
  supabase, requireAuth, writeLimiter, isViewerBetaTester, reportError: captureException = () => {}, now = () => new Date(),
}: AcademyV2RouterDeps): Router {
  const router = Router();

  async function gate(req: TeamRequest, res: Response): Promise<boolean> {
    if (!req.team) { res.status(400).json({ error: "No team found" }); return false; }
    const isBetaTester = (await isViewerBetaTester(req)) === true;
    if (!(await isAcademyEnabled(supabase, { isBetaTester }))) { res.status(409).json({ error: "academy_disabled" }); return false; }
    if (!(await isAcademyPageV2Enabled(supabase, { isBetaTester }))) { res.status(409).json({ error: "academy_page_v2_disabled" }); return false; }
    return true;
  }

  function respondFailed(res: Response): void {
    if (!res.headersSent) res.status(500).json({ error: "academy_v2_failed" });
  }

  router.get("/age-focus", requireAuth, async (req: TeamRequest, res: Response, _next: NextFunction) => {
    try {
      if (!(await gate(req, res))) return;
      res.set("Cache-Control", "no-store");
      const state = await loadAgeFocusState(supabase, { teamId: req.team!.id, now: now() });
      res.json({ ...state, unlocked: state.unlocked && Boolean(await readAgeFocusParams(supabase)) });
    } catch (err) {
      captureException(err, { tags: { route: `/academy/v2${req.path}`, method: req.method } });
      respondFailed(res);
    }
  });

  router.put("/profile", requireAuth, writeLimiter, async (req: TeamRequest, res: Response, _next: NextFunction) => {
    try {
      if (!(await gate(req, res))) return;
      if (!(await isAcademyIntakePullEnabled(supabase))) { res.status(409).json({ error: "intake_pull_disabled" }); return; }
      if (normalizeAgeFocus(req.body?.ageFocus) && !(await readAgeFocusParams(supabase))) {
        respondFailed(res);
        return;
      }
      const result = await saveAcademyProfileWithAgeFocus(supabase, { teamId: req.team!.id, input: req.body ?? {}, now: now() });
      if (!result.ok) { res.status(400).json({ error: result.error }); return; }
      res.json(result);
    } catch (err) {
      captureException(err, { tags: { route: `/academy/v2${req.path}`, method: req.method } });
      respondFailed(res);
    }
  });

  return router;
}
