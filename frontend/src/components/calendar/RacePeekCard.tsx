// #6514 · Løbskortet i Planlægning → Kalender (bag race_library_v2).
//
// Ejer-beslutning 15/10: klik/hold på et løb åbner et lille kort med løbets
// terræn (TerrainTypeGlyph, én pr. type, højst 3, hårdeste først, INGEN samlet
// km; ejer 14:06/14:43 erstattede etapestrimlen og "Afgøres i"), "passer til
// holdet" 0-100 + bedste bud, min status og én guld-knap til udtagelsen. "Åbn løbet" fører til løbssiden som i dag. Kalenderens visning er
// ellers uændret.
//
// Kortet er UI-kittets Modal (PAGE_TEMPLATES: ingen ny dialog-markup). Al
// regning bor i lib/racePeek.ts (ren, testet); denne fil er render + IO.
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Link } from "react-router";
import { supabase, authHeaders } from "../../lib/supabase.ts";
import { apiFetch } from "../../lib/apiFetch.ts";
import { isViewerChangeEvent } from "../../lib/viewerChange.ts";
import {
  raceTerrain, bucketProfileType, raceDateRange, teamFit, selectionHref, raceDetailHref,
  type CalendarEntryLike, type FitRider, type RaceStatus, type RaceTerrain, type StageProfileLike,
} from "../../lib/racePeek.ts";
import RaceTerrainGlyphs from "../race/RaceTerrainGlyphs.tsx";
import ModalBase from "../ui/Modal.jsx";
import StatusBadgeBase from "../ui/StatusBadge.jsx";
import SkeletonBase from "../ui/Skeleton.jsx";
import { buttonClass } from "../ui/buttonStyles.js";

// Primitiverne i components/ui er stadig .jsx uden typer (samme greb som
// TradeListPage.tsx): kontrakten skrives ned her, læst af de tre filer.
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  size?: string;
  closeLabel?: string;
  ariaLabelledby?: string;
  children?: ReactNode;
}
const Modal = ModalBase as unknown as ComponentType<ModalProps>;
const StatusBadge = StatusBadgeBase as unknown as ComponentType<{ state: string; children?: ReactNode }>;
const Skeleton = SkeletonBase as unknown as ComponentType<{ className?: string }>;

type Translate = (key: string, opts?: Record<string, unknown>) => string;

export interface PeekEntry extends CalendarEntryLike {
  name: string;
  raceType?: string | null;
  stages?: number | null;
  poolLabel?: string | null;
  terrain?: string | null;
}

interface SeasonFitRace { id: string; demandVector?: Record<string, number> | null; sizeMax?: number | null }
interface SeasonFitData { enabled?: boolean; races?: SeasonFitRace[]; riders?: FitRider[] }

// Sæsonmatrixens svar pr. sæson (trup + rute-match pr. løb). Hentes først når et
// kort for holdets eget løb åbnes, og kun én gang pr. sæson pr. sideindlæsning.
const seasonFitCache = new Map<string, Promise<SeasonFitData | null>>();
let fitAuthListenerInstalled = false;
// Codex-fund: svaret er den indloggede managers trup. Modulet overlever logout i
// samme SPA-fane, så cachen tømmes når viewer skifter.
function installFitAuthListener(): void {
  if (fitAuthListenerInstalled) return;
  fitAuthListenerInstalled = true;
  supabase.auth.onAuthStateChange((event) => {
    if (isViewerChangeEvent(event)) seasonFitCache.clear();
  });
}
function loadSeasonFit(seasonNumber: number | null | undefined): Promise<SeasonFitData | null> {
  installFitAuthListener();
  const key = String(seasonNumber ?? "active");
  const cached = seasonFitCache.get(key);
  if (cached) return cached;
  const p = (async () => {
    const headers = await authHeaders({ json: false });
    if (!headers) return null;
    const qs = Number.isFinite(seasonNumber) ? `?season_number=${seasonNumber}` : "";
    const res = await apiFetch(`/api/races/selection/season${qs}`, { headers });
    const data = res.data as SeasonFitData | null;
    return res.ok && data?.enabled ? data : null;
  })().catch(() => null);
  p.then((v) => { if (!v) seasonFitCache.delete(key); });
  seasonFitCache.set(key, p);
  return p;
}

const STATUS_BADGE: Record<RaceStatus, string> = { missing: "closing", selected: "won", gtBound: "info" };

interface RacePeekCardProps {
  entry: PeekEntry | null;
  status: RaceStatus | null;
  days: ReadonlyArray<{ date?: string | null }>;
  seasonNumber?: number | null;
  t: Translate;
  locale?: string;
  onClose: () => void;
  stage?: number | null; // klikket etape, bevares i loebslinket
}

