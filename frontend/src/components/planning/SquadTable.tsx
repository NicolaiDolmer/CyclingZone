// #7535 · Trup-tabellen (Squad-visningen). Kolonnerne er wireframets (ejervalg 16/11, punkt 7): vaelg,
// rytter, status, rolle i loebet, type, rating, form, traethed, belastning og rute-match. Hver kolonne
// sorterer (cybersimon 2/11). Standardsortering er rute-match for hele loebet.
//
// Rute-match staar som tal paa ratingens gradient-plade (statColor), uden bjaelke og uden guld. Hvornaar
// rytteren formtopper staar ved Form, aldrig i Status. "Belastning" er et ord (let/mellem/haard, punkt 5).
//
// Mobil (punkt 2, kompakt): navnecellen (afkrydsning, navn, rolle som lille vaelger eller typen) og de
// tal-kolonner spilleren har valgt i chip-raekken (hoejst tre), med kolonneoverskrifter. Ingen vandret scroll.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SortableTh, Select, RiderNameCell, RiderBadges, Flag, isU23, injuryTimeLeft, statPlateStyle, RIDER_TYPE_KEYS } from "./primitives.ts";
import { formatShortDate } from "./planningUi.tsx";
import { injuryFitAgainDate } from "../../lib/injuryExplain.ts";
import type { RiderDetail, SeasonLoad } from "../../lib/planningWorkbenchData.ts";
import {
  availableRoles,
  roleOf,
  DEFAULT_MOBILE_COLUMNS,
  type LoadWord,
  type MobileColumn,
  type PeakNext,
  type RoleKey,
  type Selection,
  type SquadRow,
  type SquadSort,
  type SquadSortKey,
} from "../../lib/planningWorkbench.ts";

// TASTE: 5 px radius (rounded-cz) paa alle smaa maerker, ingen piller.
const CHIP =
  "inline-flex items-center justify-center text-3xs font-semibold uppercase tracking-wide leading-none px-1.5 py-0.5 rounded-cz shrink-0";
const NEUTRAL = "bg-cz-subtle text-cz-2 border border-cz-border";
const TYPES = new Set(RIDER_TYPE_KEYS);

function StatusCell({ row, detail, seasonYear, compact = false }: { row: SquadRow; detail?: RiderDetail; seasonYear: number | null; compact?: boolean }) {
  const { t } = useTranslation("planning");
  const { t: tRider, i18n } = useTranslation("rider");
  // U23 som paa holdsiden (RiderBadges "u23", samme aldersregel); skadet med "Rask igen <dato>" som paa rytterprofilen.
  const u23 = detail ? isU23(detail.birthdate, seasonYear) : false;
  const badges = [u23 && "u23", row.injured && "injured", row.outgoing && "outgoing"];
  const fitAgain = row.injured && detail ? injuryFitAgainDate(detail.injuredUntil) : null;
  const approx = detail ? injuryTimeLeft({ injured_until: detail.injuredUntil, injury_race_days_left: detail.injuryRaceDaysLeft }).unit === "race_day" : false;
  return (
    // Paa pc staar maerker og "Rask igen <dato>" paa én linje (ejer 14/11); paa mobil maa de bryde under navnet.
    <span className="inline-flex flex-wrap items-center gap-1 sm:flex-nowrap">
      <RiderBadges badges={badges} />
      {fitAgain && (
        <span className="whitespace-nowrap text-2xs leading-tight text-cz-3" data-testid="planning-fit-again">
          {tRider(approx ? "condition.fitAgainApprox" : "condition.fitAgain", { date: formatShortDate(fitAgain, i18n.language, false) })}
        </span>
      )}
      {row.overAge && <span className={`${CHIP} ${NEUTRAL}`}>{t("status.overAge")}</span>}
      {row.trainNowLocked && <span className={`${CHIP} ${NEUTRAL}`}>{t("status.trainNow")}</span>}
      {row.busyIn && (
        // Hele "I <loeb>" i almindelig skrift; kun et meget langt navn afkortes (titlen har resten).
        <span
          className={`inline-block ${compact ? "max-w-[4rem]" : "max-w-[6.5rem]"} truncate rounded-cz border border-cz-border bg-cz-subtle px-1.5 py-0.5 text-2xs leading-none text-cz-2`}
          title={t("status.busyTitle", { race: row.busyIn })}
        >
          {t("status.busy", { race: row.busyIn })}
        </span>
      )}
    </span>
  );
}

