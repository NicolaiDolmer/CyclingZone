// Race Hub Fase 1 — ét overlap-løb som kolonne: header + status-chip + udtagne ryttere.
// Klik en rytter → rolle-menu (kaptajn / sprint-kaptajn / udbrudsjæger / kun rytter);
// × fjerner. Fit-bar + friskheds-farve pr. rytter. Frosset løb (lineup_locked, #1825)
// vises read-only. Afmeld/deltag i footeren.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { computeColumnStatus, freshnessTier, raceDateRangeLabel, raceGameDayLabel, freeRiderCountForColumn } from "../../lib/raceHubLogic.js";
import { partialSquadOutlook } from "../../lib/raceSelectionLogic.js";
import RaceDayOverlapRow from "./RaceDayOverlapRow.jsx";
import { terrainBucket } from "../../lib/stageTerrain.js";
import { ROLE_KEYS, ROLE_KEYS_V3 } from "../../lib/roleHint.js";
import FitBar from "./FitBar.jsx";
import RoleCard from "./RoleCard.jsx";
import RaceLink from "../RaceLink.jsx";
import { LockIcon, StarIcon, AlertTriangleIcon, InfoIcon } from "../ui";
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
    <span className="text-3xs uppercase text-cz-accent-t border border-cz-accent/40 px-1.5 py-px rounded ms-1.5">
      {t(`selection.${ROLE_KEY[role]}`)}
    </span>
  );
}

