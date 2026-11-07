// #7824 · Mestertrøjen ved et rytternavn: verdensmester, U23-verdensmester,
// kontinentmester eller national mester fra sidste sæsons rangliste.
//
// Én komponent for alle flader (TASTE P12): navnecellen viser den højeste titel
// som en 16 px trøje efter navnet og hover-ikonet, i mærke-pladsen før
// status-mærkerne (talentmærket, #7879, står lige efter). Rytterprofilen viser
// alle titler i 24 px med den fulde tekst. Tooltip ved hover og ved tryk
// (fokus), med titlen og én sætning. Resten bor i Hjælp (P9).
//
// Trøjerne er en bevidst undtagelse fra stroke-reglen og guld-rationeringen
// (TASTE P7, ejer 6/11): fyldte, flerfarvede trøjer, der kun bruges her. Egne
// trøjer, ingen regnbuebånd. Den nationale trøje er rytterens flag klippet til
// trøjens form, så farverne altid er flagets egne.
//
// Kontakten champion_jerseys_7824 evalueres server-side mod viewerens
// beta-status (GET /api/feature-flags). Slukket, fejl eller manglende svar =
// intet synligt, og titlerne hentes slet ikke. Titlerne skifter kun ved
// sæsonskifte; de hentes her én gang pr. sidevisning, delt af alle celler.
import { useId, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import "flag-icons/css/flag-icons.min.css";
import { supabase } from "../../lib/supabase.ts";
import { fetchPlayerFeatureFlags } from "../../lib/playerFeatureFlags.js";
import { getCountryName } from "../../lib/countryUtils.js";
import {
  CHAMPION_JERSEYS_FLAG_KEY,
  continentJersey,
  continentKey,
  groupLatestSeason,
  highestTitle,
  nationCode,
} from "../../lib/championJerseyModel.ts";
import type { ChampionTitleRow } from "../../lib/championJerseyModel.ts";
import { Tooltip } from "../ui";

export { CHAMPION_JERSEYS_FLAG_KEY };

// ── Delt opslag: ét kald for alle celler ─────────────────────────────────────
// Hentes igen når viewer skifter (log ind/ud: kontakten er pr. viewer) og når
// opslaget er mere end en time gammelt (et sæsonskifte kan være sket).

type StoreState = { status: "idle" | "loading" | "ready"; byRider: Map<string, ChampionTitleRow[]>; loadedAt: number };

export const CHAMPION_TITLES_REFRESH_MS = 60 * 60 * 1000;
const COLUMNS = "rider_id, title, scope, season_number";

let state: StoreState = { status: "idle", byRider: new Map(), loadedAt: 0 };
let generation = 0;
let authWatched = false;
const listeners = new Set<() => void>();

function setState(next: StoreState) {
  state = next;
  for (const fn of listeners) fn();
}

// Tabellen er nyere end de genererede typer (frontend/src/types/database.types.ts).
type Result = PromiseLike<{ data: unknown[] | null; error: unknown }>;
type Query = {
  eq: (column: string, value: number) => Query & Result;
  order: (column: string, opts?: { ascending?: boolean }) => Query & Result;
  limit: (n: number) => Result;
  range: (from: number, to: number) => Result;
};
type UntypedSelect = { from: (table: string) => { select: (columns: string) => Query } };

const PAGE_SIZE = 1000;

async function loadChampionTitles(): Promise<Map<string, ChampionTitleRow[]>> {
  const flags = await fetchPlayerFeatureFlags();
  if (flags?.[CHAMPION_JERSEYS_FLAG_KEY] !== true) return new Map();
  try {
    const client = supabase as unknown as UntypedSelect;
    // Den nyeste sæson med titler. Titlerne for en sæson skrives først, når den
    // forrige er afsluttet, så den nyeste er altid den, der bæres nu.
    const latest = await client.from("rider_champion_titles").select("season_number")
      .order("season_number", { ascending: false }).limit(1);
    const season = (latest.data?.[0] as { season_number?: unknown } | undefined)?.season_number;
    if (latest.error || typeof season !== "number") return new Map();
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await client.from("rider_champion_titles").select(COLUMNS)
        .eq("season_number", season).order("rider_id").range(from, from + PAGE_SIZE - 1);
      if (error || !Array.isArray(data)) return new Map();
      rows.push(...data);
      if (data.length < PAGE_SIZE) break;
    }
    return groupLatestSeason(rows);
  } catch {
    // catch-ok: trøjerne er pynt ved navnet; et fejlet opslag viser bare ingen trøjer.
    return new Map();
  }
}

