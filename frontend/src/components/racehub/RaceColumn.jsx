// Race Hub Fase 1 — ét overlap-løb som kolonne: header + status-chip + udtagne ryttere.
// Klik en rytter → rolle-menu (kaptajn / sprint-kaptajn / udbrudsjæger / kun rytter);
// × fjerner. Fit-bar + friskheds-farve pr. rytter. Frosset løb (lineup_locked, #1825)
// vises read-only. Afmeld/deltag i footeren.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { computeColumnStatus, freshnessTier } from "../../lib/raceHubLogic.js";
import { terrainBucket } from "../../lib/stageTerrain.js";
import { ROLE_KEYS, ROLE_KEYS_V3 } from "../../lib/roleHint.js";
import FitBar from "./FitBar.jsx";
import RoleCard from "./RoleCard.jsx";
import RaceLink from "../RaceLink.jsx";
import { LockIcon } from "../ui";
import { encodeDrag } from "../../lib/raceHubDnd.js";

const STATUS_CLASS = {
  full: "bg-cz-success-bg text-cz-success border-cz-success/30",
  understaffed: "bg-cz-warning-bg text-cz-warning border-cz-warning/40",
  overfull: "bg-cz-danger/10 text-cz-danger border-cz-danger/40",
  withdrawn: "bg-cz-subtle text-cz-3 border-cz-border",
  locked: "bg-cz-subtle text-cz-2 border-cz-border",
};
// #2376: freeRole tilføjet — badge-label slår op i "selection.freeRole" (samme
// opslagssti som de øvrige roller, se RoleBadge).
const ROLE_KEY = { captain: "captain", sprint_captain: "sprintCaptain", hunter: "hunter", free_role: "freeRole" };
const FRESH_CLASS = { fresh: "text-cz-success", ok: "text-cz-2", tired: "text-cz-warning" };

function RoleBadge({ t, role }) {
  return (
    <span className="text-[9px] uppercase text-cz-accent-t border border-cz-accent/40 px-1.5 py-px rounded ms-1.5">
      {t(`selection.${ROLE_KEY[role]}`)}
    </span>
  );
}

