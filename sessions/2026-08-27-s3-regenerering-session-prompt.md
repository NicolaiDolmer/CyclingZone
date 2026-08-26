# Session-prompt: kør S3-regenereringen

> Skrevet onsdag 26/8 kl. 21:45. **Sæsonen starter fredag 28/8 kl. 11.**
>
> Forrige session merged al koden. Denne session har ét formål: **få den nye kalender i luften på sæson 3.** Ikke bygge mere.

---

## 0 · Læs dette først

**Kør `date` før du skriver en dato nogen steder.** Forrige session daterede alt som 25/8 og måtte rette SSOT bagefter.

**Mål mod prod, gæt ikke.** Hele denne session handler om at ændre live data. Hver eneste påstand om tilstanden skal komme fra en SELECT, ikke fra denne prompt. Tallene nedenfor er målt 26/8 kl. 21:20 og kan være ændret.

**Grøn verifikation beviser kun det verifikationen måler.** Forrige session lærte det tre gange: et grønt scorecard skjulte en re-draw-deadlock, en mobil-fejl på main og fire døde dage i D3. Alle tre blev fundet ved at måle noget scorecardet ikke måler.

**Køreplanen ligger i [`docs/runbooks/2026-08-27-s3-kalender-regenerering.md`](../docs/runbooks/2026-08-27-s3-kalender-regenerering.md).** Læs den hele, før du rører noget. Denne prompt gentager den ikke.

---

## 1 · Hvad der er færdigt

Alt kode-arbejdet er merged til main og verificeret:

