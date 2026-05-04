# Cycling Zone — Roadmap

_Hej allesammen 👋 Inden vi trykker på den store knap og starter sæson 1 op, vil jeg dele hvad der ligger på vores arbejdsbord. Vi kører ikke efter en låst dato — vi går live når kvaliteten er der. Forventet: nogle uger ude._

_Listen er rangeret efter hvad der lander først, ikke efter prioritet._

---

## 🚧 Næste op (lander før launch)

Det her er hvad vi PRIORITERER højest og forventer at have klar inden vi starter sæson 1:

- 💰 **Permanent fix på rytter-værdier og lønninger.** Vi har sporet en ondsindet bug der får salary til at skifte mellem to formler (10% og 15% af værdi) afhængigt af om en rytter lige er solgt eller om mandags-cron har kørt. Vi gør salary-feltet auto-beregnet på databaseniveau så det bliver fysisk umuligt for noget at skrive et forkert tal. Bug bliver lukket permanent.

- 🏛 **Bestyrelses-flow til sæson-rytmen.** Sæson 1 bliver baseline (ingen aktiv plan, modifier 1.0). Når sæson 1 slutter, forhandler du sekventielt: først din 5-årige plan (sæson 2-6), så 3-årige (sæson 2-4), og endeligt udleveres en 1-årig plan baseret på de to lange — som du kan prioritere kortsigtede mål i hvis dit hold har brug for resultater nu. Sæson 1's resultater bruges som identitets-data: havde du mange franske ryttere? Mange unge? Bestyrelsen vil gerne se den linje fortsætte.

- ⏰ **Forhandlings-deadline på 5 løbsdage.** Når 5 løb er kørt i sæsonen, låser bestyrelses-forhandlingerne. Glemmer du at forhandle, fortsætter din nuværende plan automatisk (status quo). Du får countdown-banner på Dashboard og Bestyrelse-siden.

- 🚦 **Trupstørrelses-håndhævelse.** Når et transfervindue lukker:
  - **Under minimum:** Vi køber automatisk billigste tilgængelige AI-rytter (til 150% af værdi) for dig + 100K bøde + 200 point fradrag pr. manglende rytter.
  - **Over maximum:** Din nyest erhvervede rytter sælges automatisk + samme bøde og fradrag pr. rytter for meget.
  - Hvis du ikke har råd til auto-køb: nødlån oprettes automatisk.

- 🛠 **Admin kan annullere auktioner** der er oprettet ved fejl — uden DB-magi.

- 📨 **Indbakke som primær spil-loop.** Alle hændelser samles ét sted med kategori-filtre. Klik på en besked → springer direkte til det rigtige sted i spillet. Indbakke + Dashboard skal være de to vigtigste overflader.

---

## 📅 Næste måned

Når P0-listen er grøn, fokuserer vi på polish og kvalitet:

- 🎨 **Konsistente evne-farver overalt** hvor stats vises (i dag bruges to forskellige farve-kilder).
- 🏠 **Hurtigere vej hjem:** klik på CZ-logo går altid til Dashboard, både på PC og mobil.
- 📜 **Transfer-historik** får sin egen side, sin egen tab på holdsider, og en sektion på rytter-sider — så du kan følge en rytters rejse gennem klubberne.
- 🟢 **Online-status pr. manager** mere synligt — på holdsider, på lister og på manager-profiler. "Sidste set"-tid bliver synlig.
- 📚 **Onboarding-smoke** og opfølgning på de nyligt leverede flows for nye managers.
- 🔁 **Auto-sync mellem spil og dyn_cyclist Google Sheet** når en rytter skifter hold — så manuelt database-arbejde forsvinder helt.
- 🛠 **Audit af admin-værktøjer + holdvisninger** — gennemgang af eksisterende sider for at finde og fikse irritationsmomenter inden vi launcher.
- 🤖 **Drift-monitor:** automatisk SQL-tjek der finder økonomi-uoverensstemmelser før I når at opdage dem. Slack/Discord-alarm hvis noget driver.

---

## 🌱 Næste sæson — vision

De her spor er på vores arbejdsbord men endnu ikke spec'et. Vi spec'er dem efter launch sammen med jer baseret på hvilke I efterlyser mest:

- 🎉 **Fans-mekanik** — fans giver indtægt og sætter krav. Kapacitet, hjemkamp, identitets-loyalitet.
- 👕 **Merchandise** — kobler til fans og omdømme. Indtægts-kilde der belønner stjernerytter-køb og resultater.
- 🌟 **Omdømme på løb og ryttere** — løb-prestige påvirker præmiepuljer; rytter-stjerne-status adskiller stjerner fra arbejdsheste.
- 🌍 **Lande-størrelse/omdømme** — hold med stærk national identitet får sponsor-boost. Belønner cykling-realisme.
- 🚴 **Ryttertyper som synlig kategori** — sprinter/klatrer/GC/klassiker/tidskører/allrounder/domestique som badges på rytterkort, filtre på rytterliste.
- 📰 **Press- og narrative-engine** — automatisk genererede historier baseret på dine handlinger. "Skifter Pogačar til CZ-Movistar i overraskende mid-season-deal?"
- ⚔️ **Rivalitets-system** — hold der konkurrerer om samme ryttere/divisioner får dynamiske rivaliteter med bonus-events.
- 🏆 **Manager XP / historie-arcs udvidet** — legend-tier, decision-arcs, lange historielinjer.

**Visionen er** at det skal føles som en ægte karriere i et single-player spil med dyb historie og store valg — men gjort multiplayer, hvor I handler med hinanden og er en del af et fællesskab.

---

## 💬 Hvordan I kan hjælpe

- **Test transfermarked**, byd, lav swaps, brug auktioner — vi får data om hvad der kan gå galt.
- **Sig til** hvis I oplever en bug eller noget der virker forkert. Især i indbakken og på admin-værktøjer hvor vi ved der er gnidninger.
- **Stem på P2-spor** I synes vi skal prioritere efter launch — Fans, Merchandise, Omdømme, Ryttertyper, Press-engine, Rivalitet?

---

_Roadmappet opdateres ved hver større leverance._  
_Senest opdateret: 2026-05-04_
