// #7862 · Løbssiden v6: Startliste-fanen (beslutningslisten på #7778, valg 9 og 10;
// wireframe v6c "Start list"). Bag kontakten race_page_v6.
//
// Venstre: favoritter pr. klassement (Samlet/Point/Bjerg/Ungdom) med resultatlinjen
// under navnet; ingen stjerner, før en beregning er godkendt (valg 10). Kun stillingen
// i løbet, som alle kan se.
// Højre: hele feltet pr. hold med rygnumre (valg 9), flag, ryttertype, rating og U25,
// med søgning (rytter, hold, nation), Mit hold og nationsfilter. Listen ruller i sin
// egen boks på brede skærme (samme SCROLLER som spillets tabeller); på telefonen følger den siden.
// Navnecellen følger TASTE P12: nation, person-ikon (RiderLink), navn, mærker, type.
// Ingen guld-knap: sidens ene primærknap står i hovedet.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../../../lib/supabase.ts";
import { getCountryName } from "../../../lib/countryUtils.js";
import { seasonReferenceYear } from "../../../lib/riderAge.js";
import TeamLinkJs from "../../TeamLink.jsx";
import RiderTypeBadgeJs from "../../rider/RiderTypeBadge.jsx";
import RiderBadgesJs from "../../rider/RiderBadges.jsx";
import { SCROLLER } from "../../ui/dataTableStyles.js";
import { SearchIcon as SearchIconJs, XIcon as XIconJs } from "../../ui/icons/index.jsx";
import { Flag, RiderLink, Section, SectionHeader, Segmented, SkeletonLines, Button } from "../stagePageV2/ui.ts";
import {
  EMPTY_START_LIST_FILTER, buildStartList, filterStartList, startListCount, startListFavouriteClasses, startListFavourites,
  startListNations, startListOpensIn, type StartListEntry, type StartListFavouriteClass, type StartListFilter,
} from "./v6StartListModel.ts";

interface IconProps { size?: number; className?: string; "aria-hidden"?: boolean | "true" }
const SearchIcon = SearchIconJs as unknown as (props: IconProps) => ReactNode;
const XIcon = XIconJs as unknown as (props: IconProps) => ReactNode;
const TeamLink = TeamLinkJs as unknown as (props: { id?: string | null; className?: string; children: ReactNode }) => ReactNode;
const RiderTypeBadge = RiderTypeBadgeJs as unknown as (props: { primaryType?: string | null; secondaryType?: string | null; size?: "sm" | "md"; className?: string }) => ReactNode;
const RiderBadges = RiderBadgesJs as unknown as (props: { badges: Array<string | false | null | undefined>; className?: string }) => ReactNode;

const TOUCH = "[@media(max-width:640px),(pointer:coarse)]:min-h-11";

type Loose = { select(cols: string): Loose; eq(col: string, v: unknown): Loose; maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }> } & PromiseLike<{ data: unknown; error: { message: string } | null }>;
const db = supabase as unknown as { from(table: string): Loose };

type FieldState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; entries: StartListEntry[]; withdrawn: Set<string>; seasonYear: number | null };

/** Feltet: race_entries med rytter og hold, holdene der har meldt fra, og løbets sæson (til U25). */
function useStartListField(raceId: string | null, enabled: boolean, attempt: number): FieldState {
  const [state, setState] = useState<{ key: string; value: FieldState } | null>(null);
  const key = `${raceId}:${attempt}`;
  useEffect(() => {
    if (!enabled || !raceId) return undefined;
    let alive = true;
    Promise.all([
      db.from("race_entries")
        .select("rider_id, team_id, rider:rider_id(id, firstname, lastname, nationality_code, birthdate, primary_type, best_role_rating), team:team_id(id, name)")
        .eq("race_id", raceId),
      db.from("race_withdrawals").select("team_id").eq("race_id", raceId),
      db.from("races").select("season:season_id(number)").eq("id", raceId).maybeSingle(),
    ]).then(([entriesRes, withdrawnRes, raceRes]) => {
      if (!alive) return;
      // Holdene der har meldt fra beholder deres race_entries; uden den liste ville de stå
      // som deltagere med rygnumre. Fejler opslaget, er feltet ikke kendt: fejl + prøv igen.
      if (entriesRes.error || withdrawnRes.error) { setState({ key, value: { status: "error" } }); return; }
      const withdrawn = new Set(((withdrawnRes.data ?? []) as Array<{ team_id: string }>).map((w) => String(w.team_id)));
      const seasonNumber = Number((raceRes.data as { season?: { number?: number | null } | null } | null)?.season?.number);
      setState({ key, value: { status: "ready", entries: (entriesRes.data ?? []) as StartListEntry[], withdrawn, seasonYear: seasonReferenceYear(seasonNumber) } });
    }).catch(() => { if (alive) setState({ key, value: { status: "error" } }); });
    return () => { alive = false; };
  }, [raceId, enabled, key]);
  return state && state.key === key ? state.value : { status: "loading" };
}

