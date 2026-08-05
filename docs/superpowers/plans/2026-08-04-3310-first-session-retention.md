# Første-sessions-retention (comeback-buen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Byg landings-øjeblikket "Your first race" + beskedkæden med deep-links (spec: `docs/superpowers/specs/2026-08-04-first-session-retention-design.md`, Refs #3310).

**Architecture:** Ren genbrug: dashboardets `MyLatestResultCard` får en gated første-løbs-variant og rykker øverst; `race_result`-notifikationen får en første-resultat-copy-variant (samme type); `selection_warning` får sin manglende UI-entry + Auto-select-knap; day-1-mailen deep-linker (forbliver dormant). Ingen migrationer, ingen nye notifikationstyper, ingen nye sider.

**Tech Stack:** React+Vite (`frontend/`), Node+Express (`backend/`), i18next (`frontend/public/locales/{en,da}/*.json`), node --test begge pakker, Playwright e2e.

**Forudsætninger ved execution-start:** `docs/NOW.md` 🤖-claim er sat (denne session) · branch fra `origin/main`: `git fetch origin && git checkout -b feat/3310-first-session-retention origin/main` · verificér branch i SAMME kommandokæde som hvert commit: `b=$(git branch --show-current) && [ "$b" = "feat/3310-first-session-retention" ] && git commit ...` · commit-beskeder via `git commit -F <fil>` (aldrig heredoc) · **UI-merge kræver ejerens visuelle godkendelse på preview/screenshots FØR merge.**

---

### Task 1: Backend — første-resultat-copy-variant i `emitRaceResultNotifications`

**Files:**
- Modify: `backend/lib/notificationService.js:260-302` (emit-loopet) + ny helper under `defaultFetchParticipatingManagers` (linje ~310)
- Test: `backend/lib/notificationService.test.js` (recorder-mønster, se linje 177-228)

Dedup-note: dedup-nøglen er (type, title, message, related_id) i 24 t — en anden title/message for førstegangsbrugere kolliderer ikke med standard-beskeden.

- [ ] **Step 1: Skriv fejlende tests** — i `notificationService.test.js`, genbrug `makeRaceNotifyRecorder` (linje 177-184):

```js
test("emitRaceResultNotifications bruger første-resultat-copy for førstegangs-managere", async () => {
  const { notify, calls } = makeRaceNotifyRecorder();
  await emitRaceResultNotifications({
    supabase: {},
    race: { id: "race-9", name: "Vuelta a Castilla" },
    notify,
    fetchParticipatingManagers: async () => ["user-first", "user-vet"],
    fetchFirstTimeManagers: async () => new Set(["user-first"]),
  });
  const first = calls.find((c) => c.userId === "user-first");
  const vet = calls.find((c) => c.userId === "user-vet");
  assert.equal(first.metadata.titleCode, "notif.firstRaceResult.title");
  assert.equal(first.metadata.messageCode, "notif.firstRaceResult.message");
  assert.match(first.title, /first race/i);
  assert.match(first.message, /Vuelta a Castilla/);
  assert.equal(first.relatedId, "race-9");
  assert.equal(vet.metadata.titleCode, "notif.raceResult.title");
  assert.equal(vet.title, "Race result is in");
});

test("defaultFetchFirstTimeManagers: manager uden andre resultater er first-timer", async () => {
  const supabase = makeFirstTimeSupabase({
    teams: [{ id: "t1", user_id: "user-first" }, { id: "t2", user_id: "user-vet" }],
    otherResults: [{ team_id: "t2" }],
  });
  const set = await defaultFetchFirstTimeManagers({
    supabase, race: { id: "race-9" }, userIds: ["user-first", "user-vet"],
  });
  assert.deepEqual([...set], ["user-first"]);
});

test("defaultFetchFirstTimeManagers: fejl → tomt sæt (alle får standard-copy)", async () => {
  const supabase = makeFirstTimeSupabase({ teamsError: new Error("boom") });
  const set = await defaultFetchFirstTimeManagers({
    supabase, race: { id: "race-9" }, userIds: ["u1"],
  });
  assert.equal(set.size, 0);
});
```

