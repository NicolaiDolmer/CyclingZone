// #7879 (del af #7824) · Talentmærket ved et rytternavn: Toptalent (slebet
// guldstjerne) eller Næste generation (slebet diamant).
//
// Én komponent for alle flader (TASTE P12): navnecellen viser ikonet i 16 px
// efter navnet og før status-mærkerne, hover-kortet det samme, og rytterprofilen
// viser ikonet i 24 px med samme sætning. Tooltip ved hover og ved tryk
// (fokus), med navnet og én kort sætning. Hjælp siger kun, at mærkerne findes og
// hvad de betyder; reglerne er private.
//
// Ikonerne er en bevidst undtagelse fra stroke-reglen og guld-rationeringen
// (TASTE P7, ejer 6/11): to fyldte, slebne symboler, der kun bruges her.
//
// Kontakten talent_marks_7879 evalueres server-side mod viewerens beta-status
// (GET /api/feature-flags). Slukket, fejl eller manglende svar = intet synligt,
// og mærkerne hentes slet ikke. Mærkerne regnes én gang i døgnet af backenden
// (backend/lib/talentMarks7879.js) og hentes her højst én gang i timen, delt af
// alle celler.
import { useSyncExternalStore } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase.ts";
import { fetchPlayerFeatureFlags } from "../../lib/playerFeatureFlags.js";
import { Tooltip } from "../ui";

export const TALENT_MARKS_FLAG_KEY = "talent_marks_7879";

export type TalentMarkKind = "top_talent" | "next_gen";

export interface TalentMarkRow {
  rider_id: string;
  mark: TalentMarkKind;
  rider_type: string | null;
}

// ── Delt opslag: ét kald for alle celler ─────────────────────────────────────
// Hentes igen når viewer skifter (log ind/ud: kontakten er pr. viewer) og når
// opslaget er mere end en time gammelt (mærkerne skifter én gang i døgnet).
// Et svar fra et forældet opslag kasseres.

type StoreState = { status: "idle" | "loading" | "ready"; byRider: Map<string, TalentMarkRow>; loadedAt: number };

export const TALENT_MARKS_REFRESH_MS = 60 * 60 * 1000;
export const TALENT_MARKS_CHECK_MS = 5 * 60 * 1000;
const PAGE_SIZE = 1000;

let state: StoreState = { status: "idle", byRider: new Map(), loadedAt: 0 };
let generation = 0;
let authWatched = false;
let viewerId: string | null | undefined; // undefined = endnu ikke set
let refreshTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function setState(next: StoreState) {
  state = next;
  for (const fn of listeners) fn();
}

// Tabellen er nyere end de genererede typer (frontend/src/types/database.types.ts).
type PageResult = PromiseLike<{ data: unknown[] | null; error: unknown }>;
type UntypedSelect = {
  from: (table: string) => {
    select: (columns: string) => { order: (column: string) => { range: (from: number, to: number) => PageResult } };
  };
};

function isMarkRow(row: unknown): row is TalentMarkRow {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  return typeof r.rider_id === "string" && (r.mark === "top_talent" || r.mark === "next_gen");
}

async function loadTalentMarks(): Promise<Map<string, TalentMarkRow>> {
  const flags = await fetchPlayerFeatureFlags();
  if (flags?.[TALENT_MARKS_FLAG_KEY] !== true) return new Map();
  const out = new Map<string, TalentMarkRow>();
  try {
    const client = supabase as unknown as UntypedSelect;
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await client.from("rider_talent_marks")
        .select("rider_id, mark, rider_type").order("rider_id").range(from, from + PAGE_SIZE - 1);
      if (error || !Array.isArray(data)) return new Map();
      for (const row of data) if (isMarkRow(row)) out.set(row.rider_id, row);
      if (data.length < PAGE_SIZE) break;
    }
    return out;
  } catch {
    // catch-ok: mærkerne er pynt ved navnet; et fejlet opslag viser bare ingen mærker.
    return new Map();
  }
}

function startLoad() {
  const mine = ++generation;
  setState({ ...state, status: "loading" });
  void loadTalentMarks().then((byRider) => {
    if (mine !== generation) return;
    setState({ status: "ready", byRider, loadedAt: Date.now() });
  });
}

function watchViewer() {
  if (authWatched || typeof window === "undefined") return;
  authWatched = true;
  supabase.auth.onAuthStateChange((_event, session) => {
    // Kun en ny viewer tæller: SIGNED_IN kommer også, når fanen får fokus igen, og
    // mærkerne må ikke blinke væk af den grund.
    const next = session?.user?.id ?? null;
    const changed = viewerId !== undefined && next !== viewerId;
    viewerId = next;
    if (!changed) return;
    // Ny viewer: intet fra den forrige må stå, heller ikke mens det nye hentes.
    generation += 1;
    setState({ status: "idle", byRider: new Map(), loadedAt: 0 });
    if (listeners.size > 0) startLoad();
  });
}

function ensureFresh() {
  if (state.status === "idle") { startLoad(); return; }
  if (state.status === "ready" && Date.now() - state.loadedAt > TALENT_MARKS_REFRESH_MS) startLoad();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  watchViewer();
  ensureFresh();
  // En åben side monterer ingen nye celler, så friskheden tjekkes, så længe nogen lytter.
  if (refreshTimer === null && typeof window !== "undefined") {
    refreshTimer = setInterval(ensureFresh, TALENT_MARKS_CHECK_MS);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && refreshTimer !== null) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  };
}

