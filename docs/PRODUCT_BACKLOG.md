# PRODUCT BACKLOG — Cycling Zone

_Formål: Samlet backlog for bugs, features, integrationer og forbedringer._
_Regel: Kun aktive/top-prioriterede ting spejles til NOW.md. Kun statusændringer spejles til FEATURE_STATUS.md._

---

## 🔴 Kritiske bugs

- Achievements tæller ikke korrekt
- Notifikationer deduplikeres ikke og sendes hvert minut i stedet for én gang per event
- Transfervindue blokerer salg under minimum squad-size, selv om minimum først skal håndhæves ved sæsonstart
- Evne-filter/slider virker ikke for alle spillere
- Auktioners sluttid/finaliseringslogik afviger fra den aftalte logik
- AI-handler via auktioner bliver ikke gennemført stabilt (rapporteret af Dolmer 2026-04-21 kl. 23:32)
- Transferliste rydder ikke automatisk solgte ryttere ved ejerskifte; ikke-ejede ryttere kan blive hængende
- Signup registrerer ikke `manager_name` korrekt
- Funktionen til at ændre managernavn og holdnavn virker ikke
- Transferfunktioner skal verificeres end-to-end mod nuværende runtime

---

## 🟠 Høj prioritet — features

- Discord webhooks skal forbedres
- Direkte Discord-besked til manager ved events
- Notifikation når ønskeliste-rytter sættes til salg
- Klik på notifikation → deep-link til relevant side
- Admin skal kunne slette en bruger
- "Glemt password" skal være tilgængelig fra auth-flowet
- Managernavn bør matche Discord-navn
- Vis tidspunkt for hvornår rytter sættes til transfer
- Vis ryttertype på rytterside
- Vis land på ryttere
- Klik på logo → dashboard (pc + mobil)

---

## 🟡 Data / integrationer

- Scraper til UCI-ranglisten
- Google Sheets integration
- Teams PCM mapping
- Cyclists PCM mapping
- UCI rangliste sync
- Løbsresultater sync

---

## 🟢 Produktdybde

- UCI-point udvikling over tid
- Stats-udvikling over tid
- Oprykningsindikator under ranglisten

### Rytterhistorik
- Vis AI-salg med pris
- Vis alle transfers
- Manager-handler vises uden pris

---

## 🟣 Økonomi / tuning

- Opdatere økonomien i spillet
- Gange priser med faktor 4000

---

## 🔵 System

- FAQ auto-opdatering
- Patch notes auto-opdatering
