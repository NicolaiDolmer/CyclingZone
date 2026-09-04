import { Link } from "react-router";
import Avatar from "../ui/Avatar.jsx";
import FounderMark from "../FounderMark.jsx";
import {
  formatForumDate,
  authorDisplayName,
  showsSeparateTeamName,
  shouldShowSignature,
} from "./forumIdentity.js";

// #4751 (ejer-direktiv 3/9) — profil-identitet i forummet. Forfatterlinjen paa
// et indlaeg/svar baerer nu:
//   1. et avatar-felt, der linker til managerprofilen
//   2. managernavnet som link til /managers/:teamId
//   3. holdnavnet som link til /teams/:teamId
//
// AVATAR-VALG: der findes INTET billedfelt nogen steder i skemaet
// (database/schema-snapshot.json: hverken users eller teams har en avatar-
// kolonne), saa der er ikke noget billede at vise endnu. Vi bruger derfor
// spillets eksisterende initial-fallback via den kanoniske <Avatar>: hairline-
// ring, initialer af holdnavnet, samme anatomi som resten af appen. <Avatar>
// tager allerede en `src` — den dag et billedfelt findes, er det ét felt der
// skal wires, ikke et nyt visuelt sprog.
//
// TASTE: ingen skygger/gradienter, 5px radius via komponenten, stroke-ikoner
// (FounderMark), tabular figures paa datoen, sentence case.

export default function ForumAuthorIdentity({ author, createdAt, language, size = "md", t }) {
  const name = authorDisplayName(author);
  const teamId = author?.team_id || null;
  const avatarName = author?.team_name || name;
  const avatar = <Avatar name={avatarName} size={size} />;

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {teamId ? (
        <Link
          to={`/managers/${teamId}`}
          aria-label={t("identity.profileAria", { name })}
          className="shrink-0 rounded-cz-pill transition-opacity hover:opacity-80"
        >
          {avatar}
        </Link>
      ) : (
        avatar
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-data text-2xs uppercase tracking-[.04em] text-cz-3">
        {teamId ? (
          <Link
            to={`/managers/${teamId}`}
            className="truncate font-semibold text-cz-2 transition-colors hover:text-cz-accent-t"
          >
            {name}
          </Link>
        ) : (
          <span className="truncate font-semibold text-cz-2">{name}</span>
        )}
        {showsSeparateTeamName(author) && (
          teamId ? (
            <Link
              to={`/teams/${teamId}`}
              className="truncate normal-case transition-colors hover:text-cz-accent-t"
            >
              {author.team_name}
            </Link>
          ) : (
            <span className="truncate normal-case">{author.team_name}</span>
          )
        )}
        {/* #4649: Founder-maerke ved forfatterlinjen. */}
        <FounderMark teamId={teamId} />
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{formatForumDate(createdAt, language)}</span>
      </div>
    </div>
  );
}

// #4751 — auto-signatur: EN linje under indlaegget med holdnavn + division.
// Data der allerede findes paa holdet (teams.name/teams.division), aldrig et
// felt spilleren skal vedligeholde. Falder vaek hvis skribenten selv har
// skrevet holdnavnet i teksten (se shouldShowSignature).
export function ForumSignature({ author, body, t }) {
  if (!shouldShowSignature(body, author)) return null;
  return (
    <p className="mt-2.5 font-data text-2xs uppercase tracking-[.08em] text-cz-3">
      <span className="normal-case">{author.team_name}</span>
      <span aria-hidden="true"> · </span>
      <span className="tabular-nums">{t("signature.division", { division: author.division })}</span>
    </p>
  );
}