export interface V6StartListProps {
  raceId: string | null;
  isStageRace: boolean;
  stagesCompleted: number;
  /** Løbets resultatrækker, som siden har dem (stillingen efter den senest kørte etape). */
  results: unknown[];
  hiddenResultsSlot?: ReactNode;
  myTeamId: string | number | null | undefined;
  /** Første etapes start (synlighed som divisionernes startlister); null = ukendt. */
  firstStartMs: number | null;
  nowMs: number;
}

const CLASS_LABEL: Record<StartListFavouriteClass, string> = { gc: "gc", points: "points", mountain: "mountain", young: "young" };

export default function V6StartList({ raceId, isStageRace, stagesCompleted, results, hiddenResultsSlot = null, myTeamId, firstStartMs, nowMs }: V6StartListProps) {
  const { t, i18n } = useTranslation("races");
  // Fanens egne tekster bor i det lazy "results"-navnerum (første indlæsning holdes under budgettet).
  const { t: ts } = useTranslation("results");
  const opensIn = startListOpensIn(firstStartMs, nowMs);
  const [attempt, setAttempt] = useState(0);
  const field = useStartListField(raceId, opensIn == null, attempt);
  const [filter, setFilter] = useState<StartListFilter>(EMPTY_START_LIST_FILTER);
  const lang = i18n.language;

  const teams = useMemo(
    () => (field.status === "ready" ? buildStartList(field.entries, { withdrawnTeamIds: field.withdrawn, myTeamId, seasonYear: field.seasonYear }) : []),
    [field, myTeamId],
  );
  const nationName = (code: string) => getCountryName(code, lang);
  const nations = useMemo(() => startListNations(teams, (c) => getCountryName(c, lang)), [teams, lang]);
  const shown = useMemo(
    () => filterStartList(teams, filter, (c) => [getCountryName(c, lang), getCountryName(c, "en")]),
    [teams, filter, lang],
  );
  const total = startListCount(teams);
  const shownCount = startListCount(shown);
  const filtering = filter.mineOnly || filter.nation !== "all" || filter.query.trim() !== "";
  const hasMine = teams.some((tm) => tm.mine);

  // At fjerne tal alene røber stadig resultatet gennem listens udvalg og rækkefølge.
  const resultsHidden = hiddenResultsSlot != null;
  const favClasses = useMemo(() => resultsHidden ? [] : startListFavouriteClasses(results as never, stagesCompleted), [resultsHidden, results, stagesCompleted]);
  const [favPick, setFavPick] = useState<StartListFavouriteClass>("gc");
  const favCls = favClasses.includes(favPick) ? favPick : favClasses[0] ?? "gc";
  const favourites = useMemo(
    () => resultsHidden ? [] : startListFavourites(results as never, { stagesCompleted, cls: favCls, myTeamId }),
    [resultsHidden, results, stagesCompleted, favCls, myTeamId],
  );
  const afterLabel = isStageRace ? ts("raceStartList.afterStage", { number: stagesCompleted }) : ts("raceStartList.afterRace");

  const favouritesCard = (
    <Section aria-label={ts("raceStartList.favouritesTitle")}>
      <SectionHeader title={ts("raceStartList.favouritesTitle")} />
      {favClasses.length > 1 && (
        <Segmented
          label={ts("raceStartList.favouritesFor")}
          value={favCls}
          onChange={(v) => setFavPick(v as StartListFavouriteClass)}
          options={favClasses.map((c) => ({ value: c, label: t(`detail.classTab.${CLASS_LABEL[c]}`) }))}
          className="mb-3"
        />
      )}
      {hiddenResultsSlot ?? (favourites.length > 0 ? (
        <ol className="m-0 list-none p-0" data-start-favourites="">
          {favourites.map((f) => (
            <li key={f.riderId} className={`flex min-h-11 items-start gap-2.5 border-t border-cz-border px-1 py-2 ${f.mine ? "bg-cz-subtle" : ""}`}>
              <span className="w-5 flex-none pt-0.5 text-right font-data text-xs tabular-nums text-cz-3">{f.rank}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex min-w-0 items-center gap-1.5">
                  {f.nation && <Flag code={f.nation} className="flex-none" />}
                  <RiderLink id={f.riderId} className="truncate text-sm font-semibold text-cz-1 hover:text-cz-accent-t">{f.name}</RiderLink>
                  {f.mine && <span className="flex-none rounded-cz bg-cz-1 px-1.5 py-0.5 font-data text-3xs font-bold uppercase tracking-[.08em] text-cz-body">{t("stagePageV2.favourites.you")}</span>}
                </span>
                <span className="text-2xs text-cz-2">
                  {f.teamName ? <TeamLink id={f.teamId} className="hover:text-cz-accent-t">{f.teamName}</TeamLink> : null}
                  {f.teamName ? " · " : ""}
                  {ts("raceStartList.favouriteLine", { rank: f.rank, after: afterLabel })}
                  {f.gap ? <> · <span className="font-data tabular-nums">{f.gap}</span></> : null}
                </span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="m-0 text-sm text-cz-2">{ts("raceStartList.favouritesEmpty")}</p>
      ))}
      <p className="m-0 mt-3 border-t border-cz-border pt-2.5 text-xs text-cz-3">{ts("raceStartList.favouritesFoot")}</p>
    </Section>
  );

  let fieldBody: ReactNode;
  if (opensIn != null) {
    fieldBody = <p className="m-0 py-4 text-sm text-cz-2">{ts("raceStartList.opensIn", { count: opensIn })}</p>;
  } else if (field.status === "loading") {
    fieldBody = <SkeletonLines lines={8} />;
  } else if (field.status === "error") {
    fieldBody = (
      <div className="flex flex-col items-start gap-3 py-2">
        <p className="m-0 text-sm text-cz-2">{ts("raceStartList.loadError")}</p>
        <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>{ts("raceStartList.retry")}</Button>
      </div>
    );
  } else if (teams.length === 0) {
    fieldBody = <p className="m-0 py-4 text-sm text-cz-2">{ts("raceStartList.empty")}</p>;
  } else {
    fieldBody = (
      <>
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-start-controls="">
          <span className="relative inline-flex min-w-0 basis-full items-center sm:max-w-72 sm:flex-1 sm:basis-auto">
            <SearchIcon size={14} aria-hidden="true" className="pointer-events-none absolute start-2.5 text-cz-3" />
            <input
              type="search"
              value={filter.query}
              onChange={(e) => setFilter({ ...filter, query: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Escape" && filter.query) { e.preventDefault(); setFilter({ ...filter, query: "" }); } }}
              placeholder={ts("raceStartList.searchPlaceholder")}
              aria-label={ts("raceStartList.searchPlaceholder")}
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
              className={`w-full rounded-cz border border-cz-border bg-cz-card py-2 ps-8 pe-8 text-sm text-cz-1 placeholder:text-cz-3 transition-colors focus:border-cz-3 focus:outline-hidden focus:ring-1 focus:ring-cz-accent [&::-webkit-search-cancel-button]:hidden ${TOUCH}`}
            />
            {filter.query && (
              <button
                type="button"
                onClick={() => setFilter({ ...filter, query: "" })}
                aria-label={ts("raceStartList.clearSearch")}
                className="absolute end-1 inline-flex h-7 w-7 items-center justify-center rounded-cz text-cz-3 hover:text-cz-1 [@media(max-width:640px),(pointer:coarse)]:h-9 [@media(max-width:640px),(pointer:coarse)]:w-9"
              >
                <XIcon size={13} aria-hidden="true" />
              </button>
            )}
          </span>
          {hasMine && (
            <button
              type="button"
              aria-pressed={filter.mineOnly}
              onClick={() => setFilter({ ...filter, mineOnly: !filter.mineOnly })}
              className={`inline-flex items-center rounded-cz border px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors focus:outline-hidden focus:ring-1 focus:ring-cz-accent ${TOUCH} ${
                filter.mineOnly ? "border-cz-accent/30 bg-cz-accent/10 text-cz-accent-t" : "border-cz-border bg-cz-card text-cz-2 hover:text-cz-1"
              }`}
            >
              {ts("raceStartList.myTeam")}
            </button>
          )}
          {nations.length > 1 && (
            <select
              value={filter.nation}
              onChange={(e) => setFilter({ ...filter, nation: e.target.value })}
              aria-label={ts("raceStartList.nation")}
              className={`max-w-56 cursor-pointer rounded-cz border px-3 py-2 text-sm font-medium transition-colors focus:outline-hidden focus:ring-1 focus:ring-cz-accent ${TOUCH} ${
                filter.nation !== "all" ? "border-cz-accent/30 bg-cz-accent/10 text-cz-accent-t" : "border-cz-border bg-cz-card text-cz-2"
              }`}
            >
              <option value="all">{ts("raceStartList.allNations")}</option>
              {nations.map((n) => <option key={n.code} value={n.code}>{n.name}</option>)}
            </select>
          )}
          <span className="ms-auto font-data text-2xs tabular-nums text-cz-3" aria-live="polite">
            {filtering ? ts("raceStartList.matchCount", { shown: shownCount, total }) : ""}
          </span>
        </div>
        {shown.length === 0 ? (
          <p className="m-0 py-6 text-center text-sm text-cz-3">{ts("raceStartList.noMatch")}</p>
        ) : (
          <div className={SCROLLER} data-start-list-scroll="">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
              {shown.map((team) => (
                <section key={team.teamId} aria-label={team.name} className="rounded-cz border border-cz-border bg-cz-card px-2.5 py-2" data-start-team={team.mine ? "mine" : ""}>
                  <h3 className="m-0 mb-1 flex items-center justify-between gap-2 text-sm font-semibold text-cz-1">
                    <TeamLink id={team.teamId} className="min-w-0 truncate hover:text-cz-accent-t">{team.name || ts("raceStartList.unnamedTeam")}</TeamLink>
                    {team.mine && <span className="flex-none rounded-cz bg-cz-1 px-1.5 py-0.5 font-data text-3xs font-bold uppercase tracking-[.08em] text-cz-body">{t("stagePageV2.favourites.you")}</span>}
                  </h3>
                  <ul className="m-0 list-none p-0">
                    {team.riders.map((r) => (
                      <li key={r.riderId} className="grid min-h-8 grid-cols-[1.75rem_minmax(0,1fr)_auto_1.75rem] items-center gap-1.5 py-0.5 text-sm [@media(max-width:640px),(pointer:coarse)]:min-h-11">
                        <span className="font-data text-xs tabular-nums text-cz-3"><span className="sr-only">{ts("raceStartList.bibAria", { bib: r.bib })}</span><span aria-hidden="true">{r.bib}</span></span>
                        <span className="flex min-w-0 items-center gap-1">
                          {r.nation && <Flag code={r.nation} className="flex-none" title={nationName(r.nation)} />}
                          <RiderLink id={r.riderId} className="truncate text-cz-1 hover:text-cz-accent-t">{r.name || "?"}</RiderLink>
                          {r.u25 && <RiderBadges badges={["u25"]} className="flex-none" />}
                        </span>
                        {/* Kun hovedtypen: navnet skal have pladsen i holdets smalle kort. */}
                        <RiderTypeBadge primaryType={r.primaryType} size="sm" />
                        <span className="text-right font-data text-xs tabular-nums text-cz-2" title={ts("raceStartList.rating")}>{r.rating != null && <><span className="sr-only">{ts("raceStartList.rating")} </span>{r.rating}</>}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div data-race-section="start" className="@container">
      <div className="grid grid-cols-1 items-start gap-[14px] @4xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="min-w-0">{favouritesCard}</div>
        <div className="min-w-0">
          <Section aria-label={ts("raceStartList.fieldTitle")}>
            <SectionHeader
              title={ts("raceStartList.fieldTitle")}
              meta={field.status === "ready" && opensIn == null && total > 0 ? ts("raceStartList.fieldMeta", { riders: total, teams: teams.length }) : undefined}
            />
            {fieldBody}
          </Section>
        </div>
      </div>
    </div>
  );
}