`makeFirstTimeSupabase` er en lille lokal fixture i testfilen (samme stil som `createNotificationSupabase`, linje 20-111): mock af `.from("teams").select("id, user_id").in("user_id", ...)` og `.from("race_results").select("team_id").in("team_id", ...).neq("race_id", ...)` der returnerer de konfigurerede data/fejl.

- [ ] **Step 2: Kør tests — forventet FAIL**

Run: `cd backend && node --test --test-name-pattern "first" lib/notificationService.test.js`
Expected: FAIL (`defaultFetchFirstTimeManagers is not defined` / titleCode-assert fejler)

- [ ] **Step 3: Implementér** — i `notificationService.js`:

```js
// #3310 comeback-buen: hvilke af løbets deltagende managere fik her deres
// FØRSTE resultat? Første = holdets eneste race_results-løb er netop dette.
// Fejl degraderer til tomt sæt: alle får standard-copy, ingen notifikation tabes.
export async function defaultFetchFirstTimeManagers({ supabase, race, userIds }) {
  if (!userIds?.length) return new Set();
  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id, user_id")
    .in("user_id", userIds);
  if (teamsError || !teams?.length) return new Set();
  const { data: other, error: otherError } = await supabase
    .from("race_results")
    .select("team_id")
    .in("team_id", teams.map((t) => t.id))
    .neq("race_id", race.id);
  if (otherError) return new Set();
  const veteranTeamIds = new Set((other ?? []).map((r) => r.team_id));
  return new Set(teams.filter((t) => !veteranTeamIds.has(t.id)).map((t) => t.user_id));
}
```

I `emitRaceResultNotifications` (linje 260-302): tilføj `fetchFirstTimeManagers = defaultFetchFirstTimeManagers` til signaturen; efter manager-listen er hentet og de-dup'et: `const firstTimers = await fetchFirstTimeManagers({ supabase, race, userIds });` og i loopet:

```js
const isFirst = firstTimers.has(userId);
// ...eksisterende notify-kald, med:
title: isFirst ? "Your first race is in the books" : "Race result is in",
message: isFirst
  ? `${raceName} has been run. See how your riders did.`
  : `${raceName} has been run. View the result.`,
relatedId: race.id,
metadata: {
  raceId: race.id,
  titleCode: isFirst ? "notif.firstRaceResult.title" : "notif.raceResult.title",
  titleParams: {},
  messageCode: isFirst ? "notif.firstRaceResult.message" : "notif.raceResult.message",
  messageParams: { race: raceName },
},
```

- [ ] **Step 4: Kør tests — forventet PASS** (samme kommando + hele filen: `cd backend && node --test lib/notificationService.test.js`)

- [ ] **Step 5: Commit** — `fix(notifications): foerste-resultat-copy-variant paa race_result (Refs #3310)`

### Task 2: backendMessages-i18n for de nye codes

**Files:**
- Modify: `frontend/public/locales/en/backendMessages.json` + `frontend/public/locales/da/backendMessages.json` (verificér filnavn i step 1)

- [ ] **Step 1: Verificér namespace-fil**

Run: `grep -rl "notif.raceResult.title" frontend/public/locales/en/`
Expected: én fil (forventet `backendMessages.json`) — brug den fil begge sprog.

- [ ] **Step 2: Tilføj nøgler** ved siden af de eksisterende `notif.raceResult.*` (samme flade struktur som filen bruger):

EN: `"notif.firstRaceResult.title": "Your first race is in the books"` · `"notif.firstRaceResult.message": "{race} has been run. See how your riders did."`
DA: `"notif.firstRaceResult.title": "Dit første løb er kørt"` · `"notif.firstRaceResult.message": "{race} er kørt. Se hvordan dine ryttere klarede sig."`

- [ ] **Step 3: Kør i18n-paritet** — Run: `node scripts/i18n-check-keys.mjs` · Expected: exit 0

- [ ] **Step 4: Commit** — `feat(i18n): notif.firstRaceResult en+da (Refs #3310)`

