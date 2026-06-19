# Plan-4: delt icon-barrel → kitchen-sink-snapshot vokser (+ mobile-webkit lokal-gap)

**Dato:** 2026-06-19 (dag-bølge 2, ultracode)
**Symptom:** PR #1512 (Plan-4 Notifications) fik `kitchen-sink.png`-snapshot til at fejle på BÅDE `desktop-chromium` og `mobile-chromium` i frontend-smoke (desktop 4276→4342px, mobile 5430→5496px, diff-ratio 0,04 > 0,02). Implementér-agenten afskrev det først som miljø-flake; review-agenten fangede det som ægte; fix-agenten løste det.

## Rod-årsag

`frontend/src/pages/KitchenSinkPage.jsx` rendrer **hele** icon-sættet dynamisk:
```js
Object.entries(Icons).filter(([name]) => name.endsWith("Icon")) // → grid
```
Så ethvert nyt glyph tilføjet til den delte barrel `frontend/src/components/ui/icons/index.jsx` tilføjer en grid-række → KitchenSink-siden vokser i højde → `kitchen-sink-{desktop,mobile}-chromium-win32.png` får en **deterministisk** dimensions-diff (ikke teardown-flake, ikke win32-only). Notifications tilføjede 3 ikoner (LightningIcon/UndoIcon/RocketIcon) → 66px vækst.

## To fælder ramt

1. **Forkert flake-klassifikation.** Agenten tjekkede kun `inbox.png` (core-smoke for sin egen flade) og konkluderede "ingen PNG-refresh nødvendig". Den deterministiske kitchen-sink-diff blev afskrevet som miljø. **Læring:** når du tilføjer et ikon til den delte barrel, ER kitchen-sink påvirket — tjek ALTID `kitchen-sink`-suiten, ikke kun din fladessnapshot. Fix: `npx playwright test kitchen-sink --update-snapshots` + commit de 2 chromium-PNG'er.

2. **Sekventiel-merge compounding.** Flere Plan-4-PR'er tilføjer hver deres ikoner (notifications: 3, manager-profil: FlameIcon, results: CrownIcon+BookOpenIcon). Hver branch er baseret på origin/main UDEN de andres ikoner, så dens kitchen-snapshot er kun korrekt isoleret. Ved sekventiel merge m. rebase bliver icon-sættet kumulativt → kitchen-sink skal regenereres ved HVER merge der tilføjer et ikon, efter rebase, før merge. (Dokumenteret i merge-rækkefølgen i `docs/audits/night-wave-2026-06-19.md`.)

## mobile-webkit lokal-gap (sekundært, samme bølge)

~6 agenter rapporterede at `mobile-webkit` ikke kunne køres lokalt på denne PC (manglende `brotlicommon.dll` / `icuuc77.dll` / `brotlidec.dll`). `npx playwright test core-smoke.spec.js` (uden `--project`) dropper da stille webkit lokalt → "alle 3 projekter"-gaten var reelt 2/3 lokalt; CI-Linux dækkede webkit. Notifications-fix regenererede derfor ikke webkit-snapshot (kun chromium).

**Anbefaling:** kør én gang på denne PC:
```powershell
npx --prefix frontend playwright install webkit
# evt. med runtime-deps:
npx --prefix frontend playwright install --with-deps webkit
```
…så fremtidige bølger får fuld lokal 3-projekt-dækning og webkit-snapshots kan refreshes lokalt.

## Forward-guards

- **Plan-4-flade-prompt:** "Tilføjer du et ikon til `ui/icons/index.jsx` → kør `kitchen-sink`-suiten + refresh dens 2 chromium-PNG'er; det er ikke valgfrit og ikke en flake."
- **Merge-protokol (delte filer):** regenerér kitchen-sink efter hver rebase i den sekventielle Plan-4-kæde.
- **PC-setup:** webkit playwright-browser installeret (se ovenfor).

Relateret: [[feedback_refresh_core_smoke_snapshots]], [[reference_frontend_smoke_teardown_flake]], `docs/WORKTREE_WORKFLOW.md` (per-worktree porte).
