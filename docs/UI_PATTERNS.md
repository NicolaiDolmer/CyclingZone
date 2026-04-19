# UI PATTERNS — Cycling Zone Manager
_Reference til mockups, nye sider og komponent-design._

---

## Stat-farve-koding

Implementeret i `statBg.js` (percentil-baseret per felt):

| Baggrund | Tærskel | Betydning |
|----------|---------|-----------|
| Rød | ≥ 83–85 | Top tier |
| Gul | ≥ 70–82 | Godt |
| Grøn | ~70–72 | Særlig highlight (kontekstafhængig) |
| Ingen | < 70 | Muted |

Brug dette farveskema i alle stat-grids og sammenligninger.

---

## Rytter-profil: Karriere-fane

**Øverst — karrierestat-bokse:**
```
Ny-pro år | Sejre total | Grand Tour vindere/top | Monumenter vinder/top
```

**Tabel-kolonner:**
```
År | Hold | Division | Stilling | LD | Sejre | Vurdering |
BJ | KB | BAK | SP | BRO | ES | FL | UDH | MOD | RES | [løbs-ikoner] | SPECIEL
```

**Sæson-sektion (under tabel):**
- Løbsdage · Verdensrangliste · Mål (med løbs-ikoner)

**Rider card-elementer:**
- Form % · Moral-ikon · Kontrakt-år · Alder · Højde · Vægt · Rating-stjerner · Specialist-ikoner

---

## Rytter-profil: Bedste Resultater-fane

**Layout:** To kolonner

**Kategorier (med samlet antal i header):**
1. Grand Tours
2. Etapeløb CWT
3. Mesterskaber
4. Klassikere CWT
5. Klassikere .Pro

**Hver post:**
```
[Placering]  [Ikon: ETP/PTS/GC]  [Løbsflag]  [Løbsnavn]  [År]
```
Duplikerede placeringer aggregeres: "× 2" / "× 3"

---

## Rytter Statistik-grid (bulk-sammenligning)

**Kolonne-rækkefølge:**
```
FL · BJ · KB · BAK · ES · PRL · BRO · SP · ACC · NED · FTR · UDH · MOD · RES
```

**Principper:**
- Høj informationsdensitet — ingen unødigt whitespace
- Farve som primær visuel læseguide (se farve-tabel øverst)
- Bruges til sammenligning af mange ryttere på én gang

---

## Navigation

- Fold-ud navigation, gruperet: **Overblik · Marked · Mit Hold · Liga**
- Aktiv sektion fremhævet
- Notifikations-badge på ikon

---

## Generelle UI-principper

- Informationsdensitet frem for whitespace
- Ikoner + farver som primær kommunikation, tekst som sekundær
- Danske labels i UI, engelske variabelnavne i kode
- Modaler til bekræftelse af destruktive handlinger (withdraw, slet)
