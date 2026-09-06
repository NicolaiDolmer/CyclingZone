import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Section, SectionHeader } from "../../components/ui";
import MemberPanel from "./MemberPanel";
import MonogramAvatar from "../../components/MonogramAvatar";
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
// #4557 (overblik + faner) · Klub-DNA-linjen efter en hairline nederst i
// Board-fanen (mockup 6/9). DNA'et afgoer hvem der sidder her og hvordan de
// vaegter maalene (BOARD_RULES §8), saa forklaringen bor netop her.
// Foerste saeson: "Change club DNA" (den EKSISTERENDE dna.rechoose-copy og
// POST /board/dna-choose). Fra saeson 2: samme linje uden knap, med
// "Locked for the season" i hoejre side (dna.locked.heading).
function ClubDnaLine({ canRechoose, onChange, t }) {
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-cz-border pt-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <p className="text-[12.5px] leading-relaxed text-cz-2">
        {t("boardroom.board.dnaExplainer")}
        <br />
        {canRechoose ? t("dna.rechoose.hint") : t("dna.locked.body")}
      </p>
      {canRechoose ? (
        <button
          type="button"
          onClick={onChange}
          className="flex-shrink-0 self-start text-xs font-medium text-cz-accent-t transition-colors hover:underline sm:self-auto"
        >
          {t("dna.rechoose.toggle")}
        </button>
      ) : (
        <span className="flex-shrink-0 whitespace-nowrap font-data text-2xs uppercase tracking-[.08em] text-cz-3">
          {t("dna.locked.heading")}
        </span>
      )}
    </div>
  );
}

export default function BoardCard({ board, mandate, minutes = [], dna = null, onChangeDna }) {
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

      {/* #4557 · Ingen venstre-accent-bjaelke paa citatet: den er et femte
          prioritetssignal oven i de fire guld har lov til (TASTE §3
          forbudsliste), og mockup'en 6/9 tegner citatet som en ren
          subtle-flade. */}
      {board?.chairmanQuote && (
        <div className="mt-4 rounded-cz bg-cz-subtle px-3.5 py-3">
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

      {dna?.hasDna && <ClubDnaLine canRechoose={Boolean(dna.canRechoose)} onChange={onChangeDna} t={t} />}
    </Section>
  );
}
