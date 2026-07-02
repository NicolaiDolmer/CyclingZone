# Verificér premissen før en destruktiv prod-mutation (#1949)

**Dato:** 2026-06-29
**Kontekst:** Weekend-polish-bundt. #1949 bad om at "nulstille rytternes form" efter kalender-rebuild'ets løb-sletning — på linje med at træthed blev nulstillet 27/6. Ejeren (@bobby2106) flaggede det og spurgte om vi overhovedet burde gøre det.

## Hvad der skete
I stedet for at køre reset'et (eller bare planlægge det) undersøgte jeg prod read-only først. Fund:
- `dailyTrainingEngine` skriver `rider_condition.form` hver dag ("form ændrer sig selv på hviledage") — form er en **trænings-output**, ikke kun en løbs-tilstand.
- **AI-hold (kører løb, træner ikke): form = præcis 50,0** på tværs af alle divisioner. Da AI også kører løb, beviser dette at **løb ikke efterlader vedvarende form**.
- Al forhøjet form (50→66, gns. 52,5, 722 ryttere, intet under 50) sidder hos **ægte managere** = legitime trænings-gevinster siden cleanup'en.

Konklusion: der var **ingen løb-rest-form at rydde**. En `form=50`-reset ville have slettet ~2 dages ægte trænings-form for 722 ryttere for nul gevinst. Ejeren droppede det.

## Læring
1. **Symmetri-antagelser holder ikke automatisk.** "Træthed blev nulstillet, så form bør også" var forkert: træthed blev *oppustet* af de slettede løb (derfor rigtigt at nulstille), men form drives af et andet (stadig-kørende) system. Tjek hvad der faktisk skriver feltet, før du behandler to felter ens.
2. **Find et naturligt kontrolgruppe-signal.** AI-ryttere (kører løb, træner ikke) var den perfekte kontrol: deres form=50 isolerede løb-effekten fra trænings-effekten på ét query. Led efter sådan en diskriminator før en mutation.
3. **Read-only prod-evidens før destruktiv mutation** (jf. [[feedback_owner_reviews_live_before_destructive_ops]] + [[feedback_runtime_verify_first]]): én SQL-query forhindrede en skadelig masse-mutation. Form er desuden selv-korrigerende ([[feedback_ship_and_let_self_correcting_systems_glide]]).
