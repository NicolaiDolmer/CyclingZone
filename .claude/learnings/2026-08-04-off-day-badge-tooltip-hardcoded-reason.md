# Postmortem · 2026-08-04 · Off-day-badgen viste altid jour_sans, uanset reason

## Hvad skete der?
`favorite_off_day` beregner allerede en af 4 årsager (`jour_sans`/`incident`/`helper_work`/`unexplained`)
i `backend/lib/raceNarrative.js`. "Det store billede"-teksten (why-panel) brugte allerede `reason`
korrekt. Men det ledsagende story-tag-badge (`tag_favorite_collapse`, label "Kollaps"/"Collapse")
havde en statisk, ikke-parametreret tooltip-streng, OG den blev kun overhovedet skabt for
`reason === "jour_sans"` (#2355, S6). En spiller hvis kaptajn ofrede sig for en holdkammerat
(`helper_work`) fik derfor enten slet intet badge, eller — hvis man læste kildekoden overfladisk —
kunne det se ud som om badget "altid" ville sige jour_sans-teksten. Et Discord-opslag 4/8 (#3336)
gjorde det tydeligt at spillerne ikke kunne gennemskue mekanikken.

## Root cause
To uafhængige bugs i samme feature:
1. `frontend/src/pages/RaceDetailPage.jsx`'s `StoryTagBadges` kaldte `t(...)` for label/tooltip
   UDEN nogen interpolations-variabler overhovedet — selv hvis `tag_favorite_collapse.tooltip` var
   blevet ICU-parametreret med `{reason, select, ...}`, ville `reason` aldrig nå frem.
2. `tag_favorite_collapse` blev kun pushet når `reason === "jour_sans"` (`backend/lib/raceNarrative.js`),
   asymmetrisk med `favorite_off_day`-beatets egen boost-logik (`reason !== "unexplained" ? 10 : 0`,
   samme fil), som allerede behandlede "unexplained" som den ene legitime undtagelse
   (ærlig-degraderings-reglen). `incident`/`helper_work` var uden grund udelukket fra badget.

## Fix
- `backend/lib/raceNarrative.js`: `tag_favorite_collapse` pushes nu for `reason !== "unexplained"`
  (matcher boost-betingelsen ovenfor) i stedet for `reason === "jour_sans"`, og `reason` tilføjes
  til dens `params`. `favorite_off_day`s egen udvælgelse (FAVORITE_OFF_DAY_RANK, boost-værdier,
  hvem der bliver favorit) er UÆNDRET.
- `frontend/public/locales/{en,da}/races.json`: `storyTags.tag_favorite_collapse.tooltip` er nu
  ICU `{reason, select, jour_sans {...} incident {...} helper_work {...} other {...}}`, samme
  4 varianter som den allerede-korrekte `why.favoriteOffDay`.
- `frontend/src/pages/RaceDetailPage.jsx`: `StoryTagBadges` sender nu `tag.params` til begge t()-kald.
- `frontend/public/locales/{en,da}/help.json`: `whyReportFaq` nævner nu eksplicit at badget kun kan
  ramme etapens favorit, aldrig en hjælperytter — lukker selve Discord-diskussionen.
- Nye backend-tests for reason=incident/helper_work → tag_favorite_collapse med korrekt reason;
  eksisterende test for reason=unexplained → intet badge er UÆNDRET (stadig grøn, ingen ny
  påstand modsiger den).

## Forhindret-fremover
- Verificerede empirisk mod prod (Supabase read-only SELECT) at alle 4 reason-værdier faktisk
  forekommer (`unexplained` 67, `helper_work` 33, `jour_sans` 14, `incident` 10 rækker) FØR noget
  blev rørt i raceNarrative.js — modbeviste min egen første hypotese (at "unexplained" reelt aldrig
  rammes pga. floating-point-støj) med data i stedet for at antage.
- Ny mønster-lære: enhver fremtidig `tag_`-story-tag-tooltip der skal parametreres SKAL nu virke,
  fordi `StoryTagBadges` altid sender `tag.params` — ingen ny "glemt interpolation"-klasse af bug.

## Læring
En "hardcoded tekst"-bug kan have TO lag: (1) selve strengen mangler variation, OG (2) render-stedet
sender slet ikke variablerne igennem selvom strengen blev ICU-ificeret. At fikse kun laget der
"lyder som" bugtitlen (strengen) uden at spore HELE datastien fra kilde (`params.reason`) til
skærm (t()-kaldets options-argument) havde efterladt en usynlig no-op-fix. Byggede desuden på et
LATENT flertals-eksempel (bekræftet af 3 real-verdens SQL-rækker) frem for kun det ene tilfælde
issuet selv citerede — samme "verificér reason-fordeling empirisk før antagelse" mønster som
`feedback_runtime_verify_first.md`.
