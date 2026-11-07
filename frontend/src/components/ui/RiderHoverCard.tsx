// #2009 · Hover-miniprofil paa ryttere (FM-stil), ÉN genbrugskomponent.
//
// Brug: pak rytternavnet ind, resten er uaendret.
//   <RiderHoverCard riderId={id} viewerTeamId={myTeamId}>
//     <RiderLink id={id}>…</RiderLink>
//   </RiderHoverCard>
//
// - Desktop (rigtig hover): kortet aabner naar musen hviler paa navnet og bliver
//   staaende mens musen er paa kortet. Et klik paa navnet aabner profilen som altid.
// - Mobil (intet hover): et tryk paa navnet aabner kortet som bundark med en
//   tydelig "Aabn profil"-knap, i stedet for at hoppe direkte til profilen.
// - Bag kontakten rider_hover_card (off | beta | on, beta-testere foerst). Slukket
//   eller ukendt = children returneres uaendret, intet ekstra i DOM'en.
//
// Indholdet kommer fra lib/riderHoverCardModel.ts (testet). Potentialet vises kun
// for egne ryttere (scouting-fog) og genbruger ScoutablePotentiale, saa kortet
// viser samme tal som resten af spillet.
//
// `extra` er pladsen til loebssidens kontekst (dagens plads, GC, troejer, egen
// plan, ejer 7/11): den staar mellem identiteten og evnerne.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import Portal from "./Portal.jsx";
import { XIcon } from "./icons/index.jsx";
import { buttonClass } from "./buttonStyles.js";
import { useModalA11y } from "../../hooks/useModalA11y.js";
import { useActiveSeasonYear } from "../../hooks/useActiveSeasonYear.js";
import { Flag } from "../Flag.jsx";
import RiderTypeBadge from "../rider/RiderTypeBadge.jsx";
import ScoutablePotentiale from "../rider/ScoutablePotentiale.jsx";
import { useScouting } from "../../lib/useScouting.js";
import { fetchPlayerFeatureFlags } from "../../lib/playerFeatureFlags.js";
import { ABILITY_SELECT } from "../../lib/abilities.js";
import { statPlateStyle, statStyle } from "../../lib/statColor.js";
import { supabase } from "../../lib/supabase.ts";
import { buildRiderHoverCardModel, canHover, placeHoverCard } from "../../lib/riderHoverCardModel.ts";
import type { HoverCardRiderRow, RiderHoverCardModel } from "../../lib/riderHoverCardModel.ts";

export const RIDER_HOVER_CARD_FLAG_KEY = "rider_hover_card";

const OPEN_DELAY_MS = 300;
const CLOSE_DELAY_MS = 150;
const CACHE_TTL_MS = 60_000;

// ── Kontakten: ét kald pr. side, ikke ét pr. raekke ──────────────────────────
let flagCache: { at: number; promise: Promise<boolean> } | null = null;

function loadHoverCardFlag(): Promise<boolean> {
  const now = Date.now();
  if (flagCache && now - flagCache.at < CACHE_TTL_MS) return flagCache.promise;
  const promise = fetchPlayerFeatureFlags()
    .then((flags: Record<string, boolean>) => flags?.[RIDER_HOVER_CARD_FLAG_KEY] === true)
    .catch(() => false);
  flagCache = { at: now, promise };
  return promise;
}

export function useRiderHoverCardEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    loadHoverCardFlag().then((on) => { if (alive) setEnabled(on); });
    return () => { alive = false; };
  }, []);
  return enabled;
}

// ── Rytterens data: hentes foerst naar kortet aabner, og huskes kort ─────────
const RIDER_COLUMNS =
  `id, firstname, lastname, birthdate, nationality_code, primary_type, secondary_type, team_id, team:team_id(id, name), ${ABILITY_SELECT}`;

type RiderQueryClient = {
  from(table: string): {
    select(cols: string): {
      eq(col: string, value: string): {
        maybeSingle(): PromiseLike<{ data: HoverCardRiderRow | null; error: unknown }>;
      };
    };
  };
};

const riderCache = new Map<string, { at: number; promise: Promise<HoverCardRiderRow | null> }>();

