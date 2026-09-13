import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { supabase, authHeaders } from "../lib/supabase"; // #4348: kanonisk kopi
import { useRealtimeRefetch } from "../hooks/useRealtimeRefetch.js";
import {
  Button, PageHeader, Section, SectionStack, SectionHeader, EmptyState, ErrorState,
  SkeletonLines, Modal, Field, Input, Textarea,
} from "../components/ui";
import { InboxIcon, FlagIcon, BellIcon, BellOffIcon } from "../components/ui/icons/index.jsx";
// #5013: abonnement pr. kategori — samme normalisering som indstillingerne.
import {
  normalizeCategoryMutes, applyCategoryMute, isCategoryMuted, isSubscribableCategory,
} from "../lib/forumCategoryMutes.js";
import FounderMark from "../components/FounderMark.jsx";
// #4819: billeder i indlaegget. Uploades FOER submit, se komponentens hoved.
import ForumImagePicker from "../components/forum/ForumImagePicker.jsx";
// #4751: datoformatteren bor nu i det delte forum-modul (en side skal ikke
// vaere kilde for en komponent — ForumAuthorIdentity bruger den samme).
import { formatForumDate, authorDisplayName } from "../components/forum/forumIdentity.js";
// #5011: navneforslag mens man skriver "@..." i det nye opslags brødtekst.
import MentionAutocomplete from "../components/forum/MentionAutocomplete.jsx";
// #5000: samme relativ-tid-formatter som dashboardets ForumHighlightsCard —
// "seneste svar" skal laese ens de to steder det staar.
import { formatRelativeTime } from "../lib/intl.js";
// #5159 (B1): et usendt opslag er ugemt arbejde som et deploy ikke maa kassere.
import { useReloadBlock, RELOAD_BLOCK_REASONS } from "../lib/reloadGate.js";
// #4818: kategori-raekkefoelge + skrive-rettigheder. Reglerne bor i modulet,
// ikke her, saa de kan koeres under `node --test` (forumCategories.test.js).
import {
  FORUM_CATEGORY_ORDER,
  isAdminOnlyCategory,
  postableForumCategories,
  showsNewThreadButton,
} from "../components/forum/forumCategories.js";

// #3199 — Forum v1 (plan låst 6/8): to kategorier (General · Feedback & ideas),
// opslag + svar-tråde, ejer-opslag kan pinnes og bære afstemninger. T1 standard
// content (docs/design/PAGE_TEMPLATES.md): max-w-4xl, sektionskort, én gold
// primary ("New post"), hairline-borders, tabular figures på al numerik.
//
// #4492 (ejer-beslutning 4/9): fire nye kategorier (questions, tactics,
// transfers, off_topic) + en "archive"-fane. Archive er IKKE en postable
// kategori — den er kun et filter (backend beregner den ud fra 60 dages
// inaktivitet), så compose-modalens vælger og FILTER_TABS (oversigtens
// fanerække) er bevidst to forskellige lister.
//
// #4818 (ejer-direktiv 4/9 + afklaring 8/9): "roadmap" ligger øverst i
// fanerækken og er den første kategori med en skrive-rettighed — kun ejeren
// opretter tråde der, alle svarer. Fladen SKJULER bare knappen og siger
// hvorfor; den rigtige gate sidder i backend (403) og i databasen (trigger).
//
// Data læses via backend-API (service-role bag requireAuth) — RLS på
// forum-tabellerne tillader ikke klient-queries til andet end Realtime-events,
// som her kun bruges som refetch-trigger (useRealtimeRefetch-mønstret).

const API = import.meta.env.VITE_API_URL;
const ARCHIVE_FILTER = "archive";
const FILTER_TABS = [...FORUM_CATEGORY_ORDER, ARCHIVE_FILTER];
const TITLE_MAX = 120;
const BODY_MAX = 4000;
// Modul-konstant: en inline-array ville re-subscribe Realtime-kanalen hver render.
const FORUM_TABLES = ["forum_posts", "forum_replies"];