const getSnapshot = () => state;
const getServerSnapshot = () => state;

/** Rytterens talentmærke, eller null (kontakten slukket, intet mærke, ikke hentet endnu). */
export function useTalentMark(riderId: string | null | undefined): TalentMarkRow | null {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!riderId) return null;
  return snap.byRider.get(riderId) ?? null;
}

/** Kun til tests: nulstil det delte opslag. */
export function resetTalentMarksForTests(next?: Map<string, TalentMarkRow>) {
  generation += 1;
  state = next ? { status: "ready", byRider: next, loadedAt: Date.now() } : { status: "idle", byRider: new Map(), loadedAt: 0 };
  for (const fn of listeners) fn();
}

// ── Ikonerne ─────────────────────────────────────────────────────────────────
// Tegnet i et 24-gitter. Stjernen er ti trekanter fra midten ud til spidserne og
// kanterne, skiftevis lys og mørk guld; diamanten er seks flader, skiftevis
// forgrundsfarve og dæmpet. Den mørke guld i mørkt tema er stjernens egen farve
// (TASTE P7-undtagelsen), ikke et nyt token.

const STAR_CENTER = "12,12.8";
const STAR_POINTS = [
  "12,1.6", "14.7,9.08", "22.65,9.34", "16.37,14.22", "18.58,21.86",
  "12,17.4", "5.42,21.86", "7.63,14.22", "1.35,9.34", "9.3,9.08",
];
const GOLD_A = "fill-cz-accent-t";
const GOLD_B = "fill-cz-accent dark:fill-[rgb(160_120_0)]";

export function TopTalentIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" className="block flex-none">
      {STAR_POINTS.map((p, i) => (
        <polygon
          key={p}
          className={i % 2 ? GOLD_A : GOLD_B}
          points={`${STAR_CENTER} ${p} ${STAR_POINTS[(i + 1) % STAR_POINTS.length]}`}
        />
      ))}
    </svg>
  );
}

const DIAMOND_FACETS: ReadonlyArray<[string, boolean]> = [
  ["3,9.5 7,4 9,9.5", true],
  ["7,4 17,4 15,9.5 9,9.5", false],
  ["17,4 21,9.5 15,9.5", true],
  ["3,9.5 9,9.5 12,21", false],
  ["9,9.5 15,9.5 12,21", true],
  ["15,9.5 21,9.5 12,21", false],
];

export function NextGenIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" className="block flex-none">
      {DIAMOND_FACETS.map(([points, light]) => (
        <polygon key={points} className={light ? "fill-cz-1" : "fill-cz-3"} points={points} />
      ))}
    </svg>
  );
}

// ── Visningen ────────────────────────────────────────────────────────────────

const NAME_KEY: Record<TalentMarkKind, string> = {
  top_talent: "talentMark.topTalent.name",
  next_gen: "talentMark.nextGen.name",
};

const TEXT_KEY: Record<TalentMarkKind, string> = {
  top_talent: "talentMark.topTalent.text",
  next_gen: "talentMark.nextGen.text",
};

export interface TalentMarkProps {
  mark: TalentMarkKind;
  /** "cell": 16 px ikon med tooltip. "profile": 24 px ikon med teksten. */
  variant?: "cell" | "profile";
}

/**
 * Ren visning af ét mærke (ingen hentning). Teksten er én kort sætning uden tal;
 * reglerne bag mærket er private og forklares hverken her eller i Hjælp.
 */
export function TalentMark({ mark, variant = "cell" }: TalentMarkProps) {
  const { t } = useTranslation("rider");
  const name = t(NAME_KEY[mark]);
  const text = t(TEXT_KEY[mark]);
  const Icon = mark === "top_talent" ? TopTalentIcon : NextGenIcon;

  if (variant === "profile") {
    return (
      <div className="flex items-start gap-2 mt-2.5 max-w-xl" data-testid={`talent-mark-profile-${mark}`}>
        <Icon size={24} />
        <p className="text-sm text-cz-2 leading-snug">
          <span className="font-semibold text-cz-1">{name}</span>
          {" · "}
          {text}{" "}
          <Link to="/help?section=riders" className="text-cz-accent-t hover:underline whitespace-nowrap">
            {t("talentMark.helpLink")}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <Tooltip label={`${name}: ${text}`} id={undefined}>
      <button
        type="button"
        aria-label={name}
        data-testid={`talent-mark-${mark}`}
        // Rækker i tabeller er ofte klikbare: et tryk på mærket viser tooltippen
        // og må ikke åbne rytteren.
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
        className="inline-flex items-center justify-center rounded-cz p-0.5 -m-0.5 focus-visible:outline-2 focus-visible:outline-cz-accent"
      >
        <Icon size={16} />
      </button>
    </Tooltip>
  );
}

/** Mærket for en rytter fra det delte opslag. Intet mærke = ingenting renderes. */
export default function RiderTalentMark({ riderId, variant = "cell" }: { riderId: string | null | undefined; variant?: "cell" | "profile" }) {
  const row = useTalentMark(riderId);
  if (!row) return null;
  return <TalentMark mark={row.mark} variant={variant} />;
}
