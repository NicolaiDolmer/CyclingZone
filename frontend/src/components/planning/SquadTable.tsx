// #7535 · Trup-tabellen (Squad-visningen). En raekke pr. rytter: vaelg, rolle, status, rating,
// form, traethed, rute-match for hele loebet og en kolonne pr. rutetype i loebet. Hver kolonne
// sorterer (cybersimon 2/11). Standardsortering er rute-match for hele loebet.
//
// Mobil (D-047, 640 px og smalere): navnecellen (med afkrydsning og rolle) + de tre kolonner
// rute-match, form og traethed. Resten staar i desktop-tabellen. Ingen vandret scroll paa mobil.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SortableTh, Select, RiderNameCell, RiderBadges, BestRoleTag, TerrainTypeGlyph, Flag, isU23, injuryTimeLeft } from "./primitives.ts";
import { formatShortDate } from "./planningUi.tsx";
import { injuryFitAgainDate } from "../../lib/injuryExplain.ts";
import type { RiderDetail, SeasonLoad } from "../../lib/planningWorkbenchData.ts";
import {
  availableRoles,
  roleOf,
  bestOf,
  type ProfileColumn,
  type RoleKey,
  type Selection,
  type SquadRow,
  type SquadSort,
  type SquadSortKey,
} from "../../lib/planningWorkbench.ts";

const CHIP =
  "inline-flex items-center justify-center text-3xs font-semibold uppercase tracking-wide leading-none px-1.5 py-0.5 rounded shrink-0";
const NEUTRAL = "bg-cz-subtle text-cz-2 border border-cz-border";

