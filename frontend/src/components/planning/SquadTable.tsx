// #7535 · Trup-tabellen (Squad-visningen). En raekke pr. rytter: vaelg, rolle, status, rating,
// form, traethed, rute-match for hele loebet og en kolonne pr. rutetype i loebet. Hver kolonne
// sorterer (cybersimon 2/11). Standardsortering er rute-match for hele loebet.
//
// Mobil (D-047, 640 px og smalere): navnecellen (med afkrydsning og rolle) + de tre kolonner
// rute-match, form og traethed. Resten staar i desktop-tabellen. Ingen vandret scroll paa mobil.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SortableTh, Select, RiderNameCell, RiderBadges, BestRoleTag, TerrainTypeGlyph } from "./primitives.ts";
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

function StatusCell({ row }: { row: SquadRow }) {
  const { t } = useTranslation("planning");
  const badges = [row.injured && "injured", row.outgoing && "outgoing"];
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <RiderBadges badges={badges} />
      {row.overAge && <span className={`${CHIP} ${NEUTRAL}`}>{t("status.overAge")}</span>}
      {row.trainNowLocked && <span className={`${CHIP} ${NEUTRAL}`}>{t("status.trainNow")}</span>}
      {row.busyIn && (
        // Hele "I <loeb>" i almindelig skrift; kun et meget langt navn afkortes (titlen har resten).
        <span
          className="inline-block max-w-[11rem] truncate rounded border border-cz-border bg-cz-subtle px-1.5 py-0.5 text-2xs leading-none text-cz-2"
          title={t("status.busyTitle", { race: row.busyIn })}
        >
          {t("status.busy", { race: row.busyIn })}
        </span>
      )}
    </span>
  );
}

function FatigueCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-cz-3">-</span>;
  return (
    <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
      <span aria-hidden="true" className="hidden h-1 bg-cz-3/50 sm:block" style={{ width: `${Math.max(2, Math.min(36, value * 0.36))}px` }} />
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
}: SquadTableProps) {
  const { t } = useTranslation("planning");
  const picked = new Set(selection.riderIds);
  const atMax = selection.riderIds.length >= max;
  const roles = availableRoles(sprintLeaderAllowed);
  const bestMatch = bestOf(rows, (r) => r.routeMatch);
  const bestByProfile = Object.fromEntries(profileCols.map((c) => [c.profileType, bestOf(rows, (r) => r.byProfile[c.profileType] ?? null)]));

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
      className={`px-1.5 py-2 font-data text-2xs font-semibold uppercase tracking-normal text-cz-3 sm:px-2 sm:tracking-widest ${numeric ? "text-right" : "text-left"} bg-cz-subtle ${hideMobile ? "hidden sm:table-cell" : ""}`}
    >
      {label}
    </SortableTh>
  );

  return (
    <div className="overflow-x-clip sm:overflow-x-auto" data-testid="planning-squad-table">
      <table data-sortable className="w-full border-collapse">
        <thead>
          {/* Hver kolonne sorterer: th() bygger en SortableTh med onSort (guard: tableSortIntent.test.js). */}
          <tr>
            {th("pick", t("squad.pick"), { numeric: false, hideMobile: true })}
            {th("name", t("squad.rider"), { numeric: false, hideMobile: false })}
            {th("status", t("squad.status"), { numeric: false })}
            {th("role", t("squad.role"), { numeric: false })}
            {th("rating", t("squad.rating"))}
            {th("routeMatch", t("squad.routeMatch"), { hideMobile: false })}
            {th("form", t("squad.form"), { hideMobile: false })}
            {th("fatigue", t("squad.fatigue"), { hideMobile: false })}
            {profileCols.map((c) =>
              th(`profile:${c.profileType}` as SquadSortKey, (
                <span className="inline-flex flex-col items-end gap-0.5">
                  <TerrainTypeGlyph profileType={c.profileType} size={14} showLabel labelClassName="text-3xs" />
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
            return (
              <tr
                key={row.id}
                data-testid="planning-squad-row"
                className={`border-t border-cz-border ${checked ? "bg-cz-subtle" : ""} ${dim ? "text-cz-3" : ""}`}
              >
                <td className="hidden px-2 py-[7px] sm:table-cell">
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
                <td className="w-full px-1.5 py-[7px] text-left sm:w-auto sm:px-2">
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
                      <RiderNameCell id={row.id} name={row.name} wrap className="text-[13.5px] font-medium text-cz-1 hover:text-cz-accent-t sm:whitespace-nowrap" />
                      <div className="mt-1 sm:hidden">
                        <StatusCell row={row} />
                      </div>
                      {checked && !readOnly && (
                        <div className="mt-1.5 sm:hidden">
                          <RoleSelect row={row} selection={selection} roles={roles} onRole={onRole} className="w-full min-w-0" />
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="hidden px-2 py-[7px] text-left sm:table-cell">
                  <StatusCell row={row} />
                </td>
                <td className="hidden px-2 py-[7px] text-left sm:table-cell">
                  {checked ? (
                    readOnly ? (
                      <span className="text-[13px] text-cz-2">{t(`role.${roleOf(selection, row.id)}`)}</span>
                    ) : (
                      <RoleSelect row={row} selection={selection} roles={roles} onRole={onRole} />
                    )
                  ) : (
                    <span className="text-cz-3">-</span>
                  )}
                </td>
                <td className="hidden px-2 py-[7px] text-right font-data text-[13px] tabular-nums sm:table-cell">
                  {row.rating != null ? (
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <span>{row.rating}</span>
                      {row.ratingRole && <BestRoleTag role={row.ratingRole} />}
                    </span>
                  ) : (
                    <span className="text-cz-3">-</span>
                  )}
                </td>
                <td className={`whitespace-nowrap px-1.5 py-[7px] text-right font-data text-[13px] tabular-nums sm:px-2 ${row.selectable && row.routeMatch != null && row.routeMatch === bestMatch ? "font-semibold text-cz-accent-t" : ""}`}>
                  {row.routeMatch ?? <span className="text-cz-3">-</span>}
                </td>
                <td className="whitespace-nowrap px-1.5 py-[7px] text-right font-data text-[13px] tabular-nums sm:px-2">{row.form ?? <span className="text-cz-3">-</span>}</td>
                <td className="whitespace-nowrap px-1.5 py-[7px] text-right font-data text-[13px] tabular-nums sm:px-2">
                  <FatigueCell value={row.fatigue} />
                </td>
                {profileCols.map((c) => {
                  const v = row.byProfile[c.profileType] ?? null;
                  const best = row.selectable && v != null && v === bestByProfile[c.profileType];
                  return (
                    <td
                      key={c.profileType}
                      className={`hidden px-2 py-[7px] text-right font-data text-[13px] tabular-nums sm:table-cell ${best ? "font-semibold text-cz-accent-t" : ""}`}
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
  className = "min-w-[8.5rem]",
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
