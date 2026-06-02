# Custom dropdowns positioneret `absolute` klippes ved viewport-kanter (#787)

**Dato:** 2026-06-02
**Issue:** [#787](https://github.com/NicolaiDolmer/CyclingZone/issues/787) — sprog-dropdown kunne ikke ses/scrolles
**PR:** [#971](https://github.com/NicolaiDolmer/CyclingZone/pull/971)

## Symptom

cybersimon kunne ikke se/vælge det andet sprog i sprog-dropdownen. Kunne ikke
reproduceres statisk i en første kode-gennemgang (komponenten havde kun 2 valg,
ingen `max-height`).

## Rod-årsag

`LanguageSwitcher` var en custom listbox (ikke native `<select>`) der altid
åbnede nedad via `absolute … mt-1`. Komponenten bruges bl.a. i **sidebar-footeren**,
som sidder i bunden af en fuld-højde, fixed sidebar. Menuen blev derfor lagt
*under* viewport-kanten, og fordi sidebaren er `fixed` kan siden ikke scrolles
for at afsløre den → 2. valg utilgængeligt.

Det var placerings-konteksten (footer i skærmbunden), ikke selve komponenten,
der udløste buggen — derfor usynlig i en isoleret kode-læsning.

## Fix

- Render menuen i en **portal** (`createPortal` → `document.body`) med
  `position: fixed`.
- **Flip opad** når `spaceBelow < menuhøjde` og der er mere plads over.
- `max-height: calc(100vh - 8px)` + `overflow-y-auto` som sidste sikkerhedsnet.
- Click-away tjekker nu både trigger og portal-menu (menuen er ikke længere
  inde i wrapper-DOM'en).

## Lære (genbrugelig)

1. **Custom popovere/dropdowns skal positioneres viewport-bevidst.** `absolute`
   + fast retning klipper ved skærmkanter (især i `fixed`/`overflow-hidden`
   containere). Default: portal + `fixed` + flip-on-overflow + `max-height`.
2. **Placerings-afhængige bugs ses ikke i isoleret komponent-læsning.** Når en
   delt komponent rapporteres som buggy "kun nogle steder", så tjek *hvor* den
   bruges (her: footer i skærmbund), ikke kun komponenten selv.
3. **E2e mod den faktiske placering fanger det.** Regression-testen asserterer
   `boundingBox` inden for viewport i den logget-ind footer-kontekst — en ren
   unit-test af komponenten ville ikke have fanget klipningen.