export default function RacePeekCard({ entry, status, days, seasonNumber, t, locale, onClose, stage = null }: RacePeekCardProps) {
  const open = entry != null;
  const raceId = entry?.id ?? null;
  const [profiles, setProfiles] = useState<StageProfileLike[] | null>(null); // null = henter
  const [fitData, setFitData] = useState<SeasonFitData | null | undefined>(undefined); // undefined = henter

  useEffect(() => {
    if (!raceId) return undefined;
    let alive = true;
    setProfiles(null);
    // pagination-safe: filtreret på ét race_id, højst én række pr. etape.
    supabase.from("race_stage_profiles").select("stage_number, profile_type").eq("race_id", raceId).order("stage_number")
      .then(({ data, error }) => { if (alive) setProfiles(error ? [] : (data as StageProfileLike[] | null) || []); },
        () => { if (alive) setProfiles([]); });
    return () => { alive = false; };
  }, [raceId]);

  const mine = Boolean(entry?.isMine);
  useEffect(() => {
    if (!raceId || !mine) { setFitData(null); return undefined; }
    let alive = true;
    setFitData(undefined);
    loadSeasonFit(seasonNumber).then((d) => { if (alive) setFitData(d); });
    return () => { alive = false; };
  }, [raceId, mine, seasonNumber]);

  // Terræn: race_stage_profiles; mangler de, falder kortet tilbage til
  // kalenderens egen terræn-bucket pr. etape (aldrig et tomt kort).
  const terrain = useMemo<RaceTerrain[]>(() => {
    if (!entry) return [];
    if (profiles && profiles.length) return raceTerrain(profiles.map((p) => p.profile_type));
    const sched = entry.stageSchedule || [];
    if (sched.length) return raceTerrain(sched.map((s) => bucketProfileType(s.terrain)));
    return entry.terrain ? raceTerrain([bucketProfileType(entry.terrain)]) : [];
  }, [entry, profiles]);

  const fit = useMemo(() => {
    if (!fitData || !raceId) return null;
    const race = (fitData.races || []).find((r) => r.id === raceId);
    if (!race) return null;
    return teamFit({ demandVector: race.demandVector, riders: fitData.riders, size: race.sizeMax });
  }, [fitData, raceId]);

  if (!entry) return null;

  const range = raceDateRange(entry);
  const isStageRace = entry.raceType === "stage_race";
  const meta = [
    isStageRace ? t("peek.stages", { count: entry.stages }) : t("peek.oneDay"),
    range ? formatRange(range, locale) : null,
    entry.poolLabel,
  ].filter(Boolean).join(" · ");

  const raceHref = raceDetailHref(entry.id, isStageRace ? stage : null);
  const canPick = mine && (status === "missing" || status === "selected" || status === "gtBound");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={entry.name}
      description={meta}
      closeLabel={t("common:actions.close")}
      size="sm"
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link to={raceHref} className={buttonClass({ variant: "secondary", size: "sm" })} onClick={onClose}>
            {t("peek.openRace")}
          </Link>
          {canPick && (
            <Link to={selectionHref(range?.start, days)} className={buttonClass({ variant: "primary", size: "sm" })} onClick={onClose}>
              {status === "selected" ? t("peek.editSquad") : t("peek.pick")}
            </Link>
          )}
        </div>
      )}
    >
      <div className="space-y-4" data-testid="race-peek-card">
        <dl className="divide-y divide-cz-border text-[13px]">
          <Row label={t("peek.terrain")}>
            {profiles === null ? <Skeleton className="ms-auto h-3 w-20" /> : terrain.length === 0 ? (
              <span className="text-cz-3">{t("peek.noProfile")}</span>
            ) : (
              <RaceTerrainGlyphs
                terrain={terrain}
                label={(x) => t("peek.terrainCount", { type: t(`terrain.${x.kind}`), count: x.count })}
                testId="race-peek-terrain"
              />
            )}
          </Row>
          {mine && (
            <Row label={t("peek.teamFit")}>
              {fitData === undefined ? <Skeleton className="ms-auto h-3 w-20" /> : fit ? (
                <span className="text-right">
                  <span className="font-data font-semibold tabular-nums text-cz-1">{fit.score}</span>
                  <span className="font-data tabular-nums text-cz-3">/100</span>
                  <span className="block text-2xs text-cz-2">
                    {t("peek.bestBet", { name: fit.best.name, score: fit.best.score })}
                  </span>
                </span>
              ) : <span className="text-cz-3">{t("peek.fitUnavailable")}</span>}
            </Row>
          )}
          {status && (
            <Row label={t("peek.status.label")}>
              <StatusBadge state={STATUS_BADGE[status]}>{t(`peek.status.${status}`)}</StatusBadge>
            </Row>
          )}
        </dl>
      </div>
    </Modal>
  );
}

function Row({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-cz-2">{label}</dt>
      <dd className="m-0 min-w-0 text-right">{children}</dd>
    </div>
  );
}

// "26.-28. okt." / "Oct 26 - 28": Intl's egen interval-formattering, Europe/Copenhagen.
function formatRange({ start, end }: { start: string; end: string }, locale?: string): string {
  const toDate = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12));
  };
  const fmt = new Intl.DateTimeFormat(locale || "en", { timeZone: "Europe/Copenhagen", day: "numeric", month: "short" });
  if (start === end) return fmt.format(toDate(start));
  return fmt.formatRange(toDate(start), toDate(end));
}
