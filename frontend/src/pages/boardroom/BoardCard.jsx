import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Section, SectionHeader } from "../../components/ui";
import MemberPanel from "./MemberPanel";
import MonogramAvatar from "./MonogramAvatar";
import { formatWeekdayOnly, MOOD_DOT } from "./boardroomFormat";

function MemberTile({ member, selected, onSelect, t }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={t("boardroom.member.viewHint")}
      className="flex flex-col items-center gap-0 text-center transition-opacity hover:opacity-80"
    >
      <MonogramAvatar sizeClass="h-11 w-11" initials={member.initials} initialsClass="text-lg" navy>
        <span
          aria-hidden="true"
          className={`absolute -bottom-[3px] -right-[3px] h-[10px] w-[10px] rounded-full border-2 border-cz-card ${MOOD_DOT[member.mood] || MOOD_DOT.neutral}`}
        />
      </MonogramAvatar>
      <p className="mt-[7px] text-2xs font-semibold text-cz-1">{member.name}</p>
      <p className="mt-[2px] text-3xs uppercase tracking-[.08em] text-cz-3">
        {t("boardroom.board.role." + member.role, { defaultValue: member.role })}
      </p>
    </button>
  );
}

function MinuteRow({ minute, t }) {
  const isPositive = minute.delta > 0;
  const deltaClass = isPositive ? "text-cz-success" : "text-cz-danger";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-cz-border py-[11px] last:border-b-0">
      <p className="text-[13px] text-cz-1">
        <span className={`font-semibold tabular-nums ${deltaClass}`}>{isPositive ? "+" : ""}{minute.delta}</span>
        {" · "}
        {t(minute.textKey, minute.textParams || {})}
      </p>
      <p className="flex-shrink-0 whitespace-nowrap text-2xs uppercase tracking-[.06em] text-cz-3">
        {minute.memberName} · {formatWeekdayOnly(minute.occurredAt)}
      </p>
    </div>
  );
}

// #4557 · Bestyrelseskort (Main.dc.html §4): 5 medlemmer, formandscitat,
// referat-feed. "Meeting minutes" er i mockuppen et link uden maal i denne
// slice (ingen selvstaendig referat-side findes endnu) — rendered som en
// uppercase meta-label i stedet for en dead-link (SectionHeader-reglens
// action/meta er gensidigt udelukkende, og et link uden destination ville
// genindfoere den dead-click-taethed hele redesignet skal fjerne).
export default function BoardCard({ board, mandate, minutes = [] }) {
  const { t } = useTranslation("board");
  const [selectedKey, setSelectedKey] = useState(null);
  const members = board?.members || [];
  const selectedMember = members.find((m) => m.archetypeKey === selectedKey) || null;
  const feedRows = minutes.slice(0, 3);

  return (
    <Section>
      <SectionHeader
        title={t("boardroom.board.cardTitle")}
        meta={t("boardroom.board.minutesLink")}
      />
      <div className="grid grid-cols-3 gap-3.5 sm:grid-cols-5">
        {members.map((member) => (
          <MemberTile
            key={member.archetypeKey}
            member={member}
            selected={selectedKey === member.archetypeKey}
            onSelect={() => setSelectedKey((cur) => (cur === member.archetypeKey ? null : member.archetypeKey))}
            t={t}
          />
        ))}
      </div>

      {selectedMember && (
        <MemberPanel
          member={selectedMember}
          mandate={mandate}
          minutes={minutes}
          onClose={() => setSelectedKey(null)}
        />
      )}

      {board?.chairmanQuote && (
        <div className="mt-4 rounded-r-cz border-l-2 border-cz-accent bg-cz-subtle px-3.5 py-3">
          <p className="text-[13.5px] leading-relaxed text-cz-1">
            &ldquo;{t(board.chairmanQuote.textKey, board.chairmanQuote.textParams || {})}&rdquo;
          </p>
          <p className="mt-1.5 text-2xs uppercase tracking-[.08em] text-cz-3">
            {board.chairmanQuote.memberName}
            {board.chairmanQuote.contextKey ? ` · ${t(board.chairmanQuote.contextKey)}` : ""}
          </p>
        </div>
      )}

      {feedRows.length > 0 && (
        <div className="mt-4 border-t border-cz-border pt-1">
          {feedRows.map((minute) => (
            <MinuteRow key={minute.id} minute={minute} t={t} />
          ))}
        </div>
      )}
    </Section>
  );
}
