# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (omskrevet 13/8 efter #3662) · **Arbejdsform:** arkitekt-model i hovedtråden, sonnet-subagenter i worktrees; PR der afventer justering = draft.

## Aktiv styring

> **🎯 Næste action:** **[prompt til næste session](sessions/2026-08-15-oekonomi-og-traeningsside-prompt.md)** — de syv økonomi-beslutninger (designkritikkens §7) og derefter træningssidens struktur ([#3721](https://github.com/NicolaiDolmer/CyclingZone/issues/3721)). **Beslutning 1 først: [#3729](https://github.com/NicolaiDolmer/CyclingZone/issues/3729) markedets mundkurv** — alt andet i værdi-sporet hviler på den.

> **💥 VÆRDI-DESIGNET FALDT 14/8, og det er godt nyt.** Fire ejer-beslutninger truffet ([spec](superpowers/specs/2026-08-14-vaerdi-og-loen-fundament-design.md)), derefter adversarielt kritiseret ([designkritik](superpowers/specs/2026-08-14-oekonomi-designkritik.md), PR #3728). **Holder:** kun-søndag · lønnen er rytterens egenskab · lønkurvens konkave form (fjerner 8/9 af alders-inversionen). **Faldt:** marked-sætter-struktur og de to gates. **Rod-årsagen er én kodelinje** (`auctionRules.js:110`): egen rytter må maks. udbydes til modellens værdi, banken mindst. Markedet er klemt fast om modellen. **23 konkurrenceprissatte spiller-til-spiller-handler i hele spillets historie**, 64,5 % af auktioner får aldrig et bud. "Ikke nok data" er ikke ungdom, det er mundkurv. **Nyt:** [#3729](https://github.com/NicolaiDolmer/CyclingZone/issues/3729) mundkurven · [#3730](https://github.com/NicolaiDolmer/CyclingZone/issues/3730) D4's indtægt (blokerende for #3393) · [#3732](https://github.com/NicolaiDolmer/CyclingZone/issues/3732) værdien er pengepolitik, 53,3 % af alle dræn · [#3733](https://github.com/NicolaiDolmer/CyclingZone/issues/3733) søndags-kvittering.

> **📅 23/8 cutover (9 dage).** **#3449 skal IKKE merges** ([audit](audits/2026-08-14-oplaas-vaerdier-og-loefter.md), PR #3725): sweepet er søndags-gated, så fredagsløftet var strukturelt umuligt; modellen måler dårligere; metrikken er cirkulær; artefaktet er fittet på en typefordeling hvor divergensen nu er 74,8 %. **Anbefaling:** rebase, behold koden, slet artefaktet, hold draft. **#3393** draft indtil beslutning 4+5+6. **#3459** færdig, egen kill-switch, kun flippet mangler. **#3514 anbefales droppet** fra cutoveren per sin egen 19/8-regel — intet er bygget. **#3645 drejebogen er ikke skrevet.**

> **⭐ Spor B:** landing 1 leveret 13/8. **Tilbage:** #3592 (kun capsShaping) · **landing 2 = [#3682](https://github.com/NicolaiDolmer/CyclingZone/issues/3682)**, +2,83 potentiel rating for 4.747 ryttere i fire roller, eneste del der ændrer ryttere, ejer-gated, skal være gulv-løft · landing 3 = **#3709 trin 1 MERGET 14/8** (PR #3717, lukkede #3649+#3651+#3706). **Trin 2 er gated af [#3721](https://github.com/NicolaiDolmer/CyclingZone/issues/3721)** (sidens struktur). Beslutning 15+16: taget udgår af trin 1 og arves af trin 3; enheden er sæson. **#3668 → #3512 efter cutover** — #3512 bærer et åbent offentligt løfte fra 10/8 om startertrupper.

> **🧬 Progressionskæden ([#3564](https://github.com/NicolaiDolmer/CyclingZone/issues/3564)).** Blok 1 lukket 13/8. **16/8→23/8:** #3631 → **#3634 er presserende**: voksen-generatoren fødte 48 ryttere uden bitype 12/8, hullet fylder ~24/døgn.

> **📣 15 løfter til spillerne er uindfriede** ([hovedbog](audits/2026-08-14-oplaas-vaerdier-og-loefter.md) del 2), 20 dage ned til 0. Tre først: **beskeden om værdier og lønninger** (løftet brydes, udkast EN+DA ligger klar) · **#3618** akademi-kvoten, det eneste løfte der bliver mere usandt mens vi ser på det (kø 368 → 772 på tre dage) · **#3715+#3620** forkortede kontrakter, det eneste hvor ventetid gør reparationen sværere; rod-årsag FØR datareparation.

> **👤 Dine klik:** **POST v7.123 + v7.124** (`docs/discord/2026-08-14-patch-notes-712{3,4}.md`, indsæt fra RÅteksten — linjeskift faldt ud 14/8) · **POST værdi-beskeden** · [#3486](https://github.com/NicolaiDolmer/CyclingZone/issues/3486) `VERCEL_TOKEN` · #3425 mobilbundbar A/B (siden 7/8) · [6 svarudkast](discord/2026-08-14-svarudkast.md).

> **📌 Opfølgninger:** **#3719+#3720** præmien er 3,7-6,6× fra kalibreringen — **forudsætning** for værdi-sporet · #3679 · #3671 · #3695 · #3696 · #3697 · #3714 · #3541 · #3172 · #3640 · #3633. **Nye 14/8:** #3705 (træningsbundter → landing 3) · #3708 · #3684 (pixel-snapshots maskerer hver `span`, så farve-regressioner ikke kan fejle) · #3722 (`.single()` på teams) · #3723 (deps) · #3724 (tidszone-dato) · #3726. **Ops:** #2830 uanvendt. Gæld: 546 åbne (13/8).

> **💰 #3720 HØJ, ejer-gated:** A6 antog præmie D1 160k/D2 70k/D3 25k, målt 588k/306k/164k, så upkeep er kalibreret mod et forkert tal. Haster: 24 hold rykker op i D1 ved cutover, 14,1 M-pulje.
> **🤖 Working agent:** **Ingen aktiv session.** Session B (præmiepuljer, #3718-#3720) afsluttet 13:25, PR #3727 merget. 14/8 kørte TO uden at vide om hinanden — feltet kan kun rumme én, så #559-gaten fyrede aldrig ([#3712](https://github.com/NicolaiDolmer/CyclingZone/issues/3712)). Tjek også nyligt oprettede issues og åbne branches før pick-up. **Læring 14/8:** [mål bygget på et tal jeg ikke havde sporet](../.claude/learnings/2026-08-14-maal-bygget-paa-et-tal-jeg-ikke-havde-sporet.md) — begge gates faldt, og en `git branch`-print er ikke en guard.
## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; D1 = kun AI. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag i puljen. **Pension:** måles på AFSLUTTET sæsons alder.
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben (service-key-rotation). **Skalering:** #323.

_Historik i git-log, issue-tråde + docs/audits/._
