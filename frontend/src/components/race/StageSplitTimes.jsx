// #6080: mellemtider + "hvor tabte dine ryttere tid". Bruges to steder med
// samme indhold: i løbsfilmen (følger scrubberen via `uptoKm`) og på etape-
// fanen under etaperapporten (hele etapen, i en Section). Al afledning bor i
// lib/stageSplitTimes.ts; her er kun rendering. Renderer INTET når tidslinjen
// ikke har v4's gruppe-gab (ældre løb ser ud som før).
import { useMemo } from "react";
import { Section, SectionHeader } from "../ui";
import { formatNumber } from "../../lib/intl.js";
import { buildSplitTimes, buildOwnTimeLoss, formatSplitGap } from "../../lib/stageSplitTimes.ts";
import { describeEvent } from "../../lib/stageTimelineFilm.js";

function nameOf(riderNameById, id) {
  return riderNameById?.get?.(id) || riderNameById?.get?.(String(id)) || null;
}

function GroupRow({ group, riderNameById, t }) {
  const label = group.kind === "solo"
    ? (nameOf(riderNameById, group.soloRiderId) || t("detail.film.split.group.group"))
    : t(`detail.film.split.group.${group.kind}`);
  // En solo-rytter står allerede med navn; "Dine: X" ville gentage ham.
  const yours = group.kind === "solo" ? [] : group.ownRiderIds.map((id) => nameOf(riderNameById, id)).filter(Boolean);
  const gap = formatSplitGap(group.gapSeconds);
  return (
    <li className="text-sm flex items-baseline gap-2 py-0.5">
      <span className="min-w-0 flex-1">
        <span className={group.kind === "solo" && group.ownRiderIds.length ? "text-cz-1 font-semibold" : "text-cz-1"}>{label}</span>
        {group.kind !== "solo" && group.riderCount != null && (
          <span className="text-cz-3 text-xs tabular-nums"> {t("detail.film.split.riders", { count: group.riderCount })}</span>
        )}
        {yours.length > 0 && (
          <span className="block text-cz-2 text-xs">{t("detail.film.split.yours", { names: yours.join(", ") })}</span>
        )}
      </span>
      <span className="font-data text-xs tabular-nums shrink-0 text-cz-2">{gap ?? t("detail.film.split.front")}</span>
    </li>
  );
}

function SplitPointBlock({ point, riderNameById, t }) {
  // Motorens generiske spurtnavn er engelsk og gentager blot overskriften; vis kun egne navne.
  const genericSprint = point.kind === "sprint" && /^intermediate sprint$/i.test(point.name ?? "");
  const place = point.kind === "kom" && point.category
    ? `${point.name ?? ""} (${t("detail.passages.category", { cat: point.category })})`
    : (genericSprint ? "" : (point.name ?? ""));
  return (
    <div>
      <p className="text-cz-3 text-2xs mb-1">
        <span className="uppercase tracking-wide font-semibold text-cz-2">{t(`detail.passages.${point.kind}`)}</span>
        {place ? <>{" · "}{place}</> : null}
        {" · "}
        <span className="tabular-nums">{t("detail.film.km", { value: formatNumber(point.km) })}</span>
      </p>
      <ul>
        {point.groups.map((g) => <GroupRow key={g.groupId} group={g} riderNameById={riderNameById} t={t} />)}
      </ul>
      {point.hiddenCount > 0 && (
        <p className="text-cz-3 text-xs mt-0.5">{t("detail.film.split.more", { count: point.hiddenCount })}</p>
      )}
    </div>
  );
}

