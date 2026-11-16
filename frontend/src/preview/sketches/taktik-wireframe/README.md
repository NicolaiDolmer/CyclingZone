# Skitse #7535: taktik efter wireframe v6c

Ejer 16/11 på #7535: skitsen i #8250 lignede ikke wireframet. Denne skitse gengiver wireframe v6c's Tactics-fane (#7778) præcist, som én fælles komponent på løbssiden og i planlægningen. Ingen produktkode, merges ikke.

Åbnes med `npm run dev` i `frontend/` på
`/src/preview/sketches/taktik-wireframe/index.html?v=race|plan&orders=all&open=r1&theme=dark`.
`v=race` er løbssiden, `v=plan` planlægningen, `orders=all` vælger "All orders" som i wireframe-billedet, `open=r1` åbner rytter 1's kort på telefon.

Billeder: `pr-screens/taktik-wireframe/`. Hvert `*-side-om-side.png` har wireframet til venstre og skitsen til højre; enhver afvigelse er markeret med et rødt nummer og forklaret under billedet. Afvigelser mærket FORSLAG kræver ejerens ja.

## Filer

| Fil | Indhold |
|---|---|
| `Panel.tsx` | Det fælles panel: ruten, "Today's plan", "Orders for stage N" (holdets jagt, tabellen, ordrer pr. rutedel, forklaring, gem). Under 640 px panelbredde: wireframe v6b-mobil-taktik (tids-akse + åbent kort pr. rytter). |
| `Hosts.tsx` | Løbssiden (hero med Spoiler shield og status, etapestriben, fanerne) og planlægningen (wireframets "Planning · Today's tactics" + samme panel). |
| `Profile.tsx` | Ruteprofilen i farvebånd og den lille profil i etapestriben, tegnet som i v6c. |
| `model.ts` | Holdplaner, opgaver, prisord og "Tonight", oversat ordret fra wireframets script. |
| `data.ts` | Wireframets eksempeldata (ruter, etapetider, egne ryttere). Rytter-id'er er erstattet af r1..r7. |
| `taktik.css` | Wireframets CSS med endelige værdier, afgrænset til `.twf`; farver peger på appens tokens. |

## Hvad der ikke er med

- Kun engelsk (wireframet er engelsk). Dansk kommer med i produktkoden via i18n.
- Ingen backend: gem, kopiér og roller er kun klik i skitsen.
- Rating, form, træthed og route match er wireframets eksempeltal.