function PostRow({ post, t, language }) {
  return (
    <Link
      to={`/forum/${post.id}`}
      className="block py-[13px] transition-colors hover:bg-cz-subtle -mx-2 px-2"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          {/* #4118/#3451: gul prik — samme markup/farve som nav-prikken
              (Layout.jsx), ikke et nyt visuelt sprog. Kun dekorativ; den
              egentlige "ulæst"-status kommunikeres til skærmlæsere via
              sr-only-teksten. */}
          {post.is_unread && (
            <span className="flex-shrink-0" title={t("list.unread")}>
              <span aria-hidden="true" className="block h-2 w-2 rounded-full bg-cz-accent" />
              <span className="sr-only">{t("list.unread")}</span>
            </span>
          )}
          <span className={`min-w-0 truncate text-[13.5px] text-cz-1 ${post.is_unread ? "font-semibold" : "font-medium"}`}>
            {post.title}
          </span>
        </span>
        {/* #5000: svar- og visningstal staar samme sted — begge er "hvor meget
            liv er der i traaden", og tabular figures holder kolonnen i ro. */}
        <span className="shrink-0 whitespace-nowrap font-data text-2xs tabular-nums text-cz-3">
          {t("list.replies", { count: post.reply_count })}
          {" · "}
          {t("stats.views", { count: post.view_count ?? 0 })}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 font-data text-2xs uppercase tracking-[.04em] text-cz-3">
        {post.is_pinned && <span className="text-cz-accent-t">{t("post.pinnedTag")}</span>}
        {post.has_poll && <span className="text-cz-accent-t">{t("list.poll")}</span>}
        <span className="truncate">
          {t("list.by", { name: authorDisplayName(post.author) })}
        </span>
        {/* #4649: Founder-mærke ved forfatterlinjen. */}
        <FounderMark teamId={post.author?.team_id} />
        <span>·</span>
        <span>{t(`categories.${post.category}`)}</span>
      </div>
      {/* #5000 (ejer-bestilling 7/9): tiden staar paa sin EGEN linje, fordi
          seneste svars forfatter + relativ tid ikke kan vaere paa metalinjen
          uden at klemme forfatternavnet ned til "BY ..." paa 390px (TASTE P10
          — maalt paa screenshot, ikke gaettet). Har traaden svar, er trådens
          oprettelses-dato desuden ikke laengere den interessante tid: de to
          udelukker hinanden med vilje, saa raekken aldrig baerer to datoer. */}
      <div className="mt-0.5 font-data text-2xs uppercase tracking-[.04em] text-cz-3">
        {post.last_reply_author ? (
          <span className="block truncate">
            {t("stats.lastReply", {
              name: authorDisplayName(post.last_reply_author),
              time: formatRelativeTime(post.last_reply_at || post.created_at),
            })}
          </span>
        ) : (
          <span className="tabular-nums">{formatForumDate(post.created_at, language)}</span>
        )}
      </div>
    </Link>
  );
}

