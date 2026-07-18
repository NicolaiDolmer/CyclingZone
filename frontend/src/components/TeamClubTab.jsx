import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { EmptyState, Card } from "./ui";
import { useTeamPublicProfile } from "../lib/useTeamPublicProfile";
import { TRACK_ORDER, formatTrackEffect } from "../lib/facilityDisplay";
import TierLadder from "./klub/TierLadder";

// #2601 — read-only "Staff & Facilities" tab on ANY team's page (competitive
// transparency: see how a rival is investing, not just their squad). Backed by
// the sanitized GET /api/teams/:id/public-profile contract (teamPublicProfileHandlers.js) —
// no salary, contract length/expiry, or upgrade economy ever reaches this
// component. Intentionally view-only: no upgrade/hire/fire affordances, even
// on your own team page (that flow stays on /club).
export default function TeamClubTab({ teamId }) {
  const { t } = useTranslation("team");
  const { t: tKlub } = useTranslation("klub");
  const { t: tStaff } = useTranslation("staff");
  const { staff, facilities, enabled, loading, error } = useTeamPublicProfile(teamId);

  if (loading) return (
    <div className="flex justify-center py-8">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );
  // Samme flag-kilde + tomme-tilstand som /club selv (KlubPage.jsx) — spilleren
  // ser samme "lukket"-besked uanset hvilken holdside der viser den.
  if (!enabled) return <EmptyState title={tKlub("empty.title")} description={tKlub("empty.description")} />;
  if (error) return <EmptyState title={t("club.errorTitle")} description={t("club.errorDescription")} />;

  const byTrack = Object.fromEntries(facilities.map((f) => [f.track, f]));
  const ordered = TRACK_ORDER.map((tr) => byTrack[tr]).filter(Boolean);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-cz-1 font-semibold text-sm mb-2">{t("club.facilitiesTitle")}</h2>
        <div className="flex flex-col gap-2">
          {ordered.map((f) => (
            <Card key={f.track} className="px-[14px] py-[12px] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-baseline gap-[10px] flex-wrap">
                  <span className="font-display text-[15px] leading-none">{tKlub(`tracks.${f.track}.name`)}</span>
                  <span className="text-[11px] text-cz-accent-t">
                    {f.tier === 0 ? tKlub("facilities.notBuilt") : tKlub("facilities.tier", { tier: f.tier, max: 5 })}
                  </span>
                  {f.tier > 0 && (
                    <span className={`text-[9.5px] uppercase tracking-wide rounded-[3px] px-[6px] py-[2px] ${f.effectLive ? "text-cz-success bg-cz-success/10" : "text-cz-accent-t bg-cz-accent/10"}`}>
                      {tKlub(f.effectLive ? "effect.live" : "effect.target")}
                    </span>
                  )}
                </div>
                {f.tier > 0 && <div className="my-[6px]"><TierLadder tier={f.tier} /></div>}
                <div className="text-[11px] text-cz-2">
                  {f.staff
                    ? <>{tStaff(`roles.${f.track}`)} <Link to={`/staff/${f.staff.id}`} className="text-cz-1 hover:text-cz-accent-t underline underline-offset-2">{f.staff.name}</Link> (T{f.staff.tier})</>
                    : <span className="text-cz-3">{tKlub("staff.none")}</span>}
                </div>
              </div>
              {f.tier > 0 && (
                <div className="text-right shrink-0">
                  <span className="font-data text-cz-1 text-[12px]">{formatTrackEffect(f.track, f.effectiveBonus)}</span>
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-cz-1 font-semibold text-sm mb-2">{t("club.staffTitle")}</h2>
        {staff.length === 0 ? (
          <p className="text-cz-3 text-sm">{t("club.noStaff")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {staff.map((s) => (
              <Link key={s.id} to={`/staff/${s.id}`}
                className="bg-cz-card border border-cz-border rounded-cz px-4 py-2.5 flex items-center justify-between hover:border-cz-3 transition-colors">
                <span className="text-cz-1 text-sm font-medium">{s.name}</span>
                <span className="text-cz-2 text-xs flex items-center gap-2">
                  {tStaff(`roles.${s.role}`)}
                  <span className="font-mono text-cz-3">T{s.tier}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
