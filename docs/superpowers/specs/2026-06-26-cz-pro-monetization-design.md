# CZ Pro — Monetiserings-strategi & faseplan

> **Status:** Design godkendt 2026-06-26 (brainstorm med ejer). SSOT for hvordan Cycling Zone begynder at tjene penge.
> **Næste skridt:** implementeringsplan for **Fase 1** (writing-plans) — resten af planen er roadmap, ikke build-scope endnu.

## 1. Mål

Bygge Cycling Zone til en **professionel, skalerbar virksomhed** (mod ~5.000 MUA på sigt) som Nicolai kan leve af. Ikke fra dag 1 — men starten lægges nu, mens basen er lille og tilgivende. Indtægten er symbolsk i begyndelsen og vokser med brugertallet.

## 2. Udgangspunkt (verificeret 2026-06-26)

| Signal | Tal |
|---|---|
| Rigtige managere (ikke-AI/test/frosne) | **39** |
| Signups i alt | 42 |
| Aktive sidste 7 dage | **24** (57% af basen) |
| Aktive sidste 30 dage | 38 |
| Nye signups sidste 30 dage | **22** |

Lille base, men **stærkt engagement** (57% ugentligt aktive) og **vækst**. Tidligt produkt med gode signaler.

**Allerede bygget (genbruges):** `FounderSupporterPage.jsx` (hero, "Fair Premium Promise", tier-kort, "hvad må/må ikke sælges", FAQ), `FounderSupporterWaitlistForm.jsx`, central pris-konfig (`lib/pricing.js`, A/B/C-test), `founder_supporter_waitlist`-tabel, `AdminWaitlistPage`.

**Mangler for at tjene penge:** faktisk betaling (ingen Stripe i koden), entitlement/gating, de betalte features (værdien), og konvertering fra interesse → køb.

**Vigtig nuance:** ventelisten har 1 tilmelding — men siden blev **aldrig gjort færdig eller promoveret**. Det er *ikke* bevis for lav betalingsvilje; vi har aldrig spurgt. Konklusion: brug ikke energi på at færdiggøre ventelisten *som venteliste* — gå direkte til en færdig, købbar Founder-side.

## 3. Model (ejer-valgt)

- **Rygrad: CZ Pro abonnement** (tilbagevendende) — det eneste der kompounder til en løn. Vokser med basen.
- **Supplement: supporter-status + kosmetik** — varme + smags-fit.
- **Founder-tilbuddet = begge dele i én:** en Founder er tidlig abonnent *og* supporter, med livstids-rabat + Founder-status.

**Bevist præcedens:** Hattrick — gratis browser-fodboldmanager, 20+ år finansieret af præcis denne model (valgfri Supporter-abonnement, nul pay-to-win, gratis-spil fuldt konkurrencedygtigt). Modellen er ikke et eksperiment i genren.

## 4. Jernreglen: aldrig pay-to-win

Cycling Zone er kompetitivt multiplayer (managere byder CZ$ på ryttere mod hinanden i live-auktioner).

> **Gratis-spilleren skal have al information og alle handlinger der skal til for at konkurrere og vinde. Penge køber dybde, komfort, kosmetik og status — aldrig en eksklusiv beslutnings-fordel.**

Det øjeblik penge kan vinde en auktion eller afsløre eksklusiv viden, dør den kompetitive integritet — og dermed grunden til at spille — og den engagerede kerne (57% ugentligt aktive) støttes fra. Dette er forretningskritisk, ikke moralsk pynt.

## 5. Strategi: Approach A — venteliste → rigtigt Founder-køb

Lav ventelisten om til et **rigtigt, købbart Founder-medlemskab** til de eksisterende 39. Genbrug landingssidens stillads; skift venteliste-formularen ud med en Stripe-knap.

