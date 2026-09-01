import { useTranslation } from "react-i18next";
import { Section, SectionHeader, EmptyState, FlagIcon } from "../../components/ui";

// Milepael-prik pr. status (Main.dc.html §3): "current" = gold fyld + navy
// kant (2px, sidebar-navy — samme token som app-shellets altid-moerke
// sidebar), alt andet er en neutral/status-kant-cirkel.
function MilestoneDot({ status }) {
  if (status === "current") {
    return <div className="mx-auto h-4 w-4 rounded-full border-2 border-cz-sidebar bg-cz-accent" />;
  }
  const borderClass = status === "achieved"
    ? "border-cz-success"
    : status === "missed"
      ? "border-cz-danger"
      : "border-cz-3";
  return <div className={`mx-auto mt-[2px] h-3 w-3 rounded-full border-2 bg-cz-card ${borderClass}`} />;
}

export default function VisionCard({ vision }) {
  const { t } = useTranslation("board");

  if (!vision) {
    return (
      <Section>
        <SectionHeader title={t("boardroom.vision.cardTitle")} />
        <EmptyState
          icon={<FlagIcon size={26} aria-hidden="true" />}
          title={t("boardroom.vision.empty.title")}
          description={t("boardroom.vision.empty.description")}
        />
      </Section>
    );
  }

  const milestones = vision.milestones || [];

  return (
    <Section>
      <SectionHeader
        title={t("boardroom.vision.cardTitle")}
        meta={t("boardroom.vision.meta", { start: vision.startSeason, end: vision.endSeason })}
      />
      <div className="relative pt-2">
        <div className="absolute left-10 right-10 top-[17px] h-px bg-cz-border" aria-hidden="true" />
        <div className="relative grid gap-3.5" style={{ gridTemplateColumns: `repeat(${milestones.length}, minmax(0, 1fr))` }}>
          {milestones.map((m) => (
            <div key={m.id} className="text-center">
              <MilestoneDot status={m.status} />
              <p className={`mt-2 text-3xs font-semibold uppercase tracking-[.1em] ${m.isCurrentSeason ? "text-cz-accent-t" : "text-cz-3"}`}>
                {m.isCurrentSeason
                  ? t("boardroom.vision.currentSeasonLabel", { season: m.seasonNumber })
                  : t("boardroom.vision.seasonLabel", { season: m.seasonNumber })}
              </p>
              <p className="mt-[3px] text-[13px] font-medium text-cz-1">
                {t(m.labelKey, m.labelParams || {})}
              </p>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-[18px] border-t border-cz-border pt-3 text-[13px] text-cz-2">
        {t("boardroom.vision.explainer")}
      </div>
    </Section>
  );
}