function startLoad() {
  const mine = ++generation;
  setState({ ...state, status: "loading" });
  void loadChampionTitles().then((byRider) => {
    if (mine !== generation) return;
    setState({ status: "ready", byRider, loadedAt: Date.now() });
  });
}

function watchViewer() {
  if (authWatched || typeof window === "undefined") return;
  authWatched = true;
  supabase.auth.onAuthStateChange((event) => {
    if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
    // Ny viewer: intet fra den forrige må stå, heller ikke mens det nye hentes.
    generation += 1;
    setState({ status: "idle", byRider: new Map(), loadedAt: 0 });
    if (listeners.size > 0) startLoad();
  });
}

function ensureFresh() {
  if (state.status === "idle") { startLoad(); return; }
  if (state.status === "ready" && Date.now() - state.loadedAt > CHAMPION_TITLES_REFRESH_MS) startLoad();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  watchViewer();
  ensureFresh();
  return () => { listeners.delete(fn); };
}

const getSnapshot = () => state;

/** Rytterens titler fra højeste til laveste, eller [] (kontakten slukket, ingen titel, ikke hentet endnu). */
export function useChampionTitles(riderId: string | null | undefined): ChampionTitleRow[] {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!riderId) return EMPTY;
  return snap.byRider.get(riderId) ?? EMPTY;
}
const EMPTY: ChampionTitleRow[] = [];

// ── Trøjerne ─────────────────────────────────────────────────────────────────
// Tegnet i et 24-gitter: krop med korte ærmer og rund hals. Konturen er en tynd
// streg i tekstfarven, så den hvide trøje kan ses på lys baggrund.

const JERSEY_PATH = "M8.2 2.5 L4.2 4 L1 8.2 L3.6 10.8 L6 9.2 L6 21.5 L18 21.5 L18 9.2 L20.4 10.8 L23 8.2 L19.8 4 L15.8 2.5 C15 4 13.7 4.8 12 4.8 C10.3 4.8 9 4 8.2 2.5 Z";
const WHITE = "rgb(255 255 255)";
const NAVY = "rgb(20 33 61)";
const GOLD = "rgb(212 160 23)";
const JERSEY_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${JERSEY_PATH}"/></svg>`,
)}")`;

function Outline() {
  return <path d={JERSEY_PATH} fill="none" className="stroke-cz-3" strokeWidth={0.9} strokeLinejoin="round" />;
}

function WorldJersey({ size, u23 }: { size: number; u23: boolean }) {
  const clip = `cj-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" className="block flex-none">
      <defs><clipPath id={clip}><path d={JERSEY_PATH} /></clipPath></defs>
      <g clipPath={`url(#${clip})`}>
        <rect x="0" y="0" width="24" height="24" fill={WHITE} />
        {/* Brystbåndet: navy, guld, navy. */}
        <rect x="0" y="9.5" width="24" height="1.7" fill={NAVY} />
        <rect x="0" y="11.2" width="24" height="1.6" fill={GOLD} />
        <rect x="0" y="12.8" width="24" height="1.7" fill={NAVY} />
        {u23 && (
          <>
            <rect x="6" y="16.1" width="12" height="5.4" fill={NAVY} />
            <text x="12" y="20.35" textAnchor="middle" fontSize="4.6" fontWeight="800" fill={WHITE}
              fontFamily="Inter Tight, Inter, system-ui, sans-serif">23</text>
          </>
        )}
      </g>
      <Outline />
    </svg>
  );
}

function ContinentJersey({ size, scope }: { size: number; scope: string }) {
  const spec = continentJersey(scope);
  if (!spec) return null;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" className="block flex-none">
      <path d={JERSEY_PATH} fill={spec.body} />
      {/* Tre prikker i en trekant, store nok til at stå tydeligt ved 16 px. */}
      <circle cx="12" cy="10.6" r="1.9" fill={spec.dots} />
      <circle cx="9.4" cy="15.3" r="1.9" fill={spec.dots} />
      <circle cx="14.6" cy="15.3" r="1.9" fill={spec.dots} />
      <Outline />
    </svg>
  );
}

function NationalJersey({ size, code }: { size: number; code: string }) {
  return (
    <span className="relative block flex-none" style={{ width: size, height: size }} aria-hidden="true">
      <span
        className={`fi fi-${code} absolute inset-0`}
        style={{
          width: size,
          height: size,
          fontSize: 0,
          lineHeight: 0,
          backgroundSize: "cover",
          backgroundPosition: "center",
          maskImage: JERSEY_MASK,
          WebkitMaskImage: JERSEY_MASK,
          maskSize: "100% 100%",
          WebkitMaskSize: "100% 100%",
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
        }}
      />
      <svg viewBox="0 0 24 24" width={size} height={size} focusable="false" className="absolute inset-0 block">
        <Outline />
      </svg>
    </span>
  );
}

