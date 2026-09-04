# 2026-09-04 · Vercels `__vdpl`-cookie pinner assets, men ikke dokumentet, i rigtige browsere

## Hvad skete
PR #4758 satte `__vdpl=<deployment-id>` ved boot (30 min vindue, kun production). Verificeret på
preview med curl og Browser-pane: pinnen så korrekt ud. Efter merge (11:31) og fire backend-
merges (11:43 → fire deploys) viste prod i en browser med cookie fra 11:31-deployet: **HTML fra
det nyeste deploy, alle `/assets/*` 404 (pinnet til det gamle), `/chunk-selfheal.js` serveret som
text/html via SPA-rewriten**. Sort side for alle spillere med en cookie fra forrige deploy, i op
til 30 min efter hvert nyt deploy.

## Rod-årsag (målt)
```
curl -H "Cookie: __vdpl=A" /login                                → HTML fra A   (pin virker)
curl -H "Cookie: __vdpl=A" -H "Sec-Fetch-Dest: document"
     -H "Sec-Fetch-Mode: navigate" /login                        → HTML fra B   (nyeste!)
curl -H "Cookie: __vdpl=A" -H "Sec-Fetch-Dest: script" /assets/B → 404
```
Vercel honorerer cookien for sub-requests men ikke for browser-navigationer (Sec-Fetch-Mode:
navigate). Dokumentet er altid nyeste; assets følger cookien. For en Vite-SPA uden framework-
adapter er cookie-pinnen derfor direkte skadelig.

## Rettelse
Hotfix 057622162 på main (11:58): `installSkewProtection()` kaldes ikke; inline script i
`index.html` rydder cookien FØR preload-scanneren og genindlæser én gang. Verificeret i browser
med gammel cookie: cookie væk, én reload, alle assets 200, selvheling aktiv.

## Regel fremover
- **Preview beviser ikke et rul.** Ændringer i deploy-/routing-mekanik testes med to
  produktions-deploys i træk og en rigtig browser (ikke curl) med åben session imellem.
- curl uden `Sec-Fetch-*`-headers opfører sig ikke som en browser hos Vercel. Test altid med
  `Sec-Fetch-Dest: document` + `Sec-Fetch-Mode: navigate`.
- Batch merges: ét deploy-vindue pr. bølge, ikke fire på 20 sekunder.
- Skew Protection for SPA'en: kun via selvheling (#4595) + deploy-disciplin, indtil Vercel
  pinner navigationer.

Refs #2423 #4758 #4595
