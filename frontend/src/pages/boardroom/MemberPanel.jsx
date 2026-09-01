import { useTranslation } from "react-i18next";
import { XIcon } from "../../components/ui";
import { formatWeekdayShortDate, resolveGoalTitle, MOOD_DOT } from "./boardroomFormat";
import MonogramAvatar from "./MonogramAvatar";

// #4557 · Medlems-relations-panel (Member.dc.html) — inline expand fra
// BoardCard's avatar-grid. Alt afledes af allerede-hentet data (ingen ny
// fetch): personlighed fra de eksisterende archetypes.*-beskrivelser i
// board.json, ejede maal fra mandate.goals filtreret paa archetypeKey,
// "in his own words" fra det delte minutes-feed filtreret paa medlemsnavn.
//
// #4570-afstemning: "on the board since S{n}" vises naar backend leverer
// `member.sinceSeason` — udelades stille naar feltet mangler (aldrig et
// gættet taerskeltal). Member.dc.html's tredje citat ("Annual meeting ·
// 28 Aug", ingen confidence-delta) er FORTSAT ikke repraesenteret:
// minutes[]-kontrakten har intet felt for et delta-loest moede-citat.
export default function MemberPanel({ member, mandate, minutes = [], onClose }) {
  const { t } = useTranslation("board");
  if (!member) return null;

  const ownedGoals = (mandate?.goals || []).filter((g) => g.owner?.archetypeKey === member.archetypeKey);
  const ownWords = minutes.filter((m) => m.memberName === member.name);

  const personality = t(`archetypes.${member.archetypeKey}.longDescription`, {
    defaultValue: t(`archetypes.${member.archetypeKey}.shortDescription`, { defaultValue: "" }),
  });

  return (
    <div className="mt-3 rounded-cz border border-cz-border bg-cz-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <MonogramAvatar sizeClass="h-[72px] w-[72px]" initials={member.initials} initialsClass="text-[28px]" navy column>
            <span className="mt-1 text-[8px] uppercase tracking-[.1em] text-cz-sidebar-2">
              {t("boardroom.member.portraitLabel")}
            </span>
          </MonogramAvatar>
          <div>
            <p className="font-display text-[30px] leading-[0.92] tracking-[.01em] text-cz-1">
              {member.name.toUpperCase()}
            </p>
            <p className="mt-[5px] text-xs text-cz-2">
              {[
                t("boardroom.board.role." + member.role, { defaultValue: member.role }),
                member.sinceSeason != null ? t("boardroom.member.sinceSeason", { season: member.sinceSeason }) : null,
                t("boardroom.member.ownsGoalsCount", { count: ownedGoals.length }),
              ].filter(Boolean).join(" · ")}
            </p>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${MOOD_DOT[member.mood] || MOOD_DOT.neutral}`} aria-hidden="true" />
              <span className="text-2xs uppercase tracking-[.08em] text-cz-3">
                {t(`boardroom.board.mood.${member.mood}`, { defaultValue: member.mood })}
              </span>
            </div>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label={t("boardroom.member.close")}
          className="flex-shrink-0 rounded-cz p-1 text-cz-3 transition-colors hover:text-cz-1">
          <XIcon size={16} aria-hidden="true" />
        </button>
      </div>

      {personality && (
        <div className="mt-4 border-t border-cz-border pt-3.5">
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-[.08em] text-cz-3">
            {t("boardroom.member.personalityHeading")}
          </p>
          <p className="text-[13.5px] leading-relaxed text-cz-1">{personality}</p>
        </div>
      )}

      {ownedGoals.length > 0 && (
        <div className="mt-3.5 border-t border-cz-border pt-3.5">
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-[.08em] text-cz-3">
            {t("boardroom.member.ownsGoalsHeading")}
          </p>
          {ownedGoals.map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-2 border-b border-cz-border py-2.5 last:border-b-0">
              <p className="text-[13px] font-medium text-cz-1">{resolveGoalTitle(t, g)}</p>
              <span className="text-2xs font-semibold text-cz-2">{t(`boardroom.status.${g.status}`, { defaultValue: g.status })}</span>
            </div>
          ))}
        </div>
      )}

      {ownWords.length > 0 && (
        <div className="mt-3.5 border-t border-cz-border pt-3.5">
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-[.08em] text-cz-3">
            {t("boardroom.member.ownWordsHeading")}
          </p>
          {ownWords.map((m) => (
            <div key={m.id} className="border-b border-cz-border py-2.5 last:border-b-0">
              <p className="text-[13px] leading-relaxed text-cz-1">
                &ldquo;{t(m.textKey, m.textParams || {})}&rdquo;
              </p>
              <p className="mt-1 font-data text-2xs uppercase tracking-[.06em] tabular-nums text-cz-3">
                {t("boardroom.member.confidenceMove", {
                  sign: m.delta > 0 ? "+" : "",
                  delta: m.delta,
                  date: formatWeekdayShortDate(m.occurredAt),
                })}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3.5 border-t border-cz-border pt-3 text-2xs text-cz-3">
        {t("boardroom.member.footerNote")}
      </div>
    </div>
  );
}
