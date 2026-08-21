# marketing/ — offentligt SEO-site

Next.js App Router-site for cyclingzone.org's offentlige flade (marketing +
trust-sider). Spil-appen er uændret Vite-SPA i `frontend/`; routing mellem de to
sker via Vercel-rewrites (SPA-projektet beholder domænet). Arkitektur, beslutninger
og byggeplan: [#4067](https://github.com/NicolaiDolmer/CyclingZone/issues/4067)
(fase 1 af #1301/#2824).

```
npm run dev     # lokal udvikling (port 3000)
npm run build   # prod-build — prerenderer alle sider statisk
```

Regler: server-leveret unik title/description/canonical pr. side (canonical sættes
ALTID per page, aldrig i root layout), EN på roden + DA under `/da/` med hreflang,
ingen Google Fonts (self-hostede brand-fonte), anti-slop-designreglerne gælder.