### Task 3: `selection_warning` får UI-entry + deep-link

**Files:**
- Modify: `frontend/src/pages/NotificationsPage.jsx` (TYPE_CONFIG linje 39-78 + klik-handler linje 511-538)
- Test: `frontend/src/pages/NotificationsPage.stageResultLink.test.js` (udvid source-guard-testen)

- [ ] **Step 1: Verificér payload** — Run: `grep -n "selection_warning" backend/lib/*.js backend/cron.js | head -20` og læs sweep-koden: bekræft at notifikationen sætter `related_id`/`metadata.raceId` = løbets id. Hvis IKKE: tilføj det i sweepen først (samme mønster som `emitRaceResultNotifications`, Task 1 step 3) med en test.

- [ ] **Step 2: Skriv fejlende source-test** — i `NotificationsPage.stageResultLink.test.js`, samme readFileSync+regex-mønster som de eksisterende to assertions:

```js
test("selection_warning har TYPE_CONFIG-entry med kalender-fallback", () => {
  assert.match(src, /selection_warning:\s*\{[^}]*link: "\/planning\?tab=calendar"/);
});

test("selection_warning deep-linker til løbets selection-anker", () => {
  assert.match(src, /selection_warning[\s\S]{0,120}\/races\/\$\{[^}]+\}#selection/);
});
```

- [ ] **Step 3: Kør — forventet FAIL** — Run: `cd frontend && node --test src/pages/NotificationsPage.stageResultLink.test.js`

- [ ] **Step 4: Implementér** — TYPE_CONFIG-entry (efter `race_result`/`stage_result`, brug allerede-importerede ikoner):

```js
// #2180/#3310: 36t-varsel uden manuel udtagelse — deep-link til løbets
// selection-panel; kalender-boardet som fallback uden raceId.
selection_warning:         { Icon: AlertTriangleIcon, color: "text-cz-warning",  bg: "bg-cz-warning/8 border-cz-warning/15", link: "/planning?tab=calendar" },
```

Klik-handler: ny regel EFTER race_result/stage_result-reglen (linje ~527):

```js
} else if (n.type === "selection_warning" && (n.metadata?.raceId || n.related_id)) {
  link = `/races/${n.metadata?.raceId || n.related_id}#selection`;