function loadRider(riderId: string): Promise<HoverCardRiderRow | null> {
  const hit = riderCache.get(riderId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;
  const client = supabase as unknown as RiderQueryClient;
  const promise = Promise.resolve(
    // pagination-safe: en raekke via primaernoeglen.
    client.from("riders").select(RIDER_COLUMNS).eq("id", riderId).maybeSingle(),
  ).then((res) => {
    if (res.error) throw res.error;
    return res.data ?? null;
  });
  // En fejl huskes ikke: naeste aabning proever igen.
  promise.catch(() => riderCache.delete(riderId));
  riderCache.set(riderId, { at: Date.now(), promise });
  return promise;
}

type LoadState = { status: "loading" | "ready" | "error"; row: HoverCardRiderRow | null };

function useHoverCardRider(riderId: string): LoadState {
  const [state, setState] = useState<LoadState>({ status: "loading", row: null });
  useEffect(() => {
    let alive = true;
    setState({ status: "loading", row: null });
    loadRider(riderId).then(
      (row) => { if (alive) setState({ status: row ? "ready" : "error", row }); },
      () => { if (alive) setState({ status: "error", row: null }); },
    );
    return () => { alive = false; };
  }, [riderId]);
  return state;
}

// ── Indholdet (samme i popover og bundark) ───────────────────────────────────
const LABEL = "font-data text-3xs font-semibold uppercase tracking-widest text-cz-3";

function OwnPotential({ riderId }: { riderId: string }) {
  const scouting = useScouting();
  return <ScoutablePotentiale rider={{ id: riderId }} scouting={scouting} />;
}

function AbilityRow({ abilityKey, value }: { abilityKey: string; value: number | null }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center justify-between gap-2 py-0.5">
      <span className="min-w-0 truncate text-xs text-cz-2">{t(`rider:racePreview.derived.${abilityKey}`)}</span>
      {value === null ? (
        <span className="text-xs text-cz-3 tabular-nums">—</span>
      ) : (
        <span
          className="inline-flex min-w-[26px] justify-center rounded-cz px-1 text-2xs font-semibold tabular-nums"
          style={statStyle(value)}
          data-ability={abilityKey}
        >
          {value}
        </span>
      )}
    </li>
  );
}

function AbilityGroup({ group }: { group: RiderHoverCardModel["groups"][number] }) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0">
      <p className={`${LABEL} mb-1`}>{t(`rider:stats.categories.${group.key}`)}</p>
      <ul>
        {group.abilities.map((a) => <AbilityRow key={a.key} abilityKey={a.key} value={a.value} />)}
      </ul>
    </div>
  );
}

function CardContent({ model, extra, titleId }: { model: RiderHoverCardModel; extra?: ReactNode; titleId: string }) {
  const { t } = useTranslation();
  const [physical, ...rest] = model.groups;
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="font-display text-[22px] leading-none uppercase text-cz-1 wrap-break-word">
            {model.nationalityCode && <Flag code={model.nationalityCode} className="me-1.5 align-[-1px] text-[15px]" />}
            {model.name || "—"}
          </h2>
          <p className="mt-1.5 text-xs text-cz-2">
            <span>{model.teamName ?? t("rider:header.freeAgent")}</span>
            {model.age !== null && (
              <span className="tabular-nums"> · {t("rider:header.ageYears", { age: model.age })}</span>
            )}
          </p>
          {model.primaryType && (
            <div className="mt-1.5">
              <RiderTypeBadge primaryType={model.primaryType} secondaryType={model.secondaryType} />
            </div>
          )}
        </div>
        <div className="flex-none text-right">
          <p className={`${LABEL} mb-1`}>{t("rider:header.overall")}</p>
          {model.rating === null ? (
            <span className="font-data text-[18px] text-cz-3">—</span>
          ) : (
            <span
              className="inline-flex min-w-[38px] justify-center rounded-cz px-1.5 py-0.5 font-data text-[18px] font-[650] leading-tight tabular-nums"
              style={statPlateStyle(model.rating)}
              data-rider-hover-rating={model.rating}
            >
              {model.rating}
            </span>
          )}
        </div>
      </div>

      {model.showPotential && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-cz-border pt-2.5" data-rider-hover-potential="">
          <span className={LABEL}>{t("rider:header.potential")}</span>
          <OwnPotential riderId={model.id} />
        </div>
      )}

      {extra && <div className="mt-3 border-t border-cz-border pt-2.5">{extra}</div>}

      <div className="mt-3 grid grid-cols-2 gap-x-5 border-t border-cz-border pt-2.5">
        {physical && <AbilityGroup group={physical} />}
        <div className="flex min-w-0 flex-col gap-3">
          {rest.map((g) => <AbilityGroup key={g.key} group={g} />)}
        </div>
      </div>
    </>
  );
}

function CardBody({ riderId, viewerTeamId, extra, titleId }: { riderId: string; viewerTeamId: string | null; extra?: ReactNode; titleId: string }) {
  const { t } = useTranslation();
  const seasonYear = useActiveSeasonYear();
  const { status, row } = useHoverCardRider(riderId);
  if (status === "loading") {
    return <p className="py-6 text-center text-xs text-cz-3">{t("common:actions.loading")}</p>;
  }
  const model = buildRiderHoverCardModel(row, { viewerTeamId, seasonYear });
  if (!model) {
    return <p className="py-6 text-center text-xs text-cz-3">{t("common:riderHoverCard.loadError")}</p>;
  }
  return <CardContent model={model} extra={extra} titleId={titleId} />;
}

// ── Desktop: popover ved navnet ──────────────────────────────────────────────
function HoverPopover({
  anchor, riderId, viewerTeamId, extra, onEnter, onLeave, onClose,
}: {
  anchor: HTMLElement; riderId: string; viewerTeamId: string | null; extra?: ReactNode;
  onEnter: () => void; onLeave: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const titleId = `rider-hover-card-${riderId}`;

  const place = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const r = anchor.getBoundingClientRect();
    const next = placeHoverCard(r, { width: node.offsetWidth, height: node.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
    setPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : { top: next.top, left: next.left }));
  }, [anchor]);

  useLayoutEffect(() => { place(); });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <Portal>
      <div
        ref={ref}
        role="dialog"
        aria-labelledby={titleId}
        data-testid="rider-hover-card"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
        className="fixed z-overlay w-[22rem] max-w-[calc(100vw-1rem)] rounded-cz border border-cz-border border-t-2 border-t-cz-accent bg-cz-card p-4 shadow-overlay"
      >
        <CardBody riderId={riderId} viewerTeamId={viewerTeamId} extra={extra} titleId={titleId} />
      </div>
    </Portal>
  );
}