function LossRow({ entry, riderNameById, teamNameById, t }) {
  let main;
  let reason = null;
  let order = null;
  if (entry.type === "drop") {
    const names = (entry.riderIds ?? [entry.riderId]).map((id) => nameOf(riderNameById, id)).filter(Boolean);
    if (!names.length) return null;
    const count = names.length;
    const placeName = entry.sectorName ?? entry.climbName;
    main = t("detail.film.split.drop", {
      rider: names.join(", "), count, from: entry.from,
      where: entry.sectorName ? "sector" : (entry.climbName ? "climb" : "none"), place: placeName ?? "",
    });
    reason = entry.reason !== "unknown" ? t(`detail.film.split.reason.${entry.reason}`, { count }) : null;
    order = entry.order && !(entry.order === "grupetto" && entry.reason === "grupetto")
      ? t(`detail.film.split.order.${entry.order}`) : null;
  } else {
    const described = describeEvent(entry.event, { riderNameById, teamNameById });
    if (!described) return null;
    main = t(`detail.film.event.${described.key}`, described.params);
  }
  return (
    <li className="flex items-baseline gap-3 py-1.5 border-t border-cz-border first:border-t-0">
      <span className="font-data text-2xs text-cz-3 tabular-nums shrink-0 w-14">
        {t("detail.film.km", { value: formatNumber(entry.km) })}
      </span>
      <span className="text-sm leading-snug">
        <span className="text-cz-1">{main}</span>
        {(reason || order) && (
          <span className="block text-cz-2 text-xs">{[reason, order].filter(Boolean).join(" ")}</span>
        )}
      </span>
    </li>
  );
}

export default function StageSplitTimes({
  events, ownRiderIds = [], effortByRider = null, riderNameById, teamNameById, uptoKm = null, variant = "section", t,
}) {
  const splits = useMemo(() => buildSplitTimes(events, { ownRiderIds }), [events, ownRiderIds]);
  const losses = useMemo(() => buildOwnTimeLoss(events, { ownRiderIds, effortByRider }), [events, ownRiderIds, effortByRider]);
  const shownSplits = uptoKm == null ? splits : splits.filter((p) => p.km <= uptoKm);
  const shownLosses = uptoKm == null ? losses : losses.filter((l) => l.km <= uptoKm);
  if (!splits.length && !losses.length) return null;

  const splitList = (
    <div className="space-y-3">
      {shownSplits.map((p, i) => <SplitPointBlock key={`${p.kind}-${p.km}-${i}`} point={p} riderNameById={riderNameById} t={t} />)}
    </div>
  );
  // Overblik først: hvor dine ryttere tabte tid står øverst. På etapefanen er de
  // fulde mellemtider foldet ind; i filmen (følger scrubberen) står de åbne.
  const body = (
    <div className="space-y-4" data-testid={variant === "section" ? undefined : "stage-split-times"}>
      {shownLosses.length > 0 && (
        <div>
          <p className="text-3xs font-bold uppercase tracking-wide text-cz-3 mb-1">{t("detail.film.split.lossTitle")}</p>
          <ul>
            {shownLosses.map((l, i) => <LossRow key={`${l.riderId}-${l.km}-${i}`} entry={l} riderNameById={riderNameById} teamNameById={teamNameById} t={t} />)}
          </ul>
        </div>
      )}
      {shownSplits.length > 0 && (variant === "section" ? (
        <details className={shownLosses.length > 0 ? "pt-3 border-t border-cz-border" : ""} data-testid="stage-split-times-details">
          <summary className="cursor-pointer text-3xs font-bold uppercase tracking-wide text-cz-2 select-none">
            {t("detail.film.split.showAll")}
          </summary>
          <div className="mt-3">{splitList}</div>
        </details>
      ) : (
        <div className={shownLosses.length > 0 ? "pt-3 border-t border-cz-border space-y-3" : "space-y-3"}>
          <p className="text-3xs font-bold uppercase tracking-wide text-cz-3">{t("detail.film.split.title")}</p>
          {splitList}
        </div>
      ))}
    </div>
  );

  if (variant !== "section") return body;
  return (
    <Section data-testid="stage-split-times">
      <SectionHeader title={t("detail.film.split.title")} />
      {body}
    </Section>
  );
}