export default function RaceColumn({ column, onRemoveRider, onToggleWithdraw, onSetRole, busy, onDropRider, raceV3Enabled = false }) {
  const { t } = useTranslation("races");
  const [roleMenuFor, setRoleMenuFor] = useState(null);
  const [dragOver, setDragOver] = useState(false); // #1925: kolonne-drop-zone
  const selectedIds = column.selection?.rider_ids || [];
  const ridersById = new Map(column.riders.map((r) => [r.id, r]));
  const locked = !!column.lineup_locked;
  // S5: profil-bevidste rolle-hints. primaryProfileType = løbets dominerende terræn
  // (backend); mangler det (gamle løb) → terrainBucket defaulter til "flat".
  const bucket = terrainBucket(column.primaryProfileType);
  // #2376: rolle-kort-udvalget er v3-gated — free_role dukker kun op når
  // race_engine_v3_scoring er ON (prop fra board'et, læst af distribution-svaret).
  const roleKeys = raceV3Enabled ? ROLE_KEYS_V3 : ROLE_KEYS;
  const roleOf = (id) => {
    const s = column.selection;
    if (!s) return null;
    if (id === s.captain_id) return "captain";
    if (id === s.sprint_captain_id) return "sprint_captain";
    if (id === s.hunter_id) return "hunter";
    if (s.free_role_ids?.includes(id)) return "free_role";
    return null;
  };
  // #2195: synlig in-game løbsdag, så to løb på samme rigtige eftermiddag er tydeligt
  // forskellige spil-dage. Etapeløb spænder start..slut; endagsløb er én dag. Skjult hvis ukendt.
  const gd = column.game_day;
  const gdEnd = column.game_day_end;
  const raceDayLabel = Number.isFinite(gd)
    ? (Number.isFinite(gdEnd) && gdEnd > gd ? t("racehub.raceDays", { start: gd, end: gdEnd }) : t("racehub.raceDay", { day: gd }))
    : null;
  const status = locked
    ? { kind: "locked" }
    : computeColumnStatus({ selected: column.counts.selected, target: column.counts.target, max: column.size?.max, withdrawn: column.withdrawn });
  const statusLabel = status.kind === "locked"
    ? t("racehub.status.locked")
    : t(`racehub.status.${status.kind}`, { selected: status.selected, target: status.target });

  // #1925: kolonnen er en drop-zone — slip en rytter her for at tilføje/flytte ham hertil.
  // Frosne/afmeldte løb tager ikke imod drops (forælderen validerer også via dropAction).
  const acceptsDrop = !locked && !column.withdrawn;
  return (
    <div
      className={`border rounded-cz bg-cz-card flex flex-col transition-colors ${dragOver && acceptsDrop ? "border-cz-accent" : "border-cz-border"}`}
      onDragOver={acceptsDrop ? (e) => { e.preventDefault(); setDragOver(true); } : undefined}
      onDragLeave={() => setDragOver(false)}
      onDrop={acceptsDrop ? (e) => { e.preventDefault(); setDragOver(false); onDropRider?.(e.dataTransfer.getData("text/plain")); } : undefined}
    >
      <div className="p-3 border-b border-cz-border">
        <div className="flex items-start justify-between gap-2">
          <RaceLink id={column.id} state={{ from: "board" }} className="text-sm font-semibold text-cz-1 hover:text-cz-accent-t transition-colors">{column.name}</RaceLink>
          {locked && <LockIcon size={13} className="text-cz-3 mt-0.5 flex-shrink-0" aria-hidden="true" />}
        </div>
        <p className="text-[11px] text-cz-3 mt-0.5">
          {raceDayLabel && (
            <span className="inline-block me-1.5 text-cz-accent-t font-medium">{raceDayLabel}</span>
          )}
          {column.race_type === "stage_race" ? t("raceType.stages", { count: column.stages }) : t("raceType.oneDay")} · {t(`classOption.${column.race_class}`)}
        </p>
        <span className={`inline-block mt-2 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${STATUS_CLASS[status.kind]}`}>
          {statusLabel}
        </span>
      </div>

      {locked ? (
        <div className="py-1 flex-1">
          {selectedIds.map((id) => {
            const r = ridersById.get(id);
            if (!r) return null;
            const role = roleOf(id);
            return (
              <div key={id} className="w-full flex items-center justify-between px-3 py-1.5">
                <span className="text-xs text-cz-1 truncate">
                  {r.name}
                  {role && <RoleBadge t={t} role={role} />}
                </span>
                <FitBar score={r.suitability} />
              </div>
            );
          })}
          <p className="px-3 py-2 text-[10px] text-cz-3">{t("racehub.lineupLocked.note")}</p>
        </div>
      ) : !column.withdrawn ? (
        <div className="py-1 flex-1">
          {selectedIds.length > 0 && <p className="px-3 pt-1 pb-0.5 text-[10px] text-cz-3">{t("racehub.role.hint")}</p>}
          {selectedIds.map((id) => {
            const r = ridersById.get(id);
            if (!r) return null;
            const role = roleOf(id);
            const fresh = freshnessTier(r.fatigue);
            return (
              <div key={id} className="relative">
                {/* #1925: rækken kan trækkes til et andet løb (flyt) eller til puljen (fjern). */}
                <div className="w-full flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-cz-subtle"
                  draggable={!busy}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", encodeDrag({ riderId: id, fromRaceId: column.id }))}>
                  {/* #1919: rolle-tildeling lå skjult bag rytter-navnet uden nogen affordance
                      (Clarity: dead-clicks fordi navnet ikke så interaktivt ud). Chevron +
                      aria-haspopup + hover-farve gør nu tydeligt at navnet åbner rolle-menuen. */}
                  <button type="button" onClick={() => setRoleMenuFor(roleMenuFor === id ? null : id)} disabled={busy}
                    aria-haspopup="menu" aria-expanded={roleMenuFor === id}
                    className="group/role flex items-center gap-1 text-left min-w-0 disabled:opacity-50">
                    <span aria-hidden="true" className={`text-cz-3 text-[10px] flex-shrink-0 transition-transform ${roleMenuFor === id ? "rotate-180" : ""}`}>▾</span>
                    <span className="text-xs text-cz-1 truncate transition-colors group-hover/role:text-cz-accent-t">{r.name}</span>
                    {role && <RoleBadge t={t} role={role} />}
                  </button>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <FitBar score={r.suitability} />
                    <span className={`text-[11px] font-mono ${FRESH_CLASS[fresh] || "text-cz-3"}`}>{r.form ?? "—"}</span>
                    <button type="button" onClick={() => onRemoveRider(column.id, id)} disabled={busy}
                      aria-label={t("racehub.column.remove")}
                      className="text-cz-3 hover:text-cz-danger disabled:opacity-50 text-base leading-none px-1">×</button>
                  </span>
                </div>
                {roleMenuFor === id && (
                  <div className="absolute z-dropdown right-3 mt-0.5 bg-cz-elevated border border-cz-border rounded-cz shadow-overlay p-2 w-[19rem] max-w-[calc(100vw-2rem)]">
                    <div className="grid grid-cols-2 gap-1.5">
                      {roleKeys.map((opt) => (
                        <RoleCard key={opt} role={opt}
                          active={role === opt || (opt === "rider" && !role)}
                          terrainBucket={bucket}
                          profileType={column.primaryProfileType}
                          finaleType={column.primaryFinaleType}
                          disabled={busy}
                          onClick={() => { onSetRole(column.id, id, opt); setRoleMenuFor(null); }} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="p-2 border-t border-cz-border flex items-center justify-end">
        <button type="button" onClick={() => onToggleWithdraw(column.id, !column.withdrawn)} disabled={busy || locked}
          className="text-xs text-cz-3 hover:text-cz-1 disabled:opacity-40 disabled:cursor-not-allowed">
          {column.withdrawn ? t("racehub.column.reenter") : t("racehub.column.withdraw")}
        </button>
      </div>
    </div>
  );
}
