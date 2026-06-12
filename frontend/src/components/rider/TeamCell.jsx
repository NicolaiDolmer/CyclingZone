import TeamLink from "../TeamLink";

// Holdnavn (rytterens pro-hold) som klikbart link. Uden hold vises fri-agent-
// label. Bruges som <td>-indhold — kaldersiden styrer <td>-wrapper og bredde.
//
// #950: når en handel er parkeret (pending_team_id sat), kan kaldersiden give
// `pendingTeam` + `pendingTitle`, så cellen viser kommende hold som en
// "på vej til holdskifte"-chip (→ holdnavn) under det nuværende hold.
// Self-pending (pending == nuværende hold, fx intern handel) viser ingen chip.
export default function TeamCell({
  team,
  freeLabel,
  pendingTeam = null,
  pendingTitle = "",
  stopPropagation = false,
  className = "text-cz-2 text-xs hover:text-cz-accent-t transition-colors",
  freeClassName = "text-cz-accent-t/70 text-xs",
}) {
  const current = team?.name ? (
    <TeamLink id={team.id} stopPropagation={stopPropagation} className={className}>
      {team.name}
    </TeamLink>
  ) : (
    <span className={freeClassName}>{freeLabel}</span>
  );

  const showPending = Boolean(pendingTeam?.name) && pendingTeam.id !== team?.id;
  if (!showPending) return current;

  return (
    <div className="flex flex-col items-start gap-0.5 min-w-0">
      {current}
      <span
        title={pendingTitle || undefined}
        aria-label={pendingTitle || undefined}
        className="inline-flex items-center gap-1 rounded bg-cz-accent/15 px-1.5 py-0.5 text-[10px] leading-none text-cz-accent-t"
      >
        <span aria-hidden="true">→</span>
        <TeamLink id={pendingTeam.id} stopPropagation={stopPropagation} className="font-semibold hover:underline">
          {pendingTeam.name}
        </TeamLink>
      </span>
    </div>
  );
}
