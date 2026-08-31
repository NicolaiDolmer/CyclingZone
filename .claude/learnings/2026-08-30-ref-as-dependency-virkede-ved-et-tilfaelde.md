# Postmortem · 2026-08-30 · `[ref.current]` som dependency virkede ved et tilfælde

## Hvad skete der?

`NotificationsPage` etablerede sin realtime-subscription på personlige notifikationer med `useEffect(..., [userIdRef.current])`. Det virkede i produktion — men kun fordi `loadNotifications` tilfældigvis altid kaldte en `setState` **efter** den satte ref'en. Fundet under #4332-gennemgangen af alle 42 `exhaustive-deps`-disables.

## Root cause

En ref udløser ingen re-render. `[userIdRef.current]` læses derfor kun når komponenten alligevel rendrer af en anden grund. Sekvensen var:

1. Render 1 — `userIdRef.current` er `null` → effekten returnerer tidligt, ingen subscription
2. `loadNotifications` resolver async → sætter `userIdRef.current = user.id`
3. …og kalder dernæst `setNotifications`/`setNotifLoadError` → **det** udløser render 2
4. Render 2 — dep-arrayet læser nu et nyt id → effekten kører → subscription etableres

Skridt 3 er den utilsigtede invariant. Den står ingen steder som et krav, og intet ville have advaret hvis en senere redigering fjernede den `setState` fra en af stierne — for `// eslint-disable-line react-hooks/exhaustive-deps` undertrykte netop den advarsel der ville fange det. ESLint kaldte den i øvrigt *unnecessary*, ikke *missing*: reglen vidste præcis hvad der var galt, den blev bare bragt til tavshed.

## Fix

`frontend/src/pages/NotificationsPage.jsx` — `userIdRef` erstattet af `const [userId, setUserId] = useState(null)`, effekten keyet på `[userId]`, disable-direktivet fjernet. Ref'en er væk helt (også `useRef`-importen); de tre event-handlers der brugte den (`markAllRead`, `deleteAllRead`) læser nu state.

## Forhindret-fremover

`scripts/check-eslint-disable-count.mjs` fejler nu på ethvert `eslint-disable`-direktiv uden en `-- begrundelse`. Alle 41 resterende direktiver har fået en. Rationalet: en disable uden skreven grund er ikke et valg, det er en udskudt beslutning — og den her lå udskudt siden siden blev skrevet.

## Læring

**En disable skjuler ikke kun advarslen, den skjuler også at advarslen havde ret.** Den billigste måde at genfinde det på er at fjerne direktiverne midlertidigt og lade linteren tale: strip → `eslint -f json` → vurder hver melding → gendan. Det gav 42 meldinger mod 42 direktiver — fuld dækning, ingen gæt, på en gennemgang der ellers ville have været 42 skøn.

Bi-læring: en `-- begrundelse` må stå efter **hele** regel-listen. Indsat midt i `exhaustive-deps, react-hooks/immutability` blev den anden regel til beskrivelsestekst og holdt op med at være undertrykt. Warning-budget-guarden fangede det med det samme — som den skal.