```

- [ ] **Step 5: Kør — forventet PASS** (samme kommando)

- [ ] **Step 6: Commit** — `feat(notifications): selection_warning UI-entry + deep-link til selection-panelet (Refs #2180, #3310)`

### Task 4: `isFirstRaceMoment`-lib + kort-variant

**Files:**
- Create: `frontend/src/lib/firstRaceMoment.js` + `frontend/src/lib/firstRaceMoment.test.js`
- Modify: `frontend/src/components/MyLatestResultCard.jsx`
- Modify: `frontend/public/locales/{en,da}/dashboard.json` (`cards.myResult.*`)

- [ ] **Step 1: Skriv fejlende test** (`firstRaceMoment.test.js`):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { isFirstRaceMoment } from "./firstRaceMoment.js";

test("false uden race, uden data eller når resultatet er set", () => {
  assert.equal(isFirstRaceMoment(null), false);
  assert.equal(isFirstRaceMoment({ race: null }), false);
  assert.equal(isFirstRaceMoment({ race: { id: 1, seen: true }, history: [] }), false);
});

test("true for uset første resultat uden historik", () => {
  assert.equal(isFirstRaceMoment({ race: { id: 1, seen: false }, history: [], season_totals: { races: 1 } }), true);
  assert.equal(isFirstRaceMoment({ race: { id: 1, seen: false }, history: [], season_totals: null }), true);
});

test("false når der findes tidligere løb", () => {
  assert.equal(isFirstRaceMoment({ race: { id: 2, seen: false }, history: [{ race_id: 1 }], season_totals: { races: 2 } }), false);
  assert.equal(isFirstRaceMoment({ race: { id: 2, seen: false }, history: [], season_totals: { races: 3 } }), false);
});
```

- [ ] **Step 2: Kør — FAIL** — Run: `cd frontend && node --test src/lib/firstRaceMoment.test.js`

- [ ] **Step 3: Implementér** (`firstRaceMoment.js`):

```js
// #3310 comeback-buen: afgør om dashboardet skal vise "Your first race"-varianten.
// Første løb = ingen tidligere løb i historikken OG sæson-totalen tæller højst det
// viste løb (null = RPC ikke anvendt endnu → behandles som muligt-første).
// seen er server-flaget teams.my_result_seen_race_id (#2593 del 2).
export function isFirstRaceMoment(data) {
  const race = data?.race;
  if (!race || race.seen) return false;
  const historyCount = Array.isArray(data.history) ? data.history.length : 0;
  const seasonRaces = data.season_totals?.races;
  return historyCount === 0 && (seasonRaces == null || seasonRaces <= 1);
}
```

- [ ] **Step 4: Kør — PASS**, commit — `feat(dashboard): isFirstRaceMoment-gate (Refs #3310)`

- [ ] **Step 5: i18n-nøgler** i `dashboard.json` under `cards.myResult` (EN/DA — ingen em-dash):

EN: `"firstRaceTitle": "Your first race is in the books"` · `"firstRaceIntro": "Run while you were away. Here is how it went."` · `"firstRaceIntroAt": "Finished {time} while you were away. Here is how it went."` · `"firstRaceCta": "Read the full race story"` · `"firstRaceNext": "Next race: {race}, {count, plural, one {in # day} other {in # days}}"`
DA: `"firstRaceTitle": "Dit første løb er kørt"` · `"firstRaceIntro": "Kørt mens du var væk. Sådan gik det."` · `"firstRaceIntroAt": "Afsluttet {time} mens du var væk. Sådan gik det."` · `"firstRaceCta": "Læs hele løbshistorien"` · `"firstRaceNext": "Næste løb: {race}, {count, plural, one {om # dag} other {om # dage}}"`

- [ ] **Step 6: Kort-varianten** i `MyLatestResultCard.jsx` — nye props `nextRace = null, nextRaceStartAtMs = null, nowMs = null`; importér `isFirstRaceMoment`; i komponent-kroppen: `const firstRaceMoment = isFirstRaceMoment(data);` og `const { t, i18n } = useTranslation([...])` (i18n bruges til tidsformat). Ændringer:

1. Titlen (linje 159): `{firstRaceMoment ? t("dashboard:cards.myResult.firstRaceTitle") : t("dashboard:cards.myResult.title")}`.
2. Top-højre `linkFull`-linket (linje 166-171): skjules i variant: `{race && !firstRaceMoment && (<Link ...>)}` (CTA'en nederst overtager).
3. Intro-linje lige efter header-diven, kun i variant:

```jsx
{firstRaceMoment && race && (
  <p className="text-cz-2 text-xs mb-3">
    {race.last_import
      ? t("dashboard:cards.myResult.firstRaceIntroAt", {
          time: new Date(race.last_import).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" }),
        })
      : t("dashboard:cards.myResult.firstRaceIntro")}
  </p>
)}
```

4. CTA-blok nederst i kortet (efter historik-sektionen, før `</>`) — guld-idiomet fra `TeamSelectionCtaCard.jsx:50-55`:

```jsx
{firstRaceMoment && race && (
  <div className="mt-4 pt-3.5 border-t border-cz-border flex flex-wrap items-center justify-between gap-3">
    <Link
      to={`/races/${race.id}`}
      state={{ from: "dashboard" }}
      className="px-4 py-2 rounded-lg bg-cz-accent text-cz-on-accent text-sm font-semibold hover:opacity-90 transition-opacity"
    >
      {t("dashboard:cards.myResult.firstRaceCta")}
    </Link>
    {nextRace && nextRaceStartAtMs && nowMs && nextRaceStartAtMs > nowMs && (
      <span className="text-xs text-cz-3">
        {t("dashboard:cards.myResult.firstRaceNext", {
          race: nextRace.name,
          count: Math.max(1, Math.ceil((nextRaceStartAtMs - nowMs) / 86400000)),
        })}
      </span>
    )}
  </div>
)}
```

- [ ] **Step 7: Verifikation** — Run: `node scripts/i18n-check-keys.mjs && cd frontend && node --test && npm run lint`
Expected: alle exit 0. Commit — `feat(dashboard): Your first race-variant af MyLatestResultCard (Refs #3310)`

### Task 5: Dashboard-rækkefølge + CTA-nedgradering

**Files:**
- Modify: `frontend/src/pages/DashboardPage.jsx` (linje ~665, 732-734, 872-887)
- Modify: `frontend/src/components/TeamSelectionCtaCard.jsx` (linje 50-55)

- [ ] **Step 1: `primary`-prop på TeamSelectionCtaCard** — signatur `({ nextRace, startAtMs, nowMs, primary = true })`; CTA-klassen:

```jsx
className={`flex-shrink-0 self-start sm:self-auto px-4 py-2 rounded-lg text-sm font-semibold ${
  primary
    ? "bg-cz-accent text-cz-on-accent hover:opacity-90 transition-opacity"
    : "border border-cz-border bg-transparent text-cz-1 hover:border-cz-3 transition-colors"
}`}
```

- [ ] **Step 2: DashboardPage-wiring** — importér `isFirstRaceMoment`; ved de andre afledninger (linje ~665): `const firstRaceMomentActive = myLatestResultVisible && isFirstRaceMoment(myLatestResult);`

FØR onboarding-blokken (linje 732) indsættes variant-instansen; onboarding-kortet nedtones; original-instansen (884-887) og TeamSelectionCtaCard (872-882) gates:

```jsx
{/* #3310: første-løbs-øjeblikket ejer toppen indtil resultatet er set. */}
{firstRaceMomentActive && (
  <MyLatestResultCard
    data={myLatestResult}
    nextRace={squadSelectionMissingRace}
    nextRaceStartAtMs={squadSelectionMissingRace ? nextStageByRace[squadSelectionMissingRace.id] : null}
    nowMs={nowMs}
  />
)}
{!onboardingDismissed && onboardingIncomplete && (
  <div className={firstRaceMomentActive ? "opacity-75" : undefined}>
    <OnboardingProgressCard progress={onboardingProgress} onDismiss={dismissOnboarding} />
  </div>
)}
```

```jsx
<TeamSelectionCtaCard
  nextRace={squadSelectionMissingRace}
  startAtMs={squadSelectionMissingRace ? nextStageByRace[squadSelectionMissingRace.id] : null}
  nowMs={nowMs}
  primary={!firstRaceMomentActive}
/>
{!firstRaceMomentActive && myLatestResultVisible && <MyLatestResultCard data={myLatestResult} />}
```

- [ ] **Step 3: Verifikation** — Run: `cd frontend && node --test && npm run lint && npx vite build`
Expected: exit 0. Commit — `feat(dashboard): foerste-loebs-varianten oeverst + CTA-nedgradering (Refs #3310)`

### Task 6: Auto-select-knap i selection-panelet

**Files:**
- Modify: `frontend/src/components/race/RaceSelectionPanel.jsx` (knaprække ~500-580; authHeaders-mønster linje 37-42, PUT-mønster linje 200-210)
- Modify: `frontend/public/locales/{en,da}/races.json` (`selection.*`)

- [ ] **Step 1: Verificér endpoint-kontrakt** — Run: `grep -n "selection/auto" backend/routes/api.js` og læs handleren (PR #3280): notér response-shape (forventet: den opdaterede udtagelse eller `{ok:...}`) + fejlkoder.

- [ ] **Step 2: Genbrugelig loader** — panelets eksisterende selection-GET ligger i en `useEffect`; udtræk fetch-kroppen til `const loadSelection = useCallback(async () => { ...eksisterende krop... }, [raceId])` og kald den fra effekten (ren flytning, ingen adfærdsændring).

- [ ] **Step 3: Handler + knap** — ved siden af Save-knappen (linje ~500-507), sekundær stil (aldrig guld nr. 2):

```jsx
const [autoStatus, setAutoStatus] = useState("idle");
async function autoSelect() {
  const headers = await authHeaders();
  if (!headers) return;
  setAutoStatus("loading");
  try {
    const res = await fetch(`${API}/api/races/${raceId}/selection/auto`, { method: "POST", headers });
    if (!res.ok) { setAutoStatus("error"); return; }
    await loadSelection();
    setAutoStatus("idle");
  } catch {
    setAutoStatus("error");
  }
}
```

```jsx
<button
  type="button"
  onClick={autoSelect}
  disabled={autoStatus === "loading"}
  className="px-4 py-2 rounded-lg border border-cz-border bg-transparent text-cz-1 text-sm font-medium hover:border-cz-3 disabled:opacity-40 transition-colors"
>
  {t("selection.autoFill")}
</button>
{autoStatus === "error" && <span className="text-xs text-cz-danger">{t("selection.autoFillError")}</span>}
```

i18n: EN `"autoFill": "Auto-select"`, `"autoFillError": "Could not auto-select. Try again."` · DA `"autoFill": "Auto-udtag"`, `"autoFillError": "Auto-udtag mislykkedes. Prøv igen."`

- [ ] **Step 4: Verifikation** — Run: `node scripts/i18n-check-keys.mjs && cd frontend && node --test && npm run lint`
Expected: exit 0. Commit — `feat(races): Auto-select-knap i selection-panelet (Refs #2180, #3310)`

### Task 7: Day-1-mail deep-linker (dormant)

**Files:**
- Modify: `backend/lib/emailTemplates.js:16-17` (konstanter) + `:119-168` (`buildDay1Email`)
- Modify: `backend/lib/emailDay1Sweep.js:71-77`
- Test: `backend/lib/emailTemplates.test.js:45-65` + `backend/lib/emailDay1Sweep.test.js`

- [ ] **Step 1: Fejlende template-test** (ved de eksisterende buildDay1Email-cases):

```js
test("day1 med latestRaceId deep-linker CTA til løbssiden", () => {
  const t = buildDay1Email({ teamName: "Team X", hasResults: true, latestRaceId: "race-42", unsubscribeUrl: "https://u" });
  assert.ok(t.html.includes("https://cyclingzone.org/races/race-42"));
  assert.ok(t.text.includes("https://cyclingzone.org/races/race-42"));
  assertNoEmDash(t);
  assertHasUnsubscribeLink(t);
});

test("day1 uden latestRaceId falder tilbage til dashboard-URL", () => {
  const t = buildDay1Email({ teamName: "Team X", hasResults: true, latestRaceId: null, unsubscribeUrl: "https://u" });
  assert.ok(t.html.includes("https://cyclingzone.org/dashboard"));
});
```

- [ ] **Step 2: Kør — FAIL** — Run: `cd backend && node --test lib/emailTemplates.test.js`

- [ ] **Step 3: Implementér** — konstant ved linje 16-17: `const RACES_URL = "https://cyclingzone.org/races";` · signatur `buildDay1Email({ teamName, hasResults, latestRaceId = null, unsubscribeUrl })` · i `hasResults: true`-grenen: `const ctaUrl = latestRaceId ? `${RACES_URL}/${latestRaceId}` : DASHBOARD_URL;` og brug `escapeHtml(ctaUrl)` i html-CTA'en (linje 130) + `ctaUrl` i tekst-CTA'en (linje 137). `hasResults: false`-grenen er uændret.

- [ ] **Step 4: Sweep** — i `emailDay1Sweep.js:71-74`: `.select("id, race_id, created_at").eq("team_id", team.id).order("created_at", { ascending: false }).limit(1)`; giv `latestRaceId: rows?.[0]?.race_id ?? null` videre til `buildDay1Email` (linje 77). Udvid `makeSupabase`-mocken i `emailDay1Sweep.test.js` til at levere `race_id` pr. hold + én test: html indeholder `/races/<id>` når resultat findes.

- [ ] **Step 5: Kør — PASS** — Run: `cd backend && node --test lib/emailTemplates.test.js lib/emailDay1Sweep.test.js`
Commit — `feat(email): day1-CTA deep-linker til seneste loebsside, dormant (Refs #2853, #3310)`

### Task 8: Patch note + hjælp

**Files:**
- Modify: `frontend/src/data/patchNotes.js` (læs topposten for struktur/versionsnummer først) · `frontend/public/locales/{en,da}/help.json`

- [ ] **Step 1: Patch note** (EN først, DA under, ingen em-dash, næste versionsnummer i rækken):
EN: "Your first race now gets the spotlight. The dashboard highlights your team's first result until you have seen it, race alerts open the race itself, and squad warnings link straight to the selection panel with a new one-click Auto-select."
DA: "Dit første løb får nu rampelyset. Dashboardet fremhæver holdets første resultat indtil du har set det, løbs-notifikationer åbner selve løbet, og udtagelses-varsler linker direkte til panelet med et nyt et-kliks Auto-udtag."

- [ ] **Step 2: help.json** — under selection/races-sektionen (find eksisterende nøglestruktur): Q "What does Auto-select do?" / "Hvad gør Auto-udtag?" · A: EN "Auto-select fills your race selection with your best available riders, using the same rules as manual selection: one rider per race day, injured riders excluded. You can adjust the result before saving." + DA-oversættelse.

- [ ] **Step 3: Verifikation + commit** — Run: `npm run check:i18n` (kører også tone-check) · Commit — `docs(patch+help): foerste-loebs-oejeblik + auto-udtag (Refs #3310)`

### Task 9: Fuldt preflight, PR + ejer-gate

- [ ] **Step 1: Fuldt lokalt preflight** — Run: `pwsh -File scripts/verify-local.ps1` og `cd frontend && npm run lint` og `npx playwright test core-smoke.spec.js` (ALLE 3 projekter — intet `--project`-flag). `dashboard.png`-snapshottet forventes uændret (E2E-kontoen "E2E Racing" er veteran → varianten renderer ikke); ved diff alligevel: undersøg FØRST om varianten fejlagtigt trigger for veteraner (gate-bug), refresh kun snapshots hvis diffen er tilsigtet.
- [ ] **Step 2: PR-preflight + PR** — Run: `pwsh -File scripts/preflight-pr.ps1` · opret PR med template inkl. Brugerverifikation-sektion. PR-body skal nævne: e-mail-delen er dormant (flag off, #2853 uændret ejer-gated).
- [ ] **Step 3: Visuel evidens til ejeren** — start preview-serveren, seed/naviger til en konto i første-løbs-tilstand (eller mock via dev-data), tag screenshots af (a) dashboard-varianten, (b) notifikationslisten med selection_warning, (c) selection-panelet med Auto-select. Vedhæft i PR. **MERGE IKKE før ejerens visuelle godkendelse.**
- [ ] **Step 4: Efter ejer-go + merge** — flip issue-labels (`claude:todo`→`claude:done` for #2180-frontend-resten), kommentér #3310 med leverancen + at kanonisk dag-1 = `get_cohort_retention`, opdatér `docs/NOW.md` (aktiv slice + Next action) og kør `pwsh -File scripts/check-agent-token-hygiene.ps1`.

---

## Self-review (kørt 4/8)

- **Spec-dækning:** S1 → Task 4+5 · S2 række 2 → Task 1+2 · S2 række 3 → Task 7 · S2 række 4 → Task 3+6 · S3 → ingen kode (eksisterende `get_cohort_retention` er kanonisk; verifikation i Task 9 step 3-4) · patch/help-rutine → Task 8. Welcome-notifikationen (S2 række 1) er bevidst uændret.
- **Placeholder-scan:** ingen TBD/"tilføj passende..."; Task 3 step 1 og Task 6 step 1-2 er verificér-og-tilpas-steps med præcise kommandoer (payload-shape og loader-navn kan ikke fastlåses udefra uden at lyve om koden).
- **Typekonsistens:** `fetchFirstTimeManagers`/`defaultFetchFirstTimeManagers`, `isFirstRaceMoment`, `firstRaceMomentActive`, `latestRaceId`, `primary` bruges ens på tværs af tasks.
