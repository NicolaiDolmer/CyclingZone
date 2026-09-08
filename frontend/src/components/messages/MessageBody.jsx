import { splitMessageText } from "../../lib/messageSegments.js";

// #3200 · Beskedteksten. Ren tekst med bevaret linjeskift, præcis som
// forummets indlæg (ForumPostPage.jsx: whitespace-pre-wrap), med den ene
// forskel at en http(s)-URL bliver et klikbart tekst-link.
//
// Der er ingen dangerouslySetInnerHTML og ingen markdown: teksten er det
// brugeren skrev, og den ligger i loggen for evigt (#3131). Segmenteringen
// (og hvorfor javascript:/data: aldrig bliver links) bor i
// lib/messageSegments.js og er unit-testet dér.
export default function MessageBody({ text, className = "" }) {
  return (
    <p className={`whitespace-pre-wrap break-words text-[13.5px] leading-relaxed ${className}`}>
      {splitMessageText(text).map((segment, index) => (
        segment.type === "link" ? (
          <a
            key={index}
            href={segment.value}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline underline-offset-2 transition-colors hover:text-cz-accent-t"
          >
            {segment.value}
          </a>
        ) : (
          <span key={index}>{segment.value}</span>
        )
      ))}
    </p>
  );
}
