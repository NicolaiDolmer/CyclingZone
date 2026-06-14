# Playwright `reuseExistingServer: true` → stale build → false-red på interaktiv manuel verifikation

**Dato:** 2026-06-14 · **Kontekst:** #671 Plan 2b (UI-overlays), manuel live-verifikation af Modal-åbning på `/ui`.

## Symptom
En engangs-Playwright-test (`click "Open dialog"` → forvent `role=dialog`) fejlede: dialogen mountede aldrig (`dialogCount=0`, `body.style.overflow=""`, ingen portal-DIV i body), **men uden console/page-errors**. Det lignede en ægte Modal-bug.

## Rod-årsag
`playwright.config.js` har lokalt `reuseExistingServer: !process.env.CI` (= true) på en hash-afledt port (`playwright.ports.js`). Tidligere kørsler i samme session efterlod en **orphaned `vite preview`-server** på porten (bl.a. fordi en kørsel loggede `worker did not exit … force-killed it`). Den nye kørsel **genbrugte den efterladte server** → serverede et **ældre build** end den aktuelle kildekode. Det statiske look (snapshot-content) så korrekt ud, men den interaktive JS var stale → klik åbnede ingen modal.

## Diagnose der virkede
1. Instrumentér i stedet for at gætte: log `dialogCount`, `document.body.style.overflow`, `body.children`, og `pageerror`/console-errors.
2. **Kontrol-interaktion**: klik en anden state-drevet primitiv (Tab) — virkede den OGSÅ ikke, var det generelt (build/harness), ikke komponent-specifikt.
3. **Tving frisk build**: kør med en ny `PW_PORT` (fx `PW_PORT=4399`) → ingen efterladt server på den port → frisk `npm run build`. Modal åbnede korrekt (`dialogCount=1`, portal-DIV i body, `Esc` lukkede → `afterEsc=0`).

## Forward-guard
- Ved **manuel/interaktiv** Playwright-verifikation lokalt: kør altid med en **frisk `PW_PORT`** (eller dræb efterladte preview-servere først). `reuseExistingServer` er kun sikker når serveren matcher HEAD.
- Når en interaktiv check fejler men det STATISKE snapshot ser rigtigt ud → mistænk stale server FØR du mistænker komponenten. Statisk content kan være korrekt mens JS er gammel.
- Verificér committede snapshots mod et frisk build (frisk `PW_PORT`, uden `--update`) før du stoler på dem — i dette tilfælde passede de 3/3, dvs. regen'erne var friske; men det er først bevist når en ren port bekræfter det.
- Relateret: `playwright.ports.js` dokumenterer allerede port-deling som false-**green**-kilde (bidt 31/5 + 10/6). Dette er samme klasse, men false-**red** på interaktiv adfærd.
