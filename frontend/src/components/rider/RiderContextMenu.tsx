// #7858 · Hoejreklik-menuen paa ryttere (langt tryk paa mobil, Shift+F10 paa tastatur).
//
// Valgene afgoeres af lib/riderContextMenuModel.ts (testet): alle ryttere,
// andres ryttere og egne ryttere faar hver kun de valg der giver mening. Menuen
// opfinder ingen ny handling: den navigerer til de skaerme der allerede findes,
// skifter oenskelisten med de samme raekker som rytterdatabasen og genbruger
// MessageManagerButton-flowet til "skriv til manageren". Afskedigelse sker paa
// profilen, hvor RiderManageActions spoerger "er du sikker?" som i dag.
//
// Tilgaengelighed: role="menu" med menuitems, fokus paa foerste valg, piletaster,
// Home/End, Esc lukker, fokus-faelde og fokus tilbage til navnet (useModalA11y).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Portal from "../ui/Portal.jsx";
import { useModalA11y } from "../../hooks/useModalA11y.js";
import MessageManagerButton from "../messages/MessageManagerButton.jsx";
import { setRiderWatchlist, useRiderCardData } from "../ui/RiderHoverCard.tsx";
import { buildRiderContextMenu, nextMenuIndex, placeContextMenu } from "../../lib/riderContextMenuModel.ts";
import type { RiderMenuItem } from "../../lib/riderContextMenuModel.ts";

const ITEM = "flex w-full min-h-9 items-center px-3 py-1.5 text-left text-sm text-cz-1 outline-hidden transition-colors hover:bg-cz-subtle focus-visible:bg-cz-subtle pointer-coarse:min-h-11";

/** Aabner MessageManagerButton-flowet (samtale eller skrivefelt) uden egen knap. */
function MessageLauncher({ teamId, managerName }: { teamId: string; managerName: string | null }) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const clicked = useRef(false);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const tryClick = () => {
      const button = host.querySelector("button");
      if (button && !clicked.current) { clicked.current = true; button.click(); }
    };
    tryClick();
    // Knappen dukker foerst op naar den ved hvilket hold der er ens eget.
    const mo = new MutationObserver(tryClick);
    mo.observe(host, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  // Klikket og skrivefeltets haendelser (portal) bobler op gennem React-traeet:
  // de maa ikke naa en klikbar raekke, der ellers navigerer vaek (Codex-fund).
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  return (
    <span ref={hostRef} className="sr-only" aria-hidden="true"
      onClick={stop} onMouseDown={stop} onKeyDown={stop} onContextMenu={stop}>
      <MessageManagerButton teamId={teamId} managerName={managerName ?? ""} />
    </span>
  );
}

export type RiderContextMenuProps = {
  riderId: string;
  name: string | null;
  point: { x: number; y: number };
  onClose: () => void;
};

export default function RiderContextMenu({ riderId, name, point, onClose }: RiderContextMenuProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { status, data, viewerTeamId, viewerResolved, reload } = useRiderCardData(riderId);
  const [phase, setPhase] = useState<"menu" | "message">("menu");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const row = data?.row ?? null;
  const team = row?.team ?? null;
  const riderTeamId = row ? (row.team_id ?? team?.id ?? null) : null;
  const items = buildRiderContextMenu({
    riderId,
    viewerTeamId,
    riderTeamId: riderTeamId === null ? null : String(riderTeamId),
    loaded: viewerResolved && status !== "loading" && Boolean(row),
    isRetired: row?.is_retired === true,
    onWatchlist: data?.onWatchlist ?? null,
    canMessageManager: Boolean(team?.manager_name) && team?.is_ai !== true && team?.is_bank !== true,
    currentRaceId: data?.race?.raceId ?? null,
  });
  const displayName = name || (row ? `${row.firstname ?? ""} ${row.lastname ?? ""}`.trim() : "");

  if (phase === "message" && riderTeamId) {
    return <MessageLauncher teamId={String(riderTeamId)} managerName={team?.manager_name ?? null} />;
  }

  return (
    <MenuPanel
      items={items}
      label={t("common:riderMenu.label", { name: displayName })}
      loading={status === "loading" || !viewerResolved}
      failed={failed}
      busy={busy}
      point={point}
      onClose={onClose}
      onPick={async (item) => {
        if (item.href) { onClose(); navigate(item.href); return; }
        if (item.action === "message") { setPhase("message"); return; }
        if (item.action === "watchlist" && data?.userId && !busy) {
          setBusy(true);
          setFailed(false);
          const ok = await setRiderWatchlist(data.userId, riderId, item.key === "watchlistAdd");
          setBusy(false);
          if (ok) { reload(); onClose(); } else setFailed(true);
        }
      }}
    />
  );
}

function MenuPanel({ items, label, loading, failed, busy, point, onClose, onPick }: {
  items: RiderMenuItem[]; label: string; loading: boolean; failed: boolean; busy: boolean;
  point: { x: number; y: number }; onClose: () => void; onPick: (item: RiderMenuItem) => void;
}) {
  const { t } = useTranslation();
  const ref = useModalA11y(onClose, true) as { current: HTMLDivElement | null };
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const place = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const next = placeContextMenu(point, { width: node.offsetWidth, height: node.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
    setPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
  }, [point, ref]);
  useLayoutEffect(() => { place(); });

  // Fokus paa foerste valg, saa piletasterne virker med det samme.
  const count = items.length;
  useEffect(() => { itemRefs.current[0]?.focus(); }, [count]);

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (target && ref.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose, ref]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const next = nextMenuIndex(current, count, e.key);
    itemRefs.current[next]?.focus();
  };

  return (
    <Portal>
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        data-testid="rider-context-menu"
        onKeyDown={onKeyDown}
        // Portalen sender klik op gennem React-traeet; de maa ikke naa linket eller raekken.
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
        className="cz-menu-panel fixed z-modal w-64 max-w-[calc(100vw-1rem)] rounded-cz border border-cz-border bg-cz-card py-1 shadow-overlay outline-hidden"
      >
        {items.map((item, i) => {
          const divider = i > 0 && items[i - 1].group !== item.group;
          return (
            <div key={item.key} role="none" className={divider ? "mt-1 border-t border-cz-border pt-1" : undefined}>
              <button
                ref={(el) => { itemRefs.current[i] = el; }}
                type="button"
                role="menuitem"
                data-rider-menu-item={item.key}
                disabled={busy && item.action === "watchlist"}
                onClick={() => onPick(item)}
                className={`${ITEM} ${item.danger ? "text-cz-danger" : ""}`}
              >
                {t(`common:riderMenu.${item.key}`)}
              </button>
            </div>
          );
        })}
        {loading && (
          <p role="none" className="border-t border-cz-border px-3 pb-1 pt-2 text-xs text-cz-3">{t("common:riderMenu.loading")}</p>
        )}
        {failed && (
          <p role="alert" className="border-t border-cz-border px-3 pb-1 pt-2 text-xs text-cz-danger">{t("common:riderMenu.watchlistFailed")}</p>
        )}
      </div>
    </Portal>
  );
}
