// #5404 · off|beta|on PR. VIEWER for en spiller-synlig kontakt — uden at
// backend nogensinde skal sende det raa stadie, og uden en haandholdt liste
// over "hvilke flag er beta lige nu" (den ville gaa forældet i det øjeblik
// ejeren flipper et flag i admin-tavlen, #5259).
//
// ── TRICKET ──────────────────────────────────────────────────────────────
// GET /api/feature-flags evaluerer allerede off|beta|on til ÉN boolean FOR
// VIEWEREN (#4948, backend/api/featureFlagsApi.js) — og samme rute svarer
// ogsaa UDEN en Authorization-header, evalueret som en ANONYM spiller (aldrig
// beta-tester, jf. rutens egne kommentarer). En kontakt der er sand for MIG
// men falsk anonymt kan derfor kun være i stadiet "beta" lige nu; er den sand
// anonymt, er den "on" for alle. Diffen af to kald mod ÉN allerede
// eksisterende, offentlig rute er dermed altid i sync med et admin-flip —
// ingen liste at vedligeholde, og backend sender fortsat aldrig "beta" til en
// spiller der ikke er beta-tester (den ser blot to `false`-svar).
import { apiFetch } from "./apiFetch.ts";
// #5259/#5322-moenstret: INGEN statisk top-level import af "./supabase.ts" —
// den fil laeser import.meta.env.VITE_SUPABASE_URL UDEN optional chaining
// (modsat apiBase.ts) og krasher derfor ved blot at blive importeret under
// Node's ESM-loader (node --test har intet import.meta.env). Et dynamisk
// import() INDE i loadFeatureFlagStages() udskyder den indlæsning til den
// rent faktisk kaldes — featureStage.test.ts kan dermed teste de rene
// funktioner ovenfor uden nogensinde at røre supabase.ts.

export const FLAG_STAGES = ["off", "beta", "on"] as const;
export type FlagStage = (typeof FLAG_STAGES)[number];

/** Vises Beta-badgen for dette stadie? Ren, ingen sideeffekter. */
export function isBetaStage(stage: FlagStage | null | undefined): boolean {
  return stage === "beta";
}

/**
 * Ren udledning — testes uden netvaerk. `anonymous` vinder: sand anonymt
 * betyder "on" for alle, uanset hvad `mine` siger (en uventet uoverensstemmelse
 * fejler til den mest aabne, ikke-farlige tolkning). Sand kun for mig er
 * praecis definitionen af "beta for denne viewer". Alt andet er "off"
 * (fail-safe, samme retning som backendens egen evaluateFlagStage).
 */
export function deriveFlagStage(mine: boolean | null | undefined, anonymous: boolean | null | undefined): FlagStage {
  if (anonymous === true) return "on";
  if (mine === true) return "beta";
  return "off";
}

// CodeRabbit-fund (#5404, ÉN CLI-runde): et fejlet kald maa ALDRIG laese som
// "flaget er falsk" — det ville lade en anonym-fejl (netvaerk/429/5xx) tolkes
// som "kun jeg ser den", altsaa "beta", selv naar flaget faktisk staar paa
// "on" for alle. `null` = kaldet lykkedes ikke og siger INTET om flaget.
async function fetchFlags(headers: Record<string, string>): Promise<Record<string, boolean> | null> {
  try {
    const res = await apiFetch("/api/feature-flags", { headers });
    if (!res.ok) return null;
    const flags = (res.data as { flags?: unknown } | null)?.flags;
    return flags && typeof flags === "object" ? (flags as Record<string, boolean>) : null;
  } catch {
    return null;
  }
}

/**
 * off|beta|on pr. spiller-synlig kontakt (PLAYER_VISIBLE_FLAG_KEYS,
 * backend/lib/stageFlagCatalog.js) for DENNE viewer. Fejler ét af de
 * nødvendige kald (anonymt, eller mit eget når jeg er logget ind), er
 * resultatet {} — INGEN stadier kendes, badgen viser sig ikke, i stedet for
 * at gætte "beta" på et delvist svar (CodeRabbit-fund, #5404).
 *
 * Ingen deling af igangværende løfter på tværs af kaldere: et løfte der blev
 * startet for viewer A og landet efter viewer B er logget ind i samme faneblad
 * (log ud/log ind uden remount) må ALDRIG kunne levere A's stadier til B
 * (CodeRabbit-fund, #5404) — hvert kald henter derfor sit eget, friske svar.
 */
export async function loadFeatureFlagStages(): Promise<Record<string, FlagStage>> {
  const { authHeaders } = await import("./supabase.ts");
  const headers = (await authHeaders({ json: false })) ?? null;
  const [anonymous, mine] = await Promise.all([
    fetchFlags({}),
    headers ? fetchFlags(headers) : Promise.resolve<Record<string, boolean> | null>({}),
  ]);
  if (anonymous === null || mine === null) return {};
  const keys = new Set([...Object.keys(anonymous), ...Object.keys(mine)]);
  const stages: Record<string, FlagStage> = {};
  for (const key of keys) {
    stages[key] = deriveFlagStage(headers ? mine[key] : anonymous[key], anonymous[key]);
  }
  return stages;
}