// #2819: dataTour sættes kun på brættets FØRSTE kolonne, så onboarding-touren
// på /races har et stabilt anker at pege på (samme "kun første række"-mønster som
// AuctionsPage's data-tour="auctions-bid-input").
export default function RaceColumn({ column, onRemoveRider, onClearSelection, onToggleWithdraw, onSetRole, busy, onDropRider, raceV3Enabled = false, paybackFormPoints = null, dataTour, boardState = null, roster = [], bindingMap = null, overlaps = [], clashes = [], onFocusRace, flash = false }) {
  const { t, i18n } = useTranslation("races");
  const [roleMenuFor, setRoleMenuFor] = useState(null);
  const [dragOver, setDragOver] = useState(false); // #1925: kolonne-drop-zone
  const selectedIds = column.selection?.rider_ids || [];
  const ridersById = new Map(column.riders.map((r) => [r.id, r]));
  // #3102 PR 2: formplanens konsekvenser vist DÉR hvor udtagelsen sker — hvem
  // topper netop her, og hvem betaler payback her. Navne slås op i rosteret;
  // en plan for en rytter der ikke længere er i truppen vises ikke.
  const nameOf = (id) => ridersById.get(id)?.name ?? null;
  const peakNames = (column.peakRiderIds || []).map(nameOf).filter(Boolean);
  const paybackNames = (column.paybackRiders || []).map((p) => nameOf(p.riderId)).filter(Boolean);
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
  // #2195 -> #4193 -> #4296. HISTORIK, laes den foer du roerer maerkatet igen.
  // #4193 (24/8) FJERNEDE loebsdags-spaendet fra kortet fordi det loej: spaendet var
  // stoerre end de dage loebet faktisk bandt (La Corsa dei Due Mari stod som "Loebsdag
  // 10-28" men bandt 7 af de 19), og spillerne planlagde efter det.
  // #4217 (25/8, ejer-direktiv) gjorde bindingWindow.days til et sammenhaengende
  // start..end. Dermed DOEDE praemissen for #4193: spaendet ER nu de bundne dage.
  // #4296 bringer derfor tallet tilbage ved siden af datoerne. Begge akser vises,
  // som PLANNING_CENTER_RULES kap. 3 kraever ("en flade der kun viser den ene lyver
  // om den anden"). Ryger spaend-bindingen nogensinde tilbage til en dag-MAENGDE,
  // skal dette maerkat fjernes igen.
  const raceDayLabel = raceDateRangeLabel({
    startMs: column.window?.start,
    endMs: column.window?.end,
    locale: i18n.language,
  });
  // #4296 (Refs #4193): løbsdags-spændet er sandt igen siden #4217 gjorde
  // bindingWindow.days til et sammenhængende start..end. DISPLAY-tallet kommer
  // her UDELUKKENDE fra game_day/game_day_end (aldrig bindingWindow) - se hård
  // invariant i raceHubLogic.js.
  const gameDayLabel = raceGameDayLabel({
    start: column.game_day, end: column.game_day_end, t,
  });
  // #4306 fix (Refs #4306): withdrawn skal have FORRANG over locked. Et hold der
  // afmeldte sig FØR et etapeløb startede skal blive ved med at vise "afmeldt"
  // efter etape 1 er kørt - lineup_locked er sand for HELE løbet uafhængigt af
  // holdets egen withdrawn-status, så den gamle rækkefølge lod "locked" overtrumfe
  // "withdrawn" fra og med etape 1.
  const status = column.withdrawn
    ? { kind: "withdrawn", selected: column.counts.selected, target: column.counts.target }
    : locked
    ? { kind: "locked" }
    : computeColumnStatus({ selected: column.counts.selected, target: column.counts.target, max: column.size?.max, withdrawn: column.withdrawn });
  const statusLabel = status.kind === "locked"
    ? t("racehub.status.locked")
    : t(`racehub.status.${status.kind}`, { selected: status.selected, target: status.target });
  // #4295: gulvet (6 udtagne for at stille op) skal stå HER og ikke kun i løbssidens panel
  // — brættet er hvor dagens udtagelse faktisk foregår. Samme rene regel som panelet
  // (partialSquadOutlook), så de to flader ikke kan sige hver sit om samme løb. Kun
  // konsekvensen vises her; "assistenten fylder pladserne" er allerede dækket af
  // status-chippens tal, og kolonnen er for smal til begge.
  const outlook = column.withdrawn ? null : partialSquadOutlook({
    selected: selectedIds.length,
    free: freeRiderCountForColumn({ column, roster, bindingMap }),
    fieldMax: column.size?.max,
    raceLive: locked,
  });
  const willNotStart = outlook?.kind === "willNotStart" ? outlook : null;

  // #1925: kolonnen er en drop-zone — slip en rytter her for at tilføje/flytte ham hertil.
  // Frosne/afmeldte løb tager ikke imod drops (forælderen validerer også via dropAction).
  const acceptsDrop = !locked && !column.withdrawn;
  return (
    <div
      id={`race-col-${column.id}`}
      tabIndex={-1}
      data-tour={dataTour}
      className={`border rounded-cz bg-cz-card flex flex-col transition-colors ${
        dragOver && acceptsDrop ? "border-cz-accent" : flash ? "border-cz-2" : "border-cz-border"
      }`}
      onDragOver={acceptsDrop ? (e) => { e.preventDefault(); setDragOver(true); } : undefined}
      onDragLeave={() => setDragOver(false)}
      onDrop={acceptsDrop ? (e) => { e.preventDefault(); setDragOver(false); onDropRider?.(e.dataTransfer.getData("text/plain")); } : undefined}
    >
      {/* #3187: hele headeren var kun DELVIST klikbar — kun titel-teksten var et
          <Link>, mens "Løbsdag N", etape/klasse-linjen og status-chippen var almindelig
          tekst i en ikke-interaktiv <div> (Clarity: 129 dødeklik på 6 min, størst
          koncentration i appen). Headeren er nu ÉT hit-target (ægte <a> via RaceLink,
          ikke onClick på en div), så tastatur-fokus + Enter virker som på ethvert
          andet link. Kroppen nedenfor (rytterrækker, roller, ×, afmeld) forbliver sin
          egen interaktive flade — den var aldrig død, så den er urørt. */}
      <RaceLink
        id={column.id}
        state={{ from: "board", ...boardState }}
        data-testid="race-column-open"
        aria-label={t("racehub.column.openRace", { name: column.name })}
        className="group block p-3 border-b border-cz-border cursor-pointer transition-colors hover:bg-cz-subtle/60"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-semibold text-cz-1 transition-colors group-hover:text-cz-accent-t">{column.name}</span>
          {locked && <LockIcon size={13} className="text-cz-3 mt-0.5 flex-shrink-0" aria-hidden="true" />}
        </div>
        <p className="text-2xs text-cz-3 mt-0.5">
          {gameDayLabel && (
            <span className="text-cz-2 font-medium tabular-nums">{gameDayLabel}</span>
          )}
          {gameDayLabel && raceDayLabel && " · "}
          {raceDayLabel}
          {" · "}
          {column.race_type === "stage_race" ? t("raceType.stages", { count: column.stages }) : t("raceType.oneDay")}
          <span className="hidden sm:inline"> · {t(`classOption.${column.race_class}`)}</span>
        </p>
        <span className={`inline-block mt-2 text-3xs uppercase tracking-wide px-2 py-0.5 rounded-full border ${STATUS_CLASS[status.kind]}`}>
          {statusLabel}
        </span>
        {/* Konsekvens, ikke fejl: text-cz-warning som "mangler ryttere"-chippen, aldrig
            text-cz-danger — en delvis trup er stadig lovlig at gemme. */}
        {willNotStart && (
          <p data-testid="column-will-not-start" className="mt-1.5 text-3xs text-cz-warning">
            {t("selection.willNotStartShort", willNotStart)}
          </p>
        )}
        {/* #3102 PR 2: peaks/payback fra formplanen, synligt hvor udtagelsen sker. */}
        {peakNames.length > 0 && (
          <p className="mt-1.5 flex items-start gap-1 text-3xs text-cz-accent-t">
            <StarIcon size={12} aria-hidden="true" className="mt-px shrink-0" />
            <span>{t("racehub.column.peaksHere", { names: peakNames.join(", ") })}</span>
          </p>
        )}
        {paybackNames.length > 0 && (
          <p className="mt-1 flex items-start gap-1 text-3xs text-cz-warning">
            <AlertTriangleIcon size={12} aria-hidden="true" className="mt-px shrink-0" />
            <span>
              {paybackFormPoints != null
                ? t("racehub.column.paybackHere", { names: paybackNames.join(", "), points: paybackFormPoints })
                : t("racehub.column.paybackHereNoPoints", { names: paybackNames.join(", ") })}
            </span>
          </p>
        )}
      </RaceLink>

      {/* #4296: et afmeldt løb binder ingenting (Rod A, #1823) - overlap-raekken
          rendres derfor aldrig for withdrawn kolonner, selvom spændet stadig står
          i meta-linjen ovenfor (det er en kendsgerning om løbet). */}
      {!column.withdrawn && (
        <RaceDayOverlapRow
          overlaps={overlaps}
          clashes={clashes}
          ridersById={ridersById}
          onFocusRace={onFocusRace}
        />
      )}

      {column.withdrawn ? (
        // #4306 (ejer-direktiv 27/8, Refs #4306): withdrawn har FORRANG over locked -
        // et hold der afmeldte sig FØR løbsstart skal blive ved med at vise denne note
        // gennem hele afviklingen, ikke kun frem til etape 1. lineup_locked er sand for
        // HELE løbet uafhængigt af holdets egen withdrawn-status (se status-precedence
        // ovenfor), så denne gren skal ligge FØR "locked"-grenen, ikke efter.
        <div className="flex-1 flex items-start gap-2 px-3 py-4 text-xs text-cz-3">
          <InfoIcon size={14} className="flex-shrink-0 mt-px" aria-hidden="true" />
          <span>{t("racehub.column.withdrawnNote")}</span>
        </div>
      ) : locked ? (
        <div className="py-1 flex-1">
          {selectedIds.map((id) => {
            const r = ridersById.get(id);
            if (!r) return null;
            const role = roleOf(id);
            return (
              <div key={id} className="w-full flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="text-xs text-cz-1 truncate">
                  {r.name}
                  {role && <RoleBadge t={t} role={role} />}
                </span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <FitBar score={r.suitability} />
                  {/* #2637: en igangværende trup er ellers helt read-only, men fjernelse
                      skal ALTID være muligt (fx en rytter der bliver skadet midt i et
                      etapeløb) - kun tilføjelse er frosset. Backend accepterer en ren
                      fjernelse (ingen nye ryttere) selv når stages_completed>0. */}
                  <button type="button" onClick={() => onRemoveRider(column.id, id)} disabled={busy}
                    aria-label={t("racehub.column.remove")}
                    className="text-cz-3 hover:text-cz-danger disabled:opacity-50 text-base leading-none px-1">×</button>
                </span>
              </div>
            );
          })}
          <p className="px-3 py-2 text-3xs text-cz-3">{t("racehub.lineupLocked.note")}</p>
        </div>
      ) : (
        <div className="py-1 flex-1">
          {selectedIds.length > 0 && <p className="px-3 pt-1 pb-0.5 text-3xs text-cz-3">{t("racehub.role.hint")}</p>}
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
                    <span aria-hidden="true" className={`text-cz-3 text-3xs flex-shrink-0 transition-transform ${roleMenuFor === id ? "rotate-180" : ""}`}>▾</span>
                    <span className="text-xs text-cz-1 truncate transition-colors group-hover/role:text-cz-accent-t">{r.name}</span>
                    {role && <RoleBadge t={t} role={role} />}
                  </button>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <FitBar score={r.suitability} />
                    <span className={`text-2xs font-mono ${FRESH_CLASS[fresh] || "text-cz-3"}`}>{r.form ?? "—"}</span>
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
      )}

      <div className="p-2 border-t border-cz-border flex items-center justify-between gap-2">
        {/* #3428: "Ryd udtagelse" manglede pr. løb — kun × pr. rytter fandtes. Kun kladde-
            operation (samme mønster som × og "Ryd dag"): rammer ikke serveren før Gem. */}
        {!locked && !column.withdrawn && selectedIds.length > 0 ? (
          <button type="button" onClick={() => onClearSelection?.(column.id)} disabled={busy}
            className="text-xs text-cz-3 hover:text-cz-danger disabled:opacity-40 disabled:cursor-not-allowed">
            {t("racehub.column.clearSelection")}
          </button>
        ) : <span />}
        <button type="button" onClick={() => onToggleWithdraw(column.id, !column.withdrawn)} disabled={busy || locked}
          className="text-xs text-cz-3 hover:text-cz-1 disabled:opacity-40 disabled:cursor-not-allowed">
          {column.withdrawn ? t("racehub.column.reenter") : t("racehub.column.withdraw")}
        </button>
      </div>
    </div>
  );
}