| PR | Indhold |
|---|---|
| [#4276](https://github.com/NicolaiDolmer/CyclingZone/pull/4276) | #4236 løbsdage i træk · #4272 finale-bånd · #4273 test-fixtur |
| [#4280](https://github.com/NicolaiDolmer/CyclingZone/pull/4280) | #4275 dashboardet flød vandret over på mobil |

Backend 7181/7181. Scorecard exit 0 på main. Hele e2e-suiten grøn.

**Der er intet at bygge.** Hvis du får lyst til at ændre kode i denne session, så stop og spørg — det er næsten altid forkert her.

---

## 2 · Hvorfor regenereringen ikke bare kan køres

To bevidste værn stopper den, og **begge skal åbnes eksplicit af ejeren**:

1. **Sæson 3 står `active`.** Både regen- og wipe-scriptet nægter alt andet end `upcoming`.
2. **Wipens gameplay-port stopper på 1.066 løbs-udtagelser** — heraf **991 spillernes egne** fra **29 hold**, seneste lavet 26/8 kl. 20:30.

> ⚠️ **[#4229](https://github.com/NicolaiDolmer/CyclingZone/issues/4229):** den 25/8 stod sæsonen ikke-aktiv i **fire timer**. Alder, rangliste, træning og akademi nede for alle — og alle fire kalender-invarianter rapporterede grønt imens. Vinduet skal være minutter, ikke timer, og ejeren skal være til stede hele vejen.

---

## 3 · Målt i live prod 26/8 kl. 21:20

```
Sæson 3     active · 28/8 → 27/9 · 31 løbsdage · 0 kørt · 531 løb · 0 resultater
Udtagelser  1.066   (991 spillernes egne / 29 hold · 75 assistentens / 3 hold)

mountain        225 etaper · 144 slutter nedad (64,0 %) · 22 opad (9,8 %)
hilly           282 etaper · 181 opad (64,2 %)
high_mountain   142 etaper · 137 opad (96,5 %) · 5 nedad
loebsdage over flere datoer   61   (værste spænder 7 datoer)
loeb med hul                   8
```

**Verificér disse tal igen, før du gør noget.** SQL'en står i køreplanen.

---

## 4 · Rækkefølge

Køreplanen har 11 skridt. Det korte:

1. **Ejeren poster Discord-beskeden FØRST.** Udkast EN/DA ligger klar — spørg ejeren efter den, den blev leveret i forrige session. Bliver den ikke postet først, opdager spillerne omlægningen ved at deres hold er tomt.
2. Dry-run → sæson til `upcoming` → ryd udtagelser → wipe → regenerér → scorecard → invarianter → sæson til `active`.
3. **Tænd `stage_scheduler_enabled` + `auto_entry_generator_enabled` allersidst.** Ejer-only.

**Ejer-GO på hvert prod-skridt.** Ikke ét samlet ja. "Vi tager den efter X" er ikke et go.

Går noget galt: **sæt sæsonen tilbage til `active` som allerførste handling.** En kalender med fejl er mindre skadelig end en sæson der ikke findes.

---

## 5 · Fallback hvis tiden løber ud

Et in-place script der kun opdaterer `finale_type` på S3's eksisterende etaper — samme mønster som `recomposeSeason3Stages4103.mjs` (ejer-godkendt 23/8, rører aldrig løb, datoer eller `race_stage_schedule`).

Retter de 144 bjergetaper. **Koster ingenting**: ingen wipe, intet statusskifte, ingen tabte udtagelser. Retter **ikke** de 61 løbsdage eller de 8 huller. Cirka en time inkl. verifikation.

Ejerens holdning 26/8: den fulde regenerering er klart den bedste kalender, fordi løbsdags-fejlen får bindingen til at lyve hele sæsonen. Fallbacken er kun til hvis tiden løber ud.

---

## 6 · Ting der er afgjort — genåbn dem ikke

- **`game_day := dato − startdato`** er afvist fire gange (#4155, #4158, og to gange 26/8).
- **Monument-eksklusiviteten er ophævet** (ejer 26/8). Monumenter må gerne ligge alene, men det er en præference, ikke en regel.
- **GT = præcis 2 hviledage**, som OPTAGER løbsdagen. Spænd = etaper + 2.
- **D1's brostens-reservation er 6, ikke 7.** Den syvende kostede D3 fire dage uden afgørelse. Tabellen med målingerne står i `CALENDAR_RULES.md` §5.
- **`descent_finale_min` er re-deriveret** (D2 10→5, D4 4→3). Hæves den igen, deadlocker re-drawet — 20 af 400 sæsoner udtømte alle 12 forsøg. En test låser relationen.

---

## 7 · Kendt, ikke løst

- **[#4278](https://github.com/NicolaiDolmer/CyclingZone/issues/4278)** — D4 er den mest bjergrige division (opad 41,9 % mod bånd 25-32 %). Ejeren valgte 26/8 at tage den efter sæsonstart. **Rør den ikke i denne session.**
- **[#4281](https://github.com/NicolaiDolmer/CyclingZone/issues/4281)** — `Playwright Smoke` kører kun på PR'er, så main kan stå rød uopdaget. Det var sådan #4275 kunne ligge live.
- **[#4274](https://github.com/NicolaiDolmer/CyclingZone/issues/4274)** — dev-script skrev sin rapport i et andet worktree. Årsag ukendt.
- Katalog-lofter: D1's brosten nåede 3,9 % mod målet 6 %, D4's enkeltstart 8,1 % mod 10 %. Begge kræver **flere løb i kataloget**, ikke højere reservationer.
- `race_entries.binding_span` afhænger af løbsdags-aksen. Skulle nogen forsøge at reparere aksen uden regenerering, skal spændet genberegnes. Ikke undersøgt.

---

## 8 · Praktisk

- **Prod-scripts kræver `infisical run --env=prod --`.** Claude Codes klassifikator spærrede det i forrige session — ejeren skal enten køre dem selv eller tilføje en permission-regel. Afklar det som noget af det første, ellers står du stille midt i sekvensen.
- **Read-only SELECTs mod prod virker fint via Supabase-MCP'en.** Brug den til al verifikation.
- Slå kolonnenavne op i `database/schema-snapshot.json` før ad-hoc SQL.
- Hoved-checkoutet må ikke skifte branch (guard). Brug worktrees.