Hvorfor A frem for "byg Pro færdigt først" (B) eller "vent på skala" (C): A er den eneste vej der giver **ægte betalingsvilje-evidens** (en transaktion, ikke en undersøgelse) + **første kroner** + **det professionelle fundament** på én gang — uden at vente på de 5.000 MUA. Den respekterer "vi skal starte et sted".

**Succesmål for Fase 1 er IKKE omsætningsvolumen.** Det er **læring**: hvem køber, til hvilken pris, og hvad gør Pro pengene værd. Plus de første kroner + goodwill + en liste over din betalende kerne.

## 6. Værdideling (v1) — godkendt

| 🟢 Altid gratis | 💎 Pro v1 (sælges) | ⛔ Sælges aldrig |
|---|---|---|
| Fuld holdstyring, alle 4 motorer (løb, træning, ungdom, transfer/auktion) | Founder-badge + supporter-status | CZ$, budget eller sponsor-boost for penge |
| Al beslutnings-kritisk info (rytter-stats, resultater, stilling, basis-scouting) | Trøje/kit + logo-designer (ren kosmetik) | Scouting-/ungdoms-potentiale-præcision (spilmekanik, #1791) |
| At byde i auktioner (tilstedeværelse/dygtighed afgør) | Pro-analytics: avancerede stats, sæson-historik, udviklings-grafer (rigere *visning* af data gratis også ser) | Større squad-cap for penge |
| Squad-cap + CZ$-økonomi — identisk for alle | Komfort: flere watchlist-pladser, gemte filtre/taktik-presets, data-eksport | Auto-vind auktioner / garanterede bud |
| | Early access til nye features + roadmap-stemme | |

**v1-bundtet er bevidst lille** — nok til at en Founder-pris føles ægte og fair. Resten af Pro-værdien bygges i Fase 2.

**Gråzone-domme (ejer-besluttet 2026-06-26):**
1. **Auto-bud sælges ikke** — auktioner forbliver tilstedeværelses-baserede. En *bud-påmindelse* ("X lukker snart") kan gives gratis til alle.
2. **Pro-analytics afslører aldrig eksklusive fakta** — kun rigere grafer/historik af data der allerede findes råt for gratis-spillere.

## 7. Prissætning (anbefalet — ejer bekræfter før go-live)

Kollaps v1 til **én betalt pris** (drop free/supporter/pro/patron-firkløveret til start; udvid tiers senere). De eksisterende 49/89/149 kr/md er i den stejle ende for genren.

- **Anbefalet launch:** led med **årspris ~349–399 kr/år** (Hattrick-anker; cash up-front, bedre tidlig konvertering) + valgfri **månedspris ~49 kr/md**.
- **Founder-hook:** livstids-rabat (Founder-prisen følger dig) + Founder-badge, kun for dem der køber i launch-vinduet.
- Højere "Patron"-tier til dem der vil give mere: senere, ikke v1.

*Eksakte tal låses som et lille separat skridt før Stripe-produktet oprettes.*

## 8. Faseplan

**Fase 0 — Lås & forbered (dage, mest beslutninger)**
- ✅ Model, jernregel, værdideling, gråzoner — låst.
- Lås eksakte priser (§7).
- Opret Stripe-konto (test + live), Product "CZ Pro" m. annual + monthly Price + Founder-coupon.
- Jura: ToS + refund-politik (EU 14-dages fortrydelse + digital-content-waiver). Privatlivspolitik findes.

**Fase 1 — Founders-medlemskab (uger) — build-scope for første implementeringsplan**
- Stripe Checkout + webhook + entitlement i Supabase (§9).
- Byg v1 Pro-perks: Founder-badge, kit/logo-designer, Pro-analytics-views, early-access-flag, komfort-features.
- Konvertér Founder-siden: venteliste-form → "Bliv Founder"-CTA → Stripe Checkout.
- Tilbyd de 39 Founder-medlemskab m. livstids-rabat.
- Mål: læring (hvem/hvad/pris) + første kroner + goodwill.

**Fase 2 — Det rigtige Pro-produkt (måneder, vokser med basen)**
- Uddyb Pro-værdi (dybere analytics, kosmetik-pipeline, mere komfort).
- Konvertér free→Pro løbende; mål og bekæmp churn.
- Genindfør flere tiers hvis data understøtter det.

**Parallelle spor**
- **Professionalisme/jura:** ToS, refund-politik, bogføring, Stripe Tax (EU-moms), kvitteringer.
- **Skalering mod 5.000 MUA:** teknisk kapacitet (Supabase Pro, perf) — separat fra monetisering, men planlagt.

## 9. Teknisk arkitektur (Fase 1)

Stack: React/Vite (Vercel) · Node/Express (Railway) · Supabase (Postgres, Auth, RLS) · Stripe.

**Stripe**
- Product "CZ Pro" m. to Prices (annual, monthly) + Founder-coupon (livstids-rabat).
- **Stripe Tax** slået til → automatisk EU-moms + momspligtige kvitteringer/fakturaer.
- Billing Portal til self-service (opsig/skift kort).

**Backend (Express)**
- `POST /api/billing/checkout` — opretter Checkout Session (`mode=subscription`) for den autentificerede bruger; `client_reference_id` = team/user-id; success/cancel-URLs. Returnerer session-URL.
- `POST /api/billing/webhook` — rå body, verificér signatur, idempotent (gem event-id). Håndtér `checkout.session.completed`, `customer.subscription.updated|deleted`, `invoice.paid|payment_failed` → opdatér entitlement.
- `POST /api/billing/portal` — Billing Portal-session.
- Gate Pro-endpoints med `isPro(team)`-helper.

**Supabase (skema)**
- Ny tabel `subscriptions`: `user_id`/`team_id`, `stripe_customer_id`, `stripe_subscription_id`, `status`, `tier`, `current_period_end`, `is_founder`, `created_at`. Afledt `is_pro` / `pro_until` til hurtige checks.
- RLS: bruger læser egen subscription; **kun service_role (webhook) skriver**.
- Migration auto-applies i prod → **ejer merger PR'en med SQL** (jf. hard rule).

**Frontend**
- `isPro`-helper (delt logik) gater Pro-UI: badge, kit-designer, Pro-analytics, early-access-flag.
- Founder-side: behold stillads, skift form → Checkout-CTA.
- Billing-indgang i profil/settings → Portal.

## 10. Succesmål / scorecard (Fase 1)

Ikke en omsætnings-target. Mål:
- **Konvertering:** andel af aktive (af de 39) der bliver Founders.
- **Pris-signal:** hvilket prispunkt der konverterer (årlig vs. månedlig).
- **Kvalitativt:** "værd pengene?"-feedback fra købere (+ Discord-samtaler med kernen).
- **Tidlig churn-indikator** når abonnementer fornyer.

## 11. YAGNI — hvad vi BEVIDST IKKE bygger i v1

- Flere tiers (kun free + 1 betalt).
- Auto-bud, kosmetik-marketplace, sæson-/battle-pass.
- Annoncer (strider mod kvalitets-/anti-slop-standard).
- Køb af CZ$ eller nogen form for competitive boost — nogensinde.

## 12. Risici

- **Tynd værdi:** lille v1-bundt kan føles for spinkelt → modvirkes af Founder-status + livstids-rabat + ærlig "pakken vokser"-besked.
- **Lille base:** få købere giver støjende signal → behandl Fase 1 som læring, ikke omsætning.
- **Pris for høj for genren:** start lavt/årligt, juster på data.
- **Webhook-fejl → forkert entitlement:** idempotens + signatur-verifikation + service_role-only writes.

## 13. Åbne beslutninger (ejer)

1. Eksakte priser (§7) — anbefalet ~349–399 kr/år + ~49 kr/md.
2. Launch-vinduets længde for Founder-livstids-rabat.
