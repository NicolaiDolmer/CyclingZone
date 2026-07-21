// Season Planner — scannbar sæson-løbs-liste (#2568 del 2).
//
// Ejer-krav (17/7 + Discord 16/7): "det skal være meget nemmere at finde ud af
// hvilke løb der sker hvornår ... og hvilke løb man planlægger sin form til", +
// "hvert løb skal vise navn+dato+terræn og linke til løbssiden". Tidslinjen på
// master-canvasset er så tæt (~4px/dag) at løbs-NAVNE aldrig kan stå der; denne
// liste er derfor den kanoniske "hvilke løb, hvornår"-flade (jf. Velo Victory's
// Race Summary-panel i ejer-referencerne). Samme filter-synlige løbsmængde som
// tidslinjen (racesForList). En række vælger løbet (åbner skuffen + fremhæver
// kolonnen); et separat link fører til den fulde løbsside (/races/:id).
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { racesForList, myPeakCountByRace, formatRaceDateLabel, dateToOrdinal } from "./plannerShared";

// Kompakt terræn-glyf (samme sprog som MasterCanvas.TerrainGlyph, i lille format).
function TerrainMark({ terrain }) {
  const ink = "var(--text-1)";
  let body;
  if (terrain === "mountain") body = <path d="M1 15 L8 4 L12 9 L16 2 L21 15 Z" fill={ink} opacity="0.82" />;
  else if (terrain === "hilly") body = <path d="M1 15 Q6 5 10 11 Q14 4 21 15 Z" fill={ink} opacity="0.72" />;
  else if (terrain === "itt" || terrain === "ttt") body = <g><circle cx="11" cy="8" r="5" fill="none" stroke={ink} strokeWidth="1.8" /><line x1="11" y1="8" x2="15" y2="4" stroke={ink} strokeWidth="1.8" /></g>;
  else if (terrain === "cobbles") body = <g>{[0, 1, 2, 3].map((i) => <rect key={i} x={2 + i * 5} y={6 + (i % 2) * 3} width="3.6" height="3.6" fill={ink} opacity="0.8" />)}</g>;
  else body = <rect x="1" y="9" width="20" height="3.5" fill={ink} opacity="0.55" />;
  return (
    <svg viewBox="0 0 22 17" width="22" height="17" aria-hidden="true" className="shrink-0">
      {body}
    </svg>
  );
}

export default function PlannerRaceList({ riders, races, filter, today, selectedRaceId, onSelectRace }) {
  const { t } = useTranslation("planner");
  const months = t("months", { returnObjects: true });
  const nowOrd = dateToOrdinal(today);

  const list = useMemo(() => racesForList(races, filter, nowOrd), [races, filter, nowOrd]);
  const peakCounts = useMemo(() => myPeakCountByRace(riders), [riders]);

  return (
    <section className="mt-5" aria-label={t("raceList.title")}>
      <div className="flex items-baseline justify-between gap-3 border-b border-cz-border pb-1.5 mb-2.5">
        <h2 className="font-display text-[22px] leading-none text-cz-1">{t("raceList.title")}</h2>
        <span className="text-[11px] text-cz-3 font-mono shrink-0">{t("raceList.count", { count: list.length })}</span>
      </div>
      <p className="text-[11.5px] text-cz-2 mb-3">{t("raceList.subtitle")}</p>

      {list.length === 0 ? (
        <p className="text-[12px] text-cz-3 py-4">{t("raceList.empty")}</p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((r) => {
            const active = r.id === selectedRaceId;
            const peaks = peakCounts.get(r.id) || 0;
            return (
              <li key={r.id}>
                <div
                  className={`group flex items-center gap-2.5 rounded-cz border px-2.5 py-2 transition-colors ${
                    active ? "border-cz-accent-t bg-cz-subtle" : "border-cz-border bg-cz-card hover:bg-cz-subtle"
                  } ${r.isPast ? "opacity-60" : ""}`}
                >
                  {/* Løb-vælger: åbner skuffen + fremhæver kolonnen på boardet. */}
                  <button
                    type="button"
                    className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                    aria-pressed={active}
                    onClick={() => onSelectRace(r.id)}
                  >
                    <TerrainMark terrain={r.terrain} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-[12.5px] text-cz-1 font-medium truncate">{r.name}</span>
                        {r.isMine && (
                          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-cz-accent-t" title={t("raceList.mine")} aria-label={t("raceList.mine")} />
                        )}
                      </span>
                      <span className="block text-[10.5px] text-cz-2 mt-0.5 truncate">
                        {formatRaceDateLabel(r, months)}
                        <span className="text-cz-3"> · {t(`terrain.${r.terrain}`)}</span>
                        {r.raceClass ? <span className="text-cz-3"> · {r.raceClass}</span> : null}
                        {r.isPast ? <span className="text-cz-3"> · {t("raceList.past")}</span> : null}
                      </span>
                    </span>
                  </button>

                  {peaks > 0 && (
                    <span
                      className="shrink-0 text-[9.5px] font-mono text-cz-accent-t border border-cz-accent-t rounded-full px-1.5 py-0.5"
                      title={t("raceList.peaksHere", { count: peaks })}
                    >
                      {peaks}✦
                    </span>
                  )}

                  {/* Direkte link til den fulde løbsside (ejer-krav) — separat fra
                      løb-vælgeren, så et klik navigerer i stedet for at åbne skuffen. */}
                  <Link
                    to={`/races/${r.id}`}
                    className="shrink-0 text-cz-3 hover:text-cz-accent-t p-1 -m-1"
                    aria-label={t("raceList.viewPage", { race: r.name })}
                    title={t("raceList.viewPage", { race: r.name })}
                  >
                    <i className="ti ti-arrow-up-right text-[16px]" aria-hidden="true" />
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
