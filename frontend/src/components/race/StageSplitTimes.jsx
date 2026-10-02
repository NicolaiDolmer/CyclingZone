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
  const yours = group.ownRiderIds.map((id) => nameOf(riderNameById, id)).filter(Boolean);
  const gap = formatSplitGap(group.gapSeconds);
  return (
    <li className="text-sm flex items-baseline gap-2 py-0.5">
      <span className="min-w-0 flex-1">
        <span className="text-cz-1">{label}</span>
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
  const place = point.kind === "kom" && point.category
    ? `${point.name ?? ""} (${t("detail.passages.category", { cat: point.category })})`
    : (point.name ?? "");
  return (
    <div>
      <p className="text-cz-3 text-2xs mb-1">
        <span className="uppercase tracking-wide font-semibold text-cz-2">{t(`detail.passages.${point.kind}`)}</span>
        {" · "}
        {place}
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
    const rider = nameOf(riderNameById, entry.riderId);
    if (!rider) return null;
    const placeName = entry.sectorName ?? entry.climbName;
    main = t("detail.film.split.drop", {
      rider, from: entry.from, where: entry.sectorName ? "sector" : (entry.climbName ? "climb" : "none"), place: placeName ?? "",
    });
    reason = entry.reason !== "unknown" ? t(`detail.film.split.reason.${entry.reason}`) : null;
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

  const body = (
    <div className="space-y-4" data-testid="stage-split-times">
      {shownSplits.length > 0 && (
        <div className="space-y-3">
          {variant !== "section" && <p className="text-3xs font-bold uppercase tracking-wide text-cz-3">{t("detail.film.split.title")}</p>}
          {shownSplits.map((p, i) => <SplitPointBlock key={`${p.kind}-${p.km}-${i}`} point={p} riderNameById={riderNameById} t={t} />)}
        </div>
      )}
      {shownLosses.length > 0 && (
        <div className={shownSplits.length > 0 ? "pt-3 border-t border-cz-border" : ""}>
          <p className="text-3xs font-bold uppercase tracking-wide text-cz-3 mb-1">{t("detail.film.split.lossTitle")}</p>
          <ul>
            {shownLosses.map((l, i) => <LossRow key={`${l.riderId}-${l.km}-${i}`} entry={l} riderNameById={riderNameById} teamNameById={teamNameById} t={t} />)}
          </ul>
        </div>
      )}
    </div>
  );

  if (variant !== "section") return body;
  return (
    <Section>
      <SectionHeader title={t("detail.film.split.title")} />
      {body}
    </Section>
  );
}