function FatigueCell({ value, compact }: { value: number | null; compact: boolean }) {
  if (value == null) return <span className="text-cz-3">-</span>;
  return (
    <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
      {!compact && <span aria-hidden="true" className="hidden h-1 bg-cz-3/50 sm:block" style={{ width: `${Math.max(2, Math.min(20, value * 0.2))}px` }} />}
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

/** Rute-match paa ratingens gradient-plade (punkt 7): samme farver som ratings, intet guld, ingen bjaelke. */
export function RouteMatchPlate({ value }: { value: number | null }) {
  if (value == null) return <span className="text-cz-3">-</span>;
  return (
    <span
      className="inline-flex min-w-[2.125rem] items-center justify-center rounded-cz px-1 py-0.5 font-data text-[13px] font-semibold leading-none tabular-nums"
      style={statPlateStyle(value, { scale: "rating" })}
      data-testid="planning-route-match"
    >
      {value}
    </span>
  );
}

/** Belastningen som ord (punkt 5). Haard staar i advarselsfarven. */
function LoadCell({ value }: { value: LoadWord | null | undefined }) {
  const { t } = useTranslation("planning");
  if (!value) return <span className="text-cz-3">-</span>;
  const tone = value === "hard" ? "font-semibold text-cz-warning" : value === "medium" ? "text-cz-1" : "text-cz-2";
  return (
    <span className={`whitespace-nowrap text-[13px] ${tone}`} data-testid="planning-load" data-load={value}>
      {t(`squad.loadWord.${value}`)}
    </span>
  );
}

/** Rytterens naeste formtop ved Form (punkt 7): kort dato, hele navnet og dagene i titlen. */
function PeakMark({ peak }: { peak: PeakNext }) {
  const { t, i18n } = useTranslation("planning");
  return (
    <span
      className="whitespace-nowrap font-data text-3xs uppercase tracking-wide text-cz-3"
      title={t("squad.peakTitle", { race: peak.name, date: formatShortDate(peak.date, i18n.language), count: peak.days })}
      data-testid="planning-peak-mark"
    >
      {t("squad.peakShort", { date: formatShortDate(peak.date, i18n.language, false) })}
    </span>
  );
}

interface SquadTableProps {
  rows: SquadRow[];
  selection: Selection;
  sort: SquadSort;
  onSort: (key: SquadSortKey) => void;
  max: number;
  readOnly: boolean;
  sprintLeaderAllowed: boolean;
  onToggle: (riderId: string) => void;
  onRole: (riderId: string, role: RoleKey) => void;
  /** Nation, foedselsdato og skadesdato pr. rytter (riders + rider_condition). */
  details?: Map<string, RiderDetail>;
  /** Saeson-belastning pr. rytter, samme tal som rytter-chippen paa /planning. */
  seasonLoad?: Record<string, SeasonLoad>;
  seasonYear?: number | null;
  /** Kolonnen "Belastning" (ord); vises ikke, naar modellen er slukket. */
  showLoad?: boolean;
  /** Rytterens naeste formtop (fra Formtop-board'et). */
  peakNext?: Map<string, PeakNext>;
  /** Mobilens valgte tal-kolonner (chip-raekken). */
  mobileColumns?: MobileColumn[];
}

export default function SquadTable({
  rows,
  selection,
  sort,
  onSort,
  max,
  readOnly,
  sprintLeaderAllowed,
  onToggle,
  onRole,
  details,
  seasonLoad,
  seasonYear = null,
  showLoad = false,
  peakNext,
  mobileColumns = DEFAULT_MOBILE_COLUMNS,
}: SquadTableProps) {
  const { t } = useTranslation("planning");
  const { t: tRaces } = useTranslation("races");
  const { t: tTypes } = useTranslation("riderTypes");
  const picked = new Set(selection.riderIds);
  const atMax = selection.riderIds.length >= max;
  const roles = availableRoles(sprintLeaderAllowed);
  const typeLabel = (type: string | null | undefined) => (type && TYPES.has(type) ? tTypes(`types.${type}`) : null);

  // Uden vandret scroll paa pc (ejer 14/11): har tabellen ikke plads i kortet, falder pynten vaek (foerst
  // traethedsbjaelken og saeson-belastningen ved navnet). Tallene staar altid. Bredden med pynt huskes,
  // saa den kommer igen, naar der bliver plads (fx naar loebslisten skjules).
  const wrapRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const fullWidth = useRef(0);
  const shape = `${rows.length}|${showLoad ? 1 : 0}`;
  useLayoutEffect(() => {
    const box = wrapRef.current;
    const table = box?.firstElementChild as HTMLElement | null;
    if (!box || !table) return undefined;
    const check = () => {
      if (!compact) {
        if (table.scrollWidth > box.clientWidth + 1) {
          fullWidth.current = table.scrollWidth;
          setCompact(true);
        }
      } else if (box.clientWidth >= fullWidth.current) {
        setCompact(false);
      }
    };
    check();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(check);
    ro.observe(box);
    return () => ro.disconnect();
  }, [compact, shape]);

  // Paa mobil staar kun de valgte tal-kolonner; paa pc alle.
  const onMobile = (key: MobileColumn) => (mobileColumns.includes(key) ? "table-cell" : "hidden sm:table-cell");
  // Luft til kortets kant (ejer 14/11): foerste og sidste kolonne faar kortets egen indrykning paa pc.
  const edge = (key: SquadSortKey) => (key === "pick" ? (compact ? "sm:ps-3" : "sm:ps-4") : key === "routeMatch" ? "pe-3 sm:pe-4" : "");
  const th = (key: SquadSortKey, label: ReactNode, { numeric = true, visibility = "hidden sm:table-cell", title }: { numeric?: boolean; visibility?: string; title?: string } = {}) => (
    <SortableTh
      key={key}
      sortKey={key}
      sort={sort.key}
      sortDir={sort.dir}
      onSort={onSort}
      title={title}
      className={`px-1.5 py-2 font-data text-2xs font-semibold uppercase tracking-normal text-cz-3 sm:px-1.5 sm:tracking-wide ${numeric ? "text-right" : "text-left"} bg-cz-subtle ${visibility} ${edge(key)}`}
    >
      {label}
    </SortableTh>
  );
  const td = "px-1.5 py-[7px] font-data text-[13px] tabular-nums";

  return (
    <div
      ref={wrapRef}
      className={`overflow-x-clip sm:overflow-x-auto ${compact ? "[&_td]:px-1 [&_th]:px-1 sm:[&_td:first-child]:ps-3 sm:[&_th:first-child]:ps-3 sm:[&_td:last-child]:pe-3 sm:[&_th:last-child]:pe-3" : ""}`}
      data-testid="planning-squad-table"
      data-compact={compact ? "true" : undefined}
    >
      <table data-sortable className="w-full border-collapse">
        <thead>
          {/* Hver kolonne sorterer: th() bygger en SortableTh med onSort (guard: tableSortIntent.test.js). */}
          <tr>
            {th("pick", compact ? <span className="sr-only">{t("squad.pick")}</span> : t("squad.pick"), { numeric: false, title: t("squad.pick") })}
            {th("name", t("squad.rider"), { numeric: false, visibility: "table-cell" })}
            {th("status", t("squad.status"), { numeric: false })}
            {th("role", t("squad.role"), { numeric: false })}
            {th("type", t("squad.type"), { numeric: false })}
            {th("rating", t("squad.rating"), { visibility: onMobile("rating") })}
            {th("form", t("squad.form"), { visibility: onMobile("form") })}
            {th("fatigue", t("squad.fatigue"), { visibility: onMobile("fatigue") })}
            {showLoad && th("load", t("squad.load"), { numeric: false, visibility: onMobile("load"), title: t("squad.loadTitle") })}
            {th("routeMatch", t("squad.routeMatch"), { visibility: onMobile("routeMatch") })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const checked = picked.has(row.id);
            // En Train now-laast rytter kan hverken tages ind eller ud (serveren afviser begge).
            const disabled = readOnly || row.trainNowLocked || (!checked && (!row.selectable || atMax));
            const dim = !row.selectable && !checked;
            const detail = details?.get(row.id);
            const load = seasonLoad?.[row.id] ?? null;
            const peak = peakNext?.get(row.id) ?? null;
            const type = typeLabel(row.type);
            return (
              <tr
                key={row.id}
                data-testid="planning-squad-row"
                // Samme mindstehoejde paa pc for raekker med og uden rollevaelger (ejer 14/11: jaevne raekker).
                className={`border-t border-cz-border sm:h-[46px] ${checked ? "bg-cz-subtle" : ""} ${dim ? "text-cz-3" : ""}`}
              >
                <td className={`hidden px-1.5 py-[7px] sm:table-cell ${edge("pick")}`}>
                  <label className={`flex items-center justify-center ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-cz-accent disabled:cursor-not-allowed"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onToggle(row.id)}
                      aria-label={t("squad.pickRider", { name: row.name })}
                    />
                  </label>
                </td>
                <td className="w-full px-1.5 py-1 text-left sm:w-auto sm:py-[7px]">
                  <div className="flex items-start gap-1 sm:block">
                    {/* Mobil: afkrydsningen i navnecellen med en tommelflade paa 44 x 44. */}
                    <label className={`-ms-1.5 flex h-11 w-11 shrink-0 items-center justify-center sm:hidden ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-cz-accent disabled:cursor-not-allowed"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => onToggle(row.id)}
                        aria-label={t("squad.pickRider", { name: row.name })}
                      />
                    </label>
                    <div className="min-w-0 pt-2.5 sm:pt-0">
                      {/* Navnecellens faste raekkefoelge (TASTE P12): nation, navn, derefter status. */}
                      <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 sm:flex-nowrap">
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          {detail?.nationality && <Flag code={detail.nationality} className="shrink-0 text-2xs" />}
                          <RiderNameCell id={row.id} name={row.name} wrap className="text-[13.5px] font-medium text-cz-1 hover:text-cz-accent-t sm:whitespace-nowrap" />
                        </span>
                        {load != null && load.raceDays > 0 && !compact && (
                          <span
                            className="hidden shrink-0 whitespace-nowrap font-mono text-3xs tabular-nums text-cz-3 sm:inline"
                            data-testid="planning-season-load"
                            title={tRaces("racehub.pool.loadTitle", { races: load.races, days: load.raceDays })}
                          >
                            {tRaces("racehub.pool.loadShort", { days: load.raceDays })}
                          </span>
                        )}
                      </span>
                      {/* Mobil (kompakt): rollen som lille vaelger ved navnet, ellers typen; status og formtop under. */}
                      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 sm:hidden">
                        {checked && !readOnly ? (
                          <RoleSelect row={row} selection={selection} roles={roles} onRole={onRole} className="h-7 min-w-0 py-0 pe-7 ps-2 text-2xs" />
                        ) : checked ? (
                          <span className={`${CHIP} ${NEUTRAL}`}>{t(`role.${roleOf(selection, row.id)}`)}</span>
                        ) : (
                          type && <span className="text-2xs text-cz-3">{type}</span>
                        )}
                        <StatusCell row={row} detail={detail} seasonYear={seasonYear} />
                        {peak && <PeakMark peak={peak} />}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="hidden px-1.5 py-[7px] text-left sm:table-cell">
                  <StatusCell row={row} detail={detail} seasonYear={seasonYear} compact={compact} />
                </td>
                <td className="hidden px-1.5 py-[7px] text-left sm:table-cell">
                  {checked ? (
                    readOnly ? (
                      <span className="text-[13px] text-cz-2">{t(`role.${roleOf(selection, row.id)}`)}</span>
                    ) : (
                      <RoleSelect row={row} selection={selection} roles={roles} onRole={onRole} className={compact ? "min-w-[6.5rem]" : undefined} />
                    )
                  ) : (
                    <span className="text-cz-3">-</span>
                  )}
                </td>
                <td className="hidden px-1.5 py-[7px] text-left text-[13px] text-cz-2 sm:table-cell">{type ?? <span className="text-cz-3">-</span>}</td>
                <td className={`${onMobile("rating")} whitespace-nowrap text-right ${td}`}>{row.rating ?? <span className="text-cz-3">-</span>}</td>
                <td className={`${onMobile("form")} whitespace-nowrap text-right ${td}`}>
                  <span className="inline-flex flex-col items-end leading-tight sm:flex-row sm:items-center sm:gap-1.5">
                    {peak && <span className="hidden sm:inline"><PeakMark peak={peak} /></span>}
                    <span>{row.form ?? <span className="text-cz-3">-</span>}</span>
                  </span>
                </td>
                <td className={`${onMobile("fatigue")} whitespace-nowrap text-right ${td}`}>
                  <FatigueCell value={row.fatigue} compact={compact} />
                </td>
                {showLoad && (
                  <td className={`${onMobile("load")} px-1.5 py-[7px] text-left`}>
                    <LoadCell value={row.load} />
                  </td>
                )}
                <td className={`${onMobile("routeMatch")} whitespace-nowrap text-right ${td} ${edge("routeMatch")}`}>
                  <RouteMatchPlate value={row.routeMatch} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RoleSelect({
  row,
  selection,
  roles,
  onRole,
  className = "min-w-[8rem]",
}: {
  row: SquadRow;
  selection: Selection;
  roles: RoleKey[];
  onRole: (riderId: string, role: RoleKey) => void;
  className?: string;
}) {
  const { t } = useTranslation("planning");
  return (
    <Select
      size="sm"
      value={roleOf(selection, row.id)}
      onChange={(e: { target: { value: string } }) => onRole(row.id, e.target.value as RoleKey)}
      aria-label={t("squad.roleFor", { name: row.name })}
      className={className}
    >
      {roles.map((r) => (
        <option key={r} value={r}>
          {t(`role.${r}`)}
        </option>
      ))}
    </Select>
  );
}