// ── Mobil: bundark efter et tryk ─────────────────────────────────────────────
function TapSheet({ riderId, viewerTeamId, extra, onClose }: { riderId: string; viewerTeamId: string | null; extra?: ReactNode; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useModalA11y(onClose, true);
  const titleId = `rider-hover-sheet-${riderId}`;
  return (
    <Portal>
      <div className="fixed inset-0 z-modal flex items-end justify-center">
        <div className="cz-overlay-backdrop absolute inset-0 bg-black/60" aria-hidden="true" onClick={onClose} />
        <div
          ref={ref}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          data-testid="rider-hover-sheet"
          className="cz-overlay-panel relative w-full max-w-lg max-h-[85dvh] overflow-y-auto rounded-t-cz border-x border-b-0 border-cz-border border-t-2 border-t-cz-accent bg-cz-card px-4 pb-4 pt-4 shadow-overlay outline-hidden"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common:actions.close")}
            className="absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-cz text-cz-3 transition-colors hover:bg-cz-subtle hover:text-cz-1"
          >
            <XIcon size={18} aria-hidden="true" />
          </button>
          <div className="pe-8">
            <CardBody riderId={riderId} viewerTeamId={viewerTeamId} extra={extra} titleId={titleId} />
          </div>
          <Link to={`/riders/${riderId}`} onClick={onClose} className={`${buttonClass({ variant: "primary", size: "md", fullWidth: true })} mt-4`}>
            {t("common:riderHoverCard.openProfile")}
          </Link>
        </div>
      </div>
    </Portal>
  );
}

// ── Komponenten ──────────────────────────────────────────────────────────────
export type RiderHoverCardProps = {
  riderId: string | null | undefined;
  /** Viewerens eget hold. Kun ryttere herfra viser potentiale. */
  viewerTeamId?: string | number | null;
  /** Ekstra kontekst i kortet (fx loebssidens plads, GC, troejer). */
  extra?: ReactNode;
  children: ReactNode;
};

export default function RiderHoverCard({ riderId, viewerTeamId = null, extra, children }: RiderHoverCardProps) {
  const enabled = useRiderHoverCardEnabled();
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const [mode, setMode] = useState<"closed" | "popover" | "sheet">("closed");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const close = useCallback(() => { clearTimers(); setMode("closed"); }, [clearTimers]);
  const keepOpen = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const scheduleClose = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setMode((m) => (m === "popover" ? "closed" : m)), CLOSE_DELAY_MS);
  }, []);

  if (!enabled || !riderId) return <>{children}</>;

  const hoverDevice = () => canHover(typeof window === "undefined" ? null : window.matchMedia?.bind(window));
  const team = viewerTeamId === null || viewerTeamId === undefined ? null : String(viewerTeamId);
  // Wrapperen er display: contents (ingen egen boks), saa kortet maales mod navnet selv.
  const anchorNow = () => (wrapperRef.current?.firstElementChild as HTMLElement | null) ?? wrapperRef.current;
  // Kortet ligger i en portal, men React sender dets haendelser op gennem
  // wrapperen. Kun haendelser fra selve navnet maa aabne kortet.
  const fromTrigger = (target: EventTarget | null) => Boolean(wrapperRef.current && target instanceof Node && wrapperRef.current.contains(target));

  return (
    <span
      ref={wrapperRef}
      className="contents"
      data-rider-hover-trigger=""
      onMouseEnter={(e) => {
        if (!hoverDevice()) return;
        keepOpen();
        if (!fromTrigger(e.target) || mode === "popover" || openTimer.current) return;
        openTimer.current = setTimeout(() => {
          openTimer.current = null;
          setAnchor(anchorNow());
          setMode("popover");
        }, OPEN_DELAY_MS);
      }}
      onMouseLeave={() => { if (hoverDevice()) scheduleClose(); }}
      onClickCapture={(e) => {
        if (!fromTrigger(e.target)) return;
        if (hoverDevice()) { close(); return; }
        // Mobil: tryk aabner kortet i stedet for at navigere; profilen er én knap vaek.
        e.preventDefault();
        e.stopPropagation();
        clearTimers();
        setMode("sheet");
      }}
    >
      {children}
      {mode === "popover" && anchor && (
        <HoverPopover anchor={anchor} riderId={riderId} viewerTeamId={team} extra={extra}
          onEnter={keepOpen} onLeave={scheduleClose} onClose={close} />
      )}
      {mode === "sheet" && <TapSheet riderId={riderId} viewerTeamId={team} extra={extra} onClose={close} />}
    </span>
  );
}
