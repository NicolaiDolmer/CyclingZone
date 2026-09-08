import { Link } from "react-router";
import useMentionableManagers from "../../hooks/useMentionableManagers.js";
import { splitMentionSegments } from "../../lib/forumMentions.js";

// #5011 (ejer-direktiv 3/9, #4751) — brødtekst med klikbare @navne.
//
// Komponenten rendrer KUN inline-indhold (tekststykker + links), aldrig sit
// eget afsnit: kalderen beholder sit <p className="whitespace-pre-wrap ...">,
// så linjeskift, typografi-trin og indrykning bliver præcis som før. Det gør
// også ændringen i ForumPostPage til én linje pr. sted.
//
// Navnet linker til /managers/:teamId — SAMME mål som forfatterlinjens
// managernavn (ForumAuthorIdentity, #4751), fordi det er den samme identitet.
// Mangler manageren et team_id, står navnet som ren tekst: et dødt link er
// værre end intet link (#4501-lektien om døde klik).
//
// Ingen egen farve-opfindelse: accent-tonen er den samme som resten af
// forummets links, uden ikon og uden baggrundschip. Et @navn er et navn i en
// sætning, ikke et badge (TASTE — ingen dekoration der ikke bærer information).
export default function MentionText({ body }) {
  const managers = useMentionableManagers();
  const segments = splitMentionSegments(body, managers);

  // Nøglen er positionel med vilje: segmenterne er ren afledning af teksten og
  // har ingen stabil identitet at nøgle på.
  return segments.map((segment, i) => {
    if (segment.type !== "mention") {
      return <span key={i}>{segment.text}</span>;
    }
    const teamId = segment.manager?.team_id || null;
    if (!teamId) {
      return <span key={i} className="font-medium text-cz-2">{segment.text}</span>;
    }
    return (
      <Link
        key={i}
        to={`/managers/${teamId}`}
        className="font-medium text-cz-accent-t transition-colors hover:underline"
      >
        {segment.text}
      </Link>
    );
  });
}
