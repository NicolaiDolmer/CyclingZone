# Privatlivstekst: identitets-telemetri (#3132)

**Status: GODKENDT 3/8 (batch-runde 2) — implementeret ordret i PR #3208 (EN+DA + patch note 7.85). #3132 lukkes når PR'en er live.**

Sidste gate før #3132 kan lukkes: privatlivspolitikken skal nævne IP-/enhedslogningen
(`identity_events`, live siden 31/7, retention 180 dage, legitim interesse). Teksten
herunder er skrevet til at glide ind i de eksisterende sektioner på
`PrivacyPolicyPage.jsx` (DA) og `PrivacyPolicyPageEn.jsx` (EN). Ved dit ja
implementerer Claude begge sider ordret + patch note.

---

## DA — nyt punkt under "Hvilke data behandler vi?"

> **Fair play (legitim interesse):** for at kunne opdage og dokumentere snyd med
> flere konti registrerer vi tekniske signaler ved kontooprettelse og ved
> værdibærende handlinger i spillet (fx accepterede transfers, auktionsbud og
> optagne lån): IP-adresse, browser-oplysninger (user-agent), sprogindstilling og
> tidszone. Disse data bruges udelukkende til fair play-håndhævelse, er aldrig
> synlige for andre spillere, deles ikke med tredjeparter og slettes automatisk
> efter 180 dage. Sletter du din konto, slettes de sammen med den. Grundlaget er
> vores legitime interesse i et retfærdigt spil (GDPR art. 6, stk. 1, litra f), og
> du kan til enhver tid gøre indsigelse.

## DA — nyt punkt under "Hvor længe gemmer vi data?"

> <li><strong>Fair play-telemetri (IP og enhedssignaler):</strong> automatisk
> slettet efter 180 dage.</li>

## EN — new bullet under "What data do we process?"

> **Fair play (legitimate interest):** to detect and document multi-account
> cheating, we record technical signals when an account is created and when
> value-bearing actions happen in the game (for example accepted transfers,
> auction bids and loans taken): IP address, browser information (user agent),
> language setting and timezone. This data is used solely for fair-play
> enforcement, is never visible to other players, is not shared with third
> parties, and is deleted automatically after 180 days. If you delete your
> account, it is deleted with it. The legal basis is our legitimate interest in a
> fair game (GDPR art. 6(1)(f)), and you can object at any time.

## EN — new bullet under "How long do we keep data?"

> <li><strong>Fair-play telemetry (IP and device signals):</strong> deleted
> automatically after 180 days.</li>

---

**Faktagrundlag (verificeret i kode/prod):** `identity_events` logger IP,
user-agent, accept-language, tidszone-offset + handlingstype ved signup,
auktionsbud, lån og transfer/swap-accept. Retention-cron sletter >180 dage.
RLS deny-all (kun service_role). Bruger-sletning kaskaderer.