function StatusCell({ row, detail, seasonYear, compact = false }: { row: SquadRow; detail?: RiderDetail; seasonYear: number | null; compact?: boolean }) {
  const { t } = useTranslation("planning");
  const { t: tRider, i18n } = useTranslation("rider");
  // U23 som paa holdsiden (RiderBadges "u23", samme aldersregel); skadet med "Rask igen <dato>" som paa rytterprofilen.
  const u23 = detail ? isU23(detail.birthdate, seasonYear) : false;
  const badges = [u23 && "u23", row.injured && "injured", row.outgoing && "outgoing"];
  const fitAgain = row.injured && detail ? injuryFitAgainDate(detail.injuredUntil) : null;
  const approx = detail ? injuryTimeLeft({ injured_until: detail.injuredUntil, injury_race_days_left: detail.injuryRaceDaysLeft }).unit === "race_day" : false;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <RiderBadges badges={badges} />
      {/* Altid én linje (ejer 14/11): en dato over flere linjer gjorde raekken hoejere end de andre. */}
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
          className={`inline-block ${compact ? "max-w-[4.5rem]" : "max-w-[6.5rem]"} truncate rounded border border-cz-border bg-cz-subtle px-1.5 py-0.5 text-2xs leading-none text-cz-2`}
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

interface SquadTableProps {
  rows: SquadRow[];
  selection: Selection;
  sort: SquadSort;
  onSort: (key: SquadSortKey) => void;
  profileCols: ProfileColumn[];
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
}

export default function SquadTable({
  rows,
  selection,
  sort,
  onSort,
  profileCols,
  max,
  readOnly,
  sprintLeaderAllowed,
  onToggle,
  onRole,
  details,
  seasonLoad,
  seasonYear = null,
}: SquadTableProps) {
  const { t } = useTranslation("planning");
  const { t: tRaces } = useTranslation("races");
  const picked = new Set(selection.riderIds);
  const atMax = selection.riderIds.length >= max;
  const roles = availableRoles(sprintLeaderAllowed);
  const bestMatch = bestOf(rows, (r) => r.routeMatch);
  const bestByProfile = Object.fromEntries(profileCols.map((c) => [c.profileType, bestOf(rows, (r) => r.byProfile[c.profileType] ?? null)]));

  // Uden vandret scroll paa pc (ejer 14/11): har tabellen ikke plads i kortet (fx et etapeloeb med
  // mange rutetyper ved siden af loebslisten), falder pynten vaek, foerst traethedsbjaelken og
  // rollemaerket ved ratingen. Tallene staar altid. Bredden med pynt huskes, saa den kommer igen,
  // naar der bliver plads (fx naar loebslisten skjules).
  const wrapRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const fullWidth = useRef(0);
  const shape = `${rows.length}|${profileCols.map((c) => c.profileType).join(",")}`;
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

  // Luft til kortets kant (ejer 14/11): foerste og sidste kolonne faar kortets egen indrykning paa pc,
  // saa Traethed (eller den sidste rutetype) aldrig staar helt ude ved kanten.
  const lastKey: SquadSortKey = profileCols.length ? (`profile:${profileCols[profileCols.length - 1].profileType}` as SquadSortKey) : "fatigue";
  const edge = (key: SquadSortKey) => (key === "pick" ? (compact ? "sm:ps-3" : "sm:ps-4") : key === lastKey ? "sm:pe-4" : "");
  const th = (
    key: SquadSortKey,
    label: ReactNode,
    { numeric = true, hideMobile = true, title }: { numeric?: boolean; hideMobile?: boolean; title?: string } = {},
  ) => (
    <SortableTh
      key={key}
      sortKey={key}
      sort={sort.key}
      sortDir={sort.dir}
      onSort={onSort}
      title={title}
      className={`px-1.5 py-2 font-data text-2xs font-semibold uppercase tracking-normal text-cz-3 sm:px-1.5 sm:tracking-wide ${numeric ? "text-right" : "text-left"} bg-cz-subtle ${hideMobile ? "hidden sm:table-cell" : ""} ${edge(key)}`}
    >
      {label}
    </SortableTh>
  );

  return (
    <div ref={wrapRef} className="overflow-x-clip sm:overflow-x-auto" data-testid="planning-squad-table" data-compact={compact ? "true" : undefined}>
      <table data-sortable className="w-full border-collapse">
        <thead>
          {/* Hver kolonne sorterer: th() bygger en SortableTh med onSort (guard: tableSortIntent.test.js). */}
          <tr>
            {th("pick", compact ? <span className="sr-only">{t("squad.pick")}</span> : t("squad.pick"), { numeric: false, hideMobile: true, title: t("squad.pick") })}
            {th("name", t("squad.rider"), { numeric: false, hideMobile: false })}
            {th("status", t("squad.status"), { numeric: false })}
            {th("role", t("squad.role"), { numeric: false })}
            {th("rating", t("squad.rating"))}
            {th("routeMatch", t("squad.routeMatch"), { hideMobile: false })}
            {th("form", t("squad.form"), { hideMobile: false })}
            {th("fatigue", t("squad.fatigue"), { hideMobile: false })}
            {/* Rutetypen som ikon (navnet staar i ikonets titel), saa kolonnerne er smalle nok til kortet. */}
            {profileCols.map((c) =>
              th(`profile:${c.profileType}` as SquadSortKey, (
                <span className="inline-flex flex-col items-end gap-0.5">
                  <TerrainTypeGlyph profileType={c.profileType} size={14} />
                  <span className="tabular-nums">{`×${c.count}`}</span>
                </span>
              )),
            )}
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
            return (
              <tr
                key={row.id}
                data-testid="planning-squad-row"
                // Samme mindstehoejde paa pc for raekker med og uden rollevaelger (ejer 14/11: jaevne raekker).
                className={`border-t border-cz-border sm:h-[46px] ${checked ? "bg-cz-subtle" : ""} ${dim ? "text-cz-3" : ""}`}
              >
                <td className={`hidden px-1.5 py-[7px] sm:table-cell ${edge("pick")}`}>
                  <label className={`flex h-11 w-11 items-center justify-center sm:h-auto sm:w-auto ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
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
                <td className="w-full px-1.5 py-[7px] text-left sm:w-auto">
                  <div className="flex items-start gap-1 sm:block">
                    <label className={`-ms-2 flex h-11 w-11 shrink-0 items-center justify-center sm:hidden ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
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
                      {/* Navnet brydes kun paa mobil; paa pc staar det paa én linje som paa de nuvaerende sider. */}
                      {/* Navnecellens faste raekkefoelge (TASTE P12): nation, navn, derefter status. Belastningen
                          staar ved navnet som paa rytter-chippen paa /planning og gaar under navnet, naar tabellen er trang. */}
                      {/* Paa pc staar belastningen altid paa navnets linje, saa lange navne ikke giver ujaevne raekker. */}
                      <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 sm:flex-nowrap">
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          {detail?.nationality && <Flag code={detail.nationality} className="shrink-0 text-2xs" />}
                          <RiderNameCell id={row.id} name={row.name} wrap className="text-[13.5px] font-medium text-cz-1 hover:text-cz-accent-t sm:whitespace-nowrap" />
                        </span>
                        {load != null && load.raceDays > 0 && (
                          <span
                            className="shrink-0 whitespace-nowrap font-mono text-3xs tabular-nums text-cz-3"
                            data-testid="planning-season-load"
                            title={tRaces("racehub.pool.loadTitle", { races: load.races, days: load.raceDays })}
                          >
                            {tRaces("racehub.pool.loadShort", { days: load.raceDays })}
                          </span>
                        )}
                      </span>
                      <div className="mt-1 sm:hidden">
                        <StatusCell row={row} detail={detail} seasonYear={seasonYear} />
                      </div>
                      {checked && !readOnly && (
                        <div className="mt-1.5 sm:hidden">
                          <RoleSelect row={row} selection={selection} roles={roles} onRole={onRole} className="w-full min-w-0" />
                        </div>
                      )}
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
                      <RoleSelect row={row} selection={selection} roles={roles} onRole={onRole} className={compact ? "min-w-[7.25rem]" : undefined} />
                    )
                  ) : (
                    <span className="text-cz-3">-</span>
                  )}
                </td>
                <td className="hidden px-1.5 py-[7px] text-right font-data text-[13px] tabular-nums sm:table-cell">
                  {row.rating != null ? (
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <span>{row.rating}</span>
                      {row.ratingRole && !compact && <BestRoleTag role={row.ratingRole} />}
                    </span>
                  ) : (
                    <span className="text-cz-3">-</span>
                  )}
                </td>
                <td className={`whitespace-nowrap px-1.5 py-[7px] text-right font-data text-[13px] tabular-nums ${row.selectable && row.routeMatch != null && row.routeMatch === bestMatch ? "font-semibold text-cz-accent-t" : ""}`}>
                  {row.routeMatch ?? <span className="text-cz-3">-</span>}
                </td>
                <td className="whitespace-nowrap px-1.5 py-[7px] text-right font-data text-[13px] tabular-nums">{row.form ?? <span className="text-cz-3">-</span>}</td>
                <td className={`whitespace-nowrap px-1.5 py-[7px] text-right font-data text-[13px] tabular-nums ${edge("fatigue")}`}>
                  <FatigueCell value={row.fatigue} compact={compact} />
                </td>
                {profileCols.map((c) => {
                  const v = row.byProfile[c.profileType] ?? null;
                  const best = row.selectable && v != null && v === bestByProfile[c.profileType];
                  return (
                    <td
                      key={c.profileType}
                      className={`hidden px-1.5 py-[7px] text-right font-data text-[13px] tabular-nums sm:table-cell ${edge(`profile:${c.profileType}` as SquadSortKey)} ${best ? "font-semibold text-cz-accent-t" : ""}`}
                    >
                      {v ?? <span className="text-cz-3">-</span>}
                    </td>
                  );
                })}
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
