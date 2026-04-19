# NOW — Aktuel arbejdsstatus
_Opdatér denne fil ved starten og slutningen af hver arbejdssession._

## 🔴 Broken
- `POST /api/admin/seasons/:id/end` udfører ikke sæsonafslutning (kun preview)
- Season standings oprettes ikke automatisk ved sæsonstart
- Achievements tæller ikke korrekt
- Dropdown tekst usynlig (Tailwind farvekonflikt i select-elementer)

## 🟡 I gang
- [ ] Offer withdrawal — køber trækker eget tilbud tilbage
- [ ] Double-confirmation flow — begge parter godkender endeligt inden deal lukkes
- [ ] Event-sekvens dokumentation (transfervindue åbner/lukker, sæsonstart, sæsonslut)

## 🟢 Senest afsluttet
- Transfervindue-validering: guard i alle transfer/swap/lån-endpoints + admin open/close + UI-banner
- Guaranteed sale: sælg rytter til bank til 50% UCI-pris (a428083)
- Withdraw på modtilbud + sælger-notifikation ved tilbud (af7257f)
- manager_name på holds ved signup, profil og holdside (8dbb7f2)
- Multi-år bestyrelsesplaner 1yr/3yr/5yr med kumulativ mål-tracking (1d66668)
- Byttehandler (swap deals) — oprettet
- Lejeaftaler — oprettet
- Salg til AI/bank — oprettet

## Kontekst-links
- Arkitektur + DB → `docs/ARCHITECTURE.md`
- Feature status → `docs/FEATURE_STATUS.md`
- Domæneregler → `docs/DOMAIN_REFERENCE.md`
- UI mønstre → `docs/UI_PATTERNS.md`
- Konventioner + token-regler → `docs/CONVENTIONS.md`