/** Selve trøjen for en titel, uden tekst. */
export function JerseyIcon({ row, size = 16 }: { row: Pick<ChampionTitleRow, "title" | "scope">; size?: number }) {
  if (row.title === "world") return <WorldJersey size={size} u23={false} />;
  if (row.title === "u23_world") return <WorldJersey size={size} u23 />;
  if (row.title === "continent") return <ContinentJersey size={size} scope={row.scope} />;
  const code = nationCode(row.scope);
  return code ? <NationalJersey size={size} code={code} /> : null;
}

// ── Teksterne ────────────────────────────────────────────────────────────────

type T = (key: string, opts?: Record<string, unknown>) => string;

function titleText(row: ChampionTitleRow, t: T, lang: string) {
  if (row.title === "continent") {
    const key = continentKey(row.scope);
    if (!key) return null;
    return { name: t(`championJersey.continent.${key}`), short: t("championJersey.continent.short"), full: t("championJersey.continent.full", { prev: row.season_number - 1, season: row.season_number }) };
  }
  if (row.title === "national") {
    const code = nationCode(row.scope);
    if (!code) return null;
    const country = getCountryName(code.toUpperCase(), lang);
    return {
      name: t("championJersey.national.name", { country }),
      short: t("championJersey.national.short", { country }),
      full: t("championJersey.national.full", { country, prev: row.season_number - 1, season: row.season_number }),
    };
  }
  const base = row.title === "world" ? "championJersey.world" : "championJersey.u23World";
  return { name: t(`${base}.name`), short: t(`${base}.short`), full: t(`${base}.full`, { prev: row.season_number - 1, season: row.season_number }) };
}

// ── Visningen ────────────────────────────────────────────────────────────────

/** Ren visning af den højeste titel i 16 px med tooltip (ingen hentning). */
export function ChampionJerseyMark({ titles }: { titles: readonly ChampionTitleRow[] }) {
  const { t, i18n } = useTranslation("rider");
  const top = highestTitle(titles);
  if (!top) return null;
  const text = titleText(top, t as T, i18n.language);
  if (!text) return null;
  return (
    <Tooltip label={`${text.name}: ${text.short}`} id={undefined}>
      <button
        type="button"
        aria-label={text.name}
        data-testid={`champion-jersey-${top.title}`}
        // Rækker i tabeller er ofte klikbare: et tryk på trøjen viser tooltippen
        // og må ikke åbne rytteren.
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
        className="inline-flex items-center justify-center rounded-cz p-0.5 -m-0.5 focus-visible:outline-2 focus-visible:outline-cz-accent"
      >
        <JerseyIcon row={top} size={16} />
      </button>
    </Tooltip>
  );
}

/** Ren visning af alle titler i 24 px med den fulde tekst (rytterprofilen). */
export function ChampionJerseyList({ titles }: { titles: readonly ChampionTitleRow[] }) {
  const { t, i18n } = useTranslation("rider");
  const items = titles
    .map((row) => ({ row, text: titleText(row, t as T, i18n.language) }))
    .filter((item): item is { row: ChampionTitleRow; text: NonNullable<ReturnType<typeof titleText>> } => item.text !== null);
  if (items.length === 0) return null;
  return (
    <div className="mt-2.5 flex max-w-xl flex-col gap-1.5" data-testid="champion-jerseys-profile">
      {items.map(({ row, text }) => (
        <div key={`${row.title}-${row.scope}`} className="flex items-start gap-2">
          <JerseyIcon row={row} size={24} />
          <p className="text-sm leading-snug text-cz-2">
            <span className="font-semibold text-cz-1">{text.name}</span>
            {" · "}
            {text.full}
          </p>
        </div>
      ))}
      <Link to="/help?section=riders" className="text-sm text-cz-accent-t hover:underline">
        {t("championJersey.helpLink")}
      </Link>
    </div>
  );
}

/** Mestertrøjen for en rytter fra det delte opslag. Ingen titel = ingenting renderes. */
export default function RiderChampionJersey({ riderId, variant = "cell" }: { riderId: string | null | undefined; variant?: "cell" | "profile" }) {
  const titles = useChampionTitles(riderId);
  if (titles.length === 0) return null;
  return variant === "profile" ? <ChampionJerseyList titles={titles} /> : <ChampionJerseyMark titles={titles} />;
}
