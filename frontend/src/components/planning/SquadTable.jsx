// #7535 · Trup-tabellen (Squad-visningen). En raekke pr. rytter: vaelg, rolle, status, rating,
// form, traethed, rute-match for hele loebet og en kolonne pr. rutetype i loebet. Hver kolonne
// sorterer (cybersimon 2/11). Standardsortering er rute-match for hele loebet.
//
// Mobil (D-047, 640 px og smalere): navnecellen (med afkrydsning og rolle) + de tre kolonner
// rute-match, form og traethed. Resten staar i desktop-tabellen. Ingen vandret scroll paa mobil.
import { useTranslation } from "react-i18next";
import SortableTh from "../ui/SortableTh.jsx";
import { Select } from "../ui";
import { cellClass } from "../ui/tableStyles.js";
import RiderNameCell from "../rider/RiderNameCell.jsx";
import RiderBadges from "../rider/RiderBadges.jsx";
import BestRoleTag from "../rider/BestRoleTag.jsx";
import TerrainTypeGlyph from "../race/TerrainTypeGlyph.jsx";
import { availableRoles, roleOf, bestOf } from "../../lib/planningWorkbench.ts";

const CHIP =
  "inline-flex items-center justify-center text-3xs font-semibold uppercase tracking-wide leading-none px-1.5 py-0.5 rounded shrink-0";
const NEUTRAL = "bg-cz-subtle text-cz-2 border border-cz-border";

function StatusCell({ row }) {
  const { t } = useTranslation("planning");
  const badges = [row.injured && "injured", row.outgoing && "outgoing"];
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <RiderBadges badges={badges} />
      {row.overAge && <span className={`${CHIP} ${NEUTRAL}`}>{t("status.overAge")}</span>}
      {row.trainNowLocked && <span className={`${CHIP} ${NEUTRAL}`}>{t("status.trainNow")}</span>}
      {row.busyIn && (
        <span className={`${CHIP} ${NEUTRAL} max-w-[11rem] truncate normal-case`} title={t("status.busyTitle", { race: row.busyIn })}>
          {t("status.busy", { race: row.busyIn })}
        </span>
      )}
    </span>
  );
}

function FatigueCell({ value }) {
  if (value == null) return <span className="text-cz-3">-</span>;
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span aria-hidden="true" className="block h-1 bg-cz-3/50" style={{ width: `${Math.max(2, Math.min(36, value * 0.36))}px` }} />
      <span className="tabular-nums">{value}</span>
    </span>
  );
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
}) {
  const { t } = useTranslation("planning");
  const picked = new Set(selection.riderIds);
  const atMax = selection.riderIds.length >= max;
  const roles = availableRoles(sprintLeaderAllowed);
  const bestMatch = bestOf(rows, (r) => r.routeMatch);
  const bestByProfile = Object.fromEntries(profileCols.map((c) => [c.profileType, bestOf(rows, (r) => r.byProfile[c.profileType] ?? null)]));

  const th = (key, label, { numeric = true, hideMobile = true, title } = {}) => (
    <SortableTh
      sortKey={key}
      sort={sort.key}
      sortDir={sort.dir}
      onSort={onSort}
      title={title}
      className={`${cellClass({ numeric, header: true })} bg-cz-subtle ${hideMobile ? "hidden sm:table-cell" : ""}`}
    >
      {label}
    </SortableTh>
  );

  return (
    <div className="overflow-x-clip sm:overflow-x-auto" data-testid="planning-squad-table">
      <table data-sortable className="w-full border-collapse">
        <thead>
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
              th(`profile:${c.profileType}`, (
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
            const disabled = readOnly || (!checked && (!row.selectable || atMax));
            const dim = !row.selectable && !checked;
            return (
              <tr
                key={row.id}
                data-testid="planning-squad-row"
                className={`border-t border-cz-border ${checked ? "bg-cz-subtle" : ""} ${dim ? "text-cz-3" : ""}`}
              >
                <td className="hidden px-3 py-[7px] sm:table-cell">
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
                <td className="px-3 py-[7px] text-left">
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
                      <RiderNameCell id={row.id} name={row.name} wrap className="text-[13.5px] font-medium text-cz-1 hover:text-cz-accent-t" />
                      <div className="mt-1 sm:hidden">
                        <StatusCell row={row} />
                      </div>
                      {checked && !readOnly && (
                        <div className="mt-1.5 sm:hidden">
                          <RoleSelect row={row} selection={selection} roles={roles} onRole={onRole} />
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="hidden px-3 py-[7px] text-left sm:table-cell">
                  <StatusCell row={row} />
                </td>
                <td className="hidden px-3 py-[7px] text-left sm:table-cell">
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
                <td className="hidden px-3 py-[7px] text-right font-data text-[13px] tabular-nums sm:table-cell">
                  {row.rating != null ? (
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <span>{row.rating}</span>
                      {row.ratingRole && <BestRoleTag role={row.ratingRole} />}
                    </span>
                  ) : (
                    <span className="text-cz-3">-</span>
                  )}
                </td>
                <td className={`px-3 py-[7px] text-right font-data text-[13px] tabular-nums ${row.selectable && row.routeMatch != null && row.routeMatch === bestMatch ? "font-semibold text-cz-accent-t" : ""}`}>
                  {row.routeMatch ?? <span className="text-cz-3">-</span>}
                </td>
                <td className="px-3 py-[7px] text-right font-data text-[13px] tabular-nums">{row.form ?? <span className="text-cz-3">-</span>}</td>
                <td className="px-3 py-[7px] text-right font-data text-[13px]">
                  <FatigueCell value={row.fatigue} />
                </td>
                {profileCols.map((c) => {
                  const v = row.byProfile[c.profileType] ?? null;
                  const best = row.selectable && v != null && v === bestByProfile[c.profileType];
                  return (
                    <td
                      key={c.profileType}
                      className={`hidden px-3 py-[7px] text-right font-data text-[13px] tabular-nums sm:table-cell ${best ? "font-semibold text-cz-accent-t" : ""}`}
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

function RoleSelect({ row, selection, roles, onRole }) {
  const { t } = useTranslation("planning");
  return (
    <Select
      size="sm"
      value={roleOf(selection, row.id)}
      onChange={(e) => onRole(row.id, e.target.value)}
      aria-label={t("squad.roleFor", { name: row.name })}
      className="min-w-[9.5rem]"
    >
      {roles.map((r) => (
        <option key={r} value={r}>
          {t(`role.${r}`)}
        </option>
      ))}
    </Select>
  );
}