function ComposeModal({ open, onClose, onCreated, isAdmin, userId, defaultCategory, t, tError }) {
  // #4818: vælgeren viser kun kategorier brugeren faktisk må oprette i — en
  // synlig-men-afvist knap er et dødt klik. useMemo fordi listen indgår i
  // effektens deps; en ny array pr. render ville køre effekten hver gang.
  const choices = useMemo(() => postableForumCategories({ isAdmin }), [isAdmin]);
  const [category, setCategory] = useState(choices[0]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [images, setImages] = useState([]);
  // Submit gates paa dette: et upload der stadig koerer ville ellers blive
  // sendt afsted som "ingen billeder".
  const [uploadingImage, setUploadingImage] = useState(false);
  const [pollText, setPollText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Åbnes modalen fra "All", arkivet eller en fane brugeren ikke må skrive
    // i, falder valget tilbage til den første lovlige kategori.
    if (open) setCategory(choices.includes(defaultCategory) ? defaultCategory : choices[0]);
  }, [open, defaultCategory, choices]);

  // #5159 (B1): et halvskrevet opslag findes KUN i denne komponents state indtil
  // POST'en er igennem — et release-drevet reload ville kassere det uden en lyd.
  // Blokeringen slippes af sig selv: `handleClose` rydder felterne, og en
  // gennemført submit kalder netop den. Genbruger de state-felter der allerede
  // fandtes; ingen ny tilstand.
  useReloadBlock(
    Boolean(open && (title || body || pollText || images.length > 0)),
    RELOAD_BLOCK_REASONS.DIRTY,
  );
  useReloadBlock(Boolean(submitting || uploadingImage), RELOAD_BLOCK_REASONS.BUSY);

  function handleClose() {
    // Ogsaa `uploadingImage`: lukkede man mens et upload koerte, ryddede
    // timeouten nedenfor `images`, hvorefter pickerens `onChange(next)` efter
    // sit await skrev billedet TILBAGE i den stadig monterede modal — og et
    // senere opslag fik en vedhaeftning brugeren havde fortrudt. Modal'ens
    // onClose er den her, saa X, backdrop og Escape er daekket af samme vagt.
    if (submitting || uploadingImage) return;
    onClose?.();
    setTimeout(() => {
      setTitle("");
      setBody("");
      // Billederne er allerede uploadet; naar modalen lukkes uden at sende,
      // bliver de foraeldreloese og ryddes af sweep-scriptet.
      setImages([]);
      setPollText("");
      setError(null);
    }, 200);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const headers = await authHeaders();
      if (!headers || !API) {
        setError(t("errors.submitFailed"));
        return;
      }
      const pollOptions = pollText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const res = await fetch(`${API}/api/forum/posts`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          category,
          title: title.trim(),
          body: body.trim(),
          images,
          ...(isAdmin && pollOptions.length ? { poll_options: pollOptions } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(tError(data?.errorCode));
        return;
      }
      handleClose();
      onCreated?.(data?.id);
    } catch {
      setError(t("errors.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} size="md" ariaLabelledby="forum-compose-title">
      <div className="mb-4">
        <h2 id="forum-compose-title" className="font-display text-2xl leading-none tracking-[.01em] text-cz-1">
          {t("compose.title")}
        </h2>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t("compose.categoryLabel")}>
          {/* #4492: 5 kategorier passer ikke altid på én linje (mobil,
              lange labels som "Questions & answers") — flex-wrap frem for
              det gamle inline-flex+overflow-hidden segment, der ville
              klippe knapper af i stedet for at brydes om. */}
          <div role="group" aria-label={t("compose.categoryLabel")} className="flex flex-wrap gap-1.5">
            {choices.map((key) => (
              <button
                key={key}
                type="button"
                disabled={submitting}
                onClick={() => setCategory(key)}
                aria-pressed={category === key}
                className={`rounded-cz border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                  category === key
                    ? "border-cz-accent bg-cz-accent text-cz-on-accent"
                    : "border-cz-border text-cz-2 hover:bg-cz-subtle"
                }`}
              >
                {t(`categories.${key}`)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t("compose.titleLabel")} htmlFor="forum-compose-titel">
          <Input
            id="forum-compose-titel"
            value={title}
            disabled={submitting}
            maxLength={TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("compose.titlePlaceholder")}
          />
        </Field>
        <Field label={t("compose.bodyLabel")} htmlFor="forum-compose-body">
          <Textarea
            id="forum-compose-body"
            rows={6}
            value={body}
            disabled={submitting}
            maxLength={BODY_MAX}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("compose.bodyPlaceholder")}
          />
        </Field>
        {/* #5011: hører til body-feltet ovenfor (monteres via textareaId, panelet
            er `fixed`), derfor lige efter det og før billedvælgeren. */}
        <MentionAutocomplete textareaId="forum-compose-body" value={body} onChange={setBody} t={t} />
        <Field label={t("images.label")}>
          <ForumImagePicker
            images={images}
            onChange={setImages}
            onBusyChange={setUploadingImage}
            // #4819 review: uden userId dropper pickeren filen tavst (den
            // nulstiller inputtet og returnerer), saa knappen er slaaet fra
            // indtil supabase.auth.getUser() er landet.
            disabled={submitting || !userId}
            userId={userId}
            t={t}
          />
        </Field>
        {isAdmin && (
          <Field label={t("compose.pollLabel")} htmlFor="forum-compose-poll" helper={t("compose.pollHelp")}>
            <Textarea
              id="forum-compose-poll"
              rows={3}
              value={pollText}
              disabled={submitting}
              onChange={(e) => setPollText(e.target.value)}
            />
          </Field>
        )}
        {error && <p className="text-xs text-cz-danger">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={handleClose} disabled={submitting || uploadingImage}>
            {t("compose.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="sm" loading={submitting} disabled={submitting || uploadingImage}>
            {t("compose.submit")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function ForumPage() {
  const { t, i18n } = useTranslation("forum");
  const { t: tErrors } = useTranslation("errors");
  const [searchParams, setSearchParams] = useSearchParams();
  const category = FILTER_TABS.includes(searchParams.get("category")) ? searchParams.get("category") : "";

  const [state, setState] = useState({ status: "loading", pinned: [], items: [], nextCursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  // #4819: billed-stien ER ejerskabet (`<user_id>/...`), saa vaelgeren skal
  // kende brugerens id for at kunne uploade i sin egen mappe.
  const [userId, setUserId] = useState(null);
  // #3451: "Markér alle som læst" — sekundær knap (gold er reserveret til
  // "New post"), samme markingAll/loading-mønster som NotificationsPage.
  const [markingAll, setMarkingAll] = useState(false);
  const [markAllError, setMarkAllError] = useState(null);

  const tError = useCallback(
    (code) => (code && i18n.exists(`errors:api.${code}`) ? tErrors(`api.${code}`) : t("errors.submitFailed")),
    [i18n, tErrors, t]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      setUserId(user.id);
      const { data: userData } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
      if (!cancelled) setIsAdmin(userData?.role === "admin");
    })();
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async (cursor = null) => {
    if (cursor == null) setState((s) => ({ ...s, status: s.items.length ? "ready" : "loading" }));
    try {
      const headers = await authHeaders();
      if (!headers || !API) throw new Error("no session");
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (cursor != null) params.set("cursor", String(cursor));
      const res = await fetch(`${API}/api/forum/posts?${params}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setState((s) => ({
        status: "ready",
        pinned: cursor == null ? data.pinned || [] : s.pinned,
        items: cursor == null ? data.items || [] : [...s.items, ...(data.items || [])],
        nextCursor: data.next_cursor ?? null,
      }));
    } catch {
      setState((s) => (cursor == null ? { status: "error", pinned: [], items: [], nextCursor: null } : s));
    }
  }, [category]);

  useEffect(() => { load(null); }, [load]);

  // #3451: "Markér alle som læst" skal vises ud fra det SAMME globale signal
  // som nav-prikken (GET /api/forum/unread-status) — ikke den kategori-
  // filtrerede/paginerede liste, som aldrig ser tråde uden for aktuel fane/
  // side. Samme fetch-recipe som Layout.jsx's fetchForumUnread.
  const [hasUnread, setHasUnread] = useState(false);
  const refreshUnread = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers || !API) return;
    try {
      const res = await fetch(`${API}/api/forum/unread-status`, { headers });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (typeof data?.has_unread === "boolean") setHasUnread(data.has_unread);
    } catch { /* ignore — prikken/knappen beholder sidst kendte tilstand */ }
  }, []);
  useEffect(() => { refreshUnread(); }, [refreshUnread]);

  // #5013: abonnement pr. kategori. Hentes ÉN gang (ikke pr. fane-skift) —
  // valget er globalt for brugeren, ikke en egenskab ved den viste liste.
  const [categoryMutes, setCategoryMutes] = useState(() => normalizeCategoryMutes(null));
  const [savingMute, setSavingMute] = useState(false);
  const [muteError, setMuteError] = useState(null);
  // Har spilleren allerede rørt en kategori? Så er hans valg nyere end det
  // svar der er på vej, og et langsomt GET må ikke rulle det tilbage: knappen
  // ville stå på "Følger" mens serveren havde gemt det modsatte (CodeRabbit).
  const mutesTouchedRef = useRef(false);
  // Den fane man står på LIGE NU. Læses efter et await, hvor `category` fra
  // render-lukningen kan være forældet.
  const activeCategoryRef = useRef(category);
  useEffect(() => { activeCategoryRef.current = category; }, [category]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const headers = await authHeaders();
      if (!headers || !API) return;
      try {
        const res = await fetch(`${API}/api/forum/category-mutes`, { headers });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (!cancelled && !mutesTouchedRef.current) setCategoryMutes(normalizeCategoryMutes(data));
      } catch { /* ignore — listen falder til "følger alt", aldrig til dæmpet */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const refetch = useCallback(() => { load(null); refreshUnread(); }, [load, refreshUnread]);
  useRealtimeRefetch("forum-live", FORUM_TABLES, refetch);

  async function handleLoadMore() {
    if (state.nextCursor == null || loadingMore) return;
    setLoadingMore(true);
    await load(state.nextCursor);
    setLoadingMore(false);
  }

  function setCategoryParam(next) {
    setSearchParams(next ? { category: next } : {}, { replace: true });
  }

  async function handleMarkAllRead() {
    if (markingAll) return;
    setMarkingAll(true);
    setMarkAllError(null);
    try {
      const headers = await authHeaders();
      if (!headers || !API) throw new Error("no session");
      const res = await fetch(`${API}/api/forum/threads/read-all`, { method: "PATCH", headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Klar prikken lokalt med det samme (ikke reload) — samme
      // is_unread-felt PostRow allerede læser.
      setState((s) => ({
        ...s,
        pinned: s.pinned.map((p) => ({ ...p, is_unread: false })),
        items: s.items.map((p) => ({ ...p, is_unread: false })),
      }));
      setHasUnread(false);
      // Samme window-event som ForumPostPage bruger, så Layout.jsx's
      // nav-prik forsvinder MED DET SAMME i stedet for at vente på næste
      // heartbeat/realtime-tick.
      window.dispatchEvent(new Event("cz:forum-thread-read"));
    } catch {
      setMarkAllError(t("errors.markAllReadFailed"));
    } finally {
      setMarkingAll(false);
    }
  }

  // #5013: til/fra for den kategori man STÅR i. `muted: true` = spilleren
  // følger ikke længere kategorien. Optimistisk: tilstanden skifter med det
  // samme og rulles tilbage hvis kaldet fejler, så knappen aldrig står og
  // lyver om et valg der ikke blev gemt.
  async function handleToggleCategoryMute(nextMuted) {
    if (savingMute || !isSubscribableCategory(category)) return;
    // Kategorien FANGES her: skifter spilleren fane mens PUT'en er undervejs,
    // hører både kaldet og den efterfølgende reload stadig til den kategori
    // han faktisk klikkede på.
    const target = category;
    const previous = categoryMutes;
    mutesTouchedRef.current = true;
    setSavingMute(true);
    setMuteError(null);
    setCategoryMutes(applyCategoryMute(previous, target, nextMuted));
    try {
      const headers = await authHeaders();
      if (!headers || !API) throw new Error("no session");
      const res = await fetch(`${API}/api/forum/category-mutes`, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ category: target, muted: nextMuted }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Ulæst-markeringerne og nav-prikken afledes af valget på backend —
      // hent dem igen, i stedet for at gætte lokalt hvilke prikker der falder.
      // Trådlisten genindlæses kun hvis man stadig står på samme fane: `load`
      // er bundet til kategorien fra dette render og ville ellers skrive den
      // gamle kategoris tråde ind over den nye fane (CodeRabbit).
      await (activeCategoryRef.current === target
        ? Promise.all([load(null), refreshUnread()])
        : refreshUnread());
      window.dispatchEvent(new Event("cz:forum-thread-read"));
    } catch {
      setCategoryMutes(previous);
      setMuteError(t("subscription.saveFailed"));
    } finally {
      setSavingMute(false);
    }
  }

  const language = i18n.language;
  const isArchiveTab = category === ARCHIVE_FILTER;
  const showSubscriptionControl = isSubscribableCategory(category);
  const currentCategoryMuted = isCategoryMuted(categoryMutes, category);
  // #4818: den officielle kategori bærer et flag-ikon i fanen (stroke, aldrig
  // emoji) og et "Official"-meta-label over listen — samme signal begge steder.
  const isAdminOnlyTab = isAdminOnlyCategory(category);
  const showsCompose = showsNewThreadButton(category, { isAdmin });
  const tabs = [
    { key: "", label: t("categories.all") },
    ...FORUM_CATEGORY_ORDER.map((key) => ({
      key,
      label: t(`categories.${key}`),
      official: isAdminOnlyCategory(key),
    })),
    { key: ARCHIVE_FILTER, label: t("categories.archive") },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title={t("page.title")}
        subtitle={t("page.subtitle")}
        actions={
          <>
            {/* #3451: sekundær — gold er reserveret til "New post" herunder. Kun
                synlig når der rent faktisk er ulæste tråde (samme signal som
                nav-prikken den skal fjerne). */}
            {hasUnread && (
              <Button variant="secondary" size="sm" onClick={handleMarkAllRead}
                loading={markingAll} disabled={markingAll}>
                {markingAll ? t("page.markingAllRead") : t("page.markAllRead")}
              </Button>
            )}
            {/* #4818: på en admin-only fane har en ikke-admin intet at trykke
                på — knappen fjernes helt og erstattes af forklaringen under
                fanerækken, i stedet for at stå og afvise klik. */}
            {showsCompose && (
              <Button variant="primary" size="sm" onClick={() => setComposeOpen(true)}>
                {t("page.newPost")}
              </Button>
            )}
          </>
        }
      />
      {markAllError && (
        <p role="alert" className="mb-4 text-xs text-cz-danger">{markAllError}</p>
      )}

      {/* #4818: Roadmap er den 9. fane, og 8 var praecis hvad der kunne vaere
          paa 896px (T1). Paa desktop bryder raekken derfor nu om i stedet for
          at skjule Off-topic + Arkiv bag en usynlig vandret scroll — samme valg
          som compose-modalens vaelger traf i #4492. Paa mobil beholder vi
          scrollen: der ville ombrydning give fire raekker faner over indholdet. */}
      <nav
        className="mb-6 flex gap-1 border-b border-cz-border overflow-x-auto md:flex-wrap md:overflow-x-visible"
        aria-label={t("compose.categoryLabel")}
      >
        {tabs.map((tab) => (
          <button
            key={tab.key || "all"}
            type="button"
            onClick={() => setCategoryParam(tab.key)}
            aria-current={category === tab.key ? "page" : undefined}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              category === tab.key
                ? "border-cz-accent text-cz-1"
                : "border-transparent text-cz-3 hover:text-cz-2"
            }`}
          >
            {tab.official && <FlagIcon size={12} aria-hidden="true" className="me-1.5 inline-block align-[-1px]" />}
            {tab.label}
          </button>
        ))}
      </nav>

      {/* #4818: kort linje i ejerens egen stemme (docs/TONE_OF_VOICE.md — jeg,
          aldrig vi). Beskrivelsen af kategorien står for alle; reglen ("kun jeg
          slår op her") kun for dem der ikke selv kan slå op — for ejeren står
          knappen der i stedet, og linjen ville sige ham noget han ved. */}
      {isAdminOnlyTab && (
        <p className="mb-6 -mt-2 flex items-center gap-1.5 text-[13px] text-cz-2">
          <FlagIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />
          <span>
            {t("adminOnly.description")}
            {!showsCompose && <span className="text-cz-3"> {t("adminOnly.notice")}</span>}
          </span>
        </p>
      )}

      {/* #5013 · Kategori-hoved: navnet på den valgte kategori + til/fra for
          "sig til når der er nyt her". Vises kun på en rigtig kategori — ikke
          på "All" (intet at abonnere på) og ikke på arkivet (et visnings-
          filter på tværs af kategorier, #4492). Sekundær knap: gold er
          reserveret til "New post". */}
      {showSubscriptionControl && (
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-cz-border pb-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-cz-1">{t(`categories.${category}`)}</h2>
            <p className="mt-0.5 text-xs leading-snug text-cz-3">
              {currentCategoryMuted ? t("subscription.mutedHint") : t("subscription.followingHint")}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            aria-pressed={!currentCategoryMuted}
            data-testid="forum-category-subscription-toggle"
            loading={savingMute}
            disabled={savingMute}
            onClick={() => handleToggleCategoryMute(!currentCategoryMuted)}
            iconLeft={currentCategoryMuted
              ? <BellOffIcon size={15} aria-hidden="true" />
              : <BellIcon size={15} aria-hidden="true" />}
          >
            {currentCategoryMuted ? t("subscription.muted") : t("subscription.following")}
          </Button>
        </div>
      )}
      {muteError && (
        <p role="alert" className="mb-4 text-xs text-cz-danger">{muteError}</p>
      )}

      {state.status === "loading" ? (
        <Section><SkeletonLines lines={6} /></Section>
      ) : state.status === "error" ? (
        <Section role="alert">
          <ErrorState
            description={t("errors.loadFailed")}
            action={<Button size="sm" variant="secondary" onClick={() => load(null)}>{t("errors.retry")}</Button>}
          />
        </Section>
      ) : (
        <SectionStack>
          {state.pinned.length > 0 && (
            <Section>
              <SectionHeader title={t("list.pinnedHeading")} />
              <div className="divide-y divide-cz-border">
                {state.pinned.map((post) => (
                  <PostRow key={post.id} post={post} t={t} language={language} />
                ))}
              </div>
            </Section>
          )}
          <Section>
            <SectionHeader
              title={isArchiveTab ? t("list.archiveHeading") : t("list.latestHeading")}
              meta={isAdminOnlyTab ? t("adminOnly.tag") : null}
            />
            {state.items.length === 0 && state.pinned.length === 0 ? (
              <EmptyState
                icon={isAdminOnlyTab ? <FlagIcon size={26} aria-hidden="true" /> : <InboxIcon size={26} aria-hidden="true" />}
                title={isArchiveTab ? t("list.archiveEmptyTitle") : t("list.emptyTitle")}
                // #4818: "Be the first to start a conversation" er forkert i en
                // kategori hvor spilleren ikke MÅ starte noget.
                description={
                  isArchiveTab
                    ? t("list.archiveEmptyDescription")
                    : isAdminOnlyTab && !showsCompose
                      ? t("adminOnly.emptyDescription")
                      : t("list.emptyDescription")
                }
              />
            ) : state.items.length === 0 ? (
              <p className="py-2 text-[13px] text-cz-2">
                {isArchiveTab
                  ? t("list.archiveEmptyDescription")
                  : isAdminOnlyTab && !showsCompose
                    ? t("adminOnly.emptyDescription")
                    : t("list.emptyDescription")}
              </p>
            ) : (
              <div className="divide-y divide-cz-border">
                {state.items.map((post) => (
                  <PostRow key={post.id} post={post} t={t} language={language} />
                ))}
              </div>
            )}
            {state.nextCursor != null && (
              <div className="mt-4 flex justify-center">
                <Button variant="secondary" size="sm" onClick={handleLoadMore} loading={loadingMore} disabled={loadingMore}>
                  {t("list.loadMore")}
                </Button>
              </div>
            )}
          </Section>
        </SectionStack>
      )}

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onCreated={() => load(null)}
        isAdmin={isAdmin}
        userId={userId}
        defaultCategory={category}
        t={t}
        tError={tError}
      />
    </div>
  );
}
