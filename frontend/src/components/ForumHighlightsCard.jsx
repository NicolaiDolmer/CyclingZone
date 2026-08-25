import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Section, SectionHeader, SectionAction, EmptyState, InboxIcon } from "./ui";
import { formatRelativeTime } from "../lib/intl";
import useForumHighlights from "../hooks/useForumHighlights.js";

// Forum-synlighed (#3199, variant B — design låst, ejer-godkendt mockup):
// dashboardets "From the forum"-kort. ALMINDELIGT Card (ikke en nudge-banner,
// ikke en CTA) — tæller IKKE med i #3509's gold-CTA-kæde og heller ikke i
// "maks én nudge-banner ad gangen"-reglen (begge styrer kun de dismissible
// bannere/CTA-korene, ikke almindelige section-cards).
//
// Præcis to rækker: de to tråde med nyeste aktivitet på tværs af pinned +
// almindelige opslag (se useForumHighlights.js for hvorfor det IKKE bare er
// "de første to fra listen"). Ulæst-prik/halvfed titel genbruger #4118/#3451's
// prik-mekanik 1:1 (samme markup som ForumPage's PostRow) — intet nyt
// visuelt sprog.
//
// Fejler kaldet stille (status "error") renderer komponenten INTET — aldrig
// en fejl-tilstand på dashboardet på grund af forummet.
export default function ForumHighlightsCard() {
  const { t } = useTranslation(["dashboard", "forum"]);
  const { status, threads } = useForumHighlights();

  if (status === "error") return null;

  return (
    <Section className="mb-4" data-testid="forum-highlights-card">
      <SectionHeader
        title={t("dashboard:forumHighlights.title")}
        action={
          <SectionAction as={Link} to="/forum">
            {t("dashboard:forumHighlights.allThreads")}
          </SectionAction>
        }
      />
      {status === "loading" ? (
        <div className="animate-pulse space-y-2" aria-hidden="true">
          <div className="h-4 w-3/4 rounded-cz bg-cz-subtle" />
          <div className="h-4 w-2/3 rounded-cz bg-cz-subtle" />
        </div>
      ) : threads.length === 0 ? (
        <EmptyState
          icon={<InboxIcon size={22} aria-hidden="true" />}
          title={t("dashboard:forumHighlights.emptyTitle")}
          description={t("dashboard:forumHighlights.emptyDescription")}
          className="px-4 py-6"
        />
      ) : (
        <ul className="divide-y divide-cz-border">
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link
                to={`/forum/${thread.id}`}
                className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:bg-cz-subtle -mx-2 px-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {thread.is_unread && (
                    <span className="flex-shrink-0" title={t("forum:list.unread")}>
                      <span aria-hidden="true" className="block h-2 w-2 rounded-full bg-cz-accent" />
                      <span className="sr-only">{t("forum:list.unread")}</span>
                    </span>
                  )}
                  <span
                    className={`min-w-0 truncate text-[13.5px] text-cz-1 ${thread.is_unread ? "font-semibold" : "font-medium text-cz-2"}`}
                  >
                    {thread.title}
                  </span>
                  {thread.has_poll && (
                    <span className="shrink-0 text-3xs uppercase bg-cz-accent/10 text-cz-accent-t px-1.5 py-0.5 rounded-cz-pill whitespace-nowrap">
                      {t("forum:list.poll")}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-data text-2xs tabular-nums text-cz-3 whitespace-nowrap">
                  {t("forum:list.replies", { count: thread.reply_count })}
                  {" · "}
                  {formatRelativeTime(thread.last_reply_at || thread.created_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
