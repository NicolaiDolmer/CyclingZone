import TeamLink from "../TeamLink";

// Holdnavn (rytterens pro-hold) som klikbart link. Uden hold vises fri-agent-
// label. Bruges som <td>-indhold — kaldersiden styrer <td>-wrapper og bredde.
export default function TeamCell({
  team,
  freeLabel,
  stopPropagation = false,
  className = "text-cz-2 text-xs hover:text-cz-accent-t transition-colors",
  freeClassName = "text-cz-accent-t/70 text-xs",
}) {
  if (!team?.name) {
    return <span className={freeClassName}>{freeLabel}</span>;
  }
  return (
    <TeamLink id={team.id} stopPropagation={stopPropagation} className={className}>
      {team.name}
    </TeamLink>
  );
}
